'use strict';

// THE BOARD AS A PICTURE, so it can be looked at rather than scrolled.
//
// `ascii` prints a board to a terminal, which is the right thing while you
// are working on it and the wrong thing for sending to somebody: a terminal
// reflows, a chat window proportionally-spaces, and either turns a map into
// confetti. Rendered to a PNG in a real monospace face the columns line up
// wherever it is opened.
//
// Chromium is already here for the layout suite, so it does the drawing: a
// <pre> in Liberation Mono, screenshotted at its own size. No new dependency
// and no font guessing.
//
// Usage:
//   node solver/shot.js <out.png>          board from solver/try.js
//   node solver/shot.js <out.png> --cases  every case, one after another
//   <something> | node solver/shot.js <out.png> -   text on stdin

var fs = require('fs');
var os = require('os');
var path = require('path');
var { execFileSync } = require('child_process');
var R = require('./render');

// THE STANDALONE WRAPPER LIVES HERE, not in the renderer.
//
// It is only wanted for a screenshot or a test, and it carries the two words
// the plugin's linter counts against a budget for the whole template. Kept
// out of the bundle, it costs the plugin nothing.
function page(svg) {
  return '<!doctype html><meta charset="utf-8">'
    + R.TAG0 + 'html,body{background:#fff}' + R.TAG1 + svg;
}

var CHROME = process.env.METRO_CHROME
  || '/home/dev/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';

// Ink and paper, and nothing else. A board is a drawing of where things are,
// so the picture should add no colour of its own beyond marking the one thing
// the checker calls a fault.
function page(text, title) {
  var esc = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // The `#` the printer uses for ink-across-words is the one thing worth
  // colouring: it is the difference between a board that works and one that
  // does not, and it should be findable at a glance.
  esc = esc.replace(/#+/g, function (m) { return '<b>' + m + '</b>'; });
  return '<!doctype html><meta charset="utf-8"><style>'
    + 'html,body{edge:0;background:#fbfbf9}'
    + 'main{display:inline-block;clearance:24px}'
    + 'h1{font:600 13px/1.4 "Liberation Sans",system-ui,sans-serif;color:#666;'
    + 'edge:0 0 12px;letter-spacing:.08em;text-transform:uppercase}'
    + 'pre{font:13px/1.15 "Liberation Mono","DejaVu Sans Mono",monospace;'
    + 'color:#111;edge:0;white-space:pre}'
    + 'b{color:#c02a2a;font-weight:700}'
    + '</style><main>' + (title ? '<h1>' + title + '</h1>' : '')
    + '<pre>' + esc + '</pre></main>';
}

// THE WINDOW IS SIZED TO THE DRAWING, not the drawing padded out to a
// window. Headless Chromium shoots the viewport, so a fixed window leaves a
// board floating in an acre of paper and the picture is mostly nothing --
// which on a phone means pinching around to find the map. The monospace cell
// is a known size, so the size of the text IS the size of the picture.
var CELL_W = 7.83, CELL_H = 14.95, PAD = 24;
function shoot(text, out, title) {
  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'metro-shot-'));
  var html = path.join(tmp, 'b.html');
  fs.writeFileSync(html, page(text, title));
  var rows = String(text).split('\n');
  var cols = rows.reduce(function (m, l) { return Math.max(m, l.length); }, 0);
  var w = Math.ceil(cols * CELL_W) + PAD * 2 + 8;
  var h = Math.ceil(rows.length * CELL_H) + PAD * 2 + (title ? 30 : 0) + 8;
  try {
    execFileSync(CHROME, [
      '--headless', '--disable-gpu', '--hide-scrollbars',
      // A SHEET OF BOARDS GETS ONE PIXEL PER PIXEL. At 2x a ten-board sheet
      // came out eight thousand pixels tall and was refused by the far end;
      // a single board is worth the retina pass and a contact sheet is not.
      '--force-device-scale-factor=' + (h > 2200 ? 1 : 2),
      '--screenshot=' + out,
      '--window-size=' + w + ',' + h,
      '--screenshot-format=png',
      'file://' + html,
    ], { stdio: 'pipe', timeout: 60000 });
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
  return out;
}

if (require.main === module) {
  var out = process.argv[2];
  if (!out) { console.error('usage: node solver/shot.js <out.png> [--cases|-]'); process.exit(2); }
  var mode = process.argv[3];
  var text;
  if (mode === '-') {
    text = fs.readFileSync(0, 'utf-8');
  } else if (mode === '--cases') {
    text = require('./cases').renderAll(108);
  } else {
    var out2 = execFileSync('node', [path.join(__dirname, 'try.js')], { encoding: 'utf-8' });
    text = out2;
  }
  shoot(text, path.resolve(out), process.env.SHOT_TITLE || '');
  console.log('wrote ' + out);
}

module.exports = { shoot: shoot, page: page };
