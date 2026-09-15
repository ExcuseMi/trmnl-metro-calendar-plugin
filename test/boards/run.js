'use strict';

// THE LAYOUT QUESTIONS THAT NEED NO BROWSER.
//
//   node test/boards/run.js [substring]
//
// Same shape as `test/layout/run.js` -- `test(name, fn, {known})`, the same
// helpers, reports in the same units -- over boards built by `board.js`, the
// solver and the renderer in node. A case lives here when it asks about the
// drawing's geometry; it stays in test/layout when it asks about the words in
// the real face, the header, the banner, the framework's engines or a slot
// cropping the page. See board.js for the line between the two.

var fs = require('fs');
var path = require('path');
var B = require('./board');

var tests = [];
function test(name, fn, opts) { tests.push({ name: name, fn: fn, known: opts && opts.known }); }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEqual(actual, expected, msg) {
  var a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error((msg ? msg + ': ' : '') + 'expected ' + e + ', got ' + a);
}
function inflate(r, by) { return { x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by }; }
function overlap(a, b) {
  var ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  var oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return ox > 0 && oy > 0 ? { w: ox, h: oy, area: ox * oy } : null;
}
function pointIn(p, r) { return p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.y && p[1] <= r.y + r.h; }
function hasClass(label, cls) { return (' ' + label.cls + ' ').indexOf(' ' + cls + ' ') >= 0; }
function pathsWhere(rep, role) { return rep.paths.filter(function (p) { return p.role === role; }); }
function deepestIntrusion(pts, box) {
  var worst = 0;
  pts.forEach(function (p) {
    if (!pointIn(p, box)) return;
    worst = Math.max(worst, Math.min(p[0] - box.x, box.x + box.w - p[0], p[1] - box.y, box.y + box.h - p[1]));
  });
  return worst;
}

// The views the layout suite renders most, by the same names.
var VIEWPORTS = ['og-landscape', 'x-landscape', 'x-portrait', 'og-half'].map(function (n) {
  return { name: n };
});
function layout(f, v, extra) { return B.layout(f, v && v.name ? v.name : v, extra); }

var helpers = {
  layout: layout, VIEWPORTS: VIEWPORTS, VIEWS: B.VIEWS, build: B.build,
  fixtures: require('../layout/fixtures'),
  overlap: overlap, inflate: inflate, pointIn: pointIn, hasClass: hasClass,
  pathsWhere: pathsWhere, deepestIntrusion: deepestIntrusion,
  assert: assert, assertEqual: assertEqual,
};

fs.readdirSync(path.join(__dirname, 'cases')).sort().forEach(function (file) {
  if (file.endsWith('.js')) require(path.join(__dirname, 'cases', file))(test, helpers);
});

var only = process.argv[2], pass = 0, fail = 0, known = 0, t0 = Date.now();

// SOLVE ON EVERY CORE FIRST. The cases ask for boards one at a time; the
// boards the last run asked for (and the fixture matrix, the first time) are
// solved by a pool of child processes into the disk cache, and the serial
// pass reads them back.
function warm() {
  var jobs = B.readAsked();
  if (!jobs.length) {
    helpers.fixtures.forEach(function (f) {
      VIEWPORTS.forEach(function (v) { jobs.push({ metro: f.metro, view: v.name, extra: null }); });
    });
  }
  jobs = jobs.filter(function (j) { return !B.cached(j); });
  if (!jobs.length) return Promise.resolve(0);
  var N = Math.max(1, Math.min(jobs.length, require('os').cpus().length));
  var cp = require('child_process');
  var shards = Array.from({ length: N }, function () { return []; });
  jobs.forEach(function (j, i) { shards[i % N].push(j); });
  return Promise.all(shards.map(function (shard) {
    return new Promise(function (resolve) {
      var child = cp.fork(path.join(__dirname, 'warm.js'), [], { stdio: 'inherit' });
      child.on('exit', resolve);
      child.send(shard);
    });
  })).then(function () { return jobs.length; });
}

warm().then(function (n) {
if (n) console.log('solved ' + n + ' board(s) on ' + require('os').cpus().length + ' cores in '
  + ((Date.now() - t0) / 1000).toFixed(1) + 's');
tests.forEach(function (t) {
  if (only && t.name.indexOf(only) < 0) return;
  var err = null;
  try { t.fn(); } catch (e) { err = e; }
  if (t.known && err) { console.log('≈ ' + t.name + '\n    known: ' + t.known + '\n    ' + err.message); known++; }
  else if (t.known) { console.log('✗ ' + t.name + '\n    marked as a known issue but now passes: remove the marker'); fail++; }
  else if (err) { console.log('✗ ' + t.name + '\n    ' + (err.stack && !err.message ? err.stack : err.message)); fail++; }
  else { console.log('✓ ' + t.name); pass++; }
});
console.log('\n' + pass + '/' + (pass + known + fail) + ' passed, ' + known + ' known issue(s), '
  + fail + ' failure(s), ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
if (!only) B.rememberAsked();
process.exit(fail ? 1 : 0);
});
