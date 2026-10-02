'use strict';

// THE PICTURE, NOT THE BOOKKEEPING.
//
// Every other spec reads the board back as numbers. These keep a picture of
// the board on the two panels that matter most -- the TRMNL X lying down,
// which is the board this plugin is designed for, and the 1-bit OG -- as the
// device gets it (the screenshot reduced to the panel's palette), and fail on
// any pixel that moved. A layout change is MEANT to move pixels: look at the
// diff in the report, and when it is the change you wanted,
//
//   trmnlp-test run visual -u
//
// rewrites the pictures in test/trmnl/__screens__, which are committed. That
// is the screenshot AGENTS.md asks to be sent with every drawing change.
//
// (test/visual/cars.js, the visual check this suite had, asked whether each
// line's car stood on its rail. The cars are gone from the board -- one train
// on the strip replaced them -- and it failed all six of its scenarios when
// forced on, so it was not ported.)

const { test, expect } = require('trmnlp-test');
const { HEAD, report } = require('./lib/page');
const fixtures = require('../layout/fixtures');

const PANELS = [
  { name: 'x-landscape', device: 'v2' },
  { name: 'og-landscape', device: 'og_png' },
];

for (const p of PANELS) {
  for (const f of ['busy-day', 'five-lines']) {
    test('the board as the panel shows it · ' + f + ' · ' + p.name, async ({ trmnl }) => {
      const metro = fixtures.find((x) => x.name === f).metro;
      const screen = await trmnl.render({ device: p.device, data: { data: metro }, transform: false, trmnlpYml: false, head: HEAD });
      await report(screen);                 // drawn, settled and error-free first
      await expect(screen).toFitDeviceImageLimit();
      await expect(screen).toMatchScreen(f + '-' + p.name);
    });
  }
}
