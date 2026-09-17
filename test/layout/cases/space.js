'use strict';

// PAPER NOBODY IS USING, AT THE TOP OF THE MAP.
//
// Asked from a photograph of a real board with a red box drawn on it: "why
// are we not more space efficient to avoid situations like this". The box was
// the band between the hour strip and the first line's rail -- a fifth of a
// TRMNL X with one name in it -- while the bottom line's captions ran into
// the banner.
//
// The band search prices an allocation by placing the captions on it, so a
// gap that nothing needs should have collapsed on its own. Two rules kept it
// open, and both were asking about the wrong thing:
//
//   an edge gap was ALLOWED six tenths of an inner one before it was charged
//   for anything, and a proportion is only ever right by accident -- on a
//   full X the inner gaps are two hundred pixels deep because two sides of
//   captions need them, and six tenths of that is a hundred and twenty pixels
//   handed to a gap holding one name;
//
//   and what was equalised was the GAPS, which is only right when every line
//   carries the same amount. The rule for when it plainly is not -- squeeze
//   the gap between two people with nothing on them -- over-corrected, taking
//   all the paper out of the quiet gaps with nowhere to put it but the one
//   gap beside somebody busy. `slow-day` came out as three rails stacked at
//   the top, six hundred pixels of nothing, and one line alone at the bottom.
//
// Both are measured now (`edgeSlack` and `tidiness`, solver/bands.js): every
// gap keeps what is standing in it and takes an equal share of what is left.
//
// This is the ratchet. Over the eighteen fixtures at every lying-down view,
// blank paper between the header and the first ink of the map came to 1704px
// before and 1063px after; the worst board went from 142px to 94px. The cap
// here is loose enough that an honest board can still open with a wide band
// when something is standing in it, and tight enough that either old rule
// fails it.

module.exports = function (test, h) {
  const { layout, fixtures, VIEWPORTS, assert } = h;
  // The furniture of the header, which is not the map and does not count as
  // ink in it.
  const STRIP = /metro-hour|metro-axis-note|metro-sky|metro-daybadge|metro-nownext|metro-wx/;
  const CAP = 120;

  test('no board opens with a band of paper nobody is using', () => {
    const bad = [];
    let total = 0, n = 0;
    for (const v of VIEWPORTS) {
      for (const fx of fixtures) {
        const rep = layout(fx, v);
        // Standing up, "above the map" is beside it and this is a different
        // question; the boards that prompted it all lie down.
        if (!rep.debug || !rep.debug.horizontal) continue;
        const tracks = rep.paths.filter((p) => p.role === 'track');
        if (!tracks.length) continue;
        const first = Math.min(...tracks.map((p) => Math.min(...p.pts.map((q) => q[1]))));
        const strip = rep.labels.filter((l) => STRIP.test(l.cls));
        const stripBot = strip.length ? Math.max(...strip.map((l) => l.y + l.h)) : 0;
        const above = rep.labels.filter((l) => !STRIP.test(l.cls))
          .filter((l) => l.y + l.h <= first + 1 && l.y >= stripBot - 1);
        const waste = (above.length ? Math.min(...above.map((l) => l.y)) : first) - stripBot;
        total += Math.max(0, waste); n++;
        if (waste > CAP) bad.push(fx.name + '/' + v.name + ': ' + Math.round(waste)
          + 'px of blank paper under the header, in a band ' + Math.round(first - stripBot) + 'px deep');
      }
    }
    assert(n > 20, 'only ' + n + ' boards were measured, so this proves nothing');
    assert(!bad.length, bad.slice(0, 4).join('; ') + ' (' + Math.round(total) + 'px over ' + n + ' boards)');
  });
};
