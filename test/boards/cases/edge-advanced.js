'use strict';

// THE CONNECTOR AT THE PAPER'S FIRST MINUTE, MEASURED.
//
// The advanced half of the pair: rules that need positions compared rather
// than things counted. They are all about one shape, the connector drawn for a
// shared event that was already running when the board opened, because that
// shape has three pieces which have to be in the right order and a name that
// has to keep out of their way.
//
// The order is the rule, and it was asked for in these words: "the 3 dots go
// between the Hollow Dot with letter and the track."

const edgeFixture = require('../edge-fixture');

module.exports = function (test, h) {
  const { layout, fixtures, pathsWhere, assert } = h;
  const VIEWS = ['x-landscape', 'og-landscape'];

  // Boards that grow an edge ring at all, plus the one built to grow a shelf.
  const withEdge = fixtures.concat([edgeFixture(fixtures)]);

  // RING, THEN DOTS, THEN THE TRACK.
  for (const f of withEdge) {
    for (const v of VIEWS) {
      test('at an edge ring the dots stand between it and the track: ' + f.name + '/' + v, () => {
        const rep = layout(f, v);
        const horiz = rep.debug.horizontal;
        const rings = rep.circles.filter((c) => c.role === 'ring-edge');
        if (!rings.length) return;
        const bad = [];
        for (const r of rings) {
          const cx = horiz ? r.x + r.w / 2 : r.y + r.h / 2;
          const edge = cx + r.w / 2;
          const dots = rep.circles.filter((c) => c.role === 'terminal-more' && c.owner === r.owner)
            .map((c) => (horiz ? c.x + c.w / 2 : c.y + c.h / 2));
          if (dots.length !== 3) { bad.push(r.owner + ' has ' + dots.length + ' dot(s), wanted 3'); continue; }
          // Past the ring, not inside it and not out in the gutter beyond it.
          for (const d of dots) {
            if (d <= cx) bad.push(r.owner + ': a dot at ' + Math.round(d)
              + ' is not past its ring at ' + Math.round(cx));
          }
          // And the rail's own ink pulled back off both, so they stand on
          // paper. That wipe is a <line>, so it is reported among the rects.
          const clear = (rep.rects || []).filter((q) => q.role === 'edge-clear' && q.owner === r.owner);
          if (!clear.length) { bad.push(r.owner + ': the rail was never cleared behind its ring'); continue; }
          const reach = Math.max.apply(null, clear.map((q) => (horiz ? q.x + q.w : q.y + q.h)));
          const lastDot = Math.max.apply(null, dots);
          if (reach < lastDot) bad.push(r.owner + ': the rail resumes at ' + Math.round(reach)
            + ', before its last dot at ' + Math.round(lastDot));
          if (reach < edge) bad.push(r.owner + ': the rail resumes inside its own ring');
        }
        assert(!bad.length, bad.slice(0, 4).join('; '));
      });
    }
  }

  // THE NAME IS BOOKED WHERE ITS INK IS.
  //
  // This was untestable, and the comment that stood here said so at length: a
  // name at an edge ring was moved clear of the ring at DRAWING time while
  // `rep.labels` went on reporting the SOLVER's box at the rail's start, so
  // an assertion about either position was measuring one half of a
  // disagreement. Worth reading the history for: two fixes were built and
  // both were wrong, one in day.js (which runs before the fit and cannot know
  // whether a ring is drawn at all) and one in bands.js that moved every name
  // with a ring anywhere on its line, including the ones parked out at the
  // paper's edge on a panel whose first minute is a gutter in -- that one put
  // "Fry" in a branch on futurama 21:30 og-half-horizontal.
  //
  // What it needed was for the box to be placed by machinery that can route
  // around a branch, which bands.js has had all along for every other name:
  // the box is moved past the ring BEFORE the above/below choice and the two
  // escapes are made, so a honest box that lands in a branch steps out of it
  // like any other. The drawing no longer moves anything. So the solver's box
  // is now the truth about where the name is, and this asks it.
  //
  // Measured over the 306 boards of the sweep and households corpora: 35
  // names were drawn on paper the solver had not booked, one of them across
  // a caption ("Bender" over "Hedonism Lounge", futurama 21:30 x-portrait) on
  // a board `check()` called clean. Both are zero now.
  //
  // WHICH SIDE the word is on stopped being the point when the names moved
  // into a gutter of their own: it used to start past the ring because it
  // stood on the rail, and now it ends before the ring because it stands off
  // the paper's edge. Either is fine and the map says which. What is asked is
  // the thing that was ever wrong -- the word and the ring on the same ink.
  for (const f of withEdge) {
    for (const v of VIEWS) {
      test('a name at an edge ring is booked clear of it: ' + f.name + '/' + v, () => {
        const rep = layout(f, v);
        const horiz = rep.debug.horizontal;
        const rings = rep.circles.filter((c) => c.role === 'ring-edge');
        if (!rings.length) return;
        const bad = [];
        for (const r of rings) {
          // The ring's own ink, which the word has to be on one side of.
          const i0 = horiz ? r.x : r.y, i1 = horiz ? r.x + r.w : r.y + r.h;
          const names = rep.labels.filter((l) => l.cls === 'metro-terminus'
            && l.line === r.owner && /^name0:/.test(l.id || ''));
          for (const n of names) {
            const a0 = horiz ? n.x : n.y, a1 = horiz ? n.x + n.w : n.y + n.h;
            if (a1 > i0 && a0 < i1) bad.push(r.owner + ': "' + n.text + '" is booked '
              + Math.round(a0) + '-' + Math.round(a1) + ', over its own ring at '
              + Math.round(i0) + '-' + Math.round(i1));
          }
        }
        assert(!bad.length, bad.slice(0, 4).join('; '));
      });
    }
  }

  // ...AND NOTHING ELSE IS STANDING ON THAT PAPER, which is not asked here
  // and does not need to be. `check()` already compares every caption against
  // every piece of fixed ink (`onfixed`, board.js) and the sweep runs it over
  // ninety real boards. That comparison was simply being made against the
  // wrong rectangle: the fault it could not see was "Bender" written across
  // "Hedonism Lounge". Nothing was added to catch it -- a check that was
  // already there started telling the truth.

  // ONE MARK FOR ONE END. The ring is that end's mark, so the arrow and the
  // slash give way: either would be drawn inside it, through the initial.
  for (const f of withEdge) {
    test('an end with an edge ring carries no arrow and no slash: ' + f.name, () => {
      const rep = layout(f, 'x-landscape');
      const rings = rep.circles.filter((c) => c.role === 'ring-edge');
      if (!rings.length) return;
      const bad = [];
      for (const r of rings) {
        const cx = r.x + r.w / 2, cy = r.y + r.h / 2, reach = r.w;
        for (const role of ['terminal', 'terminal-open']) {
          for (const p of pathsWhere(rep, role)) {
            if (p.owner !== r.owner) continue;
            if (p.pts.some((q) => Math.hypot(q[0] - cx, q[1] - cy) < reach)) {
              bad.push(r.owner + ' still draws a ' + role + ' in its edge ring');
            }
          }
        }
      }
      assert(!bad.length, bad.slice(0, 4).join('; '));
    });
  }

  // THE SHELF STOPS WHERE THE EVENT DOES, and says so with a tick, the way
  // everything that stops does.
  for (const v of VIEWS) {
    test('the shelf ends in a tick at the event\'s own end: ' + v, () => {
      const rep = layout(edgeFixture(fixtures), v);
      const horiz = rep.debug.horizontal;
      const ties = (rep.board.pills || []).filter((p) => p.tie && p.open0);
      const shelves = rep.paths.filter((p) => p.role === 'capsule'
        && ties.some((t) => t.id === p.owner));
      if (!shelves.length) return;      // not drawn on this panel; edge-base covers that
      const bad = [];
      for (const sh of shelves) {
        const along = (p) => (horiz ? p[0] : p[1]);
        const far = Math.max.apply(null, sh.pts.map(along));
        // A tick owned by the same event, standing at that end.
        const ticks = rep.circles.concat(rep.rects || [])
          .filter((c) => c.role === 'stop' && c.owner === sh.owner);
        const hit = ticks.some((c) => Math.abs((horiz ? c.x + c.w / 2 : c.y + c.h / 2) - far) < 4);
        if (!hit) bad.push(sh.owner + ': no tick at the shelf\'s end (' + Math.round(far) + ')');
      }
      assert(!bad.length, bad.join('; '));
    });
  }
};
