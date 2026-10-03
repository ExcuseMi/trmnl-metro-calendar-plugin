'use strict';

// A view has to reach a final layout and stop. The header sits above the
// canvas, so its height decides how much canvas there is; deciding the
// header's size FROM the canvas is a feedback loop, and near a breakpoint it
// oscillates forever -- half-horizontal at lg did exactly that, redrawing for
// as long as the device was on. This is cheap to check and impossible to
// notice by eye in a screenshot.

require('../lib/layout').cases('settles', function (test, h) {
  const { render, VIEWPORTS, fixtures, assert } = h;

  // sizes around the header's compact/large breakpoints, where it flipped.
  // Every view on both panels, each the view's own template in TRMNL's real
  // mashup slot. (These were window sizes in the old harness, which the
  // framework ignores: the screen is pinned to the device, so all four were
  // the full board in a smaller window.)
  const OG = h.OG, X = h.X;
  const SIZES = [
    { name: 'og-full', page: 'full', classes: OG },
    { name: 'og-half-horizontal', page: 'half_horizontal', classes: OG },
    { name: 'og-half-vertical', page: 'half_vertical', classes: OG },
    { name: 'og-quadrant', page: 'quadrant', classes: OG },
    { name: 'x-full', page: 'full', classes: X },
    { name: 'x-half-horizontal', page: 'half_horizontal', classes: X },
    { name: 'x-half-vertical', page: 'half_vertical', classes: X },
    { name: 'x-quadrant', page: 'quadrant', classes: X },
  ];

  const busy = fixtures.find((f) => f.name === 'busy-day');

  for (const size of SIZES) {
    test('settles instead of redrawing forever: ' + size.name, async () => {
      const rep = await render(busy.metro, size);
      const runs = rep.debug.runs;
      assert(typeof runs === 'number', 'no run count reported');
      // a couple of passes is normal: first paint, then fonts arriving, then
      // load. Anything beyond that is the layout chasing its own tail.
      assert(runs <= 4, size.name + ' laid out ' + runs + ' times and was still going');
    });
  }
});
