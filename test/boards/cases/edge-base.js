'use strict';

// THE PLAIN FACTS ABOUT WHAT IS AND IS NOT DRAWN.
//
// The base half of the pair: things that can be settled by counting what the
// renderer emitted and who owns it, with no geometry beyond "is this inside
// that". The connector's own shape, which needs measuring, is in
// edge-advanced.js.
//
// Every rule here is one that was true only after somebody looked at a
// screenshot and said so. They are cheap to check and they were all, at some
// point, quietly false.

module.exports = function (test, h) {
  const { layout, fixtures, pathsWhere, assert } = h;
  const VIEWS = ['x-landscape', 'og-landscape'];

  // A SHARED EVENT IS ITS CORRIDOR, NOT A WASH BEHIND IT.
  //
  // Every member's rail used to take a light band for the whole of a long
  // shared event, on top of the corridor already drawing it. The band belongs
  // to an ambient block -- a desk booking, a stretch somebody is simply inside
  // -- and those come from spec.states. So the count of bands can never exceed
  // the count of states that can ask for one. A band drawn for a pill puts it
  // over.
  for (const f of fixtures) {
    for (const v of VIEWS) {
      test('a band is an ambient block, never a shared event: ' + f.name + '/' + v, () => {
        const rep = layout(f, v);
        const asked = (rep.spec.states || []).filter((st) => st.timed && st.from != null).length;
        const drawn = pathsWhere(rep, 'band').length;
        assert(drawn <= asked, drawn + ' band(s) drawn but only ' + asked
          + ' ambient state(s) can ask for one, so something else is drawing them');
        // ...and at one bit a band is its two edges instead of a tone
        // (draw.js), which is two marks for the same one state
        const edges = pathsWhere(rep, 'band-edge').length;
        assert(edges <= asked * 2, edges + ' band edge(s) drawn for ' + asked + ' state(s)');
        assert(edges % 2 === 0, 'a band came out with ' + edges + ' edge(s), so one of them is missing');
      });
    }
  }

  // A RAIL GOES QUIET ON ITS OWN ROW, NOT INSIDE A CORRIDOR.
  //
  // The quiet treatment says "this person is elsewhere, and this is still
  // their line". Inside a corridor the corridor already says it, and drawing
  // both laid a grey ghost alongside the tube.
  for (const f of fixtures) {
    for (const v of VIEWS) {
      test('no rail is drawn quiet inside its own corridor: ' + f.name + '/' + v, () => {
        const rep = layout(f, v);
        const horiz = rep.debug.horizontal;
        const along = (p) => (horiz ? p[0] : p[1]);
        const bad = [];
        for (const pl of (rep.board.pills || []).filter((q) => !q.tie)) {
          // The corridor's own drawn extent, in the same pixels as the quiet
          // stretch, so no axis-to-canvas conversion has to be trusted. A
          // corridor is NOT a capsule: it is its members' rails routed
          // together, and the only thing the pill owns is the diamond at each
          // end. Those are its ends, which is exactly what is wanted.
          const marks = rep.paths.filter((p) => p.owner === pl.id
            && (p.role === 'merge' || p.role === 'merge-from'));
          if (marks.length < 2) continue;
          let lo = Infinity, hi = -Infinity;
          for (const t of marks) for (const p of t.pts) {
            lo = Math.min(lo, along(p)); hi = Math.max(hi, along(p));
          }
          for (const q of pathsWhere(rep, 'away')) {
            if ((pl.lines || []).indexOf(q.owner) < 0) continue;
            const qs = q.pts.map(along);
            const inside = Math.min.apply(null, qs) >= lo - 1 && Math.max.apply(null, qs) <= hi + 1;
            if (inside) bad.push(q.owner + ' quiet inside corridor ' + pl.id);
          }
        }
        assert(!bad.length, bad.join('; '));
      });
    }
  }

  // A BRANCH THE WINDOW CUT SAYS SO, AND ONE IT DID NOT SAYS NOTHING.
  //
  // Both halves matter. The dots were missing entirely for a long time, and
  // when they arrived the first version handed them out on geometry alone, so
  // a branch that began at the board's first minute of its own accord would
  // have claimed there was more of it.
  for (const f of fixtures) {
    test('only a branch the window clipped takes the dots: ' + f.name, () => {
      const rep = layout(f, 'x-landscape');
      const axis = rep.board.axis;
      const open = {};
      for (const w of rep.spec.wants || []) if (w._rail) open[w._rail] = [!!w.open0, !!w.open1];
      const bad = [];
      // ...EXCEPT ONE THAT RUNS ON OUT ACROSS THE LEGEND'S COLUMN. On a board
      // with a column, a shelf that was already out when the board opened is
      // drawn leaving its line out at the paper's edge -- from the connector
      // where its line is in one -- and running the whole way in, so its
      // leading end is its line and not the paper: nothing is cut off there
      // to put dots on. Not beside a name set level with its rail.
      const level = new Set(rep.spec.fixed.filter((x) => x.kind === 'terminus' && x.level).map((x) => x.line));
      const movedOut = new Set();
      if (rep.spec.nameGutter) {
        for (const ln of rep.board.lines.filter((l) => !l.branchOf && !level.has(l.key))) movedOut.add(ln.key);
      }
      for (const ln of (rep.board.lines || []).filter((l) => l.branchOf && l.pts.length > 1)) {
        const op = open[ln.key] || [false, false];
        const ends = [ln.pts[0][0], ln.pts[ln.pts.length - 1][0]];
        const want = [0, 1].reduce((n, e) => n
          + (op[e] && Math.abs(ends[e] - (e ? axis.a1 : axis.a0)) < 1
             && !(e === 0 && movedOut.has(ln.branchOf)) ? 3 : 0), 0);
        const got = rep.circles.filter((c) => c.role === 'terminal-more' && c.owner === ln.key).length;
        if (got !== want) bad.push(ln.key + ': ' + got + ' dot(s), wanted ' + want);
      }
      assert(!bad.length, bad.slice(0, 4).join('; '));
    });
  }

  // AN EDGE RING IS THE QUIETER MARK. It is a note at the paper's first minute,
  // not an interchange in the middle of the board, and at a crossing's full
  // size it took that corner over.
  for (const f of fixtures) {
    test('an edge ring is smaller than a crossing ring: ' + f.name, () => {
      const rep = layout(f, 'x-landscape');
      const edge = rep.circles.filter((c) => c.role === 'ring-edge');
      const mid = rep.circles.filter((c) => c.role === 'ring');
      if (!edge.length || !mid.length) return;   // nothing to compare on this board
      const biggestEdge = Math.max.apply(null, edge.map((c) => c.w));
      const smallestMid = Math.min.apply(null, mid.map((c) => c.w));
      assert(biggestEdge < smallestMid, 'an edge ring is ' + biggestEdge.toFixed(1)
        + 'px across against a crossing ring at ' + smallestMid.toFixed(1));
    });
  }
};
