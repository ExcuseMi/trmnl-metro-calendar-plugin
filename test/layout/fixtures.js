'use strict';

// METRO payloads for the layout suite — the same shape transform.js emits.
// Each one pins down a situation that has actually gone wrong, so a fixture
// is a bug report as much as it is input.

function track(key, name, side, hue, offset, width, style) {
  return { key: key, name: name, side: side, hue: hue, track_offset: offset, line_width: width, line_style: style };
}
function ev(title, owner, startMin, endMin, extra) {
  return Object.assign({
    type: 'event', title: title, start_min: startMin, end_min: endMin, location: null,
    owner: owner, co_owners: [], side: 'left', hue: 'black', track_width: 3, track_style: 'solid', track_offset: -10,
  }, extra || {});
}
// A LONG BLOCK IS AN EVENT. It used to travel in a `sidings` array of its
// own and be drawn as a kink that took the line off its lane for hours;
// now it is an ordinary event that happens to be long, and the client
// decides from the clock to draw it on the main track. A block SHARED is
// one event with co-owners, which is a convergence, which is what two
// children at the same school all day look like.
// The attributes an event carries are its own line's: side, hue, width,
// texture, offset. The short events above write all five out by hand; a
// long one takes them from the track list, because a long event that
// disagrees with its own line about which side it is on is not a payload
// transform.js could produce.
function longs(list) {
  var by = {};
  list.forEach(function (t) { by[t.key] = t; });
  return function (owner, title, startMin, endMin, extra) {
    var t = by[owner];
    return ev(title, owner, startMin, endMin, Object.assign({
      side: t.side, hue: t.hue, track_width: t.line_width,
      track_style: t.line_style, track_offset: t.track_offset,
    }, extra || {}));
  };
}

const TRACKS = [
  track('work', 'Work', 'left', 'black', -10, 4, 'solid'),
  track('alex', 'Alex', 'right', 'orange-40', 10, 3, 'solid'),
  track('sam', 'Sam', 'right', 'green-40', 20, 3, 'dashed'),
  track('kids', 'Kids', 'right', 'purple-40', 30, 3, 'dotted'),
];

// The day window is DERIVED, the way transform.js derives it, not written
// down. Hardcoded at 07:00-21:00 it happened to end on the same minute as
// busy-day's last event, so the padding the client keeps after the last
// thing was clamped away and "Book Club" was drawn hard against the end of
// the axis with nowhere for its label to go. A fixture that carries a
// payload transform could never have produced is a fixture testing a board
// that cannot happen.
function dayWindow(m) {
  var times = [];
  (m.events || []).forEach(function (i) {
    times.push(i.start_min); times.push(i.end_min);
  });
  if (!times.length) return null;
  // an hour before the first thing, 90 minutes after the last, on the hour,
  // never less than eight hours: transform.js's DAY_LO / DAY_HI
  var lo = Math.max(0, Math.floor((Math.min.apply(null, times) - 60) / 60) * 60);
  var hi = Math.min(24 * 60, Math.ceil((Math.max.apply(null, times) + 90) / 60) * 60);
  if (hi - lo < 8 * 60) hi = Math.min(24 * 60, lo + 8 * 60);
  return { lo: lo, hi: hi };
}

function hhmm(m) {
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

function base(over) {
  over = over || {};
  var m = Object.assign({
    secondary_threshold_min: 30,
    date_label: 'Tue, Sep 8', now_min: 870,
    orientation: 'auto', hour12: false,
    i18n: { today: 'Today', more: '+{n} more', earlier: '+{n} earlier', rain_pct: '{n}% rain' },
    header_weather: { hi: 21, lo: 13, condition: 'Rain', rain_chance: 60, icon: '' },
    legend: TRACKS, all_day: [], events: [], weather: [],
  }, over);
  var w = dayWindow(m);
  if (m.day_start_min == null) m.day_start_min = w ? w.lo : 420;
  if (m.day_end_min == null) m.day_end_min = w ? w.hi : 1260;
  if (m.window_label == null) m.window_label = hhmm(m.day_start_min) + ' ' + hhmm(m.day_end_min);
  // the run of days the payload offers. One, unless the fixture says
  // otherwise: a single day is a run of one, and the client takes the same
  // path for it as for three.
  if (m.days == null) {
    m.days = [{ index: 0, start_min: 0, end_min: 1440, date_label: m.date_label,
      weekday_label: 'Tuesday', weather: { hi: 21, lo: 13, condition: 'Rain', rain_chance: 60, icon: '' } }];
  }
  return m;
}

// A full, busy day on four tracks: back-to-back work meetings that have to
// stack into lanes, two- and three-way interchanges, an evening cluster.
// This is the everyday case — if anything here is unreadable, the plugin is
// unreadable.
const busyDay = base({
  events: [
    ev('Yoga', 'alex', 450, 510, { location: 'Studio 9', side: 'right', hue: 'orange-40', track_offset: 10 }),
    ev('Team Standup', 'work', 480, 495, { track_width: 4 }),
    ev('School Run', 'kids', 495, 525, { co_owners: ['sam'], side: 'right', hue: 'purple-40', track_style: 'dotted', track_offset: 30 }),
    ev('Quick Sync', 'work', 500, 515, { track_width: 4 }),
    ev('Client Workshop', 'work', 540, 630, { location: 'Room 4B', track_width: 4 }),
    ev('Dentist', 'alex', 600, 645, { side: 'right', hue: 'orange-40', track_offset: 10 }),
    ev('1:1 with Priya', 'work', 660, 690, { track_width: 4 }),
    ev('Lunch with Alex', 'alex', 720, 780, { location: 'The Garden Cafe', co_owners: ['work'], side: 'right', hue: 'orange-40', track_offset: 10 }),
    ev('Design Review', 'work', 840, 900, { track_width: 4 }),
    ev('Sprint Planning', 'work', 930, 1020, { track_width: 4 }),
    ev('Pick Up Kids', 'kids', 960, 980, { side: 'right', hue: 'purple-40', track_style: 'dotted', track_offset: 30 }),
    ev('Swim Training', 'sam', 990, 1050, { location: 'City Pool', side: 'right', hue: 'green-40', track_style: 'dashed', track_offset: 20 }),
    ev('Piano Lesson', 'kids', 1020, 1065, { side: 'right', hue: 'purple-40', track_style: 'dotted', track_offset: 30 }),
    ev('Groceries', 'alex', 1050, 1080, { side: 'right', hue: 'orange-40', track_offset: 10 }),
    ev('Family Dinner', 'alex', 1110, 1170, { co_owners: ['sam', 'kids'], side: 'right', hue: 'orange-40', track_offset: 10 }),
    ev('Book Club', 'sam', 1185, 1260, { side: 'right', hue: 'green-40', track_style: 'dashed', track_offset: 20 }),
  ],
});

// The same day with an all-day event on EVERY track. Every line carries a
// long event running the width of the board, which is the densest the
// inward caption rungs ever get. Drawn as a band that moved every line off
// its baseline for the whole day, this is what broke the interchange
// capsule (it reached for a baseline nobody was sitting on any more) and
// what put a track's own line through its caption.
const allDayEveryTrack = base({
  // Declared at the heads now, not drawn across the day: an all-day event
  // has no hour, so it has no place on a scale of hours. What this fixture
  // tests is therefore the opposite of what it used to -- that four head
  // rows fit above four lines without eating the board -- and the axis
  // below is an ordinary busy day.
  all_day: [
    { title: 'Office Closed', owners: ['work'] },
    { title: 'PTO', owners: ['alex'] },
    // One title, two lines: the shared-origin case, named once with a tie
    // down to the other head rather than written twice.
    { title: 'School Holiday', owners: ['sam', 'kids'] },
  ],
  events: busyDay.events,
});

// A long solo event with a location line, spanning most of the day, with
// real meetings inside its span that branch off the line as usual. The
// caption is two lines here, which is what used to overflow the gap the
// old siding kink opened up, and is now what the reserved inward rung has
// to be deep enough for.
const longEventDay = base({
  // The holiday is a head row; the desk booking is a real block with real
  // hours, which is the distinction the two used to blur.
  all_day: [{ title: 'Schoolfotografie', owners: ['kids'] }],
  events: [
    longs(TRACKS)('work', 'Desk booking', 480, 1020, { location: 'BE - Ghent / A01 / D01.01' }),
  ].concat(busyDay.events),
});

// Barely anything on: the layout should use the canvas instead of leaving
// one line adrift, and must not invent overlaps out of empty space. The
// five-hour block is the one event on any fixture long enough to be allowed
// a rejoin, so it is what keeps the "only long solo events rejoin" rule from
// passing simply because nothing ever rejoins.
const quietDay = base({
  now_min: 600,
  events: [
    ev('Standup', 'work', 540, 555, { track_width: 4 }),
    ev('Rehearsal Day', 'kids', 540, 840, { side: 'right', hue: 'purple-40', track_style: 'dotted', track_offset: 30 }),
    ev('Swim Training', 'sam', 990, 1050, { side: 'right', hue: 'green-40', track_style: 'dashed', track_offset: 20 }),
  ],
});

// ONE THING ALL DAY, which is a Sunday and is the commonest board this
// plugin will ever draw in a household that is not the demo family.
//
// quiet-day is three events and already tests "do not leave a line adrift";
// this is the floor below it. Everything the board does to fill itself up
// has nothing to work with: three of the four lines have no stop on them at
// all, the axis has one dot and one tick to place, and the tier loop is
// choosing text for a board that could hardly be emptier. The failures worth
// catching here are the ones an empty board invents -- a lone caption pushed
// out to a rung it did not need, a line drawn with nothing on it and no name
// against it, an hour strip covering a day where nothing happens -- none of
// which any busy fixture can show, because on a busy fixture there is always
// something else to blame.
const slowDay = base({
  now_min: 780,
  events: [
    ev('Lunch with Mum', 'alex', 720, 840,
       { location: 'The Old Bakery', side: 'right', hue: 'orange-40', track_offset: 10 }),
  ],
});

// Two same-owner meetings starting within a few minutes of each other: the
// second one's branch used to be forced to cross back through the first's.
const tightPair = base({
  events: [
    ev('Team Standup', 'work', 480, 495, { track_width: 4 }),
    ev('Quick Sync', 'work', 500, 515, { track_width: 4 }),
    ev('Client Workshop', 'work', 540, 630, { track_width: 4 }),
  ],
});

// A DOUBLE-BOOKED MORNING, which is the ordinary way a line ends up
// wanting a second lane: three meetings running at once on one person's
// calendar. That is what A15 is for, and no other fixture has it. A track
// only asks for a second lane when two of its OWN events overlap, and
// before this every board here had at most one at a time.
//
// Nothing is shared with anybody, so no corridor is planned and the space
// either side of Work's line is free for Work's own labels.
const doubleBooked = base({
  events: [
    ev('Sprint Planning', 'work', 540, 660, { track_width: 4 }),
    ev('Design Review', 'work', 570, 675, { track_width: 4 }),
    ev('1:1 with Priya', 'work', 600, 690, { track_width: 4 }),
    ev('Retro', 'work', 780, 840, { track_width: 4 }),
    ev('Dentist', 'alex', 630, 700, { side: 'right', hue: 'orange-40', track_offset: 10 }),
    ev('Swim Training', 'sam', 810, 870, { side: 'right', hue: 'green-40', track_style: 'dashed', track_offset: 20 }),
  ],
});

// THE DAY THAT NO SINGLE ORDER CAN DRAW, which is what the weave is for.
//
// Marge takes Bart to school and Homer drops Lisa at band practice; after
// school they swap, and it is Marge who has Lisa at the jazz club and over
// her homework while Homer has Bart at the skate park and reading him a
// story. Every one of those is a shared event, so every one of them wants
// its two lines next to each other.
//
// They cannot all have it. The four pairings form a CYCLE (Marge-Bart,
// Bart-Homer, Homer-Lisa, Lisa-Marge), and a cycle cannot be laid along a
// line without breaking one of its links, so whichever order the board
// picks, one pairing spans it and every event on that pairing crosses the
// two lines in between.
//
// One exchange at teatime settles it: the morning wants Marge-Bart and
// Homer-Lisa adjacent, the evening wants Marge-Lisa and Homer-Bart, and
// those two orders differ by swapping one adjacent pair. One crossing,
// made on purpose, instead of one per evening event for the rest of the
// day.
const regroups = Object.assign(base({
  legend: [
    track('mar', 'Marge', 'left', 'black', -10, 4, 'solid'),
    track('bar', 'Bart', 'left', 'gray-30', -20, 3, 'dashed'),
    track('hom', 'Homer', 'right', 'orange-40', 10, 3, 'solid'),
    track('lis', 'Lisa', 'right', 'green-40', 20, 3, 'dotted'),
  ],
  events: [
    ev('School Run', 'mar', 480, 510, { co_owners: ['bar'], track_width: 4 }),
    ev('Band Practice', 'hom', 500, 530, { co_owners: ['lis'], side: 'right', hue: 'orange-40', track_offset: 10 }),
    ev('Kwik-E-Mart', 'mar', 540, 555, { track_width: 4 }),
    ev('Sector 7-G', 'hom', 600, 660, { side: 'right', hue: 'orange-40', track_offset: 10 }),
    // one after another rather than on top of each other: what this board
    // is for is the REGROUPING, and four shared events inside two hours
    // would be testing how tightly captions pack instead
    ev('Jazz Club', 'mar', 1020, 1080, { co_owners: ['lis'], track_width: 4 }),
    ev('Skate Park', 'hom', 1080, 1140, { co_owners: ['bar'], side: 'right', hue: 'orange-40', track_offset: 10 }),
    ev('Homework', 'mar', 1140, 1200, { co_owners: ['lis'], track_width: 4 }),
    ev('Bedtime Story', 'hom', 1200, 1260, { co_owners: ['bar'], side: 'right', hue: 'orange-40', track_offset: 10 }),
  ],
}), {});

// A full 24-hour day whose events all sit in the middle of it: the quiet
// early morning and late evening are what the express sections compress.
const fullDay = base({
  day_start_min: 0, day_end_min: 1440, window_label: '00:00 24:00', now_min: 600,
  events: [
    ev('Standup', 'work', 540, 555, { track_width: 4 }),
    ev('Workshop', 'work', 600, 690, { track_width: 4 }),
    ev('Dentist', 'alex', 780, 825, { side: 'right', hue: 'orange-40', track_offset: 10 }),
    ev('Swim', 'sam', 900, 960, { side: 'right', hue: 'green-40', track_style: 'dashed', track_offset: 20 }),
  ],
});

// One long event shared by two lines, which is a convergence like any
// other shared event: the two lean in and run together for the length of
// it (they really are both there), and it is one event, so one caption,
// set between them. Drawn once per line it appeared twice, on lines that
// could be at opposite ends of the board.
const sharedLongEvent = base({
  events: [
    longs(TRACKS)('sam', 'School Day', 480, 960, { location: 'Springfield Elementary', co_owners: ['kids'] }),
    ev('Standup', 'work', 540, 555, { track_width: 4 }),
    ev('Assembly', 'kids', 600, 630, { side: 'right', hue: 'purple-40', track_style: 'dotted', track_offset: 30 }),
    ev('Swim Training', 'sam', 990, 1050, { side: 'right', hue: 'green-40', track_style: 'dashed', track_offset: 20 }),
  ],
});

// Five lines, two on one side and three on the other — the shape the demo
// board actually has, and the one the four-line fixtures never produced:
// each side's innermost track sits half a pitch off the spine, so those two
// are neighbours with nothing between them. That pair is the tightest gap
// on the board and it is where a line's NAME, set above its own rail, ran
// into the rail belonging to the line above it.
const FIVE = [
  track('mag', 'Maggie', 'left', 'black', -20, 3, 'solid'),
  track('hom', 'Homer', 'left', 'black', -10, 6, 'solid'),
  track('mar', 'Marge', 'right', 'black', 10, 5, 'dashed'),
  track('bar', 'Bart', 'right', 'black', 20, 4, 'dotted'),
  track('lis', 'Lisa', 'right', 'black', 30, 3, 'solid'),
];
const fiveLines = Object.assign(base({
  now_min: 519,
  events: [
    longs(FIVE)('bar', 'School Day', 510, 900, { location: 'Springfield Elementary', co_owners: ['lis'] }),
    longs(FIVE)('hom', 'Desk booking', 480, 1020, { location: 'BE - Ghent / A01 / D01.01' }),
    ev('School Run', 'mar', 480, 510, { co_owners: ['bar', 'lis'], side: 'right', hue: 'black', track_offset: 10 }),
    ev('Shift Handover', 'hom', 480, 495, { side: 'left', hue: 'black', track_width: 6, track_offset: -10 }),
    ev('Book Club', 'mar', 540, 600, { side: 'right', hue: 'black', track_style: 'dashed', track_offset: 10 }),
    ev('Assembly', 'lis', 540, 570, { side: 'right', hue: 'black', track_offset: 30 }),
    ev('Donut Break', 'hom', 600, 620, { side: 'left', hue: 'black', track_width: 6, track_offset: -10 }),
    ev('Playgroup', 'mag', 630, 690, { side: 'left', hue: 'black', track_offset: -20 }),
    ev('Grocery Run', 'mar', 720, 780, { location: 'Kwik-E-Mart', side: 'right', hue: 'black', track_style: 'dashed', track_offset: 10 }),
    ev('Nap', 'mag', 780, 870, { side: 'left', hue: 'black', track_offset: -20 }),
    ev('Reactor Core Check', 'hom', 840, 900, { side: 'left', hue: 'black', track_width: 6, track_offset: -10 }),
    ev('Detention', 'bar', 930, 990, { location: 'Room 12', side: 'right', hue: 'black', track_style: 'dotted', track_offset: 20 }),
    ev('PTA Meeting', 'mar', 960, 1020, { side: 'right', hue: 'black', track_style: 'dashed', track_offset: 10 }),
    ev('Saxophone Lesson', 'lis', 960, 1020, { side: 'right', hue: 'black', track_offset: 30 }),
    ev("Moe's Tavern", 'hom', 1050, 1110, { location: "Moe's", side: 'left', hue: 'black', track_width: 6, track_offset: -10 }),
    ev('Skate Park', 'bar', 1020, 1080, { side: 'right', hue: 'black', track_style: 'dotted', track_offset: 20 }),
    ev('Mensa Meeting', 'lis', 1110, 1170, { side: 'right', hue: 'black', track_offset: 30 }),
    ev('Family Dinner', 'mar', 1140, 1200, { co_owners: ['mag', 'hom', 'bar', 'lis'], side: 'right', hue: 'black', track_offset: 10 }),
  ],
}), { legend: FIVE });

// A work crew rather than a family, and the shape the Futurama demo board
// has: a whole-crew interchange first thing, three of them on one long
// event for most of the day, and two short events just before the interchange
// whose captions the interchange bar cuts across. Those two are what caught
// a caption being thrown 71px off its own rail to dodge that bar.
const CREW = [
  track('prof', 'Professor', 'left', 'black', -20, 6, 'solid'),
  track('amy', 'Amy', 'left', 'black', -10, 3, 'solid'),
  track('fry', 'Fry', 'right', 'black', 10, 4, 'dotted'),
  track('leela', 'Leela', 'right', 'black', 20, 3, 'solid'),
  track('bender', 'Bender', 'right', 'black', 30, 3.5, 'dashed'),
];
const crewDay = Object.assign(base({
  day_start_min: 360, day_end_min: 1380, window_label: '6am 11pm', now_min: 611,
  events: [
    longs(CREW)('fry', 'Delivery Run', 540, 960, { location: 'Chapek 9', co_owners: ['leela', 'bender'] }),
    ev('Coffee (100 cups)', 'fry', 450, 480, { side: 'right', hue: 'black', track_style: 'dotted', track_offset: 10 }),
    ev('Bend Some Girders', 'bender', 450, 495, { side: 'right', hue: 'black', track_style: 'dashed', track_offset: 30 }),
    ev('Pre-flight Check', 'leela', 480, 510, { location: 'Docking Bay', side: 'right', hue: 'black', track_offset: 20 }),
    ev('Good News Everyone', 'prof', 525, 540, { co_owners: ['amy', 'fry', 'leela', 'bender'], side: 'left', hue: 'black', track_width: 6, track_offset: -20 }),
    ev('Lab Rotation', 'amy', 570, 690, { location: 'Mars University', side: 'left', hue: 'black', track_offset: -10 }),
    ev('Nap', 'prof', 840, 960, { side: 'left', hue: 'black', track_width: 6, track_offset: -20 }),
    ev('Scooter Service', 'amy', 960, 1020, { side: 'left', hue: 'black', track_offset: -10 }),
    ev('Crew Debrief', 'fry', 990, 1050, { co_owners: ['leela', 'bender'], side: 'right', hue: 'black', track_style: 'dotted', track_offset: 10 }),
    ev('Walk Nibbler', 'leela', 1050, 1095, { side: 'right', hue: 'black', track_offset: 20 }),
    ev('All My Circuits', 'fry', 1110, 1140, { side: 'right', hue: 'black', track_style: 'dotted', track_offset: 10 }),
    ev('Hedonism Lounge', 'bender', 1170, 1260, { side: 'right', hue: 'black', track_style: 'dashed', track_offset: 30 }),
  ],
}), { legend: CREW });

// The board a chat assistant actually produced for the Futurama demo: five
// people plus two lines that are not people at all, because it gave each
// calendar a `name` and an unnamed event falls back to it. Seven lines and
// nothing to be done about it from the layout's side — which is the point.
// This is the board that was drawn at a 20px pitch in a 780px-deep canvas
// with every line's name lying across its own rail, and the whole crew's
// delivery run drawn as a stack of unrelated pills.
const SEVEN = [
  track('deliv', 'Deliveries', 'left', 'black', -20, 5.5, 'dashed'),
  track('crew', 'Crew', 'left', 'black', -10, 5, 'dotted'),
  track('fry', 'Fry', 'right', 'black', 10, 6, 'solid'),
  track('leela', 'Leela', 'right', 'black', 20, 3, 'dashdot'),
  track('bender', 'Bender', 'right', 'black', 30, 3, 'dotted'),
  track('amy', 'Amy', 'right', 'black', 40, 3.5, 'dashed'),
  track('prof', 'Professor', 'right', 'black', 50, 4.5, 'dashdot'),
];
const CREW_KEYS = ['fry', 'leela', 'bender', 'amy', 'prof'];
const sevenLines = Object.assign(base({
  day_start_min: 360, day_end_min: 1380, window_label: '6am 11pm', now_min: 683,
  events: [
    longs(SEVEN)('amy', 'Lab Rotation', 570, 690, { location: 'Mars University' }),
    longs(SEVEN)(CREW_KEYS[0], 'Delivery Run', 540, 960, { location: 'Chapek 9', co_owners: CREW_KEYS.slice(1) }),
    ev('Coffee (100 cups)', 'fry', 450, 480, { side: 'right', hue: 'black', track_offset: 10 }),
    ev('Bend Some Girders', 'bender', 450, 495, { side: 'right', hue: 'black', track_style: 'dotted', track_offset: 30 }),
    ev('Pre-flight Check', 'leela', 480, 510, { location: 'Docking Bay', side: 'right', hue: 'black', track_style: 'dashdot', track_offset: 20 }),
    ev('Good News Everyone', 'fry', 525, 540, { co_owners: ['leela', 'bender', 'amy', 'prof'], location: 'Conference Table', side: 'right', hue: 'black', track_width: 6, track_offset: 10 }),
    ev('Nap', 'prof', 840, 960, { side: 'right', hue: 'black', track_style: 'dashdot', track_offset: 50 }),
    ev('Scooter Service', 'amy', 960, 1020, { side: 'right', hue: 'black', track_style: 'dashed', track_offset: 40 }),
    ev('Crew Debrief', 'fry', 990, 1050, { co_owners: ['leela', 'bender', 'amy', 'prof'], side: 'right', hue: 'black', track_width: 6, track_offset: 10 }),
    ev('Walk Nibbler', 'leela', 1050, 1095, { side: 'right', hue: 'black', track_style: 'dashdot', track_offset: 20 }),
    ev('All My Circuits', 'fry', 1110, 1140, { side: 'right', hue: 'black', track_width: 6, track_offset: 10 }),
    ev('Hedonism Lounge', 'bender', 1170, 1260, { location: "O'Zorgnax's Pub", side: 'right', hue: 'black', track_style: 'dotted', track_offset: 30 }),
  ],
}), { legend: SEVEN });

// A day with two entries that have no duration: a reminder saved at a
// moment, and a shared one at the same minute for several people. Real
// calendars are full of these (a birthday, an invitation accepted with no
// end, anything a phone saved as "now"), and every part of the drawing that
// reasons about a span has to survive one that is zero minutes long.
const momentDay = base({
  day_start_min: 420, day_end_min: 1260, window_label: '7am 9pm', now_min: 600,
  events: [
    ev('Bin Day', 'work', 480, 480),
    ev('Standup', 'work', 540, 555, { track_width: 4 }),
    ev('Family Dinner', 'alex', 1110, 1110, { co_owners: ['sam', 'kids'], side: 'right', hue: 'orange-40', track_offset: 10 }),
    ev('Swim', 'sam', 900, 960, { side: 'right', hue: 'green-40', track_style: 'dashed', track_offset: 20 }),
  ],
});

// Three days, because a run is the shape this plugin was built without and
// every part of it has to survive one: a night between two days, an event
// on each of them, and a board that has to decide how many of the three it
// can actually draw.
function shift(items, day) {
  return items.map(function (i) {
    return Object.assign({}, i, { start_min: i.start_min + day * 1440, end_min: i.end_min + day * 1440 });
  });
}
const DAY0 = [
  ev('Team Standup', 'work', 540, 555, { track_width: 4 }),
  ev('Client Workshop', 'work', 600, 690, { location: 'Room 4B', track_width: 4 }),
  ev('Yoga', 'alex', 450, 510, { side: 'right', hue: 'orange-40', track_offset: 10 }),
  ev('Family Dinner', 'alex', 1110, 1170, { co_owners: ['sam', 'kids'], side: 'right', hue: 'orange-40', track_offset: 10 }),
];
const DAY1 = [
  ev('Sprint Review', 'work', 570, 660, { track_width: 4 }),
  ev('Dentist', 'alex', 780, 825, { side: 'right', hue: 'orange-40', track_offset: 10 }),
  ev('Swim Training', 'sam', 1020, 1080, { location: 'City Pool', side: 'right', hue: 'green-40', track_style: 'dashed', track_offset: 20 }),
];
const DAY2 = [
  ev('Retro', 'work', 600, 660, { track_width: 4 }),
  ev('Piano Lesson', 'kids', 990, 1035, { side: 'right', hue: 'purple-40', track_style: 'dotted', track_offset: 30 }),
];
const threeDay = Object.assign(base({
  now_min: 600,
  events: DAY0.concat(shift(DAY1, 1), shift(DAY2, 2)),
}), {
  days: [
    { index: 0, start_min: 0, end_min: 1440, date_label: 'Tue 8 Sep', weekday_label: 'Tuesday',
      weather: { hi: 21, lo: 13, condition: 'Rain', rain_chance: 60, icon: '' } },
    { index: 1, start_min: 1440, end_min: 2880, date_label: 'Wed 9 Sep', weekday_label: 'Wednesday',
      weather: { hi: 18, lo: 11, condition: 'Cloudy', rain_chance: 20, icon: '' } },
    { index: 2, start_min: 2880, end_min: 4320, date_label: 'Thu 10 Sep', weekday_label: 'Thursday',
      weather: { hi: 24, lo: 15, condition: 'Clear', rain_chance: 5, icon: '' } },
  ],
  day_start_min: 0, day_end_min: 4320,
});

// THREE DAYS WITH HOLIDAYS ON SOME OF THEM.
//
// An all-day event is declared at the line's head rather than on the axis,
// because it is a property of a DAY and not a stretch of one. That says
// everything on a board showing one day and nothing at all about WHICH day
// on a board showing three: a holiday on the Thursday sat at the head
// exactly like one covering all three. Nothing in the suite had both a
// multi-day window and an all-day event, so nothing ever asked.
//
// One covering every day (no qualifier owed), one covering a single day, and
// one covering two of the three.
const threeDayHoliday = Object.assign(JSON.parse(JSON.stringify(threeDay)), {
  all_day: [
    { title: 'Conference', owners: ['work'], days: [0, 1, 2] },
    { title: 'School Holiday', owners: ['kids'], days: [1] },
    { title: 'Half Term', owners: ['sam'], days: [1, 2] },
  ],
});

// A QUIET DAY THAT BORROWED THE NEXT ONE.
//
// Two events today is a board that is mostly empty paper, so transform
// sends two days and a window into them: six this morning through to six
// tomorrow evening. This is the shape nothing else here has -- a midnight
// inside the board, a night either side of it, and events on both days
// which have to land at their own day's time -- and it is the only fixture
// whose payload carries `rolling`.
const ROLL_LINES = [
  track('alex', 'Alex', 'left', 'black', -10, 4, 'solid'),
  track('sam', 'Sam', 'right', 'green-40', 10, 3, 'dashed'),
  track('kids', 'Kids', 'right', 'purple-40', 20, 3, 'dotted'),
];
const rollingQuiet = Object.assign(base({
  now_min: 560,
  legend: ROLL_LINES,
  date_label: 'Sat 12 Sep',
  events: [
    ev('Swim Training', 'alex', 600, 690, { track_width: 4 }),
    ev('Book Club', 'sam', 1140, 1230, { side: 'right', hue: 'green-40', track_style: 'dashed', track_offset: 10 }),
    // tomorrow, on the same number line: 09:00 tomorrow is 1980
    ev('Parkrun', 'alex', 1980, 2040, { track_width: 4 }),
    ev('Brunch With Kim', 'sam', 2130, 2220, { side: 'right', hue: 'green-40', track_style: 'dashed', track_offset: 10 }),
    ev('Football Match', 'kids', 2280, 2400, { side: 'right', hue: 'purple-40', track_style: 'dotted', track_offset: 20 }),
  ],
}), {
  days: [
    { index: 0, start_min: 0, end_min: 1440, date_label: 'Sat 12 Sep', weekday_label: 'Saturday',
      weekday_short: 'Sat', weather: { hi: 19, lo: 11, condition: 'Cloudy', rain_chance: 20, icon: '' } },
    { index: 1, start_min: 1440, end_min: 2880, date_label: 'Sun 13 Sep', weekday_label: 'Sunday',
      weekday_short: 'Sun', weather: { hi: 22, lo: 12, condition: 'Rain', rain_chance: 40, icon: '' } },
  ],
  rolling: { start_min: 6 * 60, end_min: 1440 + 18 * 60 },
  day_start_min: 6 * 60, day_end_min: 1440 + 18 * 60,
});

// NOBODY IS IN TWO PLACES (P1). Reported off a real board: four of them at
// the pool from two till five, and one of them also has her own appointment
// from three till five, so the drawing had her line in the family corridor
// AND her own event marked on the rail she was riding.
//
// Three shapes in one fixture, because the rule has three answers:
//   Zwemmen        she is there from two and leaves at three  (a clipped hold)
//   Kickboksen     she leaves at six and is back by seven      (two holds and
//                  a stay of her own in between)
//   Kapper         her own thing covers the whole of Pilates   (not a member
//                  at all, and the capsule does not span her row)
//   Kookles        the physio runs into the first half hour of it (she joins
//                  LATE: the capsule spans the one line that is there when it
//                  is drawn, and hers leans in afterwards)
const twoPlaces = base({
  events: [
    ev('Zwemmen', 'work', 840, 1020, { location: 'City Pool', co_owners: ['alex', 'sam', 'kids'],
      side: 'left', hue: 'black', track_width: 4, track_offset: -10 }),
    ev('Wimperextensions', 'kids', 900, 1020, { side: 'right', hue: 'purple-40',
      track_style: 'dotted', track_offset: 30 }),
    ev('Kickboksen', 'alex', 1080, 1260, { co_owners: ['sam'], side: 'right', hue: 'orange-40',
      track_offset: 10 }),
    ev('Kapper', 'sam', 1140, 1200, { side: 'right', hue: 'green-40',
      track_style: 'dashed', track_offset: 20 }),
    ev('Pilates', 'work', 600, 660, { co_owners: ['kids'], side: 'left', hue: 'black',
      track_width: 4, track_offset: -10 }),
    ev('Tandarts', 'kids', 600, 660, { side: 'right', hue: 'purple-40',
      track_style: 'dotted', track_offset: 30 }),
    ev('Kookles', 'work', 420, 570, { co_owners: ['sam'], side: 'left', hue: 'black',
      track_width: 4, track_offset: -10 }),
    ev('Fysio', 'sam', 400, 450, { side: 'right', hue: 'green-40',
      track_style: 'dashed', track_offset: 20 }),
  ],
});

// A HEAD CARRYING A ROUTE ROW, WITH A BRANCH UNDER IT AT THAT END.
//
// Reported from a photograph of the shipped example day: "Bart end label is
// in the middle of the page". The far head is two rows -- the name with the
// all-day badge under it -- and the escape that steps a name in off the edge
// to get clear of a branch measured its allowance off the BOX, which for a
// two-row head is as wide as the badge. Twice that is most of a TRMNL X, and
// the name came to rest mid-board with the map either side of it.
//
// It survived every suite: `check` has no opinion about where a terminus is,
// the sweep asks about faults, and not one fixture put an all-day badge and a
// late branch on the same line.
//
// THE REAL PAYLOAD, not a reconstruction. Three attempts at building the
// shape by hand all laid out clean -- it needs the badge on the SECOND day of
// a rolling board, a branch arriving late on that day, and the head deep
// enough in the run for the step to be worth taking -- and a fixture that
// does not reproduce the bug is worse than none, because it says the bug is
// covered. This is transform.js's own output for the simpsons example at
// 21:26 on a Thursday, which is what the photograph was of. Verified by
// putting the fault back: with the allowance measured off the box again,
// this fixture fails and the hand-built ones do not.
const badgeAndBranch = require('./badge-and-branch.json');

module.exports = [
  { name: 'badge-and-branch', metro: badgeAndBranch },
  { name: 'busy-day', metro: busyDay },
  { name: 'rolling-quiet', metro: rollingQuiet },
  { name: 'all-day-every-track', metro: allDayEveryTrack },
  { name: 'long-event-day', metro: longEventDay },
  { name: 'quiet-day', metro: quietDay },
  { name: 'slow-day', metro: slowDay },
  { name: 'tight-pair', metro: tightPair },
  { name: 'double-booked', metro: doubleBooked },
  { name: 'regroups', metro: regroups },
  { name: 'full-day', metro: fullDay },
  { name: 'shared-long-event', metro: sharedLongEvent },
  { name: 'five-lines', metro: fiveLines },
  { name: 'crew-day', metro: crewDay },
  { name: 'seven-lines', metro: sevenLines },
  { name: 'moment-day', metro: momentDay },
  { name: 'three-day', metro: threeDay },
  { name: 'three-day-holiday', metro: threeDayHoliday },
  { name: 'two-places', metro: twoPlaces },
];
