'use strict';

// THE DARK, AND WHERE IT IS ALLOWED TO FADE.
//
// The night is drawn as two rectangles per dark span: the whole of it, pale,
// and the deep of it again inside a twilight at each end, so the board fades
// into the dark rather than stepping into it at one pixel. That is right
// where the span really does begin at a sunset and end at a sunrise.
//
// It is wrong at every other kind of end, and there are three: the last dark
// on a two-day board runs off the paper, the first one begins at a midnight
// the forecast merely starts at, and a window that opens or closes inside a
// night is cut by the paper as well. A shoulder there says the sky is
// changing when nothing in the sky is doing anything -- on the wall it read
// as a sunrise at the end of tomorrow evening: "why does the sunup twilight
// look like that at the end? it shouldn't be there yet, and it shouldn't be
// that wide."
//
// Nothing could ask any of this until now. The night is a <rect> and neither
// harness reported one, so the whole of it -- where the dark is, how dark,
// how it ends -- was outside every suite in the project.

module.exports = function (test, h) {
  const { layout, fixtures, assert } = h;
  // Two days, each with a sunrise and a sunset, drawn whole: midnight to
  // midnight to midnight.
  const twoDay = fixtures.find((f) => f.name === 'badge-and-branch');

  for (const v of ['x-landscape', 'og-landscape']) {
    test('the night is drawn, and its deep is inside it: ' + v, () => {
      const rep = layout(twoDay, v);
      const shades = (rep.nights || []).filter((n) => n.role === 'night');
      const deeps = (rep.nights || []).filter((n) => n.role === 'night-deep');
      assert(shades.length >= 1, 'no dark at all on a board that runs overnight');
      // The overnight one, which is the long one. A dark span the window
      // clips to a few minutes of dusk is all shoulder and has no deep at
      // all, which is the right answer for it -- and on a shorter window
      // that sliver is the only dark there is.
      const overnight = shades.slice().sort((p, q) => (q.a1 - q.a0) - (p.a1 - p.a0))[0];
      const end = rep.debug.horizontal ? rep.canvas.w : rep.canvas.h;
      if (overnight.a1 - overnight.a0 > end * 0.06) {
        // ...inside a shoulder at each end the SUN made; an end the paper
        // cut (a window opening after sunset) has none, and the deep runs out
        const cut0 = overnight.a0 <= 0.5, cut1 = overnight.a1 >= end - 0.5;
        assert(deeps.some((d) => (cut0 ? d.a0 <= overnight.a0 + 0.5 : d.a0 > overnight.a0 + 0.5)
          && (cut1 ? d.a1 >= overnight.a1 - 0.5 : d.a1 < overnight.a1 - 0.5)),
          'the night between the two days has no deep inside its shoulders');
      }
      for (const d of deeps) {
        const over = shades.filter((s) => s.a0 <= d.a0 + 0.5 && s.a1 >= d.a1 - 0.5);
        assert(over.length, 'a deep at ' + Math.round(d.a0) + '-' + Math.round(d.a1)
          + ' is not inside any dark span');
      }
    });

    // A shoulder is the difference between the pale span and the deep one.
    // At a real sunset or sunrise there is one; at the paper's edge there is
    // not, and the deep runs all the way out.
    test('the night fades at a sunset and a sunrise, and nowhere else: ' + v, () => {
      const rep = layout(twoDay, v);
      const end = rep.debug.horizontal ? rep.canvas.w : rep.canvas.h;
      const shades = (rep.nights || []).filter((n) => n.role === 'night');
      const deeps = (rep.nights || []).filter((n) => n.role === 'night-deep');
      const bad = [];
      for (const s of shades) {
        const d = deeps.filter((x) => x.a0 >= s.a0 - 0.5 && x.a1 <= s.a1 + 0.5)
          .sort((p, q) => (q.a1 - q.a0) - (p.a1 - p.a0))[0];
        if (!d) continue;
        // The board's own edges. A dark span that reaches one is a night the
        // paper cut off, not a night the sun ended.
        const cut0 = s.a0 <= 0.5, cut1 = s.a1 >= end - 0.5;
        if (cut0 && d.a0 > s.a0 + 0.5) bad.push('a dawn at the leading edge, ' + Math.round(d.a0 - s.a0) + 'px of it');
        if (cut1 && d.a1 < s.a1 - 0.5) bad.push('a dawn at the far edge, ' + Math.round(s.a1 - d.a1) + 'px of it');
        // ...and in the middle of the board it fades at both ends.
        if (!cut0 && !cut1) {
          assert(d.a0 > s.a0 + 0.5 && d.a1 < s.a1 - 0.5,
            'the night at ' + Math.round(s.a0) + '-' + Math.round(s.a1) + ' steps into the dark');
        }
      }
      assert(!bad.length, bad.join('; '));
    });
  }

  // THE FIRST MIDNIGHT IS NOT A SUNSET. A board drawn from midnight starts
  // in the dark, and that dark did not begin on this board: it began at
  // yesterday's sunset, off the paper. Drawn with a shoulder, the first
  // hours of the morning faded up out of nothing as though the sun were
  // setting at twelve.
  test('a board that opens in the night opens at its deepest', () => {
    const rep = layout(twoDay, 'x-landscape');
    const shades = (rep.nights || []).filter((n) => n.role === 'night');
    const first = shades.slice().sort((p, q) => p.a0 - q.a0)[0];
    if (!first || first.a0 > 0.5) return;   // this board does not open in the dark
    const deep = (rep.nights || []).filter((n) => n.role === 'night-deep'
      && n.a0 >= first.a0 - 0.5 && n.a1 <= first.a1 + 0.5)[0];
    assert(deep && deep.a0 <= first.a0 + 0.5,
      'the first night starts pale ' + (deep ? Math.round(deep.a0 - first.a0) + 'px in' : 'with no deep at all'));
  });
};
