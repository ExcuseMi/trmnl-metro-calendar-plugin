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

const only = process.argv[2] || null;

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
  console.log('\n' + (boards - bad) + '/' + boards + ' clean, slowest ' + slowest + 'ms (' + slowestAt + ')');
  process.exit(bad ? 1 : 0);
})();
