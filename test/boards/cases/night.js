'use strict';

// THE NIGHT IS NOT DRAWN (rule 2b-i). It was a pale rectangle per dark span
// with a deeper one inside its twilights; beside the past wash and the news
// box the two grey columns were "not that clean", so the map is paper from
// the strip to its foot, on every panel, whatever the forecast says.

module.exports = function (test, h) {
  const { layout, fixtures, assert } = h;
  const twoDay = fixtures.find((f) => f.name === 'badge-and-branch');
  for (const v of ['x-landscape', 'og-landscape', 'x-portrait']) {
    test('no night is drawn: ' + v, () => {
      const rep = layout(twoDay, v);
      const dark = (rep.nights || []).filter((n) => n.role === 'night' || n.role === 'night-deep');
      assert(!dark.length, dark.length + ' dark span(s) on a board that should be paper');
    });
  }
};
