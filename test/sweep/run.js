'use strict';

// THE BOARDS THE DEVICE ACTUALLY DRAWS, ACROSS EVERY VIEW.
//
//   node test/sweep/run.js [set-substring]
//
// The other harnesses ask about boards somebody wrote down: `test/boards` and
// `test/layout` lay out fixtures, `test/households` lays out six invented
// households. This one takes the three example days the plugin ships -- the
// same payloads a reader with no calendars sees -- through the real
// transform, at five times of day, and lays each of them out on all six
// views. It is the sweep that found "School Day" written across "Grocery
// Run" on the flat slot: a fault none of the fixtures had ever produced,
// on the payload the device was rendering that minute.
//
// Faults FAIL here, unlike the households report: these are the plugin's own
// example days, and a fault in one of them is a fault a new reader sees.
//
// ...AND SO DOES LOSING ANYTHING, WHICH IS WHAT THIS DID NOT ASK FOR A LONG
// TIME. A fault is a board that is WRONG -- two names on each other, a rail
// through a word. It is not the only way a board gets worse, and it is not
// even the common one: the common one is that something quietly stops being
// drawn. A caption shed, a person dropped, a caption that gave up the time
// under its name. None of those is a fault, none of them was asked about
// here, and the sweep went on printing "90/90 clean" through a change that
// shed four captions across these very boards. It reached a real panel.
//
// So every board's losses are recorded in baseline.json and compared, and
// the run fails when any of them gets worse. It is a ratchet, not a target:
// the numbers are what the boards happen to cost today, several of them are
// not zero, and the point is only that they never grow without somebody
// saying so.
//
//   node test/sweep/run.js --bless    write today's numbers as the baseline
//
// Bless deliberately, and never to make a red run green: read what moved
// first. A number that goes DOWN is a win and still needs blessing, which is
// the cost of the ratchet holding in the other direction.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '../..');
const B = require(path.join(ROOT, 'test/boards/board'));
const BoardM = require(path.join(ROOT, 'solver/board'));
const TRANSFORM = fs.readFileSync(path.join(ROOT, 'plugin/src/transform.js'), 'utf-8');

const SETS = ['simpsons', 'futurama', 'friends'];
const TIMES = ['07:30', '12:00', '16:30', '21:30', '23:40'];
const VIEWS = ['x-landscape', 'x-portrait', 'og-landscape',
               'og-half-horizontal', 'og-half-vertical', 'og-quadrant'];

const bless = process.argv.indexOf('--bless') > 0;
const only = process.argv.slice(2).filter((a) => a.charAt(0) !== '-')[0] || null;

const BASELINE = path.join(__dirname, 'baseline.json');
// WHAT A BOARD LOSES, as four numbers. Each is a thing the reader does not
// get: a caption that could not be placed, a person left off the map
// entirely, a caption drawn without the time under its name -- and how many
// captions were drawn at all, which is the one that has to go UP.
function losses(board) {
  const caps = board.caps || [];
  return {
    shed: board.shed || 0,
    dropped: (board.dropped || []).length,
    caps: caps.length,
    timed: caps.filter((c) => (c.rows || []).length >= 2).length,
  };
}
// Which way each one is allowed to move.
const WORSE = {
  shed: (was, now) => now > was,
  dropped: (was, now) => now > was,
  caps: (was, now) => now < was,
  timed: (was, now) => now < was,
};
const MEANS = {
  shed: 'caption(s) not placed', dropped: 'person/people off the board',
  caps: 'caption(s) drawn', timed: 'caption(s) with their time',
};

// The demo's own ICS and language files off disk: the sweep must not need the
// network, and what is on disk is what the next push puts on the server.
function served(url) {
  const m = /\/main\/(demo\/.*|i18n\/.*)$/.exec(String(url));
  const full = m && path.join(ROOT, m[1]);
  if (full && fs.existsSync(full)) {
    const text = fs.readFileSync(full, 'utf-8');
    return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) };
  }
  return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
}

async function payload(set, hm) {
  const [h, mi] = hm.split(':').map(Number);
  const now = Date.UTC(2026, 8, 15, h + 5, mi);   // America/Chicago in September
  class D extends Date {
    constructor(...a) { if (!a.length) super(now); else super(...a); }
    static now() { return now; }
  }
  const sb = { fetch: async (u) => served(u), console: { log() {}, warn() {}, error() {} },
               Date: D, Math, Array, Object, JSON, String, Number, Boolean, RegExp, Promise,
               Map, Set, AbortController, setTimeout, clearTimeout, URLSearchParams, Intl,
               module: { exports: {} } };
  vm.createContext(sb);
  vm.runInContext(TRANSFORM + '\nmodule.exports={run};', sb);
  const r = await sb.module.exports.run({
    trmnl: { system: { timestamp_utc: Math.floor(now / 1000) },
             user: { locale: 'en-US', time_zone_iana: 'America/Chicago' },
             plugin_settings: { instance_name: 'Metro', custom_fields_values:
               { use_demo_data: 'true', demo_set: set, time_format: '12h' } } } });
  return r.data;
}

(async () => {
  let boards = 0, bad = 0, slowest = 0, slowestAt = '';
  let was = {};
  try { was = JSON.parse(fs.readFileSync(BASELINE, 'utf-8')); } catch (e) { was = {}; }
  const now = {}, slipped = [];
  for (const set of SETS) {
    if (only && set.indexOf(only) < 0) continue;
    for (const hm of TIMES) {
      const metro = await payload(set, hm);
      if (!metro || !(metro.legend || []).length) {
        console.log('✗ ' + set + ' ' + hm + ': the example day came back empty');
        bad++;
        continue;
      }
      for (const v of VIEWS) {
        boards++;
        let rep;
        const t0 = Date.now();
        try { rep = B.build(metro, v); } catch (e) {
          console.log('✗ ' + set + ' ' + hm + ' ' + v + ': threw ' + e.message);
          bad++;
          continue;
        }
        const ms = Date.now() - t0;
        if (ms > slowest) { slowest = ms; slowestAt = set + ' ' + hm + ' ' + v; }
        // Recorded for every board, compared where there is something to
        // compare against. A board the baseline has never seen is recorded
        // and not judged -- a new view or a new example day is not a
        // regression in the ones that were already there.
        const key = set + ' ' + hm + ' ' + v;
        const lost = losses(rep.board);
        now[key] = lost;
        if (was[key]) {
          Object.keys(WORSE).forEach((k) => {
            if (was[key][k] == null || !WORSE[k](was[key][k], lost[k])) return;
            slipped.push(key + ': ' + k + ' ' + was[key][k] + ' -> ' + lost[k]
              + '  (' + MEANS[k] + ')');
          });
        }
        const faults = BoardM.check(rep.board);
        if (faults.length) {
          bad++;
          console.log('✗ ' + set + ' ' + hm + ' ' + v + ': '
            + faults.map((f) => f.kind + ' "' + (f.what || '') + '"'
              + (f.with ? ' / "' + f.with + '"' : '') + (f.by ? ' by ' + f.by : '')).join('; '));
        }
      }
    }
  }
  if (bless && !only) {
    const keys = Object.keys(now).sort();
    const out = {};
    keys.forEach((k) => { out[k] = now[k]; });
    fs.writeFileSync(BASELINE, JSON.stringify(out, null, 2) + '\n');
    console.log('\nblessed ' + keys.length + ' board(s) into ' + path.relative(ROOT, BASELINE));
  } else if (slipped.length) {
    console.log('\nWHAT THESE BOARDS STOPPED SHOWING:');
    slipped.forEach((m) => console.log('  ✗ ' + m));
    console.log('  ' + slipped.length + ' board(s) lost something. If it is meant, '
      + 'read it, then: node test/sweep/run.js --bless');
  }
  const totals = Object.keys(now).reduce((a, k) => {
    Object.keys(WORSE).forEach((x) => { a[x] = (a[x] || 0) + now[k][x]; });
    return a;
  }, {});
  console.log('\n' + (boards - bad) + '/' + boards + ' clean, slowest ' + slowest + 'ms (' + slowestAt + ')');
  console.log(totals.caps + ' caption(s) drawn, ' + totals.timed + ' with their time, '
    + totals.shed + ' shed, ' + totals.dropped + ' person/people dropped'
    + (only ? '  (subset: not compared)' : ''));
  process.exit(bad || (slipped.length && !bless) ? 1 : 0);
})();
