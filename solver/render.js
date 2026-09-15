'use strict';

// A SOLVED BOARD, DRAWN. The last step, and deliberately the dumbest one.
//
// Everything that decides anything has already happened. This file turns a
// Board into SVG and makes no choices of its own: it does not nudge a caption
// that looks tight, it does not shorten a title that overruns, it does not
// move a rail out of the way of a word. If the drawing is wrong, the BOARD is
// wrong, and `check` will have said so.
//
// That restraint is the whole point of the rewrite. The engine this replaces
// recomputes geometry on its way out -- the drawing pass works out a
// caption's box for the fifth time, from fields that four other passes also
// interpret -- and the moment any of those five disagreed, the panel showed
// something no test could see. Here there is one board, and the panel shows
// it.
//
// COORDINATES. The solver works in (a, c): along the time axis and across it.
// This is the one place that knows those are x and y on a landscape panel and
// would be y and x standing up.

// Spelled in halves so the template that carries this script does not read
// as opening a stylesheet. See `render`.
var TAG0 = '<sty' + 'le>', TAG1 = '</sty' + 'le>';

// A RAIL TURNS A CORNER, IT DOES NOT FOLD.
//
// The polyline the solver produces is exact and the drawing of it should not
// be: a transit map rounds every change of direction, and a mitred right
// angle reads as a fault in the line rather than as the line going
// somewhere. Each vertex becomes a short quadratic through it, pulled back
// along both legs by the corner radius or by half the shorter leg, whichever
// is less -- so a tight zigzag rounds less rather than overshooting.
function rounded(pts, r) {
  if (pts.length < 3) {
    return pts.map(function (p, i) {
      return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1);
    }).join(' ');
  }
  var d = 'M' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(1);
  for (var i = 1; i < pts.length - 1; i++) {
    var a = pts[i - 1], b = pts[i], c = pts[i + 1];
    var l1 = Math.hypot(b[0] - a[0], b[1] - a[1]);
    var l2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
    var k = Math.min(r, l1 / 2, l2 / 2);
    if (!(k > 0.5)) { d += ' L' + b[0].toFixed(1) + ' ' + b[1].toFixed(1); continue; }
    var p1 = [b[0] + (a[0] - b[0]) * k / l1, b[1] + (a[1] - b[1]) * k / l1];
    var p2 = [b[0] + (c[0] - b[0]) * k / l2, b[1] + (c[1] - b[1]) * k / l2];
    d += ' L' + p1[0].toFixed(1) + ' ' + p1[1].toFixed(1)
       + ' Q' + b[0].toFixed(1) + ' ' + b[1].toFixed(1)
       + ' ' + p2[0].toFixed(1) + ' ' + p2[1].toFixed(1);
  }
  var last = pts[pts.length - 1];
  return d + ' L' + last[0].toFixed(1) + ' ' + last[1].toFixed(1);
}

// THE DASH PATTERN IS HOW A READER TELLS TWO LINES APART, and this table is
// TAKEN from the engine this replaces rather than invented.
//
// It was invented first, and badly: dashes scaled by each line's own weight,
// with the weights left different too. The stable renderer had already
// settled both questions against real panels, and its answer is the opposite
// of the guess -- FIVE ENCODINGS AT ONE WEIGHT, so the only thing telling two
// rails apart is the pattern. Weights tuned for a board where each track has
// a band to itself turn into stripes when the bands come close, which is
// exactly when telling them apart matters.
//
// The originals are written as PAPER laid over solid ink, so their numbers
// are inverted: `2 4` there is two of paper and four of ink, and reads as a
// four-long dash. These are the same patterns written as the ink, because
// that is what is drawn here.
//
//   solid       the anchor line -- unbroken, so the eye finds it first
//   heavydash   4 ink, 2 gap
//   dotted      2 ink, 4 gap
//   dashdot     8 ink, 3 gap, 2 ink, 3 gap
//   widedash    6 ink, 6 gap
//
// BUTT CAPS, NOT ROUND. A round cap reaches half a stroke-width past each
// end, which at these weights is most of the gap: the stable engine's note
// records a line drawn and then completely painted out by its own caps.
function dashFor(style, S) {
  var d = null;
  if (style === 'heavydash' || style === 'dashed') d = [4, 2];
  else if (style === 'dotted') d = [2, 4];
  else if (style === 'dashdot') d = [8, 3, 2, 3];
  else if (style === 'widedash') d = [6, 6];
  if (!d) return '';
  return ' stroke-dasharray="' + d.map(function (n) { return (n * S).toFixed(1); }).join(' ')
    + '" stroke-linecap="butt"';
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// E-INK, ONE BIT. No greys, no shadows, no anti-aliased hairlines: a panel
// that cannot draw them renders them as noise or as nothing. Weight is the
// only way this drawing distinguishes anything, so the weights have to be far
// enough apart to survive a 1-bit dither.
var CSS = [
  'html,body{background:#fff}',
  '.board{font:400 13px/1.15 "Liberation Sans",system-ui,sans-serif;color:#000}',
  '.cap{fill:#000}',
  '.time{font:400 11px/1.15 inherit;fill:#000}',
  '.hour{font:400 10px/1.15 inherit;fill:#000}',
  '.rail{fill:none;stroke:#000;stroke-linecap:round;stroke-linejoin:round}',
  '.spur{fill:none;stroke:#000;stroke-linecap:round;stroke-linejoin:round}',
  '.bar{stroke:#000;stroke-linecap:round}',
  '.dot{fill:#fff;stroke:#000}',
  '.tick{stroke:#000;stroke-linecap:round}',
].join('');

function render(board, spec, view, opts) {
  opts = opts || {};
  var horizontal = opts.horizontal !== false;
  var W = view.w, H = view.h;
  // (a, c) to (x, y). The only place in the whole solver that knows.
  function X(a, c) { return horizontal ? a : c; }
  function Y(a, c) { return horizontal ? c : a; }
  // The panel's own scale, and the constants the stable engine tuned against
  // it: a corner is 13, a stop 6 with a 3 stroke, every rail 3 wide.
  var S = opts.S || 1;
  var base = (opts.lineWidth || 3) * S;
  var CORNER = 13 * S, NODE_R = 6 * S, NODE_STROKE = 3 * S;
  var out = [];
  // INSIDE AN <svg> SOMEBODY ELSE OWNS, or as a whole document.
  //
  // In the plugin the element already exists, with its own classes and its
  // own place in the layout; here it is filled rather than replaced, because
  // replacing it would drop the classes the framework put there and the
  // board would lose its box. Standalone -- a screenshot, a test -- the
  // wrapper is wanted.
  if (!opts.inner) {
    out.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H
      + '" viewBox="0 0 ' + W + ' ' + H + '" class="board">');
  }
  // THE STYLESHEET TRAVELS WITH THE PICTURE ONLY WHEN THE PICTURE IS ON ITS
  // OWN.
  //
  // Inside the plugin these rules live in the template's own stylesheet,
  // where they belong: they are static, they never change with the board,
  // and emitting them here put a literal stylesheet tag inside the script --
  // which the plugin's linter reads as markup and then counts everything
  // after it as inline styles. Standalone -- a screenshot, a test -- there
  // is no stylesheet to live in, so it comes along.
  //
  // The tag is built rather than written for the same reason: a template is
  // scanned as markup, and a script that spells out an opening tag is a
  // script that opens one.
  if (!opts.inner) out.push(TAG0 + CSS + TAG1);
  out.push('<rect width="' + W + '" height="' + H + '" fill="#fff"/>');

  // THE ALERT, if the board has one: reversed out, across the top, above
  // everything. It is the only thing on this map drawn white on black,
  // because it is the only thing that is not part of the map.
  if (spec && spec.alert) {
    var ah = (opts.rowH || 12) + 10;
    out.push('<rect x="0" y="0" width="' + W + '" height="' + ah + '" fill="#000"/>');
    out.push('<text class="label label--small" x="8" y="' + (ah - 5) + '" fill="#fff">'
      + esc(spec.alert.text || '') + '</text>');
  }

  // THE HOUR STRIP, drawn from the same scale the events were placed on, so a
  // mark at nine o'clock is under the nine. Derived rather than remembered:
  // if these disagreed with the events the board would be lying about time
  // itself, which is the one thing it exists to say.
  if (spec && spec.scale && spec.metro) {
    var from = spec.metro.day_start_min, to = spec.metro.day_end_min;
    // AS MANY HOURS AS WILL FIT, AND NO MORE.
    //
    // Every hour, always, is right for one day and nonsense for three: a
    // three-day board printed seventy-two labels into the space for
    // sixteen and came out as a black smear. The strip is only useful while
    // it can be read, so the step is whatever leaves room for the words --
    // and the steps are the ones a clock has (2, 3, 6, 12 hours), because a
    // scale marked every five hours is one nobody can do arithmetic on.
    var perMin = (spec.scale.at(from + 60) - spec.scale.at(from)) / 60;
    var STEPS = [1, 2, 3, 6, 12, 24];
    var step = STEPS[STEPS.length - 1];
    for (var si = 0; si < STEPS.length; si++) {
      if (STEPS[si] * 60 * perMin >= (opts.hourRoom || 46)) { step = STEPS[si]; break; }
    }
    // ...AND ON A BOARD SHOWING SEVERAL DAYS, WHICH DAY. An hour label says
    // nothing about that, and a board whose events span three days has to
    // answer it before it answers anything else.
    var days = spec.metro.days || [];
    if (days.length > 1) {
      days.forEach(function (d) {
        var dx = spec.scale.at(d.start_min);
        out.push('<line class="tick" x1="' + X(dx, spec.cross.c0 - 22).toFixed(1)
          + '" y1="' + Y(dx, spec.cross.c0 - 22).toFixed(1)
          + '" x2="' + X(dx, spec.cross.c1).toFixed(1)
          + '" y2="' + Y(dx, spec.cross.c1).toFixed(1)
          + '" stroke-width="0.6" stroke-dasharray="2 4"/>');
        out.push('<text class="cap" x="' + X(dx + 6, spec.cross.c0 - 38).toFixed(1)
          + '" y="' + Y(dx + 6, spec.cross.c0 - 38).toFixed(1)
          + '" class="label label--small">' + esc(d.date_label || '') + '</text>');
      });
    }
    for (var m = Math.ceil(from / 60) * 60; m <= to; m += 60 * step) {
      var ax = spec.scale.at(m);
      var lab = (Math.floor(m / 60) % 24) + ':00';
      out.push('<line class="tick" x1="' + X(ax, spec.cross.c0 - 6).toFixed(1)
        + '" y1="' + Y(ax, spec.cross.c0 - 6).toFixed(1)
        + '" x2="' + X(ax, spec.cross.c0 - 2).toFixed(1)
        + '" y2="' + Y(ax, spec.cross.c0 - 2).toFixed(1) + '" stroke-width="1"/>');
      out.push('<text class="label label--small" x="' + X(ax, spec.cross.c0 - 9).toFixed(1)
        + '" y="' + Y(ax, spec.cross.c0 - 9).toFixed(1)
        + '" text-anchor="middle">' + esc(lab) + '</text>');
    }
  }

  // Rails first, words last, which is also the order the ASCII printer uses
  // and for the same reason: the words are what the reader came for.
  board.lines.forEach(function (ln) {
    var d = rounded(ln.pts.map(function (p) {
      return [X(p[0], p[1]), Y(p[0], p[1])];
    }), CORNER);
    // A SPUR IS DRAWN LIGHTER THAN THE TRUNK IT LEFT. The trunk is the day
    // and the branch is one thing off the side of it, and on a 1-bit panel
    // weight is the only way to say which is which.
    // ONE WEIGHT FOR EVERY LINE. A spur is drawn lighter because it is a
    // different KIND of thing -- one event off the side of the day -- and
    // that is the only weight difference on the board.
    var w = ln.branchOf ? Math.max(1.5, base * 0.66) : base;
    out.push('<path class="' + (ln.branchOf ? 'spur' : 'rail') + '" d="' + d
      + '" stroke-width="' + w.toFixed(1) + '"' + dashFor(ln.style, S) + '/>');
  });

  // AN INTERCHANGE IS A CAPSULE, NOT A BAR.
  //
  // A transit map draws a station several lines meet at as one rounded
  // enclosure around all of them -- not a stroke across them. The difference
  // is what it says: a bar reads as another rail, crossing; a capsule reads
  // as a place, containing. Hollow, so the rails inside it stay visible and
  // the reader can see WHICH lines are in it, which is the whole question a
  // convergence raises.
  (board.pills || []).forEach(function (pl) {
    var r = (pl.r || 5) + 4;
    var lo = Math.min(pl.c0, pl.c1) - r, hi = Math.max(pl.c0, pl.c1) + r;
    var x = X(pl.a, lo), y = Y(pl.a, lo);
    var w = horizontal ? r * 2 : (hi - lo), h = horizontal ? (hi - lo) : r * 2;
    out.push('<rect class="pill" x="' + (x - (horizontal ? r : 0)).toFixed(1)
      + '" y="' + (y - (horizontal ? 0 : r)).toFixed(1)
      + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1)
      + '" rx="' + r.toFixed(1) + '" ry="' + r.toFixed(1) + '"/>');
  });

  // A START IS A DOT AND AN END IS A TICK. Two different shapes rather than
  // two sizes of the same one: on a panel that dithers, a big circle and a
  // small circle are one circle.
  board.stops.forEach(function (st) {
    if (st.kind === 'state') {
      // CONCENTRIC RINGS. A state is not a stop: nothing happened at this
      // minute, the line simply is this way from here. Two hollow rings say
      // "a landmark" where one filled dot would say "a station", and on a
      // 1-bit panel that difference has to be a different SHAPE rather than
      // a different size, because a big circle and a small circle dither
      // down to one circle.
      [5, 2.5].forEach(function (r) {
        out.push('<circle cx="' + X(st.a, st.c).toFixed(1)
          + '" cy="' + Y(st.a, st.c).toFixed(1) + '" r="' + r
          + '" fill="none" stroke="#000" stroke-width="1.5"/>');
      });
      return;
    }
    if (st.kind === 'end') {
      var t = NODE_R * 1.15;
      out.push('<line class="tick" x1="' + X(st.a, st.c - t).toFixed(1)
        + '" y1="' + Y(st.a, st.c - t).toFixed(1)
        + '" x2="' + X(st.a, st.c + t).toFixed(1)
        + '" y2="' + Y(st.a, st.c + t).toFixed(1)
        + '" stroke-width="' + NODE_STROKE.toFixed(1) + '"/>');
    } else {
      out.push('<circle class="dot" cx="' + X(st.a, st.c).toFixed(1)
        + '" cy="' + Y(st.a, st.c).toFixed(1) + '" r="3.2" stroke-width="2"/>');
    }
  });

  // A LINE IS NAMED AT BOTH ENDS, and finished with a chevron.
  //
  // Both ends because a reader coming to the board looks at whichever edge is
  // nearer them, and a name only on the right is a name half the readers have
  // to hunt for. The chevron is what a transit map puts where a line runs off
  // the edge: it says the day continues rather than that the line stops, which
  // a blunt end does not.
  board.lines.forEach(function (ln) {
    if (ln.branchOf || !ln.pts.length) return;
    var p0 = ln.pts[0], p1 = ln.pts[ln.pts.length - 1];
    [[p0, -1], [p1, 1]].forEach(function (e) {
      var p = e[0], dir = e[1], t = 7;
      var ax = X(p[0], p[1]) + (horizontal ? dir * t : 0);
      var ay = Y(p[0], p[1]) + (horizontal ? 0 : dir * t);
      out.push('<path class="rail" d="M' + (ax - (horizontal ? dir * t : t)).toFixed(1)
        + ' ' + (ay - (horizontal ? t : dir * t)).toFixed(1)
        + ' L' + ax.toFixed(1) + ' ' + ay.toFixed(1)
        + ' L' + (ax - (horizontal ? dir * t : -t)).toFixed(1)
        + ' ' + (ay + (horizontal ? t : -dir * t)).toFixed(1)
        + '" stroke-width="' + Math.max(1.5, (ln.width || 2) * 0.8).toFixed(1) + '"/>');
    });
  });

  // The board's own furniture. A terminus name is the legend, so it is drawn
  // with the same weight as a caption and never smaller.
  (board.fixed || []).forEach(function (fx) {
    if (fx.kind === 'now') {
      // NOW. Dashed, and behind everything: it is a reading aid rather than
      // part of the map, and a solid rule down the board would read as
      // another rail.
      var a = (fx.a0 + fx.a1) / 2;
      out.push('<line x1="' + X(a, fx.c0).toFixed(1) + '" y1="' + Y(a, fx.c0).toFixed(1)
        + '" x2="' + X(a, fx.c1).toFixed(1) + '" y2="' + Y(a, fx.c1).toFixed(1)
        + '" stroke="#000" stroke-width="1.2" stroke-dasharray="1 3"/>');
      return;
    }
    if (fx.kind === 'hours') return;
    var c = (fx.c0 + fx.c1) / 2 + 4;
    var anchor = fx.align === 'right' ? 'end' : 'start';
    var at = fx.align === 'right' ? fx.a1 : fx.a0;
    out.push('<text class="' + (fx.kind === 'terminus' ? 'text--base' : 'text--small')
      + '" x="' + X(at, c).toFixed(1) + '" y="' + Y(at, c).toFixed(1)
      + '" text-anchor="' + anchor + '">' + esc(fx.text) + '</text>');
  });

  board.caps.forEach(function (cp) {
    var rows = cp.rows && cp.rows.length ? cp.rows : [cp.text];
    var rowH = cp.h / rows.length;
    rows.forEach(function (line, i) {
      // The box is the measurement; the baseline sits inside it. Nothing here
      // recomputes where the caption goes -- it was decided, and this draws
      // it where it was decided.
      var c = cp.c + rowH * (i + 0.78);
      // WORN, NOT CHOSEN. The class is the one the ruler measured this row
      // in, carried from the measurement rather than decided again here --
      // which is the whole reason the drawing and the measurement agree.
      var cls = (cp.rowCls && cp.rowCls[i]) || (rows.length > 1 && i === 0 ? 'text--small' : 'text--base');
      out.push('<text class="' + cls + '" x="' + X(cp.a, c).toFixed(1)
        + '" y="' + Y(cp.a, c).toFixed(1) + '">' + esc(line) + '</text>');
    });
  });

  // WHO IS NOT HERE, SAID OUT LOUD.
  //
  // The board leaves people out when the panel cannot hold them, and it
  // sheds a name when there is nowhere to put it. Both are honest decisions
  // and both become dishonest the moment they are silent: a reader looking
  // at four lines has no way to know whether the fifth person has nothing on
  // or simply did not fit, and that is exactly the doubt this map exists to
  // remove.
  //
  // So it says so, in the corner, in the plainest words available.
  var missing = [];
  if (board.dropped && board.dropped.length) {
    var names = board.dropped.map(function (k) {
      var nm = null;
      (spec && spec.metro && spec.metro.legend || []).forEach(function (p) {
        if (p.key === k) nm = p.name;
      });
      return nm || k;
    });
    missing.push(names.join(', ') + ' not shown');
  }
  if (board.shed) missing.push('+' + board.shed + ' more');
  if (missing.length) {
    var mc = spec.cross.c1 + (opts.rowH || 12) * 0.9;
    out.push('<text class="label label--small" x="' + X(spec.axis.a1, mc).toFixed(1)
      + '" y="' + Y(spec.axis.a1, mc).toFixed(1)
      + '" text-anchor="end">' + esc(missing.join('   ')) + '</text>');
  }

  if (!opts.inner) out.push('</svg>');
  return out.join('\n');
}

module.exports = { render: render, CSS: CSS, TAG0: TAG0, TAG1: TAG1 };
