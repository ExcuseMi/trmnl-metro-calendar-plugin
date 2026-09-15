'use strict';

// CHOOSING THE PAPER AND THE WORDS ON IT AS ONE QUESTION.
//
// This is the half the old engine structurally cannot do. Its band solver is
// handed, per line, a key and four COUNTS -- how many shared events, whether
// it has marks, whether it leans, whether something pierced it last time --
// plus one aggregate "demand" measured by a probe. No caption, no box, no
// position. It sizes the paper and only afterwards does anything try to put
// words on it.
//
// Everything bolted onto that engine since is a workaround for the same
// missing fact. `settleSides` draws the board, COUNTS THE PIERCED LABELS and
// solves again. `inwardNeed` and `laneFloor` carry what a drawn board taught
// back into the next solve as flags. `capBlocks` is a side channel telling
// the lane placer about captions the solver never modelled. The tier loop
// draws the whole board four times at four text sizes and keeps the best.
// Five mechanisms, all of them answering "but where did the words actually
// go" after the fact.
//
// Asked directly, the question is not hard. The gap between two lines is
// where their captions live, so the right size for it is the size its
// captions need, and the only way to know that is to try to place them.
//
// WHAT IS SEARCHED. Not the baselines: the GAPS. A board with N lines has
// N+1 gaps -- edge to first line, between each pair, last line to edge -- and
// they sum to the paper. Moving space from one gap to another is one move,
// every allocation is valid by construction, and the search never has to
// think about ordering or overlap. The line ORDER is not searched here: it
// comes from the configuration (which side a person is on, their offset), and
// a reader who has learned where their own line is should not find it
// somewhere else tomorrow.
//
// WHAT IT COSTS. An allocation is priced by PLACING THE CAPTIONS ON IT, which
// is the only honest answer to "is this the right paper". Greedily, with no
// annealing: a few hundred microseconds, deterministic, and an upper bound on
// what the full solve will manage. The full solve then runs once, on the
// allocation that won.

var B = require('./board');
var { Board, bumps } = require('./board');
var C = require('./captions');
var R = require('./rails');

// ONE STATE, TWO KINDS OF DECISION, AND THEY ARE THE SAME QUESTION.
//
// A state is the gaps between the lines AND which events make their rail step
// aside. Searching them separately is the mistake the old engine makes one
// level up: a step moves a rail into the gap beside it, so how deep that gap
// wants to be and whether the rail steps into it cannot be answered apart.
//
// `steps` is one entry per want: 0 for a flat rail, or a signed depth. Only
// events with a real duration can step -- a rail cannot run at a level for no
// time at all -- so a moment keeps its rail and gets a dot.
function boardFor(spec, st) {
  var b = new Board({ axis: spec.axis, cross: spec.cross, cuts: spec.cuts });
  var c = spec.cross.c0, base = {};
  spec.lines.forEach(function (ln, i) { c += st.gaps[i]; base[ln.key] = c; });
  // WHERE THE TRACKS MEET, worked out before a single rail is drawn.
  //
  // A convergence is the one move on this board that belongs to several
  // lines at once, so it cannot be decided line by line: the level each rail
  // runs at through the event depends on who else is in it. It is settled
  // here, from the BASELINES -- which are the thing the band search chose and
  // are known for every line before any of them has moved -- so the answer
  // does not depend on the order the rails happen to be built in.
  //
  // The bundle is centred on the middle of the rows it joins, and the
  // members keep their own order inside it: a reader who knows their line is
  // the second from the top finds it second in the bundle too. One rail gap
  // apart, which is what the rest of the board keeps between two lines and
  // therefore what reads as "together but still two lines".
  var meets = {}, bundles = {}, ties = {};
  // IN TIME ORDER, because a rail coming out of one group straight into the
  // next arrives from that group's level and not from its home row, and the
  // corner nesting below has to know where each rail is coming FROM.
  var lastMeet = {};
  (spec.pills || []).slice().sort(function (x, y) {
    return (x.a0 == null ? x.a : x.a0) - (y.a0 == null ? y.a : y.a0);
  }).forEach(function (p) {
    var mine = (p.lines || []).filter(function (k) { return base[k] != null; });
    if (mine.length < 2) return;
    // A BRIEF SHARED EVENT IS ONE BAR ACROSS THE LINES WHERE THEY ARE. The
    // school run is half an hour; bringing three rails together and apart
    // for it was a knot, and a bar with a ring on each line says the same
    // thing in one stroke. Only a long one -- the school day -- runs the
    // lines together, with a bar at each end.
    var pa0 = p.a0 == null ? p.a : p.a0, pa1 = p.a1 == null ? p.a : p.a1;
    if (p.tie || pa1 - pa0 <= spec.markR * 4) { ties[p.id] = p; return; }
    mine = mine.slice().sort(function (x, y) { return base[x] - base[y]; });
    var lo = base[mine[0]], hi = base[mine[mine.length - 1]];
    var gap = spec.tieGap;
    var span = gap * (mine.length - 1);
    var top = (lo + hi) / 2 - span / 2;
    // On the paper, always: a bundle centred between the top line and the
    // bottom one is already inside the board, but a board with two lines
    // very close to an edge can still push it off.
    top = Math.max(spec.cross.c0 + gap, Math.min(spec.cross.c1 - gap - span, top));
    var a0 = p.a0 == null ? p.a : p.a0, a1 = p.a1 == null ? p.a : p.a1;
    // THE CORNERS NEST. Two rails arriving from the same side turn at the
    // same minute and the outer one's drop runs straight down the inner
    // one's: on the OG demo Maggie's solid rail vanished under Homer's
    // dotted one for the whole approach to dinner, and Lisa's climb out of
    // the school run into the school day was drawn under Bart's. Two
    // parallel lines take one corner with the inner one turning first and
    // the outer wrapping round it, so the rail further from the bundle
    // turns LATER on the way in and EARLIER on the way out -- a gap and a
    // half along the axis per rank, the offset two 45 degree runs need to
    // stay a gap apart. Never so much that a short event loses the run
    // where the rails are actually together.
    var origin = {};
    mine.forEach(function (k) {
      var lm = lastMeet[k];
      origin[k] = lm && a0 - lm.a1 <= spec.leadCap ? lm.c : base[k];
    });
    // LATE, OR LEAVING EARLY, WHEN SOMETHING ELSE OVERLAPS. Lisa's Mensa
    // Meeting runs to half past seven and the dinner starts at seven: she
    // is not at the dinner from the start, and a rail that dived into the
    // bundle at seven with her meeting's tick inside the box said she was.
    // Her rail stays on her own event and joins when it ends -- and leaves
    // early for anything that starts before the group is over. The box is
    // still the whole event; it is her attendance that is partial.
    var centre = top + span / 2;
    function window_(k) {
      var from = a0, to = a1;
      spec.wants.forEach(function (w) {
        if (w.pill || w.allDay || w.line !== k) return;
        if (w.a0 >= a0 - 0.5 && w.a1 <= a1 + 0.5) return;   // inside: a branch, see below
        if (w.a0 < a0 && w.a1 > a0) from = Math.max(from, Math.min(w.a1, a1 - gap));
        if (w.a0 > a0 && w.a0 < a1) to = Math.min(to, Math.max(w.a0, a0 + gap));
      });
      // A TIE JUST BEFORE THE GROUP: the school run's ring is on the row at
      // eight, and the rail turning for the school day at the same minute
      // put its diamond through the ring. The rail stays in its row until
      // the ring, the diamond and the corner have had their room, and joins
      // late by however much that takes.
      Object.keys(ties).forEach(function (id) {
        var t = ties[id];
        if (t.lines.indexOf(k) < 0 || t.a >= a1 || t.a < a0 - spec.leadCap - spec.markR * 4 - spec.corner) return;
        var lead = Math.min(spec.leadCap, Math.max(0, Math.abs(base[k] - centre) - gap / 2));
        var clear = t.a + spec.markR * 1.7 + spec.corner + lead;
        // ...but not at the price of an event of its own. With the lead, the
        // school run's clearance ran past Lisa's nine o'clock assembly, so the
        // assembly was drawn on her own row before the school day's diamond.
        // Where something of hers starts inside that run, she turns upright
        // instead and is in the group before it.
        // ...the WHOLE GROUP, because the diamond stands where the last of
        // them has arrived: Lisa turning tight and Bart taking his lead
        // still put the diamond after her assembly began.
        var cramped = spec.wants.some(function (w) {
          return !w.pill && !w.allDay && mine.indexOf(w.line) >= 0 && t.lines.indexOf(w.line) >= 0
            && w.a0 > t.a && w.a0 < clear && w.a0 >= a0 - 0.5;
        });
        if (cramped) clear = t.a + spec.markR * 1.7 + spec.corner;
        if (clear > from) from = Math.min(clear, a1 - gap);
      });
      // A STOP OF ITS OWN RIGHT AFTER JOINING used to hold the rail out of
      // the group until it was over, as a shelf on her own row: the spur had
      // looked cramped leaving from the arc she was still turning on. Read
      // on the board it said the opposite of the day -- Lisa's rail stayed
      // home, Assembly was drawn there, and the school day's diamond came
      // after it: "Assembly is before school day but that's incorrect." She
      // joins when the group starts, and the assembly spurs out of it after
      // the corner (see nestedIn and the spur's floor below).
      return [from, to];
    }
    // THE LATE JOINER TAKES THE OUTSIDE TRACK. Lisa reaches the dinner at
    // half past seven, and placed by her home row she was the third of four
    // levels: her climb in crossed Marge, already there on the fourth, and
    // the box read as a knot. On each side of the bundle the latest to
    // arrive is the outermost, so a late rail climbs into the group past
    // nobody. It may have to weave on the way home; that is one crossing in
    // the open, not one inside the box.
    var wins = {};
    mine.forEach(function (k) { wins[k] = window_(k); });
    var abv = mine.filter(function (k) { return origin[k] < centre; });
    var blw = mine.filter(function (k) { return origin[k] >= centre; });
    abv.sort(function (x, y) { return (wins[y][0] - wins[x][0]) || (base[x] - base[y]); });
    blw.sort(function (x, y) { return (wins[x][0] - wins[y][0]) || (base[x] - base[y]); });
    mine = abv.concat(blw);
    var nA = abv.length, nB = blw.length;
    // ONE MANNER FOR THE WHOLE GROUP. A rail close to the bundle would take
    // a 45 degree lead and one far from it an upright turn, and side by side
    // they were two different corners: "these still aren't the exact same
    // corners." If any member has to turn upright, every member does, and
    // the corners are the same shape at the same radius, one gap apart.
    var uprightAll = mine.some(function (k, i) {
      return Math.abs(origin[k] - (top + i * gap)) > spec.leadCap;
    });
    // IN THROUGH THE LEFT WALL, OUT THROUGH THE RIGHT. "Grouped event should
    // be joined from the left side always unless joining late." A rail that
    // is there from the start turns BEFORE the box and enters it level, so
    // the reader sees each track arrive along the axis and pass through the
    // wall; only a rail that joins late, or leaves early, comes through the
    // top or bottom at its own minute. The turns nest outward: the outermost
    // level turns nearest the box and rounds the widest, each level inward
    // one gap further out and one gap tighter, so the arcs are concentric.
    var recs = [];
    mine.forEach(function (k, i) {
      var c = top + i * gap, above = i < nA;
      var win = wins[k], ka0 = win[0], ka1 = win[1];
      var out = above ? i : (mine.length - 1 - i);      // 0 = outermost on its side
      var nSide = above ? nA : nB;
      var late = ka0 > a0 + 0.5, early = ka1 < a1 - 0.5;
      // A rail coming straight out of the previous group has no run to turn
      // in; it changes level at the boundary, nested by rank as before.
      var lm = lastMeet[k], chained = !!(lm && a0 - lm.a1 <= spec.leadCap);
      var rank = 0;
      mine.forEach(function (q, j) {
        if (q === k) return;
        var qc = top + j * gap;
        if ((origin[q] < qc) !== (origin[k] < c)) return;
        if (origin[k] < c ? origin[q] > origin[k] : origin[q] < origin[k]) rank++;
      });
      var upright = uprightAll;
      var cap = Math.max(0, (ka1 - ka0 - gap) / 2);
      // AND NOT ON THE SAME COLUMN AS THE OTHER SIDE. The outermost rail
      // above and the outermost below were both "out 0", so one turning up
      // and one turning down left the group on one column and read as ONE
      // line with a gap in it. The side below turns half a gap further out.
      var wall = spec.markR + gap * (out + 1) + (above || !nA ? 0 : gap / 2);
      var sgIn = late ? 0 : wall, sgOut = early ? 0 : wall;
      recs.push({ k: k, i: i, c: c, above: above, out: out, nSide: nSide, rank: rank,
                  chained: chained, upright: upright, ka0: ka0, ka1: ka1,
                  sgIn: sgIn, sgOut: sgOut, sgChain: Math.min(cap, rank * gap * (upright ? 1 : 1.4)),
                  // the legs either side of each corner at the bundle
                  legIn: Math.abs(origin[k] - c), legOut: Math.abs(base[k] - c),
                  run: (ka1 + sgOut) - (ka0 - sgIn) });
    });
    // CONCENTRIC, AND THE RIGHT WAY ROUND. Two rails a gap apart taking one
    // corner keep a gap apart only if the arcs share a centre: the rail on
    // the INSIDE of the turn rounds at the base radius and each rail outward
    // rounds a gap wider. Equal radii offset by a gap part by four tenths of
    // a gap in the middle of the bend -- "I can visually see the distance
    // between tracks increases in the turn." At the corner where a rail
    // reaches its level in the bundle, and at the one where it leaves it,
    // the outermost level is on the inside of the turn; where a rail turns
    // out of one bundle straight into the next, the one that turns first is
    // inside at the bottom corner and outside at the top.
    //
    // AND THE BASE RADIUS IS WHAT THE SHORTEST LEG IN THE GROUP ALLOWS. The
    // renderer pulls a corner back by at most half its shorter leg, so a
    // rail joining from close by had its wider radius clipped and its arc
    // fell off the shared centre -- the School Run's two rails climbing into
    // the school day were a gap apart on the straights and wider in the
    // bend. Each corner now carries its own radius, chosen so that every
    // member of the group fits its legs at radius plus rank times gap.
    function baseRadius(side, leg, rankOf) {
      var r = spec.corner;
      side.forEach(function (m) {
        r = Math.min(r, Math.min(leg(m), m.run) / 2 - rankOf(m) * gap);
      });
      return Math.max(2, r);
    }
    [true, false].forEach(function (aboveSide) {
      var side = recs.filter(function (m) { return m.above === aboveSide; });
      if (!side.length) return;
      var rIn = baseRadius(side, function (m) { return m.legIn; }, function (m) { return m.out; });
      var rOut = baseRadius(side, function (m) { return m.legOut; }, function (m) { return m.out; });
      var chainedSide = side.filter(function (m) { return m.chained; });
      var rFirst = chainedSide.length
        ? baseRadius(chainedSide, function (m) { return m.legIn; }, function (m) { return m.rank; }) : null;
      side.forEach(function (m) {
        m.rIn = rIn + m.out * gap;
        m.rOut = rOut + m.out * gap;
        m.rFirst = m.chained && rFirst != null ? rFirst + m.rank * gap : null;
      });
    });
    // The same at a member's own minute: one joining late above and one
    // below at the same minute climbed and dived on one column. The one
    // below arrives half a gap later and leaves half a gap sooner, inside
    // its own time.
    recs.forEach(function (m) {
      if (m.above) return;
      var twin = function (edge, key) {
        return recs.some(function (q) { return q.above && q[key] === 0 && Math.abs(q[edge] - m[edge]) < gap / 2; });
      };
      if (m.sgIn === 0 && twin('ka0', 'sgIn')) m.sgIn = -gap / 2;
      if (m.sgOut === 0 && twin('ka1', 'sgOut')) m.sgOut = -gap / 2;
    });
    var moves = [];
    recs.forEach(function (m) {
      var mv = { kind: 'meet', line: m.k, a0: m.ka0, a1: m.ka1, c: m.c, upright: m.upright,
        sgIn: m.sgIn, sgOut: m.sgOut, sgChain: m.sgChain,
        rIn: m.rIn, rOut: m.rOut, rFirst: m.rFirst };
      (meets[m.k] = meets[m.k] || []).push(mv);
      moves.push(mv);
      lastMeet[m.k] = { a1: m.ka1, c: m.c };
    });
    bundles[p.id] = { a0: a0, a1: a1, c0: top, c1: top + span, lines: mine, moves: moves, wins: wins };
  });
  // A STOP INSIDE A CONVERGENCE BRANCHES OUT OF IT.
  //
  // "Assembly" is half an hour of a school day that Lisa's rail and Bart's
  // spend together, and as a dot and a tick on her rail inside the enclosure
  // it read as part of the enclosure. Asked for directly: "assembly should
  // branch out of the group via a little gap in the box". So it is a fact
  // and not a move the search may decline: the rail splits, the spur leaves
  // the bundle on the side its own row is on, runs clear of the enclosure
  // for the event, and halts at the tick while the trunk stays in the
  // bundle. The reader sees one line leave the group for a while, which is
  // what happened.
  function nestedIn(w) {
    var ids = Object.keys(bundles);
    for (var i = 0; i < ids.length; i++) {
      var bd = bundles[ids[i]];
      if (bd.lines.indexOf(w.line) < 0) continue;
      // Inside the group AND inside this rail's own time in it: a rail
      // that joins late is on its own row until it does.
      var win = (bd.wins && bd.wins[w.line]) || [bd.a0, bd.a1];
      if (w.a0 >= Math.max(bd.a0, win[0]) - 0.5 && w.a1 <= Math.min(bd.a1, win[1]) + 0.5) return bd;
    }
    return null;
  }
  var travel = 0, shelvesMade = [];
  spec.lines.forEach(function (ln, li) {
    var steps = (meets[ln.key] || []).slice();
    spec.wants.forEach(function (w, wi) {
      if (w.line !== ln.key) return;
      // WHAT THIS LINE DOES FOR THIS EVENT, as one number.
      //   0  a mark: the line runs through and the event is a dot and a tick
      //  +-1 a step: 45 degrees for the event's length, and it stays there
      //  +-2 a shelf: out to a spur for the event, and back
      // Sign is the direction across the board, and `c` grows downward, so a
      // negative move is upward on the panel.
      var m = st.steps ? st.steps[wi] : 0;
      if (!m || w.allDay || w.tie) return;   // a state is not a deviation; a tie is a spur
      var kind = Math.abs(m) > 1 ? 'shelf' : 'step';
      // A STEP NEEDS NO MINIMUM DURATION OF ITS OWN. There was one, forty
      // pixels, and it was a gate on top of a gate: at 45 degrees the climb
      // IS the duration, so a short event simply makes a short diagonal, and
      // `minLift` already refuses one too small to read. All the extra rule
      // did was stop a fifteen-minute event sloping at all -- "does quick
      // sync down slope on the trunk?" -- for no reason the drawing knows
      // about.
      steps.push({ a0: w.a0, a1: w.a1, dir: m > 0 ? 1 : -1, kind: kind });
    });
    // A FACT BEATS A PREFERENCE, AND A CONVERGENCE IS A FACT.
    //
    // The rail takes its moves in order and a move that starts before the
    // last one finished is dropped, so a step just before dinner ate the run
    // the convergence needed and the convergence was the one thrown away:
    // four rails met at the capsule and the fifth stayed in its own row with
    // the capsule stretched down to reach it, which says the person was and
    // was not there.
    //
    // So a step or a shelf that lands in a convergence's window gives way
    // instead. Nothing is lost by it: for the length of the event that line
    // is IN the bundle, and a rail cannot be two places at once -- the event
    // keeps its dot and its name, which is what a mark is.
    var mine = meets[ln.key] || [];
    if (mine.length) {
      steps = steps.filter(function (m) {
        if (m.kind === 'meet') return true;
        for (var i = 0; i < mine.length; i++) {
          if (m.a0 < mine[i].a1 + spec.leadCap && m.a1 > mine[i].a0 - spec.leadCap) return false;
        }
        return true;
      });
    }
    steps.sort(function (p, q) { return p.a0 - q.a0; });
    // THE ROOM A LINE HAS TO MOVE IN IS ITS OWN BAND AND NOT ITS
    // NEIGHBOUR'S. Half the smaller of the two gaps beside it, less the
    // clearance every rail keeps: "diagonals moving around the main trunk
    // while staying in its band".
    // HALF, AND IT HAS TO BE HALF.
    //
    // This divided by 1.6, which is five eighths, and the comment above it
    // said half -- so two neighbours could each take five eighths of the gap
    // between them TOWARDS EACH OTHER and end up on top of one another. On
    // the demo board Lisa stepped down fifty-six pixels in the afternoon,
    // Marge stepped up fifty-six in the morning, and the two rails finished
    // the day three pixels apart with their names written over each other.
    // Half the gap less half the clearance: two neighbours reaching for each
    // other then meet exactly a rail gap apart, which is the clearance the
    // rest of the board keeps, and neither has given up more room than the
    // arithmetic requires.
    var room = Math.max(0, (Math.min(st.gaps[li], st.gaps[li + 1]) - spec.railGap) / 2);
    var r = R.rail(ln.key, base[ln.key], steps, spec.axis, room, spec.minLift, spec.leadCap,
                   room * spec.stepShare);
    var trunk = b.addLine({ key: r.key, pts: r.pts, width: ln.width,
                            style: ln.style });
    ln._c = base[ln.key];
    ln._steps = steps;
    ln._trunk = trunk;
    ln._room = room;
    // Each side's own room, for the pass that separates two spurs: toward a
    // neighbour half the gap, as above; toward the paper's edge, the gap.
    ln._roomSide = { '-1': li > 0 ? room : Math.max(0, st.gaps[li] - spec.railGap),
                     '1': li < spec.lines.length - 1 ? room : Math.max(0, st.gaps[li + 1] - spec.railGap) };
    travel += R.travel(steps, base[ln.key], spec.axis, room, spec.minLift, spec.leadCap,
                       room * spec.stepShare);
  });
  // ...AND THE SPURS, once every trunk is drawn, because a branch leaves
  // FROM the trunk and has to know where it is at that minute -- which
  // depends on whether the trunk itself stepped earlier in the day.
  //
  // THE LINE SPLITS: the trunk is not moved and is not interrupted. A branch
  // is its own polyline with its own key, and the event's caption and marks
  // belong to it rather than to the trunk, so the dot, the tick and the name
  // travel together and the day still runs unbroken underneath.
  spec.wants.forEach(function (w, wi) {
    w._rail = w.line;
    if (w.pill) return;
    if (w.ride) {
      spec.wants.forEach(function (host) { if (host.id === w.ride && host._rail) w._rail = host._rail; });
      return;
    }
    var m = st.steps ? st.steps[wi] : 0;
    if (w.allDay) return;
    var ln = null;
    spec.lines.forEach(function (q) { if (q.key === w.line) ln = q; });
    if (!ln || !ln._trunk) return;
    // THE EVENT ITSELF HANGS OFF THE TIE. The bar says who; the spur says
    // when and what: it leaves the tie's outer end upright at the event's
    // minute, runs flat for the event's length and halts at its tick, with
    // the name beside it -- "you are missing the bottom part for the event
    // itself." Off the owner's side of the tie when the owner is on an
    // outside line, else off whichever end has the more room, and in the
    // owner's ink either way.
    var tp = w.tie ? ties[w.tie] : null;
    if (tp) {
      var ms = tp.lines.filter(function (k) { return base[k] != null; });
      if (!ms.length) return;
      var topK = ms[0], botK = ms[0];
      ms.forEach(function (k) {
        if (base[k] < base[topK]) topK = k;
        if (base[k] > base[botK]) botK = k;
      });
      var roomOf = function (k, side) {
        var q = null;
        spec.lines.forEach(function (z) { if (z.key === k) q = z; });
        return q && q._roomSide ? q._roomSide[side] : 0;
      };
      var down;
      if (!w.tieFree && w.line === botK && w.line !== topK) down = true;
      else if (!w.tieFree && w.line === topK && w.line !== botK) down = false;
      else {
        down = (spec.cross.c1 - base[botK]) >= (base[topK] - spec.cross.c0);
        // ...BY THE ROOM THERE IS, where it may go either way: measured to the
        // paper's edge, the crew's stack went up off the top line into the hour
        // strip. The side with the more room, as long as a shelf fits there.
        if (w.tieFree) down = roomOf(botK, '1') >= roomOf(topK, '-1');
      }
      // AND NEVER INTO NO ROOM: the owner's side was taken even where a shelf
      // did not fit there, and Crew Debrief climbed off the top line into the
      // hour strip. Where that side cannot take a shelf and the other can,
      // the other.
      if (down && roomOf(botK, '1') < spec.minLift && roomOf(topK, '-1') >= spec.minLift) down = false;
      else if (!down && roomOf(topK, '-1') < spec.minLift && roomOf(botK, '1') >= spec.minLift) down = true;
      var fromK = down ? botK : topK, fromLn = null;
      spec.lines.forEach(function (q) { if (q.key === fromK) fromLn = q; });
      if (!fromLn || !fromLn._trunk) return;
      var tdist = Math.max(spec.minLift, Math.min(fromLn._room, spec.shelfDepth));
      var tb = R.branch(fromK + '/' + w.id, fromLn._trunk, w.a0, w.a1, tdist,
                        down ? 1 : -1, spec.axis, spec.leadCap, 0, w.a0, 0);
      if (!tb) return;
      b.addLine({ key: tb.key, pts: tb.pts, width: ln.width, branchOf: fromK,
                  style: ln.style, ink: w.line });
      w._rail = tb.key;
      travel += tdist * 2;
      return;
    }
    var bd = nestedIn(w);
    if (bd) {
      // Out to whichever edge of the bundle is nearer, past the enclosure's
      // own radius, and a rail gap clear of it so the spur is plainly
      // outside the box and not drawn on its outline.
      var myC = ln._trunk.cAt((w.a0 + w.a1) / 2);
      if (myC == null) return;
      var down = (bd.c1 - myC) <= (myC - bd.c0);
      // Clear of the box by a tick's own reach and a little: the spur's
      // marks stand a mark's radius either side of it, and a rail gap out
      // put the end tick's top back inside the outline. "assembly
      // terminator clips into the group event."
      // The tick reaches a shade over nine tenths of a mark's radius from
      // the spur, and the box reaches a full radius past the bundle; this is
      // the least that keeps them apart, and it stays within a 45 degree
      // lead so the branch is still drawn as a branch.
      // A spur's marks are drawn at three quarters (draw.js), which is what
      // lets this fit inside a 45 degree lead on a board where the group
      // starts half an hour before the stop.
      var clear = spec.markR * 1.68 + 1 + spec.markR * 0.5;
      var outC = down ? bd.c1 + clear : bd.c0 - clear;
      // ...and never nearer its own rail than a shelf may be (`minLift`).
      var myC0 = ln._trunk.cAt((w.a0 + w.a1) / 2);
      if (myC0 != null && Math.abs(outC - myC0) < spec.minLift) outC = myC0 + (down ? 1 : -1) * spec.minLift;
      // NOT BEFORE THE TRUNK IS LEVEL IN THE GROUP. The group starts at
      // `a0`, but this rail only reaches its place in the bundle a stagger
      // later and rounds its corner after that; a spur allowed to leave at
      // `a0` left from the corner, and on the OG board Assembly branched
      // off Lisa's climb INTO the school day rather than out of it.
      // A rail that came in through the wall is level from the group's
      // start; one that changed level at the boundary, or joined late, is
      // level from where its own entry is.
      var sg = 0;
      (meets[w.line] || []).forEach(function (m) {
        if (m.kind !== 'meet' || Math.abs(m.a0 - bd.a0) > 0.5) return;
        sg = m.sgIn > 0 ? 0 : m.sgIn < 0 ? -m.sgIn : (m.sgChain || 0);
      });
      // AND BEFORE THE EVENT, so the dot is on the shelf and not on the
      // trunk: "branch earlier, so the event doesn't start on the trunk."
      // Upright, a spur's corner and a mark before the dot, which is what
      // its rounded corner and the dot's own reach take; the renderer moves
      // the merge diamond out of its way (draw.js).
      var spurPre = spec.corner * 0.6 + spec.markR;
      // UPRIGHT, AT ITS OWN MINUTE: "Assembly needs a 90 degree angle
      // shelf." A lead cap of nought is no 45 degree lead at all, and no
      // run before the dot, so the spur leaves the group where the event
      // starts and not before.
      var nb = R.branch(w.line + '/' + w.id, ln._trunk, w.a0, w.a1, Math.abs(outC - myC),
                        down ? 1 : -1, spec.axis, 0, spurPre,
                        // From the trunk's level vertex on: the renderer
                        // snaps the split onto the trunk's drawn corner
                        // (draw.js), so leaving from the corner is a fork
                        // and not a gap.
                        // ...and never before this rail is in the group at
                        // all: a member who joined late was still on her own
                        // row at `a0`, and the spur left from there, before
                        // the diamond it belongs after.
                        (function () {
                          var j0 = ((bd.wins && bd.wins[w.line]) || [bd.a0])[0];
                          return Math.max(bd.a0 + sg, j0 > bd.a0 + 0.5 ? j0 + spec.corner : j0);
                        })(), 0);
      if (!nb) return;
      b.addLine({ key: nb.key, pts: nb.pts, width: ln.width, branchOf: w.line,
                  style: ln.style });
      w._rail = nb.key;
      travel += nb.dist * 2;
      return;
    }
    if (Math.abs(m) < 2) return;
    // A SHELF IS DISTINCT, NOT DEEP. Given the whole band it took it, and a
    // spur that deep cannot reach its level in a 45 degree lead without
    // leaving long before the event it names -- so it departed UPRIGHT, and
    // the picture came out as two right-angled brackets rather than as a
    // line splitting. Held to what a 45 degree lead can cover, every
    // departure is a proper diagonal and the shelf is still plainly
    // somewhere else. Deeper buys nothing: the reader only has to see that
    // it is not the trunk.
    var dist = Math.max(0, Math.min(ln._room, spec.shelfDepth));
    if (dist < spec.minLift) return;
    var key = w.line + '/' + w.id;
    // NOT BEFORE THE EVENT, AND OFF A STRAIGHT RAIL OR STRAIGHT UP. The
    // spur used to run flat for a while before its dot so the name had
    // somewhere to be, and took its 45 degree lead from wherever the trunk
    // happened to be, which put Detention's lead on Bart's climb out of the
    // school day: "these are bad shelves, they start too early and could
    // just do a 90 degree angle." No run before the dot; and the lead is
    // taken only where the trunk is level for the whole of it and a corner
    // besides, else the spur leaves upright at the event's own minute.
    // A spur's corner and a mark of flat before the dot, so the dot is on
    // the shelf and not on the trunk; the 45 degree lead, as long as the
    // shelf is deep, only where the trunk is level for all of it and a
    // corner besides; and an upright departure never from inside one of
    // the trunk's rounded corners -- "ugly intersect" where Saxophone
    // Lesson left Lisa's rail on her arc out of the school day. Where the
    // departure would land in a corner, it waits until the corner is over
    // and the dot sits where the spur begins.
    var pre = spec.corner * 0.6 + spec.markR;
    var tp = ln._trunk.pts, dep = w.a0 - pre, lo = dep - dist - spec.corner, level = true;
    for (var vi = 0; vi < tp.length && level; vi++) {
      if (tp[vi][0] > lo && tp[vi][0] <= w.a0 + 0.5) level = false;
    }
    if (level) {
      var cl = ln._trunk.cAt(lo), ch = ln._trunk.cAt(w.a0);
      if (cl == null || ch == null || Math.abs(cl - ch) > 0.5) level = false;
    }
    // ...AND UPRIGHT PAST A BAR: "Lab Rotation is crossing here. Need a 90
    // degree angle shelf." A 45 degree lead from a rail that a shared event's
    // bar crosses just before the event ran its diagonal through the bar and
    // the ring; the spur leaves straight up, clear of the ring, instead.
    var ringAt = null;
    Object.keys(ties).forEach(function (id) {
      var t = ties[id];
      if (t.lines.indexOf(w.line) < 0 || t.a > w.a0 + 0.5 || t.a < lo - spec.markR * 2) return;
      ringAt = ringAt == null ? t.a : Math.max(ringAt, t.a);
    });
    if (ringAt != null) level = false;
    var floor = null;
    if (!level) {
      for (var vj = 1; vj < tp.length - 1; vj++) {
        if (tp[vj][0] > dep - spec.corner && tp[vj][0] < dep + spec.corner) floor = tp[vj][0] + spec.corner + 1;
      }
      if (ringAt != null && dep < ringAt + spec.markR * 1.7) floor = Math.max(floor || 0, ringAt + spec.markR * 1.7);
    }
    var br = R.branch(key, ln._trunk, w.a0, w.a1, dist, m > 0 ? 1 : -1,
                      spec.axis, level ? dist : 0, pre, floor, 0);
    if (!br) return;
    var added = b.addLine({ key: br.key, pts: br.pts, width: ln.width, branchOf: w.line,
                            style: ln.style });
    if (w.members) added.crowd = true;
    shelvesMade.push({ line: added, w: w, trunk: ln._trunk, dist: dist, dir: m > 0 ? 1 : -1, room: ln._room, roomSide: ln._roomSide,
                       lead: level ? dist : 0, pre: pre, floor: floor });
    w._rail = key;
    travel += dist * 2;
  });
  // TWO SPURS ON ONE SIDE OF ONE TRUNK, OVER ONE STRETCH, ARE ONE SPUR TO A
  // READER. The school run's tie spur and the book club's shelf both dropped
  // off Marge's rail at eight, and crossed: "school run and book club kinda
  // collide". Spurs are built line by line, so whichever came second could
  // not see the first; asked once they all exist, a shelf that lands on
  // another branch's stretch goes to the other side, where there is room.
  // Signed depth of a spur off its trunk at its far end.
  function depthOf(l, trunk) {
    var q = l.pts[l.pts.length - 1], tc = trunk.cAt(q[0]);
    return tc == null ? 0 : q[1] - tc;
  }
  function clash(l, trunkKey, trunk, tol) {
    var a0 = l.pts[0][0] - spec.corner, a1 = l.pts[l.pts.length - 1][0] + spec.corner;
    var d = depthOf(l, trunk);
    return b.lines.some(function (o) {
      if (o === l || o.branchOf !== trunkKey || !o.pts.length) return false;
      var o0 = o.pts[0][0], o1 = o.pts[o.pts.length - 1][0], od = depthOf(o, trunk);
      return o0 < a1 && a0 < o1 && od * d > 0 && Math.abs(od - d) < spec.minLift * (tol || 1) - 0.5;
    });
  }
  // Whether a spur runs through a line's name at either end, or the paper
  // just past it (see nameCut). The names are finished below from the
  // spec's own furniture, so their boxes are worked out here from it.
  function cutsHead(l, routed) {
    return (spec.fixed || []).some(function (fx) {
      if (fx.kind !== 'terminus' || (routed && !fx.route)) return false;
      var tl = b.lineByKey(fx.line);
      var c = tl ? tl.cAt(fx.at == null ? spec.axis.a1 : fx.at) : null;
      if (c == null) return false;
      var hh = headH(fx), lift = spec.railGap * 1.5, reach = hh * 2;
      var a0 = fx.align === 'right' ? fx.a0 - reach : fx.a0, a1 = fx.align === 'right' ? fx.a1 : fx.a1 + reach;
      // above its rail unless it is the top line; either way test both rows
      // (a spur's first point is on the trunk itself, a lift below the box:
      // kept out of it, or every spur leaving under the head counted)
      return B.lineTouches(l, { a0: a0, a1: a1, c0: c - lift - hh, c1: c - lift - 3 })
        && (b.lines.indexOf(tl) >= 0);
    });
  }
  shelvesMade.forEach(function (sh) {
    var trunkKey = sh.w.line;
    // ...and a spur through a head carrying a route row ("Desk booking
    // 8:00-19:00" under the name) is moved the same way, where a move clears
    // both: the search prices a cut name, and still took one when the tier
    // that avoided it was a tidy-up away.
    var cutting = cutsHead(sh.line, true);
    if (!clash(sh.line, trunkKey, sh.trunk) && !cutting) return;
    var old = sh.line.pts;
    // The other side first, then a tier further out on either side where
    // the band has the room: "standup" and "Github Copilot Updates" back to
    // back on one side, with the desk booking's shelf on the other, dropped
    // two spurs down one column and read as one event.
    // ...and last, a tier a little shallower than a full step, where the band
    // is a few pixels short of one: two shelves eight tenths of a lift apart
    // still read as two, where one shelf shared reads as one event.
    var tries = [[-sh.dir, sh.dist], [sh.dir, sh.dist + spec.minLift], [-sh.dir, sh.dist + spec.minLift]];
    [sh.dir, -sh.dir].forEach(function (dr) {
      var rs = sh.roomSide ? sh.roomSide[String(dr)] : sh.room;
      if (rs - sh.dist >= spec.minLift * 0.8 && rs < sh.dist + spec.minLift) tries.push([dr, rs, 0.8]);
    });
    // A move that would climb through a line's name is taken only when no
    // other move clears: flipped up into "Desk booking 8:00-19:00" under
    // the name, the standup cut the head when a tier further down was free.
    var fallback = null;
    for (var ti = 0; ti < tries.length; ti++) {
      var sideRoom = sh.roomSide ? sh.roomSide[String(tries[ti][0])] : sh.room;
      if (tries[ti][1] > sideRoom + 0.5) continue;
      var nb = R.branch(sh.line.key, sh.trunk, sh.w.a0, sh.w.a1, tries[ti][1], tries[ti][0],
                        spec.axis, sh.lead ? tries[ti][1] : 0, sh.pre, sh.floor, 0);
      if (!nb) continue;
      sh.line.pts = nb.pts; sh.line._b = null;
      if (clash(sh.line, trunkKey, sh.trunk, tries[ti][2])) continue;
      if (!cutsHead(sh.line)) return;
      if (!fallback) fallback = nb.pts;
    }
    sh.line.pts = old; sh.line._b = null;
    // Where it stood is fine at the shallower spacing and cuts nothing: that
    // beats a move through a head.
    if (fallback && !cutting && !clash(sh.line, trunkKey, sh.trunk, 0.8)) return;
    if (fallback && !cutting) { sh.line.pts = fallback; sh.line._b = null; return; }
    if (!clash(sh.line, trunkKey, sh.trunk)) return;
    // ...AND WHERE NONE OF THEM FITS, THE BOARD PAYS. Left sharing a shelf,
    // a half-hour meeting inside the desk booking read as lasting till seven:
    // "that's an odd one, is that intentional?" Priced, so the search gives
    // this line the few pixels of band a tier further out needs.
    b.shelfClash = (b.shelfClash || 0) + 1;
  });
  // A HEAD WITH A ROUTE ROW is the name and a smaller row under it.
  function headH(fx) {
    return spec.nameH + (fx.route ? Math.round(spec.nameH * 0.85) : 0);
  }
  // THE BOARD'S FIXED INK. A terminus name has no cross position until its
  // line has one, so it is finished here rather than declared with a guess.
  // A ROUTE ROW WHERE THE LINE'S DAY STARTS BUSY GOES TO ITS OTHER END.
  // "Desk booking 8:00-19:00" under the name took the stretch the morning's
  // first spurs leave through, and one of them always went through it --
  // "shouldn't it be under if the name is already up top?". With its hours
  // on it the row says the same thing at the far end, where the rail is
  // clear.
  var headFx = (spec.fixed || []).map(function (fx) {
    if (fx.kind !== 'terminus' || !fx.route || fx.at !== spec.axis.a0 || fx.routeW == null) return fx;
    var far = null;
    (spec.fixed || []).forEach(function (g) { if (g.kind === 'terminus' && g.line === fx.line && g.at === spec.axis.a1) far = g; });
    if (!far || far.route) return fx;
    // ...only while the far end is still the same day: across a midnight it
    // would name today's desk booking at tomorrow's end of the board
    if ((spec.cuts || []).length) return fx;
    var reach = spec.nameH * 4;
    var busy = function (lo, hi) {
      return b.lines.some(function (l) {
        return l.branchOf === fx.line && l.pts.length && l.pts[0][0] < hi && l.pts[l.pts.length - 1][0] > lo;
      });
    };
    if (!busy(fx.a0, fx.a1 + reach) || busy(far.a0 - reach, far.a1)) return fx;
    return Object.assign({}, fx, { route: null, rows: 1, a1: fx.a0 + fx.nameW, movedRoute: fx.route });
  });
  var movedTo = {};
  headFx.forEach(function (fx) { if (fx.movedRoute) movedTo[fx.line] = fx; });
  headFx = headFx.map(function (fx) {
    var m = fx.kind === 'terminus' && fx.at === spec.axis.a1 ? movedTo[fx.line] : null;
    if (!m) return fx;
    return Object.assign({}, fx, { route: m.movedRoute, rows: 2, a0: fx.a1 - Math.max(fx.nameW, m.routeW) });
  });
  headFx.forEach(function (fx) {
    var f = { id: fx.id, kind: fx.kind, text: fx.text, align: fx.align,
              // Carried through rather than looked up again at drawing time:
              // a sky marker's glyph and its own minute are part of what the
              // board says, and the renderer should not be reading the
              // payload a second time to find them.
              icon: fx.icon, at: fx.at, min: fx.min, line: fx.line,
              route: fx.route, rows: fx.rows,
              a0: fx.a0, a1: fx.a1, c0: fx.c0, c1: fx.c1 };
    if (fx.kind === 'bandname') {
      // Just outside the band, above its rail where the rail above leaves
      // room, else below: the band's own half-depth plus a gap.
      // AND WHERE NOTHING LEAVES THROUGH IT: the first place along the band,
      // above the rail then below, that no rail or spur crosses and no name
      // already holds. Set at the very start, the morning's first spurs went
      // through "Desk booking".
      var bl = b.lineByKey(fx.line);
      if (!bl) return;
      var bh = Math.round(spec.nameH * (spec.oneName ? 0.8 : 1)), off = spec.markR * 1.6 + 3, bw = fx.a1 - fx.a0;
      var end = fx.bandEnd != null ? fx.bandEnd : fx.a1, step = Math.max(8, bw / 3), best = null;
      for (var ta = fx.a0; ta + bw <= end + 0.5 && !best; ta += step) {
        var bc = bl.cAt(ta), bc2 = bl.cAt(ta + bw);
        if (bc == null || bc2 == null || Math.abs(bc - bc2) > 0.5) continue;
        [[bc - off - bh, bc - off], [bc + off, bc + off + bh]].forEach(function (cc) {
          if (best) return;
          var box = { a0: ta - 3, a1: ta + bw + 3, c0: cc[0] - 2, c1: cc[1] + 2 };
          if (cc[0] < b.cross.c0 || cc[1] > b.cross.c1) return;
          var hit = b.lines.some(function (o) { return B.lineTouches(o, box); })
            || b.fixed.some(function (g) { var gb = g.box(); return gb.a0 < box.a1 && box.a0 < gb.a1 && gb.c0 < box.c1 && box.c0 < gb.c1; });
          if (!hit) best = { a0: ta, c0: cc[0], c1: cc[1] };
        });
      }
      if (!best) return;   // no clear place: the band speaks for itself
      f.a0 = best.a0; f.a1 = best.a0 + bw; f.c0 = best.c0; f.c1 = best.c1;
      b.addFixed(f);
      return;
    }
    if (fx.kind === 'terminus') {
      var ln = b.lineByKey(fx.line);
      var c = ln ? ln.cAt(fx.at == null ? spec.axis.a1 : fx.at) : null;
      if (c == null) return;
      // ABOVE ITS RAIL, NOT ON IT.
      //
      // Set level with the line, a name shares the rail's own row with the
      // terminal slash and the two read as one mark: "Homer /" is a word with
      // a tick after it rather than a line that starts here. Put a clear row
      // above, the rail's end is clean, the slash is unmistakably the line's,
      // and the name is over the thing it names. At both ends, because a
      // reader comes to the board from whichever side they are standing on.
      //
      // The topmost line has no room above it, so it takes the row below.
      // Either way the name is a row clear of the rail and can never be read
      // as being on it.
      // A rail gap and a half: at three quarters the name touched the rail
      // -- "leave some more space between the track and the track label."
      var lift = spec.railGap * 1.5, nh = headH(fx);
      // ...AND CLEAR OF THE RAIL ABOVE IT TOO, slash included: "Lisa" set
      // above her rail on a tight board had Bart's terminal slash through
      // her first letter. Above where it fits between the two rails, below
      // where it does not and there is room there.
      var atA = fx.at == null ? spec.axis.a1 : fx.at, prevC = b.cross.c0, nextC = b.cross.c1;
      b.lines.forEach(function (o) {
        if (o.branchOf || o.key === fx.line) return;
        var oc = o.cAt(atA);
        if (oc == null) return;
        // (its slash reaches a mark's radius past the rail, and a name under
        // it keeps a hair of paper from that too)
        if (oc < c - 0.5 && oc > prevC) prevC = oc + Math.max(spec.railGap, (spec.markR || 0) + 3);
        // the next rail's own name sits above IT, in the same gap
        if (oc > c + 0.5 && oc < nextC) nextC = oc - spec.railGap * 1.5 - nh;
      });
      // ...AND CLEAR OF A NAME ALREADY SET IN THAT GAP. A top line's name
      // goes under its rail, and the next line's name above ITS rail was set
      // into the same gap, the two eased apart onto both rails: "Jordan" on
      // his own line.
      b.fixed.forEach(function (g) {
        if (g.kind !== 'terminus' || g.line === fx.line || Math.abs((g.at == null ? spec.axis.a1 : g.at) - atA) > 1) return;
        if (!(g.a0 < f.a1 && f.a0 < g.a1)) return;
        if (g.c1 <= c && g.c1 + 2 > prevC) prevC = g.c1 + 2;
        if (g.c0 >= c && g.c0 - 2 < nextC) nextC = g.c0 - 2;
      });
      if (fx.level) {
        // In the gutter beside the rail's end, centred on it (day.js).
        f.c0 = c - nh / 2; f.c1 = c + nh / 2;
        b.addFixed(f);
        return;
      }
      var fitsAbove = c - lift - nh >= Math.max(b.cross.c0, prevC);
      var fitsBelow = c + lift + nh <= nextC;
      // AWAY FROM A SHELF THAT ARRIVES FROM OFF THE PAPER. "Early shift",
      // running when the board opened, lies above the rail from the edge on;
      // the name set above too sat between the two, and the dotted drop that
      // ties the shelf to its rail (draw.js) went through it.
      var edgeSide = 0;
      b.lines.forEach(function (o) {
        if (o.branchOf !== fx.line || !o.pts.length || Math.abs(o.pts[0][0] - atA) > 1) return;
        edgeSide = o.pts[0][1] < c ? -1 : 1;
      });
      if (edgeSide < 0 && fitsBelow) fitsAbove = false;
      if (edgeSide > 0 && fitsAbove) fitsBelow = false;
      // ...AND OUT OF ANOTHER LINE'S BRANCH. Coffee drops off Fry's rail at the
      // leading edge into the gap above Bender's, and "Bender" set above her
      // rail had the branch through it.
      function branchIn(c0, c1) {
        return b.lines.some(function (o) {
          if (!o.branchOf || o.branchOf === fx.line) return false;
          return o.pts.some(function (q, i) {
            if (!i) return false;
            var p0 = o.pts[i - 1];
            var lo = Math.min(p0[0], q[0]), hi = Math.max(p0[0], q[0]);
            var cl = Math.min(p0[1], q[1]), ch = Math.max(p0[1], q[1]);
            return hi >= f.a0 - 2 && lo <= f.a1 + 2 && ch >= c0 - 2 && cl <= c1 + 2;
          });
        });
      }
      var hitAbove = branchIn(c - lift - nh, c - lift), hitBelow = branchIn(c + lift, c + lift + nh);
      if (hitAbove && fitsBelow && !hitBelow) fitsAbove = false;
      if (hitBelow && fitsAbove && !hitAbove) fitsBelow = false;
      // WHERE NEITHER FITS, the side it overlaps less, and not through a branch.
      var overAbove = Math.max(0, Math.max(b.cross.c0, prevC) - (c - lift - nh)) + (hitAbove ? 1e3 : 0);
      var overBelow = Math.max(0, (c + lift + nh) - Math.min(b.cross.c1, nextC)) + (hitBelow ? 1e3 : 0);
      if (fitsAbove || (!fitsBelow && overAbove <= overBelow && c - lift - nh >= b.cross.c0)) {
        f.c1 = c - lift; f.c0 = f.c1 - nh;
      } else {
        f.c0 = c + lift; f.c1 = f.c0 + nh;
      }
    }
    b.addFixed(f);
  });

  // TWO NAMES AT ONE LEVEL, WHERE THE RAILS THEMSELVES ARE AT ONE LEVEL.
  //
  // A terminus name is set from `cAt` at that end of the board, which is the
  // rail as DRAWN -- and two rails in a corridor are drawn at the same level
  // by definition. A board whose window opens in the middle of a school day
  // therefore starts with Bart and Lisa already converged, and their two
  // names were written on top of each other at the leading edge.
  //
  // Not the band search's to fix: those bands are fine and the rails are
  // where they should be. Nor a reason to put the names back on their own
  // rows, which would point them at paper. They simply stack, the way a
  // transit map stacks the names at a shared terminus, nearest rail first.
  [spec.axis.a0, spec.axis.a1].forEach(function (end) {
    var far = end === spec.axis.a0 ? spec.axis.a1 : spec.axis.a0;
    var here = b.fixed.filter(function (f) {
      return f.kind === 'terminus' && Math.abs((f.at == null ? spec.axis.a1 : f.at) - end) < 1;
    });
    // A CORRIDOR IS TWO RAILS AT ONE LEVEL, and only names whose rails are
    // at one level stack. Taken as "any two names touching", a flat slot
    // five lines deep in two hundred pixels found every name touching its
    // neighbour, stacked all five around the top rail, and wrote Homer and
    // Maggie over the hour strip.
    var railAt = function (f) { var l = b.lineByKey(f.line); return l ? l.cAt(end) : null; };
    var stacked = here.filter(function (f) {
      var cf = railAt(f);
      return cf != null && here.some(function (g) {
        var cg = railAt(g);
        return g !== f && cg != null && Math.abs(cg - cf) <= spec.railGap * 1.5
          && g.c0 < f.c1 - 1 && g.c1 > f.c0 + 1;
      });
    });
    if (stacked.length >= 2) stackNames(stacked, end, far);
    // AND NOTHING ELSE WRITTEN ON A STACK. A corridor's names split around
    // it, and on a flat slot the upper one landed on the next line's name,
    // set level beside its own rail: "Marge +1" over "Bart". Whatever still
    // touches is eased apart, the upper name up and the lower down, never
    // past the paper.
    var byC = here.slice().sort(function (x, y) { return x.c0 - y.c0; });
    for (var pass = 0; pass < 3; pass++) {
      var moved = false;
      for (var hi = 1; hi < byC.length; hi++) {
        var u = byC[hi - 1], d = byC[hi];
        if (!(u.a0 < d.a1 && d.a0 < u.a1)) continue;
        var over = u.c1 + 2 - d.c0;
        if (over <= 0) continue;
        var floor = hi > 1 ? byC[hi - 2].c1 + 2 : b.cross.c0;
        var roomUp = Math.max(0, u.c0 - floor), roomDn = Math.max(0, b.cross.c1 - d.c1);
        // never onto its own rail: a name below its rail moves up only as far
        // as the rail's clearance, and one above it moves down as far
        var uRail = railAt(u), dRail = railAt(d), keep = spec.railGap;
        if (!u.level && uRail != null && u.c0 >= uRail) roomUp = Math.min(roomUp, Math.max(0, u.c0 - (uRail + keep)));
        if (!d.level && dRail != null && d.c1 <= dRail) roomDn = Math.min(roomDn, Math.max(0, (dRail - keep) - d.c1));
        var upBy = Math.min(roomUp, Math.ceil(over / 2));
        if (over - upBy > roomDn) upBy = Math.min(roomUp, over - roomDn);
        var dnBy = Math.min(roomDn, over - upBy);
        u.c0 -= upBy; u.c1 -= upBy;
        d.c0 += dnBy; d.c1 += dnBy;
        moved = true;
      }
      if (!moved) break;
    }
  });
  function stackNames(stacked, end, far) {
    // IN THE ORDER THEY PART. The names preview where these lines are about
    // to go, so they are read off the OTHER end of the board, where the
    // corridor has let them go again. A stack in any other order says three
    // people are in here and nothing about which rail is whose.
    stacked.sort(function (x, y) {
      var lx = b.lineByKey(x.line), ly = b.lineByKey(y.line);
      var cx = lx ? lx.cAt(far) : x.c0, cy = ly ? ly.cAt(far) : y.c0;
      return (cx == null ? x.c0 : cx) - (cy == null ? y.c0 : cy);
    });
    // AROUND THE RAIL, NOT ALL ABOVE IT. "Shouldn't Lisa just be under it?"
    // -- and yes: a name below the corridor is as close to it as one above,
    // it is the row the topmost line already falls back to, and stacking
    // everything on one side pushes the last name two rows off the thing it
    // names. So the group splits, upper half above and the rest below, which
    // for the common case of two is simply one each.
    var ln0 = b.lineByKey(stacked[0].line);
    var rail = ln0 ? ln0.cAt(end) : stacked[0].c1;
    var lift = spec.railGap * 1.5;
    var up = Math.ceil(stacked.length / 2);
    // nearest the rail is the LAST of the upper half, so the order reading
    // down the page is the order they part in
    var edgeUp = rail - lift, edgeDn = rail + lift;
    for (var si = up - 1; si >= 0; si--) {
      stacked[si].c1 = edgeUp; stacked[si].c0 = edgeUp - headH(stacked[si]);
      edgeUp = stacked[si].c0 - 2;
    }
    for (si = up; si < stacked.length; si++) {
      stacked[si].c0 = edgeDn; stacked[si].c1 = edgeDn + headH(stacked[si]);
      edgeDn = stacked[si].c1 + 2;
    }
  }

  // THE INTERCHANGE BARS, drawn from the solved positions. A bar reaches
  // from the topmost line that meets there to the bottommost, at that
  // minute, so it cannot be known until the lines have been placed -- which
  // is exactly why the old engine could not let the caption pass see one.
  // Here it is built with everything else and it is an obstacle like any
  // other before a single name is placed.
  (spec.pills || []).forEach(function (p) {
    var cs = p.lines.map(function (k) {
      var ln = b.lineByKey(k);
      return ln ? ln.cAt(p.a) : null;
    }).filter(function (c) { return c != null; });
    if (!cs.length) return;
    // A TIE IS ONE BAR AT ITS MINUTE with a ring on each line where it is;
    // a convergence is the lines run together, bracketed, with a diamond
    // where each rail left its row and where it came back (rails.js).
    var bd = bundles[p.id], tie = !!ties[p.id];
    b.addPill({ id: p.id, a: p.a, a0: tie ? p.a : p.a0, a1: tie ? p.a : p.a1,
                lines: p.lines, r: spec.markR, tie: tie,
                // whether the run reaches past an edge of the board: the
                // diamond at that end would say it began here (see day.js)
                open0: p.open0, open1: p.open1,
                // and where a long tie stops, so every line in it can be
                // ticked there
                to: p.to, ends: p.ends || null, todo: !!p.todo,
                c0: Math.min.apply(null, cs), c1: Math.max.apply(null, cs),
                joins: bd ? bd.moves.map(function (m) {
                  return { line: m.line, join: m.joinAt || null, leave: m.leaveAt || null,
                           in_: m.inAt, out: m.outAt };
                }) : [],
                // Who is in it, so the capsule can be badged with them.
                initials: p.lines.map(function (k) {
                  var q = null;
                  spec.lines.forEach(function (z) { if (z.key === k) q = z; });
                  return (q && q.initial) || k.charAt(0).toUpperCase();
                }) });
  });
  b.travel = travel;
  // WHAT THE SEARCH ASKED FOR, AND WHAT THE BOARD ACTUALLY DID. Two fields,
  // because they are two things: a state can mark an event as stepping and
  // the rail refuse it for want of room. Everything that PRICES a board reads
  // `bends`; `wanted` is kept only so the search can see its own state.
  b.wanted = st.steps;
  // COUNTED SEPARATELY, because they are paid for differently. A bend in a
  // TRUNK is the day changing level and is what the reward is for; a branch
  // is a whole extra rail on the board and has to earn its place.
  // A SPUR ACROSS ANOTHER RAIL is a picture of two things where there is
  // one: the Book Club's shelf ran down through the School Run's spur.
  // Counted here, priced in boardCost, so the search sends the shelf the
  // other way -- "Book Club should be above to give space."
  b.crossings = 0;
  function cross(p, q, r, t) {
    function side(a, b2, c) { return (b2[0] - a[0]) * (c[1] - a[1]) - (b2[1] - a[1]) * (c[0] - a[0]); }
    var d1 = side(r, t, p), d2 = side(r, t, q), d3 = side(p, q, r), d4 = side(p, q, t);
    return ((d1 > 0.01 && d2 < -0.01) || (d1 < -0.01 && d2 > 0.01))
        && ((d3 > 0.01 && d4 < -0.01) || (d3 < -0.01 && d4 > 0.01));
  }
  b.lines.forEach(function (l) {
    if (!l.branchOf) return;
    b.lines.forEach(function (o) {
      if (o === l || o.key === l.branchOf || o.branchOf === l.key) return;
      for (var i = 1; i < l.pts.length; i++) {
        for (var j = 1; j < o.pts.length; j++) {
          if (cross(l.pts[i - 1], l.pts[i], o.pts[j - 1], o.pts[j])) b.crossings++;
        }
      }
    });
  });
  b.bends = 0; b.branches = 0; b.crowdShelves = 0;
  b.lines.forEach(function (l) {
    if (l.branchOf) { b.branches++; if (l.crowd) b.crowdShelves++; return; }
    for (var i = 1; i < l.pts.length; i++) {
      if (Math.abs(l.pts[i][1] - l.pts[i - 1][1]) > 0.5) b.bends++;
    }
  });
  return b;
}

// WHAT THIS ALLOCATION IS WORTH, which is WHAT THE CAPTIONS DO ON IT.
//
// Counting how many places each caption has was the first thing tried here
// and it has no gradient: every caption on a board with any room at all has
// more places than the count cares about, so the score is zero everywhere
// and the search wanders. Measured on the four-line board, it returned the
// even spread it started from, which is the same answer the old engine gives
// and for the same reason -- nothing was asking the real question.
//
// The real question is what the words do, so it places them. Greedily and
// with no annealing: that is a few hundred microseconds, it is deterministic
// (so the outer search is not hill-climbing through noise), and it is an
// upper bound on what the full solve will manage. An allocation the greedy
// pass can fill cleanly is an allocation worth keeping.
// WHAT THE LINE ACTUALLY DID FOR EACH EVENT, read off the board.
//
// `wanted` is what the search asked for and it is not the same thing: a step
// shorter than a diagonal needs is refused, a branch whose departure falls
// inside another one's is refused, and the state still says it asked. Every
// time that difference has been reported as though it were the drawing it
// has misled somebody, so the drawing has its own answer and it is the one
// anything prints.
// Where a branch reaches the level it runs along: the first of its points at
// its last point's level.
function flatFrom(ln) {
  var p = ln.pts, lvl = p[p.length - 1][1];
  for (var i = 0; i < p.length; i++) if (Math.abs(p[i][1] - lvl) < 0.5) return p[i][0];
  return p[0][0];
}

function drawnModes(spec, b) {
  return spec.wants.map(function (w) {
    if (w.pill) return 'shared';
    if (w._rail && w._rail !== w.line) {
      var br = b.lineByKey(w._rail), tr = b.lineByKey(w.line);
      if (br && tr) {
        var bc = br.cAt((w.a0 + w.a1) / 2), tc = tr.cAt((w.a0 + w.a1) / 2);
        if (bc != null && tc != null) return bc < tc ? 'branch above' : 'branch below';
      }
      return 'branch';
    }
    var ln = b.lineByKey(w.line);
    if (!ln) return 'mark';
    var c0 = ln.cAt(w.a0), c1 = ln.cAt(w.a1);
    if (c0 == null || c1 == null || Math.abs(c1 - c0) <= 1) return 'mark';
    return c1 < c0 ? 'step up' : 'step down';
  });
}

// AN EVENT WHOSE OWN RAIL CHANGES LEVEL UNDERNEATH IT.
//
// Somebody else's step landing inside your event moves the rail between your
// dot and your tick, so the event is drawn beginning on one level and ending
// on another, and the reader has no way to know the climb is not part of it.
// An event that is ITSELF the step is the case this must not catch: there
// the diagonal IS the event, which is the whole grammar.
function straddles(spec, b, st) {
  var n = 0;
  spec.wants.forEach(function (w, wi) {
    if (w.pill) return;
    var mode = st && st.steps ? st.steps[wi] : 0;
    if (Math.abs(mode) === 1) return;
    var ln = b.lineByKey(w._rail || w.line);
    if (!ln) return;
    var c0 = ln.cAt(w.a0), c1 = ln.cAt(w.a1);
    if (c0 == null || c1 == null) return;
    if (Math.abs(c0 - c1) > 1) n++;
  });
  return n;
}

// HOW FAR A TRUNK SPENDS THE DAY FROM WHERE IT BELONGS.
//
// MEASURED AND NOT CHARGED, and the attempt is left here with its result.
// Charged at anything that made two steps lose to one branch, it also made
// ONE step lose to no step: every rail on every board came out flat, which
// is the opposite of what was asked for. A step's whole nature is that it
// stays, so any price on staying is a price on stepping.
function drift(spec, b) {
  var total = 0, span = spec.axis.a1 - spec.axis.a0;
  spec.lines.forEach(function (ln) {
    var line = b.lineByKey(ln.key);
    if (!line || ln._c == null) return;
    var acc = 0, n = 0;
    for (var a = spec.axis.a0; a <= spec.axis.a1; a += span / 60) {
      var c = line.cAt(a);
      if (c == null) continue;
      acc += Math.abs(c - ln._c); n++;
    }
    if (n) total += acc / n;
  });
  return total;
}

// A NAME WHOSE NEAREST MARK IS SOMEBODY ELSE'S.
//
// This is the fault behind "standup and quick sync deserve a shelf". Two
// stops close together on one rail put two dots in a row on a single line,
// and no arrangement of the words fixes it: the reader has to guess which
// name goes with which dot. The board is clean by every other test and is
// still asking a question it should be answering.
//
// ASKED THE WAY A READER ASKS IT. The first version guessed -- two events
// within some fraction of a caption's width, sitting at the same level --
// and both halves of that guess went wrong. The distance was arbitrary, so
// two dots thirty-nine pixels apart with plainly separate marks were called
// ambiguous. And the level test used a caption's HEIGHT, which happened to
// be exactly the depth a band could give a shelf, so the answer came down to
// the last decimal place of where a sloping trunk was: two arrangements that
// are the same picture scored 464 and 2664.
//
// A reader pairs a name with the mark nearest to it. So that is the
// question: for each name, is the nearest mark at its own level its own? If
// it is not, the board is telling the reader something false, and no
// threshold has to be invented to say so.
function muddle(spec, b, sol, who) {
  // THE TEST ITSELF LIVES IN captions.js (`muddledAt`), where every candidate
  // position is marked before any price is paid; this only counts what the
  // caption search picked anyway, so the board reports the same ambiguity
  // the captions were charged for.
  if (!sol) return 0;
  var n = 0;
  spec.wants.forEach(function (w, i) {
    if (w.pill) return;
    var k = sol.pick[i];
    if (k == null || k < 0) return;                 // not drawn: nothing to mispair
    if (sol.cands[i][k].mud) { n++; if (who) who[i] = 1; }
  });
  return n;
}

// WHEN TWO EVENTS CROWD, IT IS THE EARLIER ONE THAT LEAVES THE TRUNK.
//
// Asked for three times and consistently -- "shelf team standup, down slope
// quick sync", "shelf downwards standup and up slope quick sync", "where is
// the shelf for team standup though" -- and there is a reason for it worth
// writing down rather than treating as taste.
//
// The reader travels along a trunk in time order. Take the FIRST of a
// crowded pair off it and the trunk is already clear by the time the eye
// reaches the second, so the trunk's own next stop is unambiguous and the
// spur reads as a detour already taken. Take the SECOND off and the reader
// meets the crowd first and has to resolve it before the spur can help.
//
// A tie-break and not a rule: priced well under a caption clash, so a board
// that can only work the other way round still does it the other way round.
function lateLeaver(spec) {
  var n = 0;
  for (var i = 0; i < spec.wants.length; i++) {
    for (var j = 0; j < spec.wants.length; j++) {
      var wi = spec.wants[i], wj = spec.wants[j];
      if (i === j || wi.pill || wj.pill || wi.line !== wj.line) continue;
      if (wj.a0 <= wi.a0) continue;                      // j is the later one
      if (wj.a0 - wi.a1 > Math.max(wi.w, wj.w) * 0.6) continue;
      var jOff = !!(wj._rail && wj._rail !== wj.line);
      var iOff = !!(wi._rail && wi._rail !== wi.line);
      if (jOff && !iOff) n++;
    }
  }
  return n;
}

// WHAT A BOARD COSTS. ONE FUNCTION, AND EVERYTHING THAT JUDGES A BOARD ASKS
// IT.
//
// There were two. The band search priced an allocation with every term --
// clashes, shed names, muddled pairs, bumps, straddles, branches, the
// tie-break -- and then the final choice between the restarts' boards used a
// cut-down one: names shed, faults, and the caption energy. So the search
// could find the better board and the last step would throw it away, blind
// to most of what it had just been optimising. Asked for the earlier of two
// crowded events to take the shelf, the search DID prefer it and the pick
// could not see the difference.
//
// That is the same fault as the intent-versus-drawing one, wearing different
// clothes: two answers to one question, and the one that ships is not the
// one being improved.
// TWO LINES' NAMES ON EACH OTHER, counted where it can be fixed.
//
// A terminus name sits at the end of its own rail, so this is not a question
// about words at all: it says two rails have arrived at the same level, and
// the only pass that can do anything about that is the one choosing the bands
// and the steps. Priced here, it moves a gap; priced in the caption search it
// would move a caption that was never the problem, and priced in `fit` it
// threw a whole person off the board.
function nameClash(b) {
  var fx = (b.fixed || []).filter(function (f) { return f.kind === 'terminus'; });
  var n = 0;
  for (var i = 0; i < fx.length; i++) {
    for (var j = i + 1; j < fx.length; j++) {
      if (B.capsOverlap(fx[i].box(), fx[j].box())) n++;
    }
  }
  return n;
}

// ...AND A RAIL THROUGH ONE, which is the same pass's to fix and NOT the same
// price. Two names on each other loses one of them outright; a rail through a
// name leaves the words readable -- they wear a paper outline -- and only
// makes the legend harder to read. Counted apart so it can be worth less.
function nameCut(b) {
  var n = 0;
  (b.fixed || []).forEach(function (f) {
    if (f.kind === 'bandname') {
      for (var k0 = 0; k0 < b.lines.length; k0++) {
        if (b.lines[k0].key !== f.line && B.lineTouches(b.lines[k0], f.box())) n++;
      }
      return;
    }
    if (f.kind !== 'terminus') return;
    var box = f.box();
    // ...AND THE PAPER JUST PAST IT: a shelf climbing on the name's side a
    // few pixels after the words end crowds the head as much as one through
    // them -- "shouldn't it be under if the name is already up top?". Twice
    // the head's own depth past its end, on the side of the axis it faces.
    var reach = (box.c1 - box.c0) * 2;
    if (f.align === 'right') box = { a0: box.a0 - reach, a1: box.a1, c0: box.c0, c1: box.c1 };
    else box = { a0: box.a0, a1: box.a1 + reach, c0: box.c0, c1: box.c1 };
    for (var k = 0; k < b.lines.length; k++) {
      var ln = b.lines[k];
      // ITS OWN SPURS COUNT: a branch climbing through its own line's name
      // cut "Bart" as surely as a neighbour's rail would, and Detention went
      // up through it when down was clear. Only the trunk itself is exempt.
      if (ln.key === f.line) continue;
      // a head carrying a route row counts three times: it is two rows of
      // words the reader needs, where a bare name is one
      if (B.lineTouches(ln, box)) n += f.route ? 3 : 1;
    }
  });
  return n;
}

// PAPER NOBODY IS USING AT THE EDGES. The gaps start even and only move
// when a caption gains by it, so a board with room to spare kept a band and
// a half of empty paper above the first line and below the last while the
// lines in the middle sat as close as ever: "unused space". The edge gaps
// have one side of captions to hold, so past six tenths of an inner gap
// they are slack, and slack is charged a little -- less than any caption
// preference, so it only moves paper nobody wanted.
function edgeSlack(gaps) {
  if (!gaps || gaps.length < 3) return 0;
  var inner = gaps.slice(1, -1), mean = 0;
  inner.forEach(function (g) { mean += g / inner.length; });
  var allow = mean * 0.6;
  var slack = Math.max(0, gaps[0] - allow) + Math.max(0, gaps[gaps.length - 1] - allow);
  // IN STEPS, so the search does not spend its budget chasing six pixels of
  // paper at a time: measured to the pixel, every small shift of paper
  // inward was an improvement and the descent ran to its limit on a board
  // that was already settled.
  return Math.floor(slack / 16) * 16;
}

function boardCost(spec, b, sol) {
  var mud = muddle(spec, b, sol);
  b.muddle = mud;
  b.nameClash = nameClash(b);
  b.nameCut = nameCut(b);
  b.bumps = bumps(b, spec.bumpNear);
  b.straddles = straddles(spec, b, { steps: b.wanted });
  b.lateLeavers = lateLeaver(spec);
  return sol.energy
       + b.straddles * spec.straddlePrice
       + (b.travel || 0) * spec.stepPrice
       - b.bends * spec.stepWorth
       // A SHELF IS THE FORM AN EVENT TAKES, not a detour it has to earn:
       // "add shelves back instead of slopes, the labels are much easier
       // to place for that." Rewarded the way a step was, with the same
       // ceiling, and vetoed by everything a shelf can break.
       - (b.branches || 0) * spec.shelfWorth
       // A CROWDED STRETCH ON ITS OWN SHELF: its dots and its list travel
       // together there, where on the trunk the list stood wherever the
       // trunk's neighbours left room, rows away from the dots it names.
       - (b.crowdShelves || 0) * spec.crowdShelfWorth
       + (b.branches || 0) * spec.branchPrice
       + (b.crossings || 0) * spec.crossPrice
       + b.lateLeavers * spec.latePrice
       // Ambiguity is priced INSIDE `sol.energy`: the caption search charges
       // every mistakable position `muddlePrice` itself, so the captions
       // avoid it where a slide can and the band search pays for what they
       // could not.
       + b.nameClash * spec.nameClashPrice
       + (b.shelfClash || 0) * spec.shelfClashPrice
       + b.nameCut * spec.nameCutPrice
       + b.bumps * spec.bumpPrice
       + (b.edgeSlack || 0) * spec.edgePrice;
}

function trial(spec, b, st) {
  var sol = C.solve(spec.wants, b, { iters: 0, minLift: spec.minLift, muddlePrice: spec.muddlePrice,
                                     cache: spec._cands });
  b.straddles = straddles(spec, b, st);
  b.edgeSlack = edgeSlack(st.gaps);
  b.drift = drift(spec, b);   // measured, not charged: see the note on `drift`
  return { cost: boardCost(spec, b, sol), shed: sol.shed };
}


// ...AND THE LINES SPREAD EVENLY WHEN NOTHING NEEDS THE ROOM.
//
// A board that has satisfied every caption still has choices left, and
// between two of those the one with the lines evenly spread reads as a map
// rather than as wherever the search happened to stop. At the weight this
// started with it was decoration and behaved like it: the first real panel
// came out with a hundred and sixty pixels of empty band across the middle
// and the bottom two lines crowded together, because nothing was asking for
// the space and nothing was asking it to be shared either.
//
// Raised until it actually moves the board, and measured at every step: the
// gaps go from 46|90|159|53|84 to 107|94|97|94|40 with no change at all to
// what the board achieves -- same names placed, same faults, same pairing,
// same slopes. It is priced in the tens against thousands for anything a
// reader would notice, so a line that genuinely needs depth still takes it.
function tidiness(spec, gaps) {
  // A GAP BETWEEN TWO LINES WITH NOTHING ON THEM IS NOT SPREAD, IT IS
  // SPENT. Three empty people above one busy one took even gaps, and the busy
  // line's names shrank and its spurs ran together: "Copilot updates doesn't
  // get any space here. The rest of the tracks could compact a bit." Such a
  // gap is charged for every pixel past what two names need, and left out of
  // the evenness, so the room goes where there is something to draw.
  var busy = {};
  (spec.wants || []).forEach(function (w) {
    if (w.line) busy[w.line] = 1;
    if (w.pill) (spec.pills || []).forEach(function (p) {
      if (p.id === w.pill) p.lines.forEach(function (k) { busy[k] = 1; });
    });
  });
  var idle = 0, keep = [];
  var floor = (spec.nameH || 14) * 2 + spec.railGap * 2;
  for (var gi = 1; gi < gaps.length - 1; gi++) {
    var up = spec.lines[gi - 1], dn = spec.lines[gi];
    if (up && dn && !busy[up.key] && !busy[dn.key]) idle += Math.max(0, gaps[gi] - floor);
    else keep.push(gaps[gi]);
  }
  if (!idle && keep.length === gaps.length - 2) return tidinessOf(gaps);
  // What is left is shared evenly between the busy lines' own gaps, the
  // paper's edges included, so the room lands on both sides of the lines
  // that need it rather than all in one band.
  var ends = [];
  if (spec.lines[0] && busy[spec.lines[0].key]) ends.push(gaps[0]);
  var lastL = spec.lines[spec.lines.length - 1];
  if (lastL && busy[lastL.key]) ends.push(gaps[gaps.length - 1]);
  var all = keep.concat(ends), mean = 0, v = 0;
  all.forEach(function (g) { mean += g / all.length; });
  all.forEach(function (g) { v += (g - mean) * (g - mean); });
  return (all.length ? Math.sqrt(v / all.length) * 0.6 : 0) + idle * 1.0;
}
function tidinessOf(gaps) {
  var inner = gaps.slice(1, gaps.length - 1);
  if (!inner.length) return 0;
  var mean = inner.reduce(function (a, x) { return a + x; }, 0) / inner.length;
  var v = 0;
  inner.forEach(function (x) { v += (x - mean) * (x - mean); });
  // ...AND AN EDGE GAP IS AN EDGE GAP, NOT A PLACE TO PUT SPARE BOARD.
  //
  // Only the gaps BETWEEN lines were weighed, on the reading that the two at
  // the edges are edges and nobody minds how wide an edge is. On the first
  // real panel the top edge came out at three hundred and thirty pixels of
  // a four hundred and eighty pixel board -- a third of the panel blank,
  // with the bottom three lines crowded into what was left -- because
  // nothing was asking for that space and nothing was stopping it going
  // there either. An edge wider than the gaps between the lines is board
  // nobody is using.
  var edge = 0;
  [gaps[0], gaps[gaps.length - 1]].forEach(function (g) {
    edge += Math.max(0, g - mean);
  });
  return (Math.sqrt(v / inner.length) + edge) * 0.6;
}

// A FEW RUNS FROM DIFFERENT STARTS, KEEPING THE BEST.
//
// The reflection cases found this before they found any asymmetry: the tight
// board came out 8 names placed on some seeds and 7 on others, straight AND
// reflected, about a third of the time each. One anneal from one start is a
// coin the board is tossing, and a layout that is perfect or not depending
// on nothing at all is not something anyone can rely on or debug.
//
// Restarts are the cheapest possible fix and they are the right one here:
// the runs are independent, the cost is linear, and the answer can only get
// better. What it must NOT be is a longer single anneal -- measured, 1400
// iterations from one start bought nothing over 900, because the search is
// not short of time, it is stuck.
// THE BOARD SEARCHED WITHOUT A COIN, and it used to need one.
//
// This was simulated annealing over the same state -- the gaps between the
// lines, what each line does for each event, what form each caption wears --
// with five random restarts keeping the best. Deterministic per input, and
// seed-sensitive, which is the fault worth naming: the answer depended on a
// number nobody had chosen for a reason, and on a tight board the same input
// swung between one and eight mispaired names across seeds. "It happens to be
// seeded well" is not a property anyone can rely on or debug.
//
// COORDINATE DESCENT instead, over a fixed set of moves, in a fixed order,
// repeated until a whole sweep improves nothing. Deterministic with no seed
// at all, monotone so it always terminates, and the fixed point it reaches
// is one where no single move helps -- the claim the annealer could make
// only on average.
//
// The moves are the ones the state has:
//   - shift paper between two gaps, at a few sizes;
//   - change what one line does for one event (mark, step either way,
//     branch either way);
//   - change what one caption wears;
//   - and take the whole board down a step of the ladder at once, which is
//     the one move no single-caption change can reach.
//
// STARTED FROM MORE THAN ONE PLACE, deterministically. An even spread with
// every rail flat is the right beginning for most days and a local minimum
// on some; a second start with every event stepping reaches boards the first
// cannot. Both are fixed, so the pair is still the same every run.
function solveBands(spec, opts) {
  opts = opts || {};
  var n = spec.lines.length;
  var span = spec.cross.c1 - spec.cross.c0;
  var minGap = opts.minGap != null ? opts.minGap : 14;

  function evenGaps() {
    var g = [], even = span / (n + 1);
    for (var i = 0; i <= n; i++) g.push(even);
    return g;
  }
  function score(state) {
    dress(state);
    var b = boardFor(spec, state);
    var r = trial(spec, b, state);
    return { cost: r.cost + tidiness(spec, state.gaps) + plainness(state),
             starved: r.shed, board: b };
  }
  function dress(state) {
    spec.wants.forEach(function (w, i) { w.wear(state.forms[i]); });
  }
  function plainness(state) {
    var c = 0;
    // A form's rung, not its index: a folded name sits between the whole
    // name and a name without its time, and the ladder's index would price
    // it as a full rung lost.
    spec.wants.forEach(function (w, i) {
      var f = w.forms[Math.min(w.forms.length - 1, state.forms[i])];
      c += (f && f.rung != null ? f.rung : state.forms[i]) * spec.formPrice;
    });
    return c;
  }
  function clone(x) {
    return { gaps: x.gaps.slice(), steps: x.steps.slice(), forms: x.forms.slice() };
  }

  // ONLY THE EVENTS THAT ARE IN TROUBLE.
  //
  // A sweep used to offer every event all five things its line could do and
  // every form its caption could wear, whether or not anything was wrong
  // with it. On an eight-line board that is four hundred and sixty boards to
  // build and price per sweep, and it took a minute. Almost all of it was
  // spent asking whether a caption that is sitting perfectly well would
  // rather be somewhere else.
  //
  // A move only ever helps an event that has something wrong with it: a name
  // not drawn, a name that could belong to two marks, a name with ink
  // through it. So those are the ones offered moves, plus their neighbours
  // in time on the same line, because the way to fix a crowded pair is
  // usually to move the OTHER one.
  function troubled(st) {
    var b = boardFor(spec, st);
    var sol = C.solve(spec.wants, b, { iters: 0, minLift: spec.minLift, muddlePrice: spec.muddlePrice });
    var bad = {};
    spec.wants.forEach(function (w, i) {
      if (sol.pick[i] < 0) bad[i] = 1;
    });
    // Whatever the board itself calls unreadable.
    var caps = {};
    B.check(b).forEach(function (f) { caps[f.what] = 1; });
    spec.wants.forEach(function (w, i) { if (caps[w.shown || w.text]) bad[i] = 1; });
    // ...and the mispaired, which is what most of this machinery exists for.
    //
    // NAMED, NOT COUNTED. Asking only whether the board had ANY mispairing
    // and then marking every event as troubled threw the pruning away on
    // exactly the boards that need it: one bad pair on a forty-event board
    // put all forty back in the neighbourhood. `muddle` says which.
    muddle(spec, b, sol, bad);
    var list = Object.keys(bad).map(Number);
    // Their neighbours in time on the same line.
    var more = {};
    list.forEach(function (i) {
      spec.wants.forEach(function (w, j) {
        if (j === i || w.pill || spec.wants[i].pill) return;
        if (w.line !== spec.wants[i].line) return;
        var apart = Math.max(w.a0 - spec.wants[i].a1, spec.wants[i].a0 - w.a1);
        if (apart < Math.max(w.w, spec.wants[i].w)) more[j] = 1;
      });
    });
    Object.keys(more).forEach(function (j) { bad[j] = 1; });
    return Object.keys(bad).map(Number);
  }

  // The moves, as a list of functions each returning a new state or null.
  var SHIFTS = [40, 16, 6];
  function neighbours(st) {
    var out = [];
    var i, j, k;
    var who = troubled(st);
    // EVERY PAIR OF GAPS AT EVERY SHIFT. Pruned to neighbouring gaps this
    // was a third of the pricing, and a reflected board came out one name
    // short where its mirror image did not: the descent walks a different
    // path from the first move, not merely to a different end.
    for (i = 0; i <= n; i++) {
      for (j = 0; j <= n; j++) {
        if (i === j) continue;
        for (k = 0; k < SHIFTS.length; k++) {
          if (st.gaps[i] - SHIFTS[k] < minGap) continue;
          var g = clone(st);
          g.gaps[i] -= SHIFTS[k]; g.gaps[j] += SHIFTS[k];
          out.push(g);
        }
      }
    }
    // A MARK OR A SHELF. The step -- the rail sloping for the event and
    // staying at its new level -- is no longer offered: "add shelves back
    // instead of slopes, the labels are much easier to place for that."
    var MODES = [0, 2, -2];
    // A SHELF IS OFFERED TO EVERY EVENT, not only to the ones in trouble: a
    // shelf is the form an event takes (shelfWorth), and a flat board with
    // every name placed had nothing troubled and so was never offered one
    // -- the answer that ended the search was the board with no shelves.
    // The forms and the rest of the moves stay with the troubled.
    var inWho = {};
    who.forEach(function (i2) { inWho[i2] = 1; });
    spec.wants.forEach(function (w2, i2) {
      if (inWho[i2]) return;
      // ...AND A RICHER FORM TO ANY NAME WEARING A POORER ONE. Once a name
      // was placed it was no longer in trouble, so it kept whatever form it
      // was placed in: "Get InspireD" stayed clamped to half its width with
      // three free rows under it -- "it should take 2 lines there, there is
      // plenty of space." Every richer form is offered back to it.
      for (var k4 = 0; k4 < (st.forms[i2] || 0); k4++) {
        var r4 = clone(st); r4.forms[i2] = k4; out.push(r4);
      }
      if (w2.tie || w2.allDay || w2.pill) return;
      for (var k3 = 1; k3 < MODES.length; k3++) {
        if (st.steps[i2] === MODES[k3]) continue;
        var m3 = clone(st); m3.steps[i2] = MODES[k3]; out.push(m3);
      }
    });
    who.forEach(function (i2) {
      // A tie's spur is a fact (above); the search has no move to offer it.
      for (var k2 = 0; k2 < MODES.length && !spec.wants[i2].tie; k2++) {
        if (st.steps[i2] === MODES[k2]) continue;
        var m = clone(st); m.steps[i2] = MODES[k2]; out.push(m);
      }
      for (k2 = 0; k2 < spec.wants[i2].formCount(); k2++) {
        if (st.forms[i2] === k2) continue;
        var f = clone(st); f.forms[i2] = k2; out.push(f);
      }
    });
    // BY RUNG, NOT BY INDEX. The folded name sits between the whole name
    // and the name without its time, so "everything one rung down" has to
    // mean the first form at least a whole rung down: taken by index it
    // folded every name on the board in one move, and the descent had no
    // budget left to unfold them one at a time.
    for (k = 0; k < 3; k++) {
      var lvl = clone(st);
      lvl.forms = lvl.forms.map(function (_, i2) {
        var fs = spec.wants[i2].forms;
        for (var fi = 0; fi < fs.length; fi++) {
          var rg = fs[fi].rung != null ? fs[fi].rung : fi;
          if (rg >= k - 1e-9) return fi;
        }
        return fs.length - 1;
      });
      out.push(lvl);
    }
    return out;
  }

  // BEST IMPROVEMENT, AND THE REASON IS SYMMETRY RATHER THAN QUALITY.
  //
  // First improvement -- take the first neighbour that helps and sweep again
  // -- is cheaper and finds much the same answers. It is also DIRECTIONAL,
  // which took a reflection case to notice: the neighbours are generated in
  // a fixed order, gap 0 upward, and mirroring a board reverses that order,
  // so the two halves of a symmetric problem get different answers. With the
  // randomness gone that was the last thing in here with a preferred
  // direction, and it was one nobody had put there on purpose.
  //
  // Best improvement prices every neighbour and takes the best, which does
  // not depend on the order they arrive in. It was unaffordable before the
  // neighbourhood was pruned to the events that are actually in trouble; it
  // is affordable now.
  function descend(st0) {
    var st = st0, cur = score(st);
    var budget = opts.evals || 800;
    var spent = 0;
    for (var pass = 0; pass < (opts.sweeps || 40); pass++) {
      var list = neighbours(st), best = null, bestS = cur;
      for (var i = 0; i < list.length && spent < budget; i++) {
        var s2 = score(list[i]); spent++;
        // Charged by the size of what was priced, and more than in
        // proportion: an arrangement of thirty captions costs twice the work
        // of fifteen AND has twice as many neighbours to try, so a dense day
        // gets fewer tries rather than more time. Fourteen captions, an
        // ordinary busy day, costs one try as it always did.
        if (opts.pool) opts.pool.used += Math.max(1, spec.wants.length * spec.wants.length / 14);
        if (opts.pool && opts.pool.left != null && opts.pool.used >= opts.pool.left) { spent = budget; break; }
        if (s2.cost < bestS.cost - 1e-9) { bestS = s2; best = list[i]; }
        // OUT OF TIME IS A BOARD, NOT A BLANK. A panel's renderer gives the
        // page a few seconds; past the deadline the descent keeps the best
        // it has found rather than the page keeping nothing.
        if (opts.deadline && (spent & 15) === 0 && Date.now() > opts.deadline) { spent = budget; break; }
      }
      if (!best || spent >= budget) break;
      // SETTLED IS SETTLED. Once a whole pass buys less than a few points,
      // what is left is slack being tidied six pixels at a time: five
      // passes of that on the demo board moved the cost by a dozen points
      // and cost half the search's time. Absolute, not a share of the
      // cost: measured as a share, a board still paying for a shed name
      // called a shelf's whole worth (60) settled and never took one.
      var settled = cur.cost - bestS.cost < 8;
      st = best; cur = bestS;
      if (settled) break;
    }
    return { st: st, s: cur };
  }

  // STARTED FROM SEVERAL PLACES, ALL OF THEM FIXED.
  //
  // Descent stops at the first arrangement no single move improves, and on a
  // crowded board that is often not the best one -- this is what annealing
  // was buying with its randomness, and what it charged a seed for. The
  // deterministic answer is to start from several places CHOSEN rather than
  // rolled: each is a different opinion about what the board should look
  // like before anything is measured, so they get stuck in different places
  // and the best is kept.
  //
  // Every rail flat is right for a quiet day. Every event stepping, either
  // way, reaches boards the flat start cannot -- a line that has already
  // moved has room the flat one has to find. Every event on a branch is the
  // answer for a day whose events are all crowded together. And the ladder
  // one rung down starts small, which a board that will end up small should
  // not have to discover a caption at a time.
  // A CROWDED STRETCH STARTS AT A SHORT LIST, and grows into a longer one
  // where the room is there (a richer form is offered back to any name
  // wearing a poorer one). Started at the whole list, a list too tall for its
  // band was a name in trouble, and the moves for a name in trouble ended it
  // at "Standup client ACME +5" with room for four rows under it.
  function crowdStart(w) {
    for (var fi = 0; fi < w.forms.length; fi++) if ((w.forms[fi].rows || []).length <= 4) return fi;
    return 0;
  }
  function start(steps, forms) {
    return { gaps: evenGaps(),
             steps: new Array(spec.wants.length).fill(steps),
             forms: spec.wants.map(function (w) { return forms === 0 && w.members ? crowdStart(w) : forms; }) };
  }
  // SHELVES FIRST. A shelf is the form an event takes (see shelfWorth), and
  // the search only offers a move to a caption in trouble, so a flat start
  // that comes out clean never tries one: the board that ended the search
  // was the one with no shelves on it. Every event on a shelf is where the
  // descent begins, and it takes shelves away where they cost something.
  var starts = [start(2, 0), start(0, 0), start(-2, 0)];
  // ONE AT A TIME, AND A CLEAN ANSWER ENDS IT. The other starts exist for
  // the crowded board the first cannot untangle; a board with every name
  // placed, none mistakable and no rail through a name has nothing left
  // for them to find but a few points of preference, at twice the time.
  // Anything shed, muddled or clashing is priced in the tens of thousands,
  // so a cost under that is a clean board.
  var all = [];
  for (var si = 0; si < starts.length; si++) {
    all.push(descend(starts[si]));
    if (all[all.length - 1].s.cost < 20000) break;
    if (opts.deadline && Date.now() > opts.deadline) break;
    if (opts.pool && opts.pool.left != null && opts.pool.used >= opts.pool.left) break;
  }
  all.sort(function (x, y) { return x.s.cost - y.s.cost; });
  return all;
}


// THE WHOLE ANSWER: paper, rails and words, from one call.
function solve(spec, opts) {
  spec.railGap = spec.railGap != null ? spec.railGap : 8;
  // Candidate positions remembered across trials: see captions.solve.
  spec._cands = {};
  // HOW CLOSE TWO RAILS COME AT AN INTERCHANGE. The same gap the rest of the
  // board keeps between two lines, which is what makes a bundle read as
  // several lines running together rather than as one thick one -- and it is
  // the number the capsule is then drawn around.
  // HOW FAR A DRAWN MARK REACHES PAST THE RAIL IT IS ON. The renderer scales
  // its marks with the panel and the solver does not know the panel, so the
  // one number the two have to agree on is passed in. Left at a guess, an
  // interchange capsule on a dense screen is a dozen pixels bigger than the
  // paper the caption search kept clear for it.
  spec.markR = spec.markR != null ? spec.markR : spec.railGap;
  // ...AND NEVER CLOSER THAN A MARK REACHES. Eight pixels is a gap on an OG
  // and a touch on a TRMNL X, where the rails are drawn half again as wide:
  // the dot where Lisa's assembly leaves the school day sat on Bart's rail
  // above it -- "a small gap between tracks so the circle doesn't clip into
  // the top track."
  spec.tieGap = spec.tieGap != null ? spec.tieGap : Math.max(spec.railGap, spec.markR);
  // The renderer's own corner radius, so the solver can size nested corners
  // to the legs they have. Passed in by the panel like `markR`.
  spec.corner = spec.corner != null ? spec.corner : 13;
  // A SHELF CLEAR OF ITS TRUNK: never shallower than a mark on each rail and
  // a rail's width of paper between them, whatever the panel's scale -- at a
  // flat fourteen a dense panel's shelf and trunk read as one thick rail:
  // "shelves need a tiny bit more space vertically, so there is a clear gap".
  spec.minLift = spec.minLift != null ? spec.minLift : Math.max(14, Math.round(spec.markR * 1.6 + 4));
  // How much clock a 45 degree departure may spend arriving. Past this a
  // shelf leaves upright, at the event's own minute, because nothing on this
  // board may be drawn before the thing it names.
  spec.leadCap = spec.leadCap != null ? spec.leadCap : 26;
  // HOW MUCH OF A LINE'S BAND ONE STEP MAY SPEND. Tried at a half and a
  // third, to stop the first long event of the day using the lot, and it is
  // a loss both times: a smaller step does not separate two events, so the
  // board buys BRANCHES instead, which is the thing it is trying to avoid.
  // Measured over five real days: slopes 19 at the full band, 12 at a half,
  // 6 at a third, with branches rising each time. Left at 1 with the
  // measurement written down.
  spec.stepShare = spec.stepShare != null ? spec.stepShare : 1;
  spec.nameH = spec.nameH != null ? spec.nameH : 14;
  // Two events the reader cannot tell apart is not as bad as a name that is
  // not drawn at all, and it is far worse than any preference. Between the
  // two, and well clear of both.
  // A NAME THE READER CANNOT PIN TO A MARK IS WORSE THAN ONE WITHOUT ITS
  // TIME, and for a while it was cheaper.
  //
  // At 8000 against 9000 for a time row the board kept the clock and
  // accepted the ambiguity, which is the wrong way round: a caption that
  // says "Swim Training" beside the right dot is useful, and one that says
  // "16:30-17:30 Swim Training" beside two dots is not. Measured on a half
  // board, 53 readable names of 61 at 8000, 55 at 15000 or 40000; on a
  // quadrant 42 against 43.
  //
  // The order this settles, worst first: a name not drawn (200000), two
  // names on each other (300000 -- it loses both), a name that could belong
  // to either of two marks, a name without its time (9000), a branch (2500).
  spec.muddlePrice = spec.muddlePrice != null ? spec.muddlePrice : 40000;
  // A LINE'S NAME LOST UNDER ANOTHER LINE'S NAME. Below an ambiguous caption,
  // because the reader can still find the rail and follow it; well above a
  // branch, because the legend is how they know whose rail it is at all.
  spec.nameClashPrice = spec.nameClashPrice != null ? spec.nameClashPrice : 20000;
  // A rail through a line's name: the words survive, the legend suffers. Well
  // under an ambiguous caption and well over a branch.
  spec.nameCutPrice = spec.nameCutPrice != null ? spec.nameCutPrice : 6000;
  // Deeper than a lead: "shelves should be further from the trunk." The
  // lead grows with it (see the branch pass), so a deep shelf is still a
  // 45 degree departure off a straight rail.
  spec.shelfDepth = spec.shelfDepth != null ? spec.shelfDepth : Math.max(spec.leadCap * 1.6, spec.minLift + spec.markR);
  spec.branchPrice = spec.branchPrice != null ? spec.branchPrice : 0;
  spec.shelfWorth = spec.shelfWorth != null ? spec.shelfWorth : 60;
  spec.crowdShelfWorth = spec.crowdShelfWorth != null ? spec.crowdShelfWorth : 3000;
  // A spur through another rail: dearer than any preference, cheaper than
  // a name lost, so the shelf goes the other way before anything is shed.
  spec.crossPrice = spec.crossPrice != null ? spec.crossPrice : 3000;
  spec.shelfClashPrice = spec.shelfClashPrice != null ? spec.shelfClashPrice : 6000;
  spec.latePrice = spec.latePrice != null ? spec.latePrice : 300;
  // Undoing a step straight away is the mountain, and it costs more than the
  // branch that avoids it.
  spec.bumpPrice = spec.bumpPrice != null ? spec.bumpPrice : 900;
  spec.edgePrice = spec.edgePrice != null ? spec.edgePrice : 0.4;
  spec.bumpNear = spec.bumpNear != null ? spec.bumpNear : 60;
  spec.straddlePrice = spec.straddlePrice != null ? spec.straddlePrice : 1200;
  spec.driftPrice = spec.driftPrice != null ? spec.driftPrice : 12;
  spec.stepPrice = spec.stepPrice != null ? spec.stepPrice : 0.15;
  // WHAT A STEP IS WORTH, and the ceiling is not a matter of taste.
  //
  // A caption pays 6 for standing one row further from its own rail. So a
  // step worth more than about that can BUY a caption's displacement, and
  // the search starts widening bands to collect the reward: measured, at 15
  // the shallow board distorts its allocation to afford one step, and at 5
  // it does not. The reward has to sit under what it might spend.
  spec.stepWorth = spec.stepWorth != null ? spec.stepWorth : 60;
  // WHAT GIVING UP A CAPTION'S TIME ROW COSTS, and it sits between two
  // fixed points rather than being chosen.
  //
  // It must be DEARER than making room -- a branch is 2500 -- or the board
  // takes an event's time away rather than giving it somewhere to go, which
  // is what "client workshop still needs it time" was: the one thing this
  // map exists to say, dropped to save a rail a detour.
  //
  // And it must be CHEAPER than not drawing the name at all, which captions
  // price at 20000. Past that the board starts shedding names instead of
  // shortening them: measured at 30000, nothing lost its time and an event
  // came off the board entirely. A name without its time is still a name.
  //
  // At 9000, one caption in sixty-six across five real days gives up its
  // time row and nothing is shed.
  spec.formPrice = spec.formPrice != null ? spec.formPrice : 18000;
  // THE OUTER SEARCH PROPOSES AND THE FULL SOLVE DISPOSES.
  //
  // An allocation is priced during the search by placing the captions
  // GREEDILY, which is fast, deterministic and pessimistic. The answer that
  // ships is then produced by the full annealed placement -- a different and
  // better solver -- so the allocation with the best greedy score is not
  // always the one that ends up best. Measured, and it showed up as the one
  // thing restarts must never do: going from three restarts to ten made the
  // board WORSE, because the tenth start found an allocation the greedy pass
  // liked more and the real placement liked less.
  //
  // So every restart's allocation is carried through the FULL solve and the
  // board that is actually best is the one kept. The proxy is now only what
  // it should ever have been: a way of proposing good candidates.
  var band = solveBands(spec, opts);
  var list = band.length ? band : [band];
  var bestBoard = null, bestScore = Infinity, bestSol = null, bestSt = null;
  var bestRails = [], bestLines = [];
  list.forEach(function (cand) {
    spec.wants.forEach(function (w, i) { w.wear(cand.st.forms[i]); });
    var bb = boardFor(spec, cand.st);
    var co = {};
    Object.keys(opts || {}).forEach(function (k) { co[k] = opts[k]; });
    co.minLift = spec.minLift; co.muddlePrice = spec.muddlePrice;
    var ss = C.solve(spec.wants, bb, co);
    C.apply(bb, spec.wants, ss);
    // Judged on what a reader gets: names not drawn first, then anything
    // unreadable, then how well the rest sits.
    // The SAME cost the search was optimising, plus the one thing only a
    // finished board can be asked: whether anything on it is unreadable.
    var faults = require('./board').check(bb).length;
    bb.edgeSlack = edgeSlack(cand.st.gaps);
    var score = faults * 1e6 + boardCost(spec, bb, ss);
    if (score < bestScore) {
      bestScore = score; bestBoard = bb; bestSol = ss; bestSt = cand.st;
      // THE WINNER'S SCRATCH, KEPT WITH THE WINNER.
      //
      // `boardFor` writes onto the spec -- which rail each event ended up
      // on, where each line's baseline is, how much room it has -- because
      // the caption search needs those. Several candidates are built here,
      // so what is left on the spec afterwards belongs to the LAST one tried
      // and not to the one that won. Everything asked afterwards was
      // therefore describing a different board: `drawn` said a mark where
      // the board had a branch, and a line's room was reported as three
      // pixels on a board that had given it forty-six.
      //
      // Snapshotted on the way past and put back at the end, so the spec and
      // the board that ships agree.
      bestRails = spec.wants.map(function (w) { return w._rail; });
      bestLines = spec.lines.map(function (l) { return { c: l._c, room: l._room }; });
    }
  });
  spec.wants.forEach(function (w, i) { w._rail = bestRails[i]; });
  spec.lines.forEach(function (l, i) { l._c = bestLines[i].c; l._room = bestLines[i].room; });
  band = { st: bestSt };
  var b = bestBoard, sol = bestSol;
  spec.wants.forEach(function (w, i) { w.wear(bestSt.forms[i]); });
  // THE MARKS, on whichever rail the event ended up on. A board without its
  // dots and ticks is not a finished board: the caption says what, and only
  // the mark says exactly when. They go on the BRANCH for a shelved event,
  // which is the whole point of giving it one -- the dot, the tick and the
  // name travel together.
  spec.wants.forEach(function (w) {
    if (w.pill) return;
    var ln = b.lineByKey(w._rail || w.line);
    if (!ln) return;
    if (w.allDay) {
      // Rings at each end of the stretch rather than a dot and a tick: a
      // state is not a stop, so it gets the landmark mark and not a
      // station's.
      b.addStop({ line: ln.key, a: w.a0, c: ln.cAt(w.a0), kind: 'state' });
      b.addStop({ line: ln.key, a: w.a1, c: ln.cAt(w.a1), kind: 'state' });
      return;
    }
    // A tie's ring is its start; the spur's dot would sit on the bar.
    // A spur that had to leave after its event's minute (past a merge
    // diamond) carries its dot where it begins: the reader sees the split.
    var sa0 = ln.branchOf && ln.pts.length && ln.pts[0][0] > w.a0 ? ln.pts[0][0] : w.a0;
    // A LATER PART OF A STACK starts on the flat of the branch it rides, not
    // in the bend up to it: fifteen minutes of Good News Everyone put the next
    // dot, and the tick before it, on the corner.
    if (w.ride && ln.branchOf) sa0 = Math.max(sa0, flatFrom(ln) + (spec.corner || 13) * 0.6 + spec.markR * 1.2);
    // ...and a different mark where the board cannot see the minute: an
    // event already running when the window opened gets the half dot, not
    // the dot. See Want.open0 and the renderer.
    if (!w.tie || w.open0) b.addStop({ line: ln.key, a: sa0, c: ln.cAt(sa0), todo: w.todo,
                                       kind: w.open0 ? 'from' : 'start' });
    // every event in a crowded stretch keeps its own dot
    (w.members || []).forEach(function (a) {
      var ma = Math.max(a, sa0 + spec.markR * 1.2);
      b.addStop({ line: ln.key, a: ma, c: ln.cAt(ma), kind: 'start' });
    });
    var ea = w.endAt != null ? w.endAt : w.a1;
    // a stop starting where this ends: the tick stands just before its dot,
    // wherever that dot had to go
    if (w.endAt != null && ln.branchOf) spec.wants.forEach(function (o) {
      if (o.ride !== w.id || Math.abs(o.a0 - ea) >= 2) return;
      ea = Math.max(o.a0, flatFrom(ln) + (spec.corner || 13) * 0.6 + spec.markR * 1.2) - spec.markR * 0.9;
    });
    if (w.a1 > w.a0 && !w.open1) b.addStop({ line: ln.key, a: ea, c: ln.cAt(ea), kind: 'end' });
    // A MOMENT'S SPUR off a tie has no length to end at, and stopped in clear
    // paper: it ends the way every spur ends, with a tick, at its own tip.
    else if (w.tie && ln.branchOf && ln.pts.length) {
      var tip = ln.pts[ln.pts.length - 1];
      b.addStop({ line: ln.key, a: tip[0], c: tip[1], kind: 'end' });
    }
  });
  b.gaps = band.st.gaps;
  b.wanted = band.st.steps;
  b.forms = band.st.forms;
  b.shed = sol.shed;
  b.muddle = muddle(spec, b, sol);
  b.drawn = drawnModes(spec, b);
  b.lateLeavers = lateLeaver(spec);
  b.bumps = bumps(b, spec.bumpNear);
  b.straddles = straddles(spec, b, band.st);
  growCrowds(spec, b, band.st);
  return b;
}

// A CROWDED STRETCH'S LIST TAKES THE ROOM THAT IS THERE. The search prices a
// longer list against everything else on the board and does not always get
// to it: "it says +4 more even though there is vertical space left, why not
// show 2 more lines." Once the board is laid out, each list is grown in place
// to its longest form that fits: from the same edge along the axis, growing
// away from its own rail, and kept only where the board has no more faults
// than it had.
function growCrowds(spec, b, st) {
  var before = B.check(b).length;
  spec.wants.forEach(function (w, i) {
    if (!w.members) return;
    var cp = null;
    for (var ci = 0; ci < b.caps.length; ci++) if (b.caps[ci].id === w.id) cp = b.caps[ci];
    if (!cp) return;
    var cur = st.forms[i] || 0;
    var ln = b.lineByKey(cp.line);
    var railC = ln && cp.at != null ? ln.cAt(cp.at) : null;
    var below = railC == null || cp.c >= railC;
    for (var k = 0; k < cur; k++) {
      var f = w.forms[k];
      if (!f || f.h <= cp.h) continue;
      var was = { c: cp.c, a: cp.a, w: cp.w, h: cp.h, rows: cp.rows, rowCls: cp.rowCls, el: cp.el, text: cp.text, size: cp.size };
      cp.c = below ? cp.c : cp.c + cp.h - f.h;
      cp.a = Math.min(cp.a, b.axis.a1 - f.w);
      cp.w = f.w; cp.h = f.h; cp.rows = f.rows; cp.rowCls = f.rowCls; cp.el = f.el || null; cp.size = f.size;
      if (B.check(b).length <= before) { st.forms[i] = k; w.wear(k); return; }
      Object.keys(was).forEach(function (key) { cp[key] = was[key]; });
    }
  });
}


module.exports = { solve: solve, solveBands: solveBands, boardFor: boardFor,
                   muddle: muddle, drawnModes: drawnModes,
                   boardCost: boardCost, lateLeaver: lateLeaver };
