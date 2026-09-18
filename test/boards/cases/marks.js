'use strict';

// EVERY MARK IS ON A RAIL, AND EVERY RAIL ENDS IN A MARK.
//
// Rules 28-30: a dot where an event starts, a tick where it stops, a ring at
// an interchange, a half mark where it was already running when the board
// opened. A mark beside its rail is a mark about nothing; a rail that stops in
// clear paper is a line that went nowhere. Asked of the SVG the renderer
// writes, sampled the way the layout reporter samples it.

module.exports = function (test, h) {
  const { layout, fixtures, pathsWhere, pointIn, inflate, assert } = h;
  const VIEWS = ['x-landscape', 'og-landscape', 'x-portrait', 'og-half'];

  const rails = (rep) => pathsWhere(rep, 'track').concat(pathsWhere(rep, 'spur'));
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);

  for (const f of fixtures) {
    for (const v of VIEWS) {
      test('every mark sits on a rail: ' + f.name + '/' + v, () => {
        const rep = layout(f, v);
        const rs = rails(rep);
        const bad = [];
        const marks = rep.circles.filter((c) => /^(ring|ring-edge|stop|stop-start)$/.test(c.role));
        for (const c of marks) {
          const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
          let best = Infinity;
          for (const p of rs) for (const pt of p.pts) best = Math.min(best, Math.hypot(pt[0] - cx, pt[1] - cy));
          if (best > 4) bad.push(c.role + ' ' + c.owner + ' at ' + Math.round(cx) + ',' + Math.round(cy)
            + ' is ' + best.toFixed(1) + 'px off');
        }
        assert(!bad.length, bad.length + ' mark(s) adrift: ' + bad.slice(0, 4).join('; '));
      });
    }
  }

  // A RING IS AN INTERCHANGE, so its line runs through it, not up to it.
  //
  // `ring-edge` is the one exception and it is a different mark: a shared
  // event that was already running when the board opened meets at the paper's
  // first minute, so its rail STARTS under the ring and there is nothing to
  // the left of it to run through. The dots beside it carry what came before.
  // It is still held to sitting on a rail, above.
  for (const f of fixtures) {
    test('a line passes through every ring from both sides: ' + f.name, () => {
      const rep = layout(f, 'x-landscape');
      const rs = rails(rep);
      const bad = [];
      for (const c of rep.circles.filter((q) => q.role === 'ring')) {
        const cx = c.x + c.w / 2, cy = c.y + c.h / 2, r = c.w / 2 + 3;
        let before = false, after = false;
        for (const p of rs) {
          for (const pt of p.pts) {
            if (Math.hypot(pt[0] - cx, pt[1] - cy) > r) continue;
            if (pt[0] < cx - 1 || pt[1] < cy - 1) before = true;
            if (pt[0] > cx + 1 || pt[1] > cy + 1) after = true;
          }
        }
        if (!(before && after)) bad.push(c.owner + ' at ' + Math.round(cx) + ',' + Math.round(cy));
      }
      assert(!bad.length, bad.length + ' ring(s) with the line on one side only: ' + bad.join('; '));
    });
  }

  // A START IS A DOT AND AN END IS A TICK, for every event the board drew.
  for (const f of fixtures) {
    test('every event drawn on a rail is marked at its start: ' + f.name, () => {
      const rep = layout(f, 'x-landscape');
      const b = rep.board, bad = [];
      for (const w of rep.spec.wants) {
        if (w.pill || w.allDay) continue;
        const key = w._rail || w.line;
        const at = b.stops.filter((s) => s.line === key && Math.abs(s.a - w.a0) < 30
          && (w.tie ? s.kind === 'from' || s.kind === 'start' || s.kind === 'end' : s.kind !== 'end'));
        if (w.tie && !w.open0) continue;   // a tie's ring is its start
        if (!at.length) bad.push('"' + w.text + '" on ' + key);
      }
      assert(!bad.length, bad.length + ' event(s) with no start mark: ' + bad.slice(0, 5).join('; '));
    });
  }

  // NO RAIL ENDS IN MID-AIR: a rail's end is the paper's edge, another rail,
  // or a mark that says why it stops.
  for (const f of fixtures) {
    for (const v of ['x-landscape', 'og-landscape']) {
      test('no rail ends in mid-air: ' + f.name + '/' + v, () => {
        const rep = layout(f, v);
        const rs = rails(rep);
        const EDGE = 20, NEAR = 10;
        const caps = rep.circles.concat(rep.rects);
        // ...OR THE DOTS THAT SAY IT ARRIVES FROM BEFORE THE BOARD. At the
        // leading end those are spread across the legend's gutter now, from
        // the first minute out to the paper's edge, so the nearest one is a
        // third of that column away rather than a rail's width: the mark is
        // the three of them together and its reach is the column.
        const lane = rep.spec.axis.a0 - (rep.spec.axis.edge0 == null ? rep.spec.axis.a0 : rep.spec.axis.edge0);
        const DOT_NEAR = Math.max(NEAR, lane / 3 + 4);
        const dots = rep.circles.filter((c) => c.role === 'terminal-more');
        const ends = pathsWhere(rep, 'terminal-open').concat(pathsWhere(rep, 'stop-from'),
          pathsWhere(rep, 'merge-from'), pathsWhere(rep, 'merge'));
        const bad = [];
        for (const p of rs) {
          if (p.len < 1) continue;
          for (const end of [p.pts[0], p.pts[p.pts.length - 1]]) {
            if (end[0] <= EDGE || end[0] >= rep.canvas.w - EDGE) continue;
            if (end[1] <= EDGE || end[1] >= rep.canvas.h - EDGE) continue;
            if (rs.some((q) => q !== p && q.pts.some((pt) => dist(pt, end) <= NEAR))) continue;
            if (caps.some((m) => pointIn(end, inflate(m, NEAR)))) continue;
            if (dots.some((m) => m.owner === p.owner && pointIn(end, inflate(m, DOT_NEAR)))) continue;
            if (ends.some((c) => c.pts.some((pt) => dist(pt, end) <= NEAR))) continue;
            bad.push(p.role + '/' + p.owner + ' ends at ' + Math.round(end[0]) + ',' + Math.round(end[1]));
          }
        }
        assert(!bad.length, bad.length + ' loose rail end(s): ' + bad.slice(0, 6).join('; '));
      });
    }
  }

  // A SPUR LEAVES FROM ITS TRUNK: its first point is on the trunk's course.
  for (const f of fixtures) {
    test('every spur leaves its trunk from a point on it: ' + f.name, () => {
      const rep = layout(f, 'x-landscape');
      const b = rep.board, bad = [];
      for (const ln of b.lines) {
        if (!ln.branchOf || !ln.pts.length) continue;
        const trunk = b.lineByKey(ln.branchOf);
        const [a, c] = ln.pts[0];
        if (a <= rep.spec.axis.a0 + 0.5) continue;       // arrives from off the paper (rule 2g)
        const tc = trunk && trunk.cAt(a);
        if (tc == null || Math.abs(tc - c) > 1) bad.push(ln.key + ' starts ' + (tc == null ? 'past its trunk' : Math.round(Math.abs(tc - c)) + ' off it'));
      }
      assert(!bad.length, bad.join('; '));
    });
  }
};
