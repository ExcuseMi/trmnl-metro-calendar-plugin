'use strict';

// THE HARD BOARDS, CHECKED IN MILLISECONDS.
//
// The existing layout suite is right about what it asks and wrong about what
// it costs: four minutes a run, because every question goes through a plugin
// build and a Chromium launch. At that price nobody measures after one
// change, so changes arrive in threes and the suite can only say that
// something broke.
//
// These are the same questions asked of data. The whole file runs in about
// the time it takes the other suite to start. When one fails it prints the
// BOARD, because "Quick Sync overlaps Team Standup" is a fact and the picture
// is the explanation.
//
// Every case here is a board that has actually gone wrong on a panel. They
// are not invented difficulties.

var { Board, report, check, pairing, bends, wobbles } = require('./board');
var C = require('./captions');
var Bands = require('./bands');
var R = require('./rails');

var cases = [];
// A plain assertion with no board behind it, for the few questions that are
// about the solver's own behaviour rather than about one drawing.
function test(name, fn) { cases.push({ name: name, plain: fn }); }
function assert(ok, msg) { if (!ok) throw new Error(msg || 'assertion failed'); }
// A case is either a BOARD already built, where only the captions are in
// question, or a SPEC, where the paper is in question too and `bands` solves
// both together.
function board(name, build) { cases.push({ name: name, build: build }); }
function band(name, build) { cases.push({ name: name, build: build, bands: true }); }

// A HAND-BUILT BOARD STILL BUILDS ITS RAILS THE ONE WAY.
//
// These fixtures used to spell the polyline out by hand, and they were
// written before a step was a step: all three drew Donut Break as a
// MOUNTAIN -- up before the event, flat across it, back down after -- which
// is the hold that was corrected, and which `rails.js` cannot produce. So a
// case was testing the solver against a shape the solver would never draw,
// and the picture taught the wrong thing to anyone reading it.
//
// A fixture may not express a shape the model forbids. Every rail here now
// goes through `R.rail`, exactly as the solver's own boards do.
function railLine(b, key, baseC, steps, axis, room) {
  var r = R.rail(key, baseC, steps, axis, room == null ? 1e9 : room, 0);
  return b.addLine({ key: r.key, pts: r.pts });
}

function stops(b, wants) {
  wants.forEach(function (w) {
    var ln = b.lineByKey(w.line);
    b.addStop({ line: w.line, a: w.a0, c: ln.cAt(w.a0), kind: 'start' });
    if (w.a1 > w.a0) b.addStop({ line: w.line, a: w.a1, c: ln.cAt(w.a1), kind: 'end' });
  });
}

// TWO EVENTS TWENTY MINUTES APART ON ONE LINE.
//
// "Team Standup at eight and Quick Sync at twenty past are the whole of
// that": no anchor along the line is far enough away when the line is where
// they both are. Every previous attempt solved it by moving one of them
// along, which drags a name away from the minute it belongs to. The answer
// is that one of them goes on the other side of the rail.
band('two stops twenty minutes apart', function () {
  var spec = { axis: { a0: 0, a1: 900 }, cross: { c0: 0, c1: 240 },
               lines: [{ key: 'mar' }], wants: [
    new C.Want({ id: '1', text: 'Team Standup', line: 'mar', a0: 100, a1: 160, w: 110, h: 16 }),
    new C.Want({ id: '2', text: 'Quick Sync', line: 'mar', a0: 140, a1: 200, w: 95, h: 16 }),
  ] };
  // ONE OF THEM HAS TO LEAVE THE TRUNK.
  //
  // Placing the captions cleanly is not enough and never was: two dots
  // twenty minutes apart on one rail leave the reader guessing which name
  // belongs to which, however tidy the words are. Asked for directly --
  // "shelf team standup, down slope quick sync", "or shelf downwards
  // standup and up slope quick sync" -- and both readings are the same
  // thing: one event off on its own spur, the other sloping the opposite
  // way, so the two are in different places rather than merely labelled
  // differently.
  return { spec: spec, expectShed: 0, apart: true };
});

// A CAPTION WHOSE OWN RAIL CLIMBS THROUGH IT.
//
// The old pass excluded a caption's own line from the pierce test, on the
// reading that a name travels with the rail it names. That stopped being
// true the moment a rail could climb for an event, and "Homer" has been
// drawn through Homer's own line ever since.
board('a rail that climbs through its own name', function () {
  var b = new Board({ axis: { a0: 0, a1: 900 }, cross: { c0: 0, c1: 240 } });
  // One direction, and it stays there: flat to the dot at 360, then 45
  // degrees for as long as the event lasts, then flat at the new level.
  railLine(b, 'hom', 160, [{ a0: 360, a1: 560, dir: -1 }], { a0: 0, a1: 900 }, 60);
  var wants = [
    new C.Want({ id: '1', text: 'Donut Break', line: 'hom', a0: 360, a1: 560, w: 105, h: 16 }),
  ];
  stops(b, wants);
  return { b: b, wants: wants, expectShed: 0 };
});

// FOUR LINES, A CAPTION'S HEIGHT APART.
//
// The band solver sizes paper from counts, so it regularly hands out a gap
// that one caption fits in and two do not. Everything here has to go
// somewhere and there is exactly enough room.
board('four lines packed a caption apart', function () {
  var b = new Board({ axis: { a0: 0, a1: 1000 }, cross: { c0: 0, c1: 200 } });
  [40, 85, 130, 175].forEach(function (c, i) {
    b.addLine({ key: 'L' + i, pts: [[0, c], [1000, c]] });
  });
  var wants = [];
  [[0, 120, 'Breakfast'], [1, 300, 'Standup'], [2, 520, 'Workshop'], [3, 740, 'Dinner'],
   [0, 600, 'Groceries'], [2, 180, 'School Run']].forEach(function (t, i) {
    wants.push(new C.Want({ id: 'w' + i, text: t[2], line: 'L' + t[0],
                            a0: t[1], a1: t[1] + 60, w: t[2].length * 8, h: 14 }));
  });
  stops(b, wants);
  return { b: b, wants: wants, expectShed: 0 };
});

// A NARROW COLUMN, which is `half_vertical` (E36).
//
// Standing up, a caption's length runs ALONG the axis, so two events near in
// time cover nearly the same stretch of it and there is no sliding room. The
// landscape answer -- put one on each side -- is the only one here too.
board('a narrow column with no sliding room', function () {
  var b = new Board({ axis: { a0: 0, a1: 460 }, cross: { c0: 0, c1: 380 } });
  b.addLine({ key: 'a', pts: [[0, 110], [460, 110]] });
  b.addLine({ key: 'b', pts: [[0, 260], [460, 260]] });
  var wants = [
    new C.Want({ id: '1', text: 'Team Standup', line: 'a', a0: 60, a1: 100, w: 105, h: 14 }),
    new C.Want({ id: '2', text: 'Quick Sync', line: 'a', a0: 90, a1: 130, w: 90, h: 14 }),
    new C.Want({ id: '3', text: 'Desk booking', line: 'b', a0: 200, a1: 260, w: 110, h: 14 }),
    new C.Want({ id: '4', text: 'Shift Handover', line: 'b', a0: 240, a1: 300, w: 125, h: 14 }),
  ];
  stops(b, wants);
  return { b: b, wants: wants, expectShed: 0 };
});

// MORE NAMES THAN PAPER, which must SHED rather than stack.
//
// The failure this exists to prevent is the quiet one: when nothing fits, the
// old pass takes the least bad position and says nothing, so two names end up
// in one place and one of them is simply gone. A board that cannot fit a name
// has to say so.
board('more names than paper sheds instead of stacking', function () {
  var b = new Board({ axis: { a0: 0, a1: 260 }, cross: { c0: 0, c1: 64 } });
  b.addLine({ key: 'a', pts: [[0, 32], [260, 32]] });
  var wants = [];
  for (var i = 0; i < 5; i++) {
    wants.push(new C.Want({ id: 'w' + i, text: 'Event ' + (i + 1), line: 'a',
                            a0: 20 + i * 10, a1: 28 + i * 10, w: 110, h: 14 }));
  }
  stops(b, wants);
  // Two rows of paper, one either side, and five names a hundred and ten
  // wide on a two-hundred-and-sixty-wide board. Something has to go; what
  // must NOT happen is two of them in one place.
  return { b: b, wants: wants, minShed: 1 };
});

// PAPER GOES WHERE THE WORDS ARE, which is the thing counts cannot do.
//
// Twelve wide names on one line of three, and the other two carry nothing.
// An even spread -- which is what a solver handed COUNTS returns, because
// twelve events is twelve events however wide they are -- fits them, but only
// by pushing two of them past the next line entirely, where they sit against
// a rail that is not theirs. Clean by every test, and it tells the reader
// that Physio belongs to somebody else.
//
// Asked as one question, the search takes depth from the empty gaps and gives
// it to the two bands touching the busy line: 31|31|31|31 becomes 17|42|42|25
// and every name stays beside its own rail.
band('paper goes where the words are', function () {
  var spec = { axis: { a0: 0, a1: 700 }, cross: { c0: 0, c1: 126 },
               lines: [{ key: 'a' }, { key: 'b' }, { key: 'c' }], wants: [] };
  ['Morning Standup', 'Client Workshop', 'Grocery Delivery', 'Physio Session',
   'Parents Evening', 'Dinner with Alex', 'School Pickup', 'Bath and Bed',
   'Team Retro', 'Dentist Visit', 'Piano Practice', 'Book Club']
    .forEach(function (t, i) {
      spec.wants.push(new C.Want({ id: 'w' + i, text: t, line: 'b',
        a0: 30 + i * 52, a1: 50 + i * 52, w: t.length * 8, h: 14 }));
    });
  // TWO AND A HALF ROWS, NOT TWO POINT TWO. Every name here is wider than the
  // gap to the next dot, so a caption on its own row covers its neighbour's
  // mark; once the caption search could see that for itself (captions.js,
  // `muddledAt`) it took three ambiguous names down to one by standing a
  // little further out, and the bound that was calibrated on the ambiguous
  // board sat a fifth of a row too tight for the honest one.
  return { spec: spec, expectShed: 0, maxOff: 2.5 };
});

// A STEP IS TAKEN WHERE THERE IS ROOM FOR ONE.
//
// What was asked for: "45 degree sections for events that can do it without
// disturbing the rest of the flow". That is a REWARD with a veto over it, and
// getting it the other way round is the first thing that was tried here: a
// step does not buy capacity -- it moves a rail, it does not deepen the band
// -- so priced as a cost it is never worth taking and every rail comes out
// flat, which is not the map that was asked for.
// ...AND THEN THE STEP WAS TAKEN AWAY: "add shelves back instead of slopes,
// the labels are much easier to place for that." The rails stay flat and a
// line moves for an event only by SPLITTING, so a board with all the room
// in the world shows no bend anywhere.
band('a rail never steps, even where the band has room', function () {
  var spec = { axis: { a0: 0, a1: 620 }, cross: { c0: 0, c1: 260 },
               lines: [{ key: 'a' }, { key: 'b' }, { key: 'c' }], wants: [] };
  spec.wants.push(new C.Want({ id: '1', text: 'Breakfast', line: 'a', a0: 40, a1: 120, w: 80, h: 22 }));
  spec.wants.push(new C.Want({ id: '2', text: 'Reactor Core Check', line: 'b', a0: 170, a1: 430, w: 150, h: 22 }));
  spec.wants.push(new C.Want({ id: '3', text: 'Bedtime', line: 'c', a0: 500, a1: 580, w: 70, h: 22 }));
  return { spec: spec, expectShed: 0, steps: 'none' };
});

// ...AND NEVER AT THE COST OF A NAME.
//
// The contract, stated as the thing it actually is. "A shallow band keeps
// its rail straight" was the first attempt and it was a guess about one
// board rather than a rule: the search found a way to afford a clean,
// readable step there, and the case failed something that was right.
//
// What must hold is that giving the rails their freedom cannot make the
// board worse. So the same board is solved twice, once with rails pinned
// flat and once free, and the free one has to place at least as many names
// and be at least as clean. A step is a reward with a veto over it, and this
// is the veto, checked rather than asserted.
band('letting a rail step never costs a name', function () {
  function build(cross) {
    var spec = { axis: { a0: 0, a1: 620 }, cross: { c0: 0, c1: cross },
                 lines: [{ key: 'a' }, { key: 'b' }, { key: 'c' }], wants: [] };
    spec.wants.push(new C.Want({ id: '1', text: 'Breakfast', line: 'a', a0: 40, a1: 120, w: 80, h: 22 }));
    spec.wants.push(new C.Want({ id: '2', text: 'Reactor Core Check', line: 'b', a0: 170, a1: 430, w: 150, h: 22 }));
    spec.wants.push(new C.Want({ id: '3', text: 'Bedtime', line: 'c', a0: 500, a1: 580, w: 70, h: 22 }));
    return spec;
  }
  return {
    spec: build(132),
    verify: function (b) {
      var bad = [];
      [132, 190, 260].forEach(function (cross) {
        var pinned = Bands.solve(Object.assign(build(cross), { stepWorth: 0, minLift: 1e9 }), {});
        var free = Bands.solve(build(cross), {});
        if (free.shed > pinned.shed) {
          bad.push(cross + ' deep: stepping shed ' + free.shed + ' where flat shed ' + pinned.shed);
        }
        if (check(free).length > check(pinned).length) {
          bad.push(cross + ' deep: stepping is dirtier than flat');
        }
        // ...and no step that is only a token of one.
        var w = wobbles(free, 12);
        if (w) bad.push(cross + ' deep: ' + w + ' bend(s) too small to read as one');
      });
      return bad.join('; ');
    },
  };
});

// A BOARD TOO TIGHT SHORTENS ITS NAMES RATHER THAN LOSING ONE.
//
// A caption is not one size. It is the time over the title, the title alone,
// the title alone a size down -- and which of those a board wears is a
// decision, not a property of the event. The old engine drew the WHOLE BOARD
// once per text size, scored each and kept the best: four boards' work to
// answer a question the search holds as one more variable, and no way to
// take the time off the two captions that need it instead of all of them.
//
// A full caption is the time OVER the title, so it is twice as deep as the
// title alone: at full depth this band holds one row of names, at title
// depth two. That is what makes the ladder buy anything.
//
// THE BOARD-WIDE MOVE IS WHAT MAKES IT REACHABLE, and it is the one thing
// the old engine had right. Shortening one caption at a time never helps
// while the rest are still tall -- the crowding is caused by all of them
// together -- so a search with only the per-caption move sat at three names
// shed while the all-short board, eight times cheaper, was eight uphill
// moves away. Measured, both numbers.
band('a tight board shortens its names before it loses one', function () {
  var spec = { axis: { a0: 0, a1: 430 }, cross: { c0: 0, c1: 130 },
               lines: [{ key: 'a' }, { key: 'b' }], wants: [] };
  ['Morning Standup', 'Client Workshop', 'Grocery Delivery', 'Physio Session',
   'Parents Evening', 'Dinner with Alex', 'School Pickup', 'Bath and Bed']
   .forEach(function (t, i) {
    spec.wants.push(new C.Want({
      id: 'w' + i, text: t, line: 'a', a0: 15 + i * 50, a1: 40 + i * 50,
      // Measured, all of them. Nothing is scaled from anything: a caption
      // whose size was guessed is the zero-width bug wearing a hat.
      forms: [{ w: t.length * 8, h: 26, text: t },
              { w: t.length * 8, h: 13, text: t }],
    }));
  });
  return { spec: spec, expectShed: 0, shortens: true };
});

// A CONVERGENCE IS ONE EVENT WITH ONE NAME.
//
// Four people at one dinner is one dinner. Drawn as four stops with four
// copies of the name it reads as four things happening at once, so a
// transit map draws an interchange: one heavy bar across the lines that
// meet there, named once.
//
// That name is the awkward one in every engine that has tried this, because
// it has no rail of its own to hang off -- which is the whole point of a
// convergence. The old engine gave it a pass of its own, placed before or
// after everything else depending on which bug was being chased that week,
// and either it took the paper a solo event needed or it landed on a name it
// could not ask to move.
//
// Here it is not special. It hangs off the BAR, which is a real object with
// a real extent, so it is the same question as every other caption and it
// goes into the same search with the same cost. What makes it a
// convergence's name is nothing but what it measures from.
band('a convergence is named once, off its own bar', function () {
  var spec = { axis: { a0: 0, a1: 700 }, cross: { c0: 0, c1: 210 },
               lines: [{ key: 'mum' }, { key: 'dad' }, { key: 'kid' }],
               pills: [{ id: 'dinner', a: 430, lines: ['mum', 'dad', 'kid'] }],
               wants: [] };
  spec.wants.push(new C.Want({ id: 'd', text: 'Family Dinner', pill: 'dinner',
                               a0: 430, a1: 430, w: 110, h: 14 }));
  // ...and solo events either side of it, which is where it used to go wrong:
  // the bar's name and these compete for the same paper and neither may be
  // placed first.
  spec.wants.push(new C.Want({ id: '1', text: 'School Run', line: 'mum', a0: 90, a1: 150, w: 90, h: 14 }));
  spec.wants.push(new C.Want({ id: '2', text: 'Sprint Review', line: 'dad', a0: 250, a1: 330, w: 115, h: 14 }));
  spec.wants.push(new C.Want({ id: '3', text: 'Swim Training', line: 'kid', a0: 330, a1: 400, w: 115, h: 14 }));
  spec.wants.push(new C.Want({ id: '4', text: 'Book Club', line: 'mum', a0: 500, a1: 570, w: 85, h: 14 }));
  return { spec: spec, expectShed: 0, maxOff: 2.2 };
});

// ...AND THE TRACKS ACTUALLY COME TOGETHER FOR IT.
//
// A capsule drawn across three rails that are still three rows apart says
// "these three things happened at the same minute". A transit map says
// something stronger and truer: they were in the same PLACE, and it says it
// by bringing the lines together, running them side by side through the
// station, and fanning them out again.
//
// Three things have to hold and each has been wrong at some point:
//
//   THEY MEET. At the event's own minute the members are within a rail gap
//   of each other, so the capsule around them is a station and not a bar
//   stretched across the board.
//   THEY PART. A convergence is somewhere everybody went and then left, so
//   each rail is back where it was afterwards -- a reader who has learned
//   which row is theirs has to still be right at the end of the day.
//   THE ORDER SURVIVES. They meet in the order they live in, so the second
//   line from the top is second in the bundle too.
test('a shared event brings its lines together and lets them go', function () {
  var spec = { axis: { a0: 0, a1: 800 }, cross: { c0: 0, c1: 300 },
               lines: [{ key: 'a' }, { key: 'b' }, { key: 'c' }],
               pills: [{ id: 'dinner', a: 420, a0: 380, a1: 460,
                         lines: ['a', 'b', 'c'] }],
               wants: [new C.Want({ id: 'd', text: 'Family Dinner', pill: 'dinner',
                                    a0: 420, a1: 420, w: 110, h: 14 })] };
  var b = Bands.solve(spec, {});
  var at = {}, ends = {};
  ['a', 'b', 'c'].forEach(function (k) {
    var ln = b.lineByKey(k);
    at[k] = ln.cAt(420);
    ends[k] = ln.cAt(spec.axis.a1);
  });
  var cs = ['a', 'b', 'c'].map(function (k) { return at[k]; });
  var span = Math.max.apply(null, cs) - Math.min.apply(null, cs);
  assert(span <= spec.railGap * 2 + 1,
    'the lines did not meet: ' + span.toFixed(1) + 'px apart at the event');
  assert(at.a < at.b && at.b < at.c,
    'the bundle reordered the lines: ' + JSON.stringify(at));
  var home = {};
  ['a', 'b', 'c'].forEach(function (k) { home[k] = b.lineByKey(k).cAt(spec.axis.a0); });
  ['a', 'b', 'c'].forEach(function (k) {
    assert(Math.abs(ends[k] - home[k]) < 1,
      k + ' never came back: started at ' + home[k] + ', ended at ' + ends[k]);
  });
});

// A STOP INSIDE A SHARED EVENT LEAVES THE GROUP FOR IT.
//
// "assembly should branch out of the group via a little gap in the box." A
// dot and a tick on a rail inside the enclosure read as part of the
// enclosure, so the rail splits instead: the trunk stays in the bundle and a
// spur runs the event clear of the box, on the side that line's own row is.
test('a stop inside a shared event branches out of the group', function () {
  var spec = { axis: { a0: 0, a1: 800 }, cross: { c0: 0, c1: 300 },
               lines: [{ key: 'a' }, { key: 'b' }],
               pills: [{ id: 'school', a: 400, a0: 200, a1: 600, lines: ['a', 'b'] }],
               wants: [new C.Want({ id: 's', text: 'School Day', pill: 'school',
                                    a0: 400, a1: 400, w: 90, h: 14 }),
                       new C.Want({ id: 'x', text: 'Assembly', line: 'b',
                                    a0: 300, a1: 340, w: 80, h: 14 })] };
  var b = Bands.solve(spec, {});
  var asm = spec.wants[1];
  assert(asm._rail && asm._rail !== 'b', 'Assembly stayed on the trunk');
  var spur = b.lineByKey(asm._rail);
  assert(spur && spur.branchOf === 'b', 'the spur is not a branch of its line');
  var pill = b.pills[0], box = pill.box();
  var at = spur.cAt(320);
  assert(at != null && (at <= box.c0 - 1 || at >= box.c1 + 1),
    'the spur runs inside the enclosure: ' + at + ' within ' + JSON.stringify(box));
  var trunkA = b.lineByKey('a').cAt(320), trunkB = b.lineByKey('b').cAt(320);
  assert(Math.abs(trunkA - trunkB) <= spec.railGap + 1,
    'the trunk left the bundle for the spur: ' + trunkA + ' vs ' + trunkB);
  var first = spur.pts[0][0];
  assert(first >= 200 - 0.5, 'the spur left before the group formed, at ' + first);
});

// EVERY RAIL TAKES A GROUP'S CORNER THE SAME WAY.
//
// "We really need the exact same angled turns but just staggered." Four
// rails into one dinner: each enters upright through the box's left wall and
// leaves upright through its right, the rails on one side turn exactly one
// gap apart, and no corner carries a radius of its own. A rail near the
// bundle used to take a 45 degree lead beside a neighbour turning upright,
// and the two corners side by side were two different shapes.
test('every rail takes a group\'s corner the same way, one gap apart', function () {
  var spec = { axis: { a0: 0, a1: 800 }, cross: { c0: 0, c1: 320 },
               lines: [{ key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'd' }],
               pills: [{ id: 'dinner', a: 400, a0: 300, a1: 500, lines: ['a', 'b', 'c', 'd'] }],
               wants: [new C.Want({ id: 'x', text: 'Family Dinner', pill: 'dinner',
                                    a0: 400, a1: 400, w: 110, h: 14 })] };
  var b = Bands.solve(spec, {});
  var entries = [], exits = [];
  ['a', 'b', 'c', 'd'].forEach(function (k) {
    var ln = b.lineByKey(k), lvl = ln.cAt(400), p = ln.pts;
    var inAt = null, outAt = null;
    for (var i = 1; i < p.length; i++) {
      if (inAt == null && Math.abs(p[i][1] - lvl) < 0.01 && Math.abs(p[i - 1][1] - lvl) > 0.01) {
        assert(Math.abs(p[i][0] - p[i - 1][0]) < 0.01,
          k + ' enters the group on a slope from ' + JSON.stringify(p[i - 1]) + ' to ' + JSON.stringify(p[i]));
        inAt = p[i][0];
      }
      if (inAt != null && outAt == null && p[i][0] > 400
          && Math.abs(p[i - 1][1] - lvl) < 0.01 && Math.abs(p[i][1] - lvl) > 0.01) {
        assert(Math.abs(p[i][0] - p[i - 1][0]) < 0.01,
          k + ' leaves the group on a slope from ' + JSON.stringify(p[i - 1]) + ' to ' + JSON.stringify(p[i]));
        outAt = p[i - 1][0];
      }
    }
    assert(inAt != null && outAt != null, k + ' never joined and left: ' + JSON.stringify(p));
    entries.push({ k: k, a: inAt, lvl: lvl, home: ln.cAt(spec.axis.a0) });
    exits.push({ k: k, a: outAt, lvl: lvl });
  });
  // Nested one gap apart on each side of the bundle: the entries of the two
  // rails from above differ by exactly a gap, and so do the two from below.
  var above = entries.filter(function (e) { return e.home < e.lvl; }).sort(function (x, y) { return x.a - y.a; });
  var below = entries.filter(function (e) { return e.home > e.lvl; }).sort(function (x, y) { return x.a - y.a; });
  [above, below].forEach(function (side) {
    for (var i = 1; i < side.length; i++) {
      assert(Math.abs((side[i].a - side[i - 1].a) - spec.tieGap) < 0.01,
        side[i - 1].k + ' and ' + side[i].k + ' turn ' + (side[i].a - side[i - 1].a).toFixed(1)
        + ' apart, not one gap (' + spec.tieGap + ')');
    }
  });
  assert(above.length && below.length, 'the bundle did not sit between the rows: ' + JSON.stringify(entries));
  // ...AND A GAP APART ALL THE WAY ROUND THE BEND, on the curves as drawn.
  // The renderer rounds every vertex with a quadratic pulled back by the
  // vertex's own radius, or the default; sampled the same way
  // here, two neighbours must stay within a tenth of a gap of one gap apart
  // through both corners, or the arcs are not concentric.
  var CORNER = 13;
  function samples(pts) {
    var out = [];
    for (var i = 1; i < pts.length - 1; i++) {
      var a = pts[i - 1], b2 = pts[i], c = pts[i + 1];
      var l1 = Math.hypot(b2[0] - a[0], b2[1] - a[1]), l2 = Math.hypot(c[0] - b2[0], c[1] - b2[1]);
      var kk = Math.min(b2[2] != null ? b2[2] : CORNER, l1 / 2, l2 / 2);
      if (!(kk > 0.5) || !l1 || !l2) { out.push([b2[0], b2[1], i, false]); continue; }
      var p0 = [b2[0] + (a[0] - b2[0]) * kk / l1, b2[1] + (a[1] - b2[1]) * kk / l1];
      var p2 = [b2[0] + (c[0] - b2[0]) * kk / l2, b2[1] + (c[1] - b2[1]) * kk / l2];
      for (var t = 0; t <= 1.0001; t += 0.05) {
        out.push([(1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * b2[0] + t * t * p2[0],
                  (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * b2[1] + t * t * p2[1], i,
                  b2[2] != null]);
      }
    }
    return out;
  }
  function nearest(pt, pts) {
    var best = Infinity;
    for (var i = 1; i < pts.length; i++) {
      var ax = pts[i - 1][0], ay = pts[i - 1][1], bx = pts[i][0], by = pts[i][1];
      var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      var t = l2 ? Math.max(0, Math.min(1, ((pt[0] - ax) * dx + (pt[1] - ay) * dy) / l2)) : 0;
      best = Math.min(best, Math.hypot(pt[0] - (ax + t * dx), pt[1] - (ay + t * dy)));
    }
    return best;
  }
  [above, below].forEach(function (side) {
    for (var i = 1; i < side.length; i++) {
      var A = b.lineByKey(side[i - 1].k), Bl = b.lineByKey(side[i].k);
      var sa = samples(A.pts), sb = samples(Bl.pts).map(function (q) { return [q[0], q[1]]; });
      // The samples through the nested corners: the ones the solver gave a
      // radius of their own. A rail's corner at its own home row has no
      // neighbour a gap away and is not part of the question.
      var offs = [];
      sa.forEach(function (q) {
        if (!q[3]) return;
        offs.push(nearest(q, sb));
      });
      var lo = Math.min.apply(null, offs), hi = Math.max.apply(null, offs);
      assert(lo > spec.tieGap * 0.9 && hi < spec.tieGap * 1.1,
        side[i - 1].k + ' and ' + side[i].k + ' run between ' + lo.toFixed(1) + ' and ' + hi.toFixed(1)
        + ' apart through the corners; one gap is ' + spec.tieGap);
    }
  });
});

// THE CLOCK RUNS SLOWER WHERE NOTHING HAPPENS, AND NEVER BACKWARDS.
//
// The one rule the scale cannot break is monotonicity: a board that draws
// half past four before four o'clock is not a board with a layout problem,
// it is a lie. Everything else about a variable rate is a preference, so
// this asks for the invariant exactly and the preference loosely -- a
// stretch with events in it gets more pixels per minute than an empty one,
// and the window still fills the axis to the pixel.
test('a quiet hour is worth less paper than a busy one, and time still runs forwards', function () {
  var Day = require('./day');
  var metro = { day_start_min: 360, day_end_min: 1380, now_min: 600,
                events: [{ start_min: 540, end_min: 660, owner: 'a', title: 'Morning' },
                         { start_min: 690, end_min: 750, owner: 'a', title: 'Lunch' },
                         { start_min: 1020, end_min: 1140, owner: 'a', title: 'Dinner' }] };
  var segs = Day.segmentsFor(metro);
  assert(segs && segs.length > 1, 'a day with four empty hours in it found no quiet stretch');
  var sc = Day.scaleFor({ from: 360, to: 1380, a0: 0, a1: 1000, segments: segs });
  var last = -Infinity;
  for (var m = 360; m <= 1380; m += 5) {
    var a = sc.at(m);
    assert(a >= last - 1e-9, 'the scale went backwards at ' + m);
    last = a;
  }
  assert(Math.abs(sc.at(360) - 0) < 1e-6 && Math.abs(sc.at(1380) - 1000) < 1e-6,
    'the window does not fill the axis: ' + sc.at(360) + '..' + sc.at(1380));
  // A busy hour against an empty one, measured rather than assumed.
  var busy = sc.at(660) - sc.at(600), quiet = sc.at(1320) - sc.at(1260);
  assert(busy > quiet * 1.5,
    'the busy hour got ' + busy.toFixed(1) + 'px and the empty one ' + quiet.toFixed(1));
  // ...and `back` is the inverse of `at`, because the drawing asks both.
  for (var t = 400; t < 1380; t += 37) {
    assert(Math.abs(sc.back(sc.at(t)) - t) < 0.01, 'back(at(' + t + ')) is not ' + t);
  }
});

// EVERYTHING WORKS BOTH WAYS UP, AND BOTH WAYS ROUND.
//
// Asked for directly: "everything we added should be working in both
// directions, write tests on that."
//
// Every mechanism here has a sign in it. A step goes up or down, a branch
// leaves above or below, a caption sits either side of its rail, a band is
// measured from one edge or the other. A sign convention that is right one
// way and wrong the other is the single most common fault in the engine this
// replaces -- four separate ones were found in it in a day -- and the
// symptom is always the same: the board is fine on the boards somebody
// happened to look at, and quietly broken on their mirror image.
//
// So rather than write a second copy of every case upside down, each board
// is solved again REFLECTED and the two answers are required to be equally
// good. A reflected board is the same problem: the same events, the same
// paper, the same amount of room. Nothing about it is easier or harder. If
// one comes out worse than the other, something in the code has a preferred
// direction, and that is a bug whichever way it leans.
//
// Three reflections, because there are two axes and they can both go:
//   - UP FOR DOWN: the lines in the opposite order across the board.
//   - EARLY FOR LATE: the day running backwards.
//   - BOTH.
function mirrorSpec(spec, flipLines, flipTime) {
  var A = spec.axis.a0 + spec.axis.a1;
  function moveA(v) { return A - v; }
  var lines = spec.lines.map(function (l) { return { key: l.key, width: l.width }; });
  if (flipLines) lines.reverse();
  var wants = spec.wants.map(function (w) {
    var c = w.clone();
    if (flipTime) { var a0 = moveA(w.a1), a1 = moveA(w.a0); c.a0 = a0; c.a1 = a1; }
    return c;
  });
  var pills = (spec.pills || []).map(function (p) {
    // The SPAN as well as the minute: the tracks converge for the length of
    // the event, so a reflection that kept only the midpoint was solving a
    // different board and the symmetry it checked was not the real one.
    var a0 = p.a0 == null ? p.a : p.a0, a1 = p.a1 == null ? p.a : p.a1;
    return { id: p.id, lines: p.lines.slice(),
             a: flipTime ? moveA(p.a) : p.a,
             a0: flipTime ? moveA(a1) : a0, a1: flipTime ? moveA(a0) : a1 };
  });
  var out = {};
  Object.keys(spec).forEach(function (k) { out[k] = spec[k]; });
  out.lines = lines; out.wants = wants; out.pills = pills;
  // The per-solve scratch the solver leaves on a spec must not be inherited.
  ['minStep', 'railGap', 'tieGap', 'markR', 'nameClashPrice', 'nameCutPrice', 'minLift', 'leadCap',
   'muddlePrice', 'shelfDepth', 'branchPrice', 'bumpPrice', 'bumpNear',
   'straddlePrice', 'driftPrice', 'stepPrice', 'stepWorth',
   'formPrice'].forEach(function (k) { delete out[k]; });
  return out;
}

var straightCache = {};
function quality(b) {
  return { shed: b.shed, faults: check(b).length, muddle: b.muddle || 0,
           bumps: b.bumps || 0, straddles: b.straddles || 0 };
}

['up for down', 'early for late', 'both'].forEach(function (how, hi) {
  var flipLines = hi !== 1, flipTime = hi !== 0;
  band('the same board reflected, ' + how + ', is no worse', function () {
    var base = [];
    cases.forEach(function (cs) {
      if (cs.plain || !cs.bands || /reflected/.test(cs.name)) return;
      base.push(cs);
    });
    return {
      spec: { axis: { a0: 0, a1: 10 }, cross: { c0: 0, c1: 10 },
              lines: [{ key: 'x' }], wants: [] },
      verify: function () {
        var bad = [];
        base.forEach(function (cs) {
          // Solved once and remembered: the unreflected answer is the same
          // for all three reflections, and solving it three times was a
          // third of the suite's running time.
          if (!straightCache[cs.name]) straightCache[cs.name] = quality(Bands.solve(cs.build().spec, {}));
          var straight = straightCache[cs.name];
          var flipped = Bands.solve(mirrorSpec(cs.build().spec, flipLines, flipTime), {});
          var a = straight, b2 = quality(flipped);
          // UP FOR DOWN IS A TRUE SYMMETRY. EARLY FOR LATE IS NOT.
          //
          // Nothing on this board prefers up to down, so a board turned over
          // is the same board and every measure of it must match. Time is
          // different: a name is anchored to the START of the event it
          // belongs to, deliberately, because that is the minute the reader
          // is being told. Run the day backwards and that anchor points the
          // other way, so how well names pair with marks can legitimately
          // differ.
          //
          // What may not differ either way is whether the board WORKS: names
          // not drawn, and anything a reader cannot read.
          var ks = flipTime ? ['shed', 'faults'] : Object.keys(a);
          ks.forEach(function (k) {
            // HARD FACTS EXACTLY, JUDGEMENTS WITH A LITTLE SLACK.
            //
            // A name not drawn and a name a reader cannot read are
            // structural: if one direction has more of them than the other,
            // something has a preferred direction and that is a bug.
            //
            // The rest are the search's opinion, and the search is
            // stochastic. Measured on the tight board, the SAME input gives
            // between one and eight mispaired names depending only on the
            // seed -- straight and reflected alike -- so requiring the two
            // to match exactly is requiring two coin tosses to agree. The
            // noise is real and worth knowing about; what it must not do is
            // make this case report a symmetry fault that is not there.
            var slack = (k === 'shed' || k === 'faults') ? 0 : 2;
            if (b2[k] > a[k] + slack) {
              bad.push('"' + cs.name + '" ' + k + ' ' + a[k] + ' -> ' + b2[k]);
            }
          });
        });
        return bad.join('; ');
      },
    };
  });
});

// A PANEL TOO SMALL FOR THE DAY LEAVES PEOPLE OUT, NOT WORDS.
//
// A quadrant is four hundred by two hundred and forty. A family of five with
// sixteen events does not go in it, and no cleverness in the caption solver
// changes that: the words are a size the eye can read or they are not.
//
// What matters is WHAT gets left out. Shedding captions, a crowded quadrant
// drops six names from five different people, and what is left is five lines
// each missing something -- a reader cannot tell whether a gap is a quiet
// afternoon or a hidden one. Dropping a whole PERSON is honest: four lines,
// every one complete, and a count saying who is not shown.
//
// The test is not "fewer faults" and never could be: taking a line off
// always reduces the faults, because there is less on the board. What has to
// go UP is how much of the day a reader can actually read.
test('a small panel leaves a person out rather than half of everyone', function () {
  var Day = require('./day'), Fit = require('./fit');
  var fixtures;
  try { fixtures = require('../test/layout/fixtures'); } catch (e) { return; }
  var f = null;
  fixtures.forEach(function (x) { if (x.name === 'busy-day') f = x; });
  if (!f) return;
  function mk() {
    return Day.specFor(f.metro, { w: 330, h: 240 },
      { pad: 14, bandLo: 66, cell: 7, rowH: 12 });
  }
  var all = mk(), flat = Bands.solve(all, {});
  var some = mk(), fitted = Fit.fit(some, {});
  var a = Fit.worth(all, flat), b = Fit.worth(fitted.spec || some, fitted);
  // Fewer people may mean a name or two fewer readable, if it also means
  // far fewer unreadable: what is shown has to be trustworthy first.
  assert(b.shown >= a.shown || b.lost < a.lost,
    'fitting made the board worse: ' + a.shown + ' readable with everyone, '
    + b.shown + ' with ' + fitted.dropped.length + ' line(s) left out');
  // ...or keeps everyone at the price of a few names: a person off the
  // board is the worst loss there is, so a name or two is the better trade
  // ("at the end of the day it's a caption"); only losing half of everyone's
  // names is worse than losing one of everyone.
  assert(fitted.dropped.length > 0 || a.lost * 2 < a.shown + a.lost,
    'a panel this small kept every line and lost ' + a.lost + ' name(s) doing it');
});

// A SMALL VIEW SHOWS FEWER HOURS, AND NO MORE EVENTS THAN IT HOLDS.
//
// "No point in showing five days because there's only one event" -- and no
// point in showing a quadrant a whole day it cannot draw. The window a
// panel draws is cut to what the panel can show; what is past the cut is
// counted as later, not lost.
// THE PLUGIN'S BANNER IS NOT THE MAP'S TO BOOK. It is a sibling of the
// canvas, so the canvas is already shorter by it, and the page says so with
// `alert: null`. Read as "not told", that null fell through to the payload's
// own `service_alert` and the map lost the banner's height a second time, as
// an empty band under the strip.
test('a caller that says alert: null gets no alert band, whatever the payload carries', function () {
  var Day = require('./day');
  var fixtures;
  try { fixtures = require('../test/layout/fixtures'); } catch (e) { return; }
  var f = null;
  fixtures.forEach(function (x) { if (x.name === 'busy-day') f = x; });
  if (!f) return;
  var withAlert = Object.assign({}, f.metro, { service_alert: { kind: 'rain', text: 'Rain until 17:00, 80% chance' } });
  var opts = { pad: 14, cell: 7, rowH: 12 };
  var plain = Day.specFor(f.metro, { w: 780, h: 459 }, opts);
  var told = Day.specFor(withAlert, { w: 780, h: 459 }, Object.assign({ alert: null }, opts));
  assert(told.cross.c0 === plain.cross.c0, 'the map booked a band for a banner drawn outside it: starts at '
    + told.cross.c0 + ' instead of ' + plain.cross.c0);
  // ...and a caller that says nothing still gets the payload's, which is what
  // the standalone renderer draws across the top.
  var untold = Day.specFor(withAlert, { w: 780, h: 459 }, opts);
  assert(untold.cross.c0 > plain.cross.c0, 'the standalone board lost its alert band');
});

test('a small view shows fewer hours than a large one, and no more events than it holds', function () {
  var Day = require('./day');
  var fixtures;
  try { fixtures = require('../test/layout/fixtures'); } catch (e) { return; }
  var f = null;
  fixtures.forEach(function (x) { if (x.name === 'busy-day') f = x; });
  if (!f) return;
  var opts = { pad: 14, bandLo: 66, cell: 7, rowH: 12 };
  var big = Day.specFor(f.metro, { w: 780, h: 459 }, opts);
  var small = Day.specFor(f.metro, { w: 330, h: 240 }, opts);
  var cap = Day.frameFor({ w: 330, h: 240 }, opts);
  var bigSpan = big.metro.day_end_min - big.metro.day_start_min;
  var smallSpan = small.metro.day_end_min - small.metro.day_start_min;
  // (no more than the large one: a day the window has already cut short
  // can fit a small view whole)
  assert(smallSpan <= bigSpan, 'the small view shows more of the day than the large one: ' + smallSpan + ' vs ' + bigSpan);
  assert(smallSpan <= cap.hours * 60 + 30, 'the small view shows ' + smallSpan + ' minutes, over its ' + cap.hours + ' hours');
  var shown = small.metro.events.filter(function (ev) {
    return ev.start_min >= small.metro.day_start_min && ev.start_min < small.metro.day_end_min;
  }).length;
  assert(shown <= cap.events, 'the small view holds ' + shown + ' events, over its ' + cap.events);
  // The clock is never cut off.
  assert(small.metro.now_min == null || small.metro.now_min <= small.metro.day_end_min,
    'the window was cut before now');
  // ...and what is past the cut is counted at the edge, WHEN THERE IS
  // ANYTHING PAST IT. There used not to be a question: the window started at
  // the day's own start, so a small view always cut something off the end.
  // It opens near now instead (day.js `opened`), so on a board whose events
  // all fall inside that opening there is nothing later to count, and a note
  // saying "+0 more" would be ink about nothing.
  var past = small.metro.events.filter(function (ev) {
    return !(ev.type && ev.type !== 'event') && ev.start_min >= small.metro.day_end_min
      && ev.start_min < Math.floor(small.metro.day_end_min / 1440) * 1440 + 1440;
  }).length;
  var later = null;
  small.fixed.forEach(function (fx) { if (fx.id === 'later') later = fx; });
  if (past) assert(later, 'nothing says how many events fell past the small view\'s end');
  else assert(!later, 'the board counted ' + past + ' events past its end and drew a note anyway');
});

// HOW LONG A BOARD TAKES IS A PROPERTY LIKE ANY OTHER.
//
// This runs on a device, in a browser, on a panel waking up to redraw. A
// layout engine that is correct and slow is not shippable, and a time nobody
// asserts is a time that drifts: the deterministic rewrite made the solver
// three times SLOWER before anyone measured it, and a single board went to
// sixty seconds without a test noticing.
//
// Measured on the days the fixtures describe rather than on the generated
// horrors in bench.js -- those exist to find the shape of the cost, this
// exists to stop the ordinary case rotting. The budget is loose on purpose:
// it is here to catch a tenfold regression, not to pin a number.
// A BOARD THAT OPENS PAST EVERYTHING IT HAS IS A BLANK BOARD.
test('the opening never sheds the whole day', function () {
  var Day = require('./day');
  // Half past two, and the last of the day was at nine. The step's own
  // opening is eleven, which has nothing at or after it: unguarded, every
  // event is clipped away and the panel shows an empty grid with a clock on
  // it. The opening backs off to hold the last thing there was.
  var metro = {
    now_min: 14 * 60 + 30, day_start_min: 0, day_end_min: 1440,
    events: [
      { type: 'event', title: 'A', owner: 'p0', start_min: 8 * 60, end_min: 8 * 60 + 30 },
      { type: 'event', title: 'B', owner: 'p0', start_min: 9 * 60, end_min: 9 * 60 + 30 },
    ],
  };
  var from = Day.opened(metro).day_start_min;
  assert(from <= 8 * 60, 'the board opened at ' + from + ', past everything it has');
  assert(metro.events.every(function (e) { return e.start_min >= from; }),
    'an event was left outside a window that had nothing else in it');
  // ...and it still steps where there IS something in front of it.
  var later = Object.assign({}, metro, { events: metro.events.concat([
    { type: 'event', title: 'C', owner: 'p0', start_min: 16 * 60, end_min: 17 * 60 }]) });
  var stepped = Day.opened(later).day_start_min;
  // (half past two: the two o'clock step, an hour back, is one; C at four
  // is more than LEAD_MIN past that, so it holds nothing open)
  assert(stepped === 13 * 60,
    'a day with something still to come should open at one, opened at ' + stepped);
});

// ...AND NEVER ON TOP OF SOMETHING'S FIRST MINUTE.
test('the opening never lands on an event\'s start', function () {
  var Day = require('./day');
  // Ten past two: the step opens at eleven, the lead takes it to nine for
  // the book club, and the room in front of that lands on the school day's
  // half past eight. Opened there, the corridor starts at the first minute of
  // the paper and its merge diamond is drawn over both terminal slashes.
  var metro = {
    now_min: 14 * 60 + 10, day_start_min: 0, day_end_min: 1440,
    legend: [{ key: 'p0' }, { key: 'p1' }, { key: 'p2' }],
    events: [
      { type: 'event', title: 'School Day', owner: 'p0', co_owners: ['p1'],
        start_min: 8 * 60 + 30, end_min: 15 * 60 },
      { type: 'event', title: 'Book Club', owner: 'p2', start_min: 9 * 60, end_min: 10 * 60 },
      { type: 'event', title: 'Safety', owner: 'p2', start_min: 11 * 60 + 30, end_min: 12 * 60 },
      { type: 'event', title: 'Later', owner: 'p2', start_min: 17 * 60, end_min: 18 * 60 },
    ],
  };
  var spec = Day.specFor(metro, { w: 1020, h: 700 }, {});
  var lo = spec.metro.day_start_min;
  var on = metro.events.filter(function (e) { return e.start_min >= lo && e.start_min - lo < 15; });
  assert(!on.length, 'the board opened at ' + lo + ', on the start of ' + on.map(function (e) {
    return e.title; }).join(', '));
  var pill = spec.pills.filter(function (p) { return !p.tie; })[0];
  assert(pill && pill.open0, 'the school day should be running when the board opens');
  // Ten past two: the two o'clock step opens the board at one, the school
  // day is running across it, and the book club (over at ten) is behind it.
  assert(lo === 13 * 60, 'the board opened at ' + lo + ', not at the step');
});

// AN ALL-DAY STATE IS NAMED AT A HEAD, FOR THE DAYS THE BOARD DRAWS.
//
// Rules 54-57, asked of the spec rather than of a rendered page: which heads
// carry which words is decided here and only drawn later.
test('an all-day state is at its first owner\'s head, for the days drawn, saying which', function () {
  var Day = require('./day'), Fit = require('./fit');
  var days = [
    { index: 0, start_min: 0, end_min: 1440, date_label: 'Sat 12 Sep', weekday_short: 'Sat' },
    { index: 1, start_min: 1440, end_min: 2880, date_label: 'Sun 13 Sep', weekday_short: 'Sun' },
    { index: 2, start_min: 2880, end_min: 4320, date_label: 'Mon 14 Sep', weekday_short: 'Mon' },
  ];
  var metro = {
    day_start_min: 360, day_end_min: 1440 + 18 * 60, days: days,
    legend: [{ key: 'a', name: 'Alex' }, { key: 's', name: 'Sam' }, { key: 'k', name: 'Kids' }],
    events: [
      { type: 'event', title: 'Swim', owner: 'a', start_min: 600, end_min: 690 },
      { type: 'event', title: 'Brunch', owner: 's', start_min: 1440 + 60, end_min: 1440 + 120 },
    ],
    all_day: [
      { title: 'Half Term', owners: ['k', 's'], days: [1] },
      { title: 'Leave', owners: ['a'], days: [0, 1] },
      { title: 'Night Shift', owners: ['s'], days: [0] },
      { title: 'Camp', owners: ['k'], days: [2] },
    ],
  };
  var spec = Day.specFor(metro, { w: 1020, h: 700 }, {});
  var drawn = spec.metro.days.length;
  assert(drawn === 2, 'the fixture should draw two days, drew ' + drawn);
  function head(k, far) {
    var f = null;
    spec.fixed.forEach(function (x) { if (x.id === (far ? 'name:' : 'name0:') + k) f = x; });
    return f && f.route;
  }
  // A LINE IS NAMED ONCE, SO EVERY STATE IS SAID AT THAT ONE HEAD.
  //
  // Sunday's half term used to be named at the FAR end, because that is
  // where Sunday is, and a state put at the left was read as tonight's. The
  // far name is gone (a line is named once now, at the leading end, and the
  // column it used to cost went back to the day), so the position can no
  // longer say which day -- and it does not need to, because the words
  // already do: a state that does not cover every drawn day carries the day
  // it is on, "Half Term . Sun", which is the same sentence read from
  // anywhere on the board.
  assert(head('k') === 'Half Term \u00b7 Sun',
    'kids head says ' + JSON.stringify(head('k')));
  assert(!head('k', true), 'a line was named at both ends: ' + JSON.stringify(head('k', true)));
  assert(head('a') === 'Leave', 'a state on every drawn day owes no qualifier: ' + JSON.stringify(head('a')));
  // ...and a shared state at each of its owners' heads, in the order the
  // days run: the kids' half term is Sam's too.
  assert(head('s') === 'Night Shift \u00b7 Sat, Half Term \u00b7 Sun', 'a shared state is at every owner\'s head: '
    + JSON.stringify(head('s')));
  assert(!spec.fixed.some(function (x) { return x.kind === 'terminus' && x.at !== spec.axis.a0; }),
    'a terminus name was declared anywhere but the leading edge');
  assert(!spec.wants.some(function (w) { return /Half Term|Leave|Camp/.test(w.text); }),
    'an all-day state was put on the axis as a caption');
  // ...and on a board that draws one day, a state on another is not there.
  var one = Day.specFor(Object.assign({}, metro, { day_end_min: 1440 }), { w: 1020, h: 700 }, {});
  var said = one.states.map(function (st) { return st.text; });
  assert(said.join('|') === 'Leave|Night Shift', 'a one-day board states ' + JSON.stringify(said));
  // A shared state whose first owner is left off is still at the others'
  // heads -- it always was at every owner's now -- and with a line named
  // once, BOTH of Sam's states are said there, in the order the days run.
  var less = Fit.withoutLines(spec, ['k']);
  var sHead = null, sTail = null;
  less.fixed.forEach(function (x) { if (x.id === 'name0:s') sHead = x.route; if (x.id === 'name:s') sTail = x.route; });
  assert(sHead === 'Night Shift \u00b7 Sat, Half Term \u00b7 Sun' && sTail == null,
    'with the kids left off, Sam\'s heads say ' + JSON.stringify([sHead, sTail]));
});

// THE CLOCK IS ALWAYS ON THE BOARD. At 02:41 the board opened at the morning
// and drew no time at all: the opening never lands after now, and the quiet
// night before the first thing is drawn at the quiet rate.
test('a board read in the small hours still shows the time it is', function () {
  var Day = require('./day');
  var metro = {
    now_min: 2 * 60 + 41, day_start_min: 0, day_end_min: 2880,
    days: [{ index: 0, start_min: 0, end_min: 1440 }, { index: 1, start_min: 1440, end_min: 2880 }],
    legend: [{ key: 'a' }, { key: 'b' }],
    events: [
      { type: 'event', title: 'Standup', owner: 'a', start_min: 615, end_min: 630 },
      { type: 'event', title: 'Review', owner: 'a', start_min: 630, end_min: 660 },
      { type: 'event', title: 'Workshop', owner: 'a', start_min: 900, end_min: 960 },
      { type: 'event', title: 'Dance', owner: 'b', start_min: 1110, end_min: 1170 },
    ],
  };
  [{ w: 1020, h: 759 }, { w: 780, h: 459 }, { w: 760, h: 204 }, { w: 365, h: 204 }].forEach(function (view) {
    var spec = Day.specFor(metro, view, {});
    var m = spec.metro;
    assert(m.day_start_min <= metro.now_min && m.day_end_min > metro.now_min,
      view.w + 'x' + view.h + ': the window ' + m.day_start_min + '-' + m.day_end_min + ' leaves out 02:41');
    var now = spec.fixed.filter(function (f) { return f.kind === 'now'; })[0];
    assert(now && now.a0 >= spec.axis.a0 - 1 && now.a1 <= spec.axis.a1 + 1,
      view.w + 'x' + view.h + ': no clock on the axis');
    assert(m.day_end_min >= 615, view.w + 'x' + view.h + ': the day was lost reaching back to the clock, ends ' + m.day_end_min);
  });
  // ...and just after midnight, and before a morning with nothing in it
  [5, 60 * 5 + 50].forEach(function (t) {
    var m2 = Day.specFor(Object.assign({}, metro, { now_min: t }), { w: 1020, h: 759 }, {}).metro;
    assert(m2.day_start_min <= t, 'at ' + t + ' the window opened at ' + m2.day_start_min);
  });
});

// A LONG BLOCK IN ONE PLACE IS A BAND, NOT A SHELF OR A ROW OF WORDS: a desk
// booking draws no spur, puts nothing under the name, and is named once along
// its own hours where nothing leaves through the name.
test('a desk booking is a band on its rail, named along its hours', function () {
  var Day = require('./day'), Fit = require('./fit');
  var metro = {
    now_min: 9 * 60, day_start_min: 0, day_end_min: 1440,
    legend: [{ key: 'a', name: 'Alex' }, { key: 'b', name: 'Sam' }],
    events: [
      { type: 'event', title: 'Desk booking', owner: 'a', start_min: 480, end_min: 1140 },
      { type: 'event', title: 'Standup', owner: 'a', start_min: 615, end_min: 630 },
      { type: 'event', title: 'Review', owner: 'a', start_min: 900, end_min: 960 },
      { type: 'event', title: 'Swim', owner: 'b', start_min: 1080, end_min: 1140 },
    ],
  };
  var spec = Day.specFor(metro, { w: 1020, h: 700 }, {});
  assert(!spec.wants.some(function (w) { return w.text === 'Desk booking'; }), 'the booking became a caption');
  assert(spec.states.some(function (st) { return st.timed && st.from === 480 && st.to === 1140; }), 'no timed state for the booking');
  assert(!spec.fixed.some(function (f) { return f.kind === 'terminus' && f.route; }), 'the booking was written under a name');
  var board = Fit.fit(spec, {});
  var label = board.fixed.filter(function (f) { return f.kind === 'bandname'; })[0];
  assert(label, 'the band has no name on the board');
  assert(label.a0 >= spec.scale.at(480) - 1 && label.a1 <= spec.scale.at(1140) + 1, 'the name is not within the booked hours');
  var through = board.lines.filter(function (l) { return l.key !== 'a' && require('./board').lineTouches(l, label.box()); });
  assert(!through.length, 'a line runs through the band\'s name: ' + through.map(function (l) { return l.key; }).join(', '));
});

// A THIN DAY CROSSES ITS GAP ONLY IF THE FAR SIDE MAKES THE BOARD.
test('a quiet morning does not spend the night reaching a tomorrow it cannot draw', function () {
  var Day = require('./day');
  var metro = {
    now_min: 9 * 60 + 20, day_start_min: 0, day_end_min: 2880,
    days: [{ index: 0, start_min: 0, end_min: 1440 }, { index: 1, start_min: 1440, end_min: 2880 }],
    legend: [{ key: 'a' }],
    events: [
      { type: 'event', title: 'Swim', owner: 'a', start_min: 600, end_min: 690 },
      { type: 'event', title: 'Book Club', owner: 'a', start_min: 1140, end_min: 1230 },
      { type: 'event', title: 'Parkrun', owner: 'a', start_min: 1980, end_min: 2040 },
    ],
  };
  var m = Day.specFor(metro, { w: 1020, h: 759 }, {}).metro;
  // Crossing is fine where the far side then makes the board: the night is
  // drawn at the quiet rate and costs a quarter of its hours.
  assert(m.day_end_min <= 1440 || m.day_end_min >= 2040,
    'the board drew the night to ' + m.day_end_min + ' and still not tomorrow');
  if (m.day_end_min > 1440) assert(Day.segmentsFor(m), 'the board crossed the night at full rate');
  // ...and in the evening, when tomorrow is within reach, it goes.
  var eve = Day.specFor(Object.assign({}, metro, { now_min: 17 * 60 }), { w: 1020, h: 759 }, {}).metro;
  assert(eve.day_end_min > 1980, 'the evening board did not reach tomorrow: ended at ' + eve.day_end_min);
});

// A DAY THAT IS NEARLY ALL QUIET IS LINEAR, and a pause under an hour is not
// a quiet stretch: "why are there speed marks if it's just like normal?"
test('compression is for a day with a busy part worth the paper', function () {
  var Day = require('./day');
  var sliver = { day_start_min: 420, day_end_min: 1260, now_min: 600, events: [
    { start_min: 480, end_min: 480, owner: 'a', title: 'Bin Day' },
    { start_min: 540, end_min: 555, owner: 'a', title: 'Standup' },
    { start_min: 900, end_min: 960, owner: 'a', title: 'Swim' },
    { start_min: 1110, end_min: 1110, owner: 'a', title: 'Dinner' }] };
  assert(!Day.segmentsFor(sliver), 'a day of moments and two short things was compressed');
  var pauses = { day_start_min: 480, day_end_min: 1080, events: [
    { start_min: 540, end_min: 600, owner: 'a', title: 'A' },
    { start_min: 630, end_min: 690, owner: 'a', title: 'B' },
    { start_min: 720, end_min: 780, owner: 'a', title: 'C' }] };
  var segs = Day.segmentsFor(pauses) || [];
  var short = segs.filter(function (sg) { return sg.rate < 1 && sg.from > 480 && sg.to < 1080 && sg.to - sg.from < 60; });
  assert(!short.length, 'a half-hour pause between two events runs fast: ' + JSON.stringify(short));
});

// AN EVENING WITH NOTHING LEFT REACHES TOMORROW, however busy the afternoon was.
test('a busy afternoon that is over does not keep the evening board off tomorrow', function () {
  var Day = require('./day');
  var evs = [];
  [900, 960, 1020, 1050, 1080, 1140].forEach(function (t, i) {
    evs.push({ type: 'event', title: 'A' + i, owner: 'a', start_min: t, end_min: t + 60 });
  });
  evs.push({ type: 'event', title: 'Tomorrow', owner: 'a', start_min: 1440 + 480, end_min: 1440 + 510 });
  var metro = { now_min: 20 * 60 + 36, day_start_min: 0, day_end_min: 2880, legend: [{ key: 'a' }],
    days: [{ index: 0, start_min: 0, end_min: 1440 }, { index: 1, start_min: 1440, end_min: 2880 }],
    events: evs };
  var m = Day.specFor(metro, { w: 1020, h: 759 }, {}).metro;
  assert(m.day_end_min > 1440 + 480, 'the board stopped at ' + m.day_end_min + ' with nothing left today');
});

test('every real day solves within its second', function () {
  var Day = require('./day'), Fit = require('./fit');
  var fixtures;
  try { fixtures = require('../test/layout/fixtures'); } catch (e) { return; }
  // ONE SECOND A SOLVE, ON EVERY EXAMPLE THERE IS. "1 second budget per
  // solve." The page gives the fit that long and the descent keeps the best
  // it has when it runs out, so this checks two things: that the clock is
  // obeyed, with a little grace for the trial that was pricing when it ran
  // out, and that what the second buys is still a board -- nothing shed on
  // the boards that hold everyone unhurried.
  // What each board sheds given all the time in the world: the two
  // synthetic days that do not fit at this size, and nothing else.
  // `three-day-holiday` joined them when the window stopped being the
  // payload's. A three-day fixture used to be drawn across the whole width at
  // three days to the board; it is now opened near its own `now_min` and cut
  // to what the view holds, like every other board, so the same width carries
  // a day instead of three and one caption does not fit in it. That is the
  // product behaviour -- "no point in showing 5 days because there's only 1
  // event" -- showing up in a fixture that predates it.
  var known = { 'crew-day': 2, 'seven-lines': 3, 'three-day-holiday': 1 };
  var slow = [], worse = [];
  fixtures.forEach(function (f) {
    var spec = Day.specFor(f.metro, { w: 730, h: 480 },
      { pad: 14, bandLo: 66, cell: 7, rowH: 12 });
    var t0 = Date.now();
    var b = Fit.fit(spec, { timeMs: 1000 });
    var ms = Date.now() - t0;
    if (ms > 1250) slow.push(f.name + ' ' + ms + 'ms');
    if (b.shed > (known[f.name] || 0)) worse.push(f.name + ' shed ' + b.shed);
  });
  assert(!slow.length, 'over the second: ' + slow.join(', '));
  assert(!worse.length, 'the second was not enough for: ' + worse.join(', '));
});

// ...AND THE SAME BOARD TWICE IS THE SAME BOARD.
//
// Not a platitude: the solver used to anneal, and while it was deterministic
// per input it was SEED-sensitive -- the same day gave between one and eight
// mispaired names depending on which arbitrary number had been picked. There
// is no seed now, and this is what says so.
test('the same day solves to the same board every time', function () {
  var Day = require('./day'), Fit = require('./fit');
  var fixtures;
  try { fixtures = require('../test/layout/fixtures'); } catch (e) { return; }
  var bad = [];
  fixtures.slice(0, 6).forEach(function (f) {
    function once() {
      var spec = Day.specFor(f.metro, { w: 730, h: 480 },
        { pad: 14, bandLo: 66, cell: 7, rowH: 12 });
      var b = Fit.fit(spec, {});
      return JSON.stringify({ gaps: b.gaps.map(Math.round), drawn: b.drawn,
                              forms: b.forms, shed: b.shed,
                              caps: b.caps.map(function (c) {
                                return [c.text, Math.round(c.a), Math.round(c.c)];
                              }) });
    }
    if (once() !== once()) bad.push(f.name);
  });
  assert(!bad.length, 'board(s) that differ between two runs: ' + bad.join(', '));
});

// ---------------------------------------------------------------- the runner

function run(only) {
  var pass = 0, fail = 0;
  cases.forEach(function (cs) {
    if (only && cs.name.indexOf(only) < 0) return;
    var t0 = Date.now();
    if (cs.plain) {
      var why0 = null;
      try { cs.plain(); } catch (e) { why0 = e.message; }
      var no0 = (cases.indexOf(cs) + 1) + '.';
      if (why0) { fail++; console.log('  FAIL ' + no0.padEnd(3) + ' ' + cs.name + ': ' + why0); }
      else { pass++; console.log('  ok   ' + no0.padEnd(3) + ' ' + cs.name
        + '  (' + (Date.now() - t0) + 'ms)'); }
      return;
    }
    var made = cs.build(), sol;
    if (cs.bands) {
      made.b = Bands.solve(made.spec, {});
      made.wants = made.spec.wants;
      sol = { shed: made.b.shed };
    } else {
      sol = C.solve(made.wants, made.b);
      C.apply(made.b, made.wants, sol);
    }
    var faults = check(made.b);
    var ms = Date.now() - t0;
    var why = null;
    if (faults.length) why = faults.length + ' fault(s)';
    else if (made.verify) why = made.verify(made.b) || null;
    else if (made.expectShed != null && sol.shed !== made.expectShed) {
      why = 'shed ' + sol.shed + ', expected ' + made.expectShed;
    } else if (made.maxShed != null && sol.shed > made.maxShed) {
      why = 'shed ' + sol.shed + ', more than ' + made.maxShed;
    } else if (made.minShed != null && sol.shed < made.minShed) {
      why = 'shed ' + sol.shed + ', and this board does not hold them all';
    } else if (made.shortens && made.b.forms
               && !made.b.forms.some(function (f) { return f > 0; })) {
      why = 'nothing was shortened, so the ladder was never used';
    } else if (made.apart && made.b.muddle) {
      // READ OFF THE DRAWING. Asked of the search's intent this passed while
      // the picture showed one excursion with two names against it: the
      // state said two shelves and the second one's departure had fallen
      // inside the first one's return.
      why = made.b.muddle + ' pair(s) of events the reader cannot tell apart';
    } else if (made.shelves === 'some' && !made.spec.wants.some(function (w) {
      return w._rail && w._rail !== w.line;
    })) {
      why = 'no rail split for an event on a board with room';
    } else if (made.steps) {
      // READ OFF THE DRAWING, not off what the search asked for. A state can
      // mark an event as stepping and the rail refuse it for want of room,
      // and the panel shows the rail.
      var took = bends(made.b);
      if (made.steps === 'some' && !took) why = 'every rail stayed flat on a board with room';
      if (made.steps === 'none' && took) why = took + ' bend(s) in a band too shallow for one';
    }
    if (!why && made.maxOff != null) {
      var pr = pairing(made.b);
      if (pr.rows > made.maxOff) {
        why = '"' + pr.what + '" sits ' + pr.rows.toFixed(1)
          + ' rows from its own line, more than ' + made.maxOff;
      }
    }
    var no = (cases.indexOf(cs) + 1) + '.';
    if (!why) {
      pass++;
      console.log('  ok   ' + no.padEnd(3) + ' ' + cs.name + '  ('
        + (made.wants.length - sol.shed) + '/' + made.wants.length
        + ' placed, ' + ms + 'ms)');
    } else {
      fail++;
      console.log('  FAIL ' + no.padEnd(3) + ' ' + cs.name + ': ' + why);
      console.log(report(made.b, { cols: 118 }).split('\n').map(function (l) {
        return '       ' + l;
      }).join('\n'));
    }
  });
  console.log('\n' + pass + ' ok, ' + fail + ' failing');
  return fail;
}

// Every case solved and printed, for `solver/shot.js --cases`. One place
// knows how a case is built and run, so the picture cannot drift from the
// suite.
function solveCase(cs) {
  var made = cs.build(), sol;
  if (cs.bands) {
    made.b = Bands.solve(made.spec, {});
    made.wants = made.spec.wants;
    sol = { shed: made.b.shed };
  } else {
    sol = C.solve(made.wants, made.b);
    C.apply(made.b, made.wants, sol);
  }
  return { made: made, sol: sol };
}

// NUMBERED, so a picture and a suite run can be talked about in the same
// words. "Case 4 is wrong" is a sentence; "the narrow column one, third from
// the bottom" is not.
function renderAll(cols) {
  return cases.filter(function (c) { return !c.plain; }).map(function (cs, i) {
    var r = solveCase(cs);
    // CAPPED, for a sheet of ten boards. The row count is otherwise taken
    // from the finest thing the board has to keep apart, which on a board
    // with an interchange bar across it runs to hundreds of rows and eight
    // thousand pixels of picture. Coarser, the drawing can miss a graze it
    // would otherwise show -- never invent one, since claims round inward --
    // and the fault list printed underneath is the authority either way.
    return '=== ' + (i + 1) + '. ' + cs.name + ' ===\n'
      + report(r.made.b, { cols: cols || 108, maxRows: 30 });
  }).join('\n\n');
}

if (require.main === module) process.exit(run(process.argv[2]) ? 1 : 0);
module.exports = { run: run, cases: cases, solveCase: solveCase, renderAll: renderAll };
