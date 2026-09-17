'use strict';

// Regression tests for the METRO MAP LAYOUT — the client-side geometry in
// plugin/src/shared.liquid (band/lane placement, long events drawn on the
// track and their captions, branches, interchange capsules, terminus fan,
// hour axis).
//
// transform.js has its own suite next door (../transform); that one covers
// the data normalizer and can't see a single pixel. Everything that has
// actually broken in this plugin's layout — a caption with a line drawn
// through it, an interchange capsule falling short of a track that had
// moved, two branches of one line crossing, labels landing on top of each
// other — is geometry, and none of it was catchable until this suite.
//
// How it works: `trmnlp build` renders the real template, we swap the baked
// demo METRO for a fixture, load it in headless Chromium with the real
// TRMNL framework CSS, wait for the layout to settle, and have the page
// report every drawn thing in one coordinate space (screen px, relative to
// the canvas). SVG paths are SAMPLED via getPointAtLength, so a curved or
// rounded path is checked as the shape it really draws rather than as its
// control points. Assertions then run out here in node.
//
// Run with: npm test  (from this directory). Needs `trmnlp` on PATH and the
// Playwright Chromium build; the framework CSS/JS are cached under .cache/.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync, execFile } = require('child_process');

const ROOT = path.join(__dirname, '../..');
const PLUGIN = path.join(ROOT, 'plugin');
const BUILT = path.join(PLUGIN, '_build');
const SRC = path.join(PLUGIN, 'src');
const CACHE = path.join(__dirname, '.cache');

const CHROME = process.env.METRO_CHROME
  || '/home/dev/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';

const CSS_URL = 'https://trmnl.com/css/3.3.1/plugins.css';
const JS_URL = 'https://trmnl.com/js/3.3.1/plugins.js';

// ---------------------------------------------------------------- framework assets

// The framework stylesheet is ~18MB and decides every text metric, so the
// layout can only be measured honestly with the real thing. Cached locally
// (.cache is gitignored); fetched once if missing.
function frameworkAssets() {
  fs.mkdirSync(CACHE, { recursive: true });
  const css = path.join(CACHE, 'plugins.css');
  const js = path.join(CACHE, 'plugins.js');
  for (const [file, url] of [[css, CSS_URL], [js, JS_URL]]) {
    if (fs.existsSync(file) && fs.statSync(file).size > 1000) continue;
    try {
      execFileSync('curl', ['-fsSL', '-o', file, url], { stdio: 'pipe', timeout: 120000 });
    } catch (e) {
      throw new Error('could not fetch ' + url + ' into ' + CACHE + ' (needed for real text metrics): ' + e.message);
    }
  }
  return { css: localizedCss(css), js };
}

// The stylesheet asks for its fonts by ABSOLUTE PATH: url("/fonts/TRMNL16-Regular.woff2").
// Loaded over file:// that resolves to file:///fonts/..., which does not
// exist, so every face silently failed and every text metric in this suite
// came from whatever Chromium fell back to.
//
// That is not a small difference. The framework sets --label-font-family to
// TRMNL16, --label-small to TRMNL12 and --title to TRMNL21: pixel fonts,
// nothing like a fallback sans in width. Every label box this suite has
// ever measured was the wrong size, consistently, which is why it looked
// fine: the tests agreed with each other and with nothing on the device.
//
// So the faces are fetched from the same host and version as the CSS, and
// a local copy of the CSS is written with the paths pointing at them.
function localizedCss(css) {
  const local = path.join(CACHE, 'plugins.local.css');
  const fontDir = path.join(CACHE, 'fonts');
  const raw = fs.readFileSync(css, 'utf-8');
  const wanted = [...new Set((raw.match(/url\("\/fonts\/[^"]+"\)/g) || [])
    .map((u) => u.slice(6, -2)))];
  fs.mkdirSync(fontDir, { recursive: true });
  const origin = CSS_URL.slice(0, CSS_URL.indexOf('/', 8));
  for (const name of wanted) {
    const file = path.join(fontDir, path.basename(name));
    if (fs.existsSync(file) && fs.statSync(file).size > 100) continue;
    try {
      execFileSync('curl', ['-fsSL', '-o', file, origin + '/fonts/' + path.basename(name)], { stdio: 'pipe', timeout: 120000 });
    } catch (e) {
      // A face that will not download is worth saying out loud rather than
      // silently measuring in a fallback, which is the bug this fixes.
      try { fs.unlinkSync(file); } catch (e2) { /* nothing written */ }
      console.error('could not fetch ' + name + ': text will be measured in a fallback face');
    }
  }
  const stamp = crypto.createHash('sha1').update(raw.length + '|' + fontDir).digest('hex');
  const marker = local + '.stamp';
  let current = '';
  try { current = fs.readFileSync(marker, 'utf-8'); } catch (e) { /* not written yet */ }
  if (current !== stamp) {
    fs.writeFileSync(local, raw.split('url("/fonts/').join('url("file://' + fontDir + '/'));
    fs.writeFileSync(marker, stamp);
  }
  return local;
}

// ---------------------------------------------------------------- page building

// The demo `data:` block in .trmnlp.yml reaches the built page TWICE: as
// the runtime `var METRO` the script lays the map out from (swapMetro below
// replaces that, which is what a fixture is), and through the Liquid tags
// that draw everything the script never touches: the header, and the
// service alert banner. A fixture cannot reach the second one at all, so a
// test about something Liquid draws needs its own BUILD, with those keys
// patched into the yml. `trmnlp build` is about a second, and each variant
// is built once for the whole run.
const YML = path.join(PLUGIN, '.trmnlp.yml');

// Insert keys into the metro mapping. It is a JSON literal embedded in the
// yml (a YAML flow mapping, so JSON-shaped lines are valid), so this needs
// no YAML parser and cannot disturb the ~600 lines already in there.
//
// AT THE END OF THE BLOCK, not the start. Inserted at the start, a patched
// key is overridden by the block's own copy of it further down, and YAML
// keeps the last of two: the demo payload grew a `service_alert: null` when
// it was regenerated, and every banner case silently rendered no banner.
function patchDemoMetro(yml, extra) {
  const at = yml.indexOf('\n  data:');
  if (at < 0) throw new Error('.trmnlp.yml has no data: block to patch');
  const open = yml.indexOf('{', at);
  let depth = 0, close = -1;
  for (let i = open; i < yml.length; i++) {
    if (yml[i] === '{') depth++;
    else if (yml[i] === '}') { depth--; if (depth === 0) { close = i; break; } }
  }
  if (close < 0) throw new Error('.trmnlp.yml data: block does not close');
  const lines = Object.keys(extra)
    .map((k) => '      ' + JSON.stringify(k) + ': ' + JSON.stringify(extra[k]) + ',').join('\n');
  return yml.slice(0, close) + ',\n' + lines + '\n    ' + yml.slice(close);
}

// One `trmnlp build` writes all four views. `page` picks which of them a
// test renders: they are the SAME template with a different `view` number,
// and the framework's typography is not the same in a quadrant as in a
// full view, so a string that fits on one line in one of them wraps in the
// other. Everything else in this suite renders `full`, which is what a
// mashup slot scales; a case about a view's own build asks for it by name.
const builtHtml = new Map();

// What `trmnlp build` reads. Hashed so a build can be cached on disk like a
// render: with the renders cached, five builds at about a second each were
// most of what a warm run still spent.
function sourceStamp() {
  const parts = [];
  for (const f of fs.readdirSync(SRC).sort()) {
    parts.push(f + ':' + crypto.createHash('sha1').update(fs.readFileSync(path.join(SRC, f))).digest('hex'));
  }
  // The yml too, and not only the patch applied to it. It is a tracked file
  // that a build reads, and a run that raced something else can leave a
  // fixture in it (see AGENTS.md): without this the cache went on serving
  // the board that was built while it was wrong, complete with the alert
  // banner, long after the file itself was put back.
  parts.push('yml:' + crypto.createHash('sha1').update(fs.readFileSync(YML)).digest('hex'));
  // AND THE HARNESS ITSELF. `patchDemoMetro` lives here, and a fix to it
  // changed what every banner case feeds the build while the cache went on
  // serving boards built by the broken one: four cases stayed red through a
  // fix that had already worked. Anything that decides what gets built
  // belongs in the key that decides whether to rebuild.
  parts.push('run:' + crypto.createHash('sha1').update(fs.readFileSync(__filename)).digest('hex'));
  return parts.join('|');
}

// A build in a COPY of the plugin, never in the tracked one.
//
// `trmnlp build` reads .trmnlp.yml and src/ from wherever it is run and
// writes _build/ there, and a build variant needs the yml PATCHED. Done in
// place, that patch is a write to a tracked source file with a restore in a
// finally, which is safe exactly as long as nothing else builds at the same
// time. Three times today something did (two suites at once, then a
// screenshot while a suite ran, then a suite I started myself after
// deleting the lock), and every time it left "service_alert" baked into
// plugin/.trmnlp.yml and drew boards with an alert banner nobody asked for.
//
// Copied, the question does not arise: each build has its own yml, its own
// src and its own _build, so any number of runs can go at once and none of
// them can touch the working tree. It costs a copy of 450KB of source.
function buildDir(liquidExtra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metro-plugin-'));
  fs.mkdirSync(path.join(dir, 'src'));
  for (const f of fs.readdirSync(SRC)) fs.copyFileSync(path.join(SRC, f), path.join(dir, 'src', f));
  const yml = fs.readFileSync(YML, 'utf-8');
  fs.writeFileSync(path.join(dir, '.trmnlp.yml'), liquidExtra ? patchDemoMetro(yml, liquidExtra) : yml);
  return dir;
}

function baseHtml(liquidExtra, page) {
  const key = (liquidExtra ? JSON.stringify(liquidExtra) : '') + '|' + (page || 'full');
  if (builtHtml.has(key)) return builtHtml.get(key);
  const stamp = crypto.createHash('sha1').update(sourceStamp() + '|' + key).digest('hex');
  const cached = path.join(BUILD_CACHE, stamp + '.html');
  if (!CACHE_OFF) {
    try {
      const hit = fs.readFileSync(cached, 'utf-8');
      builtHtml.set(key, hit);
      return hit;
    } catch (e) { /* not built yet */ }
  }
  const dir = buildDir(liquidExtra);
  let html;
  try {
    const tb = Date.now();
    execFileSync('trmnlp', ['build'], { cwd: dir, stdio: 'pipe', timeout: 120000 });
    spent.builds++;
    spent.buildMs += Date.now() - tb;
    html = fs.readFileSync(path.join(dir, '_build', (page || 'full') + '.html'), 'utf-8');
  } catch (e) {
    throw new Error('`trmnlp build` failed (is trmnlp on PATH?): ' + (e.stderr || e.message));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e2) { /* a temp dir that will not go */ }
  }
  if (!CACHE_OFF) {
    try {
      fs.mkdirSync(BUILD_CACHE, { recursive: true });
      const part = cached + '.' + process.pid + '.part';
      fs.writeFileSync(part, html);
      fs.renameSync(part, cached);
    } catch (e) { /* a cache that cannot be written is not an error */ }
  }
  builtHtml.set(key, html);
  return html;
}

// Replace the baked `var METRO = {...};` literal with a fixture. The JSON is
// emitted on one line, so scanning balanced braces from the opening one is
// exact (and beats a regex that would trip over nested objects).
function swapMetro(html, metro) {
  // Matched loosely on purpose: push.sh minifies the template's script on
  // the way to the device, which closes the spaces up. It now renames
  // identifiers too, so the marker this suite looks for is the `window.`
  // form -- a property name, which the mangler leaves alone. The template
  // writes that one first and aliases it, exactly so this keeps working and
  // the suite can measure the artefact that actually ships.
  const m = /window\.METRO\s*=\s*|var\s+METRO\s*=\s*/.exec(html);
  if (!m) throw new Error('could not find the METRO literal in the built page');
  const at = m.index;
  const open = html.indexOf('{', at + m[0].length - 1);
  let depth = 0, i = open, inStr = false, esc = false;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(0, open) + JSON.stringify(metro) + html.slice(i);
}

// Emitted into the page: waits for the layout to settle (it re-runs on a
// debounce, on fonts.ready and on resize), then reports every drawn thing in
// ONE coordinate space — screen px relative to the canvas — so label boxes
// and SVG geometry can be compared directly without worrying about the
// framework's own zoom factor.
// A THROWN LAYOUT IS NOT A BOARD, AND IT LOOKS EXACTLY LIKE ONE.
//
// The reporter below runs on its own timer, so it reports whatever is in the
// DOM whether the layout finished or not. A script that threw half way
// through leaves a board with its rails drawn and its badges missing, and
// every case reads that as a board that chose not to draw them: plausible,
// self-consistent, and wrong. Removing the header band left a reference to
// it in `alignHeaderDays`, which threw on every board with a day boundary in
// it, and the suite reported five unrelated-looking failures rather than one.
//
// So the page keeps a list of anything that threw, the report carries it, and
// a render that carries one is an error rather than a result. Installed in
// the head, before the framework and the layout are parsed.
const ERRTRAP = `
<script>
// Many pages at once on one box: the solver stops at its own count of
// arrangements (solver/fit.js), not at a clock that the load runs down.
window.METRO_SOLVE_MS = 30000;
window.__metroErrors = [];
window.addEventListener('error', function (e) {
  window.__metroErrors.push(String((e && e.message) || e) +
    (e && e.filename ? ' (' + e.filename + ':' + e.lineno + ')' : ''));
});
window.addEventListener('unhandledrejection', function (e) {
  window.__metroErrors.push('unhandled rejection: ' + String((e && e.reason) || e));
});
</script>
`;
const REPORTER = `
<script>
(function () {
  var canvas = document.querySelector('.metro-canvas');
  var svg = document.querySelector('.metro-svg');
  // every completed layout rewrites data-metro-debug, so counting writes
  // counts layouts — a view that never settles keeps climbing
  window.__metroRuns = 0;
  new MutationObserver(function () { window.__metroRuns++; })
    .observe(canvas, { attributes: true, attributeFilter: ['data-metro-debug'] });
  function report() {
    var cr = canvas.getBoundingClientRect();
    function rel(r) { return { x: r.left - cr.left, y: r.top - cr.top, w: r.width, h: r.height }; }
    var labels = [];
    canvas.querySelectorAll('.metro-gen').forEach(function (n) {
      var r = n.getBoundingClientRect();
      if (!r.width || !r.height) return;
      // WHETHER THE WORDS ACTUALLY FIT. A caption's time row is capped to
      // its column and clipped, so a range too wide is sliced mid-glyph and
      // reaches the panel as "8:15an". textContent still reports the whole
      // string, so a test reading text alone cannot see it at all.
      var tt = n.querySelector && n.querySelector('.metro-time-tag');
      labels.push(Object.assign(rel(r), { cls: n.className, text: (n.textContent || '').trim(),
        clipped: !!(tt && tt.scrollWidth > tt.clientWidth + 1) }));
    });
    function ctmPts(el, pts) {
      var m = el.getScreenCTM();
      return pts.map(function (p) {
        var x = m.a * p.x + m.c * p.y + m.e, y = m.b * p.x + m.d * p.y + m.f;
        return [x - cr.left, y - cr.top];
      });
    }
    var paths = [];
    svg.querySelectorAll('path').forEach(function (el) {
      var len = 0;
      try { len = el.getTotalLength(); } catch (e) { return; }
      var stepPx = 2, pts = [];
      for (var l = 0; l <= len; l += stepPx) pts.push(el.getPointAtLength(l));
      if (len > 0) pts.push(el.getPointAtLength(len));
      var cs = getComputedStyle(el);
      paths.push({
        role: el.getAttribute('data-metro-role') || 'other',
        owner: el.getAttribute('data-metro-owner') || null,
        // set on the rails of one shared event, so a case can ask about a
        // bundle as a set instead of guessing which branches belong together
        bundle: el.getAttribute('data-metro-bundle') || null,
        stroke: cs.stroke,
        // the drawn stroke, so a test can ask whether a ramp is in its
        // line's own style rather than only where it goes
        dash: (cs.strokeDasharray === 'none' ? '' : cs.strokeDasharray) || '',
        dashOffset: parseFloat(cs.strokeDashoffset) || 0,
        width: parseFloat(cs.strokeWidth) || 0,
        len: len,
        pts: ctmPts(el, pts)
      });
    });
    // markers drawn as a shape rather than a circle (the station junction
    // diamond) still have to sit on their line, so report them as markers
    // too — by their bounding box, whose centre is the shape's centre
    var shapeMarkers = [];
    svg.querySelectorAll('path[data-metro-role="station-ring"], line[data-metro-role="stop"]').forEach(function (el) {
      shapeMarkers.push(Object.assign(rel(el.getBoundingClientRect()), {
        role: el.getAttribute('data-metro-role'), owner: el.getAttribute('data-metro-owner') || null
      }));
    });
    var rects = [];
    svg.querySelectorAll('rect, line[data-metro-role]').forEach(function (el) {
      var r = el.getBoundingClientRect();
      var row = Object.assign(rel(r), {
        role: el.getAttribute('data-metro-role') || 'other',
        owner: el.getAttribute('data-metro-owner') || null
      });
      // A LEANING LINE IS NOT ITS BOUNDING BOX. For anything upright the two
      // are the same and a box test is the honest one; for a diagonal the
      // box is most of a triangle the ink never enters, and a case asking
      // "does this cross that" gets a yes from the empty corner. The caption
      // ticks lean by design, so a line reports its ENDS as well and a case
      // that cares can test the segment.
      if (el.tagName.toLowerCase() === 'line') {
        var m = el.getScreenCTM(), cr = canvas.getBoundingClientRect();
        var pt = function (xa, ya) {
          var x = parseFloat(el.getAttribute(xa)) || 0, y = parseFloat(el.getAttribute(ya)) || 0;
          return [m.a * x + m.c * y + m.e - cr.left, m.b * x + m.d * y + m.f - cr.top];
        };
        row.ends = [pt('x1', 'y1'), pt('x2', 'y2')];
      }
      rects.push(row);
    });
    var circles = [];
    svg.querySelectorAll('circle').forEach(function (el) {
      var r = el.getBoundingClientRect();
      circles.push(Object.assign(rel(r), {
        role: el.getAttribute('data-metro-role') || 'other',
        owner: el.getAttribute('data-metro-owner') || null
      }));
    });
    // Every drawn thing, with the paint it ACTUALLY got. An SVG shape with
    // neither stroke nor fill is in the DOM, the right size, in the right
    // place, and invisible — which is how the interchange tie disappeared.
    var painted = [];
    // The paper overlays that give a line its texture. They carry no role —
    // an overlay is not a line, it is a hole in one — so they are collected
    // separately, by the attribute that marks them.
    var overlays = [];
    svg.querySelectorAll('[data-metro-overlay]').forEach(function (el) {
      var cs = getComputedStyle(el);
      overlays.push({
        owner: el.getAttribute('data-metro-overlay') || null,
        dash: (cs.strokeDasharray === 'none' ? '' : cs.strokeDasharray) || '',
        dashOffset: parseFloat(cs.strokeDashoffset) || 0,
        width: parseFloat(cs.strokeWidth) || 0,
        stroke: cs.stroke
      });
    });
    svg.querySelectorAll('[data-metro-role]').forEach(function (el) {
      var cs = getComputedStyle(el);
      var r = el.getBoundingClientRect();
      painted.push({
        role: el.getAttribute('data-metro-role'),
        owner: el.getAttribute('data-metro-owner') || null,
        tag: el.tagName.toLowerCase(),
        stroke: cs.stroke, fill: cs.fill,
        strokeWidth: parseFloat(cs.strokeWidth) || 0,
        opacity: parseFloat(cs.opacity),
        w: r.width, h: r.height
      });
    });
    // The service banner is NOT part of the map: it is a sibling of the
    // canvas, so it takes its height off the canvas rather than covering
    // it. Reported in the same canvas-relative space as everything else,
    // together with the root that both of them share, so a case can ask
    // whether the map really gave up exactly that much room.
    // No regex here. This whole reporter is a template literal in run.js,
    // where a backslash is an escape, so an escaped bracket in a pattern
    // reaches the page unescaped: the test read as a capture group and
    // matched nothing, and every board reported a transparent background.
    function bgOf(el) {
      for (var n = el; n; n = n.parentElement) {
        var c = (getComputedStyle(n).backgroundColor || '').replace(/ /g, '');
        if (c && c !== 'transparent' && c !== 'rgba(0,0,0,0)') return getComputedStyle(n).backgroundColor;
      }
      return null;
    }
    // THE HEADER IS DRAWING TOO, and none of it is in the canvas, so none
    // of it ever reached \`labels\`. It says what day this is and what the
    // day IS (a holiday belongs to the day, not to any line, so that is
    // where it is stated), and whatever height it takes is height the map
    // was not given. Reported in the same canvas-relative space as
    // everything else: every element in it carrying a metro- class, with
    // whether it is actually shown, because the header hides parts of
    // itself by class as the view gets smaller.
    function partsOf(el) {
      if (!el) return null;
      var items = [];
      el.querySelectorAll('[class]').forEach(function (n) {
        var cls = String(n.className && n.className.baseVal != null ? n.className.baseVal : n.className);
        if (cls.indexOf('metro-') < 0) return;
        var hr = n.getBoundingClientRect();
        items.push(Object.assign(rel(hr), { cls: cls, text: (n.textContent || '').trim(),
          shown: !!(hr.width && hr.height) }));
      });
      var er = el.getBoundingClientRect();
      return Object.assign(rel(er), { shown: getComputedStyle(el).display !== 'none',
        h: er.height, w: er.width, items: items });
    }
    var head = partsOf(document.querySelector('.metro-header'));
    // THE DAY BADGE IS WHERE THE HEADER'S WORDS WENT, and like the header it
    // says more than one thing, so a case needs its PARTS rather than the one
    // run-together string \`labels\` reports for it: which day this is, what
    // the day is (a holiday belongs to the day, not to any line), and what
    // the sky is doing. It gives parts up as the axis runs out, so each one
    // carries whether it is actually drawn.
    var badges = [];
    document.querySelectorAll('.metro-daybadge').forEach(function (n) {
      badges.push(partsOf(n));
    });
    var root = document.querySelector('.metro-root');
    // The slot the board is given: .view when the framework wraps one (a
    // mashup slot takes its box from --full-w/--full-h there), else the
    // screen itself. Reported so a case can ask whether the board still
    // fits what it was given, which is the one thing a device shows by
    // silently cutting the bottom off.
    var viewEl = root.closest('.view') || document.querySelector('.screen');
    var bannerEl = document.querySelector('.metro-banner');
    var banner = null;
    if (bannerEl) {
      var bcs = getComputedStyle(bannerEl);
      // Its parts, each with the paint it got: the icon has to be drawn in
      // the band's paper, and the message is the sentence being read. How
      // that sentence's own pieces are set is reported as pieces below.
      var part = function (sel) {
        var el = bannerEl.querySelector(sel);
        if (!el) return null;
        var cs = getComputedStyle(el);
        return Object.assign(rel(el.getBoundingClientRect()), {
          text: (el.textContent || '').trim(), bg: cs.backgroundColor, bgImage: cs.backgroundImage,
          color: cs.color, fontSize: parseFloat(cs.fontSize) || 0,
          src: el.getAttribute('src'), adaptive: el.getAttribute('data-adaptive'),
          mask: cs.webkitMaskImage || cs.maskImage || ''
        });
      };
      var msg = part('.metro-banner-text');
      // ...AND HOW ITS PIECES ARE SET. transform.js hands the banner its
      // sentence split into segments -- the thing bold, the clock quiet -- and
      // the template prints each in its own span. Reported as weight and
      // colour per piece, because "is it bold" is a computed style and this is
      // the only harness that has one.
      var pieces = [];
      if (msg) {
        var textEl = bannerEl.querySelector('.metro-banner-text');
        textEl.childNodes.forEach(function (n) {
          var t = (n.textContent || '');
          if (!t.trim()) return;
          var cs2 = n.nodeType === 1 ? getComputedStyle(n) : bcs;
          pieces.push({ text: t, weight: String(cs2.fontWeight), color: cs2.color,
                        cls: n.nodeType === 1 ? n.className : '' });
        });
      }
      banner = Object.assign(rel(bannerEl.getBoundingClientRect()), {
        text: msg ? msg.text : (bannerEl.textContent || '').trim(),
        kind: bannerEl.getAttribute('data-metro-alert'),
        ink: bcs.backgroundColor, paper: bcs.color,
        radius: parseFloat(bcs.borderTopLeftRadius) || 0,
        lineHeight: parseFloat(bcs.lineHeight) || 0,
        icon: part('.metro-banner-icon'), message: msg,
        pieces: pieces
      });
    }
    // WHAT THE BOARD SAYS IS WRONG WITH ITSELF. A feed that did not answer, a
    // forecast too old to present as today's. Outside the canvas, like the
    // banner, so nothing in the labels list has ever seen one -- which is how
    // they came to be a grey footnote nobody had looked at.
    var alerts = [].slice.call(document.querySelectorAll('.metro-alerts')).map(function (el) {
      var cs = getComputedStyle(el);
      var ic = el.querySelector('.metro-alert-icon');
      return Object.assign(rel(el.getBoundingClientRect()), {
        text: (el.textContent || '').trim(), color: cs.color,
        weight: String(cs.fontWeight),
        icon: ic ? rel(ic.getBoundingClientRect()) : null
      });
    });
    var dbg = null;
    try { dbg = JSON.parse(canvas.getAttribute('data-metro-debug')); } catch (e) {}
    if (dbg) dbg.runs = window.__metroRuns || 0;
    var out = document.createElement('script');
    out.type = 'application/json';
    out.id = 'metro-report';
    out.textContent = JSON.stringify({
      canvas: { w: cr.width, h: cr.height },
      root: rel(root.getBoundingClientRect()), view: rel(viewEl.getBoundingClientRect()),
      boardBg: bgOf(canvas), banner: banner,
      debug: dbg, labels: labels, paths: paths, rects: rects, painted: painted, overlays: overlays,
      alerts: alerts,
      header: head, badges: badges, errors: (window.__metroErrors || []).slice(0, 8),
      circles: circles.concat(shapeMarkers)
    });
    document.body.appendChild(out);
  }
  // WAIT FOR THE BOARD TO STOP REDRAWING, not for a fixed delay.
  //
  // The layout debounces at 60ms and re-runs on load, on fonts, and whenever
  // its own text metrics move -- which is how it corrects a first pass laid
  // out in the fallback face. A report taken a fixed 250ms after the first
  // run catches whichever of those happened to have landed, so the same board
  // reported differently on different runs and the suite blamed the layout.
  // So: require the debug attribute, then require the run count to stand
  // still for 400ms before reading anything.
  var tries = 0, seen = -1, still = 0;
  (function wait() {
    if (++tries > 120) { report(); return; }
    if (!canvas.getAttribute('data-metro-debug')) return setTimeout(wait, 50);
    var runs = window.__metroRuns || 0;
    if (runs !== seen) { seen = runs; still = 0; } else { still++; }
    if (still < 4) return setTimeout(wait, 100);
    report();
  })();
})();
</script>
`;

function pageFor(metro, screenClasses, slot, liquidExtra, page) {
  const fw = frameworkAssets();
  let html = swapMetro(baseHtml(liquidExtra, page), metro);
  html = html.split(CSS_URL).join('file://' + fw.css).split(JS_URL).join('file://' + fw.js);
  // Add the device classes to whatever the build put on the screen element,
  // rather than matching one exact string. The bleed setting changes that
  // string (`screen--no-bleed` appears only when padding is off), and when
  // it did, this replace silently did nothing: the page rendered at a
  // default size and fifteen tests failed looking like layout bugs.
  const screenTag = /class="screen([^"]*)"/;
  if (!screenTag.test(html)) throw new Error('the built page has no .screen element to size');
  html = html.replace(screenTag, (m, rest) => 'class="screen' + rest + ' ' + screenClasses + '"');
  // A half or a quadrant is a SLOT inside the screen, not a smaller screen.
  // The framework pins .screen to the device's own size whatever the window
  // is, so asking for a 400x240 window and calling the result a quadrant
  // rendered a full 800x480 board and cropped the picture: every small-view
  // case in this suite was measuring the full board and saying otherwise.
  // `.view--full` takes its box from --full-w/--full-h, which is the one
  // knob a real mashup slot turns, so overriding those two gives the view
  // the slot's box and leaves the screen and its zoom alone.
  if (slot) {
    html = html.replace('</head>', '<style>.screen{--full-w:' + slot.w + 'px !important;'
      + '--full-h:' + slot.h + 'px !important}</style></head>');
  }
  html = html.replace('</head>', ERRTRAP + '</head>');
  return html.replace('</body>', REPORTER + '</body>');
}

// ---------------------------------------------------------------- rendering

// WHERE HEADLESS CHROMIUM LEAVES ITS SCRATCH PROFILES, AND WHY THEY ARE SWEPT
// RATHER THAN REDIRECTED.
//
// Chromium makes a scratch profile per launch and leaves it behind: thirty-two
// thousand of them had accumulated under CHROME_PROFILES at about 670KB each,
// twenty-two gigabytes of a fifty-six gigabyte disk, none of them ever read
// again. The obvious fix -- give each render its own --user-data-dir inside
// this run's temp directory -- makes every launch a FIRST run, and a first run
// on this box hangs for over a hundred seconds on a page with three words in
// it. So the profiles stay where Chromium wants them, sharing the state that
// makes a launch cheap, and the run sweeps the ones it left on the way out.
const CHROME_PROFILES = path.join(os.homedir(), '.cache', 'google-chrome-for-testing-headless');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metro-layout-'));
let renderSeq = 0;

// What the run spent, printed as one line at the end. A suite this slow
// gets optimised by guess unless it says where the time went.
// Everything under it that this run is responsible for -- which is everything,
// since nothing else on the box launches this binary. Swept at the end rather
// than as we go: a profile in use by a render still running must not vanish
// underneath it.
function sweepChromeProfiles() {
  try {
    for (const n of fs.readdirSync(CHROME_PROFILES)) {
      if (!/^scoped_dir/.test(n)) continue;
      try { fs.rmSync(path.join(CHROME_PROFILES, n), { recursive: true, force: true }); } catch (e) {}
    }
  } catch (e) { /* no such directory is the state we wanted anyway */ }
}

const spent = { renders: 0, renderMs: 0, hits: 0, disk: 0, builds: 0, buildMs: 0, warmMs: 0, warmers: 0 };

// Renders that survive the process, keyed on the EXACT bytes about to be
// rendered plus the window they are rendered into. That key is the whole
// point: the page embeds the built template, so a change to shared.liquid
// changes every key and nothing stale can come back. Editing only a test
// file changes no key at all, which is the loop this is for, and the one
// that costs the most: rewriting expectations re-renders identical boards
// every time.
//
// Under .cache, which is gitignored, beside the framework assets. Entries
// older than a week are dropped on the way in so it cannot grow forever.
// No lock any more, and none needed: a build happens in a copy of the
// plugin (see buildDir), so two runs at once share nothing they can write
// to. There was one, added the first time two suites corrupted
// plugin/.trmnlp.yml between them; isolating the build is the fix that
// lock was standing in for, and it lets runs go in parallel instead.
const REPORT_CACHE = path.join(CACHE, 'reports');
const BUILD_CACHE = path.join(CACHE, 'builds');
const CACHE_OFF = process.env.METRO_NO_CACHE === '1';
(function pruneReports() {
  if (CACHE_OFF) return;
  try {
    const week = Date.now() - 7 * 24 * 3600 * 1000;
    for (const dir of [REPORT_CACHE, BUILD_CACHE]) {
      for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f);
        if (fs.statSync(full).mtimeMs < week) fs.unlinkSync(full);
      }
    }
  } catch (e) { /* no cache yet, or nothing to prune */ }
})();

// Every render is a Chromium launch, and the cases render the same board at
// the same size over and over — a case that mutates a fixture and hands it
// to render() directly missed the (fixture, viewport) cache below entirely.
// Keyed on the CONTENT instead, every one of those is a cache hit, which is
// most of the suite's wall time.
const contentCache = new Map();
// Every (payload, viewport) a run asks for, written out at the end so the next
// run can warm exactly those in parallel (see prewarm). Declared HERE rather
// than beside prewarm because `render` below is its only writer, and the
// scratch harness re-compiles a PREFIX of this file: a declaration further
// down is cut away while the use of it is not, and every probe built on the
// harness died with "asked is not defined".
const WARM_LIST = path.join(CACHE, 'asked.json');
const asked = new Map();
function render(metro, viewport, liquidExtra) {
  const key = viewport.name + '|' + viewport.w + 'x' + viewport.h
    + '|' + (viewport.slot ? viewport.slot.w + 'x' + viewport.slot.h : 'full') + '|'
    + '|' + (viewport.page || 'full') + '|'
    + crypto.createHash('sha1').update(JSON.stringify(metro) + '|' + JSON.stringify(liquidExtra || null)).digest('hex');
  if (!contentCache.has(key)) asked.set(key, [metro, viewport, liquidExtra || null]);
  if (contentCache.has(key)) spent.hits++;
  else contentCache.set(key, renderUncached(metro, viewport, liquidExtra));
  const rep = contentCache.get(key);
  // Checked here rather than in renderUncached so a cached report cannot
  // smuggle a thrown layout past on the second case that asks for it.
  if (rep.errors && rep.errors.length) {
    throw new Error('the layout threw: ' + rep.errors.join(' | '));
  }
  return rep;
}

function renderUncached(metro, viewport, liquidExtra) {
  const html = pageFor(metro, viewport.classes, viewport.slot, liquidExtra, viewport.page);
  // The bytes AND the window AND the browser: everything that can change
  // what comes back. Hashing the finished page rather than its ingredients
  // means no ingredient can be forgotten.
  const disk = path.join(REPORT_CACHE, crypto.createHash('sha1')
    .update(html + '|' + viewport.w + 'x' + viewport.h + '|' + CHROME).digest('hex') + '.json');
  if (!CACHE_OFF) {
    try {
      const hit = JSON.parse(fs.readFileSync(disk, 'utf-8'));
      spent.disk++;
      return hit;
    } catch (e) { /* not cached, or half-written: render it */ }
  }
  const seq = renderSeq++;
  const file = path.join(tmpDir, 'page' + seq + '.html');
  fs.writeFileSync(file, html);
  const t0 = Date.now();
  const dom = execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--window-size=' + viewport.w + ',' + viewport.h,
    '--virtual-time-budget=8000', '--dump-dom', 'file://' + file,
  ], { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024, timeout: 120000, stdio: ['ignore', 'pipe', 'ignore'] });
  const m = dom.match(/<script type="application\/json" id="metro-report">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('the page produced no layout report (did the metro script throw?)');
  const rep = JSON.parse(m[1]);
  if (!rep.debug) throw new Error('the layout never published data-metro-debug');
  spent.renders++;
  spent.renderMs += Date.now() - t0;
  if (!CACHE_OFF) {
    // Written through a temp name: a run killed mid-write must not leave a
    // truncated report behind for the next one to read as a hit.
    try {
      fs.mkdirSync(REPORT_CACHE, { recursive: true });
      const part = disk + '.' + process.pid + '.part';
      fs.writeFileSync(part, JSON.stringify(rep));
      fs.renameSync(part, disk);
    } catch (e) { /* a cache that cannot be written is not an error */ }
  }
  return rep;
}

// results are reused across assertions in a case file, so render once per
// (fixture, viewport) pair and memoise
function layout(fixture, viewport, liquidExtra) { return render(fixture.metro, viewport, liquidExtra); }

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

function eventsIn(rep) { return (rep.debug.events || []).map((e) => ({
  title: e[0], side: e[1], status: e[2], lane: e[3], dir: e[4],
  nodeA: e[5], elbow: e[6], textStart: e[7], textLen: e[8], trackDist: e[9],
  merged: e[10] === 'merge', diagFrom: e[11], laneDist: e[12], sign: e[13], endA: e[14],
  // Which SHAPE it was drawn as. There are two, and nearly every claim a
  // caption test makes has to be asked differently of each: a shelf hangs
  // its name off a rail in a lane, so the name belongs beside the elbow; a
  // mark is a dot and a tick on the line itself with no rail at all, so the
  // name belongs beside the stretch of line between them. Asked the first
  // question, a mark answers with an elbow of zero and looks adrift by the
  // width of the board.
  mark: e[15] === 'mark',
  // whether its name is on the board, and whose line it is: both read off
  // the same dump so a case can ask about a caption that was shed, one that
  // was silently not drawn, and which track a solo event belongs to.
  cap: e[16], owner: e[17],
  // A CONVERGENCE IS THE THIRD SHAPE. It has no elbow, because it has no
  // rail of its own -- it is a bundle of other people's rails arriving in
  // one place -- and its name is pinned above the pill. Asked where its
  // branch is, it answers with a zero and looks adrift by the width of the
  // board, which is the same question a mark could not answer either.
  shared: e[15] === 'shared',
})); }

// ---------------------------------------------------------------- viewports

const VIEWPORTS = [
  { name: 'og-landscape', w: 800, h: 480, classes: 'screen--og screen--md screen--1bit screen--density-1x' },
  { name: 'x-landscape', w: 1872, h: 1404, classes: 'screen--v2 screen--lg screen--4bit screen--density-2x' },
  { name: 'x-portrait', w: 1404, h: 1872, classes: 'screen--v2 screen--lg screen--4bit screen--density-2x screen--portrait' },
  // a slot inside the screen, not a smaller screen: see pageFor
  { name: 'og-half', w: 800, h: 480, slot: { w: 400, h: 480 }, classes: 'screen--og screen--md screen--1bit screen--density-1x' },
];

// ---------------------------------------------------------------- tiny test runner

// A test may be registered with `{ known: 'why' }`: a defect that is real,
// understood and not fixed yet. A known issue that still fails is reported
// and does NOT fail the run; a known issue that starts PASSING does fail it,
// so a fix can't land without the marker being removed. Nothing gets to be
// quietly broken, and nothing gets to be quietly fixed.
const tests = [];
function test(name, fn, opts) { tests.push({ name, fn, known: opts && opts.known }); }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error((msg ? msg + ': ' : '') + 'expected ' + e + ', got ' + a);
}

const helpers = {
  layout, render, VIEWPORTS, fixtures: require('./fixtures'),
  overlap, inflate, pointIn, hasClass, textLabels, pathsWhere, deepestIntrusion, eventsIn,
  assert, assertEqual,
};

for (const file of fs.readdirSync(path.join(__dirname, 'cases')).sort()) {
  if (!file.endsWith('.js')) continue;
  require(path.join(__dirname, 'cases', file))(test, helpers);
}

// WARM THE CACHE ON EVERY CORE, because the suite can only read it on one.
//
// Each case calls `layout()` synchronously, so a render is one Chromium
// launched with execFileSync and waited for: on a five-core box the load
// average during a full run was 0.95, with four cores idle and the wall clock
// entirely decided by how many cold renders the run needed. The reports are
// content-addressed on disk, so they can be produced in any order by anyone.
//
// So before the cases start, the (fixture x viewport) matrix -- which is most
// of what a run asks for -- is rendered by a pool of workers, and the serial
// pass that follows reads their files. A viewport a case builds for itself is
// not in the matrix and still renders serially, which is a handful per run.
function renderAsync(metro, viewport, liquidExtra) {
  const html = pageFor(metro, viewport.classes, viewport.slot, liquidExtra, viewport.page);
  const disk = path.join(REPORT_CACHE, crypto.createHash('sha1')
    .update(html + '|' + viewport.w + 'x' + viewport.h + '|' + CHROME).digest('hex') + '.json');
  if (fs.existsSync(disk)) return Promise.resolve();
  const seq = renderSeq++;
  const file = path.join(tmpDir, 'warm' + seq + '.html');
  fs.writeFileSync(file, html);
  return new Promise((resolve) => {
    execFile(CHROME, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
      '--window-size=' + viewport.w + ',' + viewport.h,
      '--virtual-time-budget=8000', '--dump-dom', 'file://' + file,
    ], { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024, timeout: 120000 }, (err, dom) => {
      // A warm-up that fails is not a failure: the case that needs it will
      // render it again serially and report properly.
      if (err || !dom) return resolve();
      const m = dom.match(/<script type="application\/json" id="metro-report">([\s\S]*?)<\/script>/);
      if (!m) return resolve();
      try {
        const rep = JSON.parse(m[1]);
        if (!rep.debug) return resolve();
        fs.mkdirSync(REPORT_CACHE, { recursive: true });
        const part = disk + '.' + process.pid + '.' + (renderSeq++) + '.part';
        fs.writeFileSync(part, JSON.stringify(rep));
        fs.renameSync(part, disk);
      } catch (e) { /* a cache that cannot be written is not an error */ }
      resolve();
    });
  });
}

// WHAT THE LAST RUN ACTUALLY ASKED FOR, which is a better list than any
// matrix written here can be.
//
// The matrix (every fixture at every shared viewport) is most of a run and not
// all of it: the bit-depth cases ask for three more screens per fixture, the
// small-view cases for six slots, the holiday cases for a board with a holiday
// on it. Those were left to render one at a time while four cores sat idle.
//
// So a run writes down every (payload, viewport) pair it asked for, and the
// next run warms exactly those. The list survives a source change -- it names
// boards, not bytes -- while the report cache does not, which is precisely the
// case that hurts: a run right after an edit to the layout.
function rememberAsked() {
  try {
    const out = [];
    for (const v of asked.values()) out.push({ metro: v[0], viewport: v[1], extra: v[2] });
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(WARM_LIST + '.part', JSON.stringify(out));
    fs.renameSync(WARM_LIST + '.part', WARM_LIST);
  } catch (e) { /* a list that cannot be written only costs the next run time */ }
}

async function prewarm() {
  if (CACHE_OFF) return;
  let jobs = [];
  try {
    for (const j of JSON.parse(fs.readFileSync(WARM_LIST, 'utf-8'))) {
      jobs.push([j.metro, j.viewport, j.extra]);
    }
  } catch (e) { /* no list yet: fall back to the matrix below */ }
  if (!jobs.length) {
    const fx = require('./fixtures');
    for (const f of fx) for (const v of VIEWPORTS) jobs.push([f.metro, v, null]);
  }
  // HOW MANY WORKERS, and it is bounded by MEMORY rather than by cores.
  //
  // Chromium is the whole cost here and each launch is its own process, so
  // this wants a worker per core -- but a headless Chromium rendering one of
  // these boards peaks around a gigabyte, and four of them alongside the
  // serial pass had the run killed for want of memory. So: a worker per core
  // bar this one, capped by how much memory is actually free, and never fewer
  // than one.
  const perWorkerMb = 1400;
  const freeMb = os.freemem() / (1024 * 1024);
  const byMemory = Math.floor((freeMb - 2048) / perWorkerMb);
  // METRO_WARMERS overrides both, for a box under pressure from something
  // else: 0 turns the warming off and leaves the serial pass to it.
  const asked2 = process.env.METRO_WARMERS;
  const N = asked2 != null ? Math.max(0, parseInt(asked2, 10) || 0)
    : Math.max(1, Math.min(jobs.length, (os.cpus().length || 2) - 1, byMemory));
  if (!N) return;
  let next = 0;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: N }, async () => {
    while (next < jobs.length) {
      const j = jobs[next++];
      try { await renderAsync(j[0], j[1], j[2] || null); } catch (e) { /* see above */ }
    }
  }));
  spent.warmMs = Date.now() - t0;
  spent.warmers = N;
}

(async function main() {
  let pass = 0, fail = 0, known = 0;
  const only = process.argv[2];
  await prewarm();
  for (const t of tests) {
    if (only && t.name.indexOf(only) < 0) continue;
    let err = null;
    const tt0 = Date.now();
    try { await t.fn(); } catch (e) { err = e; }
    t.ms = Date.now() - tt0;
    if (t.known && err) {
      console.log('≈ ' + t.name + '\n    known: ' + t.known + '\n    ' + (err.message || err));
      known++;
    } else if (t.known && !err) {
      console.log('✗ ' + t.name + '\n    this is marked as a known issue but now passes — remove the marker');
      fail++;
    } else if (err) {
      console.log('✗ ' + t.name + '\n    ' + (err.message || err));
      fail++;
    } else {
      console.log('✓ ' + t.name);
      pass++;
    }
  }
  console.log('\n' + pass + '/' + (pass + known + fail) + ' passed, ' + known + ' known issue(s), ' + fail + ' failure(s)');
  if (process.env.METRO_TIMES) {
    const slow = tests.filter((t) => t.ms != null).sort((a, b) => b.ms - a.ms).slice(0, 25);
    console.log('\nslowest cases:');
    for (const t of slow) console.log('  ' + (t.ms / 1000).toFixed(1) + 's  ' + t.name);
    const total = tests.reduce((n, t) => n + (t.ms || 0), 0);
    console.log('  ' + (total / 1000).toFixed(1) + 's in case bodies altogether');
  }
  console.log(spent.renders + ' render(s) ' + (spent.renderMs / 1000).toFixed(1) + 's, '
    + spent.disk + ' from cache, ' + spent.hits + ' repeated, '
    + spent.builds + ' build(s) ' + (spent.buildMs / 1000).toFixed(1) + 's'
    + (spent.warmers ? ', warmed on ' + spent.warmers + ' worker(s) '
       + (spent.warmMs / 1000).toFixed(1) + 's' : '')
    + (CACHE_OFF ? ' (cache off)' : ''));
  rememberAsked();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  sweepChromeProfiles();
  process.exit(fail ? 1 : 0);
})();
