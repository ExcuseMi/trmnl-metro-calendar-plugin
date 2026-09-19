'use strict';

// THE PLUGIN'S BOARD, IN NODE, IN A FEW HUNDRED MILLISECONDS.
//
// `test/layout` builds the plugin and renders it in Chromium, which is the
// only way to ask what the words look like in the panel's own face. Most of
// what it asks is not about the words: where the rails go, where the marks
// are, which days are on the board, whether a spur leaves from its trunk.
// Those are the solver's answers and the renderer's SVG, and both are plain
// modules. So this runs the same pipeline the template runs -- `Day.specFor`,
// `Fit.fit`, `Draw.draw` -- with the same options the template computes from
// the canvas, draws into jsdom, and reports the drawing in the shape the
// layout suite's reporter does (canvas px, `paths` sampled into points,
// `circles`, `rects`), so a case can move across with its assertions intact.
//
// WHAT IT CANNOT SAY. Text is measured with a width table (`metrics.js`),
// not a browser, and HTML is never laid out: a label's box is where the
// solver placed it, and nothing the framework's engines do afterwards is
// here. A question about the real face, the header, the banner or a slot
// cropping the board stays in the layout suite.

var path = require('path');
var ROOT = path.join(__dirname, '../..');
var Day = require(path.join(ROOT, 'solver/day'));
var Fit = require(path.join(ROOT, 'solver/fit'));
var Draw = require(path.join(ROOT, 'solver/draw'));
var BoardM = require(path.join(ROOT, 'solver/board'));
var metrics = require('./metrics');
var { JSDOM } = require(path.join(ROOT, 'test/config-editor/node_modules/jsdom'));

// The canvas each view actually gets, in layout px, as the plugin reports it
// in `data-metro-debug` (W, H) on each device. Portrait and slot sizes come
// from the framework's own --full-w/--full-h, measured once.
var VIEWS = {
  'og-landscape': { W: 780, H: 459, bits: 1, dev: 'og' },
  'og-portrait': { W: 460, H: 779, bits: 1, dev: 'og' },
  'og-half-horizontal': { W: 760, H: 204, bits: 1, dev: 'og', slot: true },
  'og-half-vertical': { W: 365, H: 439, bits: 1, dev: 'og', slot: true },
  'og-quadrant': { W: 365, H: 204, bits: 1, dev: 'og', slot: true },
  'x-landscape': { W: 1020, H: 759, bits: 4, dev: 'x' },
  'x-portrait': { W: 760, H: 1019, bits: 4, dev: 'x' },
  'x-half-horizontal': { W: 1000, H: 354, bits: 4, dev: 'x', slot: true },
  'x-half-vertical': { W: 485, H: 739, bits: 4, dev: 'x', slot: true },
  'x-quadrant': { W: 485, H: 354, bits: 4, dev: 'x', slot: true },
};
// The layout suite's names for the four it renders most.
// the FULL template in a half-width slot: named at both ends
VIEWS['og-half'] = Object.assign({}, VIEWS['og-half-vertical'], { slot: false });

var cache = new Map();

function optsFor(v, metro) {
  var horiz = metro.orientation === 'vertical' ? false
    : metro.orientation === 'horizontal' ? true : v.W >= v.H;
  var along = horiz ? v.W : v.H, across = horiz ? v.H : v.W;
  var S = Math.max(0.85, Math.min(2.6, across / 440));
  var base = Math.round(13 * S);
  var rowH = Math.round(base * 0.95);
  // never shorter than the strip's own words, as the template measures it
  var dev = v.dev || (v.W >= 900 || v.H >= 900 ? 'x' : 'og');
  // (a size up on a full view lying down, as the template's probe is)
  var strip = !v.slot && horiz && metrics.TABLE[dev].strip ? metrics.TABLE[dev].strip : metrics.TABLE[dev].small;
  rowH = Math.max(rowH, strip.h + 2);
  return { horiz: horiz, along: along, across: across, S: S, base: base, rowH: rowH, dev: dev };
}

function clockFor(metro) {
  function two(n) { return (n < 10 ? '0' : '') + n; }
  return function (m) {
    var h = Math.floor(m / 60) % 24;
    if (metro.hour12) {
      var ap = h < 12 ? 'am' : 'pm', h12 = h % 12 === 0 ? 12 : h % 12;
      return h12 + (m % 60 ? ':' + two(m % 60) : '') + ap;
    }
    return two(h) + ':' + two(m % 60);
  };
}

// Samples a path's `d` (M, L, Q, A, Z, absolute) into points two px apart,
// the way the layout reporter samples with getPointAtLength.
function sample(d) {
  var toks = String(d || '').match(/[MLQAZ]|-?[\d.]+(?:e-?\d+)?/gi) || [];
  var pts = [], cur = null, start = null, i = 0, cmd = null;
  function num() { return parseFloat(toks[i++]); }
  function seg(p0, p1) {
    var n = Math.max(1, Math.ceil(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / 2));
    for (var k = 1; k <= n; k++) pts.push([p0[0] + (p1[0] - p0[0]) * k / n, p0[1] + (p1[1] - p0[1]) * k / n]);
  }
  while (i < toks.length) {
    if (/^[MLQAZ]$/i.test(toks[i])) cmd = toks[i++].toUpperCase();
    if (cmd === 'M') { cur = [num(), num()]; start = cur; pts.push(cur); cmd = 'L'; }
    else if (cmd === 'L') { var p = [num(), num()]; seg(cur, p); cur = p; }
    else if (cmd === 'Q') {
      var c = [num(), num()], e = [num(), num()];
      for (var t = 1; t <= 8; t++) {
        var u = t / 8;
        pts.push([(1 - u) * (1 - u) * cur[0] + 2 * (1 - u) * u * c[0] + u * u * e[0],
                  (1 - u) * (1 - u) * cur[1] + 2 * (1 - u) * u * c[1] + u * u * e[1]]);
      }
      cur = e;
    } else if (cmd === 'A') {
      num(); num(); num(); num(); num();
      var a2 = [num(), num()]; seg(cur, a2); cur = a2;
    } else if (cmd === 'Z') { if (start) seg(cur, start); cur = start; }
    else i++;
  }
  return pts;
}

function lengthOf(pts) {
  var n = 0;
  for (var i = 1; i < pts.length; i++) n += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return n;
}

function specOf(metro, v, o, extra) {
  var measure = metrics.measure({ dev: o.dev, base: o.base, maxWidth: Math.round(o.along * 0.3), large: !v.slot,
                                  hour12: !!metro.hour12, clock: clockFor(metro) });
  var probe = measure.plain('Mg');
  // A NAME IN ITS OWN CLASS AS WELL AS THE TITLE'S, which is what the template
  // asks: a terminus is `metro-terminus`, and that class carries six pixels of
  // padding the title row does not.
  var nameTab = metrics.TABLE[o.dev].name;
  var nameH = Math.max(Math.round(probe.h), nameTab.h);
  var nameW = {};
  (metro.legend || []).forEach(function (p) {
    var t = p.name || p.key;
    nameW[p.key] = Math.max(Math.round(measure.plain(t).w), metrics.rowWidth(nameTab, t));
  });
  // Standing up the strip is a column as thick as the clock pill (see the
  // template): the small bold face plus the pill's own inset.
  var stripThick = 0;
  if (!o.horiz) {
    var small = metrics.TABLE[o.dev].small;
    var clock = clockFor(metro);
    [10 * 60, 12 * 60, 23 * 60].forEach(function (m) {
      stripThick = Math.max(stripThick, Math.ceil(metrics.widthOf(small, clock(m)) + 6));
    });
    stripThick += Math.round(4 * o.S);
  }
  return Day.specFor(metro, { w: o.along, h: o.across }, Object.assign({
    standing: !o.horiz, stripThick: stripThick,
    nameH: nameH, nameW: nameW,
    markR: Math.round(6 * 1.15 * o.S), corner: Math.round(13 * o.S),
    edgeRing: Draw.edgeRing(o.S).reach, edgeRingR: Draw.edgeRing(o.S).r,
    pad: Math.round(4 * o.S), rowH: o.rowH, cell: Math.round(o.base * 0.55),
    measure: measure, oneName: !!v.slot,
    // a badge's words in the small bold type it is drawn in
    routeW: function (t) { return metrics.widthOf(metrics.TABLE[o.dev].route || metrics.TABLE[o.dev].small, t); },
  }, extra || {}));
}

function build(metro, viewName, extra) {
  var v = typeof viewName === 'string' ? VIEWS[viewName] : viewName;
  if (!v) throw new Error('no view ' + viewName);
  var o = optsFor(v, metro);
  var spec = specOf(metro, v, o, extra);
  var t0 = Date.now();
  var board = Fit.fit(spec, {});
  var solveMs = Date.now() - t0;
  var dom = new JSDOM('<div class="screen screen--' + v.bits + 'bit"><div class="metro-canvas"><svg></svg></div></div>');
  var doc = dom.window.document;
  var canvas = doc.querySelector('.metro-canvas');
  var svg = doc.querySelector('svg');
  var used = board.spec || spec;
  Draw.draw(board, used, { doc: doc, svg: svg, canvas: canvas, S: o.S, horizontal: o.horiz,
                           W: v.W, H: v.H, rowH: o.rowH, clock: clockFor(metro) });
  return { board: board, spec: used, svg: svg, doc: doc, view: v, o: o, solveMs: solveMs };
}

// THE REPORT, in the layout reporter's shape and units (canvas px, Z = 1).
function report(built) {
  var o = built.o;
  function X(a, c) { return o.horiz ? a : c; }
  function Y(a, c) { return o.horiz ? c : a; }
  function roleOf(el) { return el.getAttribute('data-metro-role') || 'other'; }
  function ownerOf(el) { return el.getAttribute('data-metro-owner') || null; }
  var paths = [], circles = [], rects = [];
  built.svg.querySelectorAll('path').forEach(function (el) {
    if (el.hasAttribute('data-metro-overlay')) return;
    var pts = sample(el.getAttribute('d'));
    paths.push({ role: roleOf(el), owner: ownerOf(el), len: lengthOf(pts), pts: pts,
                 width: parseFloat(el.getAttribute('stroke-width')) || 0,
                 dash: el.getAttribute('stroke-dasharray') || '' });
  });
  // THE NIGHT, WHICH NOTHING COULD SEE. It is drawn as two <rect>s per dark
  // span -- the whole of it, pale, and the deep of it inside the twilight
  // shoulders -- and neither harness reported a rect at all, so no case
  // could ask where the dark was. A dawn drawn at the paper's edge on a
  // two-day board went out on the wall.
  var nights = [];
  built.svg.querySelectorAll('rect').forEach(function (el) {
    var role = roleOf(el);
    if (role !== 'night' && role !== 'night-deep') return;
    var x = +el.getAttribute('x'), y = +el.getAttribute('y');
    var w = +el.getAttribute('width'), h = +el.getAttribute('height');
    nights.push({ role: role, x: x, y: y, w: w, h: h,
                  a0: o.horiz ? x : y, a1: o.horiz ? x + w : y + h });
  });
  built.svg.querySelectorAll('circle').forEach(function (el) {
    var cx = +el.getAttribute('cx'), cy = +el.getAttribute('cy'), r = +el.getAttribute('r');
    circles.push({ role: roleOf(el), owner: ownerOf(el), x: cx - r, y: cy - r, w: 2 * r, h: 2 * r });
  });
  built.svg.querySelectorAll('line').forEach(function (el) {
    var x1 = +el.getAttribute('x1'), y1 = +el.getAttribute('y1');
    var x2 = +el.getAttribute('x2'), y2 = +el.getAttribute('y2');
    var row = { role: roleOf(el), owner: ownerOf(el), x: Math.min(x1, x2), y: Math.min(y1, y2),
                w: Math.abs(x2 - x1), h: Math.abs(y2 - y1), ends: [[x1, y1], [x2, y2]],
                // a <line> can be dotted too: the approach out of a connector
                // that stands before the board's first minute is
                dash: el.getAttribute('stroke-dasharray') || '' };
    rects.push(row);
    if (row.role === 'stop') circles.push(row);
  });
  // LABELS ARE WHERE THE SOLVER PUT THEM: a caption's box, a line's name, a
  // note. The classes are the ones the drawing gives each kind, so a case
  // filtering by class filters the same things.
  var labels = [];
  function box(a0, a1, c0, c1) {
    return { x: X(a0, c0), y: Y(a0, c0), w: X(a1, c1) - X(a0, c0), h: Y(a1, c1) - Y(a0, c0) };
  }
  built.board.caps.forEach(function (cp) {
    var b = cp.box();
    labels.push(Object.assign(box(b.a0, b.a1, b.c0, b.c1), {
      cls: 'metro-label', text: (cp.rows || [cp.text]).join(''), id: cp.id, line: cp.line }));
  });
  (built.board.fixed || []).forEach(function (f) {
    var cls = { terminus: 'metro-terminus', note: 'metro-axis-note', sky: 'metro-sky',
                weather: 'metro-sky', date: 'metro-date' }[f.kind];
    if (!cls) return;
    // A HEAD CARRYING A ROUTE ROW IS TWO ROWS INSIDE ONE BOOKING, and the
    // two are reported the way they are drawn: the word on top in its own
    // width, the badge under it in the row's. Reported as one box the width
    // of the badge, "Sam" measured two hundred pixels wide and every rule
    // about where the name is was asking about paper the word is not on --
    // and the badge, added BELOW the booking, was reported over its own rail.
    // ...AND THE BADGE IS THE ROW FURTHER FROM THE RAIL, one line of it or
    // two: the name sits against its rail, so above the rail it is the
    // booking's bottom row and below the rail its top one.
    var nb = f.route ? Math.max(1, (f.rows || 2) - 1) : 0;
    var nameShare = (f.c1 - f.c0) / (1 + 0.85 * nb);
    var ownL = built.board.lineByKey(f.line);
    var railAt = ownL ? ownL.cAt(f.at == null ? built.spec.axis.a1 : f.at) : null;
    var below = railAt != null && f.c0 >= railAt;
    var nc0 = f.route && !below ? f.c1 - nameShare : f.c0;
    var nc1 = f.route && below ? f.c0 + nameShare : f.c1;
    var na0 = f.a0, na1 = f.a1;
    // THE WORD, WHATEVER ELSE THE BOOKING HOLDS. A head's box is the widest
    // of its two rows plus the clearance the legend's column keeps between
    // the last letter and the rail's first mark; reported whole, the word
    // measured fifteen pixels wider than it is drawn and every rule about
    // what it touches was asking about paper it is not on.
    if (f.nameW != null) {
      if (f.align === 'right') na0 = f.a1 - f.nameW; else na1 = f.a0 + f.nameW;
    }
    labels.push(Object.assign(box(na0, na1, nc0, nc1), { cls: cls, text: f.text, line: f.line, id: f.id }));
    if (f.route) {
      var rc0 = below ? nc1 : f.c0, rc1 = below ? f.c1 : nc0;
      labels.push(Object.assign(box(f.a0, f.a1, rc0, rc1),
                                { cls: 'metro-route', text: f.route, line: f.line, id: f.id + ':route',
                                  lines: f.routeLines || [f.route] }));
    }
  });
  var b = built.board, spec = built.spec;
  return {
    canvas: { w: built.view.W, h: built.view.H },
    paths: paths, circles: circles, rects: rects, labels: labels, nights: nights,
    board: b, spec: spec,
    debug: {
      W: built.view.W, H: built.view.H, S: o.S, Z: 1, horizontal: o.horiz,
      ms: { solve: built.solveMs }, shed: b.shed, muddle: b.muddle, dropped: b.dropped || [],
      faults: BoardM.check(b).map(function (f) {
        return f.kind + ': ' + (f.what || '') + (f.with ? ' / ' + f.with : '') + (f.by ? ' / ' + f.by : '');
      }),
      drawn: b.drawn, gaps: Array.prototype.slice.call(b.gaps || []).map(Math.round),
      win: [spec.metro.day_start_min, spec.metro.day_end_min],
      days: (spec.metro.days || []).length || 1,
      midnights: (spec.cuts || []).map(function (a) { return [a, a]; }),
    },
  };
}

// ---------------------------------------------------------------- the cache
//
// A solve is the whole cost here -- the five- and seven-line days take two or
// three seconds a view with no clock on the search -- so a report is kept on
// disk, keyed by every source that could change it, and the board inside it
// is REBUILT from plain data rather than solved again: the spec is recomputed
// (cheap and deterministic), the lines the fit dropped are dropped again, each
// want wears the form and rail it wore, and the Board gets its lines, stops,
// captions, bars and furniture back through its own constructors.
var fs = require('fs');
var crypto = require('crypto');
var CACHE_DIR = path.join(__dirname, '.cache');
var stamp = null;
function sourceStamp() {
  if (stamp) return stamp;
  var hsh = crypto.createHash('sha1');
  ['solver', 'test/boards'].forEach(function (dir) {
    fs.readdirSync(path.join(ROOT, dir)).sort().forEach(function (f) {
      if (/\.(js|json)$/.test(f)) hsh.update(f + fs.readFileSync(path.join(ROOT, dir, f)));
    });
  });
  stamp = hsh.digest('hex');
  return stamp;
}
function keyOf(metro, viewName, extra) {
  return crypto.createHash('sha1').update(sourceStamp() + JSON.stringify(metro)
    + '|' + JSON.stringify(viewName) + '|' + JSON.stringify(extra || {})).digest('hex');
}

var PLAIN = ['shed', 'muddle', 'drawn', 'gaps', 'dropped', 'forms', 'wanted', 'tried', 'bumps'];
function freeze(built, rep) {
  var b = built.board;
  return {
    board: {
      axis: b.axis, cross: b.cross, cuts: b.cuts,
      lines: b.lines.map(function (l) { return { key: l.key, pts: l.pts, width: l.width, branchOf: l.branchOf, ink: l.ink, style: l.style }; }),
      stops: b.stops.map(function (t) { return { line: t.line, a: t.a, c: t.c, kind: t.kind, todo: t.todo }; }),
      caps: b.caps.map(function (c) { return { id: c.id, pill: c.pill, text: c.text, line: c.line, a: c.a, c: c.c, w: c.w, h: c.h, at: c.at, rows: c.rows, size: c.size, rowCls: c.rowCls }; }),
      pills: b.pills.map(function (p) { return { id: p.id, a: p.a, a0: p.a0, a1: p.a1, lines: p.lines, c0: p.c0, c1: p.c1, r: p.r, to: p.to, ends: p.ends, todo: p.todo, open0: p.open0, open1: p.open1, initials: p.initials, tie: p.tie, joins: p.joins }; }),
      fixed: b.fixed.map(function (f) { return Object.assign({}, f); }),
      plain: PLAIN.reduce(function (o, k) { o[k] = b[k]; return o; }, {}),
    },
    wants: built.spec.wants.map(function (w) { return { id: w.id, rail: w._rail || null, form: w.form }; }),
    // WHETHER THE LEGEND TOOK ITS COLUMN. The spec is recomputed on the way
    // back in, and `fit` decides the gutter by solving (see fit.js), so a
    // board frozen with one would be rebuilt against an axis starting a
    // name's width earlier than the one its captions were placed on.
    gutter: !!built.spec.nameGutter,
    solveMs: built.solveMs,
    rep: { canvas: rep.canvas, paths: rep.paths, circles: rep.circles, rects: rep.rects,
           labels: rep.labels, nights: rep.nights, debug: rep.debug },
  };
}
function thaw(data, metro, viewName, extra) {
  var v = typeof viewName === 'string' ? VIEWS[viewName] : viewName;
  var o = optsFor(v, metro);
  var spec = specOf(metro, v, o, extra);
  if (data.gutter && spec.regut) spec = spec.regut();
  var dropped = data.board.plain.dropped || [];
  if (dropped.length) spec = Fit.withoutLines(spec, dropped);
  var byId = {};
  data.wants.forEach(function (w) { byId[w.id] = w; });
  spec.wants = spec.wants.filter(function (w) { return byId[w.id]; });
  spec.wants.forEach(function (w) {
    var d = byId[w.id];
    if (d.rail) w._rail = d.rail;
    w.wear(d.form || 0);
  });
  var b = new BoardM.Board({ axis: data.board.axis, cross: data.board.cross, cuts: data.board.cuts });
  data.board.lines.forEach(function (l) { b.addLine(l); });
  data.board.stops.forEach(function (t) { b.addStop(t); });
  data.board.caps.forEach(function (c) { b.addCap(c); });
  data.board.pills.forEach(function (p) { b.addPill(p); });
  data.board.fixed.forEach(function (f) { b.addFixed(f); });
  Object.assign(b, data.board.plain);
  b.spec = spec;
  return Object.assign({}, data.rep, { board: b, spec: spec });
}

// One board per fixture and view, solved once however many cases ask.
var asked = new Map();
function layout(fixture, viewName, extra) {
  var metro = fixture.metro || fixture;
  var key = keyOf(metro, viewName, extra);
  asked.set(key, { metro: metro, view: viewName, extra: extra || null });
  if (cache.has(key)) return cache.get(key);
  var file = path.join(CACHE_DIR, key + '.json'), rep = null;
  if (!process.env.METRO_NO_CACHE) {
    try { rep = thaw(JSON.parse(fs.readFileSync(file, 'utf-8')), metro, viewName, extra); } catch (e) { rep = null; }
  }
  if (!rep) {
    var built = build(metro, viewName, extra);
    rep = report(built);
    try {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(file + '.' + process.pid, JSON.stringify(freeze(built, rep)));
      fs.renameSync(file + '.' + process.pid, file);
    } catch (e) { /* a cache that cannot be written only costs time */ }
  }
  cache.set(key, rep);
  return rep;
}

// WHAT A RUN ASKED FOR, written down so the next run can solve exactly those
// boards on every core before the cases start (see run.js).
var ASKED = path.join(CACHE_DIR, 'asked.json');
function rememberAsked() {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(ASKED, JSON.stringify(Array.from(asked.values())));
  } catch (e) { /* only costs the next run time */ }
}
function readAsked() {
  try { return JSON.parse(fs.readFileSync(ASKED, 'utf-8')); } catch (e) { return []; }
}
function cached(job) {
  return fs.existsSync(path.join(CACHE_DIR, keyOf(job.metro, job.view, job.extra) + '.json'));
}

module.exports = { rememberAsked: rememberAsked, readAsked: readAsked, cached: cached,
                   VIEWS: VIEWS, layout: layout, build: build, report: report, sample: sample, keyOf: keyOf };
