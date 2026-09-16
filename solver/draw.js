'use strict';

// DRAWING A SOLVED BOARD THE WAY THE BOARD HAS ALWAYS BEEN DRAWN.
//
// This is a rewrite, not a port, and the difference matters: the geometry it
// draws comes from the new solver's `Board`, and every VISUAL decision in it
// is taken from the engine that came before, because those decisions were
// made against real panels over months and rediscovering them from
// screenshots is exactly the waste this file exists to end.
//
// The four that carry the look, none of which are obvious:
//
//   A LABEL IS HTML, NOT SVG TEXT. It is a real element over the canvas
//   wearing the framework's `text-stroke`, an outline in the ground's colour,
//   so the words sit in their own clearing and a rail passing behind them
//   does not run through the letters. SVG text with no outline is why the
//   first attempt at this looked thin and crossed-out.
//
//   A RAIL IS DRAWN SOLID AND THEN HOLLOWED. The dash pattern is a PAPER
//   overlay laid over solid ink in the same geometry -- the ink shows
//   through the gaps. Drawing the dashes directly in ink looks similar on
//   its own and wrong everywhere two lines meet.
//
//   A TURN GETS A HALO. Where a path changes level, a band of PAPER twelve
//   pixels proud of the stroke goes down first, severing whatever was drawn
//   before it. Document order is therefore the layering, and a crossing
//   reads as one line passing over another rather than as a junction. Only
//   on the pieces that TURN: a halo under a flat run rubs out the parallel
//   rail beside it.
//
//   INK AND PAPER ARE THEME VARIABLES. `#000` and `#fff` are wrong on a
//   panel in dark mode; the framework's own custom properties follow it.
//
// Everything here is ordered back to front: what is drawn later covers what
// was drawn earlier, deliberately.

var INK = 'var(--framework-semantic-text-primary-text-color, #000)';
var PAPER = 'var(--framework-semantic-canvas-bg-color, #fff)';
var SVG_NS = 'http://www.w3.org/2000/svg';

// THE TEXTURES THE BOARD HAD ON THE NINTH OF SEPTEMBER, as paper over ink.
//
// Taken from that renderer's `treatmentFor`, which the one after it replaced
// with five dash patterns at one weight -- and the picture was worse for it:
// "the line styles were a lot better, so for the TRMNL X we should reuse
// these styles." Three treatments, each a paper core knocked out of a rail
// drawn a little WIDER than a plain one (`widen`), because what the eye
// weighs is the ink and not the envelope: a hairline of ink either side of
// a paper core reads as thinner than the solid rail beside it.
//
//   dashed    a continuous paper core: two thin rails, a railway line
//   dotted    a dotted paper core: white dots along a solid rail
//   dashdot   round paper dots, sparse: a beaded rail
//
// ONE WIDTH FOR EVERY STYLE: "we should also just align all our track styles
// to be the same width". Every rail, plain or textured, is drawn `WIDEN` wider
// than its weight, so the envelope is the same whatever is inside it, and the
// cores are set in proportion to that envelope. (The thin rail went with it.)
var WIDEN = 2.4;
function treatment(style, S, w) {
  var thin = Math.max(1 * S, 1.4 * S);
  if (style === 'dashed') return { widen: WIDEN * S, core: Math.max(thin, w * 0.3), cap: 'butt' };
  if (style === 'dotted') return { widen: WIDEN * S, core: Math.max(thin, w * 0.67), cap: 'butt',
                                   dash: (2.6 * S) + ' ' + (6.4 * S) };
  // A SHARED CALENDAR'S LINE IS A LADDER: hollow with ink rungs across it,
  // a style no person's line is given, so "Family" or "Deliveries" reads as
  // the house's own line and not as one more person.
  if (style === 'ladder') return { widen: WIDEN * S, core: Math.max(thin, w * 0.72), cap: 'butt',
                                   dash: (5 * S) + ' ' + (1.8 * S) };
  if (style === 'dashdot') return { widen: WIDEN * S, core: Math.max(thin, w * 0.61), cap: 'round',
                                    dash: (0.1 * S) + ' ' + (9 * S) };
  return null;
}

function svgEl(doc, tag, attrs) {
  var n = doc.createElementNS(SVG_NS, tag);
  for (var k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
  return n;
}

// A rail turns a corner, it does not fold: every vertex becomes a short
// quadratic through it, pulled back along both legs by the corner radius or
// by half the shorter leg, whichever is less, so a tight zigzag rounds less
// rather than overshooting.
function pathOf(pts, r) {
  if (pts.length < 2) return '';
  if (pts.length === 2 || !(r > 0)) {
    return pts.map(function (p, i) {
      return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1);
    }).join(' ');
  }
  var d = 'M' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(1);
  for (var i = 1; i < pts.length - 1; i++) {
    var a = pts[i - 1], b = pts[i], c = pts[i + 1];
    var l1 = Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1]));
    var l2 = Math.sqrt((c[0] - b[0]) * (c[0] - b[0]) + (c[1] - b[1]) * (c[1] - b[1]));
    // A point may carry its own radius (see rails.js `push`): nested
    // corners at a bundle round a gap apart so the arcs nest.
    var k = Math.min(b[2] != null ? b[2] : r, l1 / 2, l2 / 2);
    if (!(k > 0.5) || !l1 || !l2) { d += ' L' + b[0].toFixed(1) + ' ' + b[1].toFixed(1); continue; }
    d += ' L' + (b[0] + (a[0] - b[0]) * k / l1).toFixed(1)
       + ' ' + (b[1] + (a[1] - b[1]) * k / l1).toFixed(1)
       + ' Q' + b[0].toFixed(1) + ' ' + b[1].toFixed(1)
       + ' ' + (b[0] + (c[0] - b[0]) * k / l2).toFixed(1)
       + ' ' + (b[1] + (c[1] - b[1]) * k / l2).toFixed(1);
  }
  var last = pts[pts.length - 1];
  return d + ' L' + last[0].toFixed(1) + ' ' + last[1].toFixed(1);
}

var B = require('./board');

function draw(board, spec, ctx) {
  var doc = ctx.doc || document;
  var svg = ctx.svg, canvas = ctx.canvas;
  var S = ctx.S || 1, horizontal = ctx.horizontal !== false;
  var W = ctx.W, H = ctx.H;
  // The constants the old engine tuned, at the panel's own scale.
  var NODE_R = 6 * S, NODE_STROKE = 3 * S, LINE_GAP = 6 * S, CORNER = 13 * S;
  var RAIL_W = 3 * S;
  // ONE HOLLOW, for the bar and the branch that continues it: the same width
  // and the same walls, "the connector and the branch don't use the exact same
  // style".
  var BAR_W = NODE_R * 1.3, TUBE_W = BAR_W, BAR_CORE = BAR_W - 2 * NODE_STROKE * 0.8;

  function X(a, c) { return horizontal ? a : c; }
  function Y(a, c) { return horizontal ? c : a; }
  function xy(a, c, extra) { return extra ? [X(a, c), Y(a, c), extra] : [X(a, c), Y(a, c)]; }

  while (svg.firstChild) svg.removeChild(svg.firstChild);
  canvas.querySelectorAll('.metro-gen, .metro-strip').forEach(function (n) { n.remove(); });
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);

  function put(n, role, owner) {
    if (role) n.setAttribute('data-metro-role', role);
    if (owner) n.setAttribute('data-metro-owner', owner);
    svg.appendChild(n);
    return n;
  }

  // ---- how many greys this panel has, and nothing else -------------------
  //
  // Bit depth decides what a line is PAINTED with. It decides NOTHING about
  // where anything is: the weight is the same three pixels on every panel, so
  // every band, every caption and every mark comes out in the same place
  // whatever this says. That is the whole point of reading it here and only
  // here -- a board that rearranges itself because the device has more greys
  // is a different board, and the one thing a calendar may not do is look
  // like a different day.
  //
  // At one bit every rail is solid ink and the DASH PATTERNS tell them apart:
  // a dithered grey three pixels wide is speckle, not a line. Where there are
  // greys both channels carry, because they answer two different questions --
  // the tone says which line at a glance across the board, the texture says
  // which line where two of them are touching.
  var screenEl = canvas.closest ? canvas.closest('.screen') : null;
  var ONE_BIT = !!(screenEl && screenEl.classList.contains('screen--1bit'));
  svg.setAttribute('shape-rendering', ONE_BIT ? 'crispEdges' : 'geometricPrecision');
  // The ladder stops at gray-40. It ran to gray-70 once and the fifth line
  // was a pale wash you could lose against the paper -- and with a texture on
  // every rail as well, tone does not have to separate anything on its own.
  // It only has to stop two neighbours merging at a glance.
  //
  // MIXED FROM INK AND PAPER, NOT ASKED OF THE PAINT API. The framework's
  // `TRMNLPaint.stroke` resolved the ladder locally and came back black on
  // the device, so every rail on a real TRMNL X was solid: "4bit trmnl X
  // should use different track shades of gray." `color-mix` on the theme's
  // own two colours needs nothing from the framework and follows dark mode.
  //
  // AND REAL COLOURS WHERE THE PANEL HAS THEM. A black-white-red-yellow
  // panel says so in its screen class; the rails after the anchor take the
  // colours it has, in the order it names them.
  // The anchor and the white-dotted rail are full ink: the dots carry that
  // one. The railway line, the beaded rail and the thin rail step down.
  // SPREAD, SO NEIGHBOURS DIFFER IN SHADE AS WELL AS IN TEXTURE, and a
  // texture that comes round again on a long board comes round in another
  // shade: "similar track styles stay as far away from each other as
  // possible." Paired with day.js's texture order: thin at 55, dotted at
  // full ink (the dots need it), the railway line at 40, the beaded rail
  // at 70. The second time round the ladder starts one rung along.
  var TONES = [55, 100, 40, 70];
  var COLOURS = { r: '#ff0000', y: '#ffcc00', b: '#0033ff', g: '#00a000' };
  var palette = null;
  if (screenEl) {
    var cls = String(screenEl.className || '');
    var mc = cls.match(/screen--color-(\d)?([a-z]+)/);
    if (mc) {
      var letters = mc[2].replace(/^bw/, '').split('');
      var pal = [];
      letters.forEach(function (ch) { if (COLOURS[ch]) pal.push(COLOURS[ch]); });
      if (/(6|7)a/.test(mc[0])) pal = [COLOURS.r, COLOURS.b, COLOURS.g, COLOURS.y];
      if (pal.length) palette = pal;
    }
  }
  var shade = {};
  (spec.lines || []).forEach(function (l, i) {
    // The anchor -- the one solid rail, which the eye finds first -- is fully
    // inked by definition, so black is spent before the ladder is handed out.
    if (ONE_BIT || i === 0) { shade[l.key] = INK; return; }
    var cycle = Math.floor((i - 1) / TONES.length);
    if (palette) { shade[l.key] = palette[(i - 1 + cycle) % palette.length]; return; }
    var pct = TONES[(i - 1 + cycle) % TONES.length];
    shade[l.key] = 'color-mix(in srgb, ' + INK + ' ' + pct + '%, ' + PAPER + ')';
  });
  // A branch wears its trunk's ink, marks included: asked by the spur's own
  // key, the dot and tick on Assembly's spur came out black beside a red
  // rail -- "branch event markers don't follow the color pattern."
  // A RAIL'S OWN INK AND OUTER WEIGHT, as the rail is drawn below, so a tick
  // on it wears exactly that: a tie's spur is plain ink whatever its line's
  // shade, and a textured rail is wider than its core.
  function railStroke(ln, key) {
    if (!ln) return { ink: inkOf(key), width: RAIL_W };
    var w = ln.branchOf ? RAIL_W * 0.8 : RAIL_W;
    if (ln.branchOf && ln.ink) return { ink: INK, width: TUBE_W };
    return { ink: inkOf(ln.key), width: w + WIDEN * S };
  }
  // ...AND ITS PAPER, so a mark on a rail is made the way the rail is: a
  // hollow rail ends in a hollow tick, a dotted one in a dotted tick --
  // "terminators should follow the line style, not just the color".
  function railCore(ln) {
    if (!ln) return null;
    if (ln.branchOf && ln.ink) return { core: BAR_CORE, dash: null };
    var w = ln.branchOf ? RAIL_W * 0.8 : RAIL_W;
    var t = treatment(ln.style, S, w);
    return t ? { core: t.core, dash: t.dash || null } : null;
  }
  // A tick or a slash from q0 to q1 (screen points) in the rail's own style:
  // the ink at the rail's outer weight, and the rail's paper core inside it,
  // stopped a wall short of both ends so a hollow mark is closed.
  function markLine(q0, q1, ln, key, role, open, weight) {
    var rs = railStroke(ln, key);
    if (weight) rs = { ink: rs.ink, width: weight };
    var m = svgEl(doc, 'line', { x1: q0[0], y1: q0[1], x2: q1[0], y2: q1[1],
      'stroke-width': rs.width, 'stroke-linecap': 'butt' });
    m.style.stroke = rs.ink;
    put(m, role, key);
    var cr = railCore(ln), len = Math.hypot(q1[0] - q0[0], q1[1] - q0[1]);
    if (!cr || !(len > 0)) return m;
    // A MARK IS FULL OR HOLLOW, nothing else: "remove dots and dashes from the
    // terminators". A patterned rail ends in a solid mark; only a laid piece of
    // rail (a bridge's deck) carries its pattern on.
    if (cr.dash && !open) return m;
    var wall = open ? 0 : Math.max(0, (rs.width - cr.core) / 2), ux = (q1[0] - q0[0]) / len, uy = (q1[1] - q0[1]) / len;
    if (len <= 2 * wall + 1) return m;
    var core = svgEl(doc, 'line', { x1: q0[0] + ux * wall, y1: q0[1] + uy * wall,
      x2: q1[0] - ux * wall, y2: q1[1] - uy * wall,
      'stroke-width': cr.core, 'stroke-linecap': 'butt', 'stroke-dasharray': cr.dash });
    core.style.stroke = PAPER;
    put(core, role + '-core', key);
    return m;
  }
  // A BRIDGE, THE OTHER WAY TO CROSS: "I like this as well as a bridge", then
  // drawn from the user's own sketch. The line passing over stays whole and
  // is the deck; under it, either side of what it passes over, hangs a pier:
  // a wedge in the deck's own ink, square against the gap and cut back on a
  // slant away from it. The line underneath is cut. `at` and `u` are in board
  // units (along, across), `d` how far from the crossing the piers stand.
  //
  // WHICH, IS NOT A CHOICE: "bridges are used when horizontal lines cross
  // vertical connectors and midnight lines and there are no events on the
  // horizontal line. If there is an event, the vertical connector should
  // tunnel under the line and event line and captions. The midnight line can
  // only tunnel when there's an event at midnight that crosses midnight."
  // An event on a line at a minute: any branch is one, and a trunk is where
  // something of its own is on it then (a stop along it, a timed state).
  function eventOn(ln, a) {
    if (!ln) return false;
    if (ln.branchOf) return true;
    if ((spec.wants || []).some(function (w) {
      // (the person's own event, on the trunk or out on its branch: the line
      // is busy then either way)
      return !w.pill && !w.allDay && ((w._rail || w.line) === ln.key || w.line === ln.key)
        && w.a0 - 1 <= a && a <= w.a1 + 1;
    })) return true;
    return !!(spec.scale && (spec.states || []).some(function (st) {
      return st.timed && st.from != null && st.owners.indexOf(ln.key) >= 0
        && spec.scale.at(st.from) - 1 <= a && a <= spec.scale.at(st.to) + 1;
    }));
  }
  // TWO PILLARS A SIDE, from the user's newest design: square-cut uprights
  // under the deck, the one by the gap the taller, a slot of paper between.
  // ONE SIZE: "we shouldn't have different size bridges", so every bridge is
  // this one, set in the deck's width -- which is the same on every line.
  function guardrails(at, u, d, ln, key) {
    var rs = railStroke(ln, key), W = rs.width, edge = W / 2, n = [-u[1], u[0]];
    function pt(along, across) {
      return xy(at[0] + u[0] * along + n[0] * across, at[1] + u[1] * along + n[1] * across);
    }
    var pw = W * 0.5, gap = W * 0.4, drops = [W * 1.3, W * 0.75];   // inner, outer
    [-1, 1].forEach(function (sd) {
      [0, 1].forEach(function (k) {
        var i0 = d + k * (pw + gap), i1 = i0 + pw;
        var q = [pt(sd * i0, edge - 0.5), pt(sd * i1, edge - 0.5),
                 pt(sd * i1, edge + drops[k]), pt(sd * i0, edge + drops[k])];
        var g = svgEl(doc, 'path', { d: 'M ' + q.map(function (v) { return v[0] + ' ' + v[1]; }).join(' L ') + ' Z',
          stroke: 'none' });
        g.style.fill = rs.ink;
        put(g, 'guardrail', key);
      });
    });
  }
  function inkOf(key) {
    if (shade[key]) return shade[key];
    var ln = board.lineByKey(key);
    if (ln && ln.ink && shade[ln.ink]) return shade[ln.ink];
    if (ln && ln.branchOf && shade[ln.branchOf]) return shade[ln.branchOf];
    return INK;
  }

  // ---- the river, behind everything -------------------------------------
  //
  // THE STRIP IS A BAND OF ITS OWN, NOT A ROW OF FLOATING WORDS.
  //
  // A faint wash across the top with a rule under it, and it does one job: it
  // says where the scale ends and the map begins. Without it the hour labels
  // read as annotations lying on the board -- which is what they looked like
  // for a whole session of screenshots -- and a caption near the top of the
  // first band is indistinguishable from a clock.
  //
  // Nine percent and a rule at twenty-two. Light enough that the hours stay
  // black on white, dark enough to bound the band on a 1-bit panel.
  var strip = null;
  (board.fixed || []).forEach(function (fx) { if (fx.kind === 'hours') strip = fx; });
  // ONE PANEL PER DAY, IN INVERSE. A single wash from edge to edge made a
  // two-day board's strip one undivided band with two badges on it: "header
  // looks boring, no clear separation per day". Each day the board draws
  // gets its own panel in the framework's `inverse` -- the panel is ink and
  // everything the strip writes in it is paper, pills included, and it
  // follows dark mode because it is the framework's paint and not ours --
  // meeting the next day's light panel at the midnight. A gap of paper
  // between them was tried and read as a hole: "the white between the days
  // is weird".
  var dayCuts = [];
  ((spec.metro && spec.metro.days) || []).forEach(function (d, di) {
    if (di && d.start_min != null && spec.scale) dayCuts.push(spec.scale.at(d.start_min));
  });
  var panels = [];
  if (strip) {
    var along1 = horizontal ? W : H, gapHalf = 0;
    var edges = [0].concat(dayCuts).concat([along1]);
    for (var pi = 0; pi < edges.length - 1; pi++) {
      var pa0 = edges[pi] + (pi ? gapHalf : 0), pa1 = edges[pi + 1] - (pi < edges.length - 2 ? gapHalf : 0);
      if (!(pa1 > pa0)) continue;
      var r0 = xy(pa0, 0), r1 = xy(pa1, strip.c1);
      var px0 = Math.min(r0[0], r1[0]), py0 = Math.min(r0[1], r1[1]);
      var pw = Math.abs(r1[0] - r0[0]), ph = Math.abs(r1[1] - r0[1]);
      var panel = doc.createElement('div');
      // THE DAY THE BOARD IS ON IN INVERSE, the day it reaches into in a light
      // wash: "don't inverse the second day". Tomorrow is the quieter half.
      // Not `metro-gen`: the panel is paper for words, not words.
      panel.className = 'metro-strip absolute ' + (pi ? 'bg--gray-75' : 'inverse bg--canvas');
      panel.style.left = px0 + 'px'; panel.style.top = py0 + 'px';
      panel.style.width = pw + 'px'; panel.style.height = ph + 'px';
      canvas.insertBefore(panel, svg);
      panels.push({ el: panel, a0: pa0, a1: pa1, x: px0, y: py0, w: pw, inverse: !pi });
      // The band's extent, for anything that asks where the scale ends.
      var band = svgEl(doc, 'rect', { x: px0, y: py0, width: pw, height: ph,
        stroke: 'none', 'fill-opacity': 0 });
      band.style.fill = INK;
      put(band, 'river');
      // THE LIGHT PANEL IS RULED OFF FROM THE MAP: "tomorrow header section
      // needs a bottom border". The inverse panel ends in its own ink; the
      // wash would otherwise fade into the paper under it.
      if (pi) {
        var e0 = xy(pa0, strip.c1), e1 = xy(pa1, strip.c1);
        var rule = svgEl(doc, 'line', { x1: e0[0], y1: e0[1], x2: e1[0], y2: e1[1],
          'stroke-width': 1.5 * S, 'stroke-linecap': 'butt' });
        rule.style.stroke = INK;
        put(rule, 'strip-edge');
      }
    }
  }
  // WHICH PANEL A STRIP LABEL BELONGS TO, by where it stands along the axis;
  // moved into it, so the inverse reaches it. One that straddles a gap has
  // no panel to be legible in and is taken off.
  function intoPanels() {
    if (!panels.length || !strip) return;
    Array.prototype.slice.call(canvas.children).forEach(function (n) {
      if (n === svg || !/\bmetro-gen\b/.test(n.className) || /\bmetro-strip\b/.test(n.className)) return;
      if (!/metro-hour|metro-axis-note|metro-daybadge|metro-wx|metro-nownext|metro-moon/.test(n.className)) return;
      var left = parseFloat(n.style.left) || 0, top = parseFloat(n.style.top) || 0;
      var len = horizontal ? n.offsetWidth : n.offsetHeight, thick = horizontal ? n.offsetHeight : n.offsetWidth;
      var a0 = horizontal ? left : top, c0 = horizontal ? top : left;
      if (c0 + thick / 2 > strip.c1) return;
      // By its middle, and nudged inside: the day badge starts on the
      // midnight itself and the forecast ends there, both a gap's width into
      // the paper between the panels.
      var mid = a0 + len / 2, home = null;
      panels.forEach(function (pn) { if (mid >= pn.a0 && mid <= pn.a1) home = pn; });
      if (!home || len > home.a1 - home.a0) { n.remove(); return; }
      // A day's own title stands clear of the midnight it opens on: set hard
      // against the double rule, "Morgen" read as squeezed into the corner.
      // ...and the clock the same distance short of the midnight that ends it.
      var inset = ((/metro-daybadge/.test(n.className) && home.a0 > 1)
        || (/metro-pill/.test(n.className) && home.a1 < (horizontal ? W : H) - 1) ? 10 : 6) * S;
      // THE DAY'S TITLE AND ITS "+N EARLIER" START WITH THE PANEL, not with
      // the axis: on a flat slot the names take a gutter at each end, and set
      // at the axis the date floated in from a black block over the names --
      // "weird header alignment for today".
      if (horizontal && !/metro-pill/.test(n.className) && Math.abs(a0 - spec.axis.a0) < 2
          && home.a0 < spec.axis.a0 - inset) a0 = home.a0;
      var fit = Math.max(home.a0 + inset, Math.min(a0, home.a1 - len - inset));
      if (len > home.a1 - home.a0 - 2 * inset) { n.remove(); return; }
      if (horizontal) left = fit; else top = fit;
      n.style.left = (left - home.x) + 'px'; n.style.top = (top - home.y) + 'px';
      // THE FORECAST IS HELD BY ITS PANEL'S RIGHT EDGE, like a name at the far
      // edge: measured before the face settles it ran off the paper.
      if (horizontal && (/metro-wx/.test(n.className) || (/metro-pill/.test(n.className) && fit + len >= home.a1 - inset - 12 * S))) {
        n.style.left = 'auto';
        n.style.right = Math.max(0, home.w - (fit - home.x) - len) + 'px';
      }
      // THE OUTLINE IS THE GROUND'S COLOUR. The framework's stroke follows
      // `inverse` by itself, so on today's panel it is ink; the light panel
      // is a grey the framework does not know the words are standing on, and
      // a paper outline there drew a white halo round every hour.
      if (!home.inverse) {
        [n].concat(Array.prototype.slice.call(n.querySelectorAll('.text-stroke'))).forEach(function (el) {
          if (el.classList.contains('text-stroke')) el.classList.add('text-stroke--gray-75');
        });
      }
      home.el.appendChild(n);
    });
  }

  // A CUT IS THE GROUND IT IS CUT IN, not white: "bridges need to use the
  // current bg instead of white". Paper laid to cut a line is paper; where the
  // night shade is under it, the shade goes back over the cut.
  var nights = [];
  function groundOver(node, a) {
    if (!nights.some(function (n) { return a >= n[0] - 0.5 && a <= n[1] + 0.5; })) return;
    var g = node.cloneNode(false);
    if (g.style.fill && g.style.fill !== 'none') { g.style.fill = INK; g.setAttribute('fill-opacity', 0.08); }
    if (g.style.stroke && g.style.stroke !== 'none') { g.style.stroke = INK; g.setAttribute('stroke-opacity', 0.08); }
    g.setAttribute('data-metro-role', 'night');
    svg.appendChild(g);
  }
  // ---- the dark hours, behind everything ---------------------------------
  //
  // BEFORE SUNRISE AND AFTER SUNSET, SHADED. "Lets do a gray shade bg before
  // sunset and after sundown": a board that runs into the evening and on to
  // the next morning reads the night at a glance when the paper itself goes
  // grey for it. Behind every rail and every word, across the map only; the
  // strip says the same with its own panels. From each day's forecast, so a
  // board without one simply has no shade.
  if (spec.scale && spec.cross && spec.metro) {
    var m0min = spec.metro.day_start_min, m1min = spec.metro.day_end_min;
    var dayList = (spec.metro.days && spec.metro.days.length) ? spec.metro.days
      : [{ start_min: Math.floor(m0min / 1440) * 1440, weather: spec.metro.header_weather }];
    // THE DARK IS WHAT LIES BETWEEN ONE DAY'S LIGHT AND THE NEXT, not each
    // day's own evening and morning: cut at every midnight, the night had an
    // edge drawn at twelve, and a sunset after midnight (a location far from
    // the board's zone) left the evening lit.
    var lights = [];
    dayList.forEach(function (d) {
      var wx = d.weather;
      if (!wx || wx.sunrise_min == null || wx.sunset_min == null) return;
      var base = d.start_min != null ? d.start_min : 0;
      lights.push([base + wx.sunrise_min, base + wx.sunset_min, base]);
    });
    lights.sort(function (p, q) { return p[0] - q[0]; });
    var darks = [];
    lights.forEach(function (l, li) {
      if (li === 0) darks.push([l[2], l[0]]);
      else darks.push([lights[li - 1][1], l[0]]);
      if (li === lights.length - 1) darks.push([l[1], l[2] + 1440]);
    });
    darks.forEach(function (span) {
      var f = Math.max(span[0], m0min), t = Math.min(span[1], m1min);
      if (!(t > f)) return;
      var a0n = f <= m0min ? 0 : spec.scale.at(f), a1n = t >= m1min ? (horizontal ? W : H) : spec.scale.at(t);
      var q0 = xy(a0n, strip ? strip.c1 : spec.cross.c0), q1 = xy(a1n, horizontal ? H : W);
      var shade = svgEl(doc, 'rect', { x: Math.min(q0[0], q1[0]), y: Math.min(q0[1], q1[1]),
        width: Math.abs(q1[0] - q0[0]), height: Math.abs(q1[1] - q0[1]),
        stroke: 'none', 'fill-opacity': 0.08 });
      shade.style.fill = INK;
      put(shade, 'night');
      nights.push([Math.min(a0n, a1n), Math.max(a0n, a1n)]);
      // ...EDGED A TAD DARKER where the dark begins and ends, so the night
      // has an outline rather than fading in: sunset and sunrise, drawn as
      // the two sides of the shade and not at the paper's own edges.
      [[f, a0n], [t, a1n]].forEach(function (e) {
        if (e[0] <= m0min || e[0] >= m1min) return;
        var r0 = xy(e[1], strip ? strip.c1 : spec.cross.c0), r1 = xy(e[1], horizontal ? H : W);
        var edge = svgEl(doc, 'line', { x1: r0[0], y1: r0[1], x2: r1[0], y2: r1[1],
          'stroke-width': 1 * S, 'stroke-opacity': 0.22 });
        edge.style.stroke = INK;
        put(edge, 'night');
      });
    });
  }

  // ---- the compressed hours ---------------------------------------------
  //
  // NOT HATCHED ON THE STRIP ANY MORE: "remove the speed lines from the
  // timeline header". The speed marks along the rails say where the clock
  // runs fast (below); the strip keeps only its hours.

  // ---- now, behind everything ------------------------------------------
  (board.fixed || []).forEach(function (fx) {
    if (fx.kind !== 'now') return;
    var a = (fx.a0 + fx.a1) / 2;
    // From the strip down, through the row of sky glyphs: "now line should
    // cross the weather icon bar". It is the clock's line, and that row is on
    // the clock too.
    var p0 = xy(a, strip ? strip.c1 : fx.c0), p1 = xy(a, fx.c1);
    var n = svgEl(doc, 'line', { x1: p0[0], y1: p0[1], x2: p1[0], y2: p1[1],
      'stroke-width': 1.2 * S, 'stroke-dasharray': (1 * S) + ' ' + (3 * S) });
    n.style.stroke = INK;
    put(n, 'now');
  });

  // The box a shared event is drawn in, for the wash and the outline alike.
  function pillRect(pl) {
    var capR = Math.max(NODE_R * 1.15, RAIL_W * 0.9);
    var pa0 = pl.a0 == null ? pl.a : pl.a0, pa1 = pl.a1 == null ? pl.a : pl.a1;
    var k0 = xy(pa0 - capR, pl.c0 - capR), k1 = xy(pa1 + capR, pl.c1 + capR);
    var w = Math.abs(k1[0] - k0[0]), h = Math.abs(k1[1] - k0[1]);
    // ROUNDED LIKE THE RAILS. A rectangle with small corners against rails
    // turning on the renderer's own radius was two curves that did not
    // agree; the box's end is the rail's corner, up to a full half-round
    // on a box no taller than that.
    return { capR: capR, pa0: pa0, pa1: pa1,
             x: Math.min(k0[0], k1[0]), y: Math.min(k0[1], k1[1]), w: w, h: h,
             rx: Math.min(Math.min(w, h) / 2, CORNER) };
  }
  // ---- rails -----------------------------------------------------------
  //
  // Halo first, then the ink, then the paper that hollows it. Every line in
  // document order, so a rail drawn later passes over one drawn earlier.
  // Does the segment p-q cross the segment r-s? Proper crossings only: two
  // rails that merely touch at an end are a junction, not a crossing.
  function crosses(p, q, r, s) {
    function side(a, b, c) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
    var d1 = side(r, s, p), d2 = side(r, s, q), d3 = side(p, q, r), d4 = side(p, q, s);
    return ((d1 > 0.01 && d2 < -0.01) || (d1 < -0.01 && d2 > 0.01))
        && ((d3 > 0.01 && d4 < -0.01) || (d3 < -0.01 && d4 > 0.01));
  }
  // WHERE A RAIL IS DRAWN, at a minute inside one of its rounded corners.
  // The polyline says the vertex; the drawn path cuts the corner. A spur
  // that leaves its trunk inside the corner would otherwise start a few
  // pixels off the ink, in the gap the rounding opened.
  function roundedAt(line, a) {
    var p = line.pts;
    for (var i = 1; i < p.length - 1; i++) {
      var A = p[i - 1], Bv = p[i], Cc = p[i + 1];
      var l1 = Math.hypot(Bv[0] - A[0], Bv[1] - A[1]), l2 = Math.hypot(Cc[0] - Bv[0], Cc[1] - Bv[1]);
      var k = Math.min((Bv[2] != null ? Bv[2] : (line.branchOf ? CORNER * 0.6 : CORNER)), l1 / 2, l2 / 2);
      if (!(k > 0.5) || !l1 || !l2) continue;
      var x0 = Bv[0] + (A[0] - Bv[0]) * k / l1, y0 = Bv[1] + (A[1] - Bv[1]) * k / l1;
      var x2 = Bv[0] + (Cc[0] - Bv[0]) * k / l2, y2 = Bv[1] + (Cc[1] - Bv[1]) * k / l2;
      var lo = Math.min(x0, x2), hi = Math.max(x0, x2);
      if (a < lo - 0.01 || a > hi + 0.01 || hi - lo < 0.01) continue;
      // x(t) = (1-t)^2 x0 + 2(1-t)t xb + t^2 x2, solved for t on [0, 1].
      var qa = x0 - 2 * Bv[0] + x2, qb = 2 * (Bv[0] - x0), qc = x0 - a, t;
      if (Math.abs(qa) < 1e-6) t = qb ? -qc / qb : 0;
      else {
        var disc = Math.max(0, qb * qb - 4 * qa * qc), rt = Math.sqrt(disc);
        var t1 = (-qb + rt) / (2 * qa), t2 = (-qb - rt) / (2 * qa);
        t = (t1 >= -0.01 && t1 <= 1.01) ? t1 : t2;
      }
      t = Math.max(0, Math.min(1, t));
      var dx = 2 * (1 - t) * (Bv[0] - x0) + 2 * t * (x2 - Bv[0]);
      var dy = 2 * (1 - t) * (Bv[1] - y0) + 2 * t * (y2 - Bv[1]);
      return [a, (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * Bv[1] + t * t * y2,
              Math.atan2(dy, dx)];
    }
    return null;
  }
  // THE INK FIRST, THEN EVERY PAPER CORE. A spur drawn after its trunk laid
  // its ink over the trunk's core at the junction, and a hollow rail had a
  // blot where a branch left it -- "shelf branches should connect to the
  // trunk in a clean way, no join artefacts." With every core laid after
  // every rail, the trunk's core runs through the junction unbroken and
  // the spur's begins just outside the trunk's wall.
  // AN AMBIENT BLOCK IS A BAND BEHIND ITS RAIL. Sam's desk booking from eight
  // till seven: a light rounded band along the rail for those hours, so the
  // stretch reads at a glance as "at his desk", the meetings visibly leave it,
  // and nothing has to be read and mapped back. Its name is set small where it
  // begins (fixedFor). Following the rail as drawn, so a step or a corridor
  // carries the band with it.
  (spec.states || []).forEach(function (st) {
    if (!st.timed || st.from == null || !spec.scale || !spec.metro) return;
    var ln = board.lineByKey(st.owners[0]);
    var from = Math.max(st.from, spec.metro.day_start_min), to = Math.min(st.to, spec.metro.day_end_min);
    if (!ln || !(to > from)) return;
    var ba0 = spec.scale.at(from), ba1 = spec.scale.at(to), steps = 24, pts = [];
    for (var bi = 0; bi <= steps; bi++) {
      var ba = ba0 + (ba1 - ba0) * bi / steps, bc = ln.cAt(ba);
      if (bc != null) pts.push(xy(ba, bc));
    }
    if (pts.length < 2) return;
    var band = svgEl(doc, 'path', { d: 'M ' + pts.map(function (q) { return q[0] + ' ' + q[1]; }).join(' L '),
      fill: 'none', 'stroke-width': NODE_R * 3.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      'stroke-opacity': 0.13 });
    band.style.stroke = INK;
    put(band, 'band', ln.key);
  });
  // ...AND A GROUP EVENT IS THE SAME BAND, ON EVERY LINE IN IT (prototype).
  // A long shared stretch already draws the rails together with a diamond at
  // each end; the band says the same thing in the language the board already
  // has for "this line is occupied for these hours", without spending a
  // texture -- texture on this board means WHO, and a striped rail would read
  // as somebody else's line before it read as a busy one.
  // Drawn after the rails and their cores: the quiet stretches below.
  var away = [], quietOn = {};
  {
    // WHILE SOMEBODY IS AWAY, THEIR OWN TRACK IS NOT THE THING TO READ.
    //
    // "Delivery Run 9am - 4pm" is drawn as a shelf beside the rail, and the
    // rail underneath it runs on at full weight, so the eye stays on it and
    // the stretch reads as an ordinary morning. Hollowed out for those hours
    // -- the ink kept as two thin edges, the middle in paper -- the trunk
    // recedes and the shelf is what the eye lands on, which is where the
    // person actually is. No new texture: texture on this board says WHO.
    // WHOEVER JOINED A SHARED EVENT IS NOT ON THEIR OWN LINE MEANWHILE.
    //
    // The delivery run is Fry, Leela and Bender for seven hours. It is drawn
    // once, as a tube off the bar where they all met, and their own rails run
    // on underneath at full weight -- so the board says three people are
    // somewhere else and their lines are still the thing to read. Those
    // stretches are turned down: same rail, same texture, lighter ink, with
    // the event's own minutes as crisp edges.
    //
    // Who joined is a fact about the DAY, not about the drawing: a shared
    // event is drawn on one line's rail (as a ride), so the members are read
    // from the payload rather than from the shape on the board.
    //
    // Only where that person has nothing else in those hours. The professor
    // naps inside his own long event, and a rail with a stop on it is saying
    // something; Amy never joined the run at all, so her line is left alone.
    if (spec.scale && spec.metro) {
      var mLo = spec.metro.day_start_min, mHi = spec.metro.day_end_min;
      var evs = (spec.metro.events || []).filter(function (ev) {
        return (!ev.type || ev.type === 'event') && ev.start_min != null;
      });
      evs.forEach(function (ev) {
        var with_ = (ev.co_owners || []).filter(Boolean);
        if (!with_.length) return;
        var from = Math.max(ev.start_min, mLo), to = Math.min(ev.end_min == null ? ev.start_min : ev.end_min, mHi);
        if (!(to - from >= 60)) return;
        [ev.owner].concat(with_).filter(Boolean).forEach(function (k) {
          var tr = board.lineByKey(k);
          if (!tr) return;
          var busy = evs.some(function (o) {
            if (o === ev) return false;
            var mineO = o.owner === k || (o.co_owners || []).indexOf(k) >= 0;
            if (!mineO) return false;
            return o.start_min < to - 0.5 && (o.end_min == null ? o.start_min : o.end_min) > from + 0.5;
          });
          if (busy) return;
          var qa0 = spec.scale.at(from), qa1 = spec.scale.at(to);
          // FROM THE MARK, NOT FROM THE MINUTE. Where the line meets the bar
          // it joined, the quiet stretch starts at the edge of that ring, and
          // ends at the edge of whatever mark ends it: the grey begins and
          // ends ON the connectors rather than a few pixels off them, which is
          // what made the ends look arbitrary.
          var ringR = NODE_R * 1.4 + NODE_STROKE * 0.5;
          function edgeAt(a, dir) {
            var best = null;
            (board.pills || []).forEach(function (q) {
              if ((q.lines || []).indexOf(k) < 0) return;
              [q.a, q.a0, q.a1].forEach(function (qa) {
                if (qa == null || Math.abs(qa - a) > NODE_R * 1.6) return;
                var e = qa + dir * ringR;
                if (best == null || dir * (e - best) > 0) best = e;
              });
            });
            (board.stops || []).forEach(function (st3) {
              if (st3.line !== k || Math.abs(st3.a - a) > NODE_R * 1.6) return;
              var e2 = st3.a + dir * (NODE_R + NODE_STROKE * 0.5);
              if (best == null || dir * (e2 - best) > 0) best = e2;
            });
            return best == null ? a : best;
          }
          qa0 = edgeAt(qa0, 1);
          qa1 = edgeAt(qa1, -1);
          if (!(qa1 - qa0 > NODE_R)) return;
          // NOT INSIDE A CORRIDOR. Where this rail runs in a drawn corridor
          // for those hours the corridor already says the person is in it,
          // and drawing the rail quiet as well laid a grey ghost alongside
          // the tube: "there is a track overlaying lisa that shouldn't be
          // there." Bart was not quiet in the same corridor only because he
          // had a Field Trip inside it, so the two members of one event were
          // drawn two different ways within a single shape. The quiet
          // treatment is for a rail going quiet on its OWN row, which is
          // where it says something the picture does not already say.
          var boxed = (board.pills || []).some(function (q2) {
            if (q2.tie || (q2.lines || []).indexOf(k) < 0) return false;
            return q2.a0 <= qa0 + NODE_R && q2.a1 >= qa1 - NODE_R;
          });
          if (boxed) return;
          var wq = Math.max(2 * S, (tr.width || 3) * S) + WIDEN * S;
          var st2 = 48, mid = [];
          for (var ti2 = 0; ti2 <= st2; ti2++) {
            var ta = qa0 + (qa1 - qa0) * ti2 / st2, tc = tr.cAt(ta);
            if (tc != null) mid.push(xy(ta, tc));
          }
          if (mid.length < 2) return;
          var dMid = 'M ' + mid.map(function (q) { return q[0] + ' ' + q[1]; }).join(' L ');
          (quietOn[k] = quietOn[k] || []).push([qa0, qa1]);
          var wipe = svgEl(doc, 'path', { d: dMid, fill: 'none', 'stroke-width': wq + 0.6 * S,
            'stroke-linecap': 'butt', 'stroke-linejoin': 'round' });
          wipe.style.stroke = PAPER;
          away.push(wipe);
          var quiet = svgEl(doc, 'path', { d: dMid, fill: 'none', 'stroke-width': wq,
            'stroke-linecap': 'butt', 'stroke-linejoin': 'round', 'stroke-opacity': 0.42 });
          quiet.style.stroke = inkOf(k);
          away.push(quiet);
          var tq = treatment(tr.style, S, wq);
          if (tq) {
            var qov = svgEl(doc, 'path', { d: dMid, fill: 'none', 'stroke-width': tq.core,
              'stroke-linecap': tq.cap, 'stroke-linejoin': 'round', 'stroke-dasharray': tq.dash || null });
            qov.style.stroke = PAPER;
            away.push(qov);
          }
        });
      });
    }
    // A SHARED EVENT IS ITS CORRIDOR, NOT A WASH BEHIND IT. Every member's
    // rail used to take a light band for the whole of a long shared event,
    // on top of the corridor that already draws it and the quiet treatment
    // that already says they are in it. Three ways of saying one thing, and
    // the band was the one nobody could read: it began at the event's own
    // start rather than at the diamond, so it hung out past the mark as a
    // grey smudge with no edge -- "what's with the gray background before
    // the diamond of schoolday?" This is the band iteration 13's own notes
    // list as rejected ("a band behind the busy stretch (too quiet)"); the
    // drawing shipped anyway. Gone.
  }
  var overlays = [];
  // WHICH RAILS END IN A CHEVRON rather than a slash (see openEnded below,
  // which is the same question asked where the marks are drawn). Known here
  // because the paper core of a textured rail has to stop short of one: run
  // to the rail's last point, the white line went straight through the arrow
  // -- "the track peeks a little pixel or 2 through the arrow".
  var openAt = {};
  (spec.states || []).forEach(function (st) {
    if (st.timed) return;
    var e = st.ends || [true, true];
    st.owners.forEach(function (k) {
      var o = openAt[k] = openAt[k] || [false, false];
      o[0] = o[0] || e[0]; o[1] = o[1] || e[1];
    });
  });
  // How far a chevron reaches back from its tip, and how far the tip stands
  // out past the rail's last point: the same reach a terminal slash has, so a
  // line that ends in an arrow starts where its neighbours do.
  // A CHEVRON'S BASE SITS ON THE RAIL'S LAST POINT and its tip stands out by
  // the same depth, which is about what a terminal slash reaches, so a line
  // that ends in an arrow starts where its neighbours do. Base and depth equal
  // means the rail's ink and its paper core both end exactly where the V
  // begins: trimmed shorter, the last stretch of rail was solid ink and drew
  // a black block behind the arrowhead.
  function chevron() { var d = 4 * S * 1.6; return { back: d, out: d }; }
  board.lines.forEach(function (ln, li) {
    var lpts = ln.pts;
    if (ln.branchOf && lpts.length) {
      var trunk = board.lineByKey(ln.branchOf);
      var on = trunk ? roundedAt(trunk, lpts[0][0]) : null;
      if (on) lpts = [on].concat(lpts.slice(1));
    }
    var pts = lpts.map(function (p) { return xy(p[0], p[1], p[2]); });
    // A SPUR ROUNDS TIGHTER. An upright departure is two corners a mark's
    // reach apart, and at the trunk's radius they ate the whole upright and
    // Assembly left its group as an S: at six tenths the spur is plainly a
    // right angle out and a right angle along.
    var railR = ln.branchOf ? CORNER * 0.6 : CORNER;
    var d = pathOf(pts, railR);
    if (!d) return;
    var w = ln.branchOf ? RAIL_W * 0.8 : RAIL_W;
    // WHAT A HALO IS FOR: severing a rail this one passes OVER. Rails drawn
    // before this one, and not the trunk a spur belongs to -- a branch
    // leaves its trunk, it does not cross it.
    var earlier = board.lines.slice(0, li).filter(function (o) {
      return o.key !== ln.branchOf && o.branchOf !== ln.key;
    });

    // ONLY AT THE CROSSING ITSELF. A halo along the whole turning piece,
    // twelve pixels proud, is wider than the gap between two rails nested
    // one gap apart: Marge's exit halo took Lisa's whole run out of the
    // dinner beside it. What a crossing needs is a short bar of paper along
    // the rail that passes over, a little wider than that rail, exactly
    // where it meets the rail underneath -- and nothing anywhere else.
    function meetAt(p, q, r, s) {
      var d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0]);
      if (Math.abs(d) < 1e-9) return null;
      var t = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d;
      return [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])];
    }
    for (var xi = 1; xi < lpts.length; xi++) {
      var xp = lpts[xi - 1], xq = lpts[xi];
      var xl = Math.hypot(xq[0] - xp[0], xq[1] - xp[1]);
      if (xl < 0.01) continue;
      var ua = (xq[0] - xp[0]) / xl, uc = (xq[1] - xp[1]) / xl;
      for (var xj = 0; xj < earlier.length; xj++) {
        var op = earlier[xj].pts;
        for (var xk = 1; xk < op.length; xk++) {
          if (!crosses(xp, xq, op[xk - 1], op[xk])) continue;
          var at = meetAt(xp, xq, op[xk - 1], op[xk]);
          if (!at) continue;
          // Just long enough to clear the rail underneath, and just wide
          // enough to leave a sliver of paper either side: any more and the
          // bar reaches the corner a rail takes right beside the crossing,
          // which is where Lisa's turn out of the dinner was cut off.
          var half = w * 0.9 + 2 * S;
          var h0 = xy(at[0] - ua * half, at[1] - uc * half), h1 = xy(at[0] + ua * half, at[1] + uc * half);
          var halo = svgEl(doc, 'line', { x1: h0[0], y1: h0[1], x2: h1[0], y2: h1[1],
            'stroke-width': w + 5 * S, 'stroke-linecap': 'butt' });
          halo.style.stroke = PAPER;
          svg.appendChild(halo);
        }
      }
    }

    var tr = treatment(ln.style, S, w);
    // A TIE'S SPUR IS THE TIE CONTINUED: the bar's own plain ink at the
    // rail's weight, no texture, ending in a small ring (below), so the
    // event hanging off the bar is read as part of the shared thing and not
    // as one more stop on one line. HOLLOW, like the bar it continues: "make
    // the family branch also a hollow line" (a tube at a rail's weight once
    // "looked poorly"; at the bar's own outline it reads as the bar going on).
    var tube = !!(ln.branchOf && ln.ink);
    if (tube) { w = TUBE_W; tr = { widen: 0, core: BAR_CORE, cap: 'butt' }; }
    var rail = svgEl(doc, 'path', { d: d, 'stroke-width': tube ? w : w + WIDEN * S, fill: 'none',
      'stroke-linejoin': 'round',
      // BUTT-ENDED, every rail: a round cap put half the rail's width past its
      // last point, and at the edge that half-disc stuck out behind the start
      // slash -- "start symbol has the line peeking out".
      'stroke-linecap': 'butt' });
    rail.style.stroke = tube ? INK : inkOf(ln.key);
    rail.style.fill = 'none';
    put(rail, ln.branchOf ? 'spur' : 'track', ln.branchOf || ln.key);

    var t = tr;
    if (t) {
      // A SPUR'S PAPER STARTS CLEAR OF ITS TRUNK. The texture is paper laid
      // over ink, and a branch that begins on its trunk laid its first
      // dashes of paper over the trunk's ink: "branches like Assembly take
      // a chunk out of the main track." The spur's overlay begins a stroke
      // and a half along, so the junction is drawn in ink alone.
      // ...BUT A CONTINUOUS CORE RUNS STRAIGHT ON. Trimmed, the white line of
      // a railway-style rail broke at every junction: "don't break the white
      // line going into the branch". Only a patterned texture takes chunks
      // out of its trunk; an unbroken core simply joins the trunk's.
      var dOv = d;
      if (ln.branchOf && pts.length > 1 && t.dash) {
        var f0 = pts[0], f1 = pts[1];
        var fl = Math.hypot(f1[0] - f0[0], f1[1] - f0[1]), trim = Math.min(fl * 0.9, w * 0.9 + 1 * S);
        var head = [f0[0] + (f1[0] - f0[0]) * trim / fl, f0[1] + (f1[1] - f0[1]) * trim / fl];
        dOv = pathOf([head].concat(pts.slice(1)), railR);
      }
      var ov = svgEl(doc, 'path', { d: dOv, 'stroke-width': t.core, fill: 'none',
        'stroke-linecap': t.cap, 'stroke-linejoin': 'round',
        'stroke-dasharray': t.dash || null });
      ov.style.stroke = PAPER;
      ov.style.fill = 'none';
      ov.setAttribute('data-metro-overlay', ln.key);
      overlays.push(ov);
    }
  });
  overlays.forEach(function (ov) { svg.appendChild(ov); });
  away.forEach(function (n) { put(n, 'away'); });

  // ---- where the day turns over -----------------------------------------
  //
  // A board that runs past midnight is ONE continuous scale, and "09:00" on a
  // thirty-six hour board is two different mornings. The strip names each day
  // where it starts; this is the same fact drawn on the MAP, as the double
  // rule a transit diagram uses for a boundary, so a rail crossing it can be
  // seen to cross it.
  var days = (spec.metro && spec.metro.days) || [];
  if (days.length > 1 && spec.scale && spec.cross) {
    days.forEach(function (d, di) {
      if (!di || d.start_min == null) return;
      var mx = spec.scale.at(d.start_min);
      // EVERY RAIL CROSSES IT WHOLE. The double rule and the paper between
      // its two lines are drawn in pieces around each rail, so the rail is
      // never painted over. A rail with nothing on it at the midnight bridges
      // it, the rule standing clear of it with the bridge's pillars either
      // side; one carrying an event across the midnight has the rule tunnel
      // under it, a hair clear.
      var xings = [];
      board.lines.forEach(function (ln) {
        var rc = ln.cAt(mx), reach = 10 * S;
        if (rc == null || ln.pts.length < 2 || ln.pts[0][0] > mx - reach || ln.pts[ln.pts.length - 1][0] < mx + reach) return;
        var rw = railStroke(ln, ln.key).width, across = eventOn(ln, mx);
        xings.push({ ln: ln, rc: rc, rw: rw, across: across, clear: across ? 2 * S : rw * 0.6 });
      });
      function pieces(lo, hi, pad) {
        var out = [[lo, hi]];
        xings.slice().sort(function (p, q) { return p.rc - q.rc; }).forEach(function (x) {
          var g0 = x.rc - x.rw / 2 - (pad ? x.clear : 0), g1 = x.rc + x.rw / 2 + (pad ? x.clear : 0), next = [];
          out.forEach(function (pc) {
            if (g1 <= pc[0] || g0 >= pc[1]) { next.push(pc); return; }
            if (g0 > pc[0]) next.push([pc[0], g0]);
            if (g1 < pc[1]) next.push([g1, pc[1]]);
          });
          out = next;
        });
        return out;
      }
      var mapC0 = strip ? strip.c1 : spec.cross.c0;
      pieces(mapC0, horizontal ? H : W, false).forEach(function (pc) {
        var k0 = xy(mx - 2.25 * S, pc[0]), k1 = xy(mx + 2.25 * S, pc[1]);
        var knock = svgEl(doc, 'rect', { x: Math.min(k0[0], k1[0]), y: Math.min(k0[1], k1[1]),
          width: Math.abs(k1[0] - k0[0]), height: Math.abs(k1[1] - k0[1]), stroke: 'none' });
        knock.style.fill = PAPER;
        put(knock, 'midnight');
        groundOver(knock, mx);
      });
      [-1.5 * S, 1.5 * S].forEach(function (off) {
        pieces(mapC0, spec.cross.c1, true).forEach(function (pc) {
          var m0 = xy(mx + off, pc[0]), m1 = xy(mx + off, pc[1]);
          var ml = svgEl(doc, 'line', { x1: m0[0], y1: m0[1], x2: m1[0], y2: m1[1],
            'stroke-width': 1.5 * S, 'stroke-linecap': 'butt' });
          ml.style.stroke = INK;
          put(ml, 'midnight');
        });
        // ...AND ON THROUGH THE STRIP, "continue drawing the double lines
        // through the header", drawn as it is on the map -- two ink rules
        // with paper between -- so it reads as the same boundary on both
        // panels rather than as one light and one dark line.
        if (!strip) return;
        if (off < 0) {
          var g0 = xy(mx - 2.25 * S, 0), g1 = xy(mx + 2.25 * S, strip.c1);
          var gap = svgEl(doc, 'rect', { x: Math.min(g0[0], g1[0]), y: Math.min(g0[1], g1[1]),
            width: Math.abs(g1[0] - g0[0]), height: Math.abs(g1[1] - g0[1]), stroke: 'none' });
          gap.style.fill = PAPER;
          put(gap, 'midnight');
        }
        var h0 = xy(mx + off, 0), h1 = xy(mx + off, strip.c1);
        var hl2 = svgEl(doc, 'line', { x1: h0[0], y1: h0[1], x2: h1[0], y2: h1[1],
          'stroke-width': 1.5 * S });
        hl2.style.stroke = INK;
        put(hl2, 'midnight');
      });
      xings.forEach(function (x) {
        if (!x.across) guardrails([mx, x.rc], [1, 0], 6 * S, x.ln, x.ln.key);
      });
    });
  }


  // ---- speed marks ------------------------------------------------------
  //
  // GONE FROM THE RAILS TOO: "remove the speedlines on the track as well".
  // The scale only runs fast over the night now (day.js), and the strip's
  // hours say where.

  // ---- shared events: the board of the ninth ------------------------------
  //
  // A TIE is what a transit map draws for an interchange: one bar from the
  // topmost line that calls there to the bottommost, at the event's minute,
  // with a hollow ring on each line where the bar crosses it. The lines stay
  // where they are; the name hangs off the owner's line like any other.
  //
  // A CONVERGENCE is the lines run together for the event, marked with a
  // hollow diamond on each rail where the run begins and where it ends --
  // the mark for a line changing state, not for something happening on it,
  // and a different shape from the ring so it says so at a glance. Not
  // where each rail left its row: "remove the diamonds that are there now,
  // have diamonds where the | symbols are."
  // THE BAR IS HOLLOW, the interchange connector of a transit map: an ink
  // outline with paper inside, fatter than any rail, so it cannot be read as
  // somebody's black line running down the board -- "the shared events track
  // should have its own unique style".
  // DRAWN IN PIECES AROUND ITS GAPS, never painted over: a cut laid in paper
  // and the line laid back over it left a seam either side -- "there's a
  // little line on both sides of the bridge track". `gaps` are [c0, c1]
  // stretches the bar leaves open, for a name or a line to pass through.
  function bar(a, c0, c1, id, gaps) {
    var pieces = [[c0, c1]];
    (gaps || []).slice().sort(function (p, q) { return p[0] - q[0]; }).forEach(function (g) {
      var next = [];
      pieces.forEach(function (pc) {
        if (g[1] <= pc[0] || g[0] >= pc[1]) { next.push(pc); return; }
        if (g[0] > pc[0]) next.push([pc[0], g[0]]);
        if (g[1] < pc[1]) next.push([g[1], pc[1]]);
      });
      pieces = next;
    });
    pieces.forEach(function (pc) {
      var t0 = xy(a, pc[0]), t1 = xy(a, pc[1]);
      // round only where the bar really ends, under its rings
      var cap = pc[0] <= c0 + 0.5 && pc[1] >= c1 - 0.5 ? 'round' : 'butt';
      var n = svgEl(doc, 'line', { x1: t0[0], y1: t0[1], x2: t1[0], y2: t1[1],
        'stroke-width': BAR_W, 'stroke-linecap': cap });
      n.style.stroke = INK;
      put(n, 'capsule', id);
      var core = svgEl(doc, 'line', { x1: t0[0], y1: t0[1], x2: t1[0], y2: t1[1],
        'stroke-width': BAR_CORE, 'stroke-linecap': cap });
      core.style.stroke = PAPER;
      put(core, 'capsule-core', id);
    });
  }
  // THE MERGE SYMBOL: one hollow diamond across the joined rails, reaching a
  // mark's radius past the outermost, where the run begins and where it
  // ends. "Let's make diamonds a merge / unmerge symbol."
  function diamond(a, c0, c1, id) {
    var q0 = xy(a, c0), q1 = xy(a, c1), dr = NODE_R * 0.95;
    var cx = (q0[0] + q1[0]) / 2, cy = (q0[1] + q1[1]) / 2;
    var hx = dr + (horizontal ? 0 : Math.abs(q1[0] - q0[0]) / 2);
    var hy = dr + (horizontal ? Math.abs(q1[1] - q0[1]) / 2 : 0);
    var n = svgEl(doc, 'path', {
      d: 'M ' + (cx - hx) + ' ' + cy + ' L ' + cx + ' ' + (cy - hy)
        + ' L ' + (cx + hx) + ' ' + cy + ' L ' + cx + ' ' + (cy + hy) + ' Z',
      'stroke-width': NODE_STROKE * 0.8, 'stroke-linejoin': 'round' });
    n.style.fill = PAPER; n.style.stroke = INK;
    put(n, 'merge', id);
  }
  // The merge symbol's half that is on the paper: flat along the edge, the
  // point towards the day. `dir` is +1 at the head of the axis, -1 at its end.
  function halfDiamond(a, c0, c1, dir, id) {
    var dr = NODE_R * 0.95;
    var e0 = xy(a, c0 - dr), e1 = xy(a, c1 + dr);
    var tip = xy(a + dir * dr, (c0 + c1) / 2);
    var n = svgEl(doc, 'path', {
      d: 'M ' + e0[0] + ' ' + e0[1] + ' L ' + tip[0] + ' ' + tip[1]
        + ' L ' + e1[0] + ' ' + e1[1] + ' Z',
      'stroke-width': NODE_STROKE * 0.8, 'stroke-linejoin': 'round' });
    n.style.fill = PAPER; n.style.stroke = INK;
    put(n, 'merge-from', id);
  }
  // WHICH TERMINAL SLASHES A HALF MARK HAS TAKEN THE PLACE OF, as
  // line -> [head?, tail?].
  var uncapped = {};
  var axisA0 = spec.axis.a0, axisA1 = spec.axis.a1;
  function cut(pl, end) {
    (pl.lines || []).forEach(function (k) { (uncapped[k] = uncapped[k] || [])[end] = true; });
  }
  var edgeDots = {};  // line -> its "..." has moved inside, past the edge ring
  var edgeShift = {}; // line -> where its name has to start to clear that ring
  var tiedAt = {};   // line -> [a]: a ring already marks this minute
  // WHOSE RING IT IS, IN LETTERS. "Put small inline initials directly inside
  // the event nodes, so she doesn't have to follow line patterns to figure
  // out whose turn it is for taxi duty": on a full view each ring of a shared
  // event carries its person's initial -- two letters where two people start
  // with the same one. A slot keeps its rings plain.
  var initials = {};
  (function () {
    var legend = (spec.metro && spec.metro.legend) || [], first = {};
    legend.forEach(function (p) {
      var f = String(p.name || p.key).trim().charAt(0).toUpperCase();
      first[f] = (first[f] || 0) + 1;
    });
    // ...and the second letter is one that TELLS THEM APART: "Ma" for Maggie
    // and "Ma" for Marge said nothing, so it is the first letter along where
    // this name differs from every other name with the same first letter
    // (Maggie Mg, Marge Mr).
    var used = {};
    legend.forEach(function (p) {
      var nm = String(p.name || p.key).trim();
      var f = nm.charAt(0).toUpperCase();
      if (!(first[f] > 1)) { initials[p.key] = f; return; }
      var others = legend.filter(function (q) {
        return q !== p && String(q.name || q.key).trim().charAt(0).toUpperCase() === f;
      }).map(function (q) { return String(q.name || q.key).trim().toLowerCase(); });
      var low = nm.toLowerCase(), pick = null;
      for (var j = 1; j < low.length && !pick; j++) {
        var ch = low.charAt(j);
        if (!/[a-z0-9\u00c0-\u024f]/.test(ch) || used[f + ch]) continue;
        if (others.every(function (o) { return o.charAt(j) !== ch; })) pick = ch;
      }
      if (!pick) pick = low.charAt(1);
      used[f + pick] = true;
      initials[p.key] = f + pick;
    });
  })();
  var ringFace = null;
  // THE MOON AS AN ADAPTIVE IMAGE (after the night sky plugin): the dark of
  // the moon as ink with the lit part cut out of it, and a ring round the
  // whole. Drawn as the framework's `image--adaptive`, the same as a weather
  // icon, so on the inverse panel the framework turns it white by itself:
  // "just make the svg for the moon with image class".
  // THE MOON IN ITS OWN COLOURS: a black disc with the lit part white, as a
  // plain framework `image` with an `image-stroke` rim, not an adaptive one. Adaptive, the
  // framework recoloured it for the panel it sat on and the inverse panel
  // turned it inside out -- "the moon should always be white".
  function moonImg(illum, waxing, size) {
    var mr = 11, mc = 12, lit = '';
    if (illum > 2 && illum < 98) {
      var frac = illum / 100, ex = Math.round(mr * Math.abs(1 - 2 * frac) * 10) / 10;
      var bs = waxing ? 1 : 0, ts = frac < 0.5 ? (1 - bs) : bs;
      lit = 'M ' + mc + ',' + (mc - mr) + ' A ' + mr + ' ' + mr + ' 0 0 ' + bs + ' '
        + mc + ',' + (mc + mr) + ' A ' + ex + ' ' + mr + ' 0 0 ' + ts + ' ' + mc + ',' + (mc - mr) + ' Z';
    }
    // crisp on a 1-bit panel, the board's own trick (the svg's shape-rendering):
    // anti-aliased edges dither into a fuzz there. No rim of its own: on the
    // black panel the lit part alone reads best, and elsewhere the image-stroke
    // gives the dark of the moon its edge.
    var svgText = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' shape-rendering='"
      + (ONE_BIT ? 'crispEdges' : 'geometricPrecision') + "'>"
      + "<circle cx='12' cy='12' r='11' fill='" + (illum >= 98 ? 'white' : 'black') + "'/>"
      + (lit ? "<path fill='white' d='" + lit + "'/>" : '') + '</svg>';
    var im = doc.createElement('img');
    // outlined by the framework in white, so the dark
    // of the moon has an edge on the black panel and the grey one alike
    im.className = 'image image-stroke image-stroke--small image-stroke--white';
    im.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(svgText);
    im.style.width = size + 'px'; im.style.height = size + 'px';
    return im;
  }
  function initialIn(q, k) {
    if (spec.oneName || !initials[k]) return;
    var txt = initials[k], two = txt.length > 1;
    var t = svgEl(doc, 'text', { x: q[0], y: q[1] });
    // the size as a style property: the template's linter counts the
    // hyphenated names of a few CSS properties anywhere in the markup
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('dominant-baseline', 'central');
    t.style.fontSize = (NODE_R * (two ? 1.2 : 1.55)) + 'px';
    t.style.fontWeight = '700';
    t.textContent = txt;
    t.style.fill = INK;
    // in the face the board's words are in: an SVG text is set in the
    // browser's default serif unless it is told otherwise
    if (ringFace == null) {
      ringFace = '';
      var probeL = html('label text--bold', 'M');
      if (doc.defaultView && doc.defaultView.getComputedStyle) ringFace = doc.defaultView.getComputedStyle(probeL).fontFamily || '';
      probeL.remove();
    }
    if (ringFace) t.style.fontFamily = ringFace;
    put(t, 'ring-initial', k);
  }
  var bridgesOn = {}, underOn = {};
  // WHERE NAMES CROSS A TIE'S BAR, in board units along the bar ([c0, c1]):
  // the bar is cut there (below).
  function capGaps(pl) {
    var out = [];
    board.caps.forEach(function (cp) {
      var cb = cp.box();
      if (cb.a0 > pl.a + BAR_W / 2 || cb.a1 < pl.a - BAR_W / 2) return;
      var g0 = Math.max(pl.c0, cb.c0 - 3 * S), g1 = Math.min(pl.c1, cb.c1 + 3 * S);
      if (g1 > g0) out.push([g0, g1]);
    });
    return out;
  }
  // WHERE A RAIL CROSSES A TIE'S BAR (see "which, is not a choice" above):
  // a rail with nothing on it there is a bridge over the bar; one with an
  // event on it, or running beside a name cut into the bar, has the bar go
  // under it and its event and the name in one cut. The rail is never cut.
  (function () {
    (board.pills || []).forEach(function (pl) {
      if (!pl.tie || (pl.open0 && pl.a <= axisA0 + 1)) return;
      var members = pl.lines || [];
      var bp = [pl.a, Math.min(pl.c0, pl.c1)], bq = [pl.a, Math.max(pl.c0, pl.c1)];
      board.lines.forEach(function (ln) {
        if (members.indexOf(ln.key) >= 0 || ln.pts.length < 2) return;
        if (ln.branchOf && members.indexOf(ln.branchOf) >= 0 && Math.abs(ln.pts[0][0] - pl.a) < 1) return;
        for (var i = 1; i < ln.pts.length; i++) {
          var p = ln.pts[i - 1], q = ln.pts[i];
          if (!crosses(p, q, bp, bq)) continue;
          var l = Math.hypot(q[0] - p[0], q[1] - p[1]);
          var xing = { a: pl.a, c: p[1] + (q[1] - p[1]) * (pl.a - p[0]) / (q[0] - p[0]),
            ua: (q[0] - p[0]) / l, uc: (q[1] - p[1]) / l, key: ln.key };
          // BESIDE A NAME ALREADY CUT INTO THE BAR, the bar goes under the
          // rail and the name in one: "it needs to tunnel under the track and
          // caption". No cut in the rail, no bridge beside the words.
          var hw = railStroke(ln, ln.key).width / 2 + 2 * S;
          var besideName = capGaps(pl).some(function (g) {
            return xing.c + hw > g[0] - 10 * S && xing.c - hw < g[1] + 10 * S;
          });
          // once per rail: a crossing that falls on a vertex is found on both
          // of its segments, and drawn twice it was a bridge with six pillars
          var seenOn = (underOn[pl.id] || []).concat(bridgesOn[pl.id] || []);
          if (seenOn.some(function (o) { return o.key === xing.key && o.a === xing.a && Math.abs(o.c - xing.c) < 4 * S; })) continue;
          if (besideName || eventOn(ln, pl.a)) (underOn[pl.id] = underOn[pl.id] || []).push(xing);
          else (bridgesOn[pl.id] = bridgesOn[pl.id] || []).push(xing);
        }
      });
    });
  })();
  (board.pills || []).forEach(function (pl) {
    var members = pl.lines || [];
    if (pl.tie) {
      // A TIE ALREADY RUNNING WHEN THE BOARD OPENED did not meet at the
      // first minute of the paper: no bar and no rings at the edge, only
      // its spur arriving under the half dot (rule 2g).
      var atEdge = pl.open0 && pl.a <= axisA0 + 1;
      // ...BUT ITS NAME STILL HAS TO HANG ON SOMETHING, AND IT HAS TO LOOK
      // LIKE AN INTERCHANGE. A shared event already running when the board
      // opened left its name loose beside the frame: "Delivery Run is just
      // floating now, not attached to anything." A dashed rule in the gutter
      // did not fix it, because nothing about it was the shape the board
      // uses for people meeting: "the connector is just like the normal one."
      //
      // So it IS the normal one, a ring on each member's rail and a solid bar
      // joining them, and the fact that they met before the paper began is
      // carried by the three dots instead. Those dots already exist at this
      // end of every rail that runs on past the edge, sitting in the gutter
      // and spilling off it -- there is no room out there for a ring, the
      // gutter being twelve units wide and a lettered ring twenty-nine. So
      // they change sides: "the 3 dots go between the Hollow Dot with letter
      // and the track." The ring takes the rail's start, the dots stand to
      // its right, and the rail's ink begins after them.
      if (atEdge) {
        var eRingR = NODE_R * 1.4 + NODE_STROKE * 0.5;
        var eGap = Math.max(RAIL_W * 1.3, 2.6 * S);
        var eDr = Math.max(1.2 * S, RAIL_W * 0.42);
        var eFrom = pl.a + eRingR + eGap * 4;
        members.forEach(function (k5) {
          var l5 = board.lineByKey(k5);
          if (!l5) return;
          // The rail's own ink pulled back off the ring and the dots, so they
          // stand on paper rather than on top of the line they belong to.
          edgeDots[k5] = true;
          edgeShift[k5] = eFrom;
          var w5 = railStroke(l5, k5).width + 1.2 * S;
          var c5 = l5.cAt(pl.a);
          if (c5 == null) return;
          var p5 = xy(pl.a - eRingR, c5), q5 = xy(eFrom, c5);
          var wipe5 = svgEl(doc, 'line', { x1: p5[0], y1: p5[1], x2: q5[0], y2: q5[1],
            'stroke-width': w5, 'stroke-linecap': 'butt' });
          wipe5.style.stroke = PAPER;
          put(wipe5, 'edge-clear', k5);
          for (var d5 = 1; d5 <= 3; d5++) {
            var t5 = xy(pl.a + eRingR + eGap * d5, c5);
            var dot5 = svgEl(doc, 'circle', { cx: t5[0], cy: t5[1], r: eDr, stroke: 'none' });
            dot5.style.fill = inkOf(k5);
            put(dot5, 'terminal-more', k5);
          }
        });
        // The bar itself, solid and the same weight as any other.
        bar(pl.a, pl.c0, pl.c1, pl.id, capGaps(pl));
        // ...AND A SHELF OFF IT, SAYING HOW FAR THE EVENT RUNS.
        //
        // The ring column says three people are together and the quiet rails
        // say for how long, but quietly: "delivery run doesn't have a shelf
        // which it should." Every other event of any length is drawn as
        // something with a length, so this one is too, in the same hollow the
        // bar and the corridor use -- one wall, one paper core, "the
        // connector and the branch don't use the exact same style" is a
        // complaint this grammar already answered once.
        //
        // It hangs a bar's depth under the lowest member, which is clear of
        // that rail and of the name the solver put below it. Only where it is
        // really clear: the solver booked no paper for this, so a shelf that
        // would cross any caption is not drawn at all. A missing shelf costs
        // the reader a duration they can still get from the rails; a shelf
        // through a name costs them the name.
        var shTo = null;
        (pl.ends || []).forEach(function (en) { if (!en.open1 && en.to != null) shTo = en.to; });
        if (shTo == null && !pl.open1) shTo = pl.to;
        var shC = pl.c1 + BAR_W;
        if (shTo != null && shTo > pl.a + NODE_R * 3) {
          var shClear = (board.caps || []).every(function (cp3) {
            var cb3 = cp3.box();
            return !(cb3.a0 < shTo + NODE_R && cb3.a1 > pl.a - NODE_R
                     && cb3.c0 < shC + BAR_W * 0.5 + 1 * S && cb3.c1 > shC - BAR_W * 0.5 - 1 * S);
          });
          if (shClear) {
            var shD = 'M ' + xy(pl.a, pl.c1).join(' ') + ' L ' + xy(pl.a, shC).join(' ')
              + ' L ' + xy(shTo, shC).join(' ');
            var shOut = svgEl(doc, 'path', { d: shD, fill: 'none', 'stroke-width': TUBE_W,
              'stroke-linecap': 'butt', 'stroke-linejoin': 'round' });
            shOut.style.stroke = INK;
            put(shOut, 'capsule', pl.id);
            var shIn = svgEl(doc, 'path', { d: shD, fill: 'none', 'stroke-width': BAR_CORE,
              'stroke-linecap': 'butt', 'stroke-linejoin': 'round' });
            shIn.style.stroke = PAPER;
            put(shIn, 'capsule-core', pl.id);
            // ...ENDING IN A TICK, the way everything that stops does.
            var shH = Math.max(NODE_R * 1.05, TUBE_W * 0.75);
            var e0s = xy(shTo, shC - shH), e1s = xy(shTo, shC + shH);
            var shEnd = svgEl(doc, 'line', { x1: e0s[0], y1: e0s[1], x2: e1s[0], y2: e1s[1],
              'stroke-width': NODE_STROKE, 'stroke-linecap': 'butt' });
            shEnd.style.stroke = INK;
            put(shEnd, 'stop', pl.id);
          }
        }
      }
      // THE BAR TUNNELS UNDER A NAME WRITTEN ACROSS IT (captions.js lets one
      // stand there), and under a busy line, and a line with nothing on it
      // bridges it: in every case the bar leaves a gap and whatever crosses
      // is left as it was drawn. A name's gap swallows a crossing beside it.
      if (!atEdge) {
        var gaps = [], mouths = [];
        capGaps(pl).forEach(function (gp) {
          var g0 = gp[0], g1 = gp[1];
          (underOn[pl.id] || []).forEach(function (x) {
            var hw = railStroke(board.lineByKey(x.key), x.key).width / 2 + 2 * S;
            if (x.c + hw > g0 - 10 * S && x.c - hw < g1 + 10 * S) { g0 = Math.min(g0, x.c - hw); g1 = Math.max(g1, x.c + hw); }
          });
          gaps.push([Math.max(pl.c0, g0), Math.min(pl.c1, g1)]);
        });
        (underOn[pl.id] || []).forEach(function (x) {
          var hw = railStroke(board.lineByKey(x.key), x.key).width / 2 + 2 * S;
          if (gaps.some(function (g) { return x.c >= g[0] && x.c <= g[1]; })) return;
          gaps.push([x.c - hw, x.c + hw]);
        });
        // ...WITH A PORTAL AT EACH MOUTH of a tunnel: a hairline across where
        // the bar goes in and comes out, a little wider than the bar.
        gaps.forEach(function (g) { mouths.push(g[0], g[1]); });
        (bridgesOn[pl.id] || []).forEach(function (x) {
          var bl = board.lineByKey(x.key), rw = railStroke(bl, x.key).width;
          gaps.push([x.c - rw / 2 - rw * 0.6, x.c + rw / 2 + rw * 0.6]);
        });
        bar(pl.a, pl.c0, pl.c1, pl.id, gaps);
        mouths.forEach(function (gc) {
          if (gc <= pl.c0 + 0.5 || gc >= pl.c1 - 0.5) return;
          var m0 = xy(pl.a - BAR_W * 0.95, gc), m1 = xy(pl.a + BAR_W * 0.95, gc);
          var mouth = svgEl(doc, 'line', { x1: m0[0], y1: m0[1], x2: m1[0], y2: m1[1],
            'stroke-width': 0.9 * S, 'stroke-linecap': 'butt' });
          mouth.style.stroke = INK;
          put(mouth, 'portal', pl.id);
        });
        (bridgesOn[pl.id] || []).forEach(function (x) {
          guardrails([x.a, x.c], [x.ua, x.uc], BAR_W / 2 + 2 * S, board.lineByKey(x.key), x.key);
        });
      }
      // AND WHERE IT ENDS, ON EVERY LINE THAT WAS IN IT.
      //
      // A ring says this line arrived here; with nothing at the far end, a
      // six-hour school day reads as still going on. Ticks rather than a
      // second bar, because rule 30's reason holds whether the lines are in a
      // corridor or on their own rows: a bar across them all says the LINES
      // stop there, and what stops is the event.
      (pl.ends || (pl.to != null ? [{ to: pl.to, lines: members, open1: pl.open1 }] : [])).forEach(function (end) {
        if (end.open1) return;
        end.lines.forEach(function (k) {
          var ln2 = board.lineByKey(k);
          var c2 = ln2 ? ln2.cAt(end.to) : null;
          if (c2 == null) return;
          // NOT ON A RAIL THAT HAS GONE QUIET. The event is drawn as its own
          // tube and that tube ends in a tick; ticking each member's own rail
          // as well gave one event four terminators, three of them on rails
          // nobody was riding at the time.
          if ((quietOn[k] || []).some(function (r2) { return end.to >= r2[0] - NODE_R && end.to <= r2[1] + NODE_R; })) return;
          var half = Math.max(NODE_R * 1.05, railStroke(ln2, k).width * 1.25);
          markLine(xy(end.to, c2 - half), xy(end.to, c2 + half), ln2, k, 'stop');
        });
      });
      members.forEach(function (k) {
        var ln = board.lineByKey(k);
        var c = ln ? ln.cAt(pl.a) : null;
        if (c == null) return;
        var q = xy(pl.a, c);
        var lettered = !spec.oneName && initials[k];
        var rr = NODE_R * (lettered ? 1.4 : 1);
        // (a task's rings are squares, as its stop is)
        var ring = pl.todo
          ? svgEl(doc, 'rect', { x: q[0] - rr * 0.9, y: q[1] - rr * 0.9, width: rr * 1.8, height: rr * 1.8,
              'stroke-width': NODE_STROKE * (lettered ? 0.8 : 1) })
          : svgEl(doc, 'circle', { cx: q[0], cy: q[1], r: rr,
              'stroke-width': NODE_STROKE * (lettered ? 0.8 : 1) });
        ring.style.fill = PAPER; ring.style.stroke = INK;
        // A RING AT THE BOARD'S OPENING EDGE IS NAMED APART. Its rail starts
        // underneath it and runs away to the right, so the line does not pass
        // THROUGH it the way it passes through every other ring; what came
        // before is off the paper, and the three dots beside it say so. The
        // rule that every ring is a crossing is real and stays, so this one
        // carries its own name rather than quietly weakening it.
        put(ring, atEdge ? 'ring-edge' : 'ring', k);
        if (lettered) initialIn(q, k);
        (tiedAt[k] = tiedAt[k] || []).push(pl.a);
      });
      return;
    }
    // The bars stand where the rails ARE together: a rail that joined late
    // for a ring before the group moves the first bar to its arrival.
    var pa0 = pl.a0 == null ? pl.a : pl.a0, pa1 = pl.a1 == null ? pl.a : pl.a1;
    var b0 = pa0, b1 = pa1;
    (pl.joins || []).forEach(function (j) {
      if (j.in_ != null) b0 = Math.max(b0, j.in_);
      if (j.out != null) b1 = Math.min(b1, j.out);
    });
    // A mark's radius inside the run, past the corner the last rail rounds
    // as it arrives, and across the bundle's own levels: measured at the
    // arrival itself, an upright rail is still on its way down and the
    // diamond spanned the rows instead of the run.
    var ends = b1 > b0 + NODE_R * 4 ? [b0 + NODE_R, b1 - NODE_R] : [(b0 + b1) / 2];
    // OUT OF A SPUR'S WAY. A stop inside the group leaves it on a spur a
    // little before its own minute; where that departure falls on the
    // diamond, the diamond stands earlier, back towards the arrival.
    var dr = NODE_R * 0.95, spurW = RAIL_W * 0.8;
    board.lines.forEach(function (l) {
      if (!l.branchOf || members.indexOf(l.branchOf) < 0 || !l.pts.length) return;
      var dep = l.pts[0][0];
      ends = ends.map(function (a) {
        if (dep < a - dr - spurW || dep > a + dr + spurW) return a;
        return Math.max(b0 - NODE_R * 0.5, Math.min(a, dep - spurW / 2 - dr - 1 * S));
      });
    });
    // A merge the board did not see is not a merge: a corridor already
    // running when the window opened arrives from off the paper, with no
    // diamond at the edge to say it began there.
    ends.forEach(function (a, i) {
      if (pl.open0 && i === 0 && ends.length > 1) return;
      if (pl.open1 && i === ends.length - 1 && ends.length > 1) return;
      diamond(a, pl.c0, pl.c1, pl.id);
    });
    // ...BUT THE SAME DIAMOND, CUT IN HALF, at the edge it arrives through:
    // the half dot's statement for two people at once (see the stations).
    // It stands in for both their terminal slashes, which there would be two
    // strokes of the printer's end mark crossing one joined pair of rails.
    if (pl.open0 && pa0 <= axisA0 + 1) { halfDiamond(axisA0, pl.c0, pl.c1, 1, pl.id); cut(pl, 0); }
    if (pl.open1 && pa1 >= axisA1 - 1) { halfDiamond(axisA1, pl.c0, pl.c1, -1, pl.id); cut(pl, 1); }
  });

  // ---- stations ---------------------------------------------------------
  //
  // A start is a dot and an end is a tick: two different SHAPES, so they read
  // as two marks even when they nearly touch, and so they survive a panel
  // that dithers -- where a big circle and a small circle are one circle.
  // A state (an all-day event) gets concentric rings instead: nothing
  // happened at this minute, the line simply is this way from here.
  // ON THE RAIL AS DRAWN. A stop is placed at a vertex of its rail's
  // polyline, and the renderer rounds every vertex: the drawn rail cuts the
  // corner and passes a few pixels inside it, so a dot at the start of a
  // step sat beside the bend rather than on it -- "the dot is misplaced on
  // slopes." Where a stop is at a corner it moves to the corner's own
  // midpoint, which is on the curve.
  function onRail(st) {
    var ln = board.lineByKey(st.line);
    if (!ln) return [st.a, st.c];
    var p = ln.pts;
    for (var i = 1; i < p.length - 1; i++) {
      var a = p[i - 1], b = p[i], c = p[i + 1];
      var l1 = Math.hypot(b[0] - a[0], b[1] - a[1]), l2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
      var k = Math.min((b[2] != null ? b[2] : (ln.branchOf ? CORNER * 0.6 : CORNER)), l1 / 2, l2 / 2);
      if (!(k > 0.5) || !l1 || !l2) continue;
      var p0 = [b[0] + (a[0] - b[0]) * k / l1, b[1] + (a[1] - b[1]) * k / l1];
      var p2 = [b[0] + (c[0] - b[0]) * k / l2, b[1] + (c[1] - b[1]) * k / l2];
      // AT THE VERTEX, OR ANYWHERE INSIDE ITS ARC. A stop a few minutes
      // before a rail turns is inside the bend as drawn; tilting its tick
      // to the curve came out at an angle nobody could read, so it goes to
      // the straight the same way a stop on the vertex does.
      var atVertex = Math.abs(b[0] - st.a) < 0.5 && Math.abs(b[1] - st.c) < 0.5;
      var lo = Math.min(p0[0], p2[0]), hi = Math.max(p0[0], p2[0]);
      var inArc = !atVertex && st.a > lo + 0.01 && st.a < hi - 0.01
        && Math.abs((ln.cAt(st.a) == null ? 1e9 : ln.cAt(st.a)) - st.c) < 1;
      if (!atVertex && !inArc) continue;
      // ON THE STRAIGHT, NOT IN THE BEND: where the arc begins for a start
      // and where it ends for an end, so the dot sits on the flat run the
      // rail is leaving and the tick on the one it has reached. Whichever
      // leg is level, if only one is -- a tick on an upright leg is a mark
      // drawn along its own rail.
      var flat0 = Math.abs(a[1] - b[1]) < 0.5, flat2 = Math.abs(c[1] - b[1]) < 0.5;
      if (st.kind === 'end') return flat2 || !flat0 ? p2 : p0;
      return flat0 || !flat2 ? p0 : p2;
    }
    return [st.a, st.c];
  }
  board.stops.forEach(function (st) {
    // The ring of a tie already marks this minute on this line: no dot in it.
    if (st.kind === 'start' && (tiedAt[st.line] || []).some(function (a) {
      return Math.abs(a - st.a) < 1;
    })) return;
    var on = onRail(st);
    st = { line: st.line, a: on[0], c: on[1], kind: st.kind, todo: st.todo };
    var p = xy(st.a, st.c);
    // A spur is a lesser rail and wears lesser marks, which is also what
    // lets it leave its group at 45 degrees with the tick clear of the box.
    // (a shared event's hollow branch is as wide as its bar, and its stops are
    // sized to it)
    var stLine = board.lineByKey(st.line), mk = stLine && stLine.branchOf ? (stLine.ink ? 1.25 : 0.75) : 1;
    if (st.kind === 'state') {
      [NODE_R * 0.85, NODE_R * 0.4].forEach(function (r) {
        var ring = svgEl(doc, 'circle', { cx: p[0], cy: p[1], r: r,
          'stroke-width': NODE_STROKE * 0.5 });
        ring.style.fill = 'none'; ring.style.stroke = inkOf(st.line);
        put(ring, 'state', st.line);
      });
      return;
    }
    // A tie's spur ends the way every rail ends, with a tick: "use a proper
    // terminator for group events." (It wore a small ring for a while.)
    if (st.kind === 'end') {
      // (across a wide rail, long enough to read as a bar and not a box)
      var half = Math.max(NODE_R * 1.05 * mk, railStroke(stLine, st.line).width * 1.25);
      var t0 = xy(st.a, st.c - half), t1 = xy(st.a, st.c + half);
      // ACROSS THE RAIL IT ENDS, which for a moment's upright stub is along
      // the axis: a tick laid along its own rail reads as more rail.
      var lp = stLine && stLine.pts.length > 1 ? stLine.pts : null;
      if (lp) {
        var e1 = lp[lp.length - 1], ei = lp.length - 2;
        while (ei > 0 && Math.abs(lp[ei][0] - e1[0]) < 0.5 && Math.abs(lp[ei][1] - e1[1]) < 0.5) ei--;
        var e0 = lp[ei];
        if (Math.abs(e1[0] - st.a) < 1 && Math.abs(e1[1] - st.c) < 1
            && Math.abs(e1[0] - e0[0]) < 0.5 && Math.abs(e1[1] - e0[1]) > 0.5) {
          t0 = xy(st.a - half, st.c); t1 = xy(st.a + half, st.c);
        }
      }
      // AT THE RAIL'S OWN WEIGHT, square-ended: at the ring's stroke with
      // round caps it read as a weight hung on the line rather than a mark
      // across it (a Beck tick).
      markLine(t0, t1, stLine, st.line, 'stop');
      return;
    }
    // ALREADY RUNNING WHEN THE BOARD OPENED: THE SAME DOT, CUT IN HALF.
    //
    // A window that opens at noon opens in the middle of a school day, and
    // the first thing the reader needs to know about that rail is that it did
    // not start here. A full dot says it did, which is the one lie this map
    // must not tell; nothing at all says the rail simply exists, and drops
    // the question.
    //
    // So: the dot, with its leading half off the paper. No new vocabulary
    // (rule 28) -- it is the start mark, and the board is showing as much of
    // it as it has -- and it reads instantly, because a shape cut by an edge
    // is the oldest way a map says "this continues".
    //
    // Built from the axis direction rather than from x, so it comes out the
    // right way round on a board drawn standing up.
    var r = NODE_R * 0.62 * mk;
    if (st.kind === 'from') {
      // THE HALF DOT IS THE HEAD. Where the event runs on the trunk from
      // the first minute of the paper, the terminal slash would be drawn
      // through the same point, and the two came out as one scribble at the
      // start of the line. The half dot already says the line is here and
      // was before: the slash gives way to it.
      var own = board.lineByKey(st.line);
      if (own && !own.branchOf && own.pts.length && Math.abs(st.a - own.pts[0][0]) < NODE_R
          && Math.abs(st.c - own.pts[0][1]) < 1) {
        (uncapped[st.line] = uncapped[st.line] || [])[0] = true;
      }
      // A SHELF ALREADY OUT WHEN THE BOARD OPENED is tied to its rail by a
      // dotted drop at the edge: "you can't see these are related".
      var parent = own && own.branchOf ? board.lineByKey(own.branchOf) : null;
      var pc = parent ? parent.cAt(st.a) : null;
      if (pc != null && Math.abs(pc - st.c) > NODE_R * 1.2 + r * 2) {
        var from = pc + (st.c > pc ? 1 : -1) * NODE_R * 1.2, to = st.c - (st.c > pc ? 1 : -1) * r;
        var d0 = xy(st.a, from), d1 = xy(st.a, to);
        var drop = svgEl(doc, 'path', { d: 'M ' + d0[0] + ' ' + d0[1] + ' L ' + d1[0] + ' ' + d1[1],
          'stroke-width': NODE_STROKE * 0.8, 'stroke-dasharray': '0.1 ' + (5 * S), 'stroke-linecap': 'round', fill: 'none' });
        drop.style.stroke = inkOf(st.line);
        put(drop, 'edge-drop', st.line);
      }
      var q = xy(st.a + 1, st.c);
      var dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      var nx = -dy * r, ny = dx * r;
      var arc = svgEl(doc, 'path', {
        d: 'M ' + (p[0] + nx) + ' ' + (p[1] + ny)
          + ' A ' + r + ' ' + r + ' 0 0 1 ' + (p[0] - nx) + ' ' + (p[1] - ny) + ' Z',
        'stroke-width': NODE_STROKE * 0.8, 'stroke-linejoin': 'round' });
      arc.style.stroke = inkOf(st.line); arc.style.fill = PAPER;
      put(arc, 'stop-from', st.line);
      return;
    }
    // A TASK IS A SQUARE: "use a square for todos". A dot says something
    // happens here; a square says something is to be done by now.
    var dot = st.todo
      ? svgEl(doc, 'rect', { x: p[0] - r * 0.9, y: p[1] - r * 0.9, width: r * 1.8, height: r * 1.8,
          'stroke-width': NODE_STROKE * 0.8 })
      : svgEl(doc, 'circle', { cx: p[0], cy: p[1], r: r, 'stroke-width': NODE_STROKE * 0.8 });
    dot.style.stroke = inkOf(st.line); dot.style.fill = PAPER;
    put(dot, 'stop-start', st.line);
  });

  // THE MERGE DIAMOND OVER THE MARKS: a spur leaving a group just after it
  // formed put its dot on the diamond, and the dot was drawn on top -- "the
  // diamond should be drawn over the dot". Moved to the end of what is drawn
  // so far, which in SVG is on top.
  Array.prototype.slice.call(svg.querySelectorAll('[data-metro-role="merge"], [data-metro-role="merge-from"]'))
    .forEach(function (n) { svg.appendChild(n); });

  // ---- terminals ---------------------------------------------------------
  //
  // A 45 degree slash is the printer's mark for the end of a run, and on this
  // board it is unmistakable because nothing else is drawn at 45: the rails
  // are flat, the drops are square, the words lie down. A tick would not do,
  // because a tick is already an event ending; a dot would not, because a dot
  // is already an event starting. Three different statements need three
  // different glyphs.
  //
  // Butt caps: a round one puts half a stroke past each end and turns a crisp
  // tick into a lozenge.
  // A LINE THAT IS NOT FINISHED AT AN EDGE: something of this person's that
  // day ends before the board opens, or starts after it closes. Its end is
  // "...", not the slash that says the line stops here: "you need '...'
  // continuation lines meaning lines that are unfinished if the day isn't
  // finished".
  var unfinished = {};
  if (spec.metro) {
    var lo0 = spec.metro.day_start_min, hi0 = spec.metro.day_end_min;
    var dayLo = Math.floor(lo0 / 1440) * 1440, dayHi = Math.ceil(hi0 / 1440) * 1440;
    (spec.metro.events || []).forEach(function (ev) {
      if (ev.type && ev.type !== 'event') return;
      var who = [ev.owner].concat(ev.co_owners || []);
      var e = ev.end_min != null ? ev.end_min : ev.start_min;
      who.forEach(function (k) {
        if (!k) return;
        var u = unfinished[k] = unfinished[k] || [];
        if (e <= lo0 && ev.start_min >= dayLo) u[0] = true;
        if (ev.start_min >= hi0 && ev.start_min < dayHi) u[1] = true;
      });
    });
  }
  var openEnded = {};
  (spec.states || []).forEach(function (st) {
    st.owners.forEach(function (k) {
      var o = openEnded[k] = openEnded[k] || [false, false], e = st.ends || [true, true];
      if (st.timed) return;
      o[0] = o[0] || e[0]; o[1] = o[1] || e[1];
    });
    // ONE HOLIDAY, NOT THREE (rule 56): named at the first head, with a
    // dashed out-of-station tie down to the others.
    var lead = !st.ends || st.ends[0];
    var at = lead ? spec.axis.a0 - NODE_R : spec.axis.a1 + NODE_R;
    var cs = st.owners.map(function (k) {
      var l = board.lineByKey(k);
      return l && l.pts.length ? l.pts[lead ? 0 : l.pts.length - 1][1] : null;
    }).filter(function (c) { return c != null; });
    if (cs.length < 2) return;
    var o0 = xy(at, Math.min.apply(null, cs)), o1 = xy(at, Math.max.apply(null, cs));
    var tie = svgEl(doc, 'path', { d: 'M ' + o0[0] + ' ' + o0[1] + ' L ' + o1[0] + ' ' + o1[1],
      fill: 'none', 'stroke-width': 1.5 * S, 'stroke-dasharray': (3 * S) + ' ' + (4 * S),
      'stroke-linecap': 'butt' });
    tie.style.stroke = INK;
    put(tie, 'origin-tie', st.owners[0]);
  });
  board.lines.forEach(function (ln) {
    if (ln.branchOf || ln.pts.length < 2) return;
    var r = 4 * S, w = Math.max(2 * S, (ln.width || 3) * S);
    [ln.pts[0], ln.pts[ln.pts.length - 1]].forEach(function (p, end) {
      // THE EDGE RING IS THIS END'S MARK, AND THE ONLY ONE. A shared event
      // already running when the board opened puts a ring on the rail's first
      // point with the line's own initial in it, and the three dots beside it
      // say what came before. A slash or an arrow as well is a second mark for
      // one end and it lands inside the ring: Leela's rail drew its open arrow
      // straight through her own initial. "Arrow for Leela needs to go, just
      // her first letter(s)."
      if (!end && edgeDots[ln.key]) return;
      var open = !!(openEnded[ln.key] || [])[end];
      // (a half mark at the edge stands in for the slash, but not for the dots:
      // "..." still says there was more before it)
      if ((uncapped[ln.key] || [])[end] && !open && !(unfinished[ln.key] || [])[end]) return;
      if ((unfinished[ln.key] || [])[end] && !open) {
        // THE DAY GOES ON PAST THE PAPER: "..." where the slash would be.
        var dir = end ? 1 : -1, gapD = Math.max(RAIL_W * 1.3, 2.6 * S), dr = Math.max(1.2 * S, RAIL_W * 0.42);
        for (var di2 = 1; di2 <= 3; di2++) {
          var q = xy(p[0] + dir * gapD * di2, p[1]);
          var dot = svgEl(doc, 'circle', { cx: q[0], cy: q[1], r: dr, stroke: 'none' });
          dot.style.fill = inkOf(ln.key);
          put(dot, 'terminal-more', ln.key);
        }
        return;
      }
      if (open) {
        // AN OPEN CHEVRON WHERE THE DAY IS A SLICE OF SOMETHING LONGER
        // (rule 55). A slash says the line stops here, and half term did not
        // begin at the first hour on the scale. Made of the same two 45s as
        // the slash, opening outward, away from the day.
        // The point is the rail's own end, so the rail runs into it.
        // THE TIP STANDS OUT AS FAR AS A SLASH DOES: drawn with its point on
        // the rail's own last minute, an arrow-ended line began a slash's
        // width inside every other line on the board -- "it should start a
        // bit more on the left, like the other tracks".
        // SOLID, so nothing shows through it. Drawn as a stroked V, the
        // rail's paper core ran on into the arrow -- "the track peeks a pixel
        // or 2 through the arrow" -- and trimming the core back instead left
        // the last stretch of rail as a black block behind the head. A filled
        // head covers whatever the rail leaves under it, and its base sits on
        // the rail's own last point with the tip standing out about as far as
        // a terminal slash reaches, so an arrow-ended line starts where its
        // neighbours do.
        var dir = end ? 1 : -1, cvo = chevron(), r2 = cvo.back, ahead = p[0] + dir * cvo.out;
        var base = ahead - dir * r2;
        var t0 = xy(base, p[1] - r2), tip = xy(ahead, p[1]), t1 = xy(base, p[1] + r2);
        var ch = svgEl(doc, 'path', { d: 'M ' + t0[0] + ' ' + t0[1] + ' L ' + tip[0] + ' ' + tip[1]
          + ' L ' + t1[0] + ' ' + t1[1] + ' Z', stroke: 'none' });
        ch.style.fill = inkOf(ln.key);
        put(ch, 'terminal-open', ln.key);
        return;
      }
      // A SLASH AT BOTH ENDS: "where is the beginning start mark". Where the
      // line has something before the board opens, the "..." above says so
      // instead. In the rail's own style, a little longer on a wide rail so
      // the slash is not a block.
      // (lighter than the rail, now every rail is as heavy as a textured one,
      // or a short heavy slash reads as a diamond; no longer, or it reaches
      // the line's name)
      // (heavy enough to cover the square end of the rail it stands on: a
      // butt end's corners sit 0.35 of its width off the slash's middle)
      var sw = railStroke(ln, ln.key).width, rr = Math.max(r, sw * 0.9);
      markLine(xy(p[0] - rr, p[1] + rr), xy(p[0] + rr, p[1] - rr), ln, ln.key, 'terminal', false, sw * 0.8);
    });
  });

  // where now is, for the clock on the strip
  var nowFx = null;
  (board.fixed || []).forEach(function (fx) { if (fx.kind === 'now') nowFx = fx; });

  // ---- the strip and the rest of the board's own words -------------------
  //
  // HTML, not SVG text, for the same reason the captions are: these sit on
  // the map and they wear the paper outline that lets them. They are also the
  // framework's own type -- `label--small text--bold` and the utilities beside
  // it -- so the panel decides the size rather than this file.
  var rowH = ctx.rowH || 12;
  var alongPx = horizontal ? W : H;
  // THE QUIET GREY, FOR A WORD THAT ALSO WEARS AN OUTLINE. The framework's
  // grey on a 1-bit panel is a dither pattern clipped to the glyphs, and its
  // `text-stroke` is a stack of shadows that paints over exactly that: on
  // paper or on the light panel a count came out as a white smudge. So there it
  // is ink, which is what a 1-bit panel made of the old grey anyway; on two
  // bits and up the grey is a solid colour and keeps its outline.
  var QUIET = ' text--muted 1bit:text--default';

  function html(cls, text) {
    var n = doc.createElement('span');
    n.className = 'metro-gen ' + cls + ' absolute';
    if (text != null) n.textContent = text;
    canvas.appendChild(n);
    return n;
  }
  // Placed by its own measured box, centred across the strip and aligned
  // along it. Never off the leading edge: a note standing up is as long as
  // its words while the strip is only as wide as an hour, and the clock used
  // to hang off the side of the board.
  // STANDING UP, WORDS ON THE MAP RUN DOWN IT, as the captions do (see the
  // words, below): the solver books every name, note and marker by its length
  // along the axis, and written level each was as wide as its words across.
  // The strip's own ruler -- hours, the clock, the date -- stays level.
  function turn(n) { if (!horizontal) n.style.writingMode = 'vertical-lr'; return n; }
  function place(n, a, c, align) {
    var len = horizontal ? n.offsetWidth : n.offsetHeight;
    var thick = horizontal ? n.offsetHeight : n.offsetWidth;
    var start = align === 'right' ? a - len : align === 'centre' ? a - len / 2 : a;
    start = Math.max(0, Math.min(start, alongPx - len));
    var top = Math.max(0, c - thick / 2);
    var p = xy(start, top);
    n.style.left = p[0] + 'px'; n.style.top = p[1] + 'px';
    return [start - 2 * S, start + len + 2 * S, top, top + thick];
  }
  // WHAT THE STRIP HAS ALREADY SAID. The hours give way to everything else on
  // it, because a clock badge or a date is a statement and an hour tick is a
  // ruler mark: "00:0002:0004:00" run together is what happens when they do
  // not.
  //
  // IN BOTH DIRECTIONS. Judged along the axis alone, the date badge in the
  // row above the hours took eight o'clock with it and the forecast took the
  // whole evening: "time line missing a lot of hours towards the edges for
  // no reason." A claim is a box, and two boxes in different rows of the
  // strip do not collide.
  var taken = [];
  function free(r) {
    return !taken.some(function (t) {
      if (!(r[0] < t[1] && t[0] < r[1])) return false;
      if (r.length > 3 && t.length > 3 && !(r[2] < t[3] && t[2] < r[3])) return false;
      return true;
    });
  }

  var hoursFx = null, notes = [], dayBadges = [];
  // THE STRIP'S WORDS A SIZE UP ON A FULL VIEW, with the titles: "header bar
  // could also increase in font size in that case". A slot and a standing
  // board keep the small size their column and rows are measured for.
  var STRIP_SM = !spec.oneName && horizontal ? '' : ' label--small';
  // THE MOON HAS THE FAR RIGHT OF A DAY'S HEADER: "moon phase far right in the
  // header please". Its size, where the day has one and the header has the
  // title band to hold it; the forecast stands this much further in.
  function titleBand() {
    var above = hoursFx ? hoursFx.c1 - rowH - 8 : 0;
    return horizontal && above >= rowH * 1.6 ? above : 0;
  }
  function moonSize(dix) {
    var dd = ((spec.metro && spec.metro.days) || [])[dix], band = titleBand();
    if (spec.oneName || !band || !dd || !dd.moon) return 0;
    return Math.round(Math.min(band - 6 * S, rowH * 1.5));
  }
  function moonRoom(dix) { var z = moonSize(dix); return z ? z + 12 * S : 0; }
  (board.fixed || []).forEach(function (fx) { if (fx.kind === 'hours') hoursFx = fx; });

  // WHOSE NAMES ARE MISSING, PER LINE. Read off the board rather than told:
  // what was wanted is in the spec, what was placed is in `caps`, and the
  // difference is exactly what the reader is not being shown.
  var shedBy = {}, drawnCap = {};
  board.caps.forEach(function (cp) { drawnCap[cp.id] = 1; });
  (spec.wants || []).forEach(function (w) {
    if (drawnCap[w.id] || w.pill || !w.line) return;
    shedBy[w.line] = (shedBy[w.line] || 0) + 1;
  });

  (board.fixed || []).forEach(function (fx) {
    var c = (fx.c0 + fx.c1) / 2;
    if (fx.kind === 'date') {
      // THE DATE AS A SOLID-INK PILL. On e-ink this is the highest-contrast
      // mark available, and it gives the strip one fixed anchor that reads
      // from across a room instead of as another grey annotation.
      //
      // THE BADGE IS THE DAY MARKER, and a holiday rides on it (rules 59-64):
      // the date, then what the day is, then which day of a range. It gives
      // way in that order, from the back: the ordinal, then the name, never
      // the date. A day the board crossed into wears `metro-daybreak`.
      var dayIx = fx.id === 'date' ? 0 : parseInt(String(fx.id).slice(4), 10) || 0;
      // The rows above the hours, where a big panel has two of them.
      var above = hoursFx ? hoursFx.c1 - rowH - 8 : 0;
      var titleRoom = horizontal && above >= rowH * 1.6 ? above : 0;
      var hol = null;
      ((spec.metro && spec.metro.holidays) || []).forEach(function (hd) {
        if (!hol && (hd.day || 0) === dayIx) hol = hd;
      });
      // No badge longer than a third of the scale, or past the midnight
      // that ends its day.
      // (a little more of it where the strip's words are a size up)
      var room = (spec.axis.a1 - spec.axis.a0) / (STRIP_SM ? 3 : 2.4);
      var dd = ((spec.metro && spec.metro.days) || [])[dayIx];
      if (dd && spec.scale) room = Math.min(room, spec.scale.at(Math.min(dd.end_min, spec.metro.day_end_min)) - fx.a0);
      var forms0 = hol ? (hol.day_label ? [2, 1, 0] : [1, 0]) : [0];
      // THE TITLE GIVES WAY FIRST: "Today" is the one part of the badge the
      // strip already says elsewhere (the clock is on it), so a squeezed badge
      // loses the word before it loses which day of a holiday this is.
      var wantTitle = titleRoom && spec.metro && spec.metro.now_min != null && dayIx <= 1;
      var forms = [], titled = [];
      forms0.forEach(function (fm) {
        if (wantTitle) { forms.push(fm); titled.push(true); }
        forms.push(fm); titled.push(false);
      });
      var badge = null;
      for (var fi = 0; fi < forms.length; fi++) {
        if (badge) badge.remove();
        badge = html('metro-daybadge' + (dayIx > 0 ? ' metro-daybreak' : '')
          + ' flex flex--row flex--center-y gap--xsmall');
        // "TODAY", LARGE, where the strip has the rows for it: the one word a
        // reader across the room wants before the date. Only on the board's
        // own day, and only when that day is today (it has a clock).
        // ...AND "TOMORROW" on the day a rolling board reaches into, which is
        // the question a board read at nine at night is being asked.
        if (titled[fi]) {
          var tt = doc.createElement('span');
          // a word's space from the date: "Today and the date too pushed together"
          tt.className = 'metro-today title text--bold mr--3';
          var i18n2 = spec.metro.i18n || {};
          tt.textContent = dayIx ? (i18n2.tomorrow || 'Tomorrow') : (i18n2.today || 'Today');
          badge.appendChild(tt);
        }
        var d = doc.createElement('span');
        d.className = 'metro-axis-note metro-date metro-pill label' + STRIP_SM + ' text--bold';
        d.textContent = fx.text;
        badge.appendChild(d);
        if (forms[fi] > 0) {
          var hb = doc.createElement('span');
          hb.className = 'metro-holiday flex flex--row flex--center-y gap--xsmall';
          var ring = svgEl(doc, 'svg', { width: 12, height: 12, viewBox: '0 0 12 12',
            'class': 'metro-holiday-ring no-shrink' });
          [5, 2.5].forEach(function (rr) {
            ring.appendChild(svgEl(doc, 'circle', { cx: 6, cy: 6, r: rr, fill: 'none',
              stroke: 'currentColor', 'stroke-width': 1.5 }));
          });
          hb.appendChild(ring);
          var hn = doc.createElement('span');
          hn.className = 'metro-holiday-name label' + STRIP_SM + ' text--bold';
          hn.textContent = hol.title;
          hb.appendChild(hn);
          if (forms[fi] > 1) {
            var ho = doc.createElement('span');
            ho.className = 'metro-holiday-day label' + STRIP_SM;
            ho.textContent = '\u00b7 ' + hol.day_label;
            hb.appendChild(ho);
          }
          badge.appendChild(hb);
        }
        // Standing up, as wide as the column: the short weekday where the
        // date will not fit across it.
        if (!horizontal && hoursFx && badge.offsetWidth > hoursFx.c1) {
          // A holiday rides with the date (rule 64): where the badge gives
          // way to a bare weekday, its words go too, and the next, plainer
          // form is tried.
          if (fi < forms.length - 1) continue;
          var dd2 = ((spec.metro && spec.metro.days) || [])[dayIx];
          var shortD = (dd2 && dd2.weekday_short) || String(fx.text).split(/[\s,]+/)[0];
          if (shortD) d.textContent = shortD;
        }
        var blen = horizontal ? badge.offsetWidth : badge.offsetHeight;
        if (blen <= room || fi === forms.length - 1) break;
      }
      // ON A BOARD OF DAYS, THE TOP ROW OF THE BAND: the forecast has the row
      // under it, and a badge centred on both left a strip of empty ink over
      // it and no room for the forecast of a short day beside it.
      var multiDay = ((spec.metro && spec.metro.days) || []).length > 1;
      var badgeC = titleRoom ? titleRoom / 2 + 2 : c;
      if (titleRoom && multiDay) badgeC = Math.max(badge.offsetHeight / 2 + 4 * S, (titleRoom - rowH - 4) / 2 + 2);
      var br = place(badge, fx.a0 + (dayIx ? 10 * S : 0), badgeC, "left");
      taken.push(br);
      dayBadges[dayIx] = { r: br, band: titleRoom };
      return;
    }
    if (fx.kind === 'weather') {
      // A FACT ABOUT A DAY, AT THAT DAY'S OWN END OF THE SCALE, with the
      // condition's icon beside the numbers: the glyph is read before the
      // digits are, and it costs nothing but the row it is already in.
      var box = doc.createElement('div');
      box.className = 'metro-gen metro-sky metro-wx flex flex--row flex--center-y gap--xsmall absolute text-stroke';
      var wx = null, di = parseInt(String(fx.id).slice(2), 10);
      var days = (spec.metro && spec.metro.days) || [];
      wx = (days[di] && days[di].weather) || (spec.metro && spec.metro.header_weather);
      var ic = null;
      if (wx && wx.icon) {
        ic = doc.createElement('img');
        ic.className = 'image--adaptive';
        ic.src = wx.icon;
        // Sized off the row it is in, not off the page: the strip is one row
        // deep and an icon taller than it pushes the map down.
        ic.style.width = rowH + 'px'; ic.style.height = rowH + 'px';
        // Armed by hand: the framework only masks the adaptive icons it finds
        // at load, and this one is built long afterwards.
        ic.style.setProperty('--framework-icon-src', 'url("' + wx.icon + '")');
        ic.setAttribute('data-adaptive', 'true');
        box.appendChild(ic);
      }
      // Inside its own day, and clear of what the strip already says there.
      var wxDay = days[di], wxFrom = 0;
      if (wxDay && spec.scale && wxDay.start_min > spec.metro.day_start_min) wxFrom = spec.scale.at(wxDay.start_min);
      var fitsDay = function (r) { return r[0] >= wxFrom && free(r); };
      // A stroke's width short of its day's end, so its claim does not touch
      // the next day's title standing on the midnight.
      var wxEnd = fx.a1 - 4 * S - moonRoom(di);
      var richRoom = horizontal && (fx.c1 - fx.c0) >= rowH * 1.6 && wx && wx.hi != null;
      var underDate = null;
      if (richRoom) {
        // TWO ROWS OF IT ON A BIG PANEL: the icon as tall as both, the high
        // large, and beside it the low over what the sky is doing.
        var side = Math.round(fx.c1 - fx.c0 - 2);
        if (ic) { ic.style.width = side + 'px'; ic.style.height = side + 'px'; }
        box.className = box.className.replace('gap--xsmall', 'gap--small');
        var hi = doc.createElement('span');
        hi.className = 'metro-wx-hi value value--small text--bold';
        hi.textContent = Math.round(wx.hi) + '\u00b0';
        box.appendChild(hi);
        // ONE BLOCK, READ FROM ITS LEFT EDGE: the low and the sky under it
        // start where the high ends, rather than each centred on the other
        // ("the header lacks structure": 57° floated over "Partly cloudy").
        var col = doc.createElement('div');
        col.className = 'flex flex--col flex--left gap--none';
        col.style.lineHeight = '1.15';
        var lo = doc.createElement('span');
        lo.className = 'metro-hour label' + STRIP_SM + ' text--bold text-stroke' + QUIET;
        lo.textContent = Math.round(wx.lo) + '\u00b0';
        lo.style.lineHeight = '1.15';
        col.appendChild(lo);
        var sky2 = doc.createElement('span');
        sky2.className = 'metro-hour label' + STRIP_SM + ' text-stroke';
        // The condition already names the rain, so the chance is a number.
        var rain = wx.rain_chance >= 30 ? wx.rain_chance + '%' : null;
        sky2.textContent = [wx.condition, rain].filter(Boolean).join(' \u00b7 ');
        sky2.style.lineHeight = '1.15';
        col.appendChild(sky2);
        box.appendChild(col);
        canvas.appendChild(box);
        var rr = place(box, wxEnd, (fx.c0 + fx.c1) / 2, 'right');
        if (fitsDay(rr)) { taken.push(rr); return; }
        // A SHORT DAY HAS NO ROOM FOR IT: at a quarter past ten tonight's
        // panel is two hours wide and the big forecast was written over
        // "Vandaag" and the date. The one-line forecast is tried instead,
        // and then nothing.
        box.remove();
        box = doc.createElement('div');
        box.className = 'metro-gen metro-sky metro-wx flex flex--row flex--center-y gap--xsmall absolute text-stroke';
        if (ic) { ic.style.width = rowH + 'px'; ic.style.height = rowH + 'px'; box.appendChild(ic); }
        c = fx.c1 - rowH / 2;
        // Under the date, starting where the date starts, so the short panel
        // reads as one block rather than a forecast floating off to the right.
        underDate = dayBadges[di] && dayBadges[di].r;
        // under it, not into it, where the badge sits in the band's top row
        if (underDate) c = Math.max(c, underDate[3] + rowH / 2 + 2 * S);
      }
      var tx = doc.createElement('span');
      tx.className = 'metro-hour label' + STRIP_SM + ' text--bold text-stroke';
      tx.textContent = fx.text;
      box.appendChild(tx);
      canvas.appendChild(box);
      // Standing up the forecast is a sentence at the column's far end, and
      // level it ran across the last line's name.
      turn(box);
      var rc = underDate ? place(box, underDate[0], c, 'left') : place(box, wxEnd, c, 'right');
      if (underDate && !(rc[1] <= wxEnd && fitsDay(rc))) rc = place(box, wxEnd, c, 'right');
      // A day too short for it at its end has it under its date, where that
      // leaves the row free.
      if (!fitsDay(rc) && !underDate && horizontal && dayBadges[di] && dayBadges[di].band) {
        var ub = place(box, dayBadges[di].r[0], Math.max(c, dayBadges[di].r[3] + rowH / 2 + 2 * S), 'left');
        if (ub[1] <= wxEnd && fitsDay(ub)) rc = ub; else rc = place(box, wxEnd, c, 'right');
      }
      if (fitsDay(rc)) taken.push(rc); else box.remove();
      return;
    }
    if (fx.kind === 'sky') {
      // A MOMENT THE SKY CHANGES, as its glyph on its minute, under the clock.
      var sky = doc.createElement('div');
      sky.className = 'metro-gen metro-sky flex flex--row flex--center-y gap--xsmall absolute text--black text-stroke';
      var moonM = /^moon:(\d+):([01])$/.exec(fx.icon || '');
      if (moonM) {
        // THE MOON AS A SHAPE, not a fetched glyph (after the night sky
        // plugin): an ink disc, with the lit part in paper -- a terminator
        // ellipse against a half disc on the side the light is on.
        var ms = moonImg(+moonM[1], moonM[2] === '1', rowH);
        sky.appendChild(ms);
      } else if (fx.icon) {
        var si = doc.createElement('img');
        si.className = 'image--adaptive';
        si.src = fx.icon;
        si.style.width = rowH + 'px'; si.style.height = rowH + 'px';
        si.style.setProperty('--framework-icon-src', 'url("' + fx.icon + '")');
        si.setAttribute('data-adaptive', 'true');
        sky.appendChild(si);
      }
      // The words stay on the element for anyone reading the page, not on
      // the board: the glyph is the marker.
      sky.setAttribute('title', fx.text || '');
      canvas.appendChild(sky);
      turn(sky);
      // From the strip's edge down, not centred on the row: a marker a
      // pixel or two taller than its row reached back up into the strip.
      // And inside its own day: a marker never runs past its midnight.
      var skyLen = horizontal ? sky.offsetWidth : sky.offsetHeight, skyA = fx.a0;
      (spec.cuts || []).forEach(function (cut) {
        if (fx.a0 < cut && skyA + skyLen > cut - 4) skyA = cut - 4 - skyLen;
      });
      place(sky, skyA, fx.c0 + (horizontal ? sky.offsetHeight : sky.offsetWidth) / 2, 'left');
      return;
    }
    if (fx.kind === 'note') { notes.push(fx); return; }
    if (fx.kind === 'bandname') {
      // a size up from the strip's small words on a full view, where it is
      // read from across the room like the rest of the map
      var bn = turn(html('metro-bandname label' + STRIP_SM + ' text--bold text--black', fx.text));
      place(bn, fx.a0, (fx.c0 + fx.c1) / 2, 'left');
      return;
    }
    if (fx.kind === 'terminus') {
      // THE LEGEND IS ON THE LINE. A name at the end of each rail is what a
      // transit map does instead of a key in the corner, and it is one size
      // up from the strip: it says whose day this row is.
      var tn = turn(html('metro-terminus label label--base text--bold text--black text-stroke', fx.text));
      // ...AND HOW MANY OF THIS LINE'S STOPS IT COULD NOT NAME.
      //
      // A shed caption is an honest decision and a silent one: the mark is
      // still drawn, so the reader sees a stop with no name and cannot tell
      // whether the board ran out of room or they misread it. The count
      // belongs beside the LINE rather than in a corner, because it is a
      // fact about that person's day and not about the panel.
      var lost = shedBy[fx.line];
      if (lost) {
        var more = doc.createElement('span');
        more.className = 'metro-capmore' + QUIET;
        // A NON-BREAKING SPACE, because an ordinary one at the start of an
        // inline child is collapsed away and the count read as "Homer+1".
        more.textContent = '\u00a0+' + lost;
        tn.appendChild(more);
        // ...BUT NOT INTO A NAME. The count is drawn after the board was
        // solved and nobody booked paper for it: "Marge +1" standing up ran
        // into "School Run". Where the longer name would reach a caption, the
        // count gives way.
        var extra = horizontal ? more.offsetWidth : more.offsetHeight;
        var ta0 = fx.align === 'right' ? fx.a0 - extra : fx.a0, ta1 = fx.align === 'right' ? fx.a1 : fx.a1 + extra;
        if (board.caps.some(function (cp) {
          var cb = cp.box();
          return cb.a0 < ta1 + 2 && ta0 - 2 < cb.a1 && cb.c0 < fx.c1 + 2 && fx.c0 - 2 < cb.c1;
        })) tn.removeChild(more);
      }
      if (!fx.route) {
        // CLEAR OF AN EDGE RING. Where a shared event that was already
        // running put a ring on this rail's first point, the name set at the
        // rail's own start lands on the ring and on the dots beside it:
        // "label need to offset a bit to the right." It starts after them
        // instead. Only at that end, and only on those lines, so every other
        // name on the board is where the solver put it.
        var tA = fx.align === 'right' ? fx.a1 : fx.a0;
        if (fx.align !== 'right' && edgeShift[fx.line] != null
            && Math.abs(tA - axisA0) < NODE_R * 2) tA = edgeShift[fx.line];
        place(tn, tA, c, fx.align === 'right' ? 'right' : 'left');
        // A NAME AT THE FAR EDGE IS HELD BY THAT EDGE, not by a left offset
        // worked out from its width: the face settles after the board is laid
        // out, a few pixels wider, and "Professor" ran eleven pixels off the
        // paper at the right-hand end.
        if (fx.align === 'right' && horizontal) {
          tn.style.left = 'auto';
          tn.style.right = Math.max(0, W - fx.a1) + 'px';
        }
        return;
      }
      // THE ROUTE ROW under the name: what this line IS today (rule 54),
      // behind rule 28's concentric rings.
      var rt = html('metro-route label label--small text--bold text--black flex flex--row flex--center-y gap--xsmall');
      var rs = svgEl(doc, 'svg', { width: 12, height: 12, viewBox: '0 0 12 12', 'class': 'metro-route-ring no-shrink' });
      [5, 2.5].forEach(function (rr) {
        rs.appendChild(svgEl(doc, 'circle', { cx: 6, cy: 6, r: rr, fill: 'none',
          stroke: 'currentColor', 'stroke-width': 1.5 }));
      });
      rt.appendChild(rs);
      var rw = doc.createElement('span');
      rw.textContent = fx.route;
      rt.appendChild(rw);
      turn(rt);
      var nThick = horizontal ? tn.offsetHeight : tn.offsetWidth;
      var rThick = horizontal ? rt.offsetHeight : rt.offsetWidth;
      // Below its rail it grows down, away from the rail; above, it grows up.
      var own = board.lineByKey(fx.line), railC = own ? own.cAt(fx.at == null ? spec.axis.a1 : fx.at) : null;
      var top0 = railC != null && fx.c0 >= railC ? fx.c0 : Math.min(fx.c0, fx.c1 - nThick - rThick);
      var far = fx.align === 'right';
      // ...AND THE SAME CLEARANCE WHERE THE NAME CARRIES A ROUTE UNDER IT.
      // Leela's name and her "Ship Inspection" stayed hard left while Bender
      // and Fry moved, because a name with a route beneath it is placed here
      // rather than above, and only the other one had been told about the
      // ring. Two names on one board obeying different rules is worse than
      // either rule.
      var rA = far ? fx.a1 : fx.a0;
      if (!far && edgeShift[fx.line] != null
          && Math.abs(rA - axisA0) < NODE_R * 2) rA = edgeShift[fx.line];
      place(tn, rA, top0 + nThick / 2, far ? 'right' : 'left');
      place(rt, rA, top0 + nThick + rThick / 2, far ? 'right' : 'left');
      if (far && horizontal) {
        [tn, rt].forEach(function (n) { n.style.left = 'auto'; n.style.right = Math.max(0, W - fx.a1) + 'px'; });
      }
    }
  });

  // NOW AND NEXT, IN WORDS. "A plain-text two-line summary for whoever is
  // walking past the display in a hurry": what is on now and what comes
  // next, with whose it is, in the title band of today's panel between the
  // date and the forecast. Only on a full view, only where that band is two
  // rows deep, and only in the room the strip has left; a line that does not
  // fit is cut at a word, then the "Now" line goes, then the card.
  // THE MOON IN THE HEADER, at the top right of each day's panel: "moonphase
  // in the top right of the header if there is any space". Left of that
  // day's forecast where it has one; left off where the panel has no room.
  if (!spec.oneName && horizontal && spec.metro) {
    dayBadges.forEach(function (tb, dix) {
      var dd = (spec.metro.days || [])[dix];
      if (!tb || !tb.band || !dd || !dd.moon) return;
      var size = moonSize(dix);
      if (!size) return;
      var to = (dayCuts.length > dix ? dayCuts[dix] : W) - 10 * S;
      if (to - size < tb.r[1] + 12 * S) return;
      var box = doc.createElement('div');
      box.className = 'metro-gen metro-moon flex absolute';
      box.setAttribute('title', 'Moon ' + dd.moon.illumination + '%');
      box.appendChild(moonImg(dd.moon.illumination, dd.moon.waxing, size));
      canvas.appendChild(box);
      var mr2 = place(box, to, tb.band / 2 + 2, 'right');
      if (free(mr2)) taken.push(mr2); else box.remove();
    });
  }
  if (dayBadges[0] && dayBadges[0].band && !spec.oneName && spec.metro && spec.metro.now_min != null && horizontal) {
    // Today's panel first; late in the day, when today is a sliver, the wide
    // panel of tomorrow beside it.
    for (var nb = 0; nb < Math.min(2, dayBadges.length); nb++) {
      if (dayBadges[nb] && dayBadges[nb].band && nowNext(dayBadges[nb], nb)) break;
    }
  }
  // ...AND ON A BOARD OF DAYS, WHERE THE FORECAST TOOK THE ROW UNDER THE
  // DATE, ONE LINE OF IT BESIDE THE DATE.
  if (dayBadges[0] && dayBadges[0].band && !spec.oneName && spec.metro && spec.metro.now_min != null && horizontal
      && !canvas.querySelector('.metro-nownext') && ((spec.metro.days || []).length > 1)) {
    for (var nb2 = 0; nb2 < Math.min(2, dayBadges.length); nb2++) {
      if (dayBadges[nb2] && dayBadges[nb2].band && nowNext(dayBadges[nb2], nb2, true)) break;
    }
  }
  function nowNext(tb, dayIx, oneRow) {
    var m = spec.metro, now = m.now_min, i18n = m.i18n || {};
    var names = {};
    (m.legend || []).forEach(function (p) { names[p.key] = p.name || p.key; });
    var evs = (m.events || []).filter(function (ev) { return (!ev.type || ev.type === 'event') && ev.start_min != null; });
    function who(ev) {
      var ks = [ev.owner].concat(ev.co_owners || []).filter(Boolean);
      return ks.map(function (k) { return names[k] || k; }).join(', ');
    }
    var on = evs.filter(function (ev) { return ev.start_min <= now && (ev.end_min || ev.start_min) > now; })
      .sort(function (p, q) { return (p.end_min - p.start_min) - (q.end_min - q.start_min); });
    var later = evs.filter(function (ev) { return ev.start_min > now && ev.start_min < m.day_end_min; })
      .sort(function (p, q) { return p.start_min - q.start_min; });
    var rows = [];
    if (on.length) rows.push([i18n.now || 'Now', on[0].title + ' \u00b7 ' + who(on[0])]);
    if (later.length) {
      var nx = later[0];
      rows.push([i18n.next || 'Next', nx.title + ' ' + (ctx.clock ? ctx.clock(nx.start_min) : '') + ' \u00b7 ' + who(nx)]);
    }
    if (!rows.length) return true;
    // Between the date and whatever the strip set next to it in that panel.
    // (a later day's badge is moved in off its midnight when it joins its panel)
    var from = tb.r[1] + (dayIx ? 22 : 12) * S, to = (dayCuts.length > dayIx ? dayCuts[dayIx] : (horizontal ? W : H)) - 10 * S;
    // In one row, only what stands in that row is in the way, and the card is
    // as deep as the badge.
    var bandH = oneRow ? tb.r[3] - tb.r[2] + 2 : tb.band;
    taken.forEach(function (t) {
      if (t === tb.r || t.length < 4 || t[2] >= tb.band) return;
      if (oneRow && (t[2] >= tb.r[3] || t[3] <= tb.r[2])) return;
      if (t[0] >= tb.r[1] && t[0] - 12 * S < to) to = t[0] - 12 * S;
    });
    if (to - from < 80 * S) return false;
    if (oneRow && rows.length > 1) rows.shift();
    // The base size first, where the band takes two rows of it; small after.
    // "Now and next are hard to read": thin white letters on the black band
    // broke up on the panel. The large size first where the band holds two
    // rows of it, and every size bold.
    var sizes = ['label label--large', 'label', 'label label--small'], card = null, spans = null;
    for (var zi = 0; zi < sizes.length; zi++) {
      if (card) card.remove();
      card = doc.createElement('div');
      card.className = 'metro-gen metro-nownext flex flex--col flex--left absolute';
      canvas.appendChild(card);
      spans = rows.map(function (rw) {
        var line = doc.createElement('span');
        line.className = sizes[zi];
        // two rows of the large size fit the band only set close
        line.style.lineHeight = '1.1';
        var lead = doc.createElement('span');
        // the word in grey, "for now and next, put the label in gray", so
        // what is on reads first
        lead.className = 'text--bold text--muted';
        // non-breaking, or the gap after the word collapses away
        lead.textContent = rw[0] + '\u00a0\u00a0';
        var body = doc.createElement('span');
        body.className = 'text--bold';
        body.textContent = rw[1];
        line.appendChild(lead); line.appendChild(body);
        card.appendChild(line);
        return { line: line, lead: lead, body: body, text: rw[1] };
      });
      // THE WORDS IN ONE COLUMN: "Now" and "Next" are not the same width, so
      // each line's event started at its own x. The words take the width of
      // the widest of them.
      var leadW = 0;
      spans.forEach(function (sp) { leadW = Math.max(leadW, sp.lead.offsetWidth); });
      spans.forEach(function (sp) { sp.lead.style.display = 'inline-block'; sp.lead.style.minWidth = leadW + 'px'; });
      spans.forEach(cut);
      if (card.offsetHeight <= bandH - 2 && spans.every(function (sp) { return sp.line.offsetWidth <= to - from; })) break;
      if (zi === sizes.length - 1) {
        // Two rows where the band is deep enough, else only what is next.
        while (spans.length > 1 && card.offsetHeight > bandH - 2) { spans[0].line.remove(); spans.shift(); }
      }
    }
    function cut(sp) {
      var words = sp.text.split(' ');
      while (sp.line.offsetWidth > to - from && words.length > 1) {
        words.pop();
        sp.body.textContent = words.join(' ').replace(/[\s\u00b7,]+$/, '') + '\u2026';
      }
    }
    if (spans.some(function (sp) { return sp.line.offsetWidth > to - from; }) || card.offsetHeight > bandH - 2) { card.remove(); return false; }
    var r = place(card, from, oneRow ? (tb.r[2] + tb.r[3]) / 2 : tb.band / 2 + 2, 'left');
    if (free(r)) { taken.push(r); return true; }
    card.remove();
    return false;
  }

  // THE CLOCK, AS A BADGE ON THE SCALE. A solid-ink pill, so "now" is the one
  // time on the strip that is stated rather than annotated. Asked after the
  // date, which wants the same corner on a board read early in its own
  // window: the hour ticks already say what time it is to within the step,
  // and a refresh moves the clock clear by itself, whereas nothing else
  // anywhere says which day this is.
  if (nowFx && hoursFx && ctx.clock && spec.metro && spec.metro.now_min != null) {
    var pill = html('metro-axis-note metro-pill label' + STRIP_SM + ' text--bold',
                    ctx.clock(spec.metro.now_min));
    // Standing up, in the column's width: the hours either side already say
    // which half of the day it is.
    if (!horizontal && pill.offsetWidth > hoursFx.c1) pill.textContent = pill.textContent.replace(/\s*(am|pm)$/i, '');
    // Against the map's edge of the strip: level on a board standing up, the
    // pill is as thick as its words, and centred on a row it reached into
    // the map.
    // As deep as the pill itself where that is more than a row, or its edge
    // stands out of the strip: "now time clips outside the header box".
    // ...and no higher than that: "3:47pm" sat above "3pm" and "5pm" either
    // side of it. On the hours' own line where it fits, raised only as far
    // as keeps its edge a pixel inside the strip.
    var cRow = horizontal ? Math.min(hoursFx.c1 - rowH / 2, hoursFx.c1 - pill.offsetHeight / 2 - 1)
      : hoursFx.c1 - pill.offsetWidth / 2;
    var r = place(pill, (nowFx.a0 + nowFx.a1) / 2, cRow, 'centre');
    // Clear of the midnight that ends its day, before anything else books
    // the strip, so an hour beside it gives way rather than touching it.
    var nowA = (nowFx.a0 + nowFx.a1) / 2;
    dayCuts.forEach(function (cut) {
      if (cut > nowA && r[1] - 2 * S > cut - 10 * S) {
        r = place(pill, cut - 10 * S, cRow, 'right');
        // the face may settle a little wider, and it grows to the left here
        r[0] -= 6 * S;
      }
    });
    if (free(r)) taken.push(r); else pill.remove();
  }

  // THE OVERFLOW COUNTS, on the hour row at the strip's two ends, after the
  // clock, which has first claim on either end (rule 2d). Level whichever
  // way the board is turned, like everything else on the strip.
  // Where the words will not fit beside the clock, the number alone.
  notes.forEach(function (fx) {
    var forms = [fx.text], bare = String(fx.text).match(/^\+\d+/);
    if (bare && bare[0] !== fx.text) forms.push(bare[0]);
    // ...and where even the number meets the clock at its end, beside the
    // clock instead: the count is the fact that the day goes on past the
    // paper, and the clock sitting on the edge does not make it less true.
    var done = false;
    for (var ni = 0; ni < forms.length * 2 && !done; ni++) {
      var nt = html('metro-axis-note label' + STRIP_SM + ' text--bold text-stroke', forms[ni % forms.length]);
      if (!horizontal && hoursFx && nt.offsetWidth > hoursFx.c1 && ni % forms.length < forms.length - 1) { nt.remove(); continue; }
      var nc = hoursFx ? hoursFx.c1 - (horizontal ? rowH : nt.offsetWidth) / 2 : (fx.c0 + fx.c1) / 2;
      var right = fx.align === 'right', at0 = right ? fx.a1 : fx.a0;
      if (ni >= forms.length) {
        taken.forEach(function (t) {
          if (right ? t[1] >= at0 - 60 * S : t[0] <= at0 + 60 * S) at0 = right ? Math.min(at0, t[0] - 2 * S) : Math.max(at0, t[1] + 2 * S);
        });
      }
      var nr = place(nt, at0, nc, right ? 'right' : 'left');
      if (free(nr)) { taken.push(nr); done = true; break; }
      nt.remove();
    }
  });

  // WHO IS NOT HERE, SAID OUT LOUD. The board leaves people out when the
  // panel cannot hold them, and that is an honest decision right up until it
  // is a silent one: a reader looking at four lines cannot tell whether the
  // fifth person has nothing on or simply did not fit.
  var missing = [];
  if (board.dropped && board.dropped.length) {
    missing.push(board.dropped.map(function (k) {
      var nm = null;
      ((spec.metro && spec.metro.legend) || []).forEach(function (p) {
        if (p.key === k) nm = p.name;
      });
      return nm || k;
    }).join(', ') + ' · not shown');
  }
  // ON THE STRIP, AT ITS END, where the hours give way to it. It was set a
  // row below the map, which is off the paper: "+2" was drawn past the
  // bottom of every board that shed anything. The count of names shed is
  // already beside each line's own name, so this says only who is missing.
  // AND SAID SOMEWHERE, ALWAYS. Where the strip's end was already taken ("+7
  // more" on a quadrant) the note was dropped without a word, which is the
  // silence this exists to prevent. Tried at the strip's end, then at the
  // end of the date's row, each first with the names and then as a count.
  if (missing.length && hoursFx) {
    var nDropped = board.dropped.length;
    var shortNote = '+' + nDropped + ' not shown';
    var spots = [hoursFx.c1 - rowH / 2];
    // the row the date stands in, above the hours
    if (horizontal && hoursFx.c0 >= rowH * 0.8) spots.push(hoursFx.c0 / 2);
    var placedNote = false;
    [missing.join('   '), shortNote].forEach(function (words) {
      spots.forEach(function (cSpot) {
        if (placedNote) return;
        var mi = html('metro-axis-note label' + STRIP_SM + ' text--bold text-stroke' + QUIET, words);
        var miC = horizontal ? cSpot : hoursFx.c1 - mi.offsetWidth / 2;
        var mr = place(mi, spec.axis.a1, miC, 'right');
        if (free(mr)) { taken.push(mr); placedNote = true; } else mi.remove();
      });
    });
  }


  // THE HOURS, LAST AND LEAST. The step is whatever leaves room for the
  // words, and the steps are the ones a clock has (2, 3, 6, 12) because a
  // scale marked every five hours is one nobody can do arithmetic on. Each
  // label is measured rather than estimated: a real one is a hair wider than
  // a probe at some sizes and in some languages, and two adjacent hours
  // booked clear of each other came out touching.
  if (hoursFx && spec.scale && spec.metro && ctx.clock) {
    var from = spec.metro.day_start_min, to = spec.metro.day_end_min;
    // AT THE RATE THE BUSY HOURS RUN AT, not at the first hour's. The scale
    // is not linear any more, so one sample is an opinion about one stretch:
    // taken across a compressed morning it says twelve-hour steps and the
    // whole afternoon loses its clock. Measured at the widest hour, the step
    // suits the stretch that has room and the collision test takes the
    // labels back out where there is not.
    var perMin = 0;
    for (var pm = Math.ceil(from / 60) * 60; pm + 60 <= to; pm += 60) {
      perMin = Math.max(perMin, (spec.scale.at(pm + 60) - spec.scale.at(pm)) / 60);
    }
    if (!(perMin > 0)) perMin = (spec.scale.at(from + 60) - spec.scale.at(from)) / 60;
    var probe = html('metro-hour label' + STRIP_SM + ' text--bold text-stroke', ctx.clock(0));
    var room = (horizontal ? probe.offsetWidth : probe.offsetHeight) + 10 * S;
    probe.remove();
    var STEPS = [1, 2, 3, 4, 6, 12], step = 12;
    for (var si = 0; si < STEPS.length; si++) {
      if (STEPS[si] * 60 * perMin >= room) { step = STEPS[si]; break; }
    }
    var cHour = hoursFx.c1 - rowH / 2;
    // A STRETCH THAT RUNS FAST IS LABELLED FOUR TIMES AS SPARSELY: one step
    // for the whole strip put five labels in the compressed night where the
    // busy morning had three -- "we show more hours in speed mode than non
    // speed mode". The fast stretch runs at a quarter of the rate (QUIET_RATE
    // in day.js), so four times the step is the same spacing on the paper.
    function stepAt(hh) {
      var segs = spec.scale.segments || [];
      var m = hh * 60, fast = false;
      segs.forEach(function (sg) { if (m >= sg.from && m < sg.to && sg.rate < 1) fast = true; });
      return fast ? step * 4 : step;
    }
    for (var h = Math.ceil(from / 60); h * 60 <= to; h++) {
      if (h % step !== 0 || h % stepAt(h) !== 0) continue;
      // Not on a midnight the strip changes panel at: the day's own title
      // names that minute, and the label would be half on each panel.
      if (dayCuts.length && ((spec.metro.days || []).some(function (d, di) { return di && d.start_min === h * 60; }))) continue;
      var lab = html('metro-hour label' + STRIP_SM + ' text--bold text-stroke',
                     ctx.clock((h % 24) * 60));
      lab.setAttribute('data-metro-hour', h);   // the strip's scale, readable back
      if (!horizontal) cHour = hoursFx.c1 - lab.offsetWidth / 2 - 2 * S;
      var got = place(lab, spec.scale.at(h * 60), cHour, 'centre');
      if (free(got)) taken.push(got); else lab.remove();
    }
  }

  intoPanels();

  // ---- leaders -----------------------------------------------------------
  //
  // A SHORT TICK FROM THE MARK TO THE WORDS, for a caption that had to stand
  // off its own rail. Most captions sit against their line and need nothing;
  // one pushed out to clear a neighbour is the case this exists for, and
  // without it the eye pairs the words with whatever rail is nearest, which
  // by then is somebody else's.
  //
  // Three limits, all from the engine before this one, all of them the
  // difference between a pointer and a smudge:
  //
  //   NOT WHEN THERE IS NOTHING TO POINT ALONG. A tick shorter than the
  //   clearance it leaves at each end is a dash beside a dot.
  //
  //   IT MAY NOT LEAN FAR. Straight out across the board a tick stays
  //   legible however long it is, because it is perpendicular to everything.
  //   Travel ALONG the axis is what kills it: past half a name's width the
  //   tick is running parallel to the rails and reads as one of them.
  //
  //   NOT THROUGH SOMEBODY ELSE'S NAME. The tick is new ink and nothing
  //   routes around it. A leader is a nicety; a leader through another
  //   caption is worse than no leader, so it gives way.
  //
  // AND A CONVERGENCE GETS ONE TOO, from the capsule rather than from a rail.
  // It is the caption that most needs it: an interchange's name belongs to no
  // single line, so there is nothing beside it saying which mark it is about,
  // and the capsule is a long way from the words on a board where the bundle
  // sits between two bands.
  var pillAt = {};
  (board.pills || []).forEach(function (pl) { pillAt[pl.id] = pl; });
  var boxes = board.caps.map(function (cp) { return cp.box(); });
  board.caps.forEach(function (cp, ci) {
    var bx = boxes[ci], railC = null, atA = cp.at;
    // (a shared event's name hangs off a bar whose id is not its own)
    var pl = pillAt[cp.pill || cp.id];
    if (pl) {
      atA = pl.a;
      // From the capsule's drawn EDGE, not from the rails inside it: a
      // leader that starts within the enclosure reads as part of it, and the
      // enclosure reaches a mark's radius past its outermost rail.
      var pb = pl.box();
      railC = bx.c0 >= pb.c1 ? pb.c1 : (bx.c1 <= pb.c0 ? pb.c0 : null);
      // (for a shared event's bar, above or below is judged from its end
      // rings, not from the paper the box keeps round them)
      if (pl.tie) railC = bx.c0 >= pl.c1 + NODE_R ? pb.c1 : (bx.c1 <= pl.c0 - NODE_R ? pb.c0 : null);
      // A NAME BESIDE A SHARED EVENT'S BAR GETS A SHORT LEVEL LEADER TO IT:
      // "a small leader to show the todo belongs to a shared event would be
      // nice, just to confirm it belongs to that." Out of the bar's side, at
      // the words' middle (kept within the bar), into the words.
      if (railC == null && pl.tie) {
        var cmid = Math.min(Math.max((bx.c0 + bx.c1) / 2, pl.c0), pl.c1);
        var right = bx.a0 >= pl.a;
        var aFrom = pl.a + (right ? 1 : -1) * (BAR_W / 2 + 1.5 * S), aTo = right ? bx.a0 - 1 * S : bx.a1 + 1 * S;
        if ((right ? aTo - aFrom : aFrom - aTo) < 2 * S) return;
        drawLeader([[[aFrom, cmid], [aTo, cmid]]]);
        return;
      }
      if (railC == null) return;
      // (a tie's leader starts at its end ring's edge, not at the box's
      // edge of paper, so a name close under the ring still gets its tick)
      if (pl.tie) railC = bx.c0 >= pb.c1 ? pl.c1 + NODE_R * 1.4 + 1 * S : pl.c0 - NODE_R * 1.4 - 1 * S;
      atA = Math.min(Math.max((pb.a0 + pb.a1) / 2, pb.a0), pb.a1);
    } else {
      if (cp.at == null) return;
      var ln = board.lineByKey(cp.line);
      if (!ln) return;
      railC = ln.cAt(cp.at);
      // ON A SPUR, THE SHELF'S OWN LEVEL. A spur that leaves upright at the
      // event's minute is at the trunk there, and measured from that the
      // name under the shelf looked adrift and got a pointer it did not
      // need: "family dinner doesn't need a leader."
      if (ln.branchOf && ln.pts.length > 1) {
        var lastA = ln.pts[ln.pts.length - 1][0];
        var onShelf = ln.cAt(Math.min(lastA, Math.max(cp.at, ln.pts[1][0]) + 1));
        if (onShelf != null) railC = onShelf;
      }
      if (railC == null) return;
    }
    var sign = railC <= bx.c0 ? 1 : (railC >= bx.c1 ? -1 : 0);
    if (!sign) return;                       // the words are on their rail
    var near = sign > 0 ? bx.c0 : bx.c1;
    var out = Math.abs(near - railC);
    // A RUN LONG ENOUGH TO BE A POINTER. Sized so that what is left after the
    // standoff at the mark and the gap at the words is a line and not a
    // speck: at four pixels of run the leader reads as a nick in the rail,
    // and two of them on the demo board looked like marks nobody drew.
    // ONLY WHERE THE WORDS ARE REALLY ADRIFT.
    //
    // A caption sitting one row off its rail needs no pointer: it is the
    // nearest thing to that mark and the eye pairs them without help. Drawn
    // there anyway, the tick ends in the blank paper beside the time row --
    // the top row of a caption is the shorter one -- and reads as a mark
    // nobody drew, which is what two of them looked like on the demo board.
    //
    // So the bar is a caption's own HEIGHT of empty paper between the rail
    // and the words. Past that the pairing is a guess and the tick is worth
    // the ink; short of it the tick is the only thing on the board that
    // needed explaining.
    // A capsule is already a standoff, so the leader starts at its edge; a
    // rail needs the mark's own clearance first.
    var clear = pl ? (pl.tie ? 0 : 1 * S) : NODE_R + 3 * S, tip = 1 * S;
    // A CONVERGENCE ALWAYS GETS ONE, however close its name sits.
    //
    // For an ordinary caption a leader is only worth the ink when the words
    // are really adrift -- one sitting against its own rail is already paired
    // and a tick beside it is a mark nobody drew. An interchange is the
    // opposite case: its name belongs to a REGION rather than to a point on a
    // rail, so nothing about where it sits says which region. On the demo
    // board "School Day" and "Assembly" came out side by side under one long
    // enclosure -- one naming the enclosure, one naming a dot inside it, and
    // nothing on the board saying which was which. A leader on the enclosure
    // settles it in one stroke.
    // ONE ROW OF TEXT, not the whole caption: measured against a two-row
    // caption's full height, a name sitting a row off its rail was forty
    // pixels from the mark with nothing pointing at it. "Shift Handover
    // needs to be closer and maybe a leader."
    // (a row run on inline is not a line of its own)
    var nLines = cp.rows && cp.rows.length ? cp.rows.filter(function (t, i) {
      return !(cp.rowCls && /metro-inline/.test(cp.rowCls[i] || ''));
    }).length : 0;
    var rowH = nLines ? cp.h / nLines : cp.h;
    if (!pl && out < clear + Math.max(8 * S, rowH)) return;
    // Under the words, never at their corner: a leader clamped to the very
    // edge of the box ends beside the last letter and reads as a tick.
    var inset = Math.min(6 * S, cp.w / 3);
    var toA = pl ? Math.min(Math.max(atA, bx.a0 + inset), bx.a1 - inset) : atA;
    var c0 = railC + sign * clear, c1 = near - sign * tip;
    var seg = [];                      // the leader, as one or two runs
    // A box is a region and its leader may land anywhere along it; a mark
    // is a point and the leader lands ON it, straight where the words reach
    // over it and by the elbow where they do not.
    var aligned = pl ? Math.abs(toA - atA) <= Math.max(10 * S, cp.w * 0.5)
                     : (atA >= bx.a0 - 1 && atA <= bx.a1 + 1);
    // A box's name sitting against it needs no pointer; one off its corner
    // does, however little paper is between them.
    // (a shared event's own name always gets its tick, however close)
    if (pl && !pl.tie && aligned && out < clear + 3 * S) return;
    if (pl && pl.tie && aligned && out < tip + 2 * S) return;
    // A SHARED EVENT'S NAME: straight down onto the first row's words where
    // the bar stands over them, else down to that row and square across into
    // its end -- a tick ending in the blank paper beside a short first row
    // ("Restafval" over "GF(t)/keukenafval") points at nothing.
    var firstW = cp.el && cp.el.firstChild ? (horizontal ? cp.el.firstChild.offsetWidth : cp.el.firstChild.offsetHeight) : cp.w;
    if (pl && pl.tie && !(atA >= bx.a0 + inset && atA <= bx.a0 + firstW - inset)) {
      var rowMid = sign > 0 ? bx.c0 + rowH / 2 : bx.c1 - rowH / 2;
      var endA = atA > bx.a0 + firstW ? bx.a0 + firstW + 2 * S : bx.a0 - 2 * S;
      if (Math.abs(atA - endA) < 2 * S) return;
      seg.push([[atA, c0], [atA, rowMid]]);
      seg.push([[atA, rowMid], [endA, rowMid]]);
    } else if (aligned) {
      seg.push([[toA, c0], [toA, c1]]);
    } else if (pl) {
      // AN ELBOW, when the name sits diagonally from its box. "School Run"
      // and "Family Dinner" both ended up off one corner of their box with
      // no straight run between them, and a name with no leader beside two
      // boxes is a name the reader has to guess about. Out of the box's
      // near end square, along to the name's middle, then square into it:
      // two runs, both square, the way a transit map annotates.
      // ...AND OF THE SHAPES AN ELBOW CAN TAKE, THE ONE THAT CROSSES THE
      // FEWEST RAILS. Square out of the box's bottom or top at any of three
      // points along it and along to the words, or level out of the box's
      // end and square into them: the School Run's leader ran its second
      // leg straight through Marge's rail leaving the box when a leg from
      // the box's far corner would have crossed nothing.
      var pbx = pl.box();
      var cm = (bx.c0 + bx.c1) / 2;
      var rightOf = bx.a0 > pbx.a1;
      var ah = rightOf ? bx.a0 - tip : bx.a1 + tip;
      var shapes = [];
      [pbx.a0 + 3 * S, (pbx.a0 + pbx.a1) / 2, pbx.a1 - 3 * S].forEach(function (av) {
        shapes.push([[[av, c0], [av, cm]], [[av, cm], [ah, cm]]]);
      });
      var aEdge = rightOf ? pbx.a1 + 1 * S : pbx.a0 - 1 * S;
      var cMid = (pbx.c0 + pbx.c1) / 2, ac = (bx.a0 + bx.a1) / 2;
      var cNear = sign > 0 ? bx.c0 - tip : bx.c1 + tip;
      shapes.push([[[aEdge, cMid], [ac, cMid]], [[ac, cMid], [ac, cNear]]]);
      function railCuts(shape) {
        var n = 0;
        shape.forEach(function (sg2) {
          board.lines.forEach(function (o) {
            for (var oi = 1; oi < o.pts.length; oi++) {
              if (crosses(sg2[0], sg2[1], o.pts[oi - 1], o.pts[oi])) n++;
            }
          });
        });
        return n;
      }
      function runOf(shape) {
        return shape.reduce(function (t, sg2) {
          return t + Math.abs(sg2[1][0] - sg2[0][0]) + Math.abs(sg2[1][1] - sg2[0][1]);
        }, 0);
      }
      // A shape through somebody else's name is worse than one across a
      // rail, and both are worse than neither; only if every shape runs
      // through a name is there no leader at all.
      function nameHits(shape) {
        var n = 0;
        shape.forEach(function (sg2) {
          var la0 = Math.min(sg2[0][0], sg2[1][0]) - 1, la1 = Math.max(sg2[0][0], sg2[1][0]) + 1;
          var lc0 = Math.min(sg2[0][1], sg2[1][1]), lc1 = Math.max(sg2[0][1], sg2[1][1]);
          boxes.forEach(function (o, oi) {
            if (oi !== ci && la0 < o.a1 && o.a0 < la1 && lc0 < o.c1 && o.c0 < lc1) n++;
          });
        });
        return n;
      }
      var bestShape = null, bestKey = Infinity;
      shapes.forEach(function (sh) {
        var key = nameHits(sh) * 1e8 + railCuts(sh) * 1e6 + runOf(sh);
        if (key < bestKey) { bestKey = key; bestShape = sh; }
      });
      if (bestKey >= 1e8) return;
      seg = bestShape;
    } else if (cp.at != null) {
      // ...AND FOR A NAME THAT CANNOT REACH ITS DOT: an elbow from the mark
      // itself. A leader dropped wherever the words happened to overlap the
      // rail pointed at nothing -- on the demo board Assembly's ran to the
      // end tick of an event whose dot was a name's width to the left.
      var cm2 = (bx.c0 + bx.c1) / 2;
      var ah2 = bx.a0 > atA ? bx.a0 - tip : bx.a1 + tip;
      seg.push([[atA, c0], [atA, cm2]]);
      seg.push([[atA, cm2], [ah2, cm2]]);
    } else return;
    drawLeader(seg);
    function drawLeader(runs) {
      var blocked = boxes.some(function (o, oi) {
        if (oi === ci) return false;
        return runs.some(function (s) {
          var la0 = Math.min(s[0][0], s[1][0]) - 1, la1 = Math.max(s[0][0], s[1][0]) + 1;
          var lc0 = Math.min(s[0][1], s[1][1]), lc1 = Math.max(s[0][1], s[1][1]);
          return la0 < o.a1 && o.a0 < la1 && lc0 < o.c1 && o.c0 < lc1;
        });
      });
      // ...AND NOT THROUGH A RING: a leader from Central Perk's name down to
      // its branch ran straight through Rachel's ring, "strange leader".
      if (!blocked) blocked = (board.pills || []).some(function (tp) {
        if (!tp.tie) return false;
        return (tp.lines || []).some(function (k) {
          var rl = board.lineByKey(k), rc = rl ? rl.cAt(tp.a) : null, rr2 = NODE_R * 1.4;
          if (rc == null) return false;
          return runs.some(function (s) {
            var la0 = Math.min(s[0][0], s[1][0]), la1 = Math.max(s[0][0], s[1][0]);
            var lc0 = Math.min(s[0][1], s[1][1]), lc1 = Math.max(s[0][1], s[1][1]);
            return la0 < tp.a + rr2 && tp.a - rr2 < la1 && lc0 < rc + rr2 && rc - rr2 < lc1;
          });
        });
      });
      if (blocked) return;
      runs.forEach(function (s) {
        var q0 = xy(s[0][0], s[0][1]), q1 = xy(s[1][0], s[1][1]);
        var lead = svgEl(doc, 'line', { x1: q0[0], y1: q0[1], x2: q1[0], y2: q1[1],
          'stroke-width': 1.2 * S, 'stroke-linecap': 'butt' });
        lead.style.stroke = pl ? INK : inkOf(cp.line);
        put(lead, pl ? 'leader' : 'lead', cp.line || cp.id);
      });
    }
  });

  // ---- the words --------------------------------------------------------
  //
  // Positioned, not built: the element was made and measured before anything
  // was placed, and it is the same element. Anything that rebuilt it here
  // would be drawing a box of a size nobody solved for.
  //
  // THE TIME NEAREST THE MARK, ALONG AND ACROSS. "Captions should have the
  // time always as close to the start of the event": under its rail a
  // caption reads time then title, over it title then time, so the clock is
  // the row against the rail; and a name standing left of its mark ranges
  // its rows right, so the time ends where the event begins. The rows are
  // the measured ones re-ordered, and ranging changes no width, so the box
  // the solver placed is the box that is drawn.
  board.caps.forEach(function (cp) {
    var el = cp.el;
    if (!el) return;
    // STANDING UP, THE WORDS RUN DOWN THE RAIL. The solver books a caption's
    // length ALONG the axis and its rows ACROSS it, whichever way the board
    // is turned; written level on a board standing up, every name was as wide
    // as its words across a column a rail-gap wide and ran over the next
    // line. Turned to read down the page, the drawn box is the booked box.
    // `vertical-lr` so the rows stack in the same order across the rail as
    // they do lying down, and the label's inset turned with them (the
    // stylesheet reads it from two custom properties, so the turn costs the
    // inline-style lint nothing).
    if (!horizontal) {
      el.style.writingMode = 'vertical-lr';
      el.style.setProperty('--metro-inset-along', '0');
      el.style.setProperty('--metro-inset-across', '3px');
    }
    var p = xy(cp.a, cp.c);
    el.style.left = p[0] + 'px';
    el.style.top = p[1] + 'px';
    var pl2 = pillAt[cp.pill || cp.id], refC = null, startA = cp.at;
    if (pl2) {
      var pb2 = pl2.box();
      refC = (pb2.c0 + pb2.c1) / 2; startA = pb2.a0;
    } else if (cp.at != null) {
      var ln2 = board.lineByKey(cp.line);
      refC = ln2 ? ln2.cAt(cp.at) : null;
    }
    // THE TIME ALWAYS UNDER THE TITLE. It used to stand on the side nearest
    // the rail, so a caption below its line read time-then-name and one above
    // it name-then-time: "standardizing timestamp position will make
    // scanning even faster". The name is what a reader looks for first.
    if (startA != null) el.style.textAlign = (cp.a + cp.w) <= startA + 1 ? 'right' : 'left';
    if (!el.parentNode) canvas.appendChild(el);
  });

  // WHY THE BOARD IS EMPTY, WHEN IT IS: a broken setting, every feed down, or
  // nothing on (transform.js boardNotice). Set in the map under the strip,
  // where the reader is already looking, rather than as a header over nothing.
  var noticeText = spec.metro && spec.metro.board_notice;
  if (noticeText) {
    var band0 = dayBadges[0] && dayBadges[0].band ? dayBadges[0].band : 0;
    var off = horizontal ? band0 : (spec.stripThick || 0);
    var notice = doc.createElement('div');
    notice.className = 'metro-gen metro-notice absolute flex flex--col flex--center p--4 text--center';
    // on paper, so a rule or a midnight line behind it does not run through it
    var words = doc.createElement('div');
    words.className = 'title bg--white outline rounded--base p--2';
    words.style.maxWidth = Math.round((horizontal ? W : W - off) * 0.7) + 'px';
    words.textContent = noticeText;
    notice.appendChild(words);
    notice.style.left = (horizontal ? 0 : off) + 'px';
    notice.style.top = (horizontal ? off : 0) + 'px';
    notice.style.width = (horizontal ? W : W - off) + 'px';
    notice.style.height = (horizontal ? H - off : H) + 'px';
    canvas.appendChild(notice);
  }

  return svg;
}

module.exports = { draw: draw, treatment: treatment, pathOf: pathOf,
                   INK: INK, PAPER: PAPER };
