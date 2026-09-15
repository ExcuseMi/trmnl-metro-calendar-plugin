'use strict';

// HOW MANY PEOPLE A PANEL CAN HOLD, AND WHAT GUESSING COSTS.
//
// NOT PART OF ./test.sh, ON PURPOSE. This is a measuring instrument, not an
// assertion about a drawing: it renders nothing, it judges nothing, and it
// takes a minute rather than a second. Its job is to keep one constant --
// `frameFor`'s `tracks` -- answerable, because a constant nobody can
// re-derive is a constant that rots.
//
//   node solver/capacity.js           the calibration table
//   node solver/capacity.js --slow    every fixture, not just the crowded ones
//
// WHAT IT MEASURES.
//
// `fit` sheds a line at a time and re-solves at every rung, all rungs sharing
// one clock. On a small slot that is most of the budget spent establishing
// what the slot's own size already said. `frameFor` now returns a `tracks`
// cap and `fit` starts its ladder one rung below it, so the question this
// answers is the only one that matters about that cap:
//
//   is it ever LOWER than the number of lines the unpruned ladder kept?
//
// If it is, the pruned search skipped the winning rung and somebody is off
// the board who should not be. One rung of slack is built in (`tracks + 1`),
// so the check is `kept <= tracks + 1`, and the run exits non-zero when any
// box breaks it. Everything else it prints is context for choosing the
// number: what each box kept, and what the pruning saved.
//
// WHAT IT DOES NOT MEASURE. Text here is measured with `charMeasure`, the
// character-count ruler, the same as solver/cases.js and solver/bench.js --
// not the real TRMNL faces, which need a browser. Widths are therefore
// consistent but not truthful, so treat the timings as relative and the
// kept-line counts as indicative. The browser's own answer for a given box
// is in test/layout.

var Day = require('./day');
var Fit = require('./fit');
var B = require('./board');

// THE LAYOUT BOXES, FROM trmnl.com/api/models.
//
// `--screen-w` / `--screen-h`, not the device's pixels: the framework scales
// one to the other (a TRMNL X is 1872x1404 of panel and 1040x780 of layout)
// and everything the solver measures is in the second. Fifty-five models
// collapse to a handful of boxes; these are the ones with devices behind
// them at both ends of the range.
var BOXES = [
  { n: 'X            ', w: 1040, h: 780, who: 'TRMNL X, Kobo Aura One, Boox Nova Air C, Seeed E1003/4' },
  { n: 'X portrait   ', w: 780, h: 1040, who: 'reMarkable 2' },
  { n: 'OG           ', w: 800, h: 480, who: 'TRMNL OG, Inky 7.3, Waveshare 7.5, Seeed E1001/2' },
  { n: 'OG portrait  ', w: 480, h: 800, who: 'OG rotated' },
  { n: 'tall         ', w: 800, h: 1081, who: 'Onyx BOOX Poke 5' },
  { n: 'wide         ', w: 1371, h: 1028, who: 'Kobo Sage, Kobo Forma' },
  { n: 'small        ', w: 800, h: 600, who: 'Kindle 7, Kobo Touch, Nook Simple Touch' },
];

// A mashup slot is a fraction of the box, not a smaller box.
var VIEWS = [
  { n: 'full     ', fw: 1, fh: 1 },
  { n: 'half-horz', fw: 1, fh: 0.5 },
  { n: 'half-vert', fw: 0.5, fh: 1 },
  { n: 'quadrant ', fw: 0.5, fh: 0.5 },
];

var OPTS = { pad: 14, bandLo: 66, cell: 7, rowH: 12 };

function solve(metro, view, capped) {
  var spec = Day.specFor(metro, view, OPTS);
  var cap = spec.tracks;
  if (!capped) spec.tracks = 0;             // the unpruned ladder, for comparison
  var t0 = Date.now();
  var board = Fit.fit(spec, { timeMs: 2000 });
  var ms = Date.now() - t0;
  var sp = board.spec || spec;
  return {
    ms: ms, cap: cap,
    rungs: (board.tried || []).length,
    kept: sp.lines.length,
    dropped: (board.dropped || []).length,
    unreadable: board.shed + (board.muddle || 0) + B.check(board).length,
  };
}

function main() {
  var fixtures = require('../test/layout/fixtures');
  var slow = process.argv.indexOf('--slow') >= 0;
  // The crowded ones, because a board with room to spare never reaches the
  // ladder at all and tells this nothing.
  var want = slow ? null : ['five-lines', 'crew-day', 'seven-lines', 'busy-day', 'full-day'];
  var boards = fixtures.filter(function (f) { return !want || want.indexOf(f.name) >= 0; });

  var bad = [], savedMs = 0, totalMs = 0;
  console.log('');
  console.log('  ' + 'box'.padEnd(14) + 'view'.padEnd(11) + 'slot'.padEnd(12)
    + 'cap'.padStart(4) + 'kept'.padStart(6) + 'drop'.padStart(6)
    + 'unread'.padStart(8) + 'rungs'.padStart(7)
    + '   pruned    plain    saved');
  BOXES.forEach(function (box) {
    VIEWS.forEach(function (v) {
      var view = { w: Math.round(box.w * v.fw) - 70, h: Math.round(box.h * v.fh) };
      var slot = Math.round(box.w * v.fw) + 'x' + Math.round(box.h * v.fh);
      // Summed over the boards, because one board is an anecdote.
      var tot = { ms: 0, rungs: 0, kept: 0, drop: 0, unread: 0, cap: 0, plain: 0, plainKept: 0 };
      boards.forEach(function (f) {
        var on = solve(f.metro, view, true);
        var off = solve(f.metro, view, false);
        tot.ms += on.ms; tot.plain += off.ms;
        tot.rungs += on.rungs; tot.kept += on.kept; tot.drop += on.dropped;
        tot.unread += on.unreadable; tot.cap = on.cap;
        tot.plainKept = Math.max(tot.plainKept, off.kept);
        // THE ONE THING THIS CAN FAIL ON. The unpruned ladder kept `off.kept`
        // lines; the pruned one starts at `cap + 1`. A cap below that skipped
        // the rung that won.
        if (off.kept > on.cap + 1) {
          bad.push(box.n.trim() + ' ' + v.n.trim() + ' (' + slot + ') ' + f.name
            + ': cap ' + on.cap + ' but the full ladder kept ' + off.kept);
        }
      });
      savedMs += tot.plain - tot.ms;
      totalMs += tot.plain;
      console.log('  ' + box.n.padEnd(14) + v.n.padEnd(11) + slot.padEnd(12)
        + String(tot.cap).padStart(4)
        + (tot.kept / boards.length).toFixed(1).padStart(6)
        + (tot.drop / boards.length).toFixed(1).padStart(6)
        + (tot.unread / boards.length).toFixed(1).padStart(8)
        + String(tot.rungs).padStart(7)
        + String(tot.ms).padStart(9) + 'ms'
        + String(tot.plain).padStart(7) + 'ms'
        + String(tot.plain - tot.ms).padStart(7) + 'ms');
    });
  });

  console.log('');
  console.log('  ' + boards.length + ' board(s) x ' + BOXES.length + ' box(es) x ' + VIEWS.length + ' view(s)');
  console.log('  total ' + totalMs + 'ms unpruned, ' + (totalMs - savedMs) + 'ms pruned, '
    + 'saved ' + savedMs + 'ms (' + (totalMs ? Math.round(savedMs * 100 / totalMs) : 0) + '%)');
  if (bad.length) {
    console.log('');
    console.log('  THE CAP IS TOO LOW IN ' + bad.length + ' CASE(S):');
    bad.forEach(function (b) { console.log('    ' + b); });
    process.exit(1);
  }
  console.log('  the cap never pruned a winning rung');
}

main();
