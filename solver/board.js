'use strict';

// A BOARD IS DATA, AND THAT IS THE WHOLE POINT OF THIS FILE.
//
// The board the plugin draws today does not exist anywhere as a value. It is
// smeared across DOM boxes, `_`-prefixed fields hung on event objects, and a
// drawing pass that recomputes geometry a fifth time on its way out. Three
// consequences, and all three are why this has been fix-one-break-three:
//
//   1. NOTHING CAN BE CHECKED WITHOUT A BROWSER. Asking "do two captions
//      overlap" means building the plugin, launching Chromium, rendering and
//      reading the DOM back. Four minutes a run. At that price you change
//      three things before you measure, and then you cannot say which one
//      did what.
//   2. A PART OF THE BOARD CAN BE MISSING AND NOTHING SAYS SO. Five captions
//      are currently measured as zero width and placed as if they were
//      points, while drawing a hundred pixels wide. A caption with no size
//      collides with nothing, so every pass downstream is reasoning about a
//      board that is not the one on the panel.
//   3. THE SOLVER CANNOT SEE MOST OF IT. The band solver is handed counts,
//      not boxes, so it sizes the paper without knowing what goes on it.
//
// So: one structure that holds everything the panel shows, in pixels, with
// nothing implied and nothing derived at read time. It is produced by the
// solver, printed by `ascii`, checked by `check`, and only then drawn. If it
// cannot be printed as text it is not finished, and if `check` is clean the
// board is correct by construction rather than by a suite agreeing.
//
// COORDINATES. One convention, everywhere, and it is not x/y: `a` runs ALONG
// the time axis and `c` runs ACROSS it. On a landscape board a is x and c is
// y; standing up they swap. Every quantity in here is pixels in (a, c), and
// the one place that knows about x and y is the renderer. Mixing the two up
// is the single most common bug in the code this replaces, so the names do
// not permit it.

// ---------------------------------------------------------------- the model

// A caption. `w` and `h` are the MEASURED size of the words: a caption may
// not exist without them, which is the bug in (2) above made unrepresentable.
function Caption(spec) {
  if (!(spec.w > 0) || !(spec.h > 0)) {
    throw new Error('caption "' + spec.text + '" has no size (w=' + spec.w
      + ', h=' + spec.h + '); measure before placing');
  }
  this.id = spec.id;
  this.of = spec.of || null;        // the event it names
  // THE MINUTE IT IS ABOUT. Not used by the solver -- a caption is placed by
  // where its words fit, and the mark is already in `stops` -- but the drawing
  // needs it to run a leader from the mark to the words, and working it back
  // out from the stop list is exactly the kind of rederivation this model
  // exists to stop.
  this.at = spec.at == null ? null : spec.at;
  this.text = spec.text || '';
  this.a = spec.a;                  // near edge along the axis
  this.c = spec.c;                  // near edge across it
  this.w = spec.w;                  // extent along the axis
  this.h = spec.h;                  // extent across it
  this.line = spec.line || null;    // the track it belongs to, for pairing
  this.pill = spec.pill || null;    // or the bar or box it hangs off
  this.rows = spec.rows || [this.text];  // the lines of words, as drawn
  this.size = spec.size || 1;
  // The framework class each row is drawn in, so the drawing wears exactly
  // what the ruler measured.
  this.rowCls = spec.rowCls || null;
  this.el = spec.el || null;
}
Caption.prototype.box = function () {
  return { a0: this.a, a1: this.a + this.w, c0: this.c, c1: this.c + this.h };
};

// A track's rail, as the polyline it is actually drawn as. Not a baseline
// plus a list of exceptions: the points are the drawing, so anything that
// asks where a line is at a minute gets the answer the panel shows.
function Line(spec) {
  this.key = spec.key;
  this.pts = spec.pts || [];        // [[a, c], ...] in axis order
  this.width = spec.width || 2;
  // Set when this is a SPUR rather than a trunk: the owner's key. Dropped on
  // the floor once, and it mattered -- every branch was counted as a trunk,
  // so each collected the reward meant for a trunk changing level and none
  // ever paid the price of being a second rail. The search reached for a
  // branch where a step would have done, which is exactly what it was being
  // told not to do.
  this.branchOf = spec.branchOf || null;
  // Drawn in another line's ink: a tie's spur leaves the outermost line in
  // the tie but belongs to the event's owner.
  this.ink = spec.ink || null;
  // solid | dashed | dotted -- the only thing that tells two rails apart on
  // a panel with no colour.
  this.style = spec.style || 'solid';
}
// THE BOX THIS LINE LIVES IN, worked out once.
//
// Most questions asked of a line are "are you anywhere near this caption",
// and for most lines on most boards the answer is no. Answering that by
// sampling the polyline fifty times is the single most expensive thing the
// solver does: a band search prices a thousand allocations, each of which
// asks every caption about every line, and almost all of it is spent proving
// that a rail two bands away is two bands away.
Line.prototype.bounds = function () {
  if (this._b) return this._b;
  var p = this.pts, lo = Infinity, hi = -Infinity;
  for (var i = 0; i < p.length; i++) {
    if (p[i][1] < lo) lo = p[i][1];
    if (p[i][1] > hi) hi = p[i][1];
  }
  this._b = { a0: p.length ? p[0][0] : 0, a1: p.length ? p[p.length - 1][0] : 0,
              c0: lo, c1: hi };
  return this._b;
};
// Could this line possibly be inside that box? Cheap, and only ever says
// "no" when it is certain.
//
// SEGMENT BY SEGMENT, OVER THE STRETCH THE BOX OCCUPIES. The whole line's
// extent is the cheap test and it is the only one this used to do -- which
// was fine while every rail stayed in its own band. Once a rail dives across
// the board to an interchange and back, its overall extent is most of the
// panel and a filter built on it stops filtering: every caption then samples
// every rail, which is most of what the solver spends its time on.
//
// The global box is still asked FIRST, because it is memoised and answers no
// for most pairs in a few instructions. What follows only runs for the ones
// it cannot dismiss, and it exits at the first segment that really is in the
// box rather than measuring the rest.
Line.prototype.near = function (box) {
  var p = this.pts, n = p.length;
  if (n < 2) return false;
  if (box.a1 < p[0][0] || box.a0 > p[n - 1][0]) return false;
  var b = this.bounds();
  if (b.c1 <= box.c0 || b.c0 >= box.c1) return false;
  for (var i = 1; i < n; i++) {
    var x0 = p[i - 1][0], x1 = p[i][0];
    if (x1 < box.a0 || x0 > box.a1) continue;
    var c0 = p[i - 1][1], c1 = p[i][1], d0, d1;
    if (x1 > x0) {
      // the segment clipped to the box's own stretch of the axis
      var t0 = box.a0 > x0 ? (box.a0 - x0) / (x1 - x0) : 0;
      var t1 = box.a1 < x1 ? (box.a1 - x0) / (x1 - x0) : 1;
      d0 = c0 + (c1 - c0) * t0; d1 = c0 + (c1 - c0) * t1;
    } else { d0 = c0; d1 = c1; }
    var lo = d0 < d1 ? d0 : d1, hi = d0 < d1 ? d1 : d0;
    if (hi > box.c0 && lo < box.c1) return true;
  }
  return false;
};

// Where this line is at minute-position `a`, or null WHERE IT IS NOT.
//
// This used to hold its first and last value forever in both directions,
// which is harmless for a trunk -- a trunk spans the whole board by
// construction -- and wrong for anything that stops. A branch that halts at
// its event's tick went on being reported at that level for the rest of the
// day, so the picture drew it to the right-hand edge and every test that
// asks "is a line in the way" answered yes for a rail that is not there.
//
// A line is somewhere only between its own ends.
Line.prototype.cAt = function (a) {
  var p = this.pts;
  if (!p.length) return null;
  if (a < p[0][0] - 0.001 || a > p[p.length - 1][0] + 0.001) return null;
  if (a <= p[0][0]) return p[0][1];
  if (a >= p[p.length - 1][0]) return p[p.length - 1][1];
  for (var i = 1; i < p.length; i++) {
    if (a > p[i][0]) continue;
    var a0 = p[i - 1][0], c0 = p[i - 1][1], a1 = p[i][0], c1 = p[i][1];
    if (a1 === a0) return c1;
    return c0 + (c1 - c0) * (a - a0) / (a1 - a0);
  }
  return p[p.length - 1][1];
};

// A stop: where an event starts or ends on its line.
function Stop(spec) {
  this.line = spec.line;
  this.a = spec.a;
  this.c = spec.c;
  this.kind = spec.kind || 'start';  // 'start' (a dot) or 'end' (a tick)
  this.todo = !!spec.todo;           // a task's start is a square, not a dot
}

// A CONVERGENCE: one event that several lines are at.
//
// On a transit map this is an interchange, and it is drawn as one heavy bar
// across the lines that meet there rather than as a stop on each of them.
// That is not decoration: dinner with four people is ONE dinner, and drawn as
// four separate stops with four copies of the name it reads as four things
// happening at once.
//
// So it has one name, and the name belongs to the bar rather than to any of
// the lines -- which is why a convergence's caption is the awkward one in
// every layout engine that has tried this. It has no rail of its own to hang
// off. Here it hangs off the BAR, which is a real object with a real extent,
// so it is the same kind of question as every other caption.
function Pill(spec) {
  this.id = spec.id;
  this.a = spec.a;                  // the minute it happens
  // AND HOW LONG IT LASTS. An interchange drawn as a mark at the middle of a
  // three-hour dinner says the five of them were in the same place for an
  // instant. Drawn across the event's own span it says how long they were
  // there, which is what the reader came for and costs nothing: the enclosure
  // has to be somewhere, and the minutes it covers are the honest place.
  this.a0 = spec.a0 == null ? spec.a : spec.a0;
  this.a1 = spec.a1 == null ? spec.a : spec.a1;
  this.lines = spec.lines || [];    // whose lines are in it
  this.c0 = spec.c0;                // the bar's extent across the board
  this.c1 = spec.c1;
  this.r = spec.r != null ? spec.r : 5;
  // WHERE A LONG TIE STOPS. A tie is drawn at one minute, but a shared event
  // three people were at for six hours has an ending, and a bar with no
  // ending says they are still in it. Null on a brief one, which starts and
  // stops in the same place.
  this.to = spec.to != null ? spec.to : null;
  // ...and, for back-to-back events drawn as one bar, each long one's own
  // ending: [{ to, lines, open1 }]
  this.ends = spec.ends || null;
  // WHETHER EITHER END OF THE RUN IS OFF THE PAPER. A corridor already
  // running when the window opened gets no diamond at the edge: see day.js.
  this.open0 = !!spec.open0;
  this.open1 = !!spec.open1;
  this.initials = spec.initials || [];
  this.tie = !!spec.tie;            // one bar at a minute, the lines left where they are
  this.todo = !!spec.todo;          // a task's: its rings are squares
  this.joins = spec.joins || [];    // [{line, join:[a,c]|null, leave:[a,c]|null}]
}
Pill.prototype.box = function () {
  // THE BOX IS THE CAPSULE AS DRAWN, which reaches a mark's radius past the
  // outermost rail in it ACROSS the board as well as along. Measured to the
  // rails alone, the enclosure is a dozen pixels taller than the paper
  // anything was kept out of, and the names either side of a long shared
  // event came out written on its outline.
  return { a0: this.a0 - this.r, a1: this.a1 + this.r,
           c0: this.c0 - this.r, c1: this.c1 + this.r };
};

// FURNITURE: ink that is on the board before any event is.
//
// The hour strip, a line's name at its terminus, the "+3 earlier" note, the
// now-marker, a weather symbol, a service banner. None of it is an event and
// all of it takes paper, and the engine this replaces learned that the hard
// way -- every one of these was added after the layout was written, so each
// arrived as a special case the caption pass had to be told about
// separately, and the ones nobody remembered to mention got written over.
//
// One kind of thing, declared before the solve, and the caption search
// treats it exactly as it treats a rail: paper that is already spoken for.
function Furniture(spec) {
  this.id = spec.id;
  this.kind = spec.kind || 'note';   // what it is, for the renderer only
  this.a0 = spec.a0; this.a1 = spec.a1;
  this.c0 = spec.c0; this.c1 = spec.c1;
  this.text = spec.text || '';
  this.align = spec.align || 'left';
  // What a sky marker wears and the minute it is about: carried, because the
  // renderer draws the board and should never be reading the payload again.
  this.icon = spec.icon || null;
  this.at = spec.at == null ? null : spec.at;
  this.min = spec.min == null ? null : spec.min;   // the minute of the day it marks
  // Whose name this is, where it is one: the drawing puts the count of that
  // line's unnamed stops beside it, and a name that does not know whose it is
  // cannot be told how many.
  this.line = spec.line || null;
  // What the line IS today, written under its name at the head (rule 54).
  this.route = spec.route || null;
}
Furniture.prototype.box = function () {
  return { a0: this.a0, a1: this.a1, c0: this.c0, c1: this.c1 };
};

function Board(spec) {
  this.axis = spec.axis;            // {a0, a1} the drawable extent along
  this.cross = spec.cross;          // {c0, c1} and across
  this.cuts = spec.cuts || [];      // day boundaries along the axis
  this.lines = [];
  this.stops = [];
  this.caps = [];
  this.pills = [];
  this.fixed = [];
  // BY KEY, NOT BY SCANNING. Every trunk and every branch is looked up by its
  // key constantly -- a caption's own rail, a pill's members, a spur's trunk,
  // a name's terminus line -- and a board a candidate move is priced against
  // is rebuilt from nothing every time, so this was a linear scan asked
  // thousands of times per solve. Kept in step with `addLine`, which is the
  // only place a line is ever added.
  this._byKey = Object.create(null);
}
Board.prototype.addLine = function (s) {
  var l = new Line(s);
  this.lines.push(l);
  // First wins, same as the scan this replaces would have found first: a
  // key is never meant to repeat, but if one ever did, this must not go on
  // to answer differently than the scan always did.
  if (!(l.key in this._byKey)) this._byKey[l.key] = l;
  return l;
};
Board.prototype.addStop = function (s) { var t = new Stop(s); this.stops.push(t); return t; };
Board.prototype.addCap = function (s) { var c = new Caption(s); this.caps.push(c); return c; };
Board.prototype.addPill = function (s) { var p = new Pill(s); this.pills.push(p); return p; };
Board.prototype.addFixed = function (s) { var f = new Furniture(s); this.fixed.push(f); return f; };
Board.prototype.lineByKey = function (k) {
  var l = this._byKey[k];
  return l === undefined ? null : l;
};

// ---------------------------------------------------------------- the check
//
// WHAT IS WRONG WITH THIS BOARD, as data, with no browser and no suite.
//
// These are not opinions about taste; every one of them is a board a reader
// cannot read. They run in microseconds, which is the difference that
// matters: a check you can afford after every single change is a check that
// tells you which change did it.

function boxesOverlap(p, q) {
  return p.a0 < q.a1 && q.a0 < p.a1 && p.c0 < q.c1 && q.c0 < p.c1;
}

// TWO NAMES NEED PAPER BETWEEN THEM, NOT MERELY DIFFERENT BOXES.
//
// A caption's measured box is its ink plus three pixels either side, and the
// words wear the framework's text-stroke, an outline that spends that
// clearance keeping a rail out of the letters. Two boxes that simply touch
// therefore draw with their outlines interlocked and read as one word:
// "School Run" next to "Book Club" came out as "School RuBook Club" on a
// board this file had just certified as clean.
//
// So the test between two captions is fought at a clearance rather than at
// contact. Same clearance both ways round, because the board stands up as
// well as lying down and a gap that exists in one orientation and not the
// other is not a gap anyone designed.
//
// TWO PIXELS, AND MEASURED RATHER THAN CHOSEN. At four, the crowded case in
// cases.js -- twelve names on one line across seven hundred pixels -- sheds
// three of them, and a clearance that costs a name has stopped being a
// clearance. Two is enough to keep the outlines apart.
var CAP_CLEAR = 2;
function capsOverlap(p, q) {
  return p.a0 - CAP_CLEAR < q.a1 && q.a0 - CAP_CLEAR < p.a1
      && p.c0 - CAP_CLEAR < q.c1 && q.c0 - CAP_CLEAR < p.c1;
}

// How much of a segment of `line` lies inside `box`, in pixels along the
// axis. Sampled, because a rail is a polyline and the question is "how much
// of the reader's word is under ink", not "do they intersect".
function lineThrough(line, box, step) {
  if (!line.near(box)) return 0;
  step = step || 2;
  var cut = 0;
  for (var a = box.a0; a <= box.a1; a += step) {
    var c = line.cAt(a);
    if (c != null && c > box.c0 && c < box.c1) cut += Math.min(step, box.a1 - a);
  }
  return cut;
}
// ...and the same question when only YES OR NO is wanted, which is what the
// readability test asks.
//
// It is `near`, exactly, and that is not a shortcut: a polyline clipped to
// the box's own stretch of the axis is a run of straight segments, and a
// straight segment whose two clipped ends bracket the box's c extent passes
// through the box somewhere between them. The sampler this replaces asked
// the same question twelve times per box, missed a rail that crossed between
// two samples, and was the single most expensive thing the solver did once
// interchanges started sending rails across the board.
function lineTouches(line, box) {
  return line.near(box);
}

function check(board) {
  var faults = [];
  var i, j;
  // A caption off the paper is a caption nobody reads.
  for (i = 0; i < board.caps.length; i++) {
    var cp = board.caps[i], b = cp.box();
    if (b.a0 < board.axis.a0 - 0.5 || b.a1 > board.axis.a1 + 0.5
        || b.c0 < board.cross.c0 - 0.5 || b.c1 > board.cross.c1 + 0.5) {
      faults.push({ kind: 'offboard', what: cp.text, box: b });
    }
  }
  // Two captions on the same paper. The worst thing this board can do: one
  // of the two words is simply gone.
  for (i = 0; i < board.caps.length; i++) {
    for (j = i + 1; j < board.caps.length; j++) {
      var o = board.caps[i].box(), p = board.caps[j].box();
      if (!capsOverlap(o, p)) continue;
      faults.push({ kind: 'overlap', what: board.caps[i].text, with: board.caps[j].text,
                    px: Math.round(Math.min(o.a1, p.a1) - Math.max(o.a0, p.a0)) });
    }
  }
  // A CAPTION WRITTEN ACROSS A MIDNIGHT. The words are read as belonging to
  // the day they are over, so a name that straddles the cut belongs to both
  // days and to neither: "Moe's Tavern" at half past eleven at night was
  // written into the small hours -- "the event labels move over to the other
  // days, that should never be allowed."
  //
  // The caption SEARCH has refused this all along (`readable`, captions.js).
  // It was never a fault, though, and everything that adjusts a caption after
  // the search keeps its result "where the board has no more faults than it
  // had" -- so `growCrowds` was free to grow one straight over a midnight,
  // and did. A rule the search enforces and the checker cannot see is a rule
  // with a hole in it the exact size of every pass that runs afterwards.
  for (i = 0; i < board.caps.length; i++) {
    var cb = board.caps[i].box();
    for (j = 0; j < (board.cuts || []).length; j++) {
      if (cb.a0 < board.cuts[j] - 1 && cb.a1 > board.cuts[j] + 1) {
        faults.push({ kind: 'midnight', what: board.caps[i].text, at: board.cuts[j] });
      }
    }
  }
  // A caption written over the board's own furniture: the hour strip, a
  // line's name, a note at the end of the axis. All of it was on the board
  // before any event was, and none of it can move out of the way.
  for (i = 0; i < board.caps.length; i++) {
    for (j = 0; j < (board.fixed || []).length; j++) {
      if (board.fixed[j].kind === 'now') continue;   // a name may cross the clock's line
      if (!capsOverlap(board.caps[i].box(), board.fixed[j].box())) continue;
      faults.push({ kind: 'onfixed', what: board.caps[i].text, by: board.fixed[j].text || board.fixed[j].kind });
    }
  }
  // A RAIL THAT RUNS BACK IN TIME. Along the axis is the clock, so a line
  // may climb, drop or turn upright, but never head back towards the morning.
  (board.lines || []).forEach(function (ln) {
    for (var k = 1; k < ln.pts.length; k++) {
      if (ln.pts[k][0] < ln.pts[k - 1][0] - 0.5) {
        faults.push({ kind: 'backwards', what: ln.key, px: Math.round(ln.pts[k - 1][0] - ln.pts[k][0]) });
        break;
      }
    }
  });
  // TWO LINES' NAMES ON EACH OTHER, which is the legend of the board gone.
  //
  // A terminus name follows its own rail, so this is never the caption
  // search's fault and never its to fix -- it says the BANDS are wrong: two
  // rails have arrived at the same level, which a reader sees as one line
  // whatever the map meant. It went unnoticed until the rails started
  // converging, because until then nothing made two of them meet.
  for (i = 0; i < (board.fixed || []).length; i++) {
    if (board.fixed[i].kind !== 'terminus') continue;
    for (j = i + 1; j < board.fixed.length; j++) {
      if (board.fixed[j].kind !== 'terminus') continue;
      if (!boxesOverlap(board.fixed[i].box(), board.fixed[j].box())) continue;
      faults.push({ kind: 'names', what: board.fixed[i].text, with: board.fixed[j].text });
    }
  }
  // SOMEBODY ELSE'S RAIL THROUGH A LINE'S NAME.
  //
  // The names used to sit in gutters outside the axis where no rail could
  // reach them. They sit inside the map now, in the row above their own line,
  // which bought the day two name-widths of axis and put them where another
  // line can run straight through the words. Like `names`, this is the BAND
  // search's to answer and not the caption search's -- a terminus follows its
  // own rail and has nowhere else to be -- so it is priced there and left out
  // of what `fit` counts.
  for (i = 0; i < (board.fixed || []).length; i++) {
    if (board.fixed[i].kind !== 'terminus') continue;
    var nb = board.fixed[i].box();
    for (j = 0; j < board.lines.length; j++) {
      var nl = board.lines[j];
      // ITS OWN SPURS TOO: a branch climbing out of the rail through the
      // line's own name cuts it as surely as a neighbour's rail. Only the
      // trunk the name stands over is exempt.
      if (nl.key === board.fixed[i].line) continue;
      if (!lineTouches(nl, nb)) continue;
      faults.push({ kind: 'namecut', what: board.fixed[i].text, by: nl.key, line: board.fixed[i].line, own: nl.branchOf === board.fixed[i].line });
    }
  }
  // A caption written across an interchange bar. The bar is the heaviest ink
  // on the board -- it is several lines wide and drawn solid -- so a name on
  // it is not a name with a line through it, it is a name that is gone.
  // (A tie's bar tunnels under words, so for a tie it is only its rings.)
  for (i = 0; i < board.caps.length; i++) {
    for (j = 0; j < board.pills.length; j++) {
      var pj = board.pills[j], cb = board.caps[i].box(), cl = board.lineByKey(board.caps[i].line);
      var mine = pj.tie && (pj.lines || []).indexOf(cl && cl.branchOf ? cl.branchOf : board.caps[i].line) >= 0;
      if (mine ? !ringHit(board, pj, cb) : !boxesOverlap(cb, pj.box())) continue;
      faults.push({ kind: 'onbar', what: board.caps[i].text, by: board.pills[j].id });
    }
  }
  // TWO RINGS OF ONE TIE ON TOP OF EACH OTHER (ringClashes).
  ringClashes(board).forEach(function (f) { faults.push(f); });
  // A rail through a caption, INCLUDING ITS OWN. The pass this replaces
  // excluded a caption's own line on the grounds that a name travels with
  // the rail it names, which stopped being true the moment a rail could
  // climb: "Homer" is currently drawn through Homer's own line.
  for (i = 0; i < board.caps.length; i++) {
    var cb = board.caps[i].box();
    for (j = 0; j < board.lines.length; j++) {
      var cut = lineThrough(board.lines[j], cb, 2);
      if (cut > 1) {
        faults.push({ kind: 'pierce', what: board.caps[i].text,
                      by: board.lines[j].key, px: Math.round(cut),
                      own: board.lines[j].key === board.caps[i].line });
      }
    }
  }
  return faults;
}

// HOW MANY TIMES A RAIL ACTUALLY LEAVES ITS LEVEL, read off the drawing.
//
// Asked of the SEARCH instead -- "which events did the state mark as
// stepping" -- this gives the wrong answer, and it did: a board printed with
// three dead straight lines reported three steps, because the state had
// asked for them and the rail had refused all three for want of room. The
// intent and the drawing are different things and only one of them is on the
// panel. That is the whole fault this rewrite exists to remove, and it
// turned up in the test code within an hour of the rule being written down.
function bends(board) {
  var n = 0;
  board.lines.forEach(function (ln) {
    if (ln.branchOf) return;          // a spur's turns are its own, not the trunk's
    for (var i = 1; i < ln.pts.length; i++) {
      if (Math.abs(ln.pts[i][1] - ln.pts[i - 1][1]) > 0.5) n++;
    }
  });
  return n;
}

// A TRUNK THAT GOES OUT AND COMES STRAIGHT BACK: the mountain, again.
//
// "I see an up and down breakfast, just expecting an up" was about one
// event. The same shape comes back when two events near each other step in
// OPPOSITE directions: down for the first, up for the second, and what is
// drawn is a V. A step means the day changed level; a step immediately
// undone means nothing at all, and it reads as the line having wobbled.
//
// Counted off the drawing, on trunks only -- a branch leaving and a branch
// arriving are two different rails and never make this shape.
function bumps(board, near) {
  near = near || 60;
  var n = 0;
  board.lines.forEach(function (ln) {
    if (ln.branchOf) return;
    var last = null;
    for (var i = 1; i < ln.pts.length; i++) {
      var d = ln.pts[i][1] - ln.pts[i - 1][1];
      if (Math.abs(d) <= 0.5) continue;
      if (last && last.sign !== (d > 0 ? 1 : -1)
          && ln.pts[i - 1][0] - last.endA < near) n++;
      last = { sign: d > 0 ? 1 : -1, endA: ln.pts[i][0] };
    }
  });
  return n;
}

// A BEND TOO SMALL TO READ AS ONE. A diagonal of two pixels is not a line
// going somewhere, it is a kink in a line that should be straight, and a
// search rewarded for stepping will buy exactly that if nothing forbids it.
function wobbles(board, least) {
  var n = 0;
  board.lines.forEach(function (ln) {
    for (var i = 1; i < ln.pts.length; i++) {
      var d = Math.abs(ln.pts[i][1] - ln.pts[i - 1][1]);
      if (d > 0.5 && d < least) n++;
    }
  });
  return n;
}

// HOW FAR EACH NAME ENDED UP FROM THE LINE IT NAMES, in its own heights.
//
// Not a fault and not a matter of taste: it is whether the board answers the
// question it exists to answer. A caption three bands from its own rail is
// sitting against somebody else's, and the reader pairs words with the
// nearest line because that is what a transit map has taught them to do. A
// board can be clean by every test in `check` and still tell the reader that
// Physio is grandad's.
function pairing(board) {
  var worst = 0, who = null;
  board.caps.forEach(function (cp) {
    var ln = board.lineByKey(cp.line);
    if (!ln) return;
    // MEASURED WHERE THE LINE IS NEAREST, not where it is under the middle
    // of the words.
    //
    // A sloping rail has left by the time it reaches the caption's midpoint,
    // so a name sitting neatly against the START of a diagonal was reported
    // as nearly three rows adrift -- the same fault the candidate builder
    // had, in the measurement rather than in the placing. The question is
    // how far the words are from their line, and the answer is the closest
    // the two come.
    var bx = cp.box(), d = Infinity;
    var span = bx.a1 - bx.a0, stepA = Math.max(2, span / 12);
    for (var a = bx.a0; a <= bx.a1 + stepA; a += stepA) {
      var c = ln.cAt(Math.min(a, bx.a1));
      if (c == null) continue;
      var gap = c < bx.c0 ? bx.c0 - c : (c > bx.c1 ? c - bx.c1 : 0);
      if (gap < d) d = gap;
    }
    if (!isFinite(d)) return;
    var rows = d / Math.max(1, cp.h);
    if (rows > worst) { worst = rows; who = cp.text; }
  });
  return { rows: worst, what: who };
}

// ---------------------------------------------------------------- the print
//
// The board as text lives in print.js. It is for a terminal and a failing
// case, never for a panel, so it is not in the bundle the device loads; these
// two names reach it from node, where it can be required.
function ascii() { return require('./print').ascii.apply(null, arguments); }
function report() { return require('./print').report.apply(null, arguments); }

// Does box `b` cover a ring of tie `pl`: one on each of its lines at its
// minute, as far round as the bar's own box reaches.
// TWO RINGS OF ONE TIE ON TOP OF EACH OTHER. The lines it joins were set
// closer than a ring is wide, and "B" and "L" were drawn as one blot with the
// two rails beside each other all day: "lisa and bart track never separate".
function ringClashes(board) {
  var out = [];
  board.pills.forEach(function (pl) {
    if (!pl.tie) return;
    var rr = (pl.r || 5) * 1.7;
    var cs = (pl.lines || []).map(function (k) {
      var ln = board.lineByKey(k);
      return ln ? { k: k, c: ln.cAt(pl.a) } : null;
    }).filter(function (x) { return x && x.c != null; }).sort(function (p, q) { return p.c - q.c; });
    for (var q = 1; q < cs.length; q++) {
      if (cs[q].c - cs[q - 1].c < rr * 2) {
        out.push({ kind: 'ringclash', what: cs[q - 1].k, with: cs[q].k, px: Math.round(cs[q].c - cs[q - 1].c) });
      }
    }
  });
  return out;
}

function ringHit(board, pl, b) {
  var rr = pl.r || 5;
  return (pl.lines || []).some(function (k) {
    var ln = board.lineByKey(k), c = ln ? ln.cAt(pl.a) : null;
    return c != null && boxesOverlap(b, { a0: pl.a - rr, a1: pl.a + rr, c0: c - rr, c1: c + rr });
  });
}

module.exports = { CAP_CLEAR: CAP_CLEAR, ringHit: ringHit, ringClashes: ringClashes,
                   Board: Board, Caption: Caption, Line: Line, Stop: Stop, Pill: Pill,
                   Furniture: Furniture,
                   check: check, ascii: ascii, report: report, pairing: pairing,
                   bends: bends, wobbles: wobbles, bumps: bumps,
                   boxesOverlap: boxesOverlap, capsOverlap: capsOverlap,
                   lineThrough: lineThrough,
                   lineTouches: lineTouches };
