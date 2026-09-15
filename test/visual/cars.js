'use strict';

// THE CAR STANDS ON THE RAIL, WHATEVER THE RAIL IS DOING -- checked on the
// picture, not on the solver's bookkeeping.
//
// "Train cars should be able to handle track deviations. Write tests on all
// scenarios." The solver's own case books the car's box; this one loads the
// BUILT plugin page in the same headless Chromium the other visual checks
// use, hands it a small day for each scenario with the clock inside it, and
// reads the drawn SVG back: where the car's anchor is, how far it is turned,
// and where and how steep the rail actually is under it. A crop of each car
// is saved beside the results so a person can look too.
//
//   node test/visual/cars.js            all scenarios, crops in test/visual/out
//
// Scenarios: a flat rail; a shelf (the event is on now, so the car rides the
// spur); a tie's spur; inside a group (one car on the bundle, none on the
// members); a 45 degree lead into a group; and an upright departure, where
// the car stands on the flat just before the turn and must not be turned.

var fs = require('fs');
var path = require('path');
var { execFileSync } = require('child_process');

var ROOT = path.join(__dirname, '..', '..');
var BUILT = path.join(ROOT, 'plugin', '_build', 'full.html');
var OUT = path.join(__dirname, 'out');
var CHROME = process.env.CHROME
  || path.join(process.env.HOME || '', '.cache/ms-playwright/chromium-1243/chrome-linux64/chrome');
var CSS = path.join(ROOT, 'test/layout/.cache/plugins.local.css');
var JS = path.join(ROOT, 'test/layout/.cache/plugins.js');

function line(key, name, style) {
  return { key: key, name: name, side: 'left', hue: 'black', track_offset: 0,
           line_width: 3, line_style: style || 'solid' };
}
function ev(title, owner, s, e, mates) {
  return { type: 'event', title: title, start_min: s, end_min: e, owner: owner,
           co_owners: mates || [], side: 'left', hue: 'black', track_width: 3,
           track_style: 'solid', track_offset: 0 };
}
function day(lines, events, nowMin) {
  return {
    secondary_threshold_min: 30, date_label: 'Mon 14 Sep', now_min: nowMin,
    orientation: 'auto', hour12: false,
    i18n: { today: 'Today', more: '+{n} more', earlier: '+{n} earlier', rain_pct: '{n}% rain' },
    header_weather: null, legend: lines, all_day: [], events: events, weather: [],
    day_start_min: 420, day_end_min: 1320, window_label: '07:00 22:00',
    days: [{ index: 0, start_min: 0, end_min: 1440, date_label: 'Mon 14 Sep',
             weekday_label: 'Monday', weather: null }],
  };
}

// Each scenario says which cars it expects and what each must be doing:
// `on` is the rail (a line key, or a spur of it) the car has to stand on,
// `turned` whether the rail is sloping there.
var SCENARIOS = [
  { name: 'flat', metro: day([line('a', 'Ann'), line('b', 'Ben')], [ev('Lunch', 'a', 720, 780)], 600),
    cars: { a: { on: 'a', turned: false }, b: { on: 'b', turned: false } } },
  // Two events too close to share a rail: one of them takes a shelf, and
  // the clock is put inside whichever did (see `onSpur`).
  { name: 'shelf', metro: day([line('a', 'Ann'), line('b', 'Ben')],
      [ev('Standup', 'a', 600, 615), ev('Planning', 'a', 630, 720)], null),
    cars: { a: { on: 'a', spur: true, turned: false }, b: { on: 'b', turned: false } }, onSpur: 'a' },
  { name: 'tie-spur', metro: day([line('a', 'Ann'), line('b', 'Ben')],
      [ev('School Run', 'b', 480, 510, ['a'])], 495),
    cars: { a: { on: 'a', turned: false }, b: { on: 'b', spur: true, turned: false } } },
  { name: 'group', metro: day([line('a', 'Ann'), line('b', 'Ben'), line('c', 'Cy')],
      [ev('School Day', 'a', 510, 900, ['b'])], 700),
    cars: { c: { on: 'c', turned: false } }, groupCar: true, none: ['a', 'b'] },
  // A day with no quiet stretch, so the scale is linear and the strip can
  // turn the lead's x back into an exact minute.
  { name: 'lead', metro: day([line('a', 'Ann'), line('b', 'Ben'), line('c', 'Cy')],
      [ev('On call', 'a', 420, 1320), ev('Dinner', 'b', 1080, 1260, ['c'])], null),
    cars: { b: { on: 'b', turned: true } }, atLead: 'b' },
  { name: 'before-upright', metro: day([line('a', 'Ann'), line('b', 'Ben')],
      [ev('Standup', 'a', 600, 615), ev('Planning', 'a', 630, 720)], 626),
    cars: { a: { on: 'a', turned: false } } },
];

// What runs inside the page once the board is drawn.
var PROBE = String(function () {
  function angleOf(g) {
    var m = /rotate\(([-\d.]+)\)/.exec(g.getAttribute('transform') || '');
    return m ? parseFloat(m[1]) : 0;
  }
  function anchorOf(g) {
    var m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(g.getAttribute('transform') || '');
    if (m) return [parseFloat(m[1]), parseFloat(m[2])];
    var r = g.querySelector('rect');   // a standing panel's car is a block
    return r ? [parseFloat(r.getAttribute('x')) + parseFloat(r.getAttribute('width')) / 2 + 1.5,
                parseFloat(r.getAttribute('y')) + parseFloat(r.getAttribute('height')) / 2] : null;
  }
  // The rail nearest the point, sampled along its drawn path, and its slope
  // there: read off the path the viewer sees, not off any polyline.
  function railUnder(p, owner, wantSpur) {
    var best = null;
    document.querySelectorAll('path[data-metro-role]').forEach(function (el) {
      var role = el.getAttribute('data-metro-role');
      if (role !== 'track' && role !== 'spur') return;
      if (el.getAttribute('data-metro-owner') !== owner) return;
      if (!!wantSpur !== (role === 'spur')) return;
      var L = el.getTotalLength();
      for (var s = 0; s <= L; s += 0.5) {
        var q = el.getPointAtLength(s);
        var d = Math.hypot(q.x - p[0], q.y - p[1]);
        if (!best || d < best.d) {
          var q0 = el.getPointAtLength(Math.max(0, s - 3)), q1 = el.getPointAtLength(Math.min(L, s + 3));
          best = { d: d, x: q.x, y: q.y, role: role,
                   deg: Math.atan2(q1.y - q0.y, q1.x - q0.x) * 180 / Math.PI };
        }
      }
    });
    return best;
  }
  var out = { cars: {}, group: [] };
  document.querySelectorAll('g[data-metro-role="car"]').forEach(function (g) {
    var owner = g.getAttribute('data-metro-owner'), p = anchorOf(g);
    if (!p) return;
    var rec = { x: p[0], y: p[1], deg: angleOf(g),
                trunk: railUnder(p, owner, false), spur: railUnder(p, owner, true),
                box: (function () { var r = g.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })() };
    if (/^e\d/.test(owner)) out.group.push(rec); else out.cars[owner] = rec;
  });
  // Where each line's spurs run flat, in page x, for the shelf scenario.
  out.spurs = {};
  document.querySelectorAll('path[data-metro-role="spur"]').forEach(function (el) {
    var L = el.getTotalLength(), xs = [];
    for (var s = 0; s <= L; s += 2) {
      var q0 = el.getPointAtLength(Math.max(0, s - 2)), q1 = el.getPointAtLength(Math.min(L, s + 2));
      if (Math.abs(q1.y - q0.y) < 0.1 * Math.abs(q1.x - q0.x)) xs.push(el.getPointAtLength(s).x);
    }
    var k = el.getAttribute('data-metro-owner');
    out.spurs[k] = (out.spurs[k] || []).concat(xs);
  });
  // Where a line's rail is sloping, in page x, for the lead scenario.
  out.slopes = {};
  document.querySelectorAll('path[data-metro-role="track"]').forEach(function (el) {
    var L = el.getTotalLength(), xs = [];
    for (var s = 0; s <= L; s += 2) {
      var q0 = el.getPointAtLength(Math.max(0, s - 2)), q1 = el.getPointAtLength(Math.min(L, s + 2));
      if (Math.abs(q1.y - q0.y) > 0.6 * Math.abs(q1.x - q0.x) && Math.abs(q1.x - q0.x) > 0.5) xs.push(el.getPointAtLength(s).x);
    }
    out.slopes[el.getAttribute('data-metro-owner')] = xs;
  });
  var c = document.querySelector('.metro-canvas');
  out.debug = c && c.getAttribute('data-metro-debug');
  // The hour strip's scale, so a page x can be turned back into a minute.
  var hs = []; document.querySelectorAll('[data-metro-hour]').forEach(function (el) {
    var r = el.getBoundingClientRect(); hs.push([parseInt(el.getAttribute('data-metro-hour'), 10), r.left + r.width / 2]);
  });
  out.hours = hs;
  document.title = JSON.stringify(out);
});

function render(metro, name) {
  var p = fs.readFileSync(BUILT, 'utf8');
  p = p.split('https://trmnl.com/css/3.3.1/plugins.css').join('file://' + CSS);
  p = p.split('https://trmnl.com/js/3.3.1/plugins.js').join('file://' + JS);
  p = p.replace(/class="screen([^"]*)"/, function (m, r) { return 'class="screen' + r + ' screen--og"'; });
  p = p.replace(/window\.METRO = \{[\s\S]*?\};\n/, 'window.METRO = ' + JSON.stringify(metro) + ';\n');
  p = p.replace('</body>', '<script>window.onerror=function(m){document.title="ERR "+m};'
    + 'setTimeout(function(){try{(' + PROBE + ')()}catch(e){document.title="ERR "+e}},1500);</script></body>');
  var html = path.join(OUT, name + '.html');
  fs.writeFileSync(html, p);
  var args = ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
              '--window-size=800,480', '--virtual-time-budget=9000'];
  var shot = path.join(OUT, name + '.png');
  execFileSync(CHROME, args.concat(['--screenshot=' + shot, 'file://' + html]), { stdio: 'ignore' });
  var dom = execFileSync(CHROME, args.concat(['--dump-dom', 'file://' + html]),
                         { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
  var m = dom.match(/<title>(.*?)<\/title>/s);
  var t = (m && m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')) || '';
  if (/^ERR/.test(t)) throw new Error(name + ': the page failed: ' + t);
  return { got: JSON.parse(t), shot: shot };
}

// A minute for the lead scenario: the middle of the sloping stretch of the
// rail, read off a first render and turned back into a minute by the strip.
function minuteAt(x, hours) {
  hours.sort(function (p, q) { return p[1] - q[1]; });
  for (var i = 1; i < hours.length; i++) {
    if (x >= hours[i - 1][1] && x <= hours[i][1]) {
      var t = (x - hours[i - 1][1]) / (hours[i][1] - hours[i - 1][1]);
      return Math.round(hours[i - 1][0] * 60 + t * (hours[i][0] - hours[i - 1][0]) * 60);
    }
  }
  return null;
}

function run() {
  // The cars are off on the board for now (bands.js); the scenarios stay,
  // and run when asked for: CARS=1 node test/visual/cars.js. The page
  // draws cars only when its spec says `cars: true`, so this test switches
  // them on in the payload it hands over.
  if (!process.env.CARS) { console.log('  skipped: cars are off for now (CARS=1 to run)'); return; }
  fs.mkdirSync(OUT, { recursive: true });
  var failed = 0;
  SCENARIOS.forEach(function (sc) {
    var why = [];
    var metro = sc.metro;
    if (sc.atLead) {
      // The clock inside the lead: read where the rail slopes, put the
      // clock in the middle of it, and look again -- the clock is itself
      // paper the scale keeps at full rate, so moving it moves the lead a
      // little, and a few rounds settle it.
      for (var round = 0; round < 6; round++) {
        var first = render(metro, sc.name + '-probe').got;
        var xs = first.slopes[sc.atLead] || [];
        if (!xs.length) { why.push('no sloping stretch on ' + sc.atLead); break; }
        var run0 = [xs[0]]; for (var i = 1; i < xs.length && xs[i] - xs[i - 1] < 4; i++) run0.push(xs[i]);
        var mid = (run0[0] + run0[run0.length - 1]) / 2;
        var carAt = first.cars[sc.atLead];
        // Settled once the car is on the run and the rail under it is
        // plainly sloping, not on the rounded corner into it.
        if (carAt && carAt.x >= run0[0] && carAt.x <= run0[run0.length - 1]
            && carAt.trunk && Math.abs(carAt.trunk.deg) > 25) break;
        var min = minuteAt(mid, first.hours);
        if (min == null) { why.push('could not turn x ' + mid + ' into a minute'); break; }
        metro.now_min = min;
      }
    }
    if (sc.onSpur) {
      var probe = render(metro, sc.name + '-probe').got;
      var sx = probe.spurs[sc.onSpur] || [];
      if (!sx.length) why.push('no spur on ' + sc.onSpur);
      else {
        metro.now_min = minuteAt((sx[0] + sx[sx.length - 1]) / 2, probe.hours);
        if (metro.now_min == null) why.push('could not turn the spur\'s x into a minute');
      }
    }
    var r = why.length ? null : render(metro, sc.name);
    var got = r && r.got;
    if (got) {
      Object.keys(sc.cars).forEach(function (k) {
        var want = sc.cars[k], car = got.cars[k];
        if (!car) { why.push('no car for ' + k); return; }
        var rail = want.spur ? car.spur : car.trunk;
        if (!rail) { why.push(k + ': no ' + (want.spur ? 'spur' : 'rail') + ' under the car'); return; }
        if (rail.d > 2.5) why.push(k + ': the car stands ' + rail.d.toFixed(1) + 'px off its ' + rail.role);
        var off = Math.abs(car.deg - rail.deg);
        if (off > 4) why.push(k + ': the car is turned ' + car.deg.toFixed(1) + ' degrees on a rail sloping ' + rail.deg.toFixed(1));
        if (want.turned && Math.abs(car.deg) < 20) why.push(k + ': the car is level on a sloping rail');
        if (!want.turned && Math.abs(car.deg) > 4) why.push(k + ': the car is turned ' + car.deg.toFixed(1) + ' degrees on a level rail');
      });
      (sc.none || []).forEach(function (k) { if (got.cars[k]) why.push(k + ' has a car of its own inside the group'); });
      if (sc.groupCar && !got.group.length) why.push('no car on the group');
    }
    if (why.length && got && process.env.DEBUG) console.log(JSON.stringify({ cars: got.cars, slopes: got.slopes, hours: got.hours, now: metro.now_min }));
    var mark = why.length ? 'FAIL' : ' ok ';
    console.log('  ' + mark + ' ' + sc.name + (why.length ? ': ' + why.join('; ') : '')
                + (r ? '  (' + path.relative(ROOT, r.shot) + ')' : ''));
    if (why.length) failed++;
  });
  console.log('\n' + (SCENARIOS.length - failed) + ' ok, ' + failed + ' failing');
  process.exit(failed ? 1 : 0);
}

run();
