'use strict';

// THE WIDTH TABLE MATCHES THE PAGE.
//
// test/boards/metrics.json is how every node-side layout (test/boards,
// solver tools) knows how wide a word is. It is a measurement, and a stale one
// is worse than none: the node suites lay out a board the panel never draws
// and pass it. When the sweep moved into the real page it disagreed with the
// jsdom sweep on 27 of 90 boards, and the table turned out to be out of date
// (calibrate.js, run again, rewrote most of the OG's large face).
//
// So the table is checked here against the page TRMNL renders, on the OG
// (1-bit) and the X, and `trmnlp-test run metrics -u` rewrites it (that is
// what test/boards/calibrate.js runs now).

const fs = require('fs');
const path = require('path');
const { test, expect, config } = require('trmnlp-test');
const { HEAD, report } = require('./lib/page');
const { CLASSES, measure } = require('./lib/metrics-probe');
const fixtures = require('../layout/fixtures');

const FILE = path.join(config.root, 'test', 'boards', 'metrics.json');
const DEVICES = { og: 'og_png', x: 'v2' };
// a hundredth of a pixel: the advances are fractional, rounded to 1/1000
const TOL = 0.01;

test.describe.configure({ mode: 'serial' });
const measured = {};

for (const [dev, device] of Object.entries(DEVICES)) {
  test('the width table is what the page measures · ' + dev, async ({ trmnl }, testInfo) => {
    const metro = fixtures.find((f) => f.name === 'busy-day').metro;
    const screen = await trmnl.render({ device, data: { data: metro }, transform: false, trmnlpYml: false, head: HEAD });
    await report(screen);                    // the faces are in and the board has settled
    measured[dev] = await screen.page.evaluate(measure, CLASSES);
    const updating = !['missing', 'none'].includes(testInfo.config.updateSnapshots);
    if (updating) {
      let table = {};
      try { table = JSON.parse(fs.readFileSync(FILE, 'utf-8')); } catch (e) { table = {}; }
      table[dev] = measured[dev];
      fs.writeFileSync(FILE, JSON.stringify(table));
      return;
    }
    const table = JSON.parse(fs.readFileSync(FILE, 'utf-8'))[dev];
    const off = [];
    for (const k of Object.keys(CLASSES)) {
      const want = measured[dev][k], have = (table || {})[k];
      if (!have) { off.push(k + ': missing'); continue; }
      for (const f of ['h', 'pad', 'boxPad']) {
        if (Math.abs(want[f] - have[f]) > TOL) off.push(k + '.' + f + ' ' + have[f] + ' in the table, ' + want[f] + ' in the page');
      }
      for (const ch of Object.keys(want.w)) {
        if (have.w[ch] == null || Math.abs(want.w[ch] - have.w[ch]) > TOL) {
          off.push(k + ' ' + JSON.stringify(ch) + ' ' + have.w[ch] + ' in the table, ' + want.w[ch] + ' in the page');
        }
      }
    }
    expect(off.slice(0, 25), off.length + ' width(s) out of date: trmnlp-test run metrics -u').toEqual([]);
  });
}
