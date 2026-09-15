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
  large: 'metro-title-text text--large text--bold',
  strip: 'metro-hour label text--bold',
  small: 'metro-title-text text--small text--bold',
  name: 'metro-terminus label label--base text--bold text--black',
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
  Object.keys(CLASSES).forEach(function (k) {
    var box = document.createElement('div');
    box.className = 'metro-gen metro-label text--black';
    box.style.position = 'absolute'; box.style.left = '-9999px'; box.style.whiteSpace = 'nowrap';
    var span = document.createElement('span');
    span.className = CLASSES[k];
    span.style.display = 'inline-block';
    box.appendChild(span);
    canvas.appendChild(box);
    var w = {};
    for (var c = 32; c < 127; c++) {
      var ch = String.fromCharCode(c);
      span.textContent = 'M' + ch + 'M';
      var withM = span.offsetWidth;
      span.textContent = 'MM';
      w[ch] = withM - span.offsetWidth;
    }
    ['\\u2013', '\\u2026', '\\u00b7', '\\u00e9', '\\u00fc'].forEach(function (ch) {
      span.textContent = 'M' + ch + 'M'; var a = span.offsetWidth;
      span.textContent = 'MM'; w[ch] = a - span.offsetWidth;
    });
    span.textContent = 'Mg';
    span.style.display = 'block';
    out[k] = { w: w, h: span.offsetHeight };
    box.remove();
  });
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
  console.log(dev, 'title Mg h', table[dev].title.h, 'M', table[dev].title.w.M, 'i', table[dev].title.w.i);
}
fs.writeFileSync(path.join(__dirname, 'metrics.json'), JSON.stringify(table));
console.log('wrote test/boards/metrics.json');
