'use strict';

// Does the built page actually RUN?
//
// push.sh strips and minifies both source files on the way to the device,
// and the only checks it used to make were that `trmnlp build` succeeded and
// that a marker string was present in the output. Neither of those runs a
// line of the template's script: a minifier that broke the layout would
// have pushed cleanly and drawn nothing on the panel.
//
// This renders the built page in the same headless Chromium the layout suite
// uses and insists the map actually laid itself out: the canvas publishes
// data-metro-debug when it settles, and that attribute carries the bands it
// solved. No bands, no map.
//
// Usage: node plugin/verify-build.js [path/to/full.html]

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BUILT = process.argv[2] || path.join(ROOT, 'plugin/_build/full.html');
const CACHE = path.join(ROOT, 'test/layout/.cache');
const CHROME = process.env.METRO_CHROME
  || '/home/dev/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const CSS_URL = 'https://trmnl.com/css/3.3.1/plugins.css';
const JS_URL = 'https://trmnl.com/js/3.3.1/plugins.js';

function die(msg) { console.error('verify-build: ' + msg); process.exit(1); }

// The framework stylesheet decides every text metric, so the page can only
// be judged with the real thing. Shared with the layout suite's cache.
function assets() {
  fs.mkdirSync(CACHE, { recursive: true });
  const out = {};
  for (const [name, url] of [['plugins.css', CSS_URL], ['plugins.js', JS_URL]]) {
    const file = path.join(CACHE, name);
    if (!fs.existsSync(file) || fs.statSync(file).size < 1000) {
      try {
        execFileSync('curl', ['-fsSL', '-o', file, url], { stdio: 'pipe', timeout: 120000 });
      } catch (e) {
        die('could not fetch ' + url + ' (needed for real text metrics): ' + e.message);
      }
    }
    out[name] = file;
  }
  // IN THE FACES THE DEVICE ACTUALLY HAS.
  //
  // The stylesheet's own `url("/fonts/...")` are site-absolute, so on a
  // file:// page every one of them fails and the board is measured in
  // whatever the headless browser falls back to. That is a different set of
  // widths from the panel's, and it is not a small difference: judged in the
  // fallback the demo board came back clean while the same board in the real
  // faces was dropping a whole person. The layout suite keeps a copy with
  // the faces rewritten to local files; use it when it is there.
  const local = path.join(CACHE, 'plugins.local.css');
  if (fs.existsSync(local) && fs.statSync(local).size > 1000) out['plugins.css'] = local;
  return out;
}

if (!fs.existsSync(BUILT)) die('no built page at ' + BUILT + ' (run `trmnlp build` first)');
const fw = assets();
let html = fs.readFileSync(BUILT, 'utf-8');
html = html.split(CSS_URL).join('file://' + fw['plugins.css'])
           .split(JS_URL).join('file://' + fw['plugins.js']);
// a real device size, so the layout has something to solve
html = html.replace(/class="screen([^"]*)"/, (m, rest) =>
  'class="screen' + rest + ' screen--v2 screen--lg screen--4bit screen--density-2x"');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metro-verify-'));
const file = path.join(dir, 'page.html');
fs.writeFileSync(file, html);

let dom;
try {
  dom = execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--window-size=1872,1404', '--virtual-time-budget=9000', '--dump-dom', 'file://' + file,
  ], { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024, timeout: 120000, stdio: ['ignore', 'pipe', 'ignore'] });
} catch (e) {
  die('headless Chromium could not render the page: ' + e.message);
} finally {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
}

// THE SCRIPT SAYS WHEN IT FAILS, so ask that first. A solver that threw
// leaves `data-metro-error` behind, and the message in it is worth more than
// "the map never laid itself out".
const err = dom.match(/data-metro-error="([^"]*)"/);
if (err) die('the solver threw while laying the board out: '
  + err[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));

const m = dom.match(/data-metro-debug="([^"]*)"/);
if (!m) die('the page rendered but the map never laid itself out (no data-metro-debug). '
  + 'The template\'s script threw, or was broken on the way here.');
let dbg;
try {
  dbg = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
} catch (e) {
  die('data-metro-debug is present but not readable: ' + e.message);
}
// A BOARD WITH NO LINES ON IT IS NOT A BOARD. `gaps` is one entry per line
// plus the two margins, so anything under three means nothing was placed.
if (!dbg.gaps || dbg.gaps.length < 3) die('the map laid out with no lines on it');
// ...AND NOTHING A READER CANNOT READ. The solver reports its own faults, so
// a deploy can refuse a board that it knows is wrong rather than leaving it
// to be noticed on the wall. Shed names and dropped lines are DECISIONS and
// are allowed; a caption nobody can pair with a mark is not.
if (dbg.muddle > 2) die('the board has ' + dbg.muddle
  + ' name(s) a reader cannot pin to a mark; that is too many to ship');
console.log('verify-build: ok, ' + (dbg.gaps.length - 1) + ' line(s) laid out on a '
  + Math.round(dbg.W) + 'x' + Math.round(dbg.H) + ' canvas'
  + ', ' + dbg.shed + ' shed, ' + dbg.muddle + ' ambiguous'
  + ((dbg.dropped && dbg.dropped.length) ? ', ' + dbg.dropped.length + ' line(s) left out' : ''));
