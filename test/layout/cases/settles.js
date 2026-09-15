'use strict';

// A view has to reach a final layout and stop. The header sits above the
// canvas, so its height decides how much canvas there is; deciding the
// header's size FROM the canvas is a feedback loop, and near a breakpoint it
// oscillates forever — half-horizontal at lg did exactly that, redrawing for
// as long as the device was on. This is cheap to check and impossible to
// notice by eye in a screenshot.

module.exports = function (test, h) {
  const { render, VIEWPORTS, fixtures, assert } = h;

  // sizes around the header's compact/large breakpoints, where it flipped
  const SIZES = [
    { name: 'og-full', w: 800, h: 480, classes: 'screen--og screen--md screen--1bit screen--density-1x' },
    { name: 'og-half-horizontal', w: 800, h: 240, classes: 'screen--og screen--md screen--1bit screen--density-1x' },
    { name: 'og-half-vertical', w: 400, h: 480, classes: 'screen--og screen--md screen--1bit screen--density-1x' },
    { name: 'og-quadrant', w: 400, h: 240, classes: 'screen--og screen--md screen--1bit screen--density-1x' },
    { name: 'x-full', w: 1872, h: 1404, classes: 'screen--v2 screen--lg screen--4bit screen--density-2x' },
    { name: 'x-half-horizontal', w: 1872, h: 702, classes: 'screen--v2 screen--lg screen--4bit screen--density-2x' },
    { name: 'x-half-vertical', w: 936, h: 1404, classes: 'screen--v2 screen--lg screen--4bit screen--density-2x' },
    { name: 'x-quadrant', w: 936, h: 702, classes: 'screen--v2 screen--lg screen--4bit screen--density-2x' },
  ];

  const busy = fixtures.find((f) => f.name === 'busy-day');

  for (const size of SIZES) {
    test('settles instead of redrawing forever: ' + size.name, () => {
      const rep = render(busy.metro, size);
      const runs = rep.debug.runs;
      assert(typeof runs === 'number', 'no run count reported');
      // a couple of passes is normal: first paint, then fonts arriving, then
      // load. Anything beyond that is the layout chasing its own tail.
      assert(runs <= 4, size.name + ' laid out ' + runs + ' times and was still going');
    });
  }
};
