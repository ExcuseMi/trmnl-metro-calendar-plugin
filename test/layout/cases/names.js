'use strict';

// A LINE'S NAME IS AT THE END OF ITS LINE.
//
// That is the whole of what a terminus name does: it says whose rail this is,
// by being at the end of it, at both ends, because a reader comes to the
// board from whichever side they are standing on. A name that has wandered in
// from the end is not a name a little out of place -- it is a word floating
// in the middle of a map, naming nothing, with rails either side of it.
//
// It happened, on the example day the plugin ships, and it was reported from
// a photograph: "Bart end label is in the middle of the page". Bart's head at
// the far end carries a route row -- the all-day badge, "Spring Break · Fri",
// under his name -- and the escape that steps a name in off the edge to get
// out from under a branch measured its allowance off the BOX, which for a
// head with a route row is as wide as the row. Twice that is most of a TRMNL
// X, and he stepped four hundred and sixty pixels in.
//
// Nothing saw it: `check` has no opinion about where a terminus is, the sweep
// asks about faults, and no fixture had a two-row head with a branch under
// it. This is the ratchet, and it is deliberately blunt -- a name belongs
// near an end, and how near is not worth arguing about.

module.exports = function (test, h) {
  const { layout, fixtures, VIEWPORTS, assert } = h;

  // A name may step in off the edge -- out from under its own branch, past an
  // edge ring -- and still be that rail's. A fifth of the board is far more
  // slack than any of those need and far less than being adrift.
  const SLACK = 0.2;

  for (const fx of fixtures) {
    test('every line is named at the ends of its own rail: ' + fx.name, () => {
      const bad = [];
      for (const v of VIEWPORTS) {
        const rep = layout(fx, v);
        if (!rep.debug) continue;
        const horiz = rep.debug.horizontal;
        const span = horiz ? rep.canvas.w : rep.canvas.h;
        if (!span) continue;
        rep.labels.filter((l) => /metro-terminus/.test(l.cls)).forEach((l) => {
          const lo = horiz ? l.x : l.y;
          const size = horiz ? l.w : l.h;
          const inFromEnd = Math.min(lo, span - (lo + size));
          if (inFromEnd > span * SLACK) {
            bad.push(v.name + ': "' + l.text + '" is ' + Math.round(inFromEnd)
              + 'px in from either end of a ' + Math.round(span) + 'px board');
          }
        });
      }
      assert(!bad.length, bad.slice(0, 3).join('; '));
    });
  }
};
