'use strict';

// THE LAYOUT SUITE'S HARNESS, ON trmnlp-test.
//
// test/layout/run.js used to build the plugin with `trmnlp build`, swap a
// fixture into the baked `var METRO`, rewrite the framework's font paths so
// file:// could find them, add the device classes by hand, launch a headless
// Chromium per render with --dump-dom and parse a report out of the DOM.
// trmnlp-test does all of that the way TRMNL does it: the fixture goes in as
// the template's data (`data.*`, through trmnlp's own Liquid, so the header
// and the banner see the same payload the script does), the page gets the
// device's real screen classes, palette, orientation and mashup slot, and the
// framework's faces come from its cache. What is left here is the plugin's own
// vocabulary: the viewports the cases were written against, the report
// (./page.js), a memo, and the geometry helpers the cases share.
//
// Cases are written as before -- `module(test, h)` with `test(name, fn,
// { known })` -- but a render is async now, so a case says `await
// layout(...)`. `cases()` registers them as Playwright tests.

const crypto = require('crypto');
const { test } = require('trmnlp-test');
const { HEAD, report } = require('./page');
const { cached } = require('./cache');

// ---------------------------------------------------------------- viewports

// The device classes the cases were written with, and what they are on
// trmnlp-test: the OG on a 1-bit panel is `og_png`, the X is `v2` (16 greys,
// 1872x1404, laid out at 1040x780 css px and zoomed ~1.8x by the framework).
const OG = 'screen--og screen--md screen--1bit screen--density-1x';
const X = 'screen--v2 screen--lg screen--4bit screen--density-2x';

const VIEWPORTS = [
  { name: 'og-landscape', w: 800, h: 480, classes: OG },
  { name: 'x-landscape', w: 1872, h: 1404, classes: X },
  { name: 'x-portrait', w: 1404, h: 1872, classes: X + ' screen--portrait' },
  // a slot inside the screen, not a smaller screen: see renderOptions
  { name: 'og-half', w: 800, h: 480, slot: { w: 400, h: 480 }, classes: OG },
];

// A viewport (as the cases write it) as trmnlp-test render options.
//
// A half or a quadrant is a SLOT inside the screen, not a smaller screen. The
// framework pins .screen to the device's own size whatever the window is, so
// asking for a 400x240 window and calling the result a quadrant rendered a
// full 800x480 board and cropped the picture. Two ways to get a slot:
//
//   `page: 'quadrant'`  the view's own template in TRMNL's real mashup slot
//                       (trmnlp-test's `view`), which is what a device draws.
//   `slot: {w, h}`      the FULL template in a box of that size: `.view--full`
//                       takes its box from --full-w/--full-h, the one knob a
//                       real mashup turns, so overriding those gives the view
//                       the slot's box and leaves the screen and its zoom
//                       alone. trmnlp-test has no option for a slot of an
//                       arbitrary size, so this one goes in through `head`.
function renderOptions(v) {
  const c = ' ' + (v.classes || '') + ' ';
  const x = c.indexOf(' screen--v2 ') >= 0;
  const bits = (/ screen--(\d)bit /.exec(c) || [])[1];
  let device = x ? 'v2' : 'og_png';
  let palette;
  if (x) palette = bits === '1' ? 'bw' : bits === '2' ? 'gray-4' : undefined;
  else if (bits === '2') { device = 'og_plus'; palette = 'gray-4'; }
  else if (bits === '4') { device = 'og_plus'; palette = 'gray-4'; }
  const view = v.page || 'full';
  let head = HEAD;
  if (v.slot && view === 'full') {
    head += '<style>.screen{--full-w:' + v.slot.w + 'px !important;--full-h:' + v.slot.h + 'px !important}</style>';
  }
  const o = { device, view, head, note: v.name };
  if (palette) o.palette = palette;
  if (c.indexOf(' screen--portrait ') >= 0) o.orientation = 'portrait';
  return o;
}

// ---------------------------------------------------------------- rendering

// The trmnl fixture of the test that is running, set by `cases()`.
const ctx = { trmnl: null, plugin: null };

// A render is a page in trmnlp-test's Chromium and a few seconds of solving,
// and the cases ask for the same board at the same size over and over. Memoised
// per worker on the exact payload and options, and on disk across workers and
// runs (./cache.js), so ten tests on one board cost one render.
const memo = new Map();
let renders = 0;

async function render(metro, viewport, liquidExtra, pluginDir) {
  // The extra reaches the template's data as well as the script's payload:
  // with trmnlp-test they are one and the same, `data`.
  const data = liquidExtra ? Object.assign({}, metro, liquidExtra) : metro;
  const opts = renderOptions(viewport);
  const dir = pluginDir || ctx.plugin;
  const t = dir ? ctx.trmnl.plugin(dir) : ctx.trmnl;
  const key = crypto.createHash('sha1')
    .update(JSON.stringify(data) + '|' + JSON.stringify(opts) + '|' + t.dir).digest('hex');
  if (!memo.has(key)) {
    const p = cached(t.dir, { data, opts }, async () => {
      // trmnlpYml: false, or .trmnlp.yml's baked demo payload would be
      // deep-merged under the fixture and lend it keys it does not have.
      const screen = await t.render(Object.assign({}, opts, { data: { data: data }, transform: false, trmnlpYml: false }));
      renders++;
      // the page stays open until the test ends: trmnlp-test attaches its
      // picture to a failing test, then closes it
      return report(screen);
    });
    memo.set(key, p);
    p.catch(() => memo.delete(key));
  }
  return memo.get(key);
}

function layout(fixture, viewport, liquidExtra) { return render(fixture.metro, viewport, liquidExtra); }
// the same, from another copy of the plugin (the squeezed one, see shipped.js)
function layoutOf(pluginDir, fixture, viewport, liquidExtra) { return render(fixture.metro, viewport, liquidExtra, pluginDir); }

// ---------------------------------------------------------------- geometry helpers

function inflate(r, by) { return { x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by }; }
function overlap(a, b) {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return ox > 0 && oy > 0 ? { w: ox, h: oy, area: ox * oy } : null;
}
function pointIn(p, r) { return p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.y && p[1] <= r.y + r.h; }

function hasClass(label, cls) { return (' ' + label.cls + ' ').indexOf(' ' + cls + ' ') >= 0; }
// the text boxes a reader is meant to read: event captions, terminus names,
// hour ticks and the sky band
function textLabels(rep) {
  return rep.labels.filter((l) => hasClass(l, 'metro-label') || hasClass(l, 'metro-terminus')
    || hasClass(l, 'metro-hour') || hasClass(l, 'metro-sky') || hasClass(l, 'metro-axis-note'));
}
function pathsWhere(rep, role) { return rep.paths.filter((p) => p.role === role); }

// how far a path strays inside a box, in px — 0 when it never enters it
function deepestIntrusion(pathPts, box) {
  let worst = 0;
  for (const p of pathPts) {
    if (!pointIn(p, box)) continue;
    const d = Math.min(p[0] - box.x, box.x + box.w - p[0], p[1] - box.y, box.y + box.h - p[1]);
    worst = Math.max(worst, d);
  }
  return worst;
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error((msg ? msg + ': ' : '') + 'expected ' + e + ', got ' + a);
}

const helpers = {
  layout, layoutOf, render, VIEWPORTS, fixtures: require('../../layout/fixtures'),
  overlap, inflate, pointIn, hasClass, textLabels, pathsWhere, deepestIntrusion,
  assert, assertEqual, OG, X,
};

// ---------------------------------------------------------------- registering cases

// `test(name, fn, { known: 'why' })` as the old runner had it: a defect that
// is real, understood and not fixed yet. It is reported and does not fail the
// run; if it starts PASSING it fails, so a fix cannot land without the marker
// coming off. That is Playwright's test.fail().
//
// Each case module is one describe block named after its file, so `-g band`
// picks a file's cases; the tests spread over the workers, and the disk cache
// keeps two workers from solving the same board twice.
function cases(name, body, { plugin } = {}) {
  test.describe(name, () => {
    const t = (title, fn, opts) => {
      test(title, async ({ trmnl }) => {
        if (opts && opts.known) test.fail(true, opts.known);
        ctx.trmnl = trmnl;
        ctx.plugin = plugin || null;
        await fn();
      });
    };
    body(t, helpers);
  });
}

// For a spec that renders boards without registering through cases().
function useTrmnl(trmnl, plugin) { ctx.trmnl = trmnl; ctx.plugin = plugin || null; }

module.exports = { cases, helpers, render, layout, renderOptions, useTrmnl, VIEWPORTS, rendersSoFar: () => renders };
