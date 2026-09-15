'use strict';

// A BOARD AS TEXT, for a terminal and for a failing case (see board.js).
// Not bundled into the plugin: the device never prints a board, and these
// twelve kilobytes of source were four of the server's hundred.

var check = require('./board').check;

// ---------------------------------------------------------------- the print
//
// THE BOARD AS TEXT, because a board you can print is a board that exists.
//
// This is not decoration and it is not a debug aid bolted on afterwards: it
// is the acceptance test for the model. Anything the panel shows that cannot
// be printed here is something the model does not hold, and something the
// model does not hold is something the solver cannot reason about. That is
// the entire fault this rewrite exists to remove.
//
// Collisions are drawn as `#`, so a bad board is bad TO LOOK AT rather than
// bad according to a number.

function ascii(board, opts) {
  opts = opts || {};
  var cols = opts.cols || 150;
  var aSpan = board.axis.a1 - board.axis.a0 || 1;
  var cSpan = board.cross.c1 - board.cross.c0 || 1;
  // ENOUGH ROWS THAT THE PICTURE CANNOT LIE.
  //
  // At a coarse grid a caption sitting six pixels clear of its rail lands in
  // the same character cell as the rail, and the picture shows a collision
  // on a board `check` calls clean. A view that reports faults the data does
  // not have is worse than no view: it sends you looking for a bug that is
  // in the renderer. So the row count is taken from the board -- the
  // shortest caption gets at least two rows, and its clearance at least one
  // -- unless the caller insists.
  // A 45 DEGREE RAIL HAS TO LOOK LIKE ONE.
  //
  // A character cell is about twice as tall as it is wide, so a grid whose
  // rows and columns cover the same number of pixels draws every slope twice
  // as steep as it is: Donut Break's climb came out looking near vertical on
  // a rail that is at exactly 45 degrees. The board's whole grammar is flat,
  // upright, or 45, and a picture that cannot tell the three apart is not
  // showing the thing being judged.
  //
  // So the rows are chosen to make a pixel square ON THE PAGE: a row covers
  // the same board distance as a column, times the cell's own aspect. The
  // fine-grained mode is still there for reading a crowded band closely, and
  // `check` decides either way.
  var rows = opts.rows;
  if (!rows && !opts.fine) {
    var perCol = aSpan / Math.max(1, cols - 1);
    rows = Math.max(8, Math.min(opts.maxRows || 200,
      Math.round(cSpan / (perCol * (opts.cellAspect || 1.9))) + 1));
  }
  if (!rows) {
    // The finest thing the picture has to keep apart is not a caption's
    // height: it is the CLEARANCE a caption keeps from the rail beside it,
    // which is smaller. Sized to the height alone, a caption sitting six
    // pixels off its line landed in the line's own character row and the
    // board printed a wall of `#` that `check` calls clean. A view that
    // invents faults sends you hunting a bug that is in the renderer.
    var fine = cSpan / 8;
    board.caps.forEach(function (cp) {
      fine = Math.min(fine, cp.h / 2);
      var bx = cp.box();
      board.lines.forEach(function (ln) {
        var c = ln.cAt((bx.a0 + bx.a1) / 2);
        if (c == null) return;
        var d = c < bx.c0 ? bx.c0 - c : (c > bx.c1 ? c - bx.c1 : 0);
        if (d > 0.5) fine = Math.min(fine, d);
      });
    });
    rows = Math.max(12, Math.min(opts.maxRows || 200, Math.ceil(cSpan / Math.max(1, fine))));
  }
  var colF = function (a) { return (a - board.axis.a0) / aSpan * (cols - 1); };
  var rowF = function (c) { return (c - board.cross.c0) / cSpan * (rows - 1); };
  var col = function (a) { return Math.round(colF(a)); };
  var row = function (c) { return Math.round(rowF(c)); };

  var grid = [], owner = [], inkAt = [];
  for (var r = 0; r < rows; r++) {
    grid.push(new Array(cols).fill(' '));
    owner.push(new Array(cols).fill(null));
    inkAt.push(new Array(cols).fill(null));
  }
  // WHOSE PAPER EACH CELL IS, kept beside the picture rather than inferred
  // from it. A caption occupies a BOX, not a row of letters, so a rail
  // through the white space above the words is through the caption just as
  // much as one through the letters. Drawn from the characters alone that
  // was invisible, which is the same mistake as measuring a caption by its
  // text: it is the box that has to be clear.
  function claim(r, c, who) {
    if (r < 0 || r >= rows || c < 0 || c >= cols) return;
    if (owner[r][c] == null) owner[r][c] = who;
  }
  // INK MARKS A CLASH ONLY WHERE IT REALLY IS ONE.
  //
  // A cell is several pixels of board, so "this cell holds words and this
  // cell holds a rail" is not the same statement as "the rail is in the
  // words". At any grid coarse enough to draw a 45 degree slope as a 45
  // degree slope, a caption sitting six pixels clear of its line shares that
  // line's row -- and the picture printed a solid block of `#` across a
  // board `check` calls clean.
  //
  // So ink carries the board position it was sampled at, and a clash is
  // confirmed against the caption's real box before it is drawn. The picture
  // and the checker now answer from the same numbers and cannot disagree.
  // Ink remembers WHERE ON THE BOARD it was sampled, so the words drawn over
  // it afterwards can ask whether they are really on top of it or merely in
  // the same character cell.
  function put(r, c, ch, ink, atA, atC) {
    if (r < 0 || r >= rows || c < 0 || c >= cols) return;
    if (grid[r][c] === '#') return;
    if (ink && atA != null) inkAt[r][c] = { a: atA, c: atC };
    grid[r][c] = ch;
  }

  // Rails, sampled per column so a slope draws as a slope.
  board.lines.forEach(function (ln) {
    var prev = null;
    for (var cc = 0; cc < cols; cc++) {
      var a = board.axis.a0 + cc / (cols - 1) * aSpan;
      var c = ln.cAt(a);
      if (c == null) { prev = null; continue; }
      var rr = row(c);
      var ch = '-';
      if (prev != null) {
        if (rr < prev - 0.5) ch = '/';
        else if (rr > prev + 0.5) ch = '\\';
        // a real step: fill the column between so a climb reads as connected
        var lo = Math.min(rr, prev), hi = Math.max(rr, prev);
        // The fill between two samples is a CONNECTOR, not a measurement:
        // it stands for the rail's travel between one column and the next,
        // which is a span of board wider than the column it is drawn in. Ink
        // that is only there to join two samples up must not be allowed to
        // report a collision -- that is a column's worth of rounding, and it
        // printed `#` on a rail that passes cleanly under a caption. The
        // sampled characters either side are the honest ones.
        if (hi - lo > 1) for (var f = lo; f <= hi; f++) put(f, cc, '|', false);
      }
      put(rr, cc, ch, true, a, c);
      prev = rr;
    }
  });

  // Furniture, claimed like a caption so a rail across it shows as `#`.
  (board.fixed || []).forEach(function (fx) {
    var b = fx.box();
    var r0 = Math.ceil(rowF(b.c0)), r1 = Math.floor(rowF(b.c1));
    var c0 = Math.ceil(colF(b.a0)), c1 = Math.floor(colF(b.a1));
    for (var rr = r0; rr <= r1; rr++) for (var cc = c0; cc < c1; cc++) claim(rr, cc, fx);
  });

  // Interchange bars: one stroke across every line that meets there.
  board.pills.forEach(function (pl) {
    var cc = col(pl.a);
    for (var rr = row(pl.c0); rr <= row(pl.c1); rr++) {
      put(rr, cc, 'I', true, pl.a, board.cross.c0 + (rr / (rows - 1)) * cSpan);
    }
  });

  // Stops on top of their rail: a dot to start, a tick to end.
  board.stops.forEach(function (st) {
    put(row(st.c), col(st.a), st.kind === 'end' ? '+' : 'o', true, st.a, st.c);
  });

  // THE WORDS GO ON LAST, AND THEY WIN THE CELL.
  //
  // Drawn first, they were silently rubbed out. A caption sitting six pixels
  // clear of its rail shares that rail's character row at any grid coarse
  // enough to draw a slope honestly, and since the rail is not really in the
  // words there was no clash to report -- so the rail simply overwrote the
  // letters and the board printed with a caption missing. "Quick Sync" was
  // gone from the picture while sitting perfectly placed on the board, which
  // is the worst thing a view can do: it does not show a fault, it shows a
  // board that does not exist.
  //
  // So ink is laid down first and the words go over it. Where a letter lands
  // on ink the two are checked against each other IN BOARD COORDINATES: if
  // the ink is really inside the caption's box that is a genuine pierce and
  // it prints `#`, and if it is not, the letter wins the cell and the rail
  // appears to pass behind the words. Nothing is ever rubbed out silently.
  board.caps.forEach(function (cp) {
    var b = cp.box();
    var r0 = row(b.c0), r1 = row(b.c1), c0 = col(b.a0), c1 = col(b.a1);
    var mid = Math.round((r0 + r1) / 2);
    var cr0 = Math.ceil(rowF(b.c0)), cr1 = Math.floor(rowF(b.c1));
    var cc0 = Math.ceil(colF(b.a0)), cc1 = Math.floor(colF(b.a1));
    for (var rr = cr0; rr <= cr1; rr++) for (var cc = cc0; cc < cc1; cc++) claim(rr, cc, cp);
    var room = Math.max(0, c1 - c0);
    var txt = cp.text.length <= room ? cp.text
      : (room > 2 ? cp.text.slice(0, room - 1) + '\u2026' : cp.text.slice(0, room));
    // ...AND THEY SIT ON THEIR OWN SIDE OF THE RAIL, even when the grid
    // cannot quite tell the two apart.
    //
    // A caption six pixels clear of its line lands in that line's character
    // row, so the words print along the rail and read as being ON it, which
    // is the one thing this board must never say by accident. Where the row
    // the arithmetic picked is occupied by ink that is NOT in the caption's
    // box, the words step one row toward their own side -- which is where
    // they are, just too near to resolve.
    function foreign(rr) {
      if (rr < 0 || rr >= rows) return true;
      for (var q = 0; q < txt.length; q++) {
        var cq = c0 + q;
        if (cq < 0 || cq >= cols) continue;
        var ik = inkAt[rr][cq];
        if (!ik) continue;
        if (ik.c > b.c0 && ik.c < b.c1) continue;   // really inside: a pierce, not a clash of cells
        return true;
      }
      return false;
    }
    var away = 0;
    for (var q2 = 0; q2 < txt.length && !away; q2++) {
      var ik2 = inkAt[Math.max(0, Math.min(rows - 1, mid))][c0 + q2];
      if (ik2) away = ik2.c > b.c1 ? -1 : (ik2.c < b.c0 ? 1 : 0);
    }
    var useRow = mid;
    if (foreign(mid) && away) {
      for (var d = 1; d <= 2; d++) {
        if (!foreign(mid + away * d)) { useRow = mid + away * d; break; }
      }
    }
    for (var k = 0; k < txt.length; k++) {
      var cc2 = c0 + k;
      if (useRow < 0 || useRow >= rows || cc2 < 0 || cc2 >= cols) continue;
      if (grid[useRow][cc2] === '#') continue;
      var ia = inkAt[useRow][cc2];
      if (ia && ia.a > b.a0 && ia.a < b.a1 && ia.c > b.c0 && ia.c < b.c1) {
        grid[useRow][cc2] = '#';
      } else {
        grid[useRow][cc2] = txt[k];
      }
    }
  });

  var out = grid.map(function (g) { return g.join('').replace(/\s+$/, ''); });
  // Trim the blank rows top and bottom so a quiet board does not print as a
  // page of nothing.
  while (out.length && !out[0].trim()) out.shift();
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out.join('\n');
}

// A board, its faults, and the picture, as one string. This is what a failing
// case prints, because "two captions overlap" is a fact and the picture is
// the explanation.
function report(board, opts) {
  var faults = check(board);
  var lines = [ascii(board, opts), ''];
  if (!faults.length) {
    lines.push('clean: ' + board.caps.length + ' caption(s), ' + board.lines.length + ' line(s)');
  } else {
    lines.push(faults.length + ' fault(s):');
    faults.forEach(function (f) {
      if (f.kind === 'overlap') lines.push('  overlap  "' + f.what + '" x "' + f.with + '" ' + f.px + 'px');
      else if (f.kind === 'pierce') lines.push('  pierce   "' + f.what + '" by ' + f.by
        + (f.own ? ' (its own line)' : '') + ' ' + f.px + 'px');
      else if (f.kind === 'onbar') lines.push('  on a bar "' + f.what + '" across ' + f.by);
      else if (f.kind === 'onfixed') lines.push('  on the furniture "' + f.what + '" over ' + f.by);
      else lines.push('  offboard "' + f.what + '"');
    });
  }
  return lines.join('\n');
}


module.exports = { ascii: ascii, report: report };
