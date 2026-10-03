'use strict';

// SIX INVENTED HOUSEHOLDS, THROUGH THE WHOLE PIPELINE.
//
//   trmnlp-test run households                       the feed checks and every board
//
// Each test/households/<slug>/ holds the ICS files a real household's feeds
// would serve and the config.json a careful user would write for them. This
// runs transform.js over them in trmnlp-test's runtime (each feed answered
// from the folder by the last segment of its URL, the language files from the
// repo, no weather) at several board times, and asks whether the payload says
// what the feeds say (an ended COUNT series is gone, an EXDATE holds, the
// bins are one stop...): those FAIL.
//
// The boards are the second half: every payload laid out on six views in the
// real page, with lines, shed, muddle, dropped lines and the board's own
// faults written into each test's annotations and the console. Shed, muddle
// and dropped lines are REPORTED -- these are invented households and a shed
// caption on one is information, not a regression. A FAULT FAILS, except the
// ones in KNOWN below.
//
// KNOWN: KEEP EVERY PERSON. On the smallest slots a household of five to
// seven lines cannot have every name clear of every other and everybody on
// the board; every way of clearing these names that was measured left a
// person off instead (MAINTENANCE.md). The owner chose the people: these six
// boards keep a name written on a name or a rail through one. They are shown
// (annotations) and do not fail; if one stops faulting it fails, so the list
// is taken down as boards get better, and any other fault fails at once.

const fs = require('fs');
const path = require('path');
const { test, expect } = require('trmnlp-test');
const { optionsFor } = require('../lib/transform');
const { render } = require('../lib/layout');
const layoutLib = require('../lib/layout');

const DIR = path.join(__dirname, '..', '..', 'households');
const KNOWN = {
  'multigen-chicago sat-0800 og-landscape': ['namecut:  / p1'],
  'multigen-chicago wed-0800 og-half-vertical': ['names:  / Zoe'],
  'multigen-chicago sat-0800 og-half-vertical': ['names: Eli / Zoe'],
  'multigen-chicago wed-0800 og-quadrant': ['names:  / Zoe'],
  'single-parent-be sat-0800 og-half-horizontal': ['names: Liesbeth / Fien'],
  'single-parent-be sat-0800 og-quadrant': ['namecut: L / p2'],
};
const SLUGS = fs.readdirSync(DIR).filter((d) => fs.existsSync(path.join(DIR, d, 'config.json'))).sort();

const TIMES = [
  { key: 'tue-0730', date: '2026-09-15', hm: '07:30' },
  { key: 'tue-1200', date: '2026-09-15', hm: '12:00' },
  { key: 'tue-1630', date: '2026-09-15', hm: '16:30' },
  { key: 'tue-2130', date: '2026-09-15', hm: '21:30' },
  { key: 'wed-0800', date: '2026-09-16', hm: '08:00' },
  { key: 'sat-0800', date: '2026-09-19', hm: '08:00' },
];
const OG = layoutLib.helpers.OG, X = layoutLib.helpers.X;
const VIEWS = [
  { name: 'x-landscape', classes: X },
  { name: 'x-portrait', classes: X + ' screen--portrait' },
  { name: 'og-landscape', classes: OG },
  { name: 'og-half-horizontal', page: 'half_horizontal', classes: OG },
  { name: 'og-half-vertical', page: 'half_vertical', classes: OG },
  { name: 'og-quadrant', page: 'quadrant', classes: OG },
];

// ---------------------------------------------------------------- transform

// Local wall-clock time in `tz` to epoch ms (two passes settle the offset).
function localToEpoch(date, hm, tz) {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = hm.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off = (ms) => {
    const p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
      .formatToParts(new Date(ms)).forEach((x) => { p[x.type] = x.value; });
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - ms;
  };
  const t1 = guess - off(guess);
  return guess - off(t1);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
// A feed is served by the last segment of its URL's path, from the
// household's own folder; a translation from the repo's i18n/.
function mocksFor(dir, cfg) {
  const mocks = [];
  const seen = {};
  (cfg.calendars || []).forEach((c) => {
    const u = typeof c === 'string' ? c : c.url;
    const base = decodeURIComponent(String(u).split('?')[0].split('/').pop() || '');
    const f = path.join(dir, base);
    if (!base.endsWith('.ics') || !fs.existsSync(f) || seen[base]) return;
    seen[base] = true;
    mocks.push({ url: '/\\/' + escapeRe(base.replace(/[^A-Za-z0-9._-]/g, encodeURIComponent)) + '(\\?.*)?$/', body: fs.readFileSync(f, 'utf-8') });
  });
  return mocks.concat(require('../lib/demo').demoMocks().filter((m) => /\/i18n\//.test(m.url)));
}

async function transformAt(trmnl, slug, t) {
  const dir = path.join(DIR, slug);
  const cfgText = fs.readFileSync(path.join(dir, 'config.json'), 'utf-8');
  const cfg = JSON.parse(cfgText);
  const tz = cfg.timeZone || 'UTC';
  const nowMs = localToEpoch(t.date, t.hm, tz);
  const input = {
    trmnl: {
      user: { locale: (cfg.locale || 'en').split('-')[0], time_zone_iana: tz },
      plugin_settings: { instance_name: 'Household', custom_fields_values: { use_demo_data: 'false', config_json: cfgText } },
    },
  };
  const run = await trmnl.transform(optionsFor(input, mocksFor(dir, cfg), nowMs));
  expect(run, slug + ' ' + t.key).toTransformCleanly();
  expect(run).toStayWithinServerlessLimits();
  // Payloads carry a clock in `now_min`; a JSON round trip hands the board
  // plain data, exactly what the template reads.
  return { data: JSON.parse(JSON.stringify(run.output.data)), cfg, dir };
}

// ---------------------------------------------------------------- payload helpers

function view(data) {
  const name = {};
  (data.legend || []).forEach((l) => { name[l.key] = l.name; });
  const who = (e) => [e.owner].concat(e.co_owners || []).map((k) => name[k] || k).sort();
  const events = (data.events || []).map((e) => Object.assign({}, e, { who: who(e) }));
  const allDay = (data.all_day || []).map((a) => Object.assign({}, a, { who: (a.owners || []).map((k) => name[k] || k).sort() }));
  return {
    data, events, allDay, lines: (data.legend || []).map((l) => l.name),
    find: (re, day) => events.filter((e) => re.test(e.title) && (day == null || Math.floor(e.start_min / 1440) === day)),
    findAllDay: (re, day) => allDay.filter((a) => re.test(a.title) && (day == null || (a.day || 0) === day)),
    holidays: data.holidays || [],
  };
}
function hhmm(min) { min = Math.round(min); const m = ((min % 1440) + 1440) % 1440; const d = Math.floor(min / 1440); return (d > 0 ? '+' + d + 'd' : d < 0 ? d + 'd' : '') + String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }

// ---------------------------------------------------------------- what the feeds say

// Each returns a list of [ok, message]. `at(key)` is the view of that time's payload.
const CHECKS = {
  'single-parent-be': (at) => {
    const v = at('tue-1630'), w = at('tue-2130'), s = at('sat-0800');
    const bins = v.find(/PMD|Papier|Glas/, 0);
    const out = [];
    out.push([bins.length === 1, 'bins due 19:00 merged into ONE stop (got ' + bins.length + ': ' + bins.map((b) => b.title + '@' + hhmm(b.start_min)).join(', ') + ')']);
    out.push([bins.length > 0 && bins[0].start_min === 19 * 60, 'bins at 19:00 wall clock despite Z (got ' + (bins[0] ? hhmm(bins[0].start_min) : '-') + ')']);
    out.push([bins.length > 0 && !!bins[0].todo && (bins[0].parts || []).length === 3, 'bins stop is a task with 3 parts (' + JSON.stringify(bins[0] && bins[0].parts) + ')']);
    out.push([v.find(/Restafval/, 0).length === 0, 'completed Restafval task (14 Sep) is absent']);
    out.push([v.find(/5A|6B|Technopolis/).length === 0 && v.findAllDay(/Technopolis/).length === 0, 'other classes (5A, 6B, 3C) hidden']);
    out.push([v.find(/^Zwemmen$/, 0).some((e) => e.who.join() === 'Jonas'), '5B Zwemmen -> Jonas, code stripped']);
    out.push([v.find(/^Bibliotheek$/, 0).some((e) => e.who.join() === 'Fien'), '2A Bibliotheek -> Fien']);
    out.push([v.find(/schoolfotograaf/i, 0).some((e) => e.who.join() === 'Fien,Jonas'), 'Alle klassen: schoolfotograaf shared by both kids']);
    out.push([v.find(/Teamoverleg/, 0).length === 1 && v.find(/Teamoverleg/, 0)[0].start_min === 690, 'RECURRENCE-ID moves Teamoverleg to 11:30 once']);
    out.push([v.find(/Kapper/).length === 0, 'cancelled Kapper hidden']);
    const woe = w.find(/Woensdagnamiddag/, 1);
    out.push([woe.length === 1 && woe[0].who.join() === 'Fien,Jonas', 'INTERVAL=2 Wednesday afternoon at papa appears tomorrow for both kids (21:30 board)']);
    // a week is a state of the line, at its head, not a stop on the clock
    const papa = s.findAllDay(/Kinderen bij Pieter/);
    out.push([papa.length >= 1 && s.find(/Kinderen bij Pieter/).length === 0, 'custody week that began Fri 18:00 (INTERVAL=2) is at the head of Saturday\'s board (got ' + papa.length + ')']);
    out.push([at('tue-1630').find(/Kinderen bij Pieter/, 0).length === 0, 'no custody block on an off week (Tue 15)']);
    return out;
  },
  'nurse-couple-uk': (at) => {
    const v = at('tue-1630'), m = at('tue-0730'), w = at('wed-0800');
    const out = [];
    const night = v.find(/Night/, 0);
    out.push([night.length === 1 && night[0].start_min === 19 * 60 + 30 && night[0].end_min === 1440 + 8 * 60, 'Tue night shift 19:30 -> Wed 08:00 spans midnight (got ' + night.map((n) => n.start_min + '-' + n.end_min).join() + ')']);
    out.push([w.find(/Night/).some((e) => e.start_min < 0 || e.start_min === 0 || e.end_min === 8 * 60), 'Wed 08:00 board still shows the night shift ending at 08:00 (it started yesterday)']);
    out.push([m.find(/Pilates/, 0).length === 1, 'Pilates COUNT=8 week 3 present']);
    out.push([m.find(/Spin/).length === 0, 'Spin class COUNT=8 (ended Aug) absent']);
    out.push([v.find(/Book club/, 0).length === 1, 'Book club BYDAY=3TU present on 15 Sep']);
    out.push([v.find(/Choir/).length === 0, 'Choir BYDAY=2TU absent on 15 Sep']);
    const su = m.find(/stand-up/i, 0);
    out.push([su.length === 1 && su[0].start_min === 9 * 60 + 45, 'stand-up moved to 09:45 by RECURRENCE-ID, once (got ' + su.map((e) => hhmm(e.start_min)).join() + ')']);
    out.push([v.find(/Marcus/).length === 0, 'cancelled 1:1 hidden']);
    out.push([at('sat-0800').find(/Early|LD|Long day/, 0).length >= 1, 'Sat early shift present']);
    out.push([at('tue-2130').find(/Football|5-a-side/).length === 0, '5-a-side past UNTIL absent']);
    return out;
  },
  'multigen-chicago': (at) => {
    const v = at('tue-1200'), s = at('sat-0800');
    const out = [];
    out.push([v.data.hour12 === true, '12h clock']);
    out.push([v.lines.length === 7, '7 lines (got ' + v.lines.join(',') + ')']);
    out.push([v.find(/^Piano/, 0).some((e) => e.who.join() === 'Mia'), 'Mia: Piano routed to Mia and prefix stripped']);
    out.push([v.find(/Cardiology/, 0).some((e) => e.who.join() === 'Walt'), 'Grandpa: routed to Walt']);
    out.push([v.find(/^(Mia|Eli|Zoe|Grandpa|Grandma|Mom|Dad|Everyone)\b.*:/).length === 0, 'no name prefix left in any title (' + v.find(/^[A-Z][a-z]+( & [A-Z][a-z]+)?:/).map((e) => e.title).join(' | ') + ')']);
    out.push([v.find(/PT|Physical therapy/i, 0).length === 1, 'Grandma PT COUNT=12 still running on 15 Sep']);
    const dinner = s.find(/Aunt Carol/, 0);
    out.push([dinner.length === 1 && dinner[0].who.length === 7, 'Everyone: dinner shared by all 7']);
    out.push([at('tue-2130').find(/Dentist/, 1).some((e) => e.who.join() === 'Eli,Mia'), 'Mia & Eli: Dentist shared by the two']);
    out.push([at('tue-1630').find(/Rx|prescription/i, 0).length === 1, 'Rx pickup task present']);
    return out;
  },
  'flatshare-berlin': (at) => {
    const v = at('tue-1200'), w = at('tue-2130'), s = at('sat-0800');
    const out = [];
    const tob = v.events.filter((e) => e.who.indexOf('Tobias') >= 0);
    out.push([(v.lines.indexOf('Tobias') >= 0) === (tob.length > 0), 'Tobias (hideIfEmpty) in the legend only when he has something today or tomorrow (lines ' + v.lines.join(',') + '; his: ' + tob.map((e) => e.title).join(',') + ')']);
    out.push([s.lines.indexOf('Tobias') >= 0, 'Tobias present on Saturday']);
    const party = w.find(/Party/i, 1);
    out.push([party.length === 1 && party[0].who.length >= 3, 'WG-Party tomorrow is one shared event (got ' + party.map((p) => p.who.join('+')).join(' | ') + ')']);
    out.push([v.find(/.*/, 0).filter((e) => e.who.join() === 'Moritz').length >= 6, 'Moritz has his 6 back-to-back lectures']);
    out.push([v.allDay.some((a) => /Küche|Putz/.test(a.title)) || v.find(/Putz|Küche/).length > 0, 'chores rotation (multi-day all-day, INTERVAL=4, series began in July) shows this week']);
    out.push([w.find(/Homeoffice/, 1).length === 1, 'weekday rule (WE) rewrites tomorrow\'s Werkstudentin block as Homeoffice']);
    out.push([v.find(/Werkstudentin|Homeoffice/, 0).every((e) => /Werkstudentin/.test(e.title)), 'weekday rule (WE) does not fire on Tuesday']);
    out.push([v.find(/Lerngruppe/).length === 0, 'cancelled Lerngruppe hidden']);
    return out;
  },
  'remote-freelance-lyon': (at) => {
    const v = at('tue-1200');
    const out = [];
    const noisy = v.events.filter((e) => /\[(Teams|Zoom)\]|^(RE|TR|FW)\s*:|zoom\.us|\[[A-Z]+-\d+\]/i.test(e.title));
    out.push([noisy.length === 0, 'no [Teams]/[Zoom]/RE:/ticket noise left in titles (' + noisy.map((e) => e.title).join(' | ') + ')']);
    out.push([v.find(/Focus|Pause café/).length === 0, 'Focus time and coffee hidden']);
    out.push([v.find(/Annulé|Point de fin de journée/).length === 0, 'cancelled meeting hidden']);
    const hq = v.find(/London HQ/, 0);
    out.push([hq.length === 1 && hq[0].start_min === 14 * 60 + 30, 'London HQ sync written in "GMT Standard Time" lands at 14:30 Paris (got ' + hq.map((e) => hhmm(e.start_min)).join() + ')']);
    const dog = v.find(/Biscuit/, 0);
    out.push([dog.length === 1 && dog[0].who.length === 2, 'dog walker shared by both']);
    out.push([v.events.filter((e) => e.who.join() === 'Camille' && e.start_min < 1440).length >= 10, 'Camille has 10+ meetings today (' + v.events.filter((e) => e.who.join() === 'Camille' && e.start_min < 1440).length + ')']);
    out.push([v.events.filter((e) => e.who.join() === 'Julien' && e.start_min < 1440).length >= 10, 'Julien has 10+ meetings today (' + v.events.filter((e) => e.who.join() === 'Julien' && e.start_min < 1440).length + ')']);
    const su = v.find(/Standup client ACME/, 0);
    out.push([su.length === 1 && su[0].start_min === 8 * 60 + 15, 'ACME standup moved to 08:15 by RECURRENCE-ID']);
    return out;
  },
  'family-five-nl': (at) => {
    const v = at('tue-1630'), n = at('tue-2130'), w = at('wed-0800'), s = at('sat-0800');
    const out = [];
    out.push([v.holidays.some((h) => /Prinsjesdag/.test(h.title) && h.day === 0), 'Prinsjesdag in the header on 15 Sep (' + JSON.stringify(v.holidays) + ')']);
    out.push([v.lines.indexOf('Pim') >= 0, 'quiet toddler Pim kept (hideIfEmpty false)']);
    const sw = v.findAllDay(/Studieweek|vrij/i, 0);
    out.push([sw.length > 0 && sw.every((a) => a.who.join() === 'Daan,Lotte') && !v.holidays.some((h) => /Studie/.test(h.title)), 'school week off at Daan and Lotte\'s heads, not the header (' + JSON.stringify(sw.map((a) => [a.title, a.who])) + ')']);
    const film = n.find(/Film/, 0);
    out.push([film.length === 1 && film[0].end_min > 1440, 'teen film crosses midnight (end ' + (film[0] && film[0].end_min) + ')']);
    out.push([w.findAllDay(/Riet/, 0).length > 0 || w.find(/Riet/, 0).length > 0, 'yearly birthday (2016 series) on 16 Sep']);
    const trip = s.findAllDay(/Kempervennen|Center Parcs/, 0);
    out.push([trip.length > 0, 'multi-day trip on Saturday']);
    out.push([s.find(/Hockeywedstrijd/, 0).length === 0, 'EXDATE removes Saturday hockey match during the trip']);
    out.push([s.events.some((e) => /Feest/.test(e.title) && e.end_min > 1440), 'Saturday party crosses midnight']);
    out.push([v.lines.length === 5, '5 lines, no leaked calendar line (' + v.lines.join(',') + ')']);
    return out;
  },
};

// ---------------------------------------------------------------- the feed checks

for (const slug of SLUGS) {
  test('households · ' + slug + ' · the payload says what the feeds say', async ({ trmnl }) => {
    const payloads = {};
    for (const t of TIMES) {
      const r = await transformAt(trmnl, slug, t);
      payloads[t.key] = r.data;
      const d = r.data;
      expect.soft(d.calendars_down || [], slug + ' ' + t.key + ': calendars down').toEqual([]);
      expect.soft(d.demo_partial, slug + ' ' + t.key + ': transform fell back to the demo').toBeUndefined();
      const missing = (r.cfg.calendars || []).map((c) => (typeof c === 'string' ? c : c.url))
        .filter((u) => !fs.existsSync(path.join(r.dir, decodeURIComponent(u.split('?')[0].split('/').pop()))));
      expect.soft(missing, slug + ': config names feeds with no local file').toEqual([]);
    }
    const fn = CHECKS[slug];
    if (!fn) return;
    const results = fn((k) => {
      if (!payloads[k]) throw new Error('no payload for ' + k);
      return view(payloads[k]);
    });
    for (const [ok, msg] of results) {
      console.log((ok ? '  ok   ' : '  FAIL ') + slug + ': ' + msg);
      expect.soft(ok, slug + ': ' + msg).toBe(true);
    }
  });
}

// ---------------------------------------------------------------- the boards, reported

for (const slug of SLUGS) {
  for (const t of TIMES) {
    test('households · ' + slug + ' · ' + t.key + ' · every board', async ({ trmnl }, testInfo) => {
      const r = await transformAt(trmnl, slug, t);
      const d = r.data;
      const nameOf = {};
      (d.legend || []).forEach((l) => { nameOf[l.key] = l.name; });
      layoutLib.useTrmnl(trmnl);
      for (const v of VIEWS) {
        const rep = await render(d, v);
        const dbg = rep.debug;
        const row = { view: v.name, lines: (d.legend || []).length, shed: dbg.shed || 0, muddle: dbg.muddle || 0,
          dropped: (dbg.dropped || []).map((k) => nameOf[k] || k), faults: dbg.faults || [] };
        const line = slug + ' ' + t.key + ' ' + v.name + ': ' + JSON.stringify(row);
        console.log(line);
        testInfo.annotations.push({ type: 'board', description: line });
        const key = slug + ' ' + t.key + ' ' + v.name;
        if (KNOWN[key]) {
          testInfo.annotations.push({ type: 'known fault', description: key + ': ' + KNOWN[key].join('; ') });
          expect.soft(row.faults, key + ' no longer has its known fault: take it out of KNOWN').toEqual(KNOWN[key]);
        } else {
          expect.soft(row.faults, key + ': the board knows it is wrong').toEqual([]);
        }
      }
    });
  }
}
