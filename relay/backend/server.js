'use strict';

// The Metro Calendar relay: fetches ONE calendar feed and hands back its
// text, with a CORS header, so the configuration editor can read a calendar
// the browser refuses to.
//
// WHY IT EXISTS. A calendar feed sends no `Access-Control-Allow-Origin`, so
// a web page cannot read one: the editor's own fetch is refused by the
// browser before it leaves. No AI assistant can fetch one either. That left
// two routes, both manual -- download the .ics and paste it in, or paste it
// into the chat -- and a configuration tool that says "I cannot read your
// calendars" to the person it is supposed to be helping.
//
// WHAT IT HOLDS. A calendar link is a password in a URL. Google calls it a
// "secret address"; anyone holding it can read that calendar until it is
// regenerated. Everything below follows from that:
//
//   * Nothing that carries a URL is logged. Not the query string, not the
//     path, not the Referer. A log line here is a copy of somebody's
//     calendar key, sitting in a file and in every backup of that file.
//     What gets counted is counts.
//   * Nothing is stored. The response goes back to the caller and is
//     forgotten. No cache, no disk, no database.
//   * It is not an open proxy. https only, port 443 only, public addresses
//     only, re-checked on every redirect, and the answer has to look like a
//     calendar.

const http = require('http');
const https = require('https');
const dns = require('dns').promises;
const net = require('net');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

// Who may call this from a browser. An allowlist, not "*": a relay that
// answers anybody is a relay anybody can point at their own users.
const ORIGINS = (process.env.ORIGINS || 'https://excusemi.github.io,http://localhost:8000,http://127.0.0.1:8000')
  .split(',').map(function (s) { return s.trim(); }).filter(Boolean);

const MAX_BYTES = 4 * 1024 * 1024;   // a year of a busy calendar is well under this
const TIMEOUT_MS = 12000;
const MAX_REDIRECTS = 3;

// A crude per-address bucket. Not security -- anybody can change address --
// but it stops one runaway loop from becoming somebody else's bandwidth.
//
// PER DAY, AND SIZED FOR A HOUSEHOLD. The editor asks for every unread
// feed at once, so one press is one request per calendar: a family with
// nine spends nine, and a real setup session (reading each link, reopening
// a pasted config, a reload or two) spent thirty an hour and got 429s.
// Three hundred a day is some thirty full reads of a nine-calendar household,
// and still nothing like a useful amount of somebody else's bandwidth. Set
// RATE_MAX and RATE_WINDOW_MIN to change it.
const RATE = {
  windowMs: Number(process.env.RATE_WINDOW_MIN || 1440) * 60 * 1000,
  max: Number(process.env.RATE_MAX || 300),
};
const seen = new Map();
function rateOk(ip) {
  const now = Date.now();
  const hits = (seen.get(ip) || []).filter(function (t) { return now - t < RATE.windowMs; });
  hits.push(now);
  seen.set(ip, hits);
  if (seen.size > 5000) {
    for (const [k, v] of seen) {
      if (!v.some(function (t) { return now - t < RATE.windowMs; })) seen.delete(k);
    }
  }
  return hits.length <= RATE.max;
}

// PRIVATE ADDRESSES ARE THE WHOLE POINT OF THE GUARD.
//
// Anything that fetches a URL somebody else chose will be pointed at
// 169.254.169.254 (a cloud metadata service), at 127.0.0.1, and at whatever
// else is on the LAN. This container sits on one, beside two dozen other
// plugin backends.
function isPublic(ip) {
  if (net.isIPv4(ip)) {
    const b = ip.split('.').map(Number);
    if (b[0] === 10 || b[0] === 127 || b[0] === 0) return false;
    if (b[0] === 172 && b[1] >= 16 && b[1] <= 31) return false;
    if (b[0] === 192 && b[1] === 168) return false;
    if (b[0] === 169 && b[1] === 254) return false;              // link-local, metadata
    if (b[0] === 100 && b[1] >= 64 && b[1] <= 127) return false; // CGNAT
    if (b[0] >= 224) return false;                               // multicast, reserved
    return true;
  }
  if (net.isIPv6(ip)) {
    const a = ip.toLowerCase();
    if (a === '::1' || a === '::') return false;
    if (a.startsWith('fc') || a.startsWith('fd')) return false;  // unique local
    if (a.startsWith('fe80')) return false;                      // link-local
    // An IPv4 address wearing an IPv6 hat still has to pass the IPv4 test.
    const m = a.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isPublic(m[1]);
    return true;
  }
  return false;
}

async function checkTarget(raw) {
  // webcal:// is what iCloud and Outlook hand out, and it is https with a
  // different coat of paint. Swapped in the STRING, before parsing: webcal
  // is not one of the URL standard's special schemes, so assigning to
  // `.protocol` on a parsed one is silently ignored, and the check below
  // then rejects every iCloud link there is.
  const wasWebcal = /^webcal:\/\//i.test(raw);
  if (wasWebcal) raw = 'https://' + raw.slice(9);
  let u;
  try { u = new URL(raw); } catch (e) { throw new Error('that is not a URL'); }
  if (u.protocol !== 'https:') throw new Error('https only');
  if (u.port && u.port !== '443') throw new Error('port 443 only');
  // IT ONLY FETCHES CALENDARS.
  //
  // The answer has to contain BEGIN:VCALENDAR either way, but that is a
  // check made AFTER the request has gone out: without this, anybody could
  // use the relay to make this machine fetch any https URL on the internet
  // and tell them whether it looked like a calendar. Refusing up front
  // keeps the request from being made at all.
  //
  // Generous on purpose, because the four services people actually use do
  // not agree on what a calendar link looks like: Google ends in
  // `basic.ics`, Outlook in `calendar.ics`, iCloud hands out a webcal link
  // with no extension at all, and Nextcloud a path ending `?export`. So:
  // a calendar-ish extension, or a query that says export, or the word
  // ical/calendar/webcal somewhere in it.
  // A webcal:// link needs no sniffing: the scheme IS the claim.
  const looksLikeIcs = wasWebcal
    || /(\.ics|\.ical|\.ifb)(\?|$)/i.test(u.pathname + u.search)
    || /(^|[?&])export(=|&|$)/i.test(u.search)
    || /ical|icalendar|caldav|calendar|webcal/i.test(u.hostname + u.pathname + u.search);
  if (!looksLikeIcs) throw new Error('that does not look like a calendar link');
  const addrs = await dns.lookup(u.hostname, { all: true }).catch(function () { return []; });
  if (!addrs.length) throw new Error('that host does not resolve');
  // EVERY address, not the first: a name that answers with one public and
  // one private address is the oldest trick there is.
  for (const a of addrs) {
    if (!isPublic(a.address)) throw new Error('that address is not on the public internet');
  }
  return u;
}

function fetchIcs(url, depth) {
  return new Promise(function (resolve, reject) {
    const req = https.get(url.toString(), {
      headers: {
        // Say what this is. A calendar service that wants to refuse it is
        // entitled to, and should be able to tell who is asking.
        'user-agent': 'metro-calendar-relay/1 (+https://github.com/ExcuseMi/trmnl-metro-calendar-plugin)',
        accept: 'text/calendar, text/plain;q=0.9, */*;q=0.5',
      },
      timeout: TIMEOUT_MS,
    }, function (res) {
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        if (depth >= MAX_REDIRECTS) return reject(new Error('too many redirects'));
        let next;
        try { next = new URL(res.headers.location, url); }
        catch (e) { return reject(new Error('a redirect went nowhere')); }
        // CHECKED AGAIN. A public URL that redirects to 169.254.169.254 is
        // the same attack as asking for it directly, one hop later.
        return checkTarget(next.toString()).then(function (ok) {
          resolve(fetchIcs(ok, depth + 1));
        }, reject);
      }
      if (code !== 200) { res.resume(); return reject(new Error('the calendar answered ' + code)); }
      let size = 0;
      const chunks = [];
      res.on('data', function (c) {
        size += c.length;
        if (size > MAX_BYTES) { req.destroy(); return reject(new Error('that calendar is too big')); }
        chunks.push(c);
      });
      res.on('end', function () { resolve(Buffer.concat(chunks).toString('utf-8')); });
    });
    req.on('timeout', function () { req.destroy(); reject(new Error('the calendar did not answer in time')); });
    req.on('error', function (e) { reject(new Error('could not reach the calendar (' + (e.code || e.message) + ')')); });
  });
}

const stats = { ok: 0, refused: 0, failed: 0, since: new Date().toISOString() };

const server = http.createServer(async function (req, res) {
  const origin = req.headers.origin;
  const allowed = origin && ORIGINS.indexOf(origin) >= 0;
  const cors = {
    'access-control-allow-origin': allowed ? origin : ORIGINS[0],
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }

  // The path only, never the query: the query is the calendar key.
  const path = (req.url || '').split('?')[0];
  if (path === '/health') {
    res.writeHead(200, Object.assign({ 'content-type': 'application/json' }, cors));
    return res.end(JSON.stringify(stats));
  }
  if (path !== '/ics') { res.writeHead(404, cors); return res.end('no'); }
  if (req.method !== 'GET') { res.writeHead(405, cors); return res.end('GET only'); }

  // Behind Caddy behind Cloudflare, so the socket address is the proxy.
  const ip = (req.headers['cf-connecting-ip'] || req.headers['x-real-ip']
    || req.socket.remoteAddress || '').toString().split(',')[0].trim().replace(/^::ffff:/, '');
  if (!rateOk(ip)) {
    stats.refused++;
    res.writeHead(429, Object.assign({ 'content-type': 'text/plain' }, cors));
    return res.end('too many requests from here; try again later');
  }

  let target;
  try { target = new URL(req.url, 'http://x').searchParams.get('url'); } catch (e) { target = null; }
  if (!target) {
    stats.refused++;
    res.writeHead(400, Object.assign({ 'content-type': 'text/plain' }, cors));
    return res.end('pass ?url=<the https link to the .ics>');
  }

  try {
    const checked = await checkTarget(target);
    const text = await fetchIcs(checked, 0);
    // AN ERROR PAGE IS NOT A CALENDAR. Handing one back would be stored by
    // the editor as a feed with no events, which reads as "your calendar is
    // empty" rather than "this did not work".
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('that link did not return a calendar');
    stats.ok++;
    res.writeHead(200, Object.assign({
      'content-type': 'text/calendar; charset=utf-8',
      'cache-control': 'no-store',
    }, cors));
    res.end(text);
  } catch (e) {
    stats.failed++;
    // The message, never the URL.
    //
    // 422 and not 502. This sits behind Cloudflare, and Cloudflare replaces
    // the body of any 5xx from an origin with its own "error code: 502"
    // page, so every refusal reached the editor as a bare number and the
    // reader never saw why: "that does not look like a calendar link" and
    // "that address is not on the public internet" both arrived as HTTP
    // 502. A 4xx body is passed through untouched.
    res.writeHead(422, Object.assign({ 'content-type': 'text/plain; charset=utf-8' }, cors));
    res.end(String(e.message || e));
  }
});

// No request logging, by omission and on purpose: see the note at the top.
server.listen(PORT, HOST, function () {
  process.stdout.write('metro-calendar relay listening on ' + HOST + ':' + PORT + '\n');
});
