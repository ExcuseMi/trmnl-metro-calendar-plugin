'use strict';

// WHAT ONLY A REAL PAGE CAN SAY ABOUT THE DRAWING.
//
// The geometry questions -- marks on rails, rings, spurs, captions beside
// their own rails, corridors -- are asked of the solver's board in node, in
// test/boards. What is left here needs the framework and the real faces: a
// label's drawn box against the canvas, whether everything drawn got paint,
// and whether a line's name collides with the hour labels on the strip.

module.exports = function (test, h) {
  const { layout, VIEWPORTS, fixtures, overlap, textLabels, pathsWhere, assert } = h;
  const byName = (n) => VIEWPORTS.find((v) => v.name === n);
  const ROOMY = byName('x-landscape');

  const TIGHT = byName('og-landscape');
  for (const f of fixtures) {
    test('fits the small panel: ' + f.name, () => {
      const rep = layout(f, TIGHT);
      const off = textLabels(rep).filter((l) =>
        l.x < -2 || l.y < -2 || l.x + l.w > rep.canvas.w + 2 || l.y + l.h > rep.canvas.h + 2);
      assert(off.length === 0, off.length + ' label(s) off-canvas: '
        + off.slice(0, 5).map((l) => '"' + l.text + '"').join(', '));
      const tracks = pathsWhere(rep, 'track');
      for (const t of tracks) {
        const ys = t.pts.map((p) => p[1]);
        assert(Math.min.apply(null, ys) >= -2 && Math.max.apply(null, ys) <= rep.canvas.h + 2,
          'track ' + t.owner + ' runs off the canvas');
      }
    });
  }

  // ------------------------------------------------------------ staying on the canvas

  for (const f of fixtures) {
    test('every label stays inside the canvas: ' + f.name, () => {
      const rep = layout(f, ROOMY);
      const bad = textLabels(rep).filter((l) =>
        l.x < -2 || l.y < -2 || l.x + l.w > rep.canvas.w + 2 || l.y + l.h > rep.canvas.h + 2);
      assert(bad.length === 0, bad.length + ' label(s) off-canvas: ' + bad.slice(0, 5).map((l) => '"' + l.text + '"').join(', '));
    });
  }

  // Nothing is drawn with no paint. An SVG shape given neither a stroke nor
  // a fill renders as nothing at all: it is in the DOM, the right size, in
  // the right place, and invisible. That is exactly how the interchange tie
  // disappeared — its literal stroke was removed on the way to making the
  // colours theme-aware and never replaced, leaving three rings on three
  // lines with no visible reason to be there. Every other geometry test
  // passed, because the tie was still perfectly positioned.
  for (const f of fixtures) {
    test('everything drawn is actually visible: ' + f.name, () => {
      const rep = layout(f, ROOMY);
      const NONE = (v) => !v || v === 'none' || v === 'rgba(0, 0, 0, 0)' || v === 'transparent';
      const bad = [];
      for (const el of rep.painted || []) {
        if (!el.w && !el.h) continue;                       // not laid out
        // The COURSE is deliberately unpainted. It is where a line goes,
        // kept as one unbroken path so anything downstream can ask how far
        // along itself the line is at a given minute; the visible line is
        // drawn separately, in runs, because it breaks wherever it passes
        // under something. Nothing is meant to see this one.
        if (el.role === 'course') continue;
        // A <line> cannot be filled — only its stroke draws anything — and
        // its computed fill defaults to black, so counting fill as paint let
        // the strokeless tie through. This test passed on the broken build
        // the first time it was run, which is the whole reason for the note.
        const fills = el.tag !== 'line' && el.tag !== 'polyline';
        const inked = (!NONE(el.stroke) && el.strokeWidth > 0) || (fills && !NONE(el.fill));
        if (!inked) bad.push(el.role + (el.owner ? '/' + el.owner : '') + ' <' + el.tag + '>');
        else if (el.opacity === 0) bad.push(el.role + ' is fully transparent');
      }
      assert(bad.length === 0, bad.length + ' element(s) drawn with no paint: '
        + [...new Set(bad)].slice(0, 5).join('; '));
    });
  }

  for (const f of fixtures) {
    test('no line name lands in the river: ' + f.name, () => {
      // The track nearest the spine sits close enough that its name went
      // into the water with the hour labels, which are the one thing on the
      // board it must never share space with.
      const rep = layout(f, ROOMY);
      const hours = textLabels(rep).filter((l) => (' ' + l.cls + ' ').indexOf(' metro-hour ') >= 0);
      const names = textLabels(rep).filter((l) => (' ' + l.cls + ' ').indexOf(' metro-terminus ') >= 0);
      const bad = [];
      for (const n of names) {
        for (const h of hours) {
          if (overlap(n, h)) { bad.push('"' + n.text + '" over "' + h.text + '"'); break; }
        }
      }
      assert(bad.length === 0, bad.length + ' line name(s) in the river: ' + bad.slice(0, 3).join('; '));
    });
  }

};
