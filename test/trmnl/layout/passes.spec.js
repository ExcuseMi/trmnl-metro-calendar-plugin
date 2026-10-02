'use strict';

// ONE BOARD, HOWEVER MANY TIMES THE PAGE LAYS IT OUT.
//
// The page lays the board out again when its box changes (a preview resized,
// a slot settling), and every pass starts from the solver's own caches. A
// board that came out differently on a second pass would be a board that
// depends on what happened to the page, not on the day. The sweep once saw
// an example board (simpsons 07:30 og-half-horizontal) flip between two
// answers from run to run and blamed this; it was the feeds' order (see
// transform/order.spec.js) and a cold page's faces (cold.spec.js), but the
// property is worth holding: the box is narrowed and given back, which lays
// the board out twice more, and the board must be what it was.

const crypto = require('crypto');
const { test, expect } = require('trmnlp-test');
const { HEAD, report, settle, pageReport } = require('../lib/page');
const { demoMocks, NOT_FOUND } = require('../lib/demo');
const fixtures = require('../../layout/fixtures');

const digest = (r) => crypto.createHash('sha1').update(JSON.stringify([r.debug.gaps, r.debug.shed, r.debug.dropped,
  r.labels.map((l) => [l.cls, l.text, Math.round(l.x), Math.round(l.y), Math.round(l.w), Math.round(l.h)])])).digest('hex');

async function twoMorePasses(screen) {
  await screen.page.evaluate(() => new Promise((done) => {
    const root = document.querySelector('.metro-root');
    root.style.width = 'calc(100% - 7px)';
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => { root.style.width = ''; done(); }, 300)));
  }));
  await screen.page.waitForTimeout(300);
  await settle(screen.page);
  return screen.page.evaluate(pageReport);
}

async function samePasses(screen) {
  const once = await report(screen);
  const again = await twoMorePasses(screen);
  expect(again.debug.runs, 'the box change did not lay the board out again').toBeGreaterThan(once.debug.runs);
  expect(again.errors).toEqual([]);
  expect(digest(again), 'the board changed on another pass').toBe(digest(once));
}

for (const device of ['og_png', 'v2']) {
  test('every fixture is the same board after more passes · ' + device, async ({ trmnl }) => {
    for (const f of fixtures) {
      await samePasses(await trmnl.render({ device, data: { data: f.metro }, transform: false, trmnlpYml: false, head: HEAD }));
    }
  });
}

test('the example board that flipped is the same board after more passes', async ({ trmnl }) => {
  await samePasses(await trmnl.render({ device: 'og_png', view: 'half_horizontal', now: Date.UTC(2026, 8, 15, 12, 30),
    timeZone: 'America/Chicago', locale: 'en-US', instanceName: 'Metro', trmnlpYml: false, head: HEAD, data: {},
    fields: { use_demo_data: 'true', demo_set: 'simpsons', time_format: '12h' }, mocks: demoMocks().concat([NOT_FOUND]) }));
});
