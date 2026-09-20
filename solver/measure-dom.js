'use strict';

// THE WORDS, BUILT AND MEASURED ON THE PANEL THAT WILL DRAW THEM.
//
// Two jobs that have to be one job. The solver cannot know how wide "Reactor
// Core Check" is -- that depends on the font the device shipped with, the
// size the board chose and what the browser does with a long word -- and the
// renderer must not rebuild the element afterwards, because a box rebuilt is
// a box of a size nobody solved for. So the element is made HERE, measured
// HERE, carried through the solve, and positioned at the end.
//
// It is the architecture the old engine used, and it is right for a reason
// that is easy to miss: a caption is HTML over the canvas, not SVG text, and
// it wears the framework's `text-stroke`, an outline in the colour of the
// ground it stands on. That outline is what lets a name sit over a rail and
// stay readable. SVG text has no such thing, and a board drawn that way looks
// crossed out -- which is exactly how the first attempt at this looked.
//
// MEASURED ONCE, ALL OF THEM, BEFORE ANYTHING IS PLACED. Not lazily, not
// during the search, never again after: a size that can change while the
// solver is running is a size the answer is not about. Five captions in the
// engine this replaces are measured as zero pixels wide and placed as if they
// were points while drawing a hundred pixels across, and every one is a label
// that lands wrong on a real panel.

// THE FRAMEWORK'S OWN TEXT SIZES, by their current names.
//
// `text--small` and `text--base` are the documented utilities
// (trmnl.com/framework/docs/3.3/text_size); `font--*` are deprecated aliases
// due to go in Framework 4.0. The sizes are the framework's because the
// framework knows the panel: the same class is one size on a 1x screen and
// another on a dense one, so a board written against it gets the right text
// on hardware nobody here has seen.
//
// Richest first: the title with its time under it, the title alone, the
// title alone smaller. Which one a board wears is the solver's decision,
// priced.
//
// THE TIME GOES UNDER. It was over the title, which reads as a heading above
// a name rather than as a detail of it, and it puts the quiet grey row
// between the words and whatever is above them -- so a caption sitting under
// its rail had its faintest line nearest the thing it names. Under, the title
// leads, the eye finds the name first and the clock second, and the mark and
// the words are on speaking terms whichever side of the rail they sit.
//
// THE SECOND RUNG FOLDS THE NAME RATHER THAN CUTTING ANYTHING. "Shift
// Handover" over its time is a wide low box; "Shift" over "Handover" over
// its time is a narrow tall one, and on a board where the trouble is a
// crowded left edge rather than a crowded band the narrow one fits where the
// wide one did not, with nothing lost. It is worth a little less than the
// unfolded name (`rung`), because a folded name is two glances, and a great
// deal more than a name without its time. One-word names have no fold and
// skip the rung.
// THE TIME IS BOLD AND BLACK: "make the time stamps bold". A quiet grey range
// was the part of a caption a reader in a hurry could not read.
var TIME_CLS = 'metro-time-tag text--small text--bold';

// AN HOUR OR MORE SAYS WHEN IT ENDS, a shorter one only when it starts:
// "did we lose the end time?" A school day read as "8:30am" left the reader
// counting hour ticks to find 3pm, while "4 - 4:15pm" on a quick call is width
// spent on what the shelf already shows.
//
// A range inside one half of the day says am or pm once: "8 - 9:30am" is
// unambiguous from its end. Across noon or midnight both halves are named.
var RANGE_MIN = 60;
function timeText(ev, clock, hour12) {
  // An event that began the evening before says when it began, not "12am".
  var a0 = ev.began_min != null ? ev.began_min : ev.start_min, b = ev.end_min;
  var len = b - a0, a = ((a0 % 1440) + 1440) % 1440;
  if (!(len >= RANGE_MIN)) return clock(a);
  if (!hour12) return clock(a) + ' \u2013 ' + clock(b);
  var ha = Math.floor(a / 60) % 24, hb = Math.floor(b / 60) % 24;
  var once = (ha < 12) === (hb < 12) && len < 720;
  return (once ? clock(a).replace(/(am|pm)$/, '') : clock(a)) + ' \u2013 ' + clock(b);
}
function tiersAt(titleCls) {
  return [
    { rows: [{ kind: 'title', cls: 'metro-title-text ' + titleCls + ' text--bold' },
             { kind: 'time', cls: TIME_CLS }], size: 1, rung: 0 },
    // THE TIME BESIDE THE NAME, ON ONE LINE: "we could fix Delivery Run like
    // this". Where a shelf is long and the band over it is one row deep, the
    // name with its time after it fits where the name over its time did not,
    // and nothing is lost. A shade behind the stacked form, which reads first.
    { rows: [{ kind: 'title', cls: 'metro-title-text ' + titleCls + ' text--bold' },
             { kind: 'time', cls: TIME_CLS + ' metro-inline' }], size: 1, rung: 0.2 },
    { rows: [{ kind: 'title', cls: 'metro-title-text ' + titleCls + ' text--bold' },
             { kind: 'time', cls: TIME_CLS }], size: 1, rung: 0.35,
      fold: true },
    // THE NAME CLAMPED, THE TIME KEPT: "Get InspireD should have the times ...
    // it would also be okay to clamp." A long title cut to about half the
    // caption's width with an ellipsis, over its time -- worth more than the
    // name alone, because when is the half a reader cannot guess. Offered only
    // where it differs from the whole name.
    // ...AND A CUT NAME COSTS MORE THAN A SIZE. A size down is 0.8 (see the
    // large and xl tiers, which are the size above with every smaller form
    // behind them at that penalty), so at 0.5 the ladder took the ellipsis
    // rather than the step: with the titles raised on the X, "Kermis
    // Vichte" came out as "Kermis Vi…" on a shelf that had room for the
    // whole word one size smaller. A reader can read a smaller word; they
    // cannot read the half that is not there. Priced above the step, the
    // clip is what it should be -- the answer at the SMALLEST size, where
    // there is no step left to take.
    { rows: [{ kind: 'title', cls: 'metro-title-text ' + titleCls + ' text--bold' },
             { kind: 'time', cls: TIME_CLS }], size: 1, rung: 0.85,
      clip: 0.75 },
    { rows: [{ kind: 'title', cls: 'metro-title-text ' + titleCls + ' text--bold' },
             { kind: 'time', cls: TIME_CLS }], size: 1, rung: 0.95,
      clip: 0.5 },
    // THE TIME IS NOT PRICED ABOVE TWO SIZES, AND HERE IS WHY IT CANNOT BE.
    // Dropping it saves a whole ROW, so where the band is short it is the
    // only form that fits and the rung never gets a say. Priced above two
    // steps to force the issue, the caption search stopped dropping the
    // time and started dropping its PLACE instead: "Team Standup" slid
    // sixty-one pixels along its rail looking for room for the taller
    // form, against a twelve pixel allowance (test/boards/cases/adrift.js,
    // which says plainly that these were kept as failures rather than
    // re-baselined). Measured: 1.1 holds, 1.2 drifts, and at 1.1 nothing
    // changes. A name far from its own mark is worse than a name with no
    // time under it, so the time row stays where it is.
    { rows: [{ kind: 'title', cls: 'metro-title-text ' + titleCls + ' text--bold' }], size: 1, rung: 1 },
  ];
}
var TIERS = tiersAt('text--base').concat([
  { rows: [{ kind: 'title', cls: 'metro-title-text text--small text--bold' }], size: 0.82, rung: 2 },
]);
// TITLES A THIRD LARGER WHERE THE PANEL IS WHOLE: "increase font sizes for
// event titles by at least 30%". `text--large` is 21px against 16. Offered
// first, with every base form still behind it, so a crowded full board gives
// the size back before it gives a caption up; a half or a quadrant is not
// offered them at all.
var LARGE_TIERS = tiersAt('text--large').concat(TIERS.map(function (t) {
  return Object.assign({}, t, { rung: t.rung + 0.8 });
}));
// SEVERAL THINGS AT ONE STOP (a calendar's `mergeSameTime`): their names are a
// list, so the caption is laid out as one. "Merged events/todo should get more
// space": one long line "Restafval · GF(t)/keukenafv..." was cut in the middle
// of a word. Richest first: a name to a row over the time; two to a row; the
// first name and how many more; the same without the time; the same smaller.
function partTiersAt(titleCls) {
  var title = 'metro-title-text ' + titleCls + ' text--bold';
  return [
    { parts: 'list', rows: [{ kind: 'title', cls: title }, { kind: 'time', cls: TIME_CLS }], size: 1, rung: 0 },
    { parts: 'columns', rows: [{ kind: 'title', cls: title }, { kind: 'time', cls: TIME_CLS }], size: 1, rung: 0.3 },
    { parts: 'count', rows: [{ kind: 'title', cls: title }, { kind: 'time', cls: TIME_CLS }], size: 1, rung: 0.6 },
    { parts: 'count', rows: [{ kind: 'title', cls: title }], size: 1, rung: 1 },
  ];
}
var PART_TIERS = partTiersAt('text--base').concat([
  { parts: 'count', rows: [{ kind: 'title', cls: 'metro-title-text text--small text--bold' }], size: 0.82, rung: 2 },
]);
var LARGE_PART_TIERS = partTiersAt('text--large').concat(PART_TIERS.map(function (t) {
  return Object.assign({}, t, { rung: t.rung + 0.8 });
}));
// A CROWDED STRETCH OFFERS EVERY LENGTH OF ITS LIST: all of it, then one
// fewer and "+1 more", down to two and a count of the rest, each a small
// step poorer. With only "four, or three and more, or two and more" a list
// of six stood at two rows with room under it for two more ("why not show 2
// more lines").
// ...AND A SIZE LARGER AGAIN ON A PANEL THE SIZE OF THE X. `text--large` was
// chosen against an 800x480 board; the X is 1040x780 CSS pixels of the same
// layout and is read from further away, so the step that is generous there is
// merely ordinary here ("these captions could be larger on the X"). Offered
// first with every large form still behind it, exactly as the large tiers sit
// in front of the base ones: a crowded board gives the size back before it
// gives a caption up.
var XL_TIERS = tiersAt('text--xlarge').concat(LARGE_TIERS.map(function (t) {
  return Object.assign({}, t, { rung: t.rung + 0.8 });
}));
var XL_PART_TIERS = partTiersAt('text--xlarge').concat(LARGE_PART_TIERS.map(function (t) {
  return Object.assign({}, t, { rung: t.rung + 0.8 });
}));
function tiersFor(large, parts, crowdLen, xl) {
  if (crowdLen > 1) {
    var out = [];
    (large ? LARGE_PART_TIERS : PART_TIERS).forEach(function (t) {
      if (t.parts === 'columns') return;
      // a count hides every name but one, so it costs more than any list
      if (t.parts !== 'list') { out.push(Object.assign({}, t, { rung: t.rung + 1 })); return; }
      // the whole list and three short ones, not every length: each form is a
      // move the search prices on every pass
      var lens = [crowdLen, 4, 3, 2].filter(function (k, i, all) {
        return k >= 2 && k <= crowdLen && all.indexOf(k) === i;
      });
      // each row left off is a name the reader does not get
      lens.forEach(function (k) { out.push(Object.assign({}, t, { show: k, rung: t.rung + (crowdLen - k) * 0.2 })); });
    });
    return out;
  }
  // ...BUT NOT FOR A LIST OF NAMES. The step up is for a caption that is one
  // name; several merged at a stop are already the densest thing the board
  // sets, and at the bigger size not one of their forms fitted -- the four
  // bins came off the board altogether rather than being set a size down.
  // A list keeps the large tiers, which is the size it was designed at.
  if (parts) return large ? LARGE_PART_TIERS : PART_TIERS;
  return xl ? XL_TIERS : large ? LARGE_TIERS : TIERS;
}

// Where a two-or-more word name folds: at the space that leaves the two
// halves nearest equal in length, so the box is as narrow as one fold can
// make it.
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

// A CAPTION'S ROWS: the title (folded, where the tier folds) over its time.
// A stack of back-to-back shared events is each one's title over its own time,
// in order (see wantsFrom).
function stackRows(ev, t, halves, timeText) {
  var rows = [];
  if (t.parts && ev.crowd && ev.crowd.length > 1) {
    // A CROWDED STRETCH, one row an event: its time small, its name after it.
    // No two-to-a-row form: a row is already a time and a name.
    // The whole list; then the first few and how many more; then one name
    // and a count. Taller forms say more and cost more room, and the search
    // picks the richest that fits.
    var ccls = t.rows[0].cls, list = ev.crowd;
    if (t.parts === 'columns') return [];
    if (t.parts === 'list') {
      var show = Math.min(list.length, t.show || list.length);
      list.slice(0, show).forEach(function (c) { rows.push({ text: c.time + '\u2002' + c.title, cls: ccls }); });
      if (list.length > show) rows.push({ text: String(ev.moreText || '+{n} more').replace('{n}', list.length - show), cls: TIME_CLS });
      return rows;
    }
    // the count survives a cut: it is the fact that there is more
    rows.push({ text: ev.crowd[0].title + ' +' + (ev.crowd.length - 1), cls: ccls, tail: ' +' + (ev.crowd.length - 1) });
    if (t.rows[1] && timeText) rows.push({ text: timeText(ev), cls: t.rows[1].cls });
    return rows;
  }
  if (t.parts && ev.parts && ev.parts.length > 1) {
    var tcls = t.rows[0].cls, p = ev.parts;
    if (t.parts === 'list') p.forEach(function (name) { rows.push({ text: name, cls: tcls }); });
    else if (t.parts === 'columns') {
      for (var pi = 0; pi < p.length; pi += 2) {
        rows.push({ text: p[pi], cls: tcls });
        if (p[pi + 1]) rows.push({ text: '\u00b7 ' + p[pi + 1], cls: tcls + ' metro-inline' });
      }
    } else rows.push({ text: p[0] + ' +' + (p.length - 1), cls: tcls });
    if (t.rows[1] && timeText) rows.push({ text: timeText(ev), cls: t.rows[1].cls });
    return rows.filter(function (x) { return x.text != null && x.text !== ''; });
  }
  (ev.stack || [ev]).forEach(function (part) {
    t.rows.forEach(function (r) {
      if (r.kind === 'time') { rows.push({ text: timeText ? timeText(part) : null, cls: r.cls }); return; }
      if (halves) {
        rows.push({ text: halves[0], cls: r.cls });
        rows.push({ text: halves[1], cls: r.cls });
      } else rows.push({ text: ev.stack ? part.title || '' : ev.title || '', cls: r.cls });
    });
  });
  return rows.filter(function (x) { return x.text != null && x.text !== ''; });
}
// The row a cut shortens: the title, and in a stack the longest one.
function titleRow(rows) {
  var ti = 0, best = -1;
  rows.forEach(function (r, i) {
    if (/metro-title-text/.test(r.cls) && !/metro-inline/.test(r.cls) && r.text.length > best) { ti = i; best = r.text.length; }
  });
  return ti;
}

function domMeasure(doc, opts) {
  opts = opts || {};
  var maxW = opts.maxWidth || 240;
  var host = doc.createElement('div');
  // IN THE BOX THAT WILL DRAW IT, not merely in the document.
  //
  // The framework's type is scoped: `label--small` inside a `.screen` is one
  // size and the same class on a bare `<body>` is another, because the panel's
  // own size class sets the root font. Measured on the body and drawn on the
  // canvas, every caption came out a few pixels narrower than it is -- which
  // is invisible on most of them and reads as "School RuBook Club" on the two
  // that end up next to each other.
  var root = opts.root || doc.body;
  // Off the page but LAID OUT. `display:none` measures as nothing, which is
  // the zero-width bug in a single line, so it is positioned away instead.
  // Set one property at a time rather than as a style string: the plugin's
  // linter counts CSS property names written as `name:` anywhere in the
  // template, against a budget for the whole file.
  host.style.position = 'absolute';
  host.style.left = '-9999px';
  host.style.top = '0';
  root.appendChild(host);

  // A row's own width. Rows are blocks, and a block is as wide as the widest
  // row beside it, so each is measured shrunk to its words.
  function ownWidth(el) {
    var d = el.style.display;
    el.style.display = 'inline-block';
    var wd = el.offsetWidth;
    el.style.display = d;
    return wd;
  }
  function row(cls, text) {
    var r = doc.createElement('span');
    r.className = cls;
    r.style.display = 'block';
    r.textContent = text;
    return r;
  }

  // One caption, as the element it will be drawn as.
  //
  // MEASURED IN THE FLOW, DRAWN OUT OF IT. The element carries `absolute`,
  // because that is how it is placed on the board; an absolutely positioned
  // box takes its width from its CONTAINING BLOCK, and the ruler's host has
  // none -- it is itself absolute and holds nothing in flow, so it is zero
  // wide. Every caption was therefore ruled at its MIN-CONTENT width: "School
  // Run" measured as "School" and drawn as both words, and the two captions
  // that ended up next to each other on the demo board were written twenty
  // pixels through each other on a board `check` called clean.
  //
  // So the position is overridden for the measurement and handed back
  // afterwards. Same element, same class, one honest width.
  function build(rows) {
    var box = doc.createElement('div');
    // `text-stroke` is a stack of text shadows, which paint and take no room,
    // so the box ruled here is the box the outline is drawn round.
    box.className = 'metro-gen metro-label absolute text--black text-stroke';
    box.style.position = 'static';
    rows.forEach(function (r) {
      // an inline row runs on after the one before it, a space apart
      if (/metro-inline/.test(r.cls) && box.lastChild) {
        var s = doc.createElement('span');
        s.className = r.cls;
        s.textContent = '\u2002' + r.text;
        box.lastChild.appendChild(s);
        return;
      }
      box.appendChild(row(r.cls, r.text));
    });
    return box;
  }

  function measure(ev, o) {
    var title = ev.title || '';
    var forms = [];
    tiersFor(opts.large, !!(ev.parts && ev.parts.length > 1), ev.crowd ? ev.crowd.length : 0, opts.xl).forEach(function (t) {
      var halves = t.fold ? foldTitle(title) : null;
      if (t.fold && (!halves || ev.stack)) return;
      var rows = stackRows(ev, t, halves, o && o.timeText);
      if (!rows.length) return;
      var box = build(rows);
      host.appendChild(box);
      // IN THE UNITS THE BOARD IS PLACED IN.
      //
      // `getBoundingClientRect` is in SCREEN pixels and `style.left` is in
      // LAYOUT pixels, and on a dense panel those are not the same thing: the
      // framework renders a density-2x device through a CSS zoom of about
      // two. Ruled with the rect, every caption on a TRMNL X came out twice
      // the width it is drawn at, so the solver spent the board's room on
      // names that were never that big -- two of them shed and the rest
      // scattered a rail away from their marks. `offsetWidth` is in the same
      // units as the position it will be given.
      var b = { width: box.offsetWidth, height: box.offsetHeight };
      // A NAME WIDER THAN THE BOARD WILL TOLERATE IS CUT, AND THE CUT IS
      // MEASURED. Letting it run is how a caption comes to be wider than the
      // panel; guessing where it breaks is how a measurement stops describing
      // the drawing. Trimmed on the element itself, so what was measured is
      // the string that will be drawn.
      // THE TITLE IS WHAT GETS CUT, and it is named rather than taken as the
      // last row: with the time underneath, "the last row" is the clock, and
      // trimming that turns "10 - 10:20am" into "10 - 10:2…" while the name
      // that actually overflowed is left whole.
      var ti = titleRow(rows);
      var capW = t.clip ? Math.round(maxW * t.clip) : maxW;
      if (t.clip && box.childNodes[ti].offsetWidth <= capW) { host.removeChild(box); return; }
      if (b.width > capW) {
        var el = box.childNodes[ti], tail = rows[ti].tail || '', cut = rows[ti].text.slice(0, rows[ti].text.length - tail.length);
        while (cut.length > 1) {
          el.textContent = cut + '…' + tail;
          if (ev.crowd ? ownWidth(el) <= capW : box.offsetWidth <= capW) break;
          cut = cut.slice(0, -1);
        }
        rows[ti].text = el.textContent;
        // A CROWDED STRETCH IS A ROW AN EVENT, and any of them can be the wide
        // one: each is cut to the width on its own.
        if (ev.crowd) {
          rows.forEach(function (r, ri) {
            var e2 = box.childNodes[ri];
            if (!e2 || r.tail || ownWidth(e2) <= capW) return;
            var c2 = r.text;
            while (c2.length > 1 && ownWidth(e2) > capW) { c2 = c2.slice(0, -1); e2.textContent = c2 + '…'; }
            r.text = e2.textContent;
          });
        }
        b = { width: box.offsetWidth, height: box.offsetHeight };
      }
      host.removeChild(box);
      box.style.position = '';   // back to the class's own `absolute`
      if (!(b.width > 0) || !(b.height > 0)) return;  // never hand on a size nobody saw
      forms.push({ w: b.width, h: b.height, size: t.size, rung: t.rung,
                   text: ev.stack ? title : halves ? rows[0].text + ' ' + rows[1].text : rows[ti].text,
                   rows: rows.map(function (r) { return r.text; }),
                   rowCls: rows.map(function (r) { return r.cls; }),
                   el: box });
    });
    return forms;
  }

  measure.done = function () {
    if (host.parentNode) host.parentNode.removeChild(host);
  };
  return measure;
}

module.exports = { domMeasure: domMeasure, stackRows: stackRows, titleRow: titleRow, timeText: timeText, RANGE_MIN: RANGE_MIN, TIERS: TIERS, LARGE_TIERS: LARGE_TIERS, XL_TIERS: XL_TIERS, tiersFor: tiersFor };
