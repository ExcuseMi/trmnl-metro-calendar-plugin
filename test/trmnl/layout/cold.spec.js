'use strict';

// THE SAME BOARD, WHETHER OR NOT THE FACES WERE ALREADY THERE.
//
// A board is measured, so it is laid out in whatever faces the page has when
// it is solved. The first board a fresh browser drew came out different from
// every board after it -- same payload, same panel, the layout run once each
// time -- because a face the captions are set in was still on its way when
// the solve measured them, and nothing drew the board again when it arrived.
// On the panel that is the board somebody reads after a refresh that found
// the cache cold. The sweep saw it as one example board that flipped
// between two answers from run to run (simpsons 07:30 og-half-horizontal).
//
// trmnlp-test keeps one browser page per worker and device scale, so a
// device scale no other spec uses gives this one a cold page to start from.

const crypto = require('crypto');
const { test, expect } = require('trmnlp-test');
const { PAGE, report } = require('../lib/page');
const fixtures = require('../../layout/fixtures');

const digest = (r) => crypto.createHash('sha1').update(JSON.stringify([r.debug.gaps, r.debug.shed,
  r.labels.map((l) => [l.cls, l.text, Math.round(l.x), Math.round(l.y), Math.round(l.w), Math.round(l.h)])])).digest('hex');

for (const [device, name] of [['og_png', 'busy-day'], ['v2', 'five-lines']]) {
  test('a cold page draws the board a warm one draws · ' + device + ' · ' + name, async ({ trmnl }) => {
    const metro = fixtures.find((f) => f.name === name).metro;
    const opts = { device, data: { data: metro }, transform: false, trmnlpYml: false, ...PAGE,
      // a scale of its own, so the first render is on a page with no faces in it
      deviceScale: device === 'og_png' ? 1.25 : 1.5 };
    const cold = await report(await trmnl.render(opts));
    const warm = await report(await trmnl.render(opts));
    expect(digest(cold), 'the first board differs from the second').toBe(digest(warm));
  });
}
