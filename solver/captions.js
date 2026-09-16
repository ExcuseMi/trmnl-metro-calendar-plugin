'use strict';

// PLACING EVERY CAPTION, AGAINST ONE COST, ON A BOARD THAT ALREADY EXISTS.
//
// The pass this replaces is three passes. A shelf's name is decided by the
// lane placer as a side effect of choosing a lane; a mark's and a
// convergence's are decided by a later search; and two more passes move the
// results afterwards. Three answers to one question, and the reason it is
// three is historical rather than principled.
//
// Here it is one. Every caption is the same kind of object: some words with a
// measured size, an anchor (the minute and the rail it belongs to), and a set
// of positions it would accept. The solver picks one position per caption so
// that the whole board is as good as it can be. Nothing else places a
// caption, and nothing moves one afterwards.
//
// WHY A SEARCH AND NOT A RULE. Where a name belongs is not a property of the
// event. It is a property of what else is on the paper at that minute, which
// is only known once everything is placed. A rule can only be right about one
// caption at a time, which is how a board ends up with the first name taking
// the only good spot and the next three written on each other.
//
// WHAT IS A FACT AND WHAT IS A PREFERENCE. This distinction is the one the
// old pass kept getting wrong, and it cost six failed attempts at a single
// caption. A FACT is a thing a reader cannot read: a name on another name, a
// rail through the words, a name off the paper. Facts are not priced, they
// are rejected, and a caption with no fact-free position is shed rather than
// drawn badly. A PREFERENCE is everything else -- near its own dot, near its
// own rail, on the tidy side -- and preferences are summed. A preference can
// never outvote a fact, which is what "a discount cannot win" meant.

var B = require('./board');

// MEMOISED BY THE ARRAY ITSELF, not by the line. `boardFor` (bands.js)
// builds a fresh Board with fresh `pts` arrays every trial, so a WeakMap
// keyed on `l.pts` can never see a stale answer -- a line whose rail moved
// has a new array and therefore a new key, and the old entry is simply
// unreachable once that trial is done. What it buys: within ONE trial,
// several captions near the same rail all put that rail in their own
// `near.lines` and each built the identical JSON.stringify(l.pts) for the
// cache key that then usually hits anyway -- stringifying the same points
// five times to ask a question the first stringify already answered.
var ptsKeyCache = new WeakMap();
function ptsKey(pts) {
  var k = ptsKeyCache.get(pts);
  if (k === undefined) { k = JSON.stringify(pts); ptsKeyCache.set(pts, k); }
  return k;
}

// HOISTED OUT OF positions(), which is the hottest function in a solve and
// was reallocating both of these array literals on every call (thousands
// per solve) even though neither is ever written to after it is built.
//
// A finer step near the mark: at three tenths the folded "Mensa Meeting"
// missed a ninety-pixel notch between two verticals by a few pixels on
// either slide, and was shed on a board that had room for it.
var POSITION_SLIDES = [0, 0.3, -0.3, 0.55, -0.55, 1.0, -1.0];
// ...and only against the rail, where a notch between two verticals is
// worth threading; a row out, every candidate costs a test against every
// rail and the finer step bought nothing but time.
var POSITION_FINE = [0, 0.15, -0.15, 0.3, -0.3, 0.55, -0.55, 1.0, -1.0];

// ---------------------------------------------------------------- the wants
//
// WHAT A CAPTION IS BEFORE IT HAS A PLACE. `anchor` is the minute it names
// and `rail` the line it belongs to; `w`/`h` are measured, never guessed.

function Want(spec) {
  this.id = spec.id;
  this.text = spec.text;
  this.line = spec.line;             // key of the rail it belongs to
  this.a0 = spec.a0;                 // the event's own extent along the axis
  this.a1 = spec.a1 != null ? spec.a1 : spec.a0;
  // A caption belongs EITHER to a rail or to an interchange bar, never to
  // both. A convergence has no line of its own -- that is the whole point of
  // it -- so its name hangs off the bar, which is a real object with a real
  // extent and therefore the same kind of question as every other caption.
  // Every engine that has tried this has made the convergence's name a
  // special case placed by its own pass; it is not special, it just has a
  // different thing to hang off.
  this.pill = spec.pill || null;
  // A shared event too brief to converge for: a want on its owner's line,
  // and a tie bar (a pill by this id) across everyone's.
  this.tie = spec.tie || null;
  // ...whose branch may leave either end of the bar, not only the owner's
  // (a stack of back-to-back events belongs to nobody in particular)
  this.tieFree = !!spec.tieFree;
  // ...where the first of a stack ends, its branch running on past it
  this.endAt = spec.endAt != null ? spec.endAt : null;
  // A LATER PART OF A STACK rides the branch of the want by this id: no rail
  // of its own, a stop on that one.
  this.ride = spec.ride || null;
  // a task rather than an appointment: its stop is a square
  this.todo = !!spec.todo;
  // A CROWDED STRETCH'S OTHER DOTS, along the axis: the events folded into
  // this one caption (day.js crowdsFrom). Each is still a stop on the rail.
  this.members = spec.members && spec.members.length ? spec.members.slice() : null;
  // A state of the line rather than a stop on it: no dot, no tick, and its
  // rail may not step or branch for it. See day.js.
  this.allDay = !!spec.allDay;
  // AN END THE BOARD CANNOT SEE IS NOT A MARK. An event that began before the
  // window opened, or runs past where it closes, is drawn from the edge (see
  // day.js) -- and a dot at that edge would say it started there, which is a
  // lie about the one thing this map exists to state. The rail simply runs
  // off the paper instead, the way a line whose day is a slice of something
  // longer always has.
  this.open0 = !!spec.open0;
  this.open1 = !!spec.open1;
  this.gap = spec.gap != null ? spec.gap : 6;   // clearance it keeps from its rail
  this.pad = spec.pad != null ? spec.pad : 4;   // and from other words
  // EVERY SHAPE THIS NAME CAN TAKE, MEASURED, ordered richest first.
  //
  // A caption is not one size. It is the time over the title at the board's
  // largest text, the same without its time row, the same again a size down,
  // and so on -- and which of those a board uses is a decision, not a
  // property of the event. The old engine had this as a "degradation
  // ladder" walked from outside the layout: the whole board was drawn at one
  // size, scored, then drawn again a size smaller, four times over, and the
  // best kept. Four boards to answer a question the search can hold as one
  // more variable.
  //
  // MEASURED, ALL OF THEM, never scaled from one. Text does not scale
  // linearly and a caption whose size was guessed is the zero-width bug
  // again wearing a hat: the whole board is then reasoned about at a size
  // nothing on the panel has.
  this.forms = spec.forms || [{ w: spec.w, h: spec.h, text: spec.text }];
  this.forms.forEach(function (f, i) {
    if (!(f.w > 0) || !(f.h > 0)) {
      throw new Error('caption "' + spec.text + '" form ' + i + ' has no measured size');
    }
    if (f.text == null) f.text = spec.text;
    if (!f.rows) f.rows = [f.text];
    if (!f.rowCls) f.rowCls = f.rows.map(function () { return f.cls || ''; });
  });
  // The richest form is what the caption is until something says otherwise.
  this.form = 0;
  this.w = this.forms[0].w;
  this.h = this.forms[0].h;
}
// Wear one of the measured forms. Nothing derives a size; it is chosen from
// what was measured, so a caption can never be a size nobody looked at.
Want.prototype.wear = function (i) {
  var f = this.forms[Math.max(0, Math.min(this.forms.length - 1, i))];
  this.form = i;
  this.w = f.w; this.h = f.h; this.shown = f.text; this.rows = f.rows; this.size = f.size || 1;
  // The very element that was measured, so the drawing positions the box
  // the solve was about rather than a fresh one of another size.
  this.el = f.el || null;
  this.rowCls = f.rowCls; this.cls = f.cls || '';
  return this;
};
Want.prototype.formCount = function () { return this.forms.length; };
// A FRESH ONE, carrying no state. A Want picks up `_rail`, a worn form and a
// shown text as it is solved, so the same object cannot be handed to a
// second solve and be trusted -- which is exactly what mirroring a board
// needs to do.
Want.prototype.clone = function () {
  return new Want({ id: this.id, text: this.text, line: this.line, pill: this.pill, tie: this.tie, tieFree: this.tieFree,
                    endAt: this.endAt, ride: this.ride, todo: this.todo, members: this.members,
                    a0: this.a0, a1: this.a1, gap: this.gap, pad: this.pad,
                    allDay: this.allDay, open0: this.open0, open1: this.open1,
                    forms: this.forms.map(function (f) {
                      return { w: f.w, h: f.h, text: f.text, rows: f.rows,
                               size: f.size, rung: f.rung, cls: f.cls, rowCls: f.rowCls,
                               el: f.el };
                    }) });
};

// ---------------------------------------------------------- the positions
//
// EVERY PLACE THIS NAME WOULD ACCEPT, enumerated once, against the rails
// only. Not against other captions: where they end up is what the search is
// for, and enumerating against them would make this answer depend on the
// order names were asked in, which is the ordering bug the search exists to
// remove.
//
// The set is small and deliberate. A name goes beside its own rail, on one
// side or the other, stepped out a row at a time, and slid along. That is
// four numbers and it covers everything the old pass expressed as five
// separate mechanisms.

// `ownLine` is the rail already resolved by the caller (solve() below always
// has it, having just looked it up itself to build `near`), so it is passed
// through rather than looked up a second time -- `board.lineByKey` is a
// linear scan and this is the hottest function in a solve (profiled at over
// 8% on its own). Optional and re-derived when absent so positions() still
// stands alone for anything that calls it directly.
function positions(want, board, opts, ownLine) {
  opts = opts || {};
  var rows = opts.rows || 4;
  var out = [];
  var slides = POSITION_SLIDES, fine = POSITION_FINE;
  var step = want.h + 3;
  // A CONVERGENCE'S NAME HANGS OFF ITS BAR. Above it or below it, stepped
  // out and slid along exactly as any other caption is -- the only
  // difference is what it measures from, and a bar's ends are as real a
  // reference as a rail's height.
  if (want.pill) {
    var pill = null;
    for (var pi = 0; pi < board.pills.length; pi++) {
      if (board.pills[pi].id === want.pill) pill = board.pills[pi];
    }
    if (!pill) return out;
    var pbox = pill.box();
    for (var ps = 0; ps < 2; ps++) {
      var pside = ps ? -1 : 1;
      for (var pr = 0; pr < rows; pr++) {
        // (a shared event's bar ends in lettered rings a half again as wide as
        // a mark, and its name keeps room past them for the short leader that
        // says it belongs to the bar)
        var pout = want.gap + pr * step + (pill.tie ? pill.r * 0.5 + 8 : 0);
        var pc = pside > 0 ? pbox.c1 + pout : pbox.c0 - pout - want.h;
        for (var pk = 0; pk < slides.length; pk++) {
          // Centred over the bar is where this name belongs, so the slides
          // are measured from the middle of the words rather than their
          // start: a name that names a POINT is centred on it.
          var pa = pill.a - want.w / 2 + slides[pk] * want.w;
          // SAME KEYS, SAME ORDER, EVERY PUSH SITE IN THIS FUNCTION. A
          // candidate missing `off`/`beside`/`pbox` is a different hidden
          // class from one that has them, and `cands` ends up holding a mix
          // of shapes off a single board (pill candidates beside rail
          // candidates) -- every later read of `p.something` (readable,
          // posBox, muddledAt, pairCost) then goes megamorphic. Profiled at
          // over 8% of a solve on its own (LoadIC_Megamorphic), more than
          // `positions` itself spent computing the values. `off: undefined`
          // and `pbox: null` are read with `!= null` downstream, so this
          // changes no answer, only how V8 stores it.
          out.push({ want: want, a: pa, c: pc, side: pside, row: pr,
                     off: undefined, slide: slides[pk] * want.w,
                     railC: pside > 0 ? pill.c1 : pill.c0, pbox: pbox, beside: false });
        }
      }
    }
    // ...AND BESIDE IT. A box around four rails is taller than a name, and
    // above and below it are exactly where those rails arrive and leave, so
    // the name was pushed a band away from the thing it names while the
    // paper level with the box stood empty. Level with it, at each row the
    // box is tall enough to hold, on either end.
    // Three places a side -- level with the top of the box, its middle and
    // its bottom -- and no more: every candidate is checked against every
    // rail, and a box's worth of rows was a measurable share of the solve.
    var mid = (pbox.c0 + pbox.c1) / 2 - want.h / 2;
    for (var es = 0; es < 2; es++) {
      var eside = es ? -1 : 1;
      var ea = eside > 0 ? pbox.a1 + want.gap : pbox.a0 - want.gap - want.w;
      [pbox.c0, mid, pbox.c1 - want.h].forEach(function (ec, ei) {
        if (ec < pbox.c0 - 0.5 || ec + want.h > pbox.c1 + 0.5) return;
        if (ei && Math.abs(ec - pbox.c0) < 1) return;   // a short box: one row is all of them
        out.push({ want: want, a: ea, c: ec, side: 0, row: 0,
                   off: undefined, slide: 0,
                   railC: eside > 0 ? pill.c1 : pill.c0, pbox: pbox, beside: eside });
      });
    }
    return out;
  }
  // The rail this event actually sits on, which is its own branch when it
  // took a shelf and its owner's trunk otherwise.
  var line = ownLine !== undefined ? ownLine : board.lineByKey(want._rail || want.line);
  if (!line) return out;
  // TWO RAILS TO STAND BESIDE, WHERE THE EVENT IS A SLOPE.
  //
  // A caption's height comes from the rail under the middle of its words,
  // which is right for a mark and wrong for a step: the words are wider
  // than the event, so their middle lands on the FLAT part beyond the
  // diagonal and the caption sits out on the level the line has already
  // left -- a name floating beside nothing while its own event slopes away
  // from it.
  //
  // The fix for that was to measure at the DOT, and it swapped one fault
  // for the other: the name is then beside the level the line is ABOUT to
  // leave, and on the demo board "Reactor Core Check" sat two bands clear
  // of the rail that was its event, with the wedge the slope had just
  // opened standing empty underneath it.
  //
  // Neither reference is right for every board, so both are offered and
  // the price decides -- which it can now do honestly, because `off` is the
  // gap the words really have from their own rail rather than the number of
  // rows from whichever point they were built against.
  //
  // WORDS WIDER THAN THE RAIL THEY HANG OFF. A spur halts at its tick, so a
  // half-hour event on one is a stub shorter than its own name, and every
  // position whose middle lay past the tick had no rail under it to measure
  // from and was never offered. The dot is on the rail whatever the words
  // do, so it is the reference when the middle is off the rail.
  // A spur that begins after its event's minute (past a merge diamond) is
  // measured from where it begins: that is where its dot is.
  var wa0 = line.branchOf && line.pts.length && line.pts[0][0] > want.a0 ? line.pts[0][0] : want.a0;
  var c0s = line.cAt(wa0), c1s = line.cAt(want.a1);
  var sloped = c0s != null && c1s != null && Math.abs(c1s - c0s) > 1;
  // A SHELF'S NAME IS ON THE SHELF'S SIDE: directly under a shelf that
  // hangs below its trunk, directly over one that stands above it, never
  // across the trunk from it -- "caption always directly under the shelf
  // or above." Which side that is, is which side of the trunk the spur
  // runs on.
  var shelfSide = 0;
  if (line.branchOf) {
    var trunk = board.lineByKey(line.branchOf);
    var tc = trunk ? trunk.cAt((wa0 + want.a1) / 2) : null;
    var sc = line.cAt((wa0 + want.a1) / 2);
    if (tc != null && sc != null && Math.abs(sc - tc) > 1) shelfSide = sc > tc ? 1 : -1;
  }
  for (var si = 0; si < 2; si++) {
    var side = si ? -1 : 1;
    for (var r = 0; r < rows; r++) {
      // INSIDE THE SHELF'S GAP TOO, against the shelf: "captions should be
      // able to go inside the shelf gap". Only the row against the shelf,
      // and the trunk through the words refuses it where the gap is too
      // shallow for them.
      if (shelfSide && side !== shelfSide && r > 0) continue;
      var out_ = want.gap + r * step;
      var sl = r ? slides : fine;
      for (var k = 0; k < sl.length; k++) {
        var a = wa0 + sl[k] * want.w;
        var mid = a + want.w / 2;
        // BOTH LEVELS WHEREVER THEY DIFFER, not only on a slope. Lisa's
        // rail was level at her dot and up in the dinner by the middle of
        // the words, so every slide to the right of the dot was measured
        // from the dinner and refused, and the notch beside her dot went
        // unused. Where the rail under the middle is not the rail at the
        // dot, both are offered and the measured `off` prices them.
        var refs = [];
        if (c0s != null) refs.push(c0s);
        var gotMid = line.cAt(mid);
        if (gotMid != null && (c0s == null || Math.abs(gotMid - c0s) > 1)) refs.push(gotMid);
        if (!refs.length) continue;
        // WHERE THE RAIL RUNS UNDER THESE WORDS, as a band. Sampled three
        // times rather than once: a diagonal has a different height at each
        // end of a caption, and the gap that matters is the nearest one.
        //
        // Written as three plain lookups rather than an array + forEach: this
        // ran once per (side, row, slide) candidate -- tens of times per
        // caption, thousands per solve -- and profiled as a real share of a
        // solve's own time and its GC (the array literal and the closure both
        // heap-allocate on every call). `mid` was also being asked for twice:
        // `gotMid` above is `line.cAt(mid)`, so it is reused rather than
        // recomputed.
        var lo = Infinity, hi = -Infinity;
        var ccA = line.cAt(a);
        if (ccA != null) { if (ccA < lo) lo = ccA; if (ccA > hi) hi = ccA; }
        if (gotMid != null) { if (gotMid < lo) lo = gotMid; if (gotMid > hi) hi = gotMid; }
        var ccB = line.cAt(a + want.w);
        if (ccB != null) { if (ccB < lo) lo = ccB; if (ccB > hi) hi = ccB; }
        for (var ri = 0; ri < refs.length; ri++) {
          var railC = refs[ri];
          var c = side > 0 ? railC + out_ : railC - out_ - want.h;
          var near = !isFinite(lo) ? out_
            : (c > hi ? c - hi : (c + want.h < lo ? lo - (c + want.h) : 0));
          out.push({ want: want, a: a, c: c, side: side, row: r,
                     // In rows, and zero while the words are as close as a
                     // caption is allowed to get, so row 0 is still free.
                     off: Math.max(0, (near - want.gap) / step),
                     slide: sl[k] * want.w, railC: railC, pbox: null, beside: false });
        }
      }
    }
  }
  // ...AND BESIDE THE DOT, LEVEL WITH IT, where the event is a slope. The
  // rail leaves the dot at 45 degrees and the paper beside the dot on the
  // other side of the slope is a notch nothing else can use: a name there,
  // ranged towards the dot, is as close as a name gets -- "labels like
  // Detention should have the label on left or right of the slope."
  // Offered on both sides; a flat rail through the words refuses it.
  if (sloped) {
    [[wa0 - want.gap - want.w, c0s], [want.a1 + want.gap, c1s]].forEach(function (bs) {
      // Centred on the mark, or with the words' near edge level with it:
      // against a rising slope the notch is above the dot and the name's
      // bottom row sits level with it, which is the mockup exactly.
      [bs[1] - want.h / 2, bs[1] - want.h + want.gap / 2, bs[1] - want.gap / 2].forEach(function (bc) {
        out.push({ want: want, a: bs[0], c: bc, side: 0, row: 0, off: 0, slide: 0,
                   railC: bs[1], pbox: null, beside: true });
      });
    });
  }
  return out;
}

function posBox(p) {
  return { a0: p.a - p.want.pad, a1: p.a + p.want.w + p.want.pad,
           c0: p.c, c1: p.c + p.want.h };
}

// ---------------------------------------------------------------- the facts
//
// Whether a position is READABLE at all, which is a yes or a no and never a
// price. Everything here is checked against the board's fixed ink -- the
// rails and the edges -- so the answer does not depend on any other caption.

// `near` is the part of the board this candidate can possibly touch, worked
// out once per caption from the envelope of all its candidates (solve):
// every candidate used to be tested against every rail and every piece of
// furniture on the board, and on a seven-line day that was the single
// largest cost of a solve. Absent, the whole board is used.
function readable(p, board, near) {
  var b = posBox(p);
  // A NAME STAYS ON ITS EVENT'S DAY. Across a day boundary the words are
  // read as tomorrow's, and "Moe's Tavern" at half past eleven at night
  // was written into the small hours: "the event labels move over to the
  // other days, that should never be allowed." Not across the cut, and
  // not on the far side of it either.
  var cuts = board.cuts || [];
  for (var di = 0; di < cuts.length; di++) {
    if (p.want.a0 < cuts[di] ? b.a1 > cuts[di] : b.a0 < cuts[di]) return false;
  }
  var lines = near ? near.lines : board.lines;
  var fixed = near ? near.fixed : (board.fixed || []);
  var pills = near ? near.pills : board.pills;
  if (b.a0 < board.axis.a0 || b.a1 > board.axis.a1) return false;
  if (b.c0 < board.cross.c0 || b.c1 > board.cross.c1) return false;
  // A rail through the words, INCLUDING THE CAPTION'S OWN. A name travels
  // with the rail it names only while that rail is flat; once it can climb,
  // its own line is as much in the way as anybody's.
  var ownLine = near ? near.own : (p.want.pill ? null : board.lineByKey(p.want._rail || p.want.line));
  for (var i = 0; i < lines.length; i++) {
    var bb = b;
    // BESIDE THE SLOPE, THE SLOPE MAY TUCK UNDER THE CORNER. A name level
    // with its dot and ranged against it has its own rail leaving the dot
    // at 45 degrees right under its nearest corner: measured to the box the
    // rail touches it by a few pixels, and the mockup's placement was
    // refused every time. Its own rail is tested against the box less a
    // gap on the side facing the dot; every other rail sees the whole box.
    if (p.beside && lines[i] === ownLine) {
      var tuck = p.want.gap * 1.5;
      bb = p.a + p.want.w <= p.want.a0 ? { a0: b.a0, a1: b.a1 - tuck, c0: b.c0, c1: b.c1 }
                                       : { a0: b.a0 + tuck, a1: b.a1, c0: b.c0, c1: b.c1 };
    }
    // (a rail is drawn wider than its centre line -- every style at one
    // weight now -- so the words keep half of it clear too: "Delivery Run"
    // sat with its feet on the Professor's rail)
    if (B.lineTouches(lines[i], { a0: bb.a0, a1: bb.a1, c0: bb.c0 - RAIL_HALF, c1: bb.c1 + RAIL_HALF })) return false;
  }
  // The board's own furniture cannot move, so a name that lands on it loses.
  for (var fi = 0; fi < fixed.length; fi++) {
    // AT A CLEARANCE. The board's furniture is words too -- a line's name, a
    // note, the clock -- and two boxes that merely touch draw with their
    // paper outlines interlocked: "Sam" and "School Run" came out as one
    // string on a board this file had called clean. Same test as between two
    // captions, for the same reason.
    // The clock's line is a hairline a name may cross: "the now line is ok
    // to have captions on".
    if (fixed[fi].kind === 'now') continue;
    if (B.capsOverlap(b, fixed[fi].box())) return false;
    // ...AND NOT BESIDE ANOTHER LINE'S NAME. Set on the same row as "Lisa"
    // and a few pixels after it, Bart's Detention read as Lisa's: "kinda
    // looks like Lisa has Detention here". A name of somebody else's keeps a
    // caption's own height of paper clear along the row either side of it.
    var fb = fixed[fi];
    if (fb.kind === 'terminus' && fb.line && fb.line !== p.want.line) {
      var fx0 = fb.box(), reach = p.want.h;
      if (B.boxesOverlap(b, { a0: fx0.a0 - reach, a1: fx0.a1 + reach, c0: fx0.c0, c1: fx0.c1 })) return false;
    }
  }
  // NOR MAY ITS LEADER CROSS THEM. A name a row or more off its mark is tied
  // to it by a leader straight up from the minute, and that leader was drawn
  // through "Desk booking 8:00-19:00" under Alex's name: the words were clear
  // of the head and the line to them was not.
  // Straight up where the words reach over the minute, else up to their
  // middle and square along into them (draw.js), at a few pixels' clearance.
  if (ownLine && !p.want.pill) {
    var rc = ownLine.cAt(p.want.a0);
    if (rc != null) {
      var over = b.a0 <= p.want.a0 + 1 && p.want.a0 - 1 <= b.a1;
      var midC = (b.c0 + b.c1) / 2;
      var nearC = over ? (b.c0 > rc ? b.c0 : b.c1) : midC;
      var lo = Math.min(rc, nearC), hi = Math.max(rc, nearC);
      if (hi - lo > (p.want.gap || 0) + 2) {
        var legs = [{ a0: p.want.a0 - 3, a1: p.want.a0 + 3, c0: lo, c1: hi }];
        if (!over) legs.push({ a0: Math.min(p.want.a0, b.a1) - 3, a1: Math.max(p.want.a0, b.a0) + 3, c0: midC - 3, c1: midC + 3 });
        for (var fl = 0; fl < fixed.length; fl++) {
          // a head's route row: two rows of words a leader cannot pass
          // between, where a bare name it may clip at a corner
          if (fixed[fl].kind !== 'terminus' || !fixed[fl].route) continue;
          var fb2 = fixed[fl].box();
          for (var lg = 0; lg < legs.length; lg++) {
            if (B.boxesOverlap(legs[lg], fb2)) return false;
          }
        }
      }
    }
  }
  // An interchange bar is the heaviest ink on the board, so words on one are
  // words that are gone.
  // ...EXCEPT A TIE'S BAR, WHICH TUNNELS UNDER THE WORDS: "let the vertical
  // connector tunnel under the caption so the caption can be where it should
  // be". Mensa Meeting stood off to the left of the dinner's bar rather than
  // under its own stop. The bar is cut with paper where a name crosses it
  // (draw.js); only its rings, which say who is there, stay clear.
  for (var pj = 0; pj < pills.length; pj++) {
    // (only a bar its own person is on: a stranger's name across the dinner
    // would read as being at it)
    // and only where the words stand over their own stop, which is the
    // place the bar was keeping them from
    var mineTie = pills[pj].tie && p.want.line && (pills[pj].lines || []).indexOf(p.want.line) >= 0
      && b.a0 <= p.want.a0 + 1 && p.want.a0 - 1 <= b.a1;
    if (!mineTie) { if (B.boxesOverlap(b, pills[pj].box())) return false; continue; }
    if (B.ringHit(board, pills[pj], b)) return false;
    // paid for, a little, so a bar is crossed where that is where the name
    // belongs and not merely because it is paper
    if (B.boxesOverlap(b, pills[pj].box())) p.overBar = true;
  }
  // AND NO OTHER LINE MAY LIE BETWEEN THE WORDS AND THE LINE THEY NAME.
  //
  // This was a preference and it should never have been one. A caption pays
  // for standing further from its rail, so with the price set anywhere
  // sensible the search will happily put a name three bands out rather than
  // give up its time row -- and three bands out, with two rails in between,
  // the reader does not read it as three bands out. They read it as
  // belonging to the line it is next to. "Grocery Delivery" came out under
  // the bottom rail of a two-line board, naming an event on the top one.
  //
  // That is not a tidiness question, it is the board telling the reader
  // something false, so it is a FACT and the position is refused. What the
  // search does instead -- shorten the words, take another row, shed as a
  // last resort -- is then a real choice between real options, which is
  // what the ladder is for.
  var own = ownLine;
  // THE SAME FOR A CONVERGENCE'S NAME AND ITS BOX. Free to sit three rows
  // out for a few points, "Family Dinner" went to the top of the OG board
  // on the far side of Maggie's rail from the dinner, with its leader lying
  // exactly under her descent -- a name that reads as Maggie's. No rail may
  // lie between the words and the box, whichever side they are on.
  // Only from the second row out: against the box there is no paper for a
  // rail to lie in, and the check costs a sample of every rail per
  // candidate.
  if (p.want.pill && p.pbox && p.side && p.row > 0) {
    var pb = p.pbox;
    var bandLo = p.side < 0 ? b.c1 : pb.c1, bandHi = p.side < 0 ? pb.c0 : b.c0;
    for (var jj = 0; jj < lines.length; jj++) {
      var qq = lines[jj], qbb = qq.bounds();
      // Only a rail that reaches into the paper between the words and the
      // box can lie across it; the rest are skipped before any sampling,
      // which is what keeps this cheap enough to ask of every candidate.
      if (qbb.c1 <= bandLo || qbb.c0 >= bandHi) continue;
      if (qbb.a1 < b.a0 || qbb.a0 > b.a1) continue;
      for (var kk = 0; kk < 3; kk++) {
        var att = b.a0 + (b.a1 - b.a0) * (kk / 2);
        if (att < qbb.a0 || att > qbb.a1) continue;
        var qcc = qq.cAt(att);
        if (qcc != null && qcc > bandLo && qcc < bandHi) return false;
      }
    }
  }
  if (own) {
    for (var k = 0; k < 3; k++) {
      var at = b.a0 + (b.a1 - b.a0) * (k / 2);
      var ownC = own.cAt(at);
      // Past the end of its own rail the words still belong to the level
      // they were measured from: a name hanging off a short spur is not free
      // to cross the trunk just because the spur has already halted.
      if (ownC == null) ownC = p.railC;
      if (ownC == null) continue;
      for (var j = 0; j < lines.length; j++) {
        var q = lines[j];
        if (q === own) continue;
        var qb = q.bounds();
        if (at < qb.a0 || at > qb.a1) continue;
        var qc = q.cAt(at);
        if (qc == null) continue;
        if (ownC <= b.c0 && qc > ownC && qc < b.c1) return false;
        if (ownC >= b.c1 && qc < ownC && qc > b.c0) return false;
      }
    }
  }
  return true;
}

// ------------------------------------------------------------ the preferences
//
// How good a readable position is, in one currency, all of it about the
// reader pairing the words with the right stop. Lower is better.

var OVER_BAR = 1, LEFT_OF_MARK = 7000, RAIL_HALF = 3.5;
function price(p) {
  var w = p.want;
  // HOW FAR THE WORDS ARE FROM THE STRETCH OF RAIL THAT IS THEIR EVENT.
  //
  // Measured from the start of the words to the start of the event, sliding
  // a caption a whole width to the left cost about two points -- nothing --
  // so a name drifted off its own event for the smallest tidiness anywhere
  // else. Measured to the SPAN, a caption standing over any part of the
  // thing it names is free, and one that has left it pays by how far.
  var along, lo = p.a, hi = p.a + w.w;
  if (w.pill) {
    // TO THE BOX, not to its middle minute. The enclosure is as long as the
    // event, and a name anywhere along it, or standing against either end
    // of it, is naming it; only a name that has left the box pays.
    var pb = p.pbox;
    if (pb) along = hi < pb.a0 ? pb.a0 - hi : (lo > pb.a1 ? lo - pb.a1 : 0);
    else along = Math.abs((p.a + w.w / 2) - w.a0);
  } else {
    // (the first of a stack is only as long as itself, not its branch)
    var wa1 = w.endAt != null ? w.endAt : w.a1;
    along = hi < w.a0 ? w.a0 - hi : (lo > wa1 ? lo - wa1 : 0);
  }
  // ...and how far off its own rail it stands. A name a band away from its
  // line is a name the reader has to guess the owner of, and it is the
  // expensive thing here, not the cheap one.
  //
  // MEASURED, NOT COUNTED. This was the row index -- how many steps out from
  // whatever point the position was built against -- which is the same thing
  // as the real gap only while the rail is flat under the words. Where the
  // event is a slope it is not: a caption built one row off the rail AT THE
  // DOT can be two bands clear of the rail beside its own words, and counted
  // it looked as cheap as one lying against it.
  var off = p.off != null ? p.off : p.row;
  // FREE WHILE THE MARK IS UNDER THE WORDS, AND STEEP ONCE IT IS NOT.
  //
  // Charged flat, drifting was almost free -- a caption sixty pixels clear
  // of its own dot cost less than two points, so it went wherever was
  // tidiest and "Quick Sync" and "Client Workshop" both came out sitting a
  // long way right of the marks they name. Charged HARD, a caption would
  // rather climb two rows than move sideways, and names ended up three rows
  // off their rail. Both were tried and both are wrong, because the thing
  // being priced is not linear: a few pixels is invisible, and past the
  // point where the mark is no longer under the words the pairing is simply
  // gone.
  //
  // So: nothing at all while the words cover their own mark, and rising
  // sharply after that. It is the same shape the old engine reached for and
  // could not state -- "a caption that has slid more than about half its own
  // width from its mark has stopped pointing at it".
  // ABOVE THE RAIL WHEN NOTHING ELSE DECIDES. Half a point: not a
  // preference the search will spend anything on, only the answer to a tie,
  // and the answer the board this replaces gave -- the name over its mark,
  // read down onto the rail.
  return along * 0.04 + Math.max(0, along - 6) * Math.max(0, along - 6) * 0.04
       + off * off * 25 + Math.abs(p.slide) * 0.01 + (p.side > 0 ? 0.5 : 0) + (p.overBar ? OVER_BAR : 0)
       // WHOLLY BEHIND ITS OWN STOP, the last resort: "2 line the label and
       // move to the right". Priced past a folded name (a form's rung, see
       // bands.js), so a long name folds and stands after its mark before it
       // ends at it.
       + (!w.pill && p.slide <= -w.w + 0.5 ? LEFT_OF_MARK : 0);
}

// --------------------------------------------------------------- the solve
//
// Facts first, then preferences, then the one thing neither can express on
// its own: two captions wanting the same paper. That pair cost is why this is
// a search rather than a sort.
//
// Greedy seed, then simulated annealing over "move one caption to another of
// its own positions". The seed is in start-time order, which is the order a
// reader scans in, so a board with room comes out in reading order and the
// annealing only has to work where there is not room.

// WHICH MARK A READER WOULD PAIR THESE WORDS WITH.
//
// What a reader actually does is claim the marks the words lie over, and
// failing that the nearest one at that level. So the distance is to the BOX:
// nothing at all while a dot is under the words, and the gap beyond them
// otherwise. A caption that covers somebody else's dot and not its own is
// exactly what it looks like; one placed to the left of its own dot, clear
// of its neighbour, is fine.
//
// COVERING TWO MARKS IS AMBIGUOUS EVEN WHEN ONE OF THEM IS YOURS. A reader
// cannot pick between two marks under one name; it does not matter that one
// of them is the right one.
//
// Other marks are filtered by LEVEL -- a name is only mistakable for
// something on the rail it is sitting against -- and its own is not, because
// when an event IS a step the diagonal carries its caption to a level its
// own dot is not at.
//
// THIS LIVES HERE, WITH THE CAPTION SEARCH, AND NOT ONLY IN THE BAND
// SEARCH'S PRICE. Priced only at the board level it was invisible to the
// captions themselves: a name slid over its neighbour's dot whenever that
// was a point tidier, and the only thing that could undo it was the band
// search finding a step that moved the two marks to different levels. On the
// OG demo board that step stopped fitting the day a spur took its room, and
// "Detention" sat over Skate Park's dot with a clean slide to its left going
// unused. A caption that knows the price picks the slide.
function markDots(wants, board) {
  var dots = [];
  wants.forEach(function (w, i) {
    if (w.pill) return;
    var ln = board.lineByKey(w._rail || w.line);
    if (!ln) return;
    var c = ln.cAt(w.a0);
    if (c == null) return;
    dots.push({ i: i, a: w.a0, a1: w.a1, c: c });
    // a crowded stretch's other dots are its own too, and somebody else's
    // name over one of them is over a mark that is not theirs
    (w.members || []).forEach(function (a) {
      var cm = ln.cAt(a);
      if (cm != null) dots.push({ i: i, a: a, a1: a, c: cm, member: true });
    });
  });
  return dots;
}
function muddledAt(p, i, dots, minLift, cache) {
  var w = p.want;
  if (w.pill) return false;
  var lo = p.a, hi = p.a + w.w;
  // The marks at this level, found once per want and level rather than once
  // per candidate: a solve asks this for every candidate of every name, and
  // the level filter is most of the work.
  //
  // Nested by `i` then the rounded level, not a `i + ':' + level` string:
  // this runs once per candidate of every name, and building a string just
  // to key an object with it was pure allocation this cache exists to avoid
  // in the first place.
  var byI = cache[i] || (cache[i] = {});
  var rc = Math.round(p.railC), level = byI[rc];
  if (!level) {
    level = byI[rc] = { own: null, near: [] };
    for (var d0 = 0; d0 < dots.length; d0++) {
      if (dots[d0].i === i) { if (!dots[d0].member) level.own = dots[d0]; }
      else if (Math.abs(dots[d0].c - p.railC) <= minLift) level.near.push(dots[d0]);
    }
  }
  var best = -1, bestD = Infinity, tied = 0, own = level.own;
  for (var d = 0; d < level.near.length; d++) {
    var da = level.near[d].a, dist = da < lo ? lo - da : (da > hi ? da - hi : 0);
    if (dist < bestD - 0.001) { bestD = dist; best = level.near[d].i; tied = 1; }
    else if (dist < bestD + 0.001) tied++;
  }
  if (own) {
    // ITS OWN MARK IS ITS WHOLE EVENT. An eight-hour "Desk booking" has one
    // dot at eight in the morning and its name is wherever along the day
    // there is room for it; measured to the dot alone, the name was
    // "nearest" every other dot on the rail wherever it stood, and the only
    // way the board could clear the fault was to move somebody else's mark
    // to another level. The words over any part of the event are on it.
    var oa1 = own.a1 > own.a ? own.a1 : own.a;
    var od = hi < own.a ? own.a - hi : (lo > oa1 ? lo - oa1 : 0);
    if (od < bestD - 0.001) { bestD = od; best = i; tied = 1; }
    else if (od < bestD + 0.001) { bestD = od; best = i; tied++; }
  }
  return best >= 0 && (best !== i || tied > 1);
}

function solve(wants, board, opts) {
  opts = opts || {};
  var n = wants.length;
  var cache = opts.cache || null;
  var cands = wants.map(function (w) {
    // THE PART OF THE BOARD THESE CANDIDATES CAN REACH, once per caption:
    // the rows either side of its own rail (or its bar), a name's width
    // beyond the event at each end. Only what is in it can refuse a
    // candidate, so only that is tested -- and only that has to be the
    // same for the answer to be the same.
    var own = w.pill ? null : board.lineByKey(w._rail || w.line);
    var pill = null;
    if (w.pill) for (var pi = 0; pi < board.pills.length; pi++) if (board.pills[pi].id === w.pill) pill = board.pills[pi];
    var reach = w.gap + (opts.rows || 4) * (w.h + 3) + w.h + w.pad + 4;
    var ob = own ? own.bounds() : (pill ? pill.box() : null);
    if (!ob) return [];
    // FROM THE CANDIDATES THEMSELVES. Guessed as a name's width either side
    // of the event, the envelope was narrower than a caption that slides:
    // "Groceries" set a long way right of its mark was never tested against
    // "Sam" at the edge, and was written against it.
    var ps0 = positions(w, board, opts, own);
    var env = { a0: w.a0 - w.w * 1.2 - w.pad - 4, a1: w.a1 + w.w * 1.2 + w.pad + 4,
                c0: ob.c0 - reach, c1: ob.c1 + reach };
    ps0.forEach(function (p) {
      var pb = posBox(p);
      env.a0 = Math.min(env.a0, pb.a0 - w.h); env.a1 = Math.max(env.a1, pb.a1 + w.h);
      env.c0 = Math.min(env.c0, pb.c0); env.c1 = Math.max(env.c1, pb.c1);
    });
    var m = B.CAP_CLEAR + 1;
    var near = {
      own: own,
      lines: board.lines.filter(function (l) {
        var lb = l.bounds();
        return l === own || !(lb.a1 < env.a0 || lb.a0 > env.a1 || lb.c1 <= env.c0 || lb.c0 >= env.c1);
      }),
      fixed: (board.fixed || []).filter(function (f) {
        var fb = f.box();
        return !(fb.a1 < env.a0 - m || fb.a0 > env.a1 + m || fb.c1 < env.c0 - m || fb.c0 > env.c1 + m);
      }),
      pills: board.pills.filter(function (pl) {
        var pb = pl.box();
        return !(pb.a1 < env.a0 || pb.a0 > env.a1 || pb.c1 < env.c0 || pb.c0 > env.c1);
      }),
    };
    // REMEMBERED ACROSS TRIALS. The band search prices hundreds of boards
    // that differ in one gap or one move, and on most of them most
    // captions see exactly the rails and furniture they saw last time.
    // The key is everything a candidate's readability depends on: the
    // words' size, the rail they hang off, and what is near.
    var key = null;
    if (cache) {
      key = w.id + '|' + w.w + 'x' + w.h + '|' + (w._rail || w.line || w.pill) + '|';
      near.lines.forEach(function (l) { key += l.key + ':' + ptsKey(l.pts) + ';'; });
      near.fixed.forEach(function (f) { var fb = f.box(); key += f.id + ':' + fb.a0 + ',' + fb.a1 + ',' + fb.c0 + ',' + fb.c1 + ';'; });
      near.pills.forEach(function (pl) { key += pl.id + ':' + pl.a + ',' + pl.a0 + ',' + pl.a1 + ',' + pl.c0 + ',' + pl.c1 + ',' + pl.r + ',' + pl.tie + ';'; });
      key += '|' + (board.cuts || []).join(',') + '|' + board.axis.a0 + ',' + board.axis.a1 + ',' + board.cross.c0 + ',' + board.cross.c1;
      if (cache[key]) return cache[key];
    }
    var ps = ps0.filter(function (p) { return readable(p, board, near); });
    if (cache) cache[key] = ps;
    return ps;
  });
  // Every candidate knows whether a reader could mistake it, before any
  // price is paid.
  var dots = markDots(wants, board);
  var minLift = opts.minLift != null ? opts.minLift : 14;
  var MUD = opts.muddlePrice != null ? opts.muddlePrice : 40000;
  var levels = {};
  for (var ci = 0; ci < n; ci++) {
    var cl = cands[ci];
    for (var cj = 0; cj < cl.length; cj++) cl[cj].mud = muddledAt(cl[cj], ci, dots, minLift, levels);
  }
  // SHED, NOT DRAWN BADLY. A caption with no readable position anywhere is
  // not placed on top of something: it is left off and reported. A board that
  // says "I could not fit this" is honest; one that writes two names in the
  // same place has lost one of them and says nothing.
  var pick = new Array(n).fill(-1);
  // A BOARD WITH NOTHING TO NAME IS A BOARD, and it used to crash: the
  // annealer picked a random caption out of none and read a property of
  // undefined. A quiet day with no events is the most ordinary input there
  // is.
  if (!n) return { pick: pick, cands: cands, energy: 0, shed: 0 };
  for (var i = 0; i < n; i++) if (cands[i].length) pick[i] = 0;

  // AN OVERLAP COSTS MORE THAN NOT DRAWING, and getting that the wrong way
  // round is what the old pass did.
  //
  // The two are not the same kind of loss. A name left off loses ONE name and
  // the board is honest about it: there is a gap where something would have
  // been, and the ladder above can respond by making the text smaller. Two
  // names written on each other loses BOTH -- neither is readable -- and
  // says nothing, so every pass downstream reasons about a board with two
  // captions on it that the reader does not have.
  //
  // So shedding must be the cheaper way out of a collision, always. Priced
  // the other way the solver stacks, which is exactly what it did the first
  // time this case was run: "Event 3" written a hundred pixels across "Event
  // 4" while a shed would have cost nothing at all.
  // A NAME NOT DRAWN IS THE WORST THING ON THE BOARD, so it is priced above
  // every other loss put together rather than merely above each of them.
  //
  // At 20000 it was comparable with giving up a few time rows: a tight board
  // worked out that shedding ONE name cost less than shortening six, and
  // dropped an event. That is the wrong trade at any count -- a caption
  // without its time is still a caption, and an event nobody drew is a thing
  // that happened and was not told.
  var SHED = 200000, CLASH = 300000;
  // A SHARED EVENT'S NAME IN A ROW OF SOMEBODY ELSE'S. "School Day" stood
  // between Maggie's Playgroup and Nap, level with them, a row above the
  // corridor it names, and read as Maggie's: a name is read with the names in
  // line with it. A corridor's name level with the names of a line that is
  // not in it, and near them along the axis, costs what a mistakable name
  // does.
  var pillLines = {};
  (board.pills || []).forEach(function (pl) { if (!pl.tie) pillLines[pl.id] = pl.lines; });
  function rowMate(pw, ow, pa, ob) {
    var lines = pillLines[pw.pill];
    if (!lines || ow.pill || lines.indexOf(ow.line) >= 0) return false;
    var overlap = Math.min(pa.c1, ob.c1) - Math.max(pa.c0, ob.c0);
    if (overlap < Math.min(pa.c1 - pa.c0, ob.c1 - ob.c0) * 0.5) return false;
    var apart = pa.a0 > ob.a1 ? pa.a0 - ob.a1 : (ob.a0 > pa.a1 ? ob.a0 - pa.a1 : 0);
    return apart < Math.max(pa.c1 - pa.c0, ob.c1 - ob.c0) * 4;
  }
  function pairCost(i, j) {
    if (pick[i] < 0 || pick[j] < 0) return 0;
    var a = posBox(cands[i][pick[i]]), b = posBox(cands[j][pick[j]]);
    var wi = wants[i], wj = wants[j];
    if ((wi.pill && rowMate(wi, wj, a, b)) || (wj.pill && rowMate(wj, wi, b, a))) return MUD;
    // At a CLEARANCE, not at contact: two boxes that merely touch draw with
    // their paper outlines interlocked and read as one word. See capsOverlap.
    if (!B.capsOverlap(a, b)) {
      // CLOSE IS NOT CLEAN. Two names a pad apart read as one block --
      // "move Book Club down because it's too close to School Run" -- so
      // standing within two pads of another name costs a little, well under
      // a row, and a name with somewhere else to be moves there.
      var near = a.a0 < b.a1 + 8 && b.a0 < a.a1 + 8 && a.c0 < b.c1 + 8 && b.c0 < a.c1 + 8;
      return near ? 30 : 0;
    }
    var ov = Math.max(0, Math.min(a.a1, b.a1) - Math.max(a.a0, b.a0))
           * Math.max(0, Math.min(a.c1, b.c1) - Math.max(a.c0, b.c0));
    return CLASH + ov * 4;
  }
  function energy() {
    var e = 0;
    for (var i = 0; i < n; i++) {
      if (pick[i] < 0) { e += SHED; continue; }
      e += price(cands[i][pick[i]]) + (cands[i][pick[i]].mud ? MUD : 0);
      for (var j = i + 1; j < n; j++) e += pairCost(i, j);
    }
    return e;
  }
  // Greedy seed: each caption takes its cheapest position given those already
  // placed, IN TIME ORDER -- which is the order a reader scans in, and which
  // has to be worked out here rather than assumed of the list.
  //
  // Taking the list's own order made the solver depend on how the caller
  // happened to build it: the reflection cases solve the same board with the
  // day running backwards, and the same problem came out worse because the
  // seed met the events in the opposite sequence. A layout that changes when
  // an input list is reordered is not a layout anyone can rely on.
  var order = [];
  for (i = 0; i < n; i++) order.push(i);
  order.sort(function (x, y) {
    return (wants[x].a0 - wants[y].a0) || (x - y);
  });
  for (var oi = 0; oi < n; oi++) {
    i = order[oi];
    if (pick[i] < 0) continue;
    var best = -1, bestE = SHED;      // not drawing it is always on the table
    for (var k = 0; k < cands[i].length; k++) {
      pick[i] = k;
      var e = price(cands[i][k]) + (cands[i][k].mud ? MUD : 0);
      for (var oj = 0; oj < oi; oj++) e += pairCost(i, order[oj]);
      if (e < bestE) { bestE = e; best = k; }
    }
    pick[i] = best;
  }
  // ...THEN LET THEM TRADE, AND DO IT THE SAME WAY EVERY TIME.
  //
  // A greedy pass cannot see that giving the first name its second choice
  // leaves the next two clean, and no amount of tuning the prices teaches it
  // that. Something has to look again once everything is down.
  //
  // This was simulated annealing, and annealing was the wrong tool here. It
  // was deterministic per input -- fixed seed, same board every run -- but
  // it was SEED-SENSITIVE, which is worse than it sounds: measured on one
  // tight board, the same input gave between one and eight mispaired names
  // depending only on which arbitrary seed had been picked. A search whose
  // answer is that dependent on a number nobody chose for a reason cannot be
  // reasoned about, and "it happens to be seeded well" is not a property
  // anyone can rely on.
  //
  // ITERATED BEST RESPONSE instead. Every caption, in a fixed order, moves to
  // its own best position given where everything else currently is. Repeat
  // until a whole pass changes nothing. It is deterministic with no seed at
  // all, the energy falls monotonically so it always terminates, and the
  // fixed point it reaches is one where no single caption can improve itself
  // -- which is exactly the claim the annealer could only make on average.
  //
  // NOT BEING DRAWN IS ONE OF THE POSITIONS. Without it a name with nowhere
  // clean to go stays on top of its neighbour however dearly that is priced:
  // the way out was unreachable rather than unaffordable. A shed caption can
  // come back too, which is what lets a board un-shed one once its neighbour
  // has moved.
  var E = energy();
  var rounds = opts.iters === 0 ? 0 : (opts.rounds || 12);
  for (var pass = 0; pass < rounds; pass++) {
    var moved = false;
    for (var oi2 = 0; oi2 < n; oi2++) {
      var idx = order[oi2];
      if (!cands[idx].length) continue;
      var was = pick[idx], bestK = was, bestE2 = E;
      for (var k2 = -1; k2 < cands[idx].length; k2++) {
        if (k2 === was) continue;
        pick[idx] = k2;
        var E2 = energy();
        // Strictly better only, so a tie never starts the search cycling
        // between two equal answers and the result does not depend on which
        // of them was tried first.
        if (E2 < bestE2 - 1e-9) { bestE2 = E2; bestK = k2; }
      }
      pick[idx] = bestK;
      if (bestK !== was) { E = bestE2; moved = true; }
    }
    if (!moved) break;
  }
  var bestPick = pick.slice(), bestEn = E;
  var result = { pick: bestPick, cands: cands, energy: bestEn,
                 shed: bestPick.filter(function (p) { return p < 0; }).length };
  // TWO NAMES MOVED AT ONCE, for the one board that ships (bands.js calls it
  // on the winner only). Best response moves one caption at a time, and a
  // name standing a long way from its dot is usually there because the paper
  // beside the dot is a neighbour's: neither move pays on its own, both
  // together do. "Skate Park" stood past the interchange, two dots right of
  // its own, with the notch under its dot free once Detention moved over.
  result.polish = function () {
    function local(i) {
      if (pick[i] < 0) return SHED;
      var e = price(cands[i][pick[i]]) + (cands[i][pick[i]].mud ? MUD : 0);
      for (var j = 0; j < n; j++) if (j !== i) e += pairCost(i, j);
      return e;
    }
    function adrift(i) {
      if (pick[i] < 0 || wants[i].pill) return false;
      var p = cands[i][pick[i]], w = wants[i], wa1 = w.endAt != null ? w.endAt : w.a1;
      var along = p.a + w.w < w.a0 ? w.a0 - p.a - w.w : (p.a > wa1 ? p.a - wa1 : 0);
      return along > Math.max(12, w.h / 2) || (p.off != null ? p.off : p.row) >= 1;
    }
    var gained = false;
    for (var oi3 = 0; oi3 < n; oi3++) {
      var i3 = order[oi3];
      if (!adrift(i3)) continue;
      var was = pick[i3], base = local(i3), curP = price(cands[i3][was]) + (cands[i3][was].mud ? MUD : 0);
      // only where the name itself would be better off
      var better = [];
      for (var k3 = 0; k3 < cands[i3].length; k3++) {
        var pc = price(cands[i3][k3]) + (cands[i3][k3].mud ? MUD : 0);
        if (k3 !== was && pc < curP - 1) better.push([pc, k3]);
      }
      better.sort(function (x, y) { return x[0] - y[0]; });
      var done = false;
      for (var bi = 0; bi < better.length && bi < 24 && !done; bi++) {
        pick[i3] = better[bi][1];
        var hit = [];
        for (var j3 = 0; j3 < n; j3++) if (j3 !== i3 && pairCost(i3, j3) >= CLASH) hit.push(j3);
        if (hit.length > 1) continue;
        if (!hit.length) {
          if (local(i3) < base - 1e-9) { done = true; }
          continue;
        }
        var jj = hit[0], wasJ = pick[jj];
        pick[i3] = was;
        var before = base + local(jj) - pairCost(i3, jj);
        pick[i3] = better[bi][1];
        var bestJ = -2, bestV = before;
        for (var k4 = 0; k4 < cands[jj].length; k4++) {
          if (k4 === wasJ) continue;
          pick[jj] = k4;
          var v = local(i3) + local(jj) - pairCost(i3, jj);
          if (v < bestV - 1e-9) { bestV = v; bestJ = k4; }
        }
        if (bestJ >= 0) { pick[jj] = bestJ; done = true; } else pick[jj] = wasJ;
      }
      if (done) gained = true; else pick[i3] = was;
    }
    if (!gained) return false;
    result.pick = pick.slice();
    result.energy = energy();
    result.shed = result.pick.filter(function (p) { return p < 0; }).length;
    return true;
  };
  return result;
}

// Put the solution on the board.
function apply(board, wants, sol) {
  wants.forEach(function (w, i) {
    var k = sol.pick[i];
    if (k < 0) return;
    var p = sol.cands[i][k];
    board.addCap({ id: w.id, pill: w.pill, text: w.shown || w.text, line: w._rail || w.line,
                   a: p.a, c: p.c, w: w.w, h: w.h, at: w.a0,
                   rows: w.rows, size: w.size, rowCls: w.rowCls, el: w.el });
  });
  return board;
}


module.exports = { Want: Want, positions: positions, readable: readable,
                   price: price, solve: solve, apply: apply, posBox: posBox };
