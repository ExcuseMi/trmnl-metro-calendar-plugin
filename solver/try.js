'use strict';

// The caption solver against a crowded board, printed. Run it:
//   node solver/try.js

const { Board, report } = require('./board');
const C = require('./captions');

const b = new Board({ axis: { a0: 0, a1: 1000 }, cross: { c0: 0, c1: 320 } });

// Homer steps UP for Donut Break and stays up: one turn, one direction. It
// used to be written out here as a mountain -- up, flat, back down -- which
// is the hold that was corrected, and which the solver cannot draw.
const R = require('./rails');
const hom = R.rail('hom', 60, [{ a0: 400, a1: 560, dir: -1 }], { a0: 0, a1: 1000 }, 40, 0);
b.addLine({ key: 'hom', pts: hom.pts });
b.addLine({ key: 'mar', pts: [[0, 140], [1000, 140]] });
b.addLine({ key: 'bar', pts: [[0, 220], [1000, 220]] });
b.addLine({ key: 'lis', pts: [[0, 290], [1000, 290]] });

// Two events twenty minutes apart on one line is the case that has broken
// every previous attempt, so it is in here twice.
const wants = [
  new C.Want({ id: 'e1', text: 'Team Standup', line: 'mar', a0: 60, a1: 110, w: 110, h: 16 }),
  new C.Want({ id: 'e2', text: 'Quick Sync', line: 'mar', a0: 100, a1: 140, w: 95, h: 16 }),
  new C.Want({ id: 'e3', text: 'Donut Break', line: 'hom', a0: 400, a1: 560, w: 105, h: 16 }),
  new C.Want({ id: 'e4', text: 'Reactor Check', line: 'hom', a0: 700, a1: 780, w: 120, h: 16 }),
  new C.Want({ id: 'e5', text: 'Skate Park', line: 'bar', a0: 420, a1: 500, w: 95, h: 16 }),
  new C.Want({ id: 'e6', text: 'Detention', line: 'bar', a0: 470, a1: 540, w: 85, h: 16 }),
  new C.Want({ id: 'e7', text: 'Saxophone Lesson', line: 'lis', a0: 460, a1: 540, w: 150, h: 16 }),
  new C.Want({ id: 'e8', text: 'PTA Meeting', line: 'mar', a0: 640, a1: 700, w: 105, h: 16 }),
  new C.Want({ id: 'e9', text: 'Book Club', line: 'lis', a0: 800, a1: 880, w: 85, h: 16 }),
];

wants.forEach((w) => {
  const ln = b.lineByKey(w.line);
  b.addStop({ line: w.line, a: w.a0, c: ln.cAt(w.a0), kind: 'start' });
  b.addStop({ line: w.line, a: w.a1, c: ln.cAt(w.a1), kind: 'end' });
});

const t0 = Date.now();
const sol = C.solve(wants, b);
C.apply(b, wants, sol);
const ms = Date.now() - t0;

console.log(report(b, { cols: 128 }));
console.log('\nplaced ' + (wants.length - sol.shed) + '/' + wants.length
  + ', shed ' + sol.shed + ', energy ' + Math.round(sol.energy) + ', ' + ms + 'ms');
