'use strict';

// A HAND-BUILT BOARD, printed and checked. Proof that the model holds a real
// picture and that `check` sees what is wrong with it, both in milliseconds
// and with no browser anywhere.
//
// Two tracks, four events, and one caption deliberately put where it does not
// belong, so the picture shows a `#` and the report names it.

const { Board, report } = require('./board');

const b = new Board({ axis: { a0: 0, a1: 900 }, cross: { c0: 0, c1: 300 } });

// Homer runs level, then steps up for an event and stays there (rule 8).
const R = require('./rails');
const hom = R.rail('hom', 120, [{ a0: 360, a1: 520, dir: -1 }], { a0: 0, a1: 900 }, 40, 0);
b.addLine({ key: 'hom', pts: hom.pts });
// Marge runs level below him.
b.addLine({ key: 'mar', pts: [[0, 200], [900, 200]] });

b.addStop({ line: 'hom', a: 360, c: 120, kind: 'start' });
b.addStop({ line: 'hom', a: 520, c: hom.endC, kind: 'end' });
b.addStop({ line: 'mar', a: 200, c: 200, kind: 'start' });
b.addStop({ line: 'mar', a: 430, c: 200, kind: 'end' });

// In the wedge the step opened: above the flat run, ending at the bend.
b.addCap({ id: 'c1', text: 'Donut Break', line: 'hom', a: 170, c: 92, w: 120, h: 18 });
// Beside Marge, clear of everything.
b.addCap({ id: 'c2', text: 'PTA Meeting', line: 'mar', a: 205, c: 212, w: 120, h: 18 });
// ...and one placed straight through Homer's own rail, which is the fault the
// old pass could not see at all because it never asked about a caption's own
// line.
// Homer's step leaves him at `hom.endC` for the rest of the day, so THAT is
// where his rail is when this caption is drawn. Aimed at his old level it
// would sit in clean air and prove nothing.
b.addCap({ id: 'c3', text: 'Reactor Check', line: 'hom', a: 620, c: hom.endC - 9, w: 140, h: 18 });

console.log(report(b, { cols: 110, rows: 26 }));
