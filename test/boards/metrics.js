'use strict';

// A CAPTION'S SIZE WITHOUT A BROWSER, from the real faces' advances.
//
// `metrics.json` is written by `calibrate.js` in Chromium: every printable
// character's advance in each class a caption is built from, per device class,
// with the padding that class and the caption box carry. This builds the same
// forms `solver/measure-dom.js` builds -- the same tiers, the same fold, the
// same cut at the width cap -- and sums the table instead of asking the DOM.
//
// THE BOX, NOT THE LETTERS. What the solver is handed is the width of the
// caption's BOX: the widest row, plus that row's own padding, plus the box's.
// Summing advances alone answered five to sixteen per cent narrow -- "School
// Run" ruled at 78 and drawn at 90 -- and a narrow answer is the dangerous
// one, because the paper it does not ask for is handed to somebody else and
// the suite then passes boards the panel draws on top of each other.
//
// Every width here is rounded the way `offsetWidth` rounds, so the answer is
// the integer the DOM would have given for the same rows.

var path = require('path');
var TABLE = require('./metrics.json');
var MD = require(path.join(__dirname, '../../solver/measure-dom'));

// The letters alone, fractional: the sum of the advances, with no padding.
// BY CHARACTER AND NOT BY CODE UNIT: an emoji is a surrogate pair, and
// counted as two unknown characters a birthday cake was charged two capital
// Ms -- eleven pixels of room nobody needed.
function widthOf(t, s) {
  var n = 0;
  Array.from(String(s)).forEach(function (ch) {
    if (t.w[ch] != null) n += t.w[ch];
    // anything outside the basic plane is an emoji or a symbol, and square
    else if (ch.codePointAt(0) > 0xffff) n += t.w.emoji != null ? t.w.emoji : t.w.M * 2;
    else n += t.w.M;
  });
  return n;
}

// One block row, as the DOM would measure it: its letters plus the class's
// own padding (`metro-hour` and `metro-terminus` carry six).
//
// ROUNDED THE WAY `offsetWidth` ROUNDS, to nearest, because this number is
// not only a reservation: it is also what decides whether a caption is too
// wide for its cap and has to be cut. Rounded up "for safety" it was a
// pixel over the cap on a caption the panel draws whole, and the bins came
// out as "Restaf…" on a board where Chromium fits "Restafval · GF(t)/
// keukenafval". A hair wide is safe in a reservation and wrong in a
// decision, and the same number is used for both.
function rowWidth(t, s) {
  return Math.round(widthOf(t, s) + (t.pad || 0));
}

// Where a name folds is `measure-dom`'s answer, not a second copy of it: this
// ruler exists to give the same forms as the browser one without a browser,
// and two implementations of the fold is two boards.
function foldFor(t, title) {
  if (!t.fold) return null;
  return t.fold > 2 ? MD.foldInto(title, t.fold) : MD.foldTitle(title);
}

function measure(o) {
  var dev = TABLE[o.dev || (o.base >= 18 ? 'x' : 'og')];
  var maxW = o.maxWidth || 240;
  function timeText(ev) { return MD.timeText(ev, o.clock, o.hour12); }
  function tableFor(cls) {
    if (/metro-time-tag/.test(cls)) return dev.time;
    if (/text--small/.test(cls)) return dev.small;
    if (/text--large/.test(cls)) return dev.large;
    return dev.title;
  }
  // The caption box round a set of rows: an inline row runs on after the line
  // before it, an en space apart, so it widens that line rather than adding
  // one of its own.
  function lineWidths(rows) {
    var lines = [];
    rows.forEach(function (r) {
      var t = tableFor(r.cls);
      var wd = widthOf(t, r.text);
      if (/metro-inline/.test(r.cls) && lines.length) {
        lines[lines.length - 1] += wd + (t.w[' '] != null ? t.w[' '] : widthOf(t, ' ') * 2);
      } else {
        lines.push(wd + (t.pad || 0));
      }
    });
    return lines;
  }
  function boxWidth(rows) {
    var pad = rows.length ? (tableFor(rows[0].cls).boxPad || 0) : 0;
    return Math.round(Math.max.apply(null, lineWidths(rows)) + pad);
  }
  function fn(ev) {
    var title = ev.title || '';
    var forms = [];
    MD.tiersFor(o.large, !!(ev.parts && ev.parts.length > 1), ev.crowd ? ev.crowd.length : 0,
                o.standing).forEach(function (t) {
      var halves = foldFor(t, title);
      if (t.fold && (!halves || ev.stack)) return;
      var rows = MD.stackRows(ev, t, halves, function (part) { return part.start_min != null ? timeText(part) : null; });
      if (!rows.length) return;
      var ti = MD.titleRow(rows);
      var w = boxWidth(rows);
      var capW = t.clip ? Math.round(maxW * t.clip) : maxW;
      // the clip test is the title ROW's own width, as measure-dom asks it
      if (t.clip && rowWidth(tableFor(rows[ti].cls), rows[ti].text) <= capW) return;
      if (w > capW) {
        var tail = rows[ti].tail || '', cut = rows[ti].text.slice(0, rows[ti].text.length - tail.length);
        var tb = tableFor(rows[ti].cls);
        while (cut.length > 1) {
          rows[ti].text = cut + '…' + tail;
          // a crowded stretch is cut row by row, everything else by the box
          if (ev.crowd ? rowWidth(tb, rows[ti].text) <= capW : boxWidth(rows) <= capW) break;
          cut = cut.slice(0, -1);
        }
        // a crowded stretch: each row cut to the width on its own (measure-dom)
        if (ev.crowd) rows.forEach(function (r) {
          var t2 = tableFor(r.cls);
          if (r.tail || rowWidth(t2, r.text) <= capW) return;
          var c2 = r.text;
          while (c2.length > 1 && rowWidth(t2, c2 + '…') > capW) c2 = c2.slice(0, -1);
          r.text = c2 + '…';
        });
        w = boxWidth(rows);
      }
      var h = rows.reduce(function (n, r) { return /metro-inline/.test(r.cls) ? n : n + tableFor(r.cls).h; }, 0);
      forms.push({ w: w, h: h, size: t.size, rung: t.rung,
                   text: ev.stack ? title : halves ? rows[0].text + ' ' + rows[1].text : rows[ti].text,
                   rows: rows.map(function (r) { return r.text; }),
                   rowCls: rows.map(function (r) { return r.cls; }) });
    });
    return forms;
  }
  // The plugin's own `plain`: the single-row, full-size form, box and all.
  fn.plain = function (title) {
    return { w: boxWidth([{ cls: 'metro-title-text text--base text--bold', text: String(title) }]), h: dev.title.h };
  };
  fn.done = function () {};
  return fn;
}

module.exports = { measure: measure, widthOf: widthOf, rowWidth: rowWidth, TABLE: TABLE };
