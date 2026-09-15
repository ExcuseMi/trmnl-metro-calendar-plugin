'use strict';

// WHAT A LINE DOES FOR AN EVENT. THREE ANSWERS, AND THE SOLVER PICKS.
//
// A MARK. The line runs straight through and the event is a dot and a tick
// on it. Cheapest, quietest, and right whenever the name beside it is
// unambiguous.
//
// A STEP. The line turns at the dot, runs at 45 degrees for as long as the
// event lasts, and goes flat again at its NEW level, where it stays.
//
//   "it should try to go keep going the same direction during an event.
//    Start of event, 45 degrees from the dot until it ends and then it can
//    go level again"
//
// This was built as a hold first -- out, flat, back -- and corrected on
// sight ("I see an up and down breakfast, just expecting an up"). A step
// does not come back. Three things follow: the climb IS the duration,
// because that is what 45 degrees means, so nothing has to decide how far;
// it is clamped by the line's own band and not by taste; and the paper it
// vacates is vacated permanently, which is what makes it worth putting a
// name in.
//
// A SHELF. THE LINE SPLITS. The trunk carries straight on and a spur peels
// off at the event's start, runs parallel for its length, and rejoins at the
// end. This is the one a step cannot do, and the case for it is two events
// twenty minutes apart on one line: whatever you do with the captions, two
// dots that close together on one rail leave the reader guessing which name
// belongs to which. Put one event on a branch and the dot, the tick and the
// name travel together, and there is nothing left to guess.
//
// BUILT AS A DEVIATION OF THE TRUNK FIRST, AND THAT WAS WRONG: "the line
// should split". Moved, the trunk is not there during the event, so the day
// itself has a hole in it where the event is -- which says the person
// stopped existing for an hour rather than that they did something. Split,
// the day runs on unbroken and the event is a thing off to one side of it,
// which is what a branch on a transit map means and what an event actually
// is.
//
// So a shelf comes back and a step does not, and that is not an
// inconsistency: they are answers to different questions. A step says the
// day changed level. A shelf says this event is a thing off to one side.
//
// WHEN A SHELF LEAVES. One corner before the event, so the line has
// finished turning by the event's own minute and the dot lands on flat rail
// rather than on a bend -- on the bend it reads as a bead threaded on a
// corner instead of a stop on a line. At 45 degrees the lead is as long as
// the shelf is deep, so a deep shelf would leave a long time before the
// thing it names, and nothing on this board may be drawn before the event it
// belongs to. Past `leadCap` the departure goes UPRIGHT instead, at the
// event's own minute, which needs no run at all.

// A third number on a point is that corner's own radius, in place of the
// renderer's default: nested corners at a bundle carry radii a gap apart so
// the arcs come out concentric (bands.js).
function push(pts, a, c, radius) {
  if (pts.length && pts[pts.length - 1][0] > a) return;
  pts.push(radius != null ? [a, c, radius] : [a, c]);
}

// One line's polyline.
//
// `moves` is [{a0, a1, kind, dir}] in axis order, where kind is 'step' or
// 'shelf' and dir is -1 or +1. `room` is how far the rail may stand off its
// baseline before it is in somebody else's band; `minLift` is the least it
// may move and still read as having moved at all.
function rail(key, baseC, moves, axis, room, minLift, leadCap, share) {
  minLift = minLift || 0;
  share = share || 0;
  leadCap = leadCap == null ? 1e9 : leadCap;
  // TWO LEVELS, AND THEY ARE NOT THE SAME QUESTION.
  //
  // `home` is the row this line calls its own -- what a STEP changes, because
  // a step says the day changed level and stays there. `lvl` is where the
  // rail actually is at this minute, which a convergence moves and a
  // convergence gives back. Held as one number, a line in two interchanges
  // back to back climbed all the way home between them and dived again for
  // no clock at all: on the demo board Bart left his row at eight for the
  // school run, returned at half past, and left again in the same pixel, and
  // the picture was two anonymous verticals a hair apart.
  var home = baseC, lvl = baseC, chainedPrev = false;
  var pts = [[axis.a0, lvl]];
  var last = axis.a0;
  var ms = (moves || []);
  for (var mi = 0; mi < ms.length; mi++) {
    var m = ms[mi];
    if (!m || !m.kind) continue;
    if (m.a0 < last) continue;            // no room since the last one: it keeps its rail
    if (m.kind === 'meet') {
      // AN INTERCHANGE: THE TRACKS COME TOGETHER AND PART AGAIN.
      //
      // The one shape on this board that is not about a single line. Four
      // people at one dinner is one dinner, and drawn as four stops on four
      // rails at four different heights it reads as four things happening at
      // once. Drawn as a transit map draws it -- the lines converge into a
      // bundle, run together through the event, and fan back out -- the
      // picture says "these people are in the same place" without a word.
      //
      // OUT AND BACK, unlike a step. A step says the day changed level and
      // stays there; a convergence is somewhere everybody went and then left,
      // so the rail returns to its own row and the reader's memory of where
      // that person lives survives the event.
      //
      // It is NOT clamped by the line's own band, and that is the point: the
      // whole move is into other people's rows. A crossing on a transit map
      // is not a fault, it is what an interchange looks like.
      var to = m.c;
      var d = Math.abs(to - lvl);
      // AND IT ARRIVES UPRIGHT WHEN IT IS COMING A LONG WAY.
      //
      // At 45 degrees the approach is as long as the climb, and a rail
      // crossing four rows to reach dinner is then leaning for a third of the
      // afternoon: the board drawn that way has every line on a diagonal from
      // three o'clock onwards and no row left that a reader could call
      // anybody's. It is also a lie about the clock -- a rail that starts
      // moving at two is saying something began at two.
      //
      // So the same rule a shelf's departure uses: up to `leadCap` of clock
      // may be spent arriving, and past that the turn is UPRIGHT at the
      // event's own minute, which needs no run at all. That is what the old
      // engine drew and it is what a transit map draws: square corners,
      // rounded by the renderer, with the flat runs left flat.
      //
      // A true-45 approach with the members staggered so the corners nest was
      // tried and looked worse on a real board -- every convergence became a
      // pair of long shallow funnels and the rows stopped being rows. Judged
      // on the picture, which is the only place this can be judged.
      // ...and upright for every member when any member must be (bands.js).
      var lead = d <= leadCap && !m.upright ? d : 0;
      // `stagger` nests this corner inside the nearer rail's: see bands.js.
      // Through the wall (sgIn/sgOut: see bands.js), or at the boundary
      // when this group follows straight on from the last one.
      var entry = chainedPrev ? m.a0 + (m.sgChain || 0) : m.a0 - (m.sgIn || 0);
      var from = Math.max(axis.a0, last, entry - lead);
      // STARTING AT THE RIGHT HEIGHT. A group that begins within a lead of
      // the board's edge gave the rail a sliver of home row and then a
      // turn, and Lisa's track opened at an angle. There is nothing to say
      // in that sliver: the rail starts the day at the group's level.
      // WHERE THE RAIL LEAVES ITS ROW, AND WHERE IT COMES BACK, written on
      // the move for the renderer, which marks each with a hollow diamond:
      // the mark for a line changing state rather than for something
      // happening on it. Neither exists where the rail starts or ends the
      // board at the group's level, or passes straight into the next group.
      m.joinAt = null; m.leaveAt = null;
      m.inAt = entry;
      if (pts.length === 1 && from - axis.a0 < leadCap && !m.holdStart) {
        pts[0][1] = to; lvl = to;
      } else {
        push(pts, from, lvl, m.rFirst);
        if (!chainedPrev) m.joinAt = [from, lvl];
      }
      push(pts, entry, to, m.rIn);
      var nxt = ms[mi + 1];
      var chainNext = !!(nxt && nxt.kind === 'meet' && nxt.a0 - m.a1 <= leadCap);
      var exit = chainNext ? m.a1 : m.a1 + (m.sgOut || 0);
      // ...and out through the wall no later than that event allows.
      if (!chainNext && m.homeBy != null && exit > m.homeBy) exit = Math.max(m.a1, m.homeBy);
      push(pts, exit, to, m.rOut);
      m.outAt = exit;
      lvl = to;
      last = exit;
      // ONE DIVE FOR TWO INTERCHANGES BACK TO BACK.
      //
      // The school run ends at half past eight and the school day begins at
      // half past eight. Going home in between is a climb and a dive through
      // the whole board for no minutes of clock, and what it says is false:
      // the person did not leave and come back, they stayed. So where the
      // next convergence follows within a lead of this one, the rail holds
      // its level and lets that one take over from here.
      if (chainNext) { chainedPrev = true; continue; }
      chainedPrev = false;
      var gap = Math.abs(home - lvl);
      var slope = gap <= leadCap && !m.upright ? gap : 0;
      // Home, level, before the line's next event of its own (bands.js).
      if (m.homeBy != null && exit + slope > m.homeBy) slope = 0;
      var back = Math.min(axis.a1, exit + slope);
      // ...AND ENDING AT IT, for the same reason at the other edge.
      if (axis.a1 - exit < leadCap && !m.holdEnd) { push(pts, axis.a1, lvl); last = axis.a1; continue; }
      push(pts, back, home);
      m.leaveAt = [back, home];
      lvl = home;
      last = back;
      continue;
    }
    if (!m.dir) continue;
    var head = m.dir > 0 ? (baseC + room) - home : home - (baseC - room);
    head = Math.max(0, head);
    if (m.kind === 'step') {
      // ONE EVENT MAY NOT SPEND THE WHOLE BAND.
      //
      // The climb is the event's own length, clamped by the room left -- and
      // a long event is longer than the room, so the first one to step took
      // every pixel a line had in that direction and nothing after it could
      // step again. On a real board Design Review used the lot and Sprint
      // Planning, ninety minutes with plenty of run, had to take a branch
      // instead of the downslope it obviously wanted.
      //
      // So a single step may take at most a share of the band, and a line
      // gets several moves across a day instead of one. It is still one
      // direction and it still stays there; it just does not use up the
      // whole day's allowance at breakfast.
      var climb = Math.min(m.a1 - m.a0, head, share > 0 ? share : head);
      if (climb < minLift) continue;
      push(pts, m.a0, lvl);               // flat up to the dot
      home += m.dir * climb; lvl = home;
      push(pts, m.a0 + climb, lvl);       // 45 degrees, for as long as it lasts
      last = m.a0 + climb;
      continue;
    }
    // A SHELF DOES NOT MOVE THE TRUNK: see `branch`. The trunk carries
    // straight on through it, so there is nothing to draw here.
  }
  push(pts, axis.a1, lvl);
  return { key: key, pts: pts, endC: lvl };
}

// HOW FAR THE RAIL WANDERED, which is what a reader pays for a deviation.
//
// Not the ink: every rail crosses the whole board whatever it does. What
// costs the reader is the line not being where they last saw it.
function travel(moves, baseC, axis, room, minLift, leadCap, share) {
  var r = rail('t', baseC, moves, axis, room, minLift, leadCap, share);
  var t = 0;
  for (var i = 1; i < r.pts.length; i++) t += Math.abs(r.pts[i][1] - r.pts[i - 1][1]);
  return t;
}

// THE SPUR ITSELF: off the trunk at the event's start, along for its length,
// and back onto the trunk at the end.
//
// It leaves one lead early so the line has finished turning by the event's
// own minute and the dot lands on flat rail rather than on a bend -- on the
// bend it reads as a bead threaded on a corner instead of a stop on a line.
// At 45 degrees that lead is as long as the spur is deep, so a deep one
// would leave a long time before the thing it names, and nothing on this
// board may be drawn before the event it belongs to. Past `leadCap` it
// departs UPRIGHT at the event's own minute instead, which needs no run.
// IT HALTS WHEN THE EVENT DOES. "have team standup just halt when the event
// finishes."
//
// A spur that runs back to the trunk is saying the event came back, and an
// event does not come back: it ends. The branch stops at the tick, and the
// TRUNK is what carries the day onward -- which is exactly what the split
// was for. It is also half the ink and half the chance of the return
// crossing something on its way home.
// IT ARRIVES EARLY, SO THE EVENT IS ALONG THE SPUR RATHER THAN AT ITS HEAD.
//
// "You could start the branch early so the event is mid branch?" -- and the
// reason it matters is arithmetic. A fifteen-minute standup is twenty-odd
// pixels of axis, so a spur whose flat run is exactly the event is a stub
// barely wider than its own dot, with a hundred-pixel name hanging off the
// end of it pointing at nothing. The branch was being offered for events it
// could not actually serve.
//
// So the spur goes flat BEFORE the dot and the event sits along it. `pre` is
// how much, and it is bounded by two things that are both real: never more
// than the caption needs (past that it is ink for its own sake), and never
// so early that it starts before the board does.
//
// This does draw a little line before the event begins, which the rule
// against drawing anything before the thing it names exists to prevent. The
// distinction is what the ink SAYS: a mark before the start would claim the
// event began earlier, and a rail arriving does not -- the dot is still
// exactly at the minute, and nothing about the spur is readable as a time
// except its marks.
//
// `floor` is the earliest minute the spur may leave the trunk: a spur out of
// a convergence leaves from inside it, not from the slope the trunk took to
// get there. Where a 45 degree lead will not fit between the floor and the
// event, the spur departs upright instead -- a shorter slope would not be 45
// degrees, and nothing on this board is drawn at any other angle.
//
// `corner` is how much flat trunk a 45 degree departure wants after the
// floor, so the split is off a straight rail and not off the rounded
// corner the trunk has just turned: a 45 degree lead that would have to
// leave from the corner departs upright instead, and an upright departure
// may leave from the floor itself.
function branch(key, trunk, a0, a1, dist, dir, axis, leadCap, pre, floor, corner) {
  leadCap = leadCap == null ? 1e9 : leadCap;
  var lead = dist <= leadCap ? dist : 0;
  var run = Math.max(0, pre || 0);
  var lo = floor == null ? axis.a0 : Math.max(axis.a0, floor);
  var loC = lo + Math.max(0, corner || 0);
  if (loC + lead > a0) lead = 0;
  var base = lead ? loC : lo;
  var flat = Math.max(base + lead, a0 - run);
  var from = Math.max(base, flat - lead);
  var cFrom = trunk.cAt(from);
  if (cFrom == null) return null;
  var shelfC = trunk.cAt((a0 + a1) / 2) + dir * dist;
  var pts = [];
  // ALREADY ON ITS SHELF WHEN THE BOARD OPENS. An event running at the first
  // minute of the paper did not leave the trunk there, so its spur does not
  // drop off the trunk at the edge: it arrives from off the paper at its own
  // depth, under the half dot (rule 2g). Two of them dropping at the edge
  // was one column with two rails in it.
  if (a0 <= axis.a0 + 0.5 && trunk.cAt(axis.a0) != null) {
    push(pts, axis.a0, shelfC);
    push(pts, a1, shelfC);
    return { key: key, pts: pts, shelfC: shelfC, dist: dist, dir: dir, flat: axis.a0 };
  }
  push(pts, from, cFrom);
  push(pts, flat, shelfC);
  push(pts, a1, shelfC);
  return { key: key, pts: pts, shelfC: shelfC, dist: dist, dir: dir, flat: flat };
}

module.exports = { rail: rail, travel: travel, branch: branch };
