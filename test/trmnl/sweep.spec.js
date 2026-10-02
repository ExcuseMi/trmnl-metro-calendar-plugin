'use strict';

// THE BOARDS THE DEVICE ACTUALLY DRAWS, ACROSS EVERY VIEW.
//
//   trmnlp-test run sweep                 every board
//   trmnlp-test run sweep -g futurama     one example day
//   trmnlp-test run sweep -u              write today's numbers as the baseline
//
// The other suites ask about boards somebody wrote down: the layout specs lay
// out fixtures, the households report lays out six invented households. This
// one takes the three example days the plugin ships -- the same payloads a
// reader with no calendars sees -- through the real transform (trmnlp's own
// node wrapper, the demo's files answered from disk), at five times of day,
// and draws each on all six views in trmnlp-test's Chromium. It is the sweep
// that found "School Day" written across "Grocery Run" on the flat slot: a
// fault none of the fixtures had ever produced, on the payload the device was
// rendering that minute.
//
// IN THE REAL PAGE, NOT IN JSDOM. It used to lay the payloads out in node
// with test/boards' width table, and printed "90/90 clean". Drawn in the real
// page with the real faces, the same payloads disagreed on 27 of the 90
// boards (fewer captions keeping their time on the OG, a person dropped on a
// half slot) and SIX X-landscape boards, the view this plugin is designed for,
// carry `onbar` faults the jsdom board never had. The old layout harness, in
// its own headless Chromium, reports the same faults on the same payloads, so
// it is the page and not this harness. The losses baseline was re-blessed from
// the real page when the sweep moved (the jsdom numbers measured a different
// board); the faults were left failing, because they are what a reader sees.
//
// ONE BOARD USED TO FLIP between two answers from run to run (simpsons
// 07:30 og-half-horizontal): the feeds were read in whichever order they
// answered, so the same day made a different payload. They are read in the
// config's order now (transform/order.spec.js), and the console line still
// prints `runs`, how many times the page laid the board out.
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
// So every board's losses are recorded in sweep.baseline.json and compared,
// and a board fails when any of them gets worse. It is a ratchet, not a
// target: the numbers are what the boards happen to cost today, several of
// them are not zero, and the point is only that they never grow without
// somebody saying so.
//
// Bless (-u) deliberately, and never to make a red run green: read what moved
// first. A number that goes DOWN is a win and still needs blessing, which is
// the cost of the ratchet holding in the other direction.

const fs = require('fs');
const path = require('path');
const { test, expect, matrix } = require('trmnlp-test');
const { demoMocks, NOT_FOUND } = require('./lib/demo');
const { PAGE, report } = require('./lib/page');

const SETS = ['simpsons', 'futurama', 'friends'];
const TIMES = ['07:30', '12:00', '16:30', '21:30', '23:40'];
const VIEWS = {
  'x-landscape': { device: 'v2', view: 'full' },
  'x-portrait': { device: 'v2', view: 'full', orientation: 'portrait' },
  'og-landscape': { device: 'og_png', view: 'full' },
  'og-half-horizontal': { device: 'og_png', view: 'half_horizontal' },
  'og-half-vertical': { device: 'og_png', view: 'half_vertical' },
  'og-quadrant': { device: 'og_png', view: 'quadrant' },
};

const BASELINE = path.join(__dirname, 'sweep.baseline.json');

// WHAT A BOARD LOSES, as four numbers. Each is a thing the reader does not
// get: a caption that could not be placed, a person left off the map
// entirely, a caption drawn without the time under its name -- and how many
// captions were drawn at all, which is the one that has to go UP. Read off
// the page: the solver's own record for the first two, the drawn captions
// (`.metro-label`, and whether each carries its clock) for the others.
function losses(rep) {
  const caps = rep.labels.filter((l) => (' ' + l.cls + ' ').indexOf(' metro-label ') >= 0);
  return {
    shed: rep.debug.shed || 0,
    dropped: (rep.debug.dropped || []).length,
    caps: caps.length,
    timed: caps.filter((l) => !!l.timeCls).length,
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

// The baseline is one file and the boards run in parallel: a blessing worker
// rewrites its own entry under a lock.
function bless(key, lost) {
  const lock = BASELINE + '.lock';
  for (let i = 0; i < 400; i++) {
    try { fs.closeSync(fs.openSync(lock, 'wx')); break; } catch (e) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25); }
  }
  try {
    let all = {};
    try { all = JSON.parse(fs.readFileSync(BASELINE, 'utf-8')); } catch (e) { all = {}; }
    all[key] = lost;
    const out = {};
    Object.keys(all).sort().forEach((k) => { out[k] = all[k]; });
    fs.writeFileSync(BASELINE, JSON.stringify(out, null, 2) + '\n');
  } finally {
    try { fs.unlinkSync(lock); } catch (e) { /* gone */ }
  }
}

const MOCKS = demoMocks().concat([NOT_FOUND]);

for (const s of matrix({ set: SETS, time: TIMES, on: Object.keys(VIEWS) })) {
  const key = s.set + ' ' + s.time + ' ' + s.on;
  test('sweep · ' + key, async ({ trmnl }, testInfo) => {
    const [h, mi] = s.time.split(':').map(Number);
    const screen = await trmnl.render(Object.assign({}, VIEWS[s.on], {
      // America/Chicago in September is UTC-5
      now: Date.UTC(2026, 8, 15, h + 5, mi), timeZone: 'America/Chicago', locale: 'en-US',
      instanceName: 'Metro', trmnlpYml: false, data: {}, ...PAGE,
      fields: { use_demo_data: 'true', demo_set: s.set, time_format: '12h' },
      mocks: MOCKS,
    }));
    expect(screen.transform).toTransformCleanly();
    expect(screen.transform).toStayWithinServerlessLimits();
    const metro = screen.data && screen.data.data;
    expect((metro && metro.legend || []).length, 'the example day came back empty').toBeGreaterThan(0);
    const rep = await report(screen);

    const lost = losses(rep);
    const updating = !['missing', 'none'].includes(testInfo.config.updateSnapshots);
    if (updating) bless(key, lost);
    let was = null;
    try { was = JSON.parse(fs.readFileSync(BASELINE, 'utf-8'))[key] || null; } catch (e) { was = null; }
    // A board the baseline has never seen is recorded (-u) and not judged:
    // a new view or a new example day is not a regression in the ones that
    // were already there.
    const slipped = [];
    if (was && !updating) {
      Object.keys(WORSE).forEach((k) => {
        if (was[k] == null || !WORSE[k](was[k], lost[k])) return;
        slipped.push(k + ' ' + was[k] + ' -> ' + lost[k] + '  (' + MEANS[k] + ')');
      });
    }
    console.log((slipped.length || rep.debug.faults.length ? 'FAIL ' : 'ok   ') + key.padEnd(36) + ' runs ' + rep.debug.runs + ' ' + JSON.stringify(lost)
      + (was ? ' was ' + JSON.stringify(was) : '') + (rep.debug.faults.length ? ' faults ' + JSON.stringify(rep.debug.faults) : ''));
    testInfo.annotations.push({ type: 'losses', description: JSON.stringify(lost) + (was ? ' baseline ' + JSON.stringify(was) : ' (no baseline)') });
    expect.soft(rep.debug.faults, key + ': the board knows it is wrong').toEqual([]);
    expect(slipped, key + ' lost something. If it is meant, read it, then: trmnlp-test run sweep -u').toEqual([]);
  });
}
