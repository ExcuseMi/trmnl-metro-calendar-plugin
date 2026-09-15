'use strict';

// HOW LONG A BOARD TAKES, AND ON WHAT.
//
// A layout engine that is correct and slow is not shippable: this runs on a
// device, in a browser, on a panel that wakes up to redraw. So the time is a
// property of the solver like any other, and the only way to keep it honest
// is to measure it on boards that are harder than real ones rather than on
// the quiet Tuesday that happens to be in the fixtures.
//
// The boards below are generated, and generated to be nasty in the specific
// ways that cost this solver time: many lines (the band search is quadratic
// in gaps), many events per line (the caption search is quadratic in
// captions), events crowded in time (every one of them a conflict to
// resolve), long titles (wide boxes, more overlap), and convergences (a bar
// across every line it touches).
//
//   node solver/bench.js          the standard set
//   node solver/bench.js --big    and the ones that are deliberately unfair

var Day = require('./day');
var Bands = require('./bands');
var Fit = require('./fit');
var B = require('./board');

// A day built to order. Deterministic: the same shape every run, so two
// timings are comparable.
function make(o) {
  var lines = [], events = [], i, j;
  for (i = 0; i < o.lines; i++) {
    lines.push({ key: 'L' + i, name: 'Person ' + i, side: i < o.lines / 2 ? 'left' : 'right',
                 track_offset: i * 10, line_width: 3, line_style: 'solid' });
  }
  var words = ['Morning', 'Client', 'Grocery', 'Physio', 'Parents', 'Dinner', 'School',
               'Bath', 'Retro', 'Dentist', 'Piano', 'Book', 'Swim', 'Standup', 'Review'];
  var n = 0;
  for (i = 0; i < o.lines; i++) {
    for (j = 0; j < o.per; j++) {
      // Crowded where `crowd` says so: events packed into the first part of
      // the day rather than spread across it.
      var span = o.crowd ? (o.to - o.from) * 0.35 : (o.to - o.from) * 0.92;
      var at = o.from + Math.round(span * (j + 0.5) / o.per) + (i % 3) * 7;
      var title = words[(i * 7 + j * 3) % words.length]
        + ' ' + words[(i * 5 + j * 11 + 4) % words.length];
      if (o.longTitles) title += ' ' + words[(i + j) % words.length];
      events.push({ type: 'event', title: title, start_min: at,
                    end_min: at + (o.dur || 45), location: null,
                    owner: 'L' + i, co_owners: [] });
      n++;
    }
  }
  // Convergences: one event several people are at, which is a bar across
  // every line it touches and the caption that has no rail of its own.
  for (i = 0; i < (o.shared || 0); i++) {
    var who = [];
    for (j = 0; j <= Math.min(o.lines - 1, 2 + (i % 3)); j++) who.push('L' + j);
    events.push({ type: 'event', title: 'Family Thing ' + i,
                  start_min: o.from + Math.round((o.to - o.from) * (i + 1) / (o.shared + 1)),
                  end_min: o.from + Math.round((o.to - o.from) * (i + 1) / (o.shared + 1)) + 60,
                  location: null, owner: who[0], co_owners: who.slice(1) });
  }
  return { legend: lines, events: events, all_day: o.allDay || [],
           days: [{ index: 0, start_min: o.from, end_min: o.to }],
           day_start_min: o.from, day_end_min: o.to, now_min: (o.from + o.to) / 2,
           i18n: { more: '+{n} more', earlier: '+{n} earlier', rain_pct: '{n}% rain' } };
}

var BOARDS = [
  { name: 'quiet          2 lines,  4 events', o: { lines: 2, per: 2, from: 360, to: 1380 } },
  { name: 'ordinary       4 lines, 16 events', o: { lines: 4, per: 4, from: 360, to: 1380, shared: 2 } },
  { name: 'busy           5 lines, 30 events', o: { lines: 5, per: 6, from: 360, to: 1380, shared: 3 } },
  { name: 'crowded        5 lines, 30 events, all in one morning',
    o: { lines: 5, per: 6, from: 360, to: 1380, shared: 3, crowd: true } },
  { name: 'wordy          5 lines, 30 events, long titles',
    o: { lines: 5, per: 6, from: 360, to: 1380, shared: 3, longTitles: true } },
  { name: 'many lines     8 lines, 40 events', o: { lines: 8, per: 5, from: 360, to: 1380, shared: 4 } },
];
var BIG = [
  { name: 'unfair        10 lines, 80 events, long titles, crowded',
    o: { lines: 10, per: 8, from: 360, to: 1380, shared: 6, crowd: true, longTitles: true } },
  { name: 'absurd        12 lines, 144 events',
    o: { lines: 12, per: 12, from: 0, to: 1440, shared: 8, longTitles: true } },
];

var VIEWS = [{ n: 'og', w: 800, h: 480 }, { n: 'x', w: 1872, h: 1404 }];

function run(list) {
  list.forEach(function (bd) {
    var metro = make(bd.o);
    VIEWS.forEach(function (v) {
      var spec = Day.specFor(metro, { w: v.w - 70, h: v.h },
        { pad: 14, bandLo: 66, cell: 7, rowH: 12 });
      var t0 = Date.now();
      var pool = { used: 0 };
      var board = Fit.fit(spec, { pool: pool });
      var ms = Date.now() - t0;
      var sp = board.spec || spec;
      var faults = B.check(board).length;
      var readable = sp.wants.length - board.shed - board.muddle - faults;
      console.log('  ' + bd.name.padEnd(52) + v.n.padEnd(3)
        + String(ms).padStart(6) + 'ms ' + String(pool.used).padStart(6) + ' evals   '
        + String(readable).padStart(3) + '/' + String(sp.wants.length).padEnd(4) + ' readable'
        + (board.dropped && board.dropped.length ? '  (' + board.dropped.length + ' line(s) left out)' : ''));
    });
  });
}

// ...AND THE REAL ONES, which are what actually has to be fast. The
// generated boards above are deliberately worse than a household ever is;
// these are the days the fixtures describe.
function runReal() {
  var fixtures;
  try { fixtures = require('../test/layout/fixtures'); } catch (e) { return; }
  fixtures.forEach(function (f) {
    VIEWS.forEach(function (v) {
      var spec = Day.specFor(f.metro, { w: v.w - 70, h: v.h },
        { pad: 14, bandLo: 66, cell: 7, rowH: 12 });
      var t0 = Date.now();
      var pool = { used: 0 };
      var board = Fit.fit(spec, { pool: pool });
      var ms = Date.now() - t0;
      var sp = board.spec || spec;
      var faults = B.check(board).length;
      var readable = sp.wants.length - board.shed - board.muddle - faults;
      console.log('  ' + f.name.padEnd(24) + v.n.padEnd(3) + String(ms).padStart(6) + 'ms ' + String(pool.used).padStart(6) + ' evals   '
        + String(readable).padStart(3) + '/' + String(sp.wants.length).padEnd(4) + ' readable'
        + (board.dropped && board.dropped.length ? '  (' + board.dropped.length + ' left out)' : ''));
    });
  });
}

if (require.main === module) {
  if (process.argv.indexOf('--real') >= 0) {
    console.log('the days the fixtures describe');
    runReal();
    process.exit(0);
  }
  console.log('solve time by board (deterministic: these numbers repeat exactly)');
  run(BOARDS);
  if (process.argv.indexOf('--big') >= 0) {
    console.log('\n...and the ones that are deliberately unfair');
    run(BIG);
  }
}

module.exports = { make: make, BOARDS: BOARDS, BIG: BIG };
