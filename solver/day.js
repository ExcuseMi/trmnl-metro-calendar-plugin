'use strict';

// A DAY OF REAL EVENTS, TURNED INTO A PROBLEM THE SOLVER CAN ANSWER.
//
// Everything below this line is geometry with no opinions about calendars;
// everything above it is calendars with no opinions about geometry. This file
// is the seam, and it is deliberately thin: it decides the scale, the order
// of the lines, which events are one event, and how big the words are. Then
// it hands over.
//
// MEASUREMENT IS AN INPUT, NOT A GUESS. The size of a caption is the one
// thing this layer cannot work out for itself: it depends on the font the
// panel has, the size the board chose, and what the browser does with a long
// word. So a `measure` function is passed IN -- the plugin gives it one that
// asks the real DOM, and a test gives it one that counts characters. Nothing
// here ever invents a width. That is not fastidiousness: five captions in the
// engine this replaces are measured as zero pixels wide and placed as if they
// were points, while drawing a hundred pixels wide, and every one of them is
// a label that comes out wrong on a real panel.

var C = require('./captions');
var Order = require('./order');
var B = require('./board');

// ---------------------------------------------------------------- the scale
//
// MINUTES TO PIXELS, and the only rule that matters is that it is MONOTONIC:
// later is always further along. A board that draws half past four before
// four o'clock is not a board with a layout problem, it is a lie.
//
// AND IT DOES NOT HAVE TO RUN AT ONE RATE.
//
// A linear scale spends the same paper on four empty hours of morning as on
// the four in which everything happens, and on a board whose window runs from
// six to midnight that is most of the panel given to nothing. The stretches
// with events in them are the stretches a reader is trying to read; the rest
// is there so the day still looks like a day.
//
// `segments` is a list of {from, to, rate}, in order, covering the window. A
// rate of one is ordinary time and anything less is time running fast. The
// only rule that matters is still that it is MONOTONIC -- later is always
// further along -- and every rate is positive, so it is, by construction.
//
// Everything downstream asks `at` and `back` and knows nothing about this.
function scaleFor(spec) {
  var m0 = spec.from, m1 = spec.to, a0 = spec.a0, a1 = spec.a1;
  var span = Math.max(1, m1 - m0);
  var segs = (spec.segments || []).filter(function (s) { return s.to > s.from; });
  if (!segs.length) segs = [{ from: m0, to: m1, rate: 1 }];
  // Each segment's share of the paper is its length times its rate, and the
  // shares are normalised so the window still fills the axis exactly.
  var total = 0, acc = [];
  segs.forEach(function (s) {
    acc.push({ from: s.from, to: s.to, rate: s.rate, w0: total });
    total += (s.to - s.from) * s.rate;
  });
  if (!(total > 0)) total = span;
  var px = a1 - a0;
  function at(min) {
    if (min <= acc[0].from) return a0 + (min - acc[0].from) * acc[0].rate / total * px;
    var lastSeg = acc[acc.length - 1];
    if (min >= lastSeg.to) {
      return a0 + (total + (min - lastSeg.to) * lastSeg.rate) / total * px;
    }
    for (var i = 0; i < acc.length; i++) {
      if (min > acc[i].to) continue;
      return a0 + (acc[i].w0 + (min - acc[i].from) * acc[i].rate) / total * px;
    }
    return a1;
  }
  function back(a) {
    var w = (a - a0) / px * total;
    for (var i = 0; i < acc.length; i++) {
      var len = (acc[i].to - acc[i].from) * acc[i].rate;
      if (w > acc[i].w0 + len && i < acc.length - 1) continue;
      return acc[i].from + (w - acc[i].w0) / acc[i].rate;
    }
    return m1;
  }
  return { at: at, back: back, segments: acc };
}

// WHICH STRETCHES OF THE DAY ARE WORTH PAPER.
//
// Asked of the events themselves rather than of the clock: a household whose
// day starts at five has a busy five o'clock, and a rule about "night" would
// be wrong about them. A half-hour cell with anything in it runs at full
// rate; one with nothing in it runs fast.
//
// "Now" is always full rate whatever is on at the time, because it is the
// first place a reader looks and a compressed one is hard to point at.
//
// ALL-DAY EVENTS DO NOT COUNT. They cover the whole window by definition, so
// counting them makes every cell busy and the scale linear again -- which is
// the one thing this exists to stop.
// FOUR HOURS A TICK. "We have to make speeding mean 4 hours per tick": the
// fast stretch runs at a quarter of the rate, and the strip labels it every
// four hours where it labels the rest every hour, so a tick is the same
// distance from the next one everywhere and only what it counts changes.
var QUIET_RATE = 0.25, CELL = 30, MIN_BUSY_SHARE = 0.25, NIGHT_RUN_MIN = 6 * 60;
function busyCells(metro, from, to) {
  var busy = {};
  function mark(a, b) {
    for (var m = Math.floor(a / CELL) * CELL; m <= b; m += CELL) busy[m] = 1;
  }
  (metro.events || []).forEach(function (ev) {
    if (ev.type && ev.type !== 'event') return;
    // A MOMENT TAKES NO TIME, so it has no time to stretch: Bin Day at eight
    // held a half hour at full rate for a mark and a name that sit on a
    // shelf anyway.
    if (!(ev.end_min > ev.start_min)) return;
    mark(ev.start_min, ev.end_min);
  });
  if (metro.now_min != null) mark(metro.now_min, metro.now_min);
  // A MOMENT THE SKY CHANGES IS WORTH ITS HOUR AT FULL RATE: "if it's that
  // important, don't do time compression". Squeezed, "Storms 20:00" had no
  // room left before the midnight and ran into the next day.
  (metro.weather || []).forEach(function (wx) {
    if (wx && wx.at_min != null) mark(wx.at_min, wx.at_min + 60);
  });
  var cells = [];
  for (var m = Math.floor(from / CELL) * CELL; m < to; m += CELL) {
    var lo = Math.max(from, m), hi = Math.min(to, m + CELL);
    if (hi > lo) cells.push({ from: lo, to: hi, busy: !!busy[m] });
  }
  // A QUIET GAP UNDER AN HOUR IS NOT A STRETCH, it is a pause between two
  // things: compressed, it came out as a 26px stutter of hatch and speed
  // marks between two busy half hours, and a scale that changes rate every
  // thirty minutes is one nobody can read.
  for (var ci = 0; ci < cells.length; ci++) {
    if (cells[ci].busy) continue;
    var cj = ci;
    while (cj < cells.length && !cells[cj].busy) cj++;
    var inside = ci > 0 && cj < cells.length;
    if (inside && cells[cj - 1].to - cells[ci].from < 60) {
      for (var ck = ci; ck < cj; ck++) cells[ck].busy = true;
    }
    ci = cj;
  }
  return cells;
}

// TRMNL'S MOON, twenty-eight phases picked by how far round the cycle the
// lit fraction and its direction put us, in the weather-icons set's
// outlined form.
function moonIcon(illum, waxing) {
  var frac = Math.max(0, Math.min(1, illum / 100));
  var cycle = waxing ? frac / 2 : 1 - frac / 2;
  var ix = Math.round(cycle * 28) % 28;
  var name = ix === 0 ? 'new' : ix < 7 ? 'waxing-crescent-' + ix : ix === 7 ? 'first-quarter'
    : ix < 14 ? 'waxing-gibbous-' + (ix - 7) : ix === 14 ? 'full' : ix < 21 ? 'waning-gibbous-' + (ix - 14)
    : ix === 21 ? 'third-quarter' : 'waning-crescent-' + (ix - 21);
  return 'https://trmnl.com/images/plugins/weather/wi-moon-alt-' + name + '.svg';
}

function segmentsFor(metro) {
  var from = metro.day_start_min, to = metro.day_end_min;
  if (!(to > from)) return null;
  var cells = busyCells(metro, from, to);
  // AND A DAY THAT IS NEARLY ALL QUIET IS DRAWN LINEAR. Compression is for
  // giving the busy part of a day the paper; where the busy part is a sliver,
  // the hatch covered most of the strip and read as the scale's normal rate
  // -- "why are there speed marks if it's just like normal?" -- while the
  // only stretches running at full rate were the exceptions.
  //
  // ...UNLESS THE QUIET IS A NIGHT. At twenty past nine the window crossed to
  // tomorrow and drew the empty hours until two at full rate, so tomorrow's
  // first things fell off the end: a quiet run that long is exactly what
  // compression is for, however little is busy around it.
  var busyMin = 0, quietRun = 0, run = 0;
  cells.forEach(function (c) {
    if (c.busy) { busyMin += c.to - c.from; run = 0; }
    else { run += c.to - c.from; quietRun = Math.max(quietRun, run); }
  });
  if (busyMin < (to - from) * MIN_BUSY_SHARE && quietRun < NIGHT_RUN_MIN) return null;
  // THE LEAD IN FRONT OF THE FIRST THING IS PAPER, NOT A SQUEEZED STRETCH. The
  // opening reaches back for it (openingAt) so the first events have room at
  // the edge; compressed to a quarter, that room was gone again and Coffee,
  // Bend Some Girders and Pre-flight Check were crammed against the names --
  // "start earlier in the day because you can have space for these events".
  // The hour before the first busy cell runs at full rate.
  var firstBusy = -1;
  for (var fb = 0; fb < cells.length; fb++) if (cells[fb].busy) { firstBusy = fb; break; }
  for (var lb = firstBusy - 1; lb >= 0 && cells[firstBusy].from - cells[lb].from < LEAD_KEEP_MIN; lb--) cells[lb].busy = true;
  // ONLY THE NIGHT RUNS FAST: "we should only time compress between midnight
  // and the earliest event and after the last event till midnight". A quiet
  // afternoon between two things is drawn at its own rate; a quiet cell is
  // squeezed only where nothing of its own day comes before it, or nothing
  // of its own day comes after it.
  // (events, not the clock or the sky: those are marks, not the day's span)
  var busyDays = {};
  (metro.events || []).forEach(function (ev) {
    if (ev.type && ev.type !== 'event') return;
    if (ev.start_min == null || ev.start_min >= to || (ev.end_min != null ? ev.end_min : ev.start_min) <= from) return;
    var e1 = ev.end_min != null ? ev.end_min : ev.start_min;
    var dk = Math.floor(ev.start_min / 1440), bd = busyDays[dk] = busyDays[dk] || { first: ev.start_min, last: e1 };
    bd.first = Math.min(bd.first, ev.start_min); bd.last = Math.max(bd.last, e1);
  });
  cells.forEach(function (c) {
    if (c.busy) return;
    var bd = busyDays[Math.floor(c.from / 1440)];
    if (bd && c.from >= bd.first && c.to <= bd.last) c.busy = true;
  });
  var segs = [], cur = null;
  cells.forEach(function (c) {
    var rate = c.busy ? 1 : QUIET_RATE;
    if (cur && cur.rate === rate) cur.to = c.to;
    else { cur = { from: c.from, to: c.to, rate: rate }; segs.push(cur); }
  });
  // A WINDOW WITH NOTHING QUIET IN IT IS LINEAR, and says so by handing back
  // nothing: a single full-rate segment is the same scale with extra
  // arithmetic in it, and the drawing would hatch a stretch that is not
  // compressed.
  if (segs.length < 2) return null;
  return segs;
}

// ---------------------------------------------------------------- the lines
//
// THE ORDER IS THE CONFIGURATION'S, NOT THE SOLVER'S.
//
// Which side of the board a person's line runs on, and how far out, is a
// setting: it is how the household has arranged itself and a reader learns it
// once. The solver decides how much ROOM each line gets and never which line
// is where -- somebody who has learned that their line is the second from the
// top must not find it third tomorrow because yesterday was busy.
function linesFrom(metro) {
  // WHAT ORDER, WHICH SIDE, WHO IS THE ANCHOR: see order.js. The payload
  // carries the household's own arrangement -- the order they listed their
  // people in, a pinned side, a colour, a badge -- and the arrangement of the
  // DRAWING is worked out here, where the events and the paper both are.
  var legend = metro.legend || [];
  // A LINE NOBODY NAMED AS A PERSON: where the config lists its people, a line
  // that is not one of them is a shared calendar's ("Family", "Deliveries").
  var named = legend.some(function (p) { return p.configured === true; }), person = {};
  legend.forEach(function (p) { person[p.key] = p.configured !== false; });
  return Order.arrange(legend, metro.events || []).map(function (p) {
    // NOTHING ABOUT HOW A LINE LOOKS COMES FROM THE PAYLOAD.
    //
    // It carries who was where and when, and the weather. A stroke weight, a
    // dash pattern and a tone are not facts about a calendar -- they are
    // this file's business, and taking them from the payload means a thing
    // that knows about ICS feeds is deciding what a metro line looks like.
    // `line_style` and `line_width` are ignored where they arrive, rather
    // than trusted-if-present: a field that is sometimes obeyed is a field
    // that will disagree with the table below on somebody's board.
    //
    // What DOES come through is identity and order -- a key, a name, which
    // side and how far out -- because that is the household's own
    // arrangement, set once and learned by everyone who reads the board.
    // ...AND THE RUNG OF THE STYLE LADDER the transform remembered for this
    // person (assignLineSlots), so a texture and a shade follow the person
    // and not the day's order.
    return { key: p.key, name: p.name, side: p.side, anchor: p.anchor,
             line_offset: p.line_offset, shared: named && !person[p.key],
             slot: typeof p.slot === 'number' ? p.slot : null };
  }).map(styleLine());
}

// HOW A LINE IS DRAWN IS THE FRONT END'S BUSINESS, and the table is the one
// the stable engine settled on rather than a fresh guess.
//
// The payload carries events and weather. transform.js knows about
// calendars, and what a metro line looks like is not its business -- so the
// encoding is assigned here, in board order, as one table in one place, and
// a `line_style` arriving in the payload is ignored rather than obeyed. A
// field that is sometimes honoured is a field that will one day disagree
// with this table on somebody's board.
//
//   the anchor   solid
//   then         dotted, dashed (a railway line), dashdot (beaded), thin
//
// AT ONE STROKE WEIGHT FOR ALL OF THEM. Weight used to be the other half of
// telling lines apart, and the note in the engine this comes from says what
// that cost: it made the board look like some people's days mattered more
// than others.
// The ninth of September's ladder: white dots on a solid rail, the railway
// line, the beaded rail. The thin plain rail that came first went when every
// style was set to one width (draw.js); the textures alternate with the
// shades the renderer hands out, so a second solid rail is told apart by its
// shade.
var TRACK_STYLES = ['dotted', 'dashed', 'dashdot', 'solid'];
// A shared event this long runs the lines together; shorter is a tie bar.
var MEET_MIN = 180;
// AN AMBIENT BLOCK IS A STATE, NOT A STOP: one person's seven hours or more in
// one place (a desk booking, working from home, a shift). Drawn as a shelf it
// ran the length of the day beside the rail, and the short meetings inside it
// either rode it -- "Github Copilot Updates" read as lasting till seven -- or
// crossed it. It is said at the line's head with its hours instead, the way
// an all-day entry is, and the rail stays one rail.
var AMBIENT_MIN = 7 * 60;
function ambient(ev) {
  return (!ev.type || ev.type === 'event') && !(ev.co_owners || []).filter(Boolean).length
    && ev.end_min != null && ev.end_min - ev.start_min >= AMBIENT_MIN;
}
// A shared calendar's line is a ladder and takes no place in the people's
// ladder of styles, so the people keep the styles they would have had.
function styleLine() {
  var people = 0;
  return function (p) {
    if (p.shared) p.style = 'ladder';
    else {
      // by the remembered rung where there is one, else by order
      var rung = typeof p.slot === 'number' ? p.slot : people;
      people++;
      p.style = rung === 0 ? 'solid' : TRACK_STYLES[(rung - 1) % TRACK_STYLES.length];
    }
    p.width = 3;
    return p;
  };
}

// ------------------------------------------------------------- the events
//
// ONE EVENT IS ONE EVENT, however many people are at it.
//
// An entry with co-owners is a convergence: four people at one dinner is one
// dinner, and drawn as four stops with four copies of the name it reads as
// four things happening at once. It becomes a bar across the lines that meet
// there, named once.
//
// Everything else belongs to one line and is a want against that line.
// The crowded stretches on each person's line: runs of three or more of
// their own events (nobody else's, no all-day or ambient block) where each
// starts closer to the one before than that one's name is wide. Returns the
// stretch each first event heads, and every later event folded into one.
var CROWD_MIN = 3, CROWD_MAX = 6, CROWD_GAP_MIN = 15;
function crowdsFrom(metro, scale, measure, opts) {
  var byHead = new Map(), members = [];
  function clockOf(m) {
    var h = Math.floor(m / 60) % 24, mm = ((m % 60) + 60) % 60;
    if (!metro.hour12) return h + ':' + (mm < 10 ? '0' : '') + mm;
    return (h % 12 || 12) + (mm ? ':' + (mm < 10 ? '0' : '') + mm : '') + (h < 12 ? 'am' : 'pm');
  }
  var byOwner = {};
  (metro.events || []).forEach(function (ev) {
    if ((ev.type && ev.type !== 'event') || !ev.owner || (ev.co_owners || []).filter(Boolean).length) return;
    if (ambient(ev) || ev.start_min >= metro.day_end_min || (ev.end_min != null ? ev.end_min : ev.start_min) <= metro.day_start_min) return;
    if (ev.start_min < metro.day_start_min) return;
    (byOwner[ev.owner] = byOwner[ev.owner] || []).push(ev);
  });
  Object.keys(byOwner).forEach(function (k) {
    var list = byOwner[k].sort(function (p, q) { return p.start_min - q.start_min; });
    var run = [];
    function close() {
      if (run.length >= CROWD_MIN) {
        var head = run[0];
        var end = run.reduce(function (m, ev) { return Math.max(m, ev.end_min != null ? ev.end_min : ev.start_min); }, head.start_min);
        var ev = Object.assign({}, head, { end_min: end,
          parts: run.map(function (e) { return e.title; }),
          crowd: run.map(function (e) { return { time: clockOf(e.start_min), title: e.title }; }),
          // the strip's own "+{n} more", in the board's language
          moreText: (metro.i18n && metro.i18n.more) || '+{n} more',
          title: run.map(function (e) { return e.title; }).join(' \u00b7 ') });
        // A stretch nothing can caption is not one: its events keep their own.
        if (measure(ev, opts).length) {
          byHead.set(head, { ev: ev, marks: run.slice(1).map(function (e) { return scale.at(e.start_min); }) });
          run.slice(1).forEach(function (e) { members.push(e); });
        }
      }
      run = [];
    }
    list.forEach(function (ev) {
      if (run.length) {
        var prev = run[run.length - 1];
        var forms = measure(prev, opts);
        var need = forms.length ? forms[0].w * 0.6 : 0;
        var prevEnd = Math.max.apply(null, run.map(function (e) { return e.end_min != null ? e.end_min : e.start_min; }));
        // back to back (within a quarter of an hour of the last one ending),
        // too close for the names to stand side by side, and not too many
        if (scale.at(ev.start_min) - scale.at(prev.start_min) >= need
            || ev.start_min - prevEnd > CROWD_GAP_MIN || run.length >= CROWD_MAX) close();
      }
      run.push(ev);
    });
    close();
  });
  return { byHead: byHead, members: members };
}

function wantsFrom(metro, scale, measure, opts) {
  var wants = [], pills = [], n = 0;
  // CLEAR OF THE MARKS. A caption keeps this much from its rail's centre,
  // and the tick on that rail reaches a mark's radius out from it: at the
  // old six the time row sat on the tick -- "captions should not clip into
  // their own track (or any other)."
  var gap = Math.round(((opts && opts.markR) || 8) * 1.1) + 2;
  // BACK TO BACK, THE SAME PEOPLE, ONE INTERCHANGE. "Good News Everyone" at a
  // quarter to nine for the whole crew and "Delivery Run" at nine for three of
  // them: two bars fifteen minutes apart put two sets of rings on top of each
  // other and the second name had nothing to point at. Where a shared thing
  // starts closer than a few rings' width to the bar before it, and one party
  // is inside the other, it is one bar at the first start across everybody,
  // both names stacked on it with their own times, and each long one's people
  // ticked where it ends.
  var markR = (opts && opts.markR) || 8, heads = [], folded = [];
  function party(ev) { return [ev.owner].concat((ev.co_owners || []).filter(Boolean)); }
  // (a moment is never stacked: it has no length to run on into the next,
  // and as a stop on somebody else's branch it came out as a tick jammed
  // against a dot -- "this looks weird". It hangs off its own bar.)
  function barLike(ev, who) { return ev.end_min > ev.start_min && (who.length > 2 || ev.end_min - ev.start_min < MEET_MIN); }
  function inside(xs, ys) { return xs.every(function (k) { return ys.indexOf(k) >= 0; }); }
  (metro.events || []).filter(function (ev) {
    return (!ev.type || ev.type === 'event') && (ev.co_owners || []).filter(Boolean).length
      && ev.start_min < metro.day_end_min && ev.end_min > metro.day_start_min;
  }).sort(function (p, q) { return p.start_min - q.start_min; }).forEach(function (ev) {
    var who = party(ev), head = null;
    for (var hi = heads.length - 1; hi >= 0; hi--) {
      var h = heads[hi];
      if (!inside(who, h.who) && !inside(h.who, who)) continue;
      var near = scale.at(Math.max(ev.start_min, metro.day_start_min))
        - scale.at(Math.max(h.ev.start_min, metro.day_start_min)) < markR * 6;
      if (near && ev.start_min <= h.end) head = h;
      break;
    }
    // Only bars: two people at a long thing run their lines together instead
    // (see below), with no rings to pile up, and stay as they are.
    var all = head ? head.who.concat(who.filter(function (k) { return head.who.indexOf(k) < 0; })) : who;
    if (head && head.bar && barLike(ev, who)) {
      head.parts.push(ev); head.who = all; head.end = Math.max(head.end, ev.end_min); folded.push(ev);
    } else heads.push({ who: who, ev: ev, parts: [ev], end: ev.end_min, bar: barLike(ev, who) });
  });
  // A CROWDED STRETCH IS ONE CAPTION. Fifteen meetings a quarter of an hour
  // apart on one person's line cannot each have a name beside their own dot:
  // a rail has two sides, so from the third name on every name is nearer
  // somebody else's dot than its own, and the board either leaves names off
  // or scatters them where nobody can pair them. Three or more back-to-back
  // events whose names cannot stand side by side are one stop's worth of
  // words instead: every dot stays, and one caption lists them in time order
  // ("9:00 Standup", "9:15 Sync"), shortened the way a merged stop's list is
  // when the room runs out.
  var crowds = crowdsFrom(metro, scale, measure, opts);
  crowds.members.forEach(function (ev) { folded.push(ev); });
  (metro.events || []).forEach(function (ev0) {
    if (folded.indexOf(ev0) >= 0) return;
    var ev = ev0;
    var crowd = crowds.byHead.get(ev0) || null;
    if (crowd) ev = crowd.ev;
    var mine = heads.filter(function (h) { return h.ev === ev0 && h.parts.length > 1; })[0];
    if (mine) {
      ev = Object.assign({}, ev0, { end_min: mine.end, stack: mine.parts,
                                    co_owners: mine.who.filter(function (k) { return k !== ev0.owner; }),
                                    title: mine.parts.map(function (x) { return x.title; }).join(' \u00b7 ') });
    }
    if (ev.type && ev.type !== 'event') return;
    // Past the window is counted at the edge (fixedFor), not placed: a
    // name for a minute the board does not draw has nowhere to go.
    if (ev.start_min >= metro.day_end_min || ev.end_min <= metro.day_start_min) return;
    if (ambient(ev)) return;   // a state at the head: statesFor
    // AN EVENT THAT STRADDLES AN EDGE IS DRAWN FROM THE EDGE.
    //
    // `scale.at` extrapolates past both ends of the axis rather than
    // clamping, so a school day that began three hours before the window
    // opened came back as a position well off the left of the board. Nothing
    // downstream could route a corridor from there, so the two rails stayed
    // on their own rows for the whole visible stretch -- and the merge
    // diamond, which is drawn across the rows the pill names whatever the
    // rails did, came out as a 280px spindle between two lines that never
    // met. "How did we go from this beauty to those stupid large diamonds."
    //
    // Clamped, the corridor starts at the leading edge, which is also the
    // truth: the board opens with those two already together. The caption
    // still says 8:30am, because that is when it started; the DRAWING starts
    // where the board does.
    var vs = Math.max(ev.start_min, metro.day_start_min);
    var ve = Math.min(ev.end_min, metro.day_end_min);
    var a0 = scale.at(vs), a1 = scale.at(Math.max(ve, vs));
    var open0 = ev.start_min < metro.day_start_min;
    var open1 = ev.end_min > metro.day_end_min;
    var id = 'e' + (n++);
    // (a stack is named part by part: the first here, the rest riding its branch)
    var forms = measure(ev.stack ? ev.stack[0] : ev, opts);
    if (!forms.length) return;
    var mates = (ev.co_owners || []).filter(Boolean);
    if (mates.length) {
      var keys = [ev.owner].concat(mates);
      // A TIE OR A CONVERGENCE. Dinner is an hour: one bar across the lines
      // at seven with a ring on each says everyone was there, and the name
      // hangs off the owner's line like any other event. A school day is
      // long enough for the lines to run together for it and be read that
      // way -- and only if the panel gives it the room to draw.
      // A CORRIDOR IS FOR TWO PEOPLE. ANYTHING WIDER IS A TIE.
      //
      // A long shared event used to pull its lines into a corridor whatever
      // the size of the party: they leaned in at its start, ran together for
      // its length and parted at its end. For two people it is the best
      // drawing on this map. It does not scale past them -- "only the
      // corridor for 2 people events".
      //
      // With three it is three rails deep: it costs all of them their own
      // rows for hours, so everything hung off those rows has to move; the
      // merge diamond spans however far apart the outermost two happened to
      // be; and the names at each end become a stack nobody can pair with a
      // rail, because in a corridor there is no rail to pair them with.
      //
      // Wider than two, the tie says the same thing in one place: a bar
      // across the lines that are in it, a ring on each, and nobody leaves
      // their row. "We need something like family dinner for long shared
      // events as well, but something that shows the termination as well" --
      // so the span travels with it as `to` and every member is ticked where
      // it ends, which is the mark rule 29e already gives an ending. Brief
      // events are ties at any size, as they have always been.
      var brief = (ev.end_min - ev.start_min) < MEET_MIN
               || (a1 - a0) <= ((opts && opts.markR) || 8) * 4;
      if (brief || keys.length > 2) {
        // A STACK HANGS OFF ITS OWNER'S RAIL TOO: hung off the bar, "Good News
        // Everyone" over "Delivery Run" was a caption "not connected to
        // anything". ONE BRANCH FOR ALL OF THEM, "continue the branch": it
        // leaves the owner's ring and runs to where the last of them ends; the
        // first ends in a tick where it ends, and each after it is a stop on
        // the same branch, its own dot, tick and name (the riders below).
        var spanned = !brief && !ev.stack && a1 > a0;
        var firstTo = ev.stack ? scale.at(Math.min(ev.stack[0].end_min, metro.day_end_min)) : null;
        // where each long one in it ends, and whose lines it ends on
        var ends = (ev.stack || [ev]).filter(function (part) {
          return ev.stack ? part.end_min - part.start_min >= MEET_MIN : spanned;
        }).map(function (part) {
          return { to: scale.at(Math.min(part.end_min, metro.day_end_min)), lines: party(part),
                   open1: part.end_min > metro.day_end_min };
        });
        pills.push({ id: id + 't', a: a0, a0: a0, a1: a0, to: spanned ? a1 : null, ends: ends,
                     lines: keys, tie: true, open0: open0, open1: open1, todo: !!ev.todo, done: !!ev.done });
        // A BRIEF TIE'S NAME HANGS OFF ITS OWNER'S RAIL, as it always has:
        // dinner is an hour, the owner's line carries a short shelf for it
        // and the name sits against that.
        //
        // A SPANNED ONE'S HANGS OFF THE BAR. Given the same treatment, the
        // owner's rail grew a shelf as long as the event -- three hours of
        // Bart's own rail for a thing all three of them were at, drawn twice
        // over: once as the bar across them and once as one person's branch.
        // The bar is the thing that happened, so the name belongs to it,
        // which is rule 31's case exactly.
        // A MOMENT HAS NO SHELF EITHER: a reminder at seven for two people is a
        // minute, and a branch off the bar to a tick drew a length it does not
        // have ("the little branch ends in a clumsy box"). Its name hangs off
        // the bar like a long one's.
        var moment = !ev.stack && !(ev.end_min > ev.start_min);
        // ONE DRAWING FOR A SHARED EVENT, WHATEVER ITS LENGTH ("why
        // doesn't the second one have its own branch, or continue the
        // first one?"): two events the same four people were at, two hours and
        // three, were drawn two different ways because three hours is the
        // line between brief and spanned. Both hang their name off the
        // owner's rail on a branch now, with every member ticked where it
        // ends, so the pair reads as a pair. Not on a slot, where the
        // branch costs a rail somebody else was using.
        // A MOMENT HANGS OFF THE BAR, and so does a long one where the
        // branch would cost a slot a rail somebody else is using; anything
        // else hangs off its owner's rail on a branch.
        var onBar = moment || (spanned && opts && opts.tiny);
        wants.push(onBar
          ? new C.Want({ id: id, text: ev.title, pill: id + 't',
                         open0: open0, open1: open1, a0: a0, a1: a0, forms: forms })
          : new C.Want({ id: id, text: ev.stack ? ev.stack[0].title : ev.title, line: ev.owner,
                         tie: id + 't', tieFree: !!ev.stack, endAt: firstTo,
                         open0: open0, open1: open1,
                         a0: a0, a1: a1, forms: forms, gap: gap }));
        (ev.stack || []).slice(1).forEach(function (part, k) {
          var pf = measure(part, opts);
          if (!pf.length || part.start_min >= metro.day_end_min) return;
          wants.push(new C.Want({ id: id + 'r' + (k + 1), text: part.title, line: ev.owner, ride: id,
                                  open0: part.start_min < metro.day_start_min, open1: part.end_min > metro.day_end_min,
                                  a0: scale.at(Math.max(part.start_min, metro.day_start_min)),
                                  a1: scale.at(Math.min(part.end_min, metro.day_end_min)),
                                  forms: pf, gap: gap }));
        });
        return;
      }
      // THE SPAN AS WELL AS THE MINUTE. The capsule is drawn at the middle,
      // but the tracks CONVERGE for as long as the event lasts -- they come
      // together at its start and part again at its end -- so the geometry
      // needs both ends of it and not only its centre.
      pills.push({ id: id, a: (a0 + a1) / 2, a0: a0, a1: a1, lines: keys,
                   open0: open0, open1: open1 });
      wants.push(new C.Want({ id: id, text: ev.title, pill: id, open0: open0, open1: open1,
                              a0: (a0 + a1) / 2, a1: (a0 + a1) / 2, forms: forms }));
      return;
    }
    wants.push(new C.Want({ id: id, text: ev.title, line: ev.owner, todo: !!ev.todo, done: !!ev.done,
                            open0: open0, open1: open1,
                            members: crowd ? crowd.marks : null,
                            a0: a0, a1: a1, forms: forms, gap: gap }));
  });
  // In start order, which is the order a reader scans in and therefore the
  // order the greedy seed should place them.
  wants.sort(function (p, q) { return p.a0 - q.a0; });
  return { wants: wants, pills: pills };
}

// AN ALL-DAY EVENT IS A STATE OF THE LINE, NOT A STOP ON IT (rules 54-57).
//
// "Office Closed", "School Holiday", "Half Term". Nothing happens at a
// minute, so it has no place on a scale of hours: drawn along the rail it
// came out as a caption jammed against the line's own name, and on a board
// that rolls into tomorrow it was stamped across days it is not on. It is
// declared at the line's HEAD instead, in a second row under the name, and
// both ends of that line open (see draw.js).
//
// WHICH DAYS, WHERE THAT IS A QUESTION. Only the days the board is drawing
// count: a state on tomorrow alone is not on a board that stops tonight, and
// on a board that reaches into tomorrow it says which day it is on, the way
// the strip names that day. One covering every drawn day owes no qualifier.
//
// NAMED ONCE WHERE SEVERAL LINES SHARE IT, at the first owner's head, with
// a tie down to the rest. Three people are not on three holidays.
// A line's route rows, [at the leading head, at the far head]: each state
// is named by its first owner, at the far head only where it does not run
// off the leading edge.
function routeRows(states, key, oneName) {
  var rows = [[], []];
  states.forEach(function (st, si) {
    // an ambient block is drawn as its band on the rail (fixedFor), not as a
    // row under the name
    // EVERY OWNER'S HEAD SAYS IT. A shared state used to be named once, at
    // its first owner, with a dashed tie hung down to the rest -- "one
    // holiday, not three". With each line's name set in the legend's column
    // that tie stood right beside the connector already joining the same
    // people and read as a second meeting ("the vertical dotted lines? what
    // do they mean now?"), and the line it was tied to said nothing about
    // its own day. So each person's badge says what their day is.
    if (st.owners.indexOf(key) < 0 || st.timed) return;
    var far = st.head != null ? st.head === 1 : (st.ends && !st.ends[0]);
    rows[!oneName && far ? 1 : 0].push({ text: st.text, day0: st.day0 || 0, si: si });
  });
  return rows.map(function (r) {
    if (!r.length) return null;
    // IN THE ORDER THE DAYS RUN. One head says everything that line is for
    // the days drawn, and a reader takes a list of two as a sequence.
    r.sort(function (x, y) { return x.day0 - y.day0 || x.si - y.si; });
    return r.map(function (x) { return x.text; }).join(', ');
  });
}

function statesFor(metro) {
  var all = metro.days || [];
  var drawn = all.filter(function (d) {
    return d.end_min > metro.day_start_min && d.start_min < metro.day_end_min;
  });
  function ix(d) { return d.index != null ? d.index : all.indexOf(d); }
  var out = [];
  (metro.all_day || []).forEach(function (ad) {
    var owners = (ad.owners || []).filter(Boolean);
    if (!owners.length || !ad.title) return;
    var on = drawn;
    if (ad.days && ad.days.length && drawn.length) {
      on = drawn.filter(function (d) { return ad.days.indexOf(ix(d)) >= 0; });
      if (!on.length) return;
    }
    var text = ad.title;
    if (drawn.length > 1 && on.length < drawn.length) {
      text += ' \u00b7 ' + on.map(function (d) {
        return d.weekday_short || d.date_label || d.weekday_label;
      }).filter(Boolean).join(', ');
    }
    // Which edges of the paper the state runs off: leave that is tomorrow's
    // did not begin before the board's first hour, so that end is a slash.
    var ends = drawn.length ? [on.indexOf(drawn[0]) >= 0, on.indexOf(drawn[drawn.length - 1]) >= 0] : [true, true];
    // WHICH DAY IT STARTS ON, so that a head carrying two of them says them
    // in the order they happen: "Night Shift . Sat, Half Term . Sun", not in
    // the order the calendar handed them over.
    out.push({ title: ad.title, text: text, owners: owners, ends: ends,
               day0: drawn.length ? drawn.indexOf(on[0]) : 0 });
  });
  // ...AND THE AMBIENT BLOCKS, with their hours ("Desk booking 8am-7pm"), at
  // the head of the day they are on and with no chevron: they begin and end.
  function hm(m) {
    var h = Math.floor(m / 60) % 24, mm = ((m % 60) + 60) % 60;
    // short, because it is set in the name's gutter: "8:30", "17:00"
    if (!metro.hour12) return h + ':' + (mm < 10 ? '0' : '') + mm;
    var h12 = h % 12 || 12;
    return h12 + (mm ? ':' + (mm < 10 ? '0' : '') + mm : '') + (h < 12 ? 'am' : 'pm');
  }
  (metro.events || []).forEach(function (ev) {
    if (!ambient(ev) || !ev.owner || !ev.title) return;
    if (ev.start_min >= metro.day_end_min || ev.end_min <= metro.day_start_min) return;
    var day = null;
    drawn.forEach(function (d) { if (ev.start_min >= d.start_min && ev.start_min < d.end_min) day = d; });
    var later = !!(day && drawn.length > 1 && day !== drawn[0]);
    var text = ev.title + ' ' + hm(ev.start_min) + '\u2013' + hm(ev.end_min)
      + (later ? ' \u00b7 ' + (day.weekday_short || day.date_label || '') : '');
    out.push({ title: ev.title, text: text, owners: [ev.owner], ends: [false, false], head: later ? 1 : 0, timed: true,
               day0: later ? 1 : 0, from: ev.start_min, to: ev.end_min });
  });
  return out;
}

// A MEASURER THAT COUNTS CHARACTERS, for running this without a browser.
//
// It is not pretending to be a font. It is a stand-in with the one property
// that matters for testing the solver -- a longer title is wider -- and it is
// deliberately a separate thing from the one the plugin uses, so that nothing
// in the geometry can come to depend on the particular widths it returns.
function charMeasure(cell, rowH) {
  cell = cell || 8; rowH = rowH || 13;
  return function (ev, opts) {
    var title = ev.title || '';
    var time = fmt(ev.start_min) + '–' + fmt(ev.end_min);
    var wide = Math.max(title.length, time.length) * cell;
    var forms = [];
    // Richest first: the time over the title, then the title alone, then the
    // title alone smaller. Every one MEASURED at the size it would be drawn.
    //
    // `rows` is what a renderer actually draws, kept beside the size rather
    // than re-derived from it: a form that is two rows tall has to be able to
    // say WHICH two, or the drawing invents them and the measurement stops
    // describing the thing on the panel.
    forms.push({ w: wide, h: rowH * 2, text: title, rows: [title, time], size: 1 });
    forms.push({ w: title.length * cell, h: rowH, text: title, rows: [title], size: 1 });
    if (!opts || opts.smallText !== false) {
      forms.push({ w: Math.round(title.length * cell * 0.8), h: Math.round(rowH * 0.8),
                   text: title, rows: [title], size: 0.8 });
    }
    return forms;
  };
  function fmt(m) {
    var h = Math.floor(m / 60) % 24, mm = m % 60;
    return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm;
  }
}

// ---------------------------------------------------------------- the seam
//
// A payload and a panel in; a spec the solver understands out.
// ROOM BEFORE THE FIRST EVENT AND AFTER THE LAST. A day whose first event
// starts at the window's own first minute put its dot on the terminus:
// "give some time span [room] so the first event doesn't start directly at
// the beginning of a track." The window opens half an hour earlier, on the
// half hour, and closes half an hour later the same way.
var EDGE_MIN = 30;
function edged(metro) {
  var lo = metro.day_start_min, hi = metro.day_end_min;
  if (lo == null || hi == null) return metro;
  var first = Infinity, last = -Infinity;
  (metro.events || []).forEach(function (ev) {
    if (ev.type && ev.type !== 'event') return;
    if (ev.start_min >= lo && ev.start_min <= hi) first = Math.min(first, ev.start_min);
    var e = ev.end_min != null ? ev.end_min : ev.start_min;
    if (e >= lo && e <= hi) last = Math.max(last, e);
  });
  var nlo = lo, nhi = hi;
  if (first - lo < EDGE_MIN) nlo = Math.floor((first - EDGE_MIN) / 30) * 30;
  // ...AND NOT ONTO SOMETHING ELSE'S START. Backing off half an hour uncovers
  // whatever began in that half hour, and on the half hour is exactly when
  // things begin: at ten past two the room for a nine o'clock landed on the
  // school day's half past eight, and the board opened on it -- a full merge
  // diamond on top of both terminal slashes, saying the two of them met at
  // the first minute of the paper. Backing off again reaches into a morning
  // the step shed on purpose, so the edge goes the other way instead: just
  // past that start, where the event straddles it and wears the half mark
  // (rule 2g), with what room is left for the first one.
  for (var moved = true; moved;) {
    moved = false;
    (metro.events || []).forEach(function (ev) {
      if (ev.type && ev.type !== 'event') return;
      var s = ev.start_min;
      if (moved || s < nlo || s >= lo || s >= first || s - nlo >= EDGE_MIN / 2) return;
      nlo = s + Math.min(5, (first - s) / 2);
      moved = true;
    });
  }
  if (hi - last < EDGE_MIN) nhi = Math.ceil((last + EDGE_MIN) / 30) * 30;
  if (nlo === lo && nhi === hi) return metro;
  return Object.assign({}, metro, { day_start_min: nlo, day_end_min: nhi });
}

// WHAT A PANEL CAN HOLD, in hours and in events. "The timeframe calculator
// needs to take into account a max amount of events per screen and view
// size, and a max timeframe per screen and view." Measured against the
// row height, which is the panel's own unit: two rows of width per hour
// keeps an hour label per hour readable, and forty-five rows' worth of
// paper per event is about what a name, its time and its marks take.
function frameFor(view, opts) {
  var rowH = (opts && opts.rowH) || 12;
  var hours = Math.max(6, Math.min(24, Math.round(view.w / (rowH * 2.0))));
  // A SHORTER WINDOW WAS SOMETHING THE CALLER COULD ASK FOR, twice, and the
  // note by the window ladder in fit.js has the measurements both times.
  var events = Math.max(3, Math.min(60, Math.round(view.w * view.h / (rowH * rowH * 45))));
  // ...AND HOW MANY PEOPLE. The third cap, and the one that buys time rather
  // than paper: `fit` sheds a line at a time from the top, re-solving at
  // every rung, and on a small slot it spends the whole clock proving what
  // the slot's own size already says. Measured across all four layout boxes
  // and all four views on one board, the two worst cases each burned their
  // entire budget over five rungs and then kept everybody anyway, with two
  // names nobody could read.
  //
  // AREA, NOT HEIGHT. Bands stack down the panel, so height looks like the
  // answer, and it is not: 800x240 holds three lines, 400x480 is the same
  // paper turned on its side and holds four, and 520x390 holds five. What a
  // line costs is a rail AND a rung of captions beside it, and captions run
  // ACROSS -- a narrow board runs out of room along the axis long before it
  // runs out of bands. Three hundred rows' worth of paper each is what the
  // measured boards come to.
  //
  // Eight is as high as it goes because past that the count stops being the
  // binding constraint and `worth` should decide; one is the floor, since a
  // map of nobody is not a smaller map.
  var tracks = Math.max(1, Math.min(8, Math.round(view.w * view.h / (rowH * rowH * 300))));
  return { hours: hours, events: events, tracks: tracks };
}
// THE WINDOW A PANEL DRAWS IS AS LONG AS IT CAN SHOW. The payload's window
// is the day's; a quadrant cannot show a day, so it shows what it can from
// the window's start -- as many hours as fit, and no more events than it
// holds, cut on the hour -- and counts the rest as later. Never cut before
// the clock: the board is about now first.
// WHERE THE BOARD OPENS.
//
// The last of the layout that lived in transform.js. It is the awkward one,
// because the reason the opening STEPS rather than following the clock is
// stability: an e-ink panel refreshes about four times an hour, and a window
// keyed to the minute slides under whoever is reading it every time. That
// sounds like it needs to know when the last refresh was, which the client
// cannot know -- and it does not, because the step is a pure function of the
// clock the payload already carries. Two refreshes fifteen minutes apart get
// the same answer because they fall in the same step, not because anything
// remembered the first one.
// EVERY HOUR FROM TEN, AN HOUR BACK. Four steps a day, each two hours back,
// left the clock a third of the way along the board for most of the
// afternoon and the paper spent on a morning nobody could attend any more:
// "focus more on the now and future". Stepping on the hour keeps the shape
// still across a refresh (four to the hour) and keeps now within an hour or
// two of the leading edge, which is where a board about what is coming
// wants it.
var ROLL_STEPS_MIN = [];
for (var rs = 10 * 60; rs <= 21 * 60; rs += 60) ROLL_STEPS_MIN.push(rs);
var ROLL_LOOKBACK_MIN = 60;
// Before the first step the board is the whole day from six, which is when a
// household's day starts being worth drawing.
var ROLL_START_MIN = 6 * 60;
// ...AND ROOM IN FRONT OF THE FIRST THING ON IT. The line names are drawn
// inside the map at the leading edge (rule 33e), so an event sitting on the
// opening has its shelf and its spur drawn in the legend: "Shift Handover
// shelf should not cross the track label. Also, there should be more time
// allocated before the actual events start."
var LEAD_MIN = 2 * 60;
// ...of which this much is drawn at full rate (segmentsFor).
var LEAD_KEEP_MIN = 60;

function openingAt(metro, lead) {
  var stepAt = null;
  ROLL_STEPS_MIN.forEach(function (st) { if (metro.now_min >= st) stepAt = st; });
  var w = stepAt != null ? Math.max(ROLL_START_MIN, stepAt - ROLL_LOOKBACK_MIN) : ROLL_START_MIN;
  if (!lead) return Math.max(0, Math.floor(w / 60) * 60);
  // THE STEP DECIDES THE OPENING, AND ONLY THE LEAD REACHES BACK PAST IT.
  //
  // It used to widen for every event still running at the lookback, so that a
  // window could not cut an event it had decided to draw. That undid the
  // step: a school day from half past eight held the four o'clock window open
  // at half past eight, and a board read in the evening still opened in the
  // morning with eleven hours of spent day on it. What began before the
  // opening is drawn FROM the edge instead, clipped, with a half dot to say
  // so; what finished before it is counted there as "+N earlier".
  //
  // ONE PASS, AND IT CANNOT RUN AWAY: the opening moves back by at most
  // LEAD_MIN, because the event it moves for is at or after the opening it
  // started from.
  var first = null, last = null;
  (metro.events || []).forEach(function (ev) {
    if (ev.type && ev.type !== 'event') return;
    if (ev.start_min == null) return;
    if (ev.start_min >= w && (first == null || ev.start_min < first)) first = ev.start_min;
    if (last == null || ev.start_min > last) last = ev.start_min;
  });
  // AND IT NEVER OPENS PAST EVERYTHING IT HAS.
  //
  // The step sheds the morning, which is the point; it must not shed the
  // whole day. A day whose last appointment was at nine, read at half past
  // two, has nothing at or after the eleven o'clock opening -- and the board
  // came out BLANK. Every event clipped, no dots, no captions, an empty grid
  // with a clock on it. That is worse than any amount of spent morning, and
  // it is the one case the widening this replaced was really protecting.
  //
  // So where nothing starts after the opening, the opening backs off far
  // enough to hold the last thing there was. A day you have already had is
  // still your day.
  if (first == null && last != null) w = Math.min(w, last - lead);
  else if (first != null && first - w < lead) w = first - lead;
  // AND NEVER AFTER THE CLOCK. Read at 02:41 the morning opening was six, or
  // the first thing's lead, and the board drew eight till eight with no time
  // on it at all: "it's 02:41 and not showing the current time". The night
  // between now and the first thing is quiet and the scale compresses it.
  // In three-hour steps, like the day's own: a window keyed to the clock
  // would slide under the reader at every refresh.
  if (metro.now_min != null && metro.now_min < w) w = Math.floor(metro.now_min / 180) * 180;
  return Math.max(0, Math.floor(w / 60) * 60);
}

// The payload carries everything it gathered, from its own midnight; this is
// what decides where the drawing starts inside that. A board with no clock on
// it is not about today and has no "now" to open near, so it keeps what it
// was sent.
function opened(metro) {
  if (metro == null || metro.now_min == null) return metro;
  var from = openingAt(metro, LEAD_MIN);
  if (!(from > (metro.day_start_min || 0))) return metro;
  return Object.assign({}, metro, { day_start_min: from });
}

// A STRETCH WITH NOTHING IN IT IS NOT WORTH PAPER.
//
// Three hours is where a gap stops reading as "later today" and starts
// reading as another day. Under it the quiet hours are part of the shape of
// the day and the axis compresses them anyway; over it the board is spending
// its width on nothing to reach something.
var GAP_MIN = 180;
// ...UNLESS WHAT IS THIS SIDE OF IT IS NOT A BOARD YET. At half past ten at
// night everything left is on the other side of the gap, and a board that
// stopped at the gap would be a blank one. Same number as the quiet day it
// replaces: up to two things is not a day's worth.
var THIN_MAX = 2;

// THE WINDOW A PANEL DRAWS IS AS LONG AS IT CAN SHOW, and no longer than it
// has anything to show. The payload carries today AND tomorrow; this is what
// picks between them, per view, and what it leaves out is counted as later by
// the pass that draws the edge.
//
// Three things end the span, in this order: a gap with nothing in it, the
// hours the view can hold, and the events it can hold. Never cut before the
// clock -- the board is about now first.
// HOW FAR THE HOURS CAP REACHES, WITH A NIGHT DRAWN AT ITS OWN RATE. The cap
// is paper, not clock: a quiet run long enough to be compressed (see
// `segmentsFor`) costs a quarter of its hours, so an evening board that
// crosses the night still reaches tomorrow's first things instead of
// spending its whole width on the empty morning.
function reachFor(metro, lo, hi, budget, opts) {
  if (opts && opts.evenTime) return lo + budget;
  var cells = busyCells(metro, lo, hi), t = lo;
  for (var i = 0; i < cells.length; i++) {
    if (cells[i].busy) continue;
    var j = i;
    while (j < cells.length && !cells[j].busy) j++;
    var ra = cells[i].from, rb = cells[j - 1].to;
    i = j;
    if (rb - ra < NIGHT_RUN_MIN) continue;
    if (ra - t >= budget) break;
    budget -= ra - t; t = ra;
    if ((rb - ra) * QUIET_RATE >= budget) return t + budget / QUIET_RATE;
    budget -= (rb - ra) * QUIET_RATE; t = rb;
  }
  return t + budget;
}

function framed(metro, view, opts) {
  var lo = metro.day_start_min, hi = metro.day_end_min;
  if (lo == null || hi == null) return metro;
  var cap = frameFor(view, opts);
  var end = Math.min(hi, reachFor(metro, lo, hi, cap.hours * 60, opts));
  var evs = (metro.events || []).filter(function (ev) {
    return !(ev.type && ev.type !== 'event') && ev.start_min >= lo && ev.start_min < hi;
  }).sort(function (p, q) { return p.start_min - q.start_min; });
  // WHERE THE DAY STOPS HAVING ANYTHING IN IT. Walked in start order, keeping
  // the furthest end seen: an event inside a longer one does not open a gap,
  // and neither does a run of overlapping ones.
  var reach = lo, held = 0;
  for (var i = 0; i < evs.length; i++) {
    // ...and a thin day crosses the gap only if the far side is on the
    // board once it has: at twenty past nine with a swim and a book club
    // today, crossing drew the whole night to six in the morning, stopped
    // three hours short of tomorrow's first thing, and said "+3 more" over
    // eight hours of nothing.
    var beyond = evs[i].start_min >= end;
    if ((held > THIN_MAX || (held && beyond)) && evs[i].start_min - reach > GAP_MIN) {
      // A tail's worth of paper past the last thing drawn, so its name has
      // somewhere to sit, on the half hour like every other edge here.
      end = Math.min(end, Math.ceil((reach + EDGE_MIN) / 30) * 30);
      break;
    }
    reach = Math.max(reach, evs[i].end_min != null ? evs[i].end_min : evs[i].start_min);
    // STILL TO COME, not merely on the board (rule 2a). Counted from the
    // opening, an evening board held the afternoon it had already had --
    // six things, all over by eight -- and at twenty to nine stopped at the
    // gap before tomorrow with nothing left on it.
    var e = evs[i].end_min != null ? evs[i].end_min : evs[i].start_min;
    if (metro.now_min == null || e > metro.now_min) held++;
  }
  var starts = evs.filter(function (ev) { return ev.start_min < end; })
    .map(function (ev) { return ev.start_min; });
  if (starts.length > cap.events) end = Math.min(end, Math.floor(starts[cap.events] / 60) * 60);
  if (metro.now_min != null && metro.now_min >= lo) end = Math.max(end, Math.min(hi, metro.now_min + 60));
  end = Math.max(end, Math.min(hi, lo + 180));
  end = Math.min(end, hi);
  var out = Object.assign({}, metro, { day_end_min: end });
  if (metro.days) out.days = metro.days.filter(function (d) { return d.start_min < end; });
  return out;
}

// HOW DEEP THE WORDS WOULD STACK IF THEY WERE SPREAD OUT EVENLY.
//
// The question a board cannot answer without solving it is "will the captions
// keep the time under their names". The question it CAN answer is whether
// there is any doubt -- and most of the time there is not.
//
// Total caption width over the axis, per line: a line whose names add up to
// half its rail is a line whose names mostly do not have to share a row, and
// one whose names add up to twice it is a line that has to stack them three
// deep. It is not events per screen, which cannot tell these two apart:
//
//   busy-day  og-landscape  14 captions, 4 lines, 750x441 solver units,  29%
//   busy-day  x-landscape   14 captions, 4 lines, 590x439 solver units, 100%
//
// Same names, same depth, and the SMALLER board has the longer axis -- and is
// the one that loses its times. The framework does not scale its text with
// the panel, so on a small screen the words are wider relative to the board,
// which is what this measures and an area formula cannot.
//
// IT ONLY ANSWERS IN ONE DIRECTION. Measured over the fixtures at every
// lying-down view, every board under 0.27 keeps every one of its time rows,
// nineteen for nineteen. Above it the outcome stops being a fact about the
// board and becomes one about the search -- crew-day at 0.71 keeps all of
// them, busy-day at 0.65 keeps 29% -- so this is a way to know that a board
// is FINE, never that it is doomed. That is enough: it is asked in order to
// skip the work, not to do it.
var CROWD_SAFE = 0.27;
// The most of a panel's own length the legend's column may take.
var GUTTER_MAX = 0.15;
function crowding(spec) {
  var lines = (spec.lines || []).length || 1;
  var axis = spec.axis.a1 - spec.axis.a0;
  if (axis <= 0) return 0;
  var total = 0;
  (spec.wants || []).forEach(function (w) { if (!w.pill) total += w.w || 0; });
  return total / (axis * lines);
}

function specFor(metro, view, opts) {
  opts = opts || {};
  var asked = metro, askedOpts = opts;
  metro = framed(edged(opened(metro)), view, opts);
  var measure = opts.measure || charMeasure(opts.cell, opts.rowH);
  var cell = opts.cell || 7;
  var pad = opts.pad != null ? opts.pad : 10;
  // THE NAMES NO LONGER COST THE DAY A GUTTER.
  //
  // While a line's name sat LEVEL with its rail it had to go beside it, so
  // the axis stopped short of the panel at both ends and the legend took a
  // column at each edge -- on an eight-hundred-wide board that was a fifth of
  // the day spent on two words, and the board paid for it by dropping the
  // TIME off every caption, since the ladder is what gives way when the axis
  // runs short.
  //
  // A name set ABOVE its rail needs no column at all: it lies in the row over
  // the line, inside the map, and the only gutter left is the few pixels the
  // terminal slash reaches past the last minute of the day. The axis gets the
  // rest, which on a TRMNL X is nearly three hundred pixels of afternoon.
  //
  // It is not free -- the name is declared as furniture in that row, so it
  // takes paper a caption might have wanted -- but it takes it where there is
  // most of it (the ends of the day are the quiet part) instead of taking the
  // day's whole width.
  // ...AND IT COSTS ONE, AT ONE END, BECAUSE THE NAMES HAVE NOWHERE ELSE.
  //
  // Set above its rail with no column at all, a name is inside the map, and
  // the map is where the rail's own furniture is: the first minute of a busy
  // line has a ring on it, or a branch climbing out of it, and the name had
  // to dodge. On a real board HOMER sat at the edge, BART forty pixels in and
  // a row up to clear his own Skate Park, MAGGIE somewhere between -- "Bart
  // looks squished here on the left", "we really need to allocate some space
  // to show the labels at the edges properly". A legend that is ragged is a
  // legend the eye has to hunt along.
  //
  // So there is a gutter again, and it is paid for twice over by naming each
  // line ONCE (see `NAMED_ONCE`): the far end kept its own column for a
  // second copy of the same word, and giving that back buys more of the day
  // than this spends. Tight, because the names are set small now -- the
  // widest of them and a hair, not the old name-and-a-half.
  //
  // ...AND ONLY ON A BOARD THAT NEEDS ONE, which is not most of them: "this
  // example didn't [have] the labels [as] issues there. Only when one label
  // has to move, we should gutter." Most days open with every line's first
  // minute clear, every name sits at the paper's edge over its own rail, and
  // a column cut for them there would be a tenth of the day spent on nothing.
  // The board is asked instead of guessed: fit.js solves it once, cheaply,
  // with no gutter, and asks whether any name had to leave the edge -- past
  // a ring, out of a branch, or by dropping its badge. If one did, the spec
  // is rebuilt with the gutter (`regut`) and that is the board. Measured over
  // the fixture matrix, 18 boards of 76 need it.
  // THE WIDEST A NAME MAY BE, on one line: "clamp the track to certain width
  // and only allow 1 line". A share of the panel's own length, so the column
  // a long name would ask for never outgrows the cap below and costs the
  // board its legend; the word that does not fit is cut with an ellipsis
  // rather than wrapped or allowed to push the day along. Never less than a
  // few letters, or a narrow panel names nobody.
  var nameMax = Math.max(Math.round(cell * 5), Math.round((view.w - pad * 2) * NAME_SHARE));
  var nameRoom = opts.nameRoom != null ? opts.nameRoom : Math.round(cell);
  var tookGutter = false, headLead = 0;
  // NO LEGEND COLUMN. The names go back to the paper's edge, above their
  // rails, and the rails run out to the edge under them: a column of paper
  // in front of every line, with a dotted approach across it, was "wasted
  // space" on a board whose whole point is the hours, and the roundel the
  // name is set in now makes it read as the line's own label wherever it
  // stands. What the column bought -- a name clear of the first minute's
  // marks -- the band search still prices (a branch through a name costs).
  // ...EXCEPT STANDING UP, where a name is set beside its rail at the head
  // rather than above it, and a bar crossing the first minutes ran through
  // it ("Lisa" on a five-line half): there the column stays, a row of
  // roundels across the top of the board.
  var LEGEND_COLUMN = !!opts.standing;
  var ringLead = opts.nameRoom == null ? ringRoom(metro, opts) : 0;
  // (a board that opens INSIDE a shared event is the level case below: the
  // names in a column at the head and the connector standing after them)
  if (LEGEND_COLUMN && opts.nameRoom == null && opts.nameGutter) {
    var wName = 0;
    (metro.legend || []).forEach(function (p) {
      wName = Math.max(wName, Math.min(nameMax,
        (opts.nameW && opts.nameW[p.key]) || String(p.name || p.key).length * cell));
    });
    // THE WIDEST WORD AND A HAIR, and nothing for the mark the rail opens
    // with. A ring at the first minute is centred ON the axis and reaches
    // back a radius into the column, so the column was cut to hold that too
    // -- twelve pixels of every board for a mark that is drawn on some lines
    // of some of them, and a name sits in the row BESIDE its rail, not on
    // it: the ring passes under the word rather than through it. Where one
    // really is under a name, bands.js slides that name along the column
    // until it is not, which costs the day nothing. "The column itself is
    // too wide."
    // ...AND NEVER AT THE PRICE OF A PERSON. A column is the same width
    // whatever the panel is, so on a standing half it was a fifth of the
    // day: the board that bought one there dropped a line to pay for it,
    // and a legend nobody is missing from is worth more than a tidy one.
    // Above the cap the names go back to the paper's edge and take their
    // chances with the first minute, which is what every board did before.
    if (wName > 0) {
      // ...AND THE CONNECTOR'S OWN ROOM IS THE FIRST THING THE CAP TAKES
      // BACK. A column that opens with the connector costs its width again,
      // and on a half that was enough to put the whole column over the cap --
      // and a board with no column at all has no escape for a name a branch
      // runs through. So the lead is what goes: the names start at the
      // paper's edge with the connector's rings below them, which is tighter
      // than it looks (a ring is on the rail, a name in the row beside it)
      // and is still a column.
      var room = Math.ceil(wName + Math.max(cell * 0.5, NAME_CLEAR) + 1);
      var lead = ringRoom(metro, opts), cap = (view.w - pad * 2) * GUTTER_MAX;
      if (room + lead <= cap) { nameRoom = room + lead; tookGutter = true; headLead = lead; }
      else if (room <= cap) { nameRoom = room; tookGutter = true; }
    }
  }
  // ...EXCEPT WHERE THERE IS NO ROW ABOVE A RAIL TO SET IT IN. A flat slot
  // five lines deep in two hundred pixels has forty per line, and a name
  // over each rail was written over the next line's name and through its
  // rail. There the names go back beside their rails, level, in a gutter at
  // each end: width is what a flat slot has, and depth is what it has not.
  var legendN = (metro.legend || []).length;
  var nameH0 = opts.nameH != null ? opts.nameH : (opts.rowH || 12) + 6;
  // ...AND WHERE THE BOARD OPENS INSIDE A SHARED EVENT. Set above their
  // rails at the edge, the names had to be shoved along to clear the
  // connector's rings, and the connector itself stood hard on the paper's
  // edge with its spur cramped against it: "I don't like the left part,
  // especially the label position". Level, the roundels make a column at
  // the head and the connector stands at the first minute after them, a
  // bar between labelled stations, which is what a transit map draws.
  var flatSlot = !opts.standing && legendN > 1 && view.h / legendN < nameH0 * 2.6;
  var levelNames = flatSlot || (!opts.standing && legendN > 1 && ringLead > 0);
  // ...AND A NAME IS GIVEN MORE ROOM WHERE IT STANDS OVER ITS RAIL. The
  // share above was cut for a legend column, where every pixel of the
  // widest name comes off the day; a roundel over the rail at the paper's
  // edge costs the map only the caption room over the first minutes, and
  // at a share that held seven letters a nine-letter name was set as its
  // initial on a panel with a day's width to spare ("that's a bit sad").
  if (!LEGEND_COLUMN && !levelNames) nameMax = Math.max(nameMax, Math.round((view.w - pad * 2) * NAME_SHARE_OVER));
  if (levelNames && opts.nameRoom == null) {
    var widest = 0;
    (metro.legend || []).forEach(function (p) {
      widest = Math.max(widest, (opts.nameW && opts.nameW[p.key]) || String(p.name || p.key).length * cell);
    });
    // ...and room for the " +1" a name carries when one of its captions is
    // shed, which is only known once the board is solved: "Sam +1" ran into
    // the first ring.
    // (tight where the column exists only for a connector: the rings stand
    // at the first minute and need no room in it)
    nameRoom = Math.round(widest + cell * (flatSlot ? 2.5 : 1));
    // ...AND THE CLAMP FOLLOWS THE COLUMN THAT WAS CUT FOR IT. The column
    // is measured from the whole names, so a name that fits it was still
    // being cut to its initials by a clamp left at the narrow share: on a
    // board that opens inside a shared event, a nine-letter name came out
    // as a lone "C" beside three neighbours that kept their words. The
    // column is the room, so it is also the limit -- up to the same share
    // a name standing over its own rail gets, past which the column would
    // be eating the day.
    nameMax = Math.max(nameMax, Math.min(widest, Math.round((view.w - pad * 2) * NAME_SHARE_OVER)));
  }
  // ONE NAME A LINE ON A SMALLER VIEW: "quadrant shouldn't show the track
  // labels twice". Both ends is for a board read from across the room; a
  // half or a quadrant is read up close, and the second name was paper the
  // captions needed. The template says which view it is (`oneName`).
  var oneName = !!opts.oneName;
  var axis = { a0: pad + nameRoom, a1: view.w - pad,
               // where the paper ends, for the names that sit at its edge
               edge0: pad, edge1: view.w - pad };
  // A SERVICE ALERT PUSHES THE WHOLE BOARD DOWN.
  //
  // "Calendar feed unreachable", "Forecast may be out of date". It is a
  // statement about whether the map can be trusted, so it goes above the
  // map and not on it -- and it TAKES that room rather than being laid over
  // the top, because a banner drawn across the hour strip hides the one
  // thing every event is measured against. Declared here, in the cross
  // extent itself, so nothing downstream has to know it exists.
  // A caller that SAYS `alert: null` means it: the plugin draws its banner
  // as a sibling of the canvas, so the canvas is already shorter by it, and
  // reading `null` as "not told" fell through to the payload's own alert and
  // took the banner's height a second time as an empty band over the map.
  var alert = opts.alert !== undefined ? opts.alert : (metro.service_alert || null);
  var rowH0 = opts.rowH || 12;
  // (the alert takes no band of its own any more: it is the first row of
  // the box along the foot, with the headlines -- see newsH below)
  var alertH = 0;
  // THE STRIP IS AS DEEP AS WHAT IS IN IT.
  //
  // This was a number the caller passed, and a caller guessing is a caller
  // that gets it wrong on the size that can least afford it: sixty-six
  // pixels of strip on a two-hundred-pixel quadrant is a quarter of the
  // board spent before a single event is drawn, and the board then could not
  // fit the family.
  //
  // It is not a guess -- it is one row for the clock, one more where there
  // is weather to show, one more again where the board spans days and has to
  // name them. Asked rather than assumed, a quadrant gets its quarter back.
  //
  // AND A SMALL PANEL SHOWS LESS OF IT. On a board this size the forecast is
  // the first thing to go: it is a fact about the day rather than about the
  // day's shape, the reader has it elsewhere, and it costs a row that a line
  // could have had.
  var tiny = view.h < 300 || view.w < 460;
  var wantWx = !tiny && ((metro.days || []).some(function (d) {
    return d.weather && d.weather.hi != null;
  }) || (metro.header_weather && metro.header_weather.hi != null));
  var multi = (metro.days || []).length > 1;
  var stripH = rowH0 + 10 + (wantWx || !multi ? rowH0 + 4 : 0)
    + (multi ? rowH0 + 6 : 0);
  // STANDING UP THE STRIP IS A COLUMN, as thick as its widest level label
  // (the clock pill, an hour): the date and the forecast sit at its two ends
  // along the axis rather than in rows across it. The caller measures it.
  if (opts.standing && opts.stripThick > 0) stripH = opts.stripThick;
  // ...AND A ROW FOR THE RAIL UNDER THE HOURS on a lying board: the strip's
  // edge is drawn as a line with the hours as its stations (draw.js), and
  // the labels sit a mark's height above it rather than on it.
  var railRow = !opts.standing ? Math.round(((opts && opts.markR) || 8) * 1.2) : 0;
  stripH += railRow;
  // A BIG PANEL GIVES THE FORECAST TWO ROWS: "you have plenty of room to make
  // the weather stats look nicer for the TRMNL X". The icon two rows tall and
  // the high set large, where a small panel keeps the one-line sentence.
  var richWx = wantWx && !opts.standing && view.w >= 900 && view.h >= 600;
  if (richWx && !multi) stripH += rowH0;
  // ...AND A FULL VIEW GIVES "NOW AND NEXT" A ROW: the title band of today's
  // panel, where draw.js writes what is on and what comes next in words for
  // whoever is walking past. A slot does not spend a row on it.
  var nowCard = !opts.oneName && !opts.standing && view.w >= 700 && view.h >= 400 && metro.now_min != null;
  // Only where the band over the hours is not already two rows deep: a board
  // spanning days has its date row and its forecast row there, and a third
  // row for the card was empty paper over the whole header.
  if (nowCard && stripH - rowH0 - 10 < rowH0 * 1.6) stripH += rowH0;
  // WHAT THE SKY DOES AND WHEN, on its own row under the clock.
  //
  // "Rain starts 13:00", "Sunset". They are not events -- nobody is at them,
  // they belong to no line -- and they are not the forecast either, which is
  // a fact about the whole day. They are moments, so they belong ON the
  // scale, which is what the strip is; and under it rather than on it,
  // because a marker written over an hour tick hides the one thing every
  // event is measured against.
  //
  // Reserved here, in the cross extent, so a caption cannot be placed in the
  // row and then have a marker appear underneath it.
  var skyMarks = !tiny ? (metro.weather || []).filter(function (w) {
    return w && w.at_min != null && w.label
      && w.at_min >= metro.day_start_min && w.at_min <= metro.day_end_min;
  }) : [];
  // ...AND TONIGHT'S MOON, in the same row, the way the rain is ("like the
  // rain icon under the time line"): TRMNL's own phase icon, from the
  // weather set the rest of the sky is drawn in, just past the midnight
  // the night crosses. Its outlined form, so the lit part has an edge. Not
  // in metro.weather, which also says which hours run at full rate: the
  // moon is a mark, not a reason to stretch the night.
  if (!tiny) (metro.days || []).forEach(function (d, i) {
    var mo = i > 0 && metro.days[i - 1].moon;
    if (!mo || d.start_min == null || d.start_min <= metro.day_start_min || d.start_min >= metro.day_end_min) return;
    skyMarks.push({ at_min: d.start_min, label: 'Moon ' + mo.illumination + '%', icon: moonIcon(mo.illumination, mo.waxing), moon: true });
  });
  // ...TOMORROW'S RAIN, which the payload carries on its day's forecast
  // and not in metro.weather (that list is the shown day's), in the same
  // row as today's; and EACH DAY'S SUNSET ("sunset under the time line"):
  // when the light goes, which is when a child's outside ends.
  // AND WHILE IT RAINS, THE ROW RAINS: every start paired with the stop
  // after it in its own day (or the day's end), drawn as a trail of drops
  // between the two glyphs ("rain as a stretch, not a point").
  var rainSpans = [];
  var W0 = metro.day_start_min, W1 = metro.day_end_min;
  if (!tiny) (metro.days || []).forEach(function (d, i) {
    var wx = d.weather || {}, base = d.start_min != null ? d.start_min : i * 1440;
    var ms = (wx.milestones || []).filter(function (m) { return m && typeof m.atMin === 'number'; });
    if (i > 0) ms.forEach(function (m) {
      var at = base + m.atMin;
      if (at > W0 && at < W1) skyMarks.push({ at_min: at, label: m.label, icon: m.icon, kind: m.kind });
    });
    var open = null;
    ms.forEach(function (m) {
      if (m.kind === 'rain_starts' && open == null) open = base + m.atMin;
      else if (m.kind === 'rain_stops' && open != null) { rainSpans.push([open, base + m.atMin]); open = null; }
    });
    if (open != null) rainSpans.push([open, base + 1440]);
    if (typeof wx.sunset_min === 'number') {
      var ss = base + wx.sunset_min;
      if (ss > W0 && ss < W1) skyMarks.push({ at_min: ss, label: ((metro.i18n || {}).sunset || 'Sunset') + ' ' + ('0' + Math.floor((ss % 1440) / 60)).slice(-2) + ':' + ('0' + ss % 60).slice(-2), icon: 'https://trmnl.com/images/plugins/weather/wi-sunset.svg', sunset: true });
    }
  });
  rainSpans = rainSpans.map(function (r) { return [Math.max(W0, r[0]), Math.min(W1, r[1])]; })
    .filter(function (r) { return r[1] - r[0] >= 30; });
  // ...AND WHERE THE DROPS FALL, THE GLYPHS THAT SAID SO GO ("the raincloud
  // and the sun aren't really needed as beginning and end of the rain
  // period, the droplets indicate the same"): the trail already says when it
  // starts and when it stops. A rain mark whose stretch was too short to
  // draw keeps its glyph, since then nothing else says it.
  skyMarks = skyMarks.filter(function (w) {
    if (w.kind !== 'rain_starts' && w.kind !== 'rain_stops') return true;
    return !rainSpans.some(function (r) {
      return Math.abs(r[0] - w.at_min) < 1 || Math.abs(r[1] - w.at_min) < 1;
    });
  });
  skyMarks.sort(function (p, q) { return p.at_min - q.at_min; });
  // THE ROW IS THE WEATHER'S. A moon and a sunset alone do not buy a row
  // across the whole board: it cost an evening board the times under every
  // caption. Without rain or storms to share it, each stands in its own
  // small box at the top of the map, booked like any fixed thing, and costs
  // only that.
  var skyH = skyMarks.some(function (w) { return !w.moon && !w.sunset; }) || rainSpans.length ? rowH0 + 6 : 0;
  // THE PLATFORM DISPLAY along the foot of the map: a row per headline, as
  // many as the panel can spare up to the setting, one on a small panel,
  // none standing up (a band across a standing board's foot would cut the
  // hours, not the cross axis). Reserved here, off the cross extent, so
  // the rails end above it and nothing is drawn under it.
  // ...AND THE WEATHER ALERT IS ITS FIRST ROW ("can weather alert combine
  // with news alerts?"): one box at the foot, the alert above the
  // headlines, on a standing board too, where it comes off the axis
  // instead. A long translation wraps on a slot, so the alert has two rows
  // there.
  var newsIn = metro.news && metro.news.items && metro.news.items.length ? metro.news : null;
  var footAlert = alert ? (tiny && String(alert.text || '').length > 28 ? 2 : 1) : 0;
  // WHAT IS STILL OWED. A task with no time on the board is not a stop
  // (rule 2q). One person's own waits under their name at the head of their
  // own track, where the head already says what their day is; one the WHOLE
  // HOUSEHOLD owes belongs to nobody's track, so it takes a row of the
  // platform display above the headlines ("it needs to be per track, unless
  // they are family events"). That row is taken from the news, not from the
  // map: what the household owes outranks what the world is doing.
  var legendKeys = (metro.legend || []).map(function (l) { return l.key; });
  var owedAll = (metro.tasks || []).filter(function (t) { return t && t.title; });
  var isFamily = function (t) {
    return legendKeys.length > 1 && legendKeys.every(function (k) { return (t.owners || []).indexOf(k) >= 0; });
  };
  var taskIn = owedAll.filter(isFamily);
  var ownTasks = owedAll.filter(function (t) { return !isFamily(t); });
  var taskRows = taskIn.length ? 1 : 0;
  var newsRows = 0;
  if (newsIn) {
    var newsMax = newsIn.fit ? 1 : Math.max(1, Math.min(5, newsIn.max || 3));
    newsRows = Math.min(newsIn.items.length, tiny ? 1 : view.h >= 600 ? newsMax : Math.min(newsMax, 2));
    // ...AND THE TASKS TAKE THEIR ROW FROM THE NEWS, not from the map ("the
    // news should drop"): what the household owes outranks what the world
    // is doing, and a box that grew a row for each cost the map its depth.
    newsRows = Math.max(0, newsRows - taskRows);
  }
  function footHeight(nr, tr, ar) {
    var t = tr == null ? taskRows : tr;
    var a = ar == null ? footAlert : ar;
    // (a row of the box is set in the alert's own type now, so it is
    // deeper than a row of small print was -- but only just: set to the
    // old spacing as well the rows stood far apart, "too much of a gap
    // between the lines")
    return (a || nr || t) ? Math.round((a + nr + t) * rowH0 * 1.45 + 6) : 0;
  }
  // THE TRACKS COME FIRST ("does the calendar tracks always come first?"):
  // the headlines give up rows until every line keeps two and a half
  // names' depth of map, a little more than a flat slot's.
  // THE TRACKS STILL COME FIRST: the headlines give up their rows, and
  // then the tasks give up theirs, before the map gives up a name's depth.
  // ...AND THE ALERT GIVES UP ITS ROW LAST, BUT IT DOES GIVE IT UP ("we
  // should show user content over alert and news at all times"). It used
  // to keep its row whatever it cost, on the grounds that it says whether
  // the map can be trusted -- but the thing it is protecting is the map,
  // and a board that dropped a person to keep a line about rain has
  // spent the household to say the weather. The order is the order of
  // whose day it is: the headlines are the world's, the tasks are the
  // household's, the alert is the sky's, and the map is these people's.
  // (...EXCEPT AN ALERT ABOUT THE BOARD ITSELF. A weather line is about the
  // day and can wait for a smaller panel; "this calendar has not answered
  // since Tuesday" is about whether anything on the map is true, and a
  // board that hides THAT to fit another track is lying more quietly than
  // one that shows an empty rail. It is the one row that holds.)
  var alertHolds = !!(alert && alert.kind === 'feed');
  if (!opts.standing) {
    var roomy = function () { return (view.h - pad - stripH - skyH - footHeight(newsRows, null, footAlert)) / Math.max(1, legendN) >= nameH0 * 2.4; };
    while (newsRows > 0 && !roomy()) newsRows--;
    while (taskRows > 0 && !roomy()) taskRows--;
    // ...AND THE ALERT KEEPS ITS ROW HERE. This loop is about map DEPTH,
    // and on a panel that never satisfies it -- a quadrant, where a line
    // has barely a name's depth whatever the foot does -- an alert that
    // gave way here gave way on every small board, which is not "the map
    // came first", it is "the weather is never said". The alert gives way
    // only where it would otherwise cost a PERSON, which fit.js decides
    // and asks for through `refoot` below.
  }
  // ...AND THE FOOT GIVES UP ANOTHER ROW WHENEVER ASKED ("we should show
  // user content over alert and news at all times"). The loop above keeps
  // every line a depth of map; this is the board saying it is about to
  // leave somebody out, and the foot answering before it does. The world
  // goes first, then the household's chores, then the sky.
  var footTrim = (opts && opts.footTrim) || 0;
  for (var ft = 0; ft < footTrim; ft++) {
    if (newsRows) newsRows--;
    else if (taskRows) taskRows--;
    else if (footAlert && !alertHolds) footAlert--;
    else break;
  }
  var footRows = newsRows + taskRows + (alertHolds ? 0 : footAlert);
  var newsH = footHeight(newsRows);
  // (flush against the box where there is one, the paper's own edge inset
  // where there is not: "no space between the train schedule and its own
  // box")
  var cross = { c0: (opts.bandLo != null ? opts.bandLo : stripH) + alertH + skyH,
                c1: view.h - (opts.standing || !newsH ? pad : newsH) };
  if (opts.standing && newsH) { axis.a1 -= newsH; if (axis.edge1 != null) axis.edge1 -= newsH; }
  opts = Object.assign({}, opts, { showWeather: wantWx, stripH: stripH, richWx: richWx, levelNames: levelNames,
                                   skyH: skyH, sky: skyMarks, rain: rainSpans, railRow: railRow, tiny: tiny,
                                   tasks: ownTasks });
  var scale = scaleFor({ from: metro.day_start_min, to: metro.day_end_min,
                         a0: axis.a0, a1: axis.a1,
                         // Off by asking, so a caller that wants the plain
                         // linear day can have it and the cases that reason
                         // about pixels per minute still can.
                         segments: opts.evenTime ? null : segmentsFor(metro) });
  var got = wantsFrom(metro, scale, measure, opts);
  var states = statesFor(metro);
  opts = Object.assign({}, opts, { states: states, gutter: tookGutter, headLead: headLead, nameMax: nameMax });
  got.wants.sort(function (p, q) { return p.a0 - q.a0; });
  var lines = linesFrom(metro);
  // WHERE ONE DAY ENDS AND THE NEXT BEGINS, on the axis: a name may not
  // cross it, and may not stand on the other side of it from its event.
  var cuts = (metro.days || []).slice(1).map(function (d) { return scale.at(d.start_min); })
    .filter(function (a) { return a > axis.a0 && a < axis.a1; });
  return { axis: axis, cross: cross, lines: lines, cuts: cuts, states: states,
           wants: got.wants, pills: got.pills, scale: scale, metro: metro,
           // WHAT THIS PANEL CAN HOLD, carried on the spec so that `fit` can
           // read it without being handed the view. See frameFor.
           tracks: frameFor(view, opts).tracks, oneName: oneName,
           // WHETHER THE LEGEND TOOK ITS COLUMN, and how to ask for one. A
           // spec that has not spent the gutter can be rebuilt as the same
           // board with it, which is how the decision is made (see fit.js):
           // solve, look at where the names landed, and buy the column only
           // for a board whose names could not stay at the edge without it.
           // how deep the sky row inside the strip is, so the drawing can
           // keep the hours above it (fixedFor puts the rail under both)
           skyH: skyH,
           nameGutter: tookGutter,
           // HOW MUCH DEPTH EACH LINE HAS, which is what decides whether a
           // caption can afford to hold its time row and whether the search
           // can afford to argue about where a caption sits (measure-dom
           // `keepTime`, bands `driftPrice`).
           roomy: (cross.c1 - cross.c0) / Math.max(1, legendN) >= nameH0 * 4,
           regut: opts.nameRoom != null || opts.nameGutter ? null : function () {
             return specFor(asked, view, Object.assign({}, askedOpts, { nameGutter: true }));
           },
           // ...AND THE SAME DOOR FOR THE FOOT: one row shorter, so the map
           // has a band more to work in. `fit` knocks on it before it drops
           // a person, which is the whole point of the order: the map is
           // these people's day and the foot is everybody else's.
           refoot: footRows > 0 ? function () {
             return specFor(asked, view, Object.assign({}, askedOpts, { footTrim: footTrim + 1 }));
           } : null,
           // What a drawn mark reaches and how a corner rounds, at this panel's
           // scale: the two numbers the solver and the renderer must agree
           // on. They were passed in and never copied here, so the solver
           // booked a mark's radius of eight on a panel drawing twelve.
           markR: opts && opts.markR != null ? opts.markR : undefined,
           corner: opts && opts.corner != null ? opts.corner : undefined,
           // ...AND WHAT AN EDGE RING REACHES PAST THE FIRST MINUTE, which is
           // the third. A line whose day opened inside a shared event is drawn
           // with a ring on its rail's start, and its name has to be booked
           // clear of that ring rather than moved clear of it afterwards.
           // `Draw.edgeRing` is where the number is (draw.js).
           edgeRing: opts && opts.edgeRing != null ? opts.edgeRing : undefined,
           edgeRingR: opts && opts.edgeRingR != null ? opts.edgeRingR : undefined,
           railRow: opts && opts.railRow != null ? opts.railRow : 0,
           // THE HEADLINES' BAND: rows and depth, at the foot of the map.
           news: newsH ? { rows: newsRows, alertRows: footAlert, h: newsH, items: newsIn ? newsIn.items : [], fit: !!(newsIn && newsIn.fit),
                           taskRows: taskRows, tasks: taskRows ? taskIn : [] } : null,
           // THE BOARD'S OWN INK, DECLARED BEFORE THE SOLVE. See Furniture.
           // Everything here takes paper and cannot move, so the caption
           // search has to be told about it up front rather than have it
           // appear underneath the words afterwards.
           alert: alert,
           // HOW TALL A LINE'S NAME IS, measured where it can be and stated
           // where it cannot. The solver reserves a band of this depth at
           // each end of every rail; left at its own default -- fourteen
           // pixels, from nowhere -- a seven-line board handed out gaps of
           // nineteen, which fit the number and not the words, and the names
           // of three people were written over each other on a board the
           // checker called clean.
           nameH: opts.nameH != null ? opts.nameH : rowH0 + 6,
           fixed: fixedFor(metro, scale, axis, cross, opts) };
}

// A LINE IS NAMED AT ITS OWN END.
//
// A reader who does not know whose line is whose has no map at all, so the
// names are not decoration and they are not optional: they are the legend,
// and putting them at the end of each rail is what a transit map does
// instead of a key in the corner.
//
// They sit in the gutter past the last minute of the day, which is why the
// axis stops short of the panel edge. Declared as furniture so a caption
// cannot be placed there -- in the engine this replaces they were placed
// last, against a board that was already full, and a line's own name was
// regularly the thing that had nowhere to go.
// THE COLUMN OPENS WITH THE CONNECTOR, where the board has one.
//
// A shared event that was already running when the board opened is drawn as
// a connector standing in the column -- rings on each member's rail at the
// paper's edge, a bar joining them, and a dotted approach from there to the
// first minute (draw.js). The names start after it: written from the paper's
// edge they were laid across the rings, a row of words on a row of marks.
// A board with nothing already running when it opens has no connector at the
// edge and pays nothing for one. What draws it is a tie, and a tie is a
// shared event, so that is what is asked.
function ringRoom(metro, opts) {
  var lo = metro.day_start_min;
  var any = (metro.events || []).some(function (ev) {
    if (ev.type && ev.type !== 'event') return false;
    if (!((ev.co_owners || []).length)) return false;
    return ev.start_min < lo && ev.end_min > lo;
  });
  if (!any) return 0;
  // the ring's own width, and the step the approach's first dot takes
  var r = (opts && opts.edgeRingR) || (opts && opts.markR) || 8;
  return Math.round(r * 2 + 2);
}

// A few pixels clear of the caption that ends against it: measured flush,
// "Moe's Tavern" standing up ran six pixels into "Homer" on the panel. The
// gutter is cut to hold it (see nameRoom), so the widest name plus this is
// what a line's name is given, and the first ring stands clear of the word.
var NAME_CLEAR = 4;
// The share of a panel's length a line's name may take before it is cut:
// in a legend column, and set over its own rail (see nameMax, specFor).
var NAME_SHARE = 0.12;
var NAME_SHARE_OVER = 0.22;

// A BADGE'S WORDS ON AT MOST TWO LINES of `maxW`, broken at a space and
// never leaving the separator stranded: "Ship Inspection · Wed" becomes
// "Ship Inspection" over "Wed", not "Ship Inspection ·" over "Wed". What
// does not fit on the second line is cut with an ellipsis. Widths are
// counted in characters, the same estimate the badge was always booked by.
function wrapTwo(text, maxW, widthOf) {
  // Two states are two lines, each whole, where each fits: "Night Shift ·
  // Sat" over "Half Term · Sun" rather than a break in the middle of one.
  // ...AND ONE STATE ON ONE DAY IS WHAT IT IS OVER WHEN: "Ship Inspection"
  // over "Wed". The break the words already have is the one a reader
  // expects, and it keeps each line to the width of its own part rather
  // than whatever a greedy wrap happened to leave behind.
  var states = String(text).split(', ');
  var parts = states.length === 2 ? states
    : (states.length === 1 && String(text).indexOf(' \u00b7 ') > 0 ? String(text).split(' \u00b7 ') : null);
  if (parts && parts.length === 2) {
    return parts.map(function (l) {
      if (widthOf(l) <= maxW) return l;
      var cut = l;
      while (cut.length > 1 && widthOf(cut + '\u2026') > maxW) cut = cut.slice(0, -1);
      return cut.replace(/\s+$/, '') + '\u2026';
    });
  }
  var words = String(text).split(' ').filter(Boolean);
  var lines = [''];
  words.forEach(function (w) {
    var cur = lines[lines.length - 1];
    var next = cur ? cur + ' ' + w : w;
    if (widthOf(next) <= maxW || !cur || lines.length === 2) lines[lines.length - 1] = next;
    else lines.push(w);
  });
  lines = lines.map(function (l, i) {
    return i === 0 ? l.replace(/\s*[·,]$/, '') : l.replace(/^[·,]\s*/, '');
  }).filter(Boolean);
  // ...and a line still too long is cut, a letter at a time, with an ellipsis
  lines = lines.map(function (l) {
    if (widthOf(l) <= maxW) return l;
    var cut = l;
    while (cut.length > 1 && widthOf(cut + '\u2026') > maxW) cut = cut.slice(0, -1);
    return cut.replace(/\s+$/, '') + '\u2026';
  });
  return lines.slice(0, 2);
}
function fixedFor(metro, scale, axis, cross, opts) {
  // Whether the legend has a column of its own, which decides where in it a
  // name sits (see the head names below).
  var gutter = !!(opts && opts.gutter);
  var out = [];
  var rowH = (opts && opts.rowH) || 12;
  var cell = (opts && opts.cell) || 7;
  // The hour strip, across the top, above every band.
  // The strip, and on a multi-day board the day names above it.
  var hasWx = ((metro.days || []).some(function (d) { return d.weather && d.weather.hi != null; })
    || (metro.header_weather && metro.header_weather.hi != null)) ? rowH + 4 : 0;
  var deep = ((metro.days || []).length > 1 ? rowH + 14 : 0) + hasWx;
  // The sky markers take the row immediately above the map, so everything
  // else on the strip is measured from the top of THAT rather than from the
  // first band. See specFor: the room is already reserved.
  var skyH = (opts && opts.skyH) || 0;
  var lip = cross.c0 - skyH;
  // ...and the rows of words on the strip sit a rail's row above its foot
  var lipRows = lip - ((opts && opts.railRow) || 0);
  out.push({ id: 'hours', kind: 'hours', a0: axis.a0, a1: axis.a1,
             c0: lipRows - rowH - 8 - deep, c1: lip - 2, text: 'hours' });
  // ...AND THE MOMENTS THE SKY CHANGES, in it.
  //
  // Each one keeps its place on the scale and gives way along it: two
  // markers whose words would run into each other are two statements written
  // over one another, and the later one is the one that goes. Its own time is
  // already in the words ("Rain starts 13:00"), so nothing is lost but the
  // one that could not be read anyway.
  // WHO GIVES WAY: the weather first (rain, storms, snow change what you
  // take with you), then the moon, then the sunset; each keeps its minute
  // and is dropped where a more important glyph already has the room,
  // rather than the later one going whatever it was.
  var skyList = ((opts && opts.sky) || []).map(function (w, i) {
    return { w: w, i: i, rank: w.sunset ? 2 : w.moon ? 1 : 0 };
  }).sort(function (p, q) { return p.rank - q.rank || p.w.at_min - q.w.at_min; });
  var skyTaken = [];
  skyList.forEach(function (sk) {
    var w = sk.w, i = sk.i;
    var at = scale.at(w.at_min);
    // Room for the glyph in front of the words, which the drawing puts there.
    // THE GLYPH ALONE, CENTRED ON ITS MINUTE: "remove the storm text and just
    // have the icon on the correct position". The words set it off its
    // minute and into the next day; the icon says what, the scale says when.
    var wide = rowH + 4;
    at = at - wide / 2;
    // NEVER INTO THE NEXT DAY. "Storms 20:00" started at its minute and ran
    // on past the midnight into Tuesday's half of the board: a marker is set
    // back from the end of its own day until it fits, and dropped where the
    // day has no room for it at all.
    // (the moon belongs to the midnight itself, "on 12 midnight", and
    // stands centred on it, half in each day)
    var dayEndMin = (Math.floor(w.at_min / 1440) + 1) * 1440;
    var dayEndA = w.moon ? axis.a1 : dayEndMin < metro.day_end_min ? scale.at(dayEndMin) - 4 : axis.a1;
    var dayStartA = w.moon ? axis.a0 : Math.max(axis.a0, scale.at(Math.max(metro.day_start_min, dayEndMin - 1440)));
    var want = Math.max(dayStartA, Math.min(at, dayEndA - wide));
    if (want + wide > dayEndA + 0.5) return;
    // TWO GLYPHS ON ONE MINUTE STAND SIDE BY SIDE ("a solution when there's
    // a weather event at the same time"): the one that gives way moves to
    // the nearer side of what is already there, snug against it, and only
    // goes where neither side is inside its own day.
    var clash = function (x) { return skyTaken.some(function (t) { return x < t[1] + cell && t[0] < x + wide + cell; }); };
    var tries = [want];
    skyTaken.forEach(function (t) { tries.push(t[1] + cell, t[0] - cell - wide); });
    var a0 = null;
    // (a glyph moved off its minute keeps off the clock's line as well)
    var nowA = metro.now_min != null ? scale.at(metro.now_min) : null;
    var onNow = function (x) { return x !== want && nowA != null && nowA > x - 3 && nowA < x + wide + 3; };
    tries.filter(function (x) { return x >= dayStartA - 0.5 && x + wide <= dayEndA + 0.5 && !clash(x) && !onNow(x); })
      .sort(function (p, q) { return Math.abs(p - want) - Math.abs(q - want); })
      .slice(0, 1).forEach(function (x) { a0 = x; });
    if (a0 == null || Math.abs(a0 - want) > wide * 2.5) return;
    skyTaken.push([a0, a0 + wide]);
    out.push({ id: 'sky' + i, kind: 'sky', text: w.label, icon: w.icon, at: at, min: w.at_min,
               a0: a0, a1: a0 + wide,
               c0: skyH ? lip + 2 : cross.c0 + 2, c1: skyH ? cross.c0 - 2 : cross.c0 + rowH + 6 });
  });
  // ...and the rain between its glyphs, in the same row
  ((opts && opts.rain) || []).forEach(function (r, i) {
    var r0 = scale.at(r[0]), r1 = scale.at(r[1]);
    if (r1 - r0 < rowH) return;
    out.push({ id: 'rain' + i, kind: 'rain', text: 'rain', min: r[0], a0: r0, a1: r1, c0: lip + 2, c1: cross.c0 - 2 });
  });
  // NAMED AT BOTH ENDS. A reader comes to the board from whichever side they
  // are standing on, and a name only on the right is a name half of them
  // have to hunt for. It is also what a transit map does: the line is
  // labelled where it leaves the diagram, at both edges.
  // AS WIDE AS THE NAME REALLY IS. Counted in characters it is an estimate,
  // and an estimate that runs short is paper the caption search hands to
  // somebody else: "Sam" booked twenty-seven pixels and drew thirty-five,
  // and "School Run" was placed in the difference. The plugin measures every
  // name with the same ruler it measures captions with and passes them in;
  // a caller without a ruler still gets the character count.
  var wide = (opts && opts.nameW) || {};
  // Room for a name and a row under it, on every line the board carries.
  var nameH1 = (opts && opts.nameH) || (rowH + 6);
  var deepEnough = (cross.c1 - cross.c0) / Math.max(1, (metro.legend || []).length) >= nameH1 * 2 + 6;
  // A NAME THAT WILL NOT FIT IS ITS LETTERS. Cut with an ellipsis, "Maggie"
  // and "Marge" on a quadrant were both "M...", which names nobody; the
  // letters the rings already carry (MG, MR) fit in a third of the room
  // and say who it is.
  var letters = B.initialsFor(metro.legend || []);
  (metro.legend || []).forEach(function (p) {
    var nameMax = (opts && opts.nameMax) || Infinity;
    var t = p.name || p.key;
    var tw = wide[p.key] || t.length * cell;
    // (the letters' own width, with the roundel's inset round them)
    if (tw > nameMax && letters[p.key]) { t = letters[p.key]; tw = Math.round(t.length * cell * 1.2) + 16; }
    var w = Math.min(nameMax, tw);
    // INSIDE THE MAP AND ABOVE THE RAIL, reading INWARD from each edge, so
    // the words are over the line they name and the last minute of the day is
    // still on the board. `at` says which end of the rail to take the level
    // from; it cannot be read off the alignment, because both names now start
    // at an edge and lean the other way.
    // AT THE EDGE OF THE PAPER, not at the first minute: the name sits a row
    // above the rail's end, so it may stand over the terminal slash, and at
    // the edge it is out of the way of the first and last events.
    var e0 = axis.edge0 != null ? axis.edge0 : axis.a0, e1 = axis.edge1 != null ? axis.edge1 : axis.a1;
    var lv = !!(opts && opts.levelNames);
    // THE ROUTE ROW: what this line IS today, under what it is called. A
    // state that only starts on a later day is named at the far end, where
    // that day is: "Away in Leeds · Tue" at the left was read as tonight's.
    // ONCE PER LINE, AT THE END A READER COMES TO FIRST.
    //
    // Both ends was for a board read from across a room from either side, and
    // it cost a column at each edge to say the same word twice. The left one
    // is the one that is read: it is where the day starts, where the eye
    // lands, and where the legend belongs. The right-hand column goes back to
    // the day -- which is what pays for the gutter the left-hand names now
    // sit in (see nameRoom), with change.
    //
    // Not `oneName`, which is a statement about a SLOT being small and also
    // turns off the ring letters and the now-and-next card. This is about
    // where a legend goes.
    var one = true;
    // ...AND NOT AT ALL ON A PANEL WITH NO ROOM FOR TWO ROWS. A name with a
    // route row under it is twice as deep, and a flat slot five lines deep in
    // a hundred and sixty pixels has thirty for each of them: the second row
    // was drawn across the line below ("Daan" with the next rail through it),
    // and the band search cannot mend that -- kept off the rail it landed on
    // the next name instead. Withheld here, the board never sees the taller
    // box, and what the line is today is said by the band behind the rail.
    var routes = deepEnough ? routeRows((opts && opts.states) || [], p.key, one) : [null, null];
    var rw1 = routes[1] ? routes[1].length * cell * 0.85 + rowH : 0;
    if (!one) out.push({ id: 'name:' + p.key, kind: 'terminus', line: p.key, text: t, level: lv,
               route: routes[1], rows: routes[1] ? 2 : 1, nameW: w + NAME_CLEAR,
               align: 'right', at: axis.a1, a0: e1 - Math.max(w, rw1) - NAME_CLEAR, a1: e1,
               c0: 0, c1: 0 });   // c is filled in once the bands are solved
    // THE BADGE ON TWO LINES AT MOST, as narrow as the name above it: "all
    // day events should split onto 2 lines". On one line "Ship Inspection ·
    // Wed" ran a hundred and fifty pixels out of the column into the
    // morning; wrapped to the width a name is allowed, it stays over its own
    // line. The break is chosen here, once, and the drawing sets exactly
    // these lines, so what is booked is what is drawn.
    // MEASURED, where the caller can measure: counted in characters the
    // badge's small type came out nearly twice as wide as it is drawn, and
    // "Ship Inspection · Wed" was cut to "Ship Inspecti…" in a column with
    // room for all of it. The character count is what a caller with no
    // ruler still gets.
    // (the badge's ring is twelve units and a small gap, not a row)
    var charW = cell * 0.85, iconW = Math.round(cell * 1.5);
    var routeWidth = (opts && typeof opts.routeW === 'function') ? opts.routeW
      : function (x) { return String(x).length * charW; };
    // TWO LINES WHERE ONE WOULD LEAVE THE COLUMN. A second line is a second
    // row on that line's head, and a row is paper the bands need: split on
    // every board, the households lost two people to it. So a badge that
    // fits in the legend's column stays one line, and one that would run out
    // of it past the first minute is split at its own break and kept there.
    var headAt = e0 + ((opts && opts.headLead) || 0);
    var wrapW = isFinite(nameMax) ? nameMax : routeWidth(routes[0] || '');
    // ...and only where there IS a column to leave. On a board with none the
    // badge is in the map above its rail like every other word, where one
    // line is what it always was.
    var colW = (opts && opts.gutter) ? axis.a0 - NAME_CLEAR - headAt : Infinity;
    var routeLines = null;
    if (routes[0]) {
      routeLines = routeWidth(routes[0]) + iconW <= Math.max(colW, charW * 4) ? [routes[0]]
        : wrapTwo(routes[0], Math.max(charW * 4, wrapW - iconW), routeWidth);
      // ...AND ONLY IF THE TWO LINES SAY IT. On a small panel the column is
      // narrow enough that each half was cut to a few letters -- "Verj…" over
      // "Thui…" -- and the extra row put two names on top of each other. A
      // split that has to cut is a split that lost the words, so there the
      // badge keeps its one line, as it always had.
      if (routeLines.length > 1 && routeLines.some(function (l) { return /\u2026$/.test(l); })) {
        routeLines = [routes[0]];
      }
    }
    var rw = routeLines ? Math.max.apply(null, routeLines.map(routeWidth)) + iconW : 0;
    // ALL FROM THE PAPER'S EDGE: "align all the track names to the left".
    //
    // Flush against the first minute was tried -- the words hugging their own
    // rails, the slack at the paper's edge -- and a column of words that all
    // START together is the one that reads as a legend: the eye runs down one
    // edge rather than down a ragged one, and what fills the space between a
    // short name and its rail is the line's own dotted approach (draw.js),
    // which is a thing worth drawing rather than a gap worth closing.
    // Past the connector that opens the column, where the column was cut
    // wide enough to hold both. Otherwise at the paper's edge, as always.
    var head = headAt;
    // WHAT THIS PERSON STILL OWES, UNDER THEIR NAME ("it needs to be per
    // track"): a row each, beyond the badge, where the head already says
    // what their day is. A tick box and the words, no more than the
    // setting allows (rule 2q).
    var owed = ((opts && opts.tasks) || []).filter(function (tk) {
      return (tk.owners || []).indexOf(p.key) >= 0;
    });
    // As wide as the longest of them really is, with a hair for the face
    // the ruler cannot know, and never more than a fifth of the day: the
    // words are clamped to this, so a booking that runs short cuts a chore
    // nobody asked it to cut.
    var boxW = Math.round(cell * 1.5), owedCap = Math.round((axis.a1 - axis.a0) * 0.2);
    var owedW = owed.reduce(function (acc, tk) {
      return Math.max(acc, Math.min(owedCap, boxW + Math.round(routeWidth(tk.title) * 1.3) + cell));
    }, 0);
    out.push({ id: 'name0:' + p.key, kind: 'terminus', line: p.key, text: t, level: lv,
               route: routes[0], routeLines: routeLines, nameMax: isFinite(nameMax) ? nameMax : null,
               rows: routeLines ? 1 + routeLines.length : 1,
               nameW: w + NAME_CLEAR, routeW: rw,
               at: axis.a0, a0: head, a1: head + Math.max(w, rw) + NAME_CLEAR,
               c0: 0, c1: 0 });
    // ...AND WHAT IS OWED IN ITS OWN BOX, across the rail from the name
    // (bands.js puts it on the other side): the name keeps the place it
    // always had.
    if (owed.length) {
      out.push({ id: 'task:' + p.key, kind: 'terminus', line: p.key, text: '', level: lv,
                 tasks: owed, rows: owed.length, nameW: owedW + NAME_CLEAR,
                 at: axis.a0, a0: head, a1: head + owedW + NAME_CLEAR, c0: 0, c1: 0 });
    }
  });

  // THE BAND'S NAME, at the start of the hours it covers: a desk booking is
  // drawn as a light band behind the rail for its hours (draw.js), and named
  // once, small, where it begins -- clear of the line's own name at the edge.
  ((opts && opts.states) || []).forEach(function (st, si) {
    if (!st.timed || st.from == null) return;
    var from = Math.max(st.from, metro.day_start_min), to = Math.min(st.to, metro.day_end_min);
    if (!(to > from)) return;
    var key = st.owners[0], at = scale.at(from), headEnd = axis.a0;
    out.forEach(function (f) { if (f.kind === 'terminus' && f.line === key && f.at === axis.a0) headEnd = Math.max(headEnd, f.a1); });
    var bw = st.title.length * cell * (opts && opts.oneName ? 0.85 : 1.05) + 6;
    var a0 = Math.max(at + 4, headEnd + cell);
    if (a0 + bw > Math.min(scale.at(to), axis.a1)) return;
    out.push({ id: 'band:' + si, kind: 'bandname', line: key, text: st.title, at: at,
               a0: a0, a1: a0 + bw, c0: 0, c1: 0, bandEnd: Math.min(scale.at(to), axis.a1) });
  });

  // WHICH DAY THIS IS.
  //
  // A board showing one day says the time everywhere and the date nowhere,
  // which is fine on a wall you walk past every morning and no use at all to
  // anyone else. A board showing several already names each one at its own
  // boundary; this is the single-day case, and it goes at the start of the
  // strip where a reader looks first.
  if (!(metro.days || []).length || metro.days.length === 1) {
    var dl = metro.date_label || (metro.days && metro.days[0] && metro.days[0].date_label);
    if (dl) {
      // AT THE PAPER'S EDGE, NOT AT THE FIRST MINUTE. The date is a fact
      // about the whole panel and it sits in the strip, which runs the
      // paper's width; declared at the axis it stepped in by the legend's
      // whole column and the holiday beside it ran out of room.
      out.push({ id: 'date', kind: 'date', text: dl, align: 'left',
                 a0: axis.edge0 != null ? axis.edge0 : axis.a0,
                 a1: (axis.edge0 != null ? axis.edge0 : axis.a0) + dl.length * cell,
                 c0: lipRows - rowH * 2 - 10, c1: lipRows - rowH - 10 });
    }
  } else {
    // EACH DAY NAMED WHERE IT BEGINS, in the row the strip keeps for it
    // above the forecast: a two-day board with no date on it at all was
    // the first thing seen on the device -- "header shows no date when it
    // should show 2 days."
    var dc1 = lipRows - rowH - 10 - hasWx, dc0 = dc1 - rowH;
    metro.days.forEach(function (d, di) {
      var t = d.date_label;
      if (!t) return;
      var at = scale.at(Math.max(d.start_min, metro.day_start_min));
      if (at >= axis.a1 - t.length * cell) return;
      out.push({ id: 'date' + di, kind: 'date', text: t, align: 'left',
                 a0: at, a1: at + t.length * cell, c0: dc0, c1: dc1 });
    });
  }

  // NOW, AS A LINE STRAIGHT DOWN THE BOARD.
  //
  // The single most useful mark on a day planner and the cheapest to draw:
  // everything left of it has happened. It is thin, so it takes almost no
  // paper, but it takes it all the way down -- and a caption sitting on it
  // would hide the one thing the reader looks for first, so it is declared
  // rather than drawn over.
  if (metro.now_min != null && metro.now_min >= metro.day_start_min
      && metro.now_min <= metro.day_end_min) {
    var nx = scale.at(metro.now_min);
    out.push({ id: 'now', kind: 'now', a0: nx - 3, a1: nx + 3,
               c0: cross.c0, c1: cross.c1, text: 'now' });
  }

  // WHAT IS OFF THE ENDS. A window that starts at six shows nothing of the
  // night, and a board that simply omits an event is a board that lies by
  // silence. The count goes at the end it fell off, so "+2 earlier" reads as
  // the day continuing past the edge rather than as a note about nothing.
  // "+N EARLIER" AND "+N MORE" ARE ABOUT THE DAY THE BOARD IS ON.
  //
  // They say the day continues past the edge of the paper, which is only
  // true within a day: tomorrow is not "more", it is another day, and it has
  // its own date badge to say so. The payload carries both days now, so
  // unbounded this counted Tuesday's twelve entries as nine more things
  // tonight, on a board that already ran to the end of Monday -- "why does it
  // say 9 more at the bottom? isn't that end of the day."
  //
  // Bounded by the midnights either side of the drawn span: what is off the
  // right-hand edge and still today, and what is off the left and still
  // today.
  var lastMid = Math.floor(metro.day_end_min / 1440) * 1440 + 1440;
  var firstMid = Math.floor(metro.day_start_min / 1440) * 1440;
  var early = 0, late = 0;
  (metro.events || []).forEach(function (ev) {
    if (ev.type && ev.type !== 'event') return;
    if (ev.end_min <= metro.day_start_min && ev.end_min >= firstMid) early++;
    else if (ev.start_min >= metro.day_end_min && ev.start_min < lastMid) late++;
  });
  var i18n = metro.i18n || {};
  // ON THE STRIP, AT ITS OWN END: "we can have +earlier & +more in the
  // header". The day continuing past the paper is a fact about the scale, so
  // it is written on the scale, among the hours, and the map gets back the
  // row along its bottom edge it used to give up for two words.
  // NOT "+N EARLIER". What is over is over: the wash over the past says the
  // day began before the paper, and a count of things nobody can attend any
  // more is the one note on the strip a reader never acts on ("don't show
  // earlier"). Written on a two-hour sliver of today it landed at the head
  // of tomorrow's hours, which settled it.
  if (early && false) {
    var et = (i18n.earlier || '+{n} earlier').replace('{n}', early);
    out.push({ id: 'earlier', kind: 'note', text: et, align: 'left',
               a0: axis.a0, a1: axis.a0 + et.length * cell,
               c0: lipRows - rowH - 4, c1: lipRows - 2 });
  }
  if (late) {
    var lt = (i18n.more || '+{n} more').replace('{n}', late);
    out.push({ id: 'later', kind: 'note', text: lt, align: 'right',
               a0: axis.a1 - lt.length * cell, a1: axis.a1,
               c0: lipRows - rowH - 4, c1: lipRows - 2 });
  }

  // THE WEATHER BELONGS TO A DAY, so it goes at that day's own end of the
  // scale rather than in a band across the top of everything. On a board
  // showing three days there are three of them and each is over its own day;
  // on a board showing one there is one, and it is still a fact about that
  // day rather than a headline.
  var days = (metro.days || []);
  var list = days.length ? days : [{ start_min: metro.day_start_min,
                                     end_min: metro.day_end_min,
                                     weather: metro.header_weather }];
  if (opts && opts.showWeather === false) list = [];
  list.forEach(function (d, di) {
    var wx = d.weather;
    if (!wx || wx.hi == null) return;
    // WHICH SCALE THE NUMBERS ARE ON, once. "18\u00b0 13\u00b0" is two numbers
    // and no unit, which is fine on a board you set up yourself and useless to
    // anybody else looking at it -- and the setting that decides it is two
    // clicks away in a form nobody opens twice. Once per reading, at the end,
    // where it covers both numbers.
    var u = wx.unit || (metro.header_weather && metro.header_weather.unit) || '';
    var t = Math.round(wx.hi) + '\u00b0/' + Math.round(wx.lo) + '\u00b0' + u;
    if (wx.rain_chance >= 30) {
      t += '  ' + (i18n.rain_pct || '{n}% rain').replace('{n}', wx.rain_chance);
    }
    var end = scale.at(Math.min(d.end_min, metro.day_end_min));
    // ITS OWN ROW, ABOVE THE CLOCK. Put in the same band as the hour labels
    // it simply landed on one: "21/13 60% rain" was printed through "22:00"
    // on the first panel that had weather in it. The strip is two rows where
    // there is weather to show, and the furniture says so, so the bands
    // start below both.
    if (opts && opts.richWx) {
      out.push({ id: 'wx' + di, kind: 'weather', text: t, align: 'right', rich: true,
                 a0: end - rowH * 2 - 12 * cell - 4, a1: end - 4,
                 c0: 2, c1: lipRows - rowH - 10 });
      return;
    }
    out.push({ id: 'wx' + di, kind: 'weather', text: t, align: 'right',
               a0: end - t.length * cell - 4, a1: end - 4,
               c0: lipRows - rowH * 2 - 10, c1: lipRows - rowH - 10 });
  });
  return out;
}

module.exports = { specFor: specFor, crowding: crowding, CROWD_SAFE: CROWD_SAFE,
                   scaleFor: scaleFor, linesFrom: linesFrom,
                   opened: opened, framed: framed,
                   frameFor: frameFor,
                   fixedFor: fixedFor, statesFor: statesFor, routeRows: routeRows,
                   segmentsFor: segmentsFor,
                   wantsFrom: wantsFrom, charMeasure: charMeasure };
