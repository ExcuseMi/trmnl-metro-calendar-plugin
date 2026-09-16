'use strict';

// EVERY NAME READABLE (rules 31-38): on the paper, on nothing else's words,
// with no rail through it, and on its own rail's side of every other line.
//
// `check` is the solver's own list of what is wrong with a board, and it is
// the same list the plugin writes into `data-metro-debug` on the device. A
// fault here is a fault on the wall.

module.exports = function (test, h) {
  const { layout, fixtures, VIEWS, assert } = h;
  const check = require('../../../solver/board').check;
  const VIEWS4 = ['x-landscape', 'og-landscape', 'x-portrait', 'og-half'];

  // Known, by board: what is wrong, and what it is waiting on.
  const NARROW = 'a narrow column has nowhere to slide two names twenty minutes apart: E36';
  // (a name cut by its own spur was known here while the offline ruler was
  // narrow enough to hide it; an own-branch cut is priced at four mistakable
  // captions now, and the boards come out clean -- see bands.js)
  const KNOWN = {};

  for (const f of fixtures) {
    for (const v of VIEWS4) {
      test('the board has no faults: ' + f.name + '/' + v, () => {
        const got = check(layout(f, v).board).filter((x) => !(x.kind === 'pierce' && x.own));
        assert(!got.length, got.length + ' fault(s): ' + got.slice(0, 5).map((x) =>
          x.kind + ' "' + x.what + '"' + (x.with ? ' / "' + x.with + '"' : '') + (x.by ? ' by ' + x.by : '')).join('; '));
      }, KNOWN[f.name + '/' + v] && { known: KNOWN[f.name + '/' + v] });
    }
  }

  // A NAME ON ITS OWN RAIL'S SIDE of every other line: a caption that walks
  // past a neighbour is read as the neighbour's.
  for (const f of fixtures) {
    for (const v of ['x-landscape', 'og-landscape']) {
      test('no caption walks past another line: ' + f.name + '/' + v, () => {
        const rep = layout(f, v), b = rep.board, bad = [];
        const want = {};
        rep.spec.wants.forEach((w) => { want[w.id] = w; });
        for (const cp of b.caps) {
          const w = want[cp.id];
          if (!w || w.pill) continue;
          const box = cp.box(), mid = (box.a0 + box.a1) / 2;
          const own = b.lineByKey(cp.line), oc = own && own.cAt(mid);
          if (oc == null) continue;
          const cc = (box.c0 + box.c1) / 2;
          const mine = [w.line];
          if (w.tie) (b.pills.find((p) => p.id === w.tie) || { lines: [] }).lines.forEach((k) => mine.push(k));
          for (const ln of b.lines) {
            if (ln.branchOf || mine.indexOf(ln.key) >= 0) continue;
            const c = ln.cAt(mid);
            if (c != null && Math.min(oc, cc) + 1 < c && c < Math.max(oc, cc) - 1) {
              bad.push('"' + cp.text + '" is past ' + ln.key);
            }
          }
        }
        assert(!bad.length, bad.slice(0, 4).join('; '));
      });
    }
  }

  // A LEAD TIES A NAME THAT HAS TRAVELLED BACK TO ITS STOP, and it runs
  // clear of every other mark and every other name on its way.
  for (const f of fixtures) {
    for (const v of ['x-landscape', 'og-landscape']) {
      test('a lead runs clear of other marks and other words: ' + f.name + '/' + v, () => {
        const rep = layout(f, v), bad = [];
        const leads = rep.rects.filter((r) => r.role === 'lead' || r.role === 'leader');
        const words = rep.labels.filter((l) => l.cls === 'metro-label');
        const hits = (e, b) => {
          for (let k = 1; k < 24; k++) {
            const x = e[0][0] + (e[1][0] - e[0][0]) * k / 24, y = e[0][1] + (e[1][1] - e[0][1]) * k / 24;
            if (x > b.x + 1 && x < b.x + b.w - 1 && y > b.y + 1 && y < b.y + b.h - 1) return true;
          }
          return false;
        };
        for (const t of leads) {
          const near = words.filter((l) => hits(t.ends, { x: l.x - 3, y: l.y - 3, w: l.w + 6, h: l.h + 6 }));
          const other = near.filter((l) => l.line !== t.owner && l.id !== t.owner);
          if (other.length) bad.push('a lead crosses "' + other[0].text + '"');
        }
        assert(!bad.length, bad.slice(0, 4).join('; '));
      });
    }
  }
};
