'use strict';

// WHAT THE WIDTH TABLE SHOULD SAY, measured in the page itself.
//
// test/boards/metrics.json is the width table test/boards and the sweep's old
// node harness lay boards out with (`test/boards/metrics.js`). This runs IN THE
// PAGE, inside the plugin's canvas, and measures what that table holds: the
// advance of every character the board sets, in each class a caption is built
// from, plus each row's height and padding. The method is calibrate.js's,
// unchanged; only where it runs moved, from a file:// page dumped with
// --dump-dom (no frames, so the framework's engines never ran) to the page
// TRMNL renders.
//
// WHAT A CAPTION IS AS WIDE AS, all three parts of it:
//   * the ADVANCES, fractional: measured over a run of the character with
//     getBoundingClientRect and divided by the screen's own scale, which is
//     not 1 on the X (offsetWidth is rounded, and a character measured as the
//     difference of two rounded numbers is up to half a pixel out).
//   * each row class's own PADDING (`metro-hour`, `metro-terminus` carry it).
//   * the caption BOX's padding round the rows.

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
  route: 'metro-route metro-pill metro-pill--quiet label text--bold',
};

// Runs in the page: { <class key>: { w: { char: advance }, h, pad, boxPad } }
function measure(CLASSES) {
  var canvas = document.querySelector('.metro-canvas');
  var out = {};
  var host = document.createElement('div');
  host.style.position = 'absolute'; host.style.left = '-9999px'; host.style.top = '0';
  canvas.appendChild(host);
  // One layout pixel in screen pixels: the X's screen is scaled.
  var ruler = document.createElement('div');
  ruler.style.width = '100px';
  host.appendChild(ruler);
  var SCALE = ruler.getBoundingClientRect().width / 100 || 1;
  ruler.remove();
  var RUN = 30;
  Object.keys(CLASSES).forEach(function (k) {
    // IN THE BOX THAT WILL DRAW IT (measure-dom builds the same one)
    var box = document.createElement('div');
    box.className = 'metro-gen metro-label absolute text--black text-stroke';
    box.style.position = 'static';
    var span = document.createElement('span');
    span.className = CLASSES[k];
    span.style.display = 'block';
    box.appendChild(span);
    host.appendChild(box);
    function rect(t) { span.textContent = t; return span.getBoundingClientRect().width / SCALE; }
    var pad = rect('');
    var boxPad = box.offsetWidth - pad;
    // a run of the character between Ms: the fraction is recovered over
    // thirty of them, and the Ms keep a space from collapsing away
    var base = rect(new Array(RUN + 1).join('M'));
    var w = {};
    function advance(ch) {
      var run = '';
      for (var i = 0; i < RUN; i++) run += 'M' + ch;
      return Math.round(((rect(run) - base) / RUN) * 1000) / 1000;
    }
    for (var c = 32; c < 127; c++) w[String.fromCharCode(c)] = advance(String.fromCharCode(c));
    // the punctuation the board sets itself and the accented letters
    // European calendars are full of
    ('–…·’  «»“”‘'
      + 'àáâãäåæçèéêë'
      + 'ìíîïñòóôõöø'
      + 'ùúûüýÿß'
      + 'ÀÁÂÄÅÆÇÈÉÊË'
      + 'ÍÎÏÑÓÔÖØÚÜ'
      + 'ąćęłńśźżĄŁŚŻ')
      .split('').forEach(function (ch) { w[ch] = advance(ch); });
    // one emoji stands for all of them
    w.emoji = advance('🎂');
    span.textContent = 'Mg';
    out[k] = { w: w, h: span.offsetHeight, pad: Math.round(pad * 1000) / 1000, boxPad: boxPad };
    box.remove();
  });
  host.remove();
  return out;
}

module.exports = { CLASSES, measure };
