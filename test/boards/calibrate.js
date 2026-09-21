'use strict';

// THE WIDTH TABLE `metrics.js` READS, measured in the real faces.
//
// Run by hand when the framework version or the label classes change:
//   node test/boards/calibrate.js
//
// It takes the most recent build the layout suite cached (so the plugin's
// own stylesheet is in it), sizes the screen as each device class, and asks
// Chromium for the advance of every printable ASCII character in each of the
// classes a caption is built from, plus each row's height. Kerning is not in
// a per-character table and does not need to be: these are pixel faces.
//
// WHAT A CAPTION IS AS WIDE AS, all three parts of it:
//
//   * the ADVANCES, fractional. `offsetWidth` is a rounded integer, and a
//     character measured as the difference of two rounded numbers is up to
//     half a pixel out. Read that way, every lower-case letter on the X came
//     back a quarter of a pixel short and a sixteen-character caption was
//     four pixels narrower than the panel draws it. Measured here over a run
//     of the character with `getBoundingClientRect`, which is fractional, and
//     divided by the screen's own scale, which is not 1 on the X.
//   * each row class's own PADDING. `metro-hour` and `metro-terminus` carry
//     six pixels of it, so a name was ruled six narrower than it is drawn.
//   * the caption BOX's padding round the rows, another six.
//
// A sum of advances alone is the narrowest of the three answers, and a narrow
// answer is the dangerous one: it hands paper to somebody else, and the board
// suite then passes a board that is tighter than the panel can draw.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '../..');
const CACHE = path.join(ROOT, 'test/layout/.cache');
const CHROME = process.env.METRO_CHROME || '/home/dev/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const CSS_URL = 'https://trmnl.com/css/3.3.1/plugins.css';
const JS_URL = 'https://trmnl.com/js/3.3.1/plugins.js';

const DEVICES = {
  og: { classes: 'screen--og screen--md screen--1bit screen--density-1x', w: 800, h: 480 },
  x: { classes: 'screen--v2 screen--lg screen--4bit screen--density-2x', w: 1872, h: 1404 },
};
const CLASSES = {
  title: 'metro-title-text text--base text--bold',
  time: 'metro-time-tag text--small text--bold',
  // the time row under an xlarge name (measure-dom's TIME_BIG_CLS)
  timeBig: 'metro-time-tag text--base text--bold',
  large: 'metro-title-text text--large text--bold',
  // the step above, taken on a panel the size of the X (measure-dom's XL tiers)
  xlarge: 'metro-title-text text--xlarge text--bold',
  strip: 'metro-hour label text--bold',
  small: 'metro-title-text text--small text--bold',
  name: 'metro-terminus metro-pill label label--base text--bold',
  // a line's badge, in the type it is drawn in (draw.js, the route row)
  route: 'metro-route metro-pill metro-pill--quiet label label--small text--bold',
};

const builds = path.join(CACHE, 'builds');
const newest = fs.readdirSync(builds).filter((f) => f.endsWith('.html'))
  .map((f) => path.join(builds, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
if (!newest) throw new Error('no cached build: run the layout suite once first');

const probe = `<script>
window.addEventListener('load', function () { setTimeout(function () {
  var canvas = document.querySelector('.metro-canvas');
  var CLASSES = ${JSON.stringify(CLASSES)};
  var out = {};
  // One layout pixel in screen pixels: the X's screen is scaled, and
  // getBoundingClientRect answers in screen pixels where offsetWidth and
  // every number the solver works in are layout pixels.
  var host = document.createElement('div');
  host.style.position = 'absolute'; host.style.left = '-9999px'; host.style.top = '0';
  canvas.appendChild(host);
  var ruler = document.createElement('div');
  ruler.style.width = '100px';
  host.appendChild(ruler);
  var SCALE = ruler.getBoundingClientRect().width / 100 || 1;
  ruler.remove();

  var RUN = 30;
  Object.keys(CLASSES).forEach(function (k) {
    // IN THE BOX THAT WILL DRAW IT (measure-dom builds the same one), so the
    // padding measured here is the padding the board pays for.
    var box = document.createElement('div');
    box.className = 'metro-gen metro-label absolute text--black text-stroke';
    box.style.position = 'static';
    var span = document.createElement('span');
    span.className = CLASSES[k];
    span.style.display = 'block';
    box.appendChild(span);
    host.appendChild(box);
    function rect(t) { span.textContent = t; return span.getBoundingClientRect().width / SCALE; }

    var pad = rect('');                 // the row class's own left and right padding
    var boxPad = box.offsetWidth - pad; // the caption box's padding round the row
    // A RUN OF THE CHARACTER BETWEEN Ms, not one character between two Ms:
    // over thirty of them the fraction is recovered, and the Ms keep a space
    // from collapsing away to nothing (" " is a real character here).
    var base = rect(new Array(RUN + 1).join('M'));
    var w = {};
    function advance(ch) {
      var run = '';
      for (var i = 0; i < RUN; i++) run += 'M' + ch;
      // both strings carry the row's padding, so it cancels in the difference
      return Math.round(((rect(run) - base) / RUN) * 1000) / 1000;
    }
    for (var c = 32; c < 127; c++) w[String.fromCharCode(c)] = advance(String.fromCharCode(c));
    // The punctuation the board sets itself (en dash, ellipsis, middle dot,
    // en space, curly quote) and the accented letters European calendars are
    // full of. An unmeasured character is charged a capital M, which on
    // "Pr\\u00e4parierkurs" was ten pixels of room nobody needed.
    ('\\u2013\\u2026\\u00b7\\u2019\\u2002\\u00a0\\u00ab\\u00bb\\u201c\\u201d\\u2018'
      + '\\u00e0\\u00e1\\u00e2\\u00e3\\u00e4\\u00e5\\u00e6\\u00e7\\u00e8\\u00e9\\u00ea\\u00eb'
      + '\\u00ec\\u00ed\\u00ee\\u00ef\\u00f1\\u00f2\\u00f3\\u00f4\\u00f5\\u00f6\\u00f8'
      + '\\u00f9\\u00fa\\u00fb\\u00fc\\u00fd\\u00ff\\u00df'
      + '\\u00c0\\u00c1\\u00c2\\u00c4\\u00c5\\u00c6\\u00c7\\u00c8\\u00c9\\u00ca\\u00cb'
      + '\\u00cd\\u00ce\\u00cf\\u00d1\\u00d3\\u00d4\\u00d6\\u00d8\\u00da\\u00dc'
      + '\\u0105\\u0107\\u0119\\u0142\\u0144\\u015b\\u017a\\u017c\\u0104\\u0141\\u015a\\u017b')
      .split('').forEach(function (ch) { w[ch] = advance(ch); });
    // ONE EMOJI STANDS FOR ALL OF THEM. They are square and all much of a
    // width, and what matters is not charging one as a letter: a cake read as
    // a capital M was four pixels short of the room it takes.
    w.emoji = advance('\\ud83c\\udf82');
    span.textContent = 'Mg';
    out[k] = { w: w, h: span.offsetHeight, pad: Math.round(pad * 1000) / 1000, boxPad: boxPad };
    box.remove();
  });
  host.remove();
  document.title = 'METRICS' + JSON.stringify(out);
}, 1500); });
</script>`;

const table = {};
for (const [dev, d] of Object.entries(DEVICES)) {
  let html = fs.readFileSync(newest, 'utf-8')
    .split(CSS_URL).join('file://' + path.join(CACHE, 'plugins.local.css'))
    .split(JS_URL).join('file://' + path.join(CACHE, 'plugins.js'))
    .replace(/class="screen([^"]*)"/, (m, rest) => 'class="screen' + rest + ' ' + d.classes + '"')
    .replace('</body>', probe + '</body>');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metro-cal-'));
  const page = path.join(dir, 'p.html');
  fs.writeFileSync(page, html);
  const dom = execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--window-size=' + d.w + ',' + d.h,
    '--virtual-time-budget=20000', '--dump-dom', 'file://' + page], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  fs.rmSync(dir, { recursive: true, force: true });
  const m = /<title>METRICS(.*?)<\/title>/.exec(dom);
  if (!m) throw new Error(dev + ': the probe reported nothing');
  table[dev] = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
  console.log(dev, 'title Mg h', table[dev].title.h, 'M', table[dev].title.w.M, 'i', table[dev].title.w.i,
    'pad', table[dev].title.pad, 'boxPad', table[dev].title.boxPad);
}
fs.writeFileSync(path.join(__dirname, 'metrics.json'), JSON.stringify(table));
console.log('wrote test/boards/metrics.json');
