'use strict';

// Regression tests for metro-plugin/src/transform.js's CONFIG HANDLING —
// parseConfig, the rule/matcher engine (compileMatcher/compileRule/
// applyCalendarRules), and the ICS parsing pieces that feed it (RRULE
// bounded-weekly matching, RECURRENCE-ID override dedup). This does NOT
// cover the metro-map layout/geometry itself (that's all client-side in
// shared.liquid, untestable here) or demo-data rendering.
//
// Adapted from ../../test/transform/run.js (the other plugin's own
// harness) — same vm-sandbox-per-test-file technique, same fake-Date
// approach for pinning "today" across a run() call, trimmed to what this
// plugin's simpler single-day `run(input) -> {metro, trmnl_state}` shape
// needs (no days[], no multi-day windows).
//
// Run with: npm test  (from this directory) — no Docker needed.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TRANSFORM_PATH = process.env.TRANSFORM_PATH
  || path.join(__dirname, '../../plugin/src/transform.js');

const TRANSFORM_SRC = fs.readFileSync(TRANSFORM_PATH, 'utf-8');

// A Date subclass fixed at `ms` for `new Date()` / `Date.now()` — lets a
// test pin "today" precisely (RRULE weekly-match, RECURRENCE-ID dedup are
// both date-sensitive) without waiting on the real clock.
function makeFakeDate(getNowMs) {
  const RealDate = Date;
  return class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(getNowMs());
      else super(...args);
    }
    static now() { return getNowMs(); }
  };
}

// Loads a fresh copy of transform.js into its own vm context (module-level
// caches like _safeZoneCache never leak between calls/tests), with
// `fetchImpl` standing in for the real network and, if `nowMs` is given,
// Date/Date.now() pinned for every call made against the returned `run`/
// `parseConfig`.
//
// `nowMs` may also be a FUNCTION, which is how the deadline tests work:
// transform.js budgets every fetch against `deadline - Date.now()`, so a
// test that wants to see what happens when the budget runs out has to be
// able to move the clock from inside a fake fetch. Waiting out the real
// 4.2s deadline instead would put four wasted seconds into every run.
function runTransform(fetchImpl, nowMs) {
  const clock = typeof nowMs === 'function' ? nowMs : (nowMs != null ? () => nowMs : null);
  const sandbox = {
    fetch: fetchImpl,
    console,
    Date: clock ? makeFakeDate(clock) : Date,
    Math, Array, Object, JSON, String, Number, Boolean, RegExp, Promise, Map, Set,
    AbortController, setTimeout, clearTimeout, URLSearchParams, Intl,
    module: { exports: {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(TRANSFORM_SRC + '\nmodule.exports = { run, parseConfig, applyCalendarRules, parseIcs, fromEpoch, I18N, feedUrl, migrateConfig, configWarnings };', sandbox);
  return sandbox.module.exports;
}

function icsWithEvents(events) {
  let s = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\n';
  for (const e of events) {
    s += 'BEGIN:VEVENT\r\nUID:' + (e.uid || Math.random()) + '\r\nDTSTAMP:20260101T000000Z\r\n';
    if (e.recurrenceId) s += 'RECURRENCE-ID:' + e.recurrenceId + '\r\n';
    s += 'DTSTART:' + e.start + '\r\nDTEND:' + e.end + '\r\n';
    if (e.rrule) s += 'RRULE:' + e.rrule + '\r\n';
    if (e.exdate) s += 'EXDATE:' + e.exdate + '\r\n';
    s += 'SUMMARY:' + e.summary + '\r\n';
    if (e.description) s += 'DESCRIPTION:' + e.description + '\r\n';
    if (e.location) s += 'LOCATION:' + e.location + '\r\n';
    // Written raw: a case testing how a list value is split needs to be
    // able to put an escaped comma in one.
    if (e.categories) s += 'CATEGORIES:' + e.categories + '\r\n';
    if (e.status) s += 'STATUS:' + e.status + '\r\n';
    if (e.location) s += 'LOCATION:' + e.location + '\r\n';
    s += 'END:VEVENT\r\n';
  }
  s += 'END:VCALENDAR\r\n';
  return s;
}

function okText(text) { return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) }; }
function fail(status) { return { ok: false, status, text: async () => '', json: async () => ({}) }; }

// input.trmnl.system.timestamp_utc must be set explicitly to match the
// fake-Date `nowMs` passed to runTransform() — Date.now() out here (this
// file, not the vm sandbox) is the real wall clock, not the pinned one.
function baseInput(nowMs, customFields) {
  return {
    trmnl: {
      system: { timestamp_utc: Math.floor(nowMs / 1000) },
      user: { locale: 'en', time_zone_iana: 'UTC' },
      plugin_settings: { instance_name: 'Test', custom_fields_values: Object.assign({ use_demo_data: 'false' }, customFields) },
    },
  };
}

// The payload carries `events` and `weather` as two lists now. This stays,
// because every case that uses it wants "the events" and should not have to
// know which key they arrived under.
function eventItems(data) { return (data.events || []).slice(); }

// ---------------------------------------------------------------------------- tiny test runner

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error((msg ? msg + ': ' : '') + 'expected ' + e + ', got ' + a);
}

// WHAT THE BOARD MAKES OF THE PAYLOAD.
//
// Order, side, the anchor and the badges are the solver's now (solver/
// order.js), not transform's: transform sends what the household said and the
// arrangement is a fact about a drawing. The cases that were about those
// answers are still about them, so they run the two together rather than
// moving to a suite that cannot see a calendar.
const Order = require('../../solver/order');

// THE DEMO'S OWN FILES, SERVED FROM THE REPO.
//
// The demo board is a config and a set of ICS files in demo/<show>/, fetched
// at run time from raw.githubusercontent -- the config included, since it
// stopped being a copy embedded in transform.js. So any case that exercises
// the demo has to serve both, and this is the one place that knows how.
// `missing` names files to withhold, which is how the stale-feed and
// feed-down cases are written.
function demoNet(missing, otherwise) {
  const DEMO_DIR = path.join(__dirname, '../../demo');
  return async (url) => {
    const u = String(url);
    if (u.indexOf('/main/demo/') >= 0) {
      const rel = u.split('/main/demo/').pop();
      const full = path.join(DEMO_DIR, rel);
      if ((missing || []).indexOf(rel) >= 0 || !fs.existsSync(full)) return fail(404);
      return okText(fs.readFileSync(full, 'utf-8'));
    }
    return otherwise ? otherwise(url) : fail(404);
  };
}
function arranged(data) { return Order.arrange(data.legend || [], data.events || []); }

// WHERE THE BOARD OPENS, which is the solver's too: transform sends both days
// from this day's own midnight and `day.js opened()` picks the start against
// the clock the payload carries. A case that used to read `rolling.start_min`
// off the payload asks this instead.
const Day = require('../../solver/day');
function opened(data) { return Day.opened(data).day_start_min; }

const helpers = { runTransform, icsWithEvents, okText, fail, baseInput, eventItems, arranged, opened, demoNet, assert, assertEqual };

for (const file of fs.readdirSync(path.join(__dirname, 'cases')).sort()) {
  if (!file.endsWith('.js')) continue;
  require(path.join(__dirname, 'cases', file))(test, helpers);
}

async function main() {
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log('✓ ' + t.name);
    } catch (e) {
      console.error('✗ ' + t.name + ': ' + e.message);
      failed++;
    }
  }
  console.log('\n' + (tests.length - failed) + '/' + tests.length + ' passed');
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal: ' + (err && err.stack || err));
  process.exit(1);
});
