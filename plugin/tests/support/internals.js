'use strict';

// THE TRANSFORM'S INTERNAL FUNCTIONS, which have no entry point a runtime can
// call (parseConfig, feedUrl, migrateConfig...): pure logic, so a fresh copy
// of transform.js in a node vm context, with no network at all and Date
// pinned at `now` when one is given. Nothing that runs the transform comes
// through here; that is all `trmnlp test`.
//
// stdin is { now, body, args }: `body` is the body of a function (T, args),
// T being the internals, and stdout is the JSON of what it returns.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'transform.js'), 'utf-8');

let text = '';
process.stdin.on('data', (d) => { text += d; });
process.stdin.on('end', () => {
  const q = JSON.parse(text);
  const nowMs = q.now;
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
  vm.runInContext(SRC + '\nmodule.exports = { parseConfig, applyCalendarRules, parseIcs, fromEpoch, I18N, feedUrl, migrateConfig, configWarnings, hostOf, RENDER_BUDGET_MS };', sandbox);
  const fn = new Function('T', 'args', q.body);
  Promise.resolve(fn(sandbox.module.exports, q.args)).then((result) => {
    process.stdout.write(JSON.stringify({ result: result === undefined ? null : result }));
  }).catch((e) => { console.error(e && e.stack || e); process.exit(1); });
});
