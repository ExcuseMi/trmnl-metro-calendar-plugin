// WHAT THE PAGE SAYS IT DREW. Runs IN THE PAGE (support/page.rb evaluates
// it): every drawn thing in ONE coordinate space (screen px, relative to the
// canvas). SVG paths are SAMPLED with getPointAtLength, so a curved or
// rounded path is checked as the shape it really draws rather than as its
// control points. Kept field for field as the cases always read it.
(function pageReport() {
  var canvas = document.querySelector('.metro-canvas');
  var svg = document.querySelector('.metro-svg');
  if (!canvas || !svg) return { missing: !canvas ? '.metro-canvas' : '.metro-svg', errors: (window.__metroErrors || []).slice(0, 8) };
  var cr = canvas.getBoundingClientRect();
  function rel(r) { return { x: r.left - cr.left, y: r.top - cr.top, w: r.width, h: r.height }; }
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
    // A ROW'S OWN PIECES. A row of headlines is one label to the report,
    // so a piece squeezed narrower than its words -- which then prints
    // over the piece beside it, because these never wrap -- is invisible
    // in the row's own box and its run-together text. Each piece says
    // how wide it is and whether its words fit it.
    var parts = [];
    if (/metro-news-row/.test(String(n.className))) {
      Array.prototype.forEach.call(n.children, function (c) {
        var q = c.getBoundingClientRect();
        if (!q.width || !q.height) return;
        parts.push(Object.assign(rel(q), { cls: c.getAttribute('class') || '',
          text: (c.textContent || '').trim(),
          clamp: c.getAttribute && c.getAttribute('data-clamp') != null,
          over: c.scrollWidth > c.clientWidth + 1 }));
      });
    }
    labels.push(Object.assign(rel(r), { cls: n.className, text: (n.textContent || '').trim(),
      parts: parts, clipped: !!(tt && tt.scrollWidth > tt.clientWidth + 1),
      // THE CLOCK ROW'S OWN CLASS. The caption is one element to the
      // report and its time is a child, so the size the time is set in --
      // which the drawing steps up after the solve, out of free depth
      // (draw.js, bigClocks) -- could not be asked about at all.
      timeCls: tt ? (tt.getAttribute('class') || '') : '',
      // ...and the name's own class beside it, since the clock is sized
      // against the name it stands under and not against the board
      titleCls: (function () {
        var ti = n.querySelector && n.querySelector('.metro-title-text');
        return ti ? (ti.getAttribute('class') || '') : '';
      })() }));
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
  // No regex here. This reporter was a template literal in run.js once,
  // where a backslash is an escape, so an escaped bracket in a pattern
  // reached the page unescaped: the test read as a capture group and
  // matched nothing, and every board reported a transparent background.
  function bgOf(el) {
    for (var n = el; n; n = n.parentElement) {
      var c = (getComputedStyle(n).backgroundColor || '').replace(/ /g, '');
      if (c && c !== 'transparent' && c !== 'rgba(0,0,0,0)') return getComputedStyle(n).backgroundColor;
    }
    return null;
  }
  // THE HEADER IS DRAWING TOO, and none of it is in the canvas, so none
  // of it ever reached `labels`. It says what day this is and what the
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
  // run-together string `labels` reports for it: which day this is, what
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
  return {
    canvas: { w: cr.width, h: cr.height },
    root: rel(root.getBoundingClientRect()), view: rel(viewEl.getBoundingClientRect()),
    boardBg: bgOf(canvas), banner: banner,
    debug: dbg, labels: labels, paths: paths, rects: rects, painted: painted, overlays: overlays,
    alerts: alerts,
    header: head, badges: badges, errors: (window.__metroErrors || []).slice(0, 8),
    metroError: canvas.getAttribute('data-metro-error'),
    circles: circles.concat(shapeMarkers)
  };
}
)
