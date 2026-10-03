'use strict';

// THE TRANSFORM SUITE'S HARNESS, ON trmnlp-test.
//
// test/transform/run.js loaded transform.js into a node vm per test, with a
// fake Date and a fake fetch. trmnlp-test runs it the way TRMNL does: trmnlp's
// own node wrapper as a subprocess, the clock frozen by libfaketime (and
// running forward from there, as a real one does), every HTTP(S) request
// through a mock proxy, the hosted 5s/128MB limits, and the output parsed off
// the sink the hosted runtime reads. A case still says
//
//   const { run } = runTransform(mocks, NOW, log);
//   const r = await run(baseInput(NOW, fields));   // -> { data, trmnl_state }
//
// but `mocks` is a trmnlp-test mock list now, not a function: each answer is
// written down per URL (see serve/status/icsMock below), the requests that
// were made are on `r` (requestsOf), and a slow server is `delayMs`.
//
// Only the transform's internal functions, which no runtime can call on their
// own, are loaded into a node vm (`internals`).

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test } = require('trmnlp-test');

const ROOT = path.join(__dirname, '..', '..', '..');
const TRANSFORM_PATH = path.join(ROOT, 'plugin', 'src', 'transform.js');
const TRANSFORM_SRC = fs.readFileSync(TRANSFORM_PATH, 'utf-8');

// The trmnl fixture of the test that is running, set by `cases()`.
const ctx = { trmnl: null };

// ---------------------------------------------------------------- mocks

// A mock answering `url` with `text` (or a JSON value), 200.
function serve(url, body, extra) {
  const m = typeof body === 'string' ? { url, body } : { url, json: body };
  return Object.assign(m, extra || {});
}
// A mock answering `url` with an error status.
function status(url, code, extra) { return Object.assign({ url, status: code, body: '' }, extra || {}); }

// What the old fake fetch did for anything it was not told about: a 404.
const ELSE_404 = { url: '*', status: 404, body: '' };
// The forecast and the language files, the two hosts nearly every case
// wants answered one way or the other.
const FORECAST = 'https://api.open-meteo.com/v1/forecast*';
// Everything not answered by an earlier mock (a calendar feed, say), answered
// with `body` or, given a number, that status.
function otherwise(bodyOrStatus, extra) {
  const m = typeof bodyOrStatus === 'number' ? { status: bodyOrStatus, body: '' } : { body: bodyOrStatus };
  return Object.assign({ url: ELSE_404.url }, m, extra || {});
}
const I18N = 'https://raw.githubusercontent.com/ExcuseMi/trmnl-metro-calendar-plugin/main/i18n/*';

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

// input.trmnl.system.timestamp_utc is set to match the clock the case runs
// at, as before. (The hosted runtime does not hand `system` to a transform,
// and trmnlp-test does not either, so transform.js reads the frozen clock.)
function baseInput(nowMs, customFields) {
  return {
    trmnl: {
      system: { timestamp_utc: Math.floor(nowMs / 1000) },
      user: { locale: 'en', time_zone_iana: 'UTC' },
      plugin_settings: { instance_name: 'Test', custom_fields_values: Object.assign({ use_demo_data: 'false' }, customFields) },
    },
  };
}

// ---------------------------------------------------------------- running

// THE PREVIOUS RENDER'S OUTPUT. TRMNL hands a transform
// `input.trmnl.previous_merge_variables` (help.trmnl.com, saved state), and
// transform.js replays a failed feed's day from it: a case's
// `input.trmnl.previous_merge_variables` goes in as trmnlp-test's
// `previousMergeVariables`.
//
// THE FORM'S DEFAULTS, AS A CASE NEVER SAW THEM. The cases were written
// against an input carrying only the fields they name -- a device whose form
// predates a field -- and the hosted form's defaults make a different board:
// with `setup_mode` defaulting to `links`, a case's config_json is never read
// at all. So the settings.yml defaults are left out (`fieldDefaults: false`).

// A case's input as trmnlp-test transform options.
function optionsFor(input, mocks, nowMs, more) {
  const t = (input && input.trmnl) || {};
  const ps = t.plugin_settings || {};
  const data = {};
  Object.keys(input || {}).forEach((k) => { if (k !== 'trmnl') data[k] = input[k]; });
  const settings = {};
  Object.keys(ps).forEach((k) => { if (k !== 'custom_fields_values') settings[k] = ps[k]; });
  const o = {
    now: nowMs, trmnlpYml: false, data,
    fields: ps.custom_fields_values || {}, fieldDefaults: false,
    trmnl: { user: t.user || {}, plugin_settings: settings },
    mocks: mocks.concat([ELSE_404]),
  };
  if (Object.prototype.hasOwnProperty.call(t, 'state')) o.state = t.state;
  if (t.previous_merge_variables !== undefined) o.previousMergeVariables = t.previous_merge_variables;
  return Object.assign(o, more || {});
}

// The transform's own console, as lines (it writes to stdout and stderr).
function linesOf(res) {
  return (String(res.stdout || '') + '\n' + String(res.stderr || '')).split('\n').filter((l) => l.trim());
}

const RUNS = new WeakMap();
// What a run asked for: [{ method, url, mocked, status }].
function requestsOf(output) { const r = RUNS.get(output); return r ? r.requests : []; }
function runOf(output) { return RUNS.get(output); }

// runTransform(mocks, nowMs, log) -> { run(input) }, run() resolving to what
// the transform returned. A transform that errored, timed out or printed no
// JSON is a failed test, with its stderr.
function runTransform(mocks, nowMs, log, more) {
  if (typeof mocks === 'function') throw new Error('runTransform takes a mock list (serve, status, otherwise...), not a fetch function');
  if (typeof nowMs !== 'number') throw new Error('runTransform takes a fixed clock (ms)');
  return {
    run: async (input) => {
      const res = await ctx.trmnl.transform(optionsFor(input, mocks || [], nowMs, more));
      if (log) linesOf(res).forEach((l) => log.push(l));
      if (!res.ran || res.error || !res.output) {
        throw new Error('the transform failed: ' + (res.error || res.reason || 'no output') + '\n' + String(res.stderr || '').slice(-1500));
      }
      RUNS.set(res.output, res);
      return res.output;
    },
  };
}

// ---------------------------------------------------------------- the old harness

// THE TRANSFORM'S INTERNAL FUNCTIONS, which have no entry point a runtime can
// call (parseConfig, feedUrl, migrateConfig...): pure logic, so a fresh copy
// of transform.js in a node vm context, with no network at all and Date
// pinned at `nowMs` when one is given. Nothing that runs the transform comes
// through here; that is all trmnlp-test.
function internals(nowMs) {
  const RealDate = Date;
  const FakeDate = class extends RealDate {
    constructor(...args) { if (args.length === 0) super(nowMs); else super(...args); }
    static now() { return nowMs; }
  };
  const sandbox = {
    fetch: async () => { throw new Error('no network here'); },
    console: { log() {}, warn() {}, error() {} },
    Date: nowMs != null ? FakeDate : Date,
    Math, Array, Object, JSON, String, Number, Boolean, RegExp, Promise, Map, Set,
    AbortController, setTimeout, clearTimeout, URLSearchParams, Intl,
    module: { exports: {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(TRANSFORM_SRC + '\nmodule.exports = { parseConfig, applyCalendarRules, parseIcs, fromEpoch, I18N, feedUrl, migrateConfig, configWarnings, hostOf, RENDER_BUDGET_MS };', sandbox);
  return sandbox.module.exports;
}

// ---------------------------------------------------------------- shared helpers

// The payload carries `events` and `weather` as two lists now. This stays,
// because every case that uses it wants "the events" and should not have to
// know which key they arrived under.
function eventItems(data) { return (data.events || []).slice(); }

// WHAT THE BOARD MAKES OF THE PAYLOAD. Order, side, the anchor and the badges
// are the solver's now (solver/order.js), not transform's; the cases that
// were about those answers run the two together.
const Order = require('../../../solver/order');
function arranged(data) { return Order.arrange(data.legend || [], data.events || []); }
// WHERE THE BOARD OPENS, which is the solver's too: `day.js opened()`.
const Day = require('../../../solver/day');
function opened(data) { return Day.opened(data).day_start_min; }

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error((msg ? msg + ': ' : '') + 'expected ' + e + ', got ' + a);
}

const { demoMocks } = require('./demo');

const helpers = {
  runTransform, requestsOf, runOf, serve, status, otherwise, ELSE_404, FORECAST, I18N, demoMocks,
  internals,
  icsWithEvents, baseInput, eventItems, arranged, opened, assert, assertEqual,
  transformPath: TRANSFORM_PATH,
};

// Each case module is one describe block named after its file.
function cases(name, body) {
  test.describe(name, () => {
    const t = (title, fn, opts) => {
      test(title, async ({ trmnl }) => {
        if (opts && opts.known) test.fail(true, opts.known);
        ctx.trmnl = trmnl;
        await fn();
      });
    };
    body(t, helpers);
  });
}

module.exports = { cases, helpers, optionsFor, ctx };
