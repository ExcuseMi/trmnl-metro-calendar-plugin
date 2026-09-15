'use strict';

// THE WHOLE BOARD FROM ONE CALL: paper, rails and words together.
//
// The case is deliberately unfair to the old engine's model. Four lines, and
// the work is not spread evenly: one line carries six long names, two carry
// one short name each, and one carries nothing at all. Counts say the busy
// line wants more lanes; they do not say it wants three times the DEPTH,
// because a count does not know how wide a word is.
//
//   node solver/whole.js

var { report } = require('./board');
var C = require('./captions');
var Bands = require('./bands');

var spec = {
  axis: { a0: 0, a1: 1000 },
  cross: { c0: 0, c1: 150 },
  lines: [{ key: 'work' }, { key: 'mum' }, { key: 'kid' }, { key: 'gran' }],
  wants: [],
};

function want(id, line, a0, dur, text) {
  spec.wants.push(new C.Want({ id: id, text: text, line: line,
    a0: a0, a1: a0 + dur, w: text.length * 8, h: 15 }));
}

// THE BUSY LINE, and busy in the way that actually costs paper: six events
// crowded into one stretch of the morning, so their names cannot all sit on
// the row beside the rail and the gap around this line has to be DEEP. A
// count cannot see that. Six events is six events whether they are spread
// across the day or stacked on top of each other, and only one of those
// needs three rows of board.
want('w1', 'mum', 60, 40, 'School Run');
want('w2', 'mum', 110, 40, 'Client Workshop');
want('w3', 'mum', 170, 40, 'Groceries');
want('w4', 'mum', 230, 40, 'Physio Appointment');
want('w5', 'mum', 300, 40, 'Parent Evening');
want('w6', 'mum', 360, 40, 'Dinner with Alex');
// ...and the quiet ones, spread right out, which want almost nothing.
want('w7', 'work', 400, 90, 'Sprint Planning');
want('w8', 'kid', 620, 60, 'Swim Training');

var t0 = Date.now();
var b = Bands.solve(spec, {});
var ms = Date.now() - t0;

spec.wants.forEach(function (w) {
  var ln = b.lineByKey(w.line);
  b.addStop({ line: w.line, a: w.a0, c: ln.cAt(w.a0), kind: 'start' });
  b.addStop({ line: w.line, a: w.a1, c: ln.cAt(w.a1), kind: 'end' });
});

console.log(report(b, { cols: 124 }));
console.log('\ngaps ' + b.gaps.map(function (g) { return Math.round(g); }).join(' | ')
  + '   shed ' + b.shed + '   ' + ms + 'ms');
