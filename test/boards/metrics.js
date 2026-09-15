'use strict';

// A CAPTION'S SIZE WITHOUT A BROWSER, from the real faces' advances.
//
// `metrics.json` is written by `calibrate.js` in Chromium: every printable
// character's width in each class a caption is built from, per device class.
// This builds the same forms `solver/measure-dom.js` builds -- the same tiers,
// the same fold, the same cut at the width cap -- and sums the table instead
// of asking the DOM. It is within a pixel or two of the panel, which is what a
// solver question needs and not what a question about the words does.

var path = require('path');
var TABLE = require('./metrics.json');
var MD = require(path.join(__dirname, '../../solver/measure-dom'));

function widthOf(t, s) {
  var n = 0;
  String(s).split('').forEach(function (ch) { n += t.w[ch] != null ? t.w[ch] : t.w.M; });
  return n;
}

function foldTitle(title) {
  var words = String(title).trim().split(/\s+/);
  if (words.length < 2) return null;
  var best = null, bestD = Infinity;
  for (var i = 1; i < words.length; i++) {
    var a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
    var d = Math.abs(a.length - b.length);
    if (d < bestD) { bestD = d; best = [a, b]; }
  }
  return best;
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
  function fn(ev) {
    var title = ev.title || '';
    var forms = [];
    MD.tiersFor(o.large, !!(ev.parts && ev.parts.length > 1), ev.crowd ? ev.crowd.length : 0).forEach(function (t) {
      var halves = t.fold ? foldTitle(title) : null;
      if (t.fold && (!halves || ev.stack)) return;
      var rows = MD.stackRows(ev, t, halves, function (part) { return part.start_min != null ? timeText(part) : null; });
      if (!rows.length) return;
      var ti = MD.titleRow(rows);
      function widthNow() {
        // an inline row runs on after the line before it, an en space apart
        var lines = [];
        rows.forEach(function (r) {
          var wd = widthOf(tableFor(r.cls), r.text);
          if (/metro-inline/.test(r.cls) && lines.length) lines[lines.length - 1] += wd + widthOf(tableFor(r.cls), ' ') * 2;
          else lines.push(wd);
        });
        return Math.max.apply(null, lines);
      }
      var w = widthNow();
      var capW = t.clip ? Math.round(maxW * t.clip) : maxW;
      if (t.clip && widthOf(tableFor(rows[ti].cls), rows[ti].text) <= capW) return;
      if (w > capW) {
        var tail = rows[ti].tail || '', cut = rows[ti].text.slice(0, rows[ti].text.length - tail.length), tb = tableFor(rows[ti].cls);
        while (cut.length > 1 && widthOf(tb, cut + '…' + tail) > capW) cut = cut.slice(0, -1);
        rows[ti].text = cut + '…' + tail;
        // a crowded stretch: each row cut to the width on its own (measure-dom)
        if (ev.crowd) rows.forEach(function (r) {
          var t2 = tableFor(r.cls);
          if (r.tail || widthOf(t2, r.text) <= capW) return;
          var c2 = r.text;
          while (c2.length > 1 && widthOf(t2, c2 + '…') > capW) c2 = c2.slice(0, -1);
          r.text = c2 + '…';
        });
        w = widthNow();
      }
      var h = rows.reduce(function (n, r) { return /metro-inline/.test(r.cls) ? n : n + tableFor(r.cls).h; }, 0);
      forms.push({ w: w, h: h, size: t.size, rung: t.rung,
                   text: ev.stack ? title : halves ? rows[0].text + ' ' + rows[1].text : rows[ti].text,
                   rows: rows.map(function (r) { return r.text; }),
                   rowCls: rows.map(function (r) { return r.cls; }) });
    });
    return forms;
  }
  fn.plain = function (title) { return { w: widthOf(dev.title, title), h: dev.title.h }; };
  fn.done = function () {};
  return fn;
}

module.exports = { measure: measure, widthOf: widthOf, TABLE: TABLE };
