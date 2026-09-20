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
// (2.4 before the rail itself went from 3 to 4: the rail is heavier, the
// texture's extra is smaller, and two rails a gap apart keep their paper)
var WIDEN = 1.9;
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

// WHAT AN EDGE RING TAKES OF ITS RAIL'S FIRST MINUTE.
//
// A shared event already running when the board opened is drawn as an
// interchange at the rail's start: a ring on each member, three dots past it,
// and the rail's own ink resuming after those. The line's NAME has to begin
// clear of the ring -- and a name's paper is booked by the SOLVER, not here.
// So the reach is stated once, in this one place, and handed to the spec the
// way markR and corner are (day.js): the numbers the solver and the renderer
// have to agree on.
//
// Drawn from one number and reserved from another is exactly how two thirds
// of "Fry" came to be drawn on paper the caption search believed was free,
// and how "Bender" came to be written over "Hedonism Lounge" on a board the
// checker called clean.
function edgeRing(S) {
  // NODE_R * 1.4 (a lettered ring) * EDGE_RING, with the stroke's outer half.
  var r = 6 * S * 1.4 * 0.75 + 3 * S * 0.5;
  // ...and the step out to each of the three dots (RAIL_W * 1.3, never less
  // than the smallest gap that still reads as three marks).
  var gap = Math.max(3 * S * 1.3, 2.6 * S);
  return { r: r, gap: gap, reach: r + gap };
}

function draw(board, spec, ctx) {
  var doc = ctx.doc || document;
  var svg = ctx.svg, canvas = ctx.canvas;
  var S = ctx.S || 1, horizontal = ctx.horizontal !== false;
  var W = ctx.W, H = ctx.H;
  // Where the map's paper ends: above the headlines' box where there is one
  // (the washes and the midnight cut stop there, not at the paper's edge).
  var mapFoot = (spec.news && spec.news.h && horizontal) ? H - spec.news.h : H;
  // The constants the old engine tuned, at the panel's own scale.
  // THE RAIL IS THE HEAVIEST INK ON THE BOARD. A transit map is read by its
  // lines first and its words second, and at 3 the rails were the thinnest
  // thing on the paper, under captions set bold. 4 puts the line back on
  // top; the ring's wall grows with it so a stop is outlined at the weight
  // of the rail it sits on (Mini Metro's rule). (The corner was opened to 17
  // with it and put back: the solver books turns by it, and the wider turn
  // moved captions on boards the suites pin.)
// The metro silhouette on the strip (see the now line): SVG Repo 420587, CC0.
var TRAIN_D = 'M814.817,382.75h-45.773c0-9.665-7.835-17.5-17.5-17.5h-57.5c-9.665,0-17.5,7.835-17.5,17.5h-64 c0-9.665-7.835-17.5-17.5-17.5h-150c-9.665,0-17.5,7.835-17.5,17.5h-28.058c-123.542,0-228.097,91.845-243.34,214.442 c-0.04,0.323-0.079,0.64-0.117,0.952c-0.166,1.379-0.064,2.719,0.241,3.986c-3.965,1.814-6.726,5.807-6.726,10.453v10.667 c0,6.351,5.149,11.5,11.5,11.5h193.611c6.351,0,11.5-5.149,11.5-11.5v-10.667c0-0.625-0.064-1.235-0.16-1.833h25.859 c-0.096,0.598-0.16,1.208-0.16,1.833v10.667c0,6.351,5.149,11.5,11.5,11.5h193.611c6.351,0,11.5-5.149,11.5-11.5v-10.667 c0-0.625-0.064-1.235-0.16-1.833h25.859c-0.096,0.598-0.16,1.208-0.16,1.833v10.667c0,6.351,5.149,11.5,11.5,11.5h193.611 c6.351,0,11.5-5.149,11.5-11.5v-10.667c0-0.625-0.064-1.235-0.16-1.833h0.16V418.389C850.456,398.706,834.5,382.75,814.817,382.75z M395.476,497.785c-17.829,23.27-45.942,38.094-77.072,38.094h-119.1c14.1-30.59,35.01-57.27,60.68-78.26h115.608 C396.287,457.62,408.062,481.358,395.476,497.785z M451.544,482.62c0-13.807,11.193-25,25-25h242c13.807,0,25,11.193,25,25v28.26 c0,13.807-11.193,25-25,25h-242c-13.807,0-25-11.193-25-25V482.62z M812.044,579.75h-352c-4.694,0-8.5-3.806-8.5-8.5 s3.806-8.5,8.5-8.5h352c4.694,0,8.5,3.806,8.5,8.5S816.738,579.75,812.044,579.75z M820.544,510.88c0,13.807-11.193,25-25,25h-1.5 c-13.807,0-25-11.193-25-25v-28.26c0-13.807,11.193-25,25-25h1.5c13.807,0,25,11.193,25,25V510.88z';
  var NODE_R = 6 * S, NODE_STROKE = 3.5 * S, LINE_GAP = 6 * S, CORNER = 13 * S;
  var RAIL_W = 4 * S;
  // the ink edge of a shaded rail: one pixel, and INSIDE the rail's width,
  // so the rail is no taller for it ("1 pixel outline in the darkest colour
  // of the track style, not making the track taller")
  var EDGE_W = 1;

  // WHERE A CONNECTOR THAT PREDATES THE BOARD IS DRAWN, by line.
  //
  // A shared event already running at the first minute did not begin there:
  // it began off the left of the paper. The legend's column is that time, so
  // the connector stands at the paper's edge, a dotted approach carries each
  // member into the day, and the event's own branch leaves the bar rather
  // than the first minute -- "move the left connector to the left", "delivery
  // should also start from the edge", "actually it should join the
  // connector". Worked out here because the rails are drawn before the
  // connectors and both have to agree about where it is.
  var edgeTieAt = {};
  // ...NOT WHERE THE NAMES ARE LEVEL WITH THEIR RAILS: there the column at
  // the head is the roundels', and the connector stands at the first minute
  // after them, a bar between labelled stations.
  var levelHead = {};
  (spec.fixed || []).forEach(function (fx) { if (fx.kind === 'terminus' && fx.level) levelHead[fx.line] = true; });
  // (`spec.axis.a0` by name: the rails are drawn well before this file's own
  // `axisA0` is set, and read early it is quietly undefined -- which reads as
  // "no", so the branch the connector belongs to went on starting at the
  // first minute while the connector itself stood at the edge.)
  (board.pills || []).forEach(function (pl) {
    if (!pl.tie || !pl.open0 || pl.a > spec.axis.a0 + 1) return;
    if ((pl.lines || []).some(function (k) { return levelHead[k]; })) return;
    var eR = edgeRing(S), eE = spec.axis.edge0 == null ? pl.a : spec.axis.edge0;
    // only where the column can hold a lettered ring and a step of approach
    if (pl.a - eE <= eR.r * 2 + eR.gap * 2) return;
    (pl.lines || []).forEach(function (k) { edgeTieAt[k] = eE + eR.r; });
  });
  // WHERE A BRANCH THAT PREDATES THE BOARD LEAVES ITS LINE, by branch key.
  //
  // A shelf already out when the board opened was drawn arriving from off
  // the paper at the first minute -- a half dot, three dots, and a dotted
  // drop to its rail so the two could be seen to belong together. With the
  // legend's column the line itself now runs out to the paper's edge, so the
  // shelf can simply leave it there and run in the whole way: "that top one
  // should be a shelf from the start". Out of the connector where its line
  // is in one; otherwise just past the line's own leading mark at the edge.
  // Not beside a name set level with its rail, which is what the column
  // holds on a flat slot.
  var shelfFrom = {};
  if (spec.nameGutter && spec.axis.edge0 != null) {
    var levelOn = {};
    (spec.fixed || []).forEach(function (fx) { if (fx.kind === 'terminus' && fx.level) levelOn[fx.line] = true; });
    var openAt0 = {};
    (spec.wants || []).forEach(function (w) { if (w._rail && w.open0) openAt0[w._rail] = true; });
    var cv0 = 4 * S * 1.6;   // chevron(): how far the leading arrow reaches
    board.lines.forEach(function (ln) {
      if (!ln.branchOf || !ln.pts.length || ln.pts[0][0] > spec.axis.a0 + 1) return;
      if (edgeTieAt[ln.branchOf] != null) { shelfFrom[ln.key] = edgeTieAt[ln.branchOf]; return; }
      if (!openAt0[ln.key] || levelOn[ln.branchOf]) return;
      shelfFrom[ln.key] = spec.axis.edge0 + cv0 * 2.5;
    });
  }

  // ONE HOLLOW, for the bar and the branch that continues it: the same width
  // and the same walls, "the connector and the branch don't use the exact same
  // style".
  var BAR_W = NODE_R * 1.3, TUBE_W = BAR_W, BAR_CORE = BAR_W - 2 * NODE_STROKE * 0.8;
  // How much of a crossing's ring an edge ring is. See the note where it is drawn.
  var EDGE_RING = 0.75;
  // WHAT A BRIDGE LEAVES THE LINE IT CROSSES: paper each side of the deck, and
  // no more of it than it takes to see that the two are not one mark. "Can you
  // get the other track a bit closer to the bridge... close enough so they
  // just aren't touching." It was six tenths of a rail's own width, which at
  // the X's scale is three pixels of white either side and reads as the
  // crossed line stopping short of something rather than passing under it.
  // Held in S, not in the rail's width, so every line style leaves the same
  // gap -- which is the same reason the pillars are one size everywhere.
  // (a rail's width of paper each side of the deck: at a hair the crossing
  // needed pillars to be seen, and with the pillars gone the gap is the mark)
  var BRIDGE_CLEAR = 2.4 * S;

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
  // BY THE PERSON'S RUNG, where the payload remembered one (line.slot, from
  // the transform's saved state), so the shade follows the person and not
  // the day's order; by order where it did not. A shared calendar's ladder
  // line takes no rung and is inked by its place.
  var byOrder = 0;
  (spec.lines || []).forEach(function (l, i) {
    var rung = typeof l.slot === 'number' ? l.slot : byOrder;
    byOrder++;
    // The anchor -- the one solid rail, which the eye finds first -- is fully
    // inked by definition, so black is spent before the ladder is handed out.
    if (ONE_BIT || rung === 0) { shade[l.key] = INK; return; }
    var cycle = Math.floor((rung - 1) / TONES.length);
    if (palette) { shade[l.key] = palette[(rung - 1 + cycle) % palette.length]; return; }
    var pct = TONES[(rung - 1 + cycle) % TONES.length];
    shade[l.key] = 'color-mix(in srgb, ' + INK + ' ' + pct + '%, ' + PAPER + ')';
  });
  // A branch wears its trunk's ink, marks included: asked by the spur's own
  // key, the dot and tick on Assembly's spur came out black beside a red
  // rail -- "branch event markers don't follow the color pattern."
  // A RAIL'S OWN INK AND OUTER WEIGHT, as the rail is drawn below, so a tick
  // on it wears exactly that: a tie's spur is plain ink whatever its line's
  // shade, and a textured rail is wider than its core.
  // (a tie's hollow spur is ink already and gets no edge)
  function tube_(ln) { return !!(ln && ln.branchOf && ln.ink); }
  // A PAPER-FILLED MARK ON A SHADED RAIL WEARS THE RAIL'S EDGE TOO. The
  // stop's ring is the shade alone, and beside an edged rail it read as a
  // grey washer ("and the dot?"). An ink twin goes under it -- the same
  // shape, paper inside, ink at the mark's full weight -- and the mark's own
  // ring is inset a pixel inside that, so it is edged outside and in.
  // (Under an ink mark, and on a 1-bit panel, the twin is invisible; it is
  // drawn anyway so the drawing has the same parts at every bit depth.)
  function edgeMark(el, line, role, fill) {
    var sw = parseFloat(el.getAttribute('stroke-width'));
    if (!(sw > 3 * EDGE_W)) return;
    var twin = el.cloneNode(false);
    // (the twin carries the mark's own fill: a ticked task is solid, and
    // everything else is paper, see rule 2q)
    twin.style.stroke = INK; twin.style.fill = fill || PAPER;
    twin.setAttribute('data-metro-role', role + '-edge');
    svg.insertBefore(twin, el);
    el.setAttribute('stroke-width', sw - 2 * EDGE_W);
    el.style.fill = 'none';
  }
  // ...AND A SOLID SHADE SHAPE (the open chevron, the three dots that say a
  // line arrives from before the board) gets a hairline of ink round it:
  // an ink twin under it, stroked a pixel proud, that the shade's own fill
  // then covers from the inside.
  function edgeFill(el, role) {
    var twin = el.cloneNode(false);
    twin.style.fill = INK; twin.style.stroke = INK;
    twin.setAttribute('stroke-width', 2 * EDGE_W);
    twin.setAttribute('data-metro-role', role + '-edge');
    svg.insertBefore(twin, el);
  }
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
    // A MARK ON A SHADED RAIL WEARS THE RAIL'S EDGE. The tick and the slash
    // are the rail's own ink at the rail's own weight, and drawn in the shade
    // alone they were the one place the outline stopped ("the outline
    // doesn't continue here"): ink under, a pixel proud at both ends, and
    // the shade inset inside it, so the mark is outlined all round.
    var mLen = Math.hypot(q1[0] - q0[0], q1[1] - q0[1]);
    if (!tube_(ln) && !ONE_BIT && rs.ink !== INK && mLen > 0) {
      var mux = (q1[0] - q0[0]) / mLen, muy = (q1[1] - q0[1]) / mLen;
      var under = svgEl(doc, 'line', { x1: q0[0] - mux * EDGE_W, y1: q0[1] - muy * EDGE_W,
        x2: q1[0] + mux * EDGE_W, y2: q1[1] + muy * EDGE_W,
        'stroke-width': rs.width, 'stroke-linecap': 'butt' });
      under.style.stroke = INK;
      put(under, role + '-edge', key);
      rs = { ink: rs.ink, width: rs.width - 2 * EDGE_W };
    }
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
    // NO PILLARS. Four stubs under every rail at every crossing were a picket
    // fence along the midnight rule ("can we make the bridges look nicer?");
    // a printed map marks a crossing with the gap alone, and the gap is
    // wider now (BRIDGE_CLEAR) so it can carry that.
    return;
    var rs = railStroke(ln, key), W = rs.width, edge = W / 2, n = [-u[1], u[0]];
    function pt(along, across) {
      return xy(at[0] + u[0] * along + n[0] * across, at[1] + u[1] * along + n[1] * across);
    }
    var pw = W * 0.5, gap = W * 0.4, drops = [W * 1.3, W * 0.75];   // inner, outer
    // ON BOTH FACES OF THE DECK WHERE THE BOARD RUNS DOWNWARD.
    //
    // Hanging beneath the deck is what a bridge does, and while the deck lies
    // across the paper it reads as one. Stood on its end the same four pillars
    // all stick out of one flank of the rail, which reads as something wrong
    // with the line rather than as a bridge -- there is no "under" to hang
    // from when the deck is vertical. So a vertical board mirrors them: two
    // either side of the gap on each face, and the crossing is symmetrical
    // about the rail the way the reader's eye expects it to be.
    var faces = horizontal ? [1] : [1, -1];
    faces.forEach(function (fc) {
      [-1, 1].forEach(function (sd) {
        [0, 1].forEach(function (k) {
          var i0 = d + k * (pw + gap), i1 = i0 + pw;
          var q = [pt(sd * i0, fc * (edge - 0.5)), pt(sd * i1, fc * (edge - 0.5)),
                   pt(sd * i1, fc * (edge + drops[k])), pt(sd * i0, fc * (edge + drops[k]))];
          var g = svgEl(doc, 'path', { d: 'M ' + q.map(function (v) { return v[0] + ' ' + v[1]; }).join(' L ') + ' Z',
            stroke: 'none' });
          g.style.fill = rs.ink;
          put(g, 'guardrail', key);
        });
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
  // TODAY'S PANEL IN INK, the day it reaches into in paper: the rail along
  // the strip's foot, its stations and the train are knocked out of the ink
  // there and drawn in ink on the paper. (A paper strip on both days was
  // tried: "not sure about the removal of the black header bg for the now
  // panel".)
  var INK_TODAY = true;
  function onInkPanel(a) { return panels.some(function (pn) { return pn.inverse && a >= pn.a0 - 0.5 && a <= pn.a1 + 0.5; }); }
  // the row the hours' rail takes at the strip's foot (day.js railRow)
  var RAIL_ROW = horizontal && strip && spec.railRow ? spec.railRow : 0;
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
  // THE DAYS MEET AT 45 DEGREES. Today's ink panel does not stop square at
  // the midnight: its top runs on over tomorrow's paper and its edge comes
  // down to the cut at the strip's rail on the diagonal every branch on the
  // map takes ("could we have the today and tomorrow header be divided by
  // a 45° shape? So today gets some extra space, and it would look
  // nicer and in theme"). As far across as the strip is deep, or less
  // where tomorrow's panel is a sliver; the reach at any row is what
  // `slantAt` says, and tomorrow's title and today's forecast use it.
  var slantW = 0, trainEl = null;
  function slantAt(cBottom) { return slantW ? Math.max(0, strip.c1 - cBottom - 2 * S) : 0; }
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
      // PAPER FOR THE DAY IT REACHES INTO, not a grey block: the title says
      // which day it is, the rule under it says where the strip ends, and
      // a second field of grey beside the ink one was mass without meaning
      // ("something nicer than that"). The ink panel's far corners are
      // rounded like the pills on it, so it ends as a shape and not a cut.
      // ...AND PAPER FOR TODAY TOO. The board's own day was a band of ink
      // across the top of every panel, and once the roundels and the rails
      // carry the weight below it, "the black is too much": the date pill
      // and the clock pill are the strip's ink now, and the wash over the
      // past says which half of the board is today.
      var inkPanel = INK_TODAY && !pi;
      panel.className = 'metro-strip absolute ' + (inkPanel ? 'inverse bg--canvas' : 'bg--canvas');
      panel.style.left = px0 + 'px'; panel.style.top = py0 + 'px';
      panel.style.width = pw + 'px'; panel.style.height = ph + 'px';
      if (inkPanel && horizontal && edges.length > 2) {
        var nextW = edges[2] - edges[1];
        slantW = Math.min(ph, Math.floor(nextW * 0.4));
        if (slantW < 8 * S) slantW = 0;
        if (slantW) {
          panel.style.width = (pw + slantW) + 'px';
          panel.style.clipPath = 'polygon(0 0, 100% 0, ' + pw + 'px 100%, 0 100%)';
        }
      }
      canvas.insertBefore(panel, svg);
      panels.push({ el: panel, a0: pa0, a1: pa1, x: px0, y: py0, w: pw, inverse: inkPanel });
      // The band's extent, for anything that asks where the scale ends.
      var band = svgEl(doc, 'rect', { x: px0, y: py0, width: pw, height: ph,
        stroke: 'none', 'fill-opacity': 0 });
      band.style.fill = INK;
      put(band, 'river');
      // EVERY PANEL IS RULED OFF FROM THE MAP: "tomorrow header section
      // needs a bottom border". The wash would otherwise fade into the paper
      // under it; under the inverse panel the rule is ink on ink and simply
      // carries its edge down by the same amount, so the two bottoms are one
      // line ("the black has no line so it looks uneven").
      {
        // THE STRIP'S EDGE IS A RAIL: the day itself, drawn as a line at the
        // rails' weight, with the hours as its stations and the clock as the
        // train on it (below). "Something metro and or train themed."
        // ...UNDER THE PANELS, one ink rail the whole width, so the day's
        // panel stands on the line like a sign on a track and the line runs
        // through the midnight whole. Drawn in the panel's own colour it
        // changed from paper to ink at the cut, which read as a break.
        var railC = strip.c1 + RAIL_W / 2;
        var e0 = xy(pa0, railC), e1 = xy(pa1, railC);
        var rule = svgEl(doc, 'line', { x1: e0[0], y1: e0[1], x2: e1[0], y2: e1[1],
          'stroke-width': RAIL_W, 'stroke-linecap': 'butt' });
        rule.style.stroke = INK;
        put(rule, 'strip-edge');
      }
    }
    // ...and tomorrow's panel, painted after it, leaves the slope's
    // triangle unpainted so the ink shows through there. (Not reordered in
    // the DOM: the panels are read back in the order of the days.)
    if (slantW && panels.length > 1) {
      panels[1].el.style.clipPath = 'polygon(' + slantW + 'px 0, 100% 0, 100% 100%, 0 100%)';
    }
  }
  // WHICH PANEL A STRIP LABEL BELONGS TO, by where it stands along the axis;
  // moved into it, so the inverse reaches it. One that straddles a gap has
  // no panel to be legible in and is taken off.
  function intoPanels() {
    if (!panels.length || !strip) return;
    Array.prototype.slice.call(canvas.children).forEach(function (n) {
      if (n === svg || !/\bmetro-gen\b/.test(n.className) || /\bmetro-strip\b/.test(n.className)) return;
      if (!/metro-hour|metro-axis-note|metro-daybadge|metro-wx|metro-nownext/.test(n.className)) return;
      var left = parseFloat(n.style.left) || 0, top = parseFloat(n.style.top) || 0;
      var len = horizontal ? n.offsetWidth : n.offsetHeight, thick = horizontal ? n.offsetHeight : n.offsetWidth;
      var a0 = horizontal ? left : top, c0 = horizontal ? top : left;
      if (c0 + thick / 2 > strip.c1) return;
      // By its middle, and nudged inside: the day badge starts on the
      // midnight itself and the forecast ends there, both a gap's width into
      // the paper between the panels.
      var mid = a0 + len / 2, home = null;
      panels.forEach(function (pn) { if (mid >= pn.a0 && mid <= pn.a1) home = pn; });
      if (!home) { n.remove(); return; }
      // ON THE INK PANEL A ROW REACHES AS FAR AS THE SLANT LETS IT: the
      // higher the row, the further past the midnight it may run.
      var reach = home.inverse ? slantAt(c0 + thick) : 0;
      var homeA1 = home.a1 + reach, homeW = home.w + (home.inverse ? slantW : 0);
      if (len > homeA1 - home.a0) { n.remove(); return; }
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
      // ...and nothing on the panel after the ink one is held back under
      // its slope, which covers the start of each row by as much as the row
      // is high (measured at the row's top, where it reaches furthest)
      var cover = horizontal && slantW && panels.length > 1 && home === panels[1] ? slantAt(c0) : 0;
      var fit = Math.max(home.a0 + inset + cover, Math.min(a0, homeA1 - len - inset));
      if (len > homeA1 - home.a0 - 2 * inset - cover) { n.remove(); return; }
      if (horizontal) left = fit; else top = fit;
      n.style.left = (left - home.x) + 'px'; n.style.top = (top - home.y) + 'px';
      // THE FORECAST IS HELD BY ITS PANEL'S RIGHT EDGE, like a name at the far
      // edge: measured before the face settles it ran off the paper.
      if (horizontal && (/metro-wx/.test(n.className) || (/metro-pill/.test(n.className) && fit + len >= homeA1 - inset - 12 * S))) {
        n.style.left = 'auto';
        n.style.right = Math.max(0, homeW - (fit - home.x) - len) + 'px';
      }
      // THE OUTLINE IS THE GROUND'S COLOUR. The framework's stroke follows
      // `inverse` by itself, so on today's panel it is ink; the light panel
      // is a grey the framework does not know the words are standing on, and
      // a paper outline there drew a white halo round every hour.
      if (!home.inverse) {
        // THE HOURS ARE THE RULER, NOT THE MESSAGE: on a grey panel with real
        // greys they are set regular, so the clock's pill and the date are the
        // bold things on the strip. Measured and placed bold (wider), so a
        // lighter label never touches its neighbour; on the ink panel and on
        // 1-bit they stay bold, where thin letters break up.
        if (!ONE_BIT && /\bmetro-hour\b/.test(n.className) && !/metro-wx/.test(n.className)) n.classList.remove('text--bold');
        // (the panel is paper now, and the framework's outline is paper by
        // default: nothing to swap)
        // ...AND SO IS AN IMAGE'S: a white rim on the ink panel is the
        // ground's own colour on tomorrow's, so there it is ink.
        [n].concat(Array.prototype.slice.call(n.querySelectorAll('.image-stroke'))).forEach(function (el) {
          if (!el.classList.contains('image-stroke--white')) return;
          el.classList.remove('image-stroke--white');
          el.classList.add('image-stroke--black');
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
    // (the washes lie over the map now, see the end of draw(): a cut is
    // tinted by the night it is in without any help)
    return;
    if (!nights.some(function (n) { return a >= n[0] - 0.5 && a <= n[1] + 0.5; })) return;
    var g = node.cloneNode(false);
    if (g.style.fill && g.style.fill !== 'none') { g.style.fill = INK; g.setAttribute('fill-opacity', 0.08); }
    if (g.style.stroke && g.style.stroke !== 'none') { g.style.stroke = INK; g.setAttribute('stroke-opacity', 0.08); }
    // Its own name: this is paper put BACK over a cut, not a statement about
    // the sky, and anything measuring the dark has to skip it.
    g.setAttribute('data-metro-role', 'night-over');
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
  // ...AND THEN NOT DRAWN AT ALL. Two grey columns across a board that now
  // washes its past and boxes its news read as a third kind of grey with
  // nothing to say ("can you remove the night bg? I'm not sure it looks
  // that clean"). The strip says which day it is; the map stays paper.
  // ...AND THEN BACK, IN A BAND OF ITS OWN ("undo that move above the rail.
  // have it be below again but in its own little styled band. bg can have
  // the twilight and night bgs again"): not across the map, where it was a
  // third kind of grey, but inside the row of sky glyphs under the strip's
  // rail. There it is the row's own ground: the drops, the moon and the
  // sunset stand on the dark they are about.
  var skyBand = strip && spec.skyH ? [strip.c1 + RAIL_W / 2, spec.cross.c0] : null;
  // ...AND THE DARK COMES OFF IT AGAIN ("remove the twilight & night bg for
  // the weather band"): the band keeps its own faint ground, which is what
  // makes it a band, and says nothing about the sky beyond the glyphs in
  // it. The shading code stays, switched off, as it was for the map.
  var NIGHT_SHADE = false;
  if (skyBand) {
    // THE BAND'S OWN GROUND: the row of sky glyphs reads as a strip of its
    // own rather than as marks floating under the rail.
    var sb0 = xy(0, skyBand[0]), sb1 = xy(horizontal ? W : H, skyBand[1]);
    var sbg = svgEl(doc, 'rect', { x: Math.min(sb0[0], sb1[0]), y: Math.min(sb0[1], sb1[1]),
      width: Math.abs(sb1[0] - sb0[0]), height: Math.abs(sb1[1] - sb0[1]),
      stroke: 'none', 'fill-opacity': 0.04 });
    sbg.style.fill = INK;
    put(sbg, 'sky-band');
  }
  if (NIGHT_SHADE && spec.scale && spec.cross && spec.metro) {
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
    // ...AND EACH END OF A DARK SPAN KNOWS WHETHER THE SUN DID IT. A night
    // between two days begins at a sunset and ends at a sunrise; one at
    // either end of the list begins or ends at a midnight the forecast
    // simply stops at, which is not an event in the sky and must not be
    // drawn as one (see the twilight shoulders below).
    var darks = [];
    lights.forEach(function (l, li) {
      if (li === 0) darks.push([l[2], l[0], false, true]);
      else darks.push([lights[li - 1][1], l[0], true, true]);
      if (li === lights.length - 1) darks.push([l[1], l[2] + 1440, true, false]);
    });
    // DUSK AND DAWN ARE NOT A LINE, THEY ARE A WHILE.
    //
    // Sunset is one minute in the payload and the dark began at it, so the
    // board went from daylight to night between two pixels. It does not: the
    // half hour after the sun goes down is neither, and a household reads it
    // as "getting dark" rather than as night. So a dark span is drawn twice
    // -- once whole and light, and once again inset by a twilight at each
    // end, which puts the deep of the night in the middle and leaves the
    // shoulders pale.
    //
    // HOW LONG, FROM THE PAYLOAD, WHICH WORKED IT OUT. Civil twilight is
    // about twenty minutes at the equator, three quarters of an hour in
    // Belgium in June and near two hours in Shetland, so a flat half hour is
    // wrong almost everywhere. The forecast carries no twilight of any kind
    // -- Open-Meteo's daily block is sunrise, sunset, daylight_duration and
    // sunshine_duration -- so transform.js computes it from the latitude and
    // the date (`twilightMin`). Thirty-five minutes is what is used when a
    // payload predates that, which is Brussels in spring and wrong elsewhere.
    //
    // A SHADE DARKER THAN IT WAS, while we are here: the deep was eight per
    // cent and read as a smudge on the paper from across a room, and on a
    // 1-bit panel it dithered away to almost nothing. Six and six is twelve
    // where they overlap, still well under the lightest thing drawn ON the
    // night -- a dotted rail is the framework's own grey -- so nothing that
    // crosses it got harder to read.
    var TWILIGHT_FALLBACK = 35;
    var twi = TWILIGHT_FALLBACK;
    dayList.forEach(function (d) {
      if (d.weather && typeof d.weather.twilight_min === 'number' && d.weather.twilight_min > 0) {
        twi = d.weather.twilight_min;
      }
    });
    // ...AND NOT BEHIND THE CLOCK. What is past is washed (the `past` wash
    // below), and a night drawn under the wash as well was a third, darker
    // band at the head of a morning board: with tonight and tomorrow's
    // evening, "3 nights in the same picture looks weird". The dark begins
    // where the board does, at now.
    var nowM = spec.metro.now_min != null ? spec.metro.now_min : -Infinity;
    darks.forEach(function (span) {
      var f = Math.max(span[0], m0min, nowM), t = Math.min(span[1], m1min);
      if (!(t > f)) return;
      var a0n = f <= m0min ? 0 : spec.scale.at(f), a1n = t >= m1min ? (horizontal ? W : H) : spec.scale.at(t);
      var q0 = xy(a0n, skyBand[0]), q1 = xy(a1n, skyBand[1]);
      var shade = svgEl(doc, 'rect', { x: Math.min(q0[0], q1[0]), y: Math.min(q0[1], q1[1]),
        width: Math.abs(q1[0] - q0[0]), height: Math.abs(q1[1] - q0[1]),
        stroke: 'none', 'fill-opacity': 0.1 });
      shade.style.fill = INK;
      put(shade, 'night');
      // ...and the deep of it, inside the two twilights. A night shorter than
      // two of them is all shoulder, which is what midsummer looks like.
      //
      // ONLY WHERE THE SUN IS ACTUALLY DOING SOMETHING. A shoulder says the
      // sky is changing, and at the far end of a two-day board the night
      // does not end -- the PAPER does. Drawn there anyway it read as a
      // dawn six hours early: "why does the sunup twilight look like that at
      // the end? it shouldn't be there yet". The same at a midnight the
      // forecast stops at, and at a window that opens or closes inside a
      // night. At an end like that the deep runs to the edge and the night
      // is simply cut off, which is what has happened to it.
      // (...and a window that opens or closes inside the night is such an
      // end: the sunset is off the paper, so the deep runs from the edge)
      var d0 = span[2] && f <= span[0] ? Math.max(f, Math.min(t, span[0] + twi)) : f;
      var d1 = span[3] && t >= span[1] ? Math.min(t, Math.max(f, span[1] - twi)) : t;
      if (d1 > d0) {
        var b0 = d0 <= m0min ? 0 : spec.scale.at(d0);
        var b1 = d1 >= m1min ? (horizontal ? W : H) : spec.scale.at(d1);
        var p0 = xy(b0, skyBand[0]), p1 = xy(b1, skyBand[1]);
        var deep = svgEl(doc, 'rect', { x: Math.min(p0[0], p1[0]), y: Math.min(p0[1], p1[1]),
          width: Math.abs(p1[0] - p0[0]), height: Math.abs(p1[1] - p0[1]),
          stroke: 'none', 'fill-opacity': 0.12 });
        deep.style.fill = INK;
        // Its own name, because the two say different things -- "the sky is
        // changing" and "it is dark" -- and anything asking where the night
        // really is has to be able to tell them apart.
        put(deep, 'night-deep');
      }
      nights.push([Math.min(a0n, a1n), Math.max(a0n, a1n)]);
      // NO LINE AT THE EDGE ANY MORE. There was one at each end -- sunset
      // and sunrise, a shade darker than the shade -- put there so the night
      // "has an outline rather than fading in". It fades in on purpose now:
      // the twilight shoulders above ARE the edge, and a hard rule drawn
      // across the front of them says the sky changed at one minute, which
      // is the thing they exist to stop saying. Two marks for one boundary,
      // and they disagreed.
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
    // WHAT IS OVER IS WASHED. Everything before the clock's line goes a shade
    // grey, the way the night does, so the board reads as "this is done,
    // this is coming" from across the room and the eye lands on now without
    // looking for it: "make the now more visible", "focus more on the now
    // and future". A wash and not ink, so nothing written in the past gets
    // harder to read; over the night's own wash it simply deepens.
    var w0 = xy(0, strip ? strip.c1 : fx.c0);
    var past = svgEl(doc, 'rect', { x: Math.min(w0[0], p1[0]), y: Math.min(w0[1], p1[1]),
      width: Math.abs(p1[0] - w0[0]), height: Math.abs(p1[1] - w0[1]),
      stroke: 'none', 'fill-opacity': 0.08 });
    past.style.fill = INK;
    put(past, 'past');
    // ...AND THE LINE ITSELF IS A LINE, not a row of dots: a dotted hairline
    // was one more texture on a board made of textures, and the one mark
    // that says "you are here" was the faintest thing on it.
    // ...IN PIECES AROUND A LINE'S NAME. In the small hours the night is
    // compressed, two hours is a name's width, and the clock's line ran
    // through the roundels at the head ("now line crossing the starting
    // labels shouldn't happen"). The names are HTML above the drawing, but a
    // pill's rounded ends let the line show at its corners, so the line
    // stops a hair short of each name it would cross and picks up again
    // past it.
    // A LITTLE TRAIN ON THE STRIP'S RAIL, where the clock is: the one mark
    // on the board a child reads at once ("more appealing to kids, more
    // cute"). A paper car with ink windows, its wheels on the rail, drawn
    // small enough to sit under the hour labels; it straddles the rail so
    // the wheels are on the paper below the ink panel and read there.
    if (strip && horizontal) {
      // THE TRAIN ITSELF IS SVG REPO'S METRO (svgrepo.com/svg/420587,
      // CC0, the user's pick: "could use this"): a filled silhouette with
      // the windows cut out, drawn in paper on the ink panel, its floor on
      // the strip's rail and its nose the way the day goes. Scaled from
      // the icon's own box (viewBox 1000, the shape from 149 to 853 across
      // and 365 to 636 down) to a height that stops under the clock pill.
      var tq = xy(a, strip.c1 + RAIL_W / 2);
      var train = svgEl(doc, 'g', { 'data-metro-role': 'now-train' });
      var th = 8 * S, tk = th / 271, tw = 704 * tk;
      // (mirrored: the icon's nose is on its left, and the day runs right:
      // "you need to flip the metro around")
      var tb = svgEl(doc, 'path', { d: TRAIN_D, stroke: 'none',
        transform: 'translate(' + (tq[0] + tw / 2 + 149 * tk) + ' ' + (tq[1] + 1 * S - 636 * tk) + ') scale(' + (-tk) + ' ' + tk + ')' });
      tb.style.fill = PAPER;
      train.appendChild(tb);
      trainEl = train;
      svg.appendChild(train);
    }
    // ...and the line starts under the train, not through it
    var cFrom = strip ? strip.c1 + (horizontal ? RAIL_W / 2 + 4 * S : 0) : fx.c0, cTo = fx.c1, runs = [[cFrom, cTo]];
    function cutRuns(g0, g1) {
      var next = [];
      runs.forEach(function (rn) {
        if (g1 <= rn[0] || g0 >= rn[1]) { next.push(rn); return; }
        if (g0 > rn[0]) next.push([rn[0], g0]);
        if (g1 < rn[1]) next.push([g1, rn[1]]);
      });
      runs = next;
    }
    (board.fixed || []).forEach(function (g) {
      if (g.kind !== 'terminus' || !(g.a0 - 2 * S <= a && a <= g.a1 + 2 * S)) return;
      cutRuns(g.c0 - 2 * S, g.c1 + 2 * S);
    });
    // ...AND AROUND EVERY RAIL IT CROSSES, the gap a bar gets: the line is
    // one more thing crossing the tracks ("might as well cut on the tracks
    // as well"), so the rails run over it whole with paper either side.
    board.lines.forEach(function (ln) {
      var rc = ln.cAt(a);
      if (rc == null) return;
      var rw = railStroke(ln, ln.key).width;
      cutRuns(rc - rw / 2 - BRIDGE_CLEAR, rc + rw / 2 + BRIDGE_CLEAR);
    });
    runs.forEach(function (rn) {
      var r0 = xy(a, rn[0]), r1 = xy(a, rn[1]);
      var n = svgEl(doc, 'line', { x1: r0[0], y1: r0[1], x2: r1[0], y2: r1[1],
        'stroke-width': 2 * S });
      n.style.stroke = INK;
      put(n, 'now');
    });
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
              // ...but not a connector that has moved out into the legend's
              // column: there is no ring at the first minute any more, and
              // measured off where it used to be the quiet stretch began a
              // ring's width late, leaving that much of the line's full ink
              // showing between the dotted approach and the grey -- "why does
              // it show the normal track inside the light shared track".
              if (q.tie && q.open0 && edgeTieAt[k] != null) return;
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
          wipe._metroOwner = k;
          away.push(wipe);
          var quiet = svgEl(doc, 'path', { d: dMid, fill: 'none', 'stroke-width': wq,
            'stroke-linecap': 'butt', 'stroke-linejoin': 'round', 'stroke-opacity': 0.42 });
          quiet.style.stroke = inkOf(k);
          quiet._metroOwner = k;
          away.push(quiet);
          var tq = treatment(tr.style, S, wq);
          if (tq) {
            var qov = svgEl(doc, 'path', { d: dMid, fill: 'none', 'stroke-width': tq.core,
              'stroke-linecap': tq.cap, 'stroke-linejoin': 'round', 'stroke-dasharray': tq.dash || null });
            qov.style.stroke = PAPER;
            qov._metroOwner = k;
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

  // EVERY RAIL'S EDGE, UNDER EVERY RAIL. The edges go in one group before
  // the rails, so a spur's edge meets its trunk under the trunk's own fill
  // rather than as a dark notch painted across it. Every rail gets one, on
  // every panel -- under a plain ink rail it is invisible, and a drawing
  // that has the same parts at every bit depth is one the suites can hold
  // still.
  var edgesG = svgEl(doc, 'g', { 'data-metro-role': 'edges' });
  svg.appendChild(edgesG);

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
  // WHAT A RAIL'S FAR SLASH REACHES PAST ITS END, and how far that end has
  // to come in for the slash to sit whole on the paper: the axis ends a pad
  // from the paper's edge and the slash reaches further than the pad, so it
  // was drawn half off the page ("the end of the track isn't on the page
  // properly"). The rail is trimmed by the same amount where it is drawn
  // and the slash is drawn at the trimmed end, so nothing peeks past it.
  function farTrim(ln) {
    if (!horizontal || !ln.pts.length || ln.branchOf) return 0;
    var last = ln.pts[ln.pts.length - 1];
    if (Math.abs(last[0] - spec.axis.a1) > 1) return 0;
    var sw = railStroke(ln, ln.key).width, rr = Math.max(4 * S, sw * 0.7);
    return Math.max(0, spec.axis.a1 + rr + sw * 0.4 - W);
  }
  // A RAIL THAT WAS RUNNING BEFORE THE BOARD OPENED RUNS IN OFF THE PAPER'S
  // EDGE, on a lying board with nothing standing at its head: a line cut by
  // the page is the oldest way a map says "this continues", and the three
  // dots that used to say it were half off the paper themselves ("maybe the
  // early dots don't need to be there").
  var openEnded = {};
  (spec.states || []).forEach(function (st) {
    st.owners.forEach(function (k) {
      var o = openEnded[k] = openEnded[k] || [false, false], e = st.ends || [true, true];
      if (st.timed) return;
      o[0] = o[0] || e[0]; o[1] = o[1] || e[1];
    });
    // (No tie between the owners of a shared state any more: each of their
    // heads carries the badge itself -- see routeRows, day.js.)
  });
  // EVERY rail that is level at the first minute, trunk or shelf, whatever
  // it carried before the board: a chevron, three dots and a half dot at the
  // edge were three ways of saying "this was already going", and the page's
  // edge says it once ("I don't like these starts"). Not past a connector
  // standing at the edge, and not under a name set level at the head.
  var ranOff = {};
  function headRun(ln, lpts) {
    if (!horizontal || lpts.length < 2) return null;
    var trunkKey = ln.branchOf || ln.key;
    if (edgeTieAt[trunkKey] != null || levelHead[trunkKey]) return null;
    if (lpts[0][0] > spec.axis.a0 + 1 || Math.abs(lpts[0][1] - lpts[1][1]) > 0.5) return null;
    ranOff[ln.key] = true;
    return [(spec.axis.edge0 == null ? spec.axis.a0 : spec.axis.edge0) - 12 * S, lpts[0][1]];
  }

  board.lines.forEach(function (ln, li) {
    var lpts = ln.pts;
    if (ln.branchOf && lpts.length) {
      var trunk = board.lineByKey(ln.branchOf);
      var on = trunk ? roundedAt(trunk, lpts[0][0]) : null;
      if (on) lpts = [on].concat(lpts.slice(1));
      // ...AND FROM THE CONNECTOR, where the connector is what it left. The
      // branch for the event the board opened inside starts at the first
      // minute because that is the first minute the board HAS; drawn from
      // there it hangs a ring's width clear of the bar it belongs to, with
      // the dotted approach passing under it.
      if (shelfFrom[ln.key] != null && lpts.length && lpts[0][0] <= spec.axis.a0 + 1) {
        // Off the bar and along: down from its own rail at the connector to
        // the row the shelf runs in, then into the day. Started at the shelf's
        // own row it ran out of the column with nothing above it, which reads
        // as a second line rather than as this one's event.
        var tA = shelfFrom[ln.key];
        var rc = trunk ? trunk.cAt(spec.axis.a0) : lpts[0][1];
        var pre = [[tA, rc]];
        // AT 45, LIKE EVERY OTHER SPUR. Straight down and then along, the
        // drop to a shelf one gap below its rail was too short for the
        // corner to round, and the branch left the connector at a square
        // right angle: "we have to be consistent on our angles". The
        // diagonal is as long as the drop is deep, and no longer than the
        // column it has to happen in.
        var dropC = lpts[0][1] - rc;
        if (Math.abs(dropC) > 1) pre.push([tA + Math.min(Math.abs(dropC), Math.max(1, lpts[0][0] - tA)), lpts[0][1]]);
        lpts = pre.concat(lpts);
      }
    }
    var hr = headRun(ln, lpts);
    if (hr) lpts = [hr].concat(lpts.slice(1));
    var ft = farTrim(ln);
    if (ft > 0 && lpts.length > 1 && Math.abs(lpts[lpts.length - 1][1] - lpts[lpts.length - 2][1]) < 0.5) {
      lpts = lpts.slice();
      lpts[lpts.length - 1] = [lpts[lpts.length - 1][0] - ft, lpts[lpts.length - 1][1]];
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
    var edged = !tube;
    var rail = svgEl(doc, 'path', { d: d, 'stroke-width': tube ? w : w + WIDEN * S - (edged ? 2 * EDGE_W : 0), fill: 'none',
      'stroke-linejoin': 'round',
      // BUTT-ENDED, every rail: a round cap put half the rail's width past its
      // last point, and at the edge that half-disc stuck out behind the start
      // slash -- "start symbol has the line peeking out".
      'stroke-linecap': 'butt' });
    // A SHADED RAIL IS EDGED IN INK. The ladder of greys is what tells five
    // lines apart on a grey panel, and its light end all but vanished on the
    // paper: "should we just outline the tracks, so they are more visible".
    // A hairline of ink round the shade, under it, is how a printed map
    // keeps a pale line readable; the plain ink rail and a 1-bit panel (where
    // every rail is ink already) need none.
    if (edged) {
      var edge = svgEl(doc, 'path', { d: d, 'stroke-width': w + WIDEN * S, fill: 'none',
        'stroke-linejoin': 'round', 'stroke-linecap': 'butt' });
      edge.style.stroke = INK;
      // The edge is the rail's true outline, at the rail's full width, so it
      // carries the rail's role: what asks for a rail's width gets one answer.
      put(edge, ln.branchOf ? 'spur' : 'track', ln.branchOf || ln.key);
      edgesG.appendChild(edge);
    }
    rail.style.stroke = tube ? INK : inkOf(ln.key);
    rail.style.fill = 'none';
    put(rail, edged ? (ln.branchOf ? 'spur-fill' : 'track-fill') : (ln.branchOf ? 'spur' : 'track'), ln.branchOf || ln.key);

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
  // ...AND EACH ONE SAYS WHOSE LINE IT IS. A quiet stretch went out with no
  // owner on it, which is invisible on the board and fatal to a test: a case
  // asking "is anybody drawn quiet inside a corridor" matched nothing, found
  // nothing, and passed. Every other mark carries its line; so does this one.
  away.forEach(function (n) { put(n, 'away', n._metroOwner); });

  // ---- where the day turns over -----------------------------------------
  //
  // A board that runs past midnight is ONE continuous scale, and "09:00" on a
  // thirty-six hour board is two different mornings. The strip names each day
  // where it starts; this is the same fact drawn on the MAP, as the double
  // rule a transit diagram uses for a boundary, so a rail crossing it can be
  // seen to cross it.
  // ...AND NOT ANY MORE. The strip changes panel at the midnight, with the
  // day's name standing on the cut, and the night wash runs across the map
  // under it: the double rule through every rail was the busiest thing left
  // on the board and said nothing the strip was not already saying ("do we
  // even need it?"). Kept behind a switch rather than deleted, with its
  // bridges and tunnels, in case a board without a night ever wants it.
  var MIDNIGHT_RULE = false;
  var days = (spec.metro && spec.metro.days) || [];
  // The cut itself is still a fact worth reading back: an unpainted marker
  // at each midnight, for anything that asks where the day turns.
  if (days.length > 1 && spec.scale && spec.cross) {
    days.forEach(function (d, di) {
      if (!di || d.start_min == null) return;
      var cq0 = xy(spec.scale.at(d.start_min), strip ? strip.c1 : spec.cross.c0), cq1 = xy(spec.scale.at(d.start_min), horizontal ? mapFoot : W);
      var cut = svgEl(doc, 'rect', { x: Math.min(cq0[0], cq1[0]) - 0.5, y: Math.min(cq0[1], cq1[1]),
        width: Math.abs(cq1[0] - cq0[0]) + 1, height: Math.abs(cq1[1] - cq0[1]), fill: 'none', stroke: 'none' });
      put(cut, 'midnight-cut');
      // (no gap of paper between the panels any more: both are paper, and
      // the rail along the strip's foot runs through the midnight whole)
    });
  }
  if (MIDNIGHT_RULE && days.length > 1 && spec.scale && spec.cross) {
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
        xings.push({ ln: ln, rc: rc, rw: rw, across: across, clear: across ? 2 * S : BRIDGE_CLEAR });
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
  // Whose name is set LEVEL with its rail rather than in the row beside it:
  // there the gutter is the name's own lane and nothing else may use it.
  var nameLevel = {};
  ((spec.fixed || [])).forEach(function (fx) {
    if (fx.kind === 'terminus' && fx.level && fx.line) nameLevel[fx.line] = true;
  });
  function cut(pl, end) {
    (pl.lines || []).forEach(function (k) { (uncapped[k] = uncapped[k] || [])[end] = true; });
  }
  // A branch's own event, by the rail key the solver gave it: open0 and open1
  // are the transform's answer to "does this run past the window", which is
  // what the three dots are for.
  var branchOpen = {};
  (spec.wants || []).forEach(function (w) {
    if (w._rail) branchOpen[w._rail] = [!!w.open0, !!w.open1];
  });
  var edgeDots = {};  // line -> its "..." has moved inside, past the edge ring
  var tiedAt = {};   // line -> [a]: a ring already marks this minute
  // WHOSE RING IT IS, IN LETTERS. "Put small inline initials directly inside
  // the event nodes, so she doesn't have to follow line patterns to figure
  // out whose turn it is for taxi duty": on a full view each ring of a shared
  // event carries its person's initial -- two letters where two people start
  // with the same one. A slot keeps its rings plain.
  // (the ring letters, from the one place that spells them: board.js)
  var initials = B.initialsFor((spec.metro && spec.metro.legend) || []);
  var ringFace = null;
  function initialIn(q, k, scale) {
    if (spec.oneName || !initials[k]) return;
    scale = scale == null ? 1 : scale;
    var txt = initials[k], two = txt.length > 1;
    var t = svgEl(doc, 'text', { x: q[0], y: q[1] });
    // the size as a style property: the template's linter counts the
    // hyphenated names of a few CSS properties anywhere in the markup
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('dominant-baseline', 'central');
    t.style.fontSize = (NODE_R * (two ? 1.2 : 1.55) * scale) + 'px';
    t.style.fontWeight = '700';
    // ...tracked like the name it stands for, and the two letters need it
    // more than most: a pair of capitals set tight is one wide glyph.
    if (two) t.style.letterSpacing = (NODE_R * 0.08 * scale) + 'px';
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
      // ...AND IT IS DRAWN BEFORE THE FIRST MINUTE, WHERE IT HAPPENED.
      //
      // "Move the left connector to the left. Dotted tracks between the
      // connectors and enough space for the track name above/below the
      // dotted lines."
      //
      // The event was already running when the board opened, so the meeting
      // it draws is not at the first minute -- it is off the left of the
      // paper, and the board has a column there now for the legend. Set at
      // the first minute the connector stood ON the day and the morning
      // began with a bar across it; set at the paper's edge it stands in the
      // time before the board, where it belongs, and what joins it to the
      // day is the approach below. The column has to be able to hold it: a
      // lettered ring and a step, or it stays where it was.
      var eMove = atEdge && edgeTieAt[(pl.lines || [])[0]] != null;
      var tieA = eMove ? edgeTieAt[pl.lines[0]] : pl.a;
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
        // SMALLER THAN A CROSSING'S RING. An edge ring is not an interchange
        // in the middle of the board, it is a note at the edge saying these
        // three were already together, and at a crossing's full size it sat
        // in the gutter like the main event of that corner and pushed every
        // name out past the dots. Three quarters of one reads as the same
        // mark, quieter, and gives the row above it back to the names.
        var eR = edgeRing(S), eRingR = eR.r, eGap = eR.gap;
        var eDr = Math.max(1.2 * S, RAIL_W * 0.42);
        // WHICH SIDE OF THE RING THE DOTS GO, WHICH IS WHERE THE PAPER IS.
        //
        // They were put past the ring, between it and the track: "the 3 dots
        // go between the Hollow Dot with letter and the track", said of a
        // board whose first minute was its first pixel, where past the ring
        // was the only side there was. A board with a legend column has the
        // other side, and that side is the one the dots MEAN -- they say the
        // event was already running before the board opened, which is what
        // the column is: the time before the first minute. Put there they
        // cost the morning nothing and the column stops being blank paper.
        // As many as it holds, at their own spacing, rather than three.
        var eLane = pl.a - eRingR - (spec.axis.edge0 == null ? pl.a : spec.axis.edge0);
        var eBack = !eMove && eLane > eGap * 3 + eDr;
        var eFrom = eBack ? pl.a + eRingR : pl.a + eRingR + eGap * 4;
        members.forEach(function (k5) {
          var l5 = board.lineByKey(k5);
          if (!l5) return;
          // The rail's own ink pulled back off the ring and the dots, so they
          // stand on paper rather than on top of the line they belong to.
          edgeDots[k5] = true;
          // (RIGHT NEXT TO THE CONNECTOR is where the name goes -- past the
          // ring, not past the dots, because a name sits a row above its rail
          // and the dots are never in its way. bands.js books it there, from
          // `edgeRing` above: the reach is this function's to state and the
          // solver's to defend.)
          var w5 = railStroke(l5, k5).width + 1.2 * S;
          var c5 = l5.cAt(pl.a);
          if (c5 == null) return;
          // MOVED OUT, THE APPROACH IS THE MARK. A dotted run at the rail's
          // own level from the ring to the first minute: the reader follows
          // the line out of the connector, across the time the board does
          // not show, and into the day where its ink begins. The three dots
          // said the same thing in three marks; this says it in the shape of
          // a track, which is what the column had room for all along. The
          // name sits in the row beside it, as it does over any rail.
          if (eMove) {
            var a5 = xy(tieA + eRingR, c5), b5 = xy(pl.a, c5);
            var lead5 = svgEl(doc, 'line', { x1: a5[0], y1: a5[1], x2: b5[0], y2: b5[1],
              'stroke-width': Math.max(1.6 * S, RAIL_W * 0.84), 'stroke-linecap': 'round',
              'stroke-dasharray': '0.1 ' + (eGap * 0.92) });
            lead5.style.stroke = inkOf(k5);
            put(lead5, 'terminal-more', k5);
            return;
          }
          var p5 = xy(pl.a - eRingR, c5), q5 = xy(eFrom, c5);
          var wipe5 = svgEl(doc, 'line', { x1: p5[0], y1: p5[1], x2: q5[0], y2: q5[1],
            'stroke-width': w5, 'stroke-linecap': 'butt' });
          wipe5.style.stroke = PAPER;
          put(wipe5, 'edge-clear', k5);
          // ...and never through a name set LEVEL with its rail, which is
          // what the column holds on a flat slot.
          var eN = eBack && !nameLevel[k5] ? Math.max(3, Math.floor((eLane - eDr) / eGap)) : 3;
          var eDir = eBack && !nameLevel[k5] ? -1 : 1;
          for (var d5 = 1; d5 <= eN; d5++) {
            var t5 = xy(pl.a + eDir * (eRingR + eGap * d5), c5);
            var dot5 = svgEl(doc, 'circle', { cx: t5[0], cy: t5[1], r: eDr, stroke: 'none' });
            dot5.style.fill = inkOf(k5);
            put(dot5, 'terminal-more', k5);
            edgeFill(dot5, 'terminal-more');
          }
        });
        // The bar itself, solid and the same weight as any other.
        bar(tieA, pl.c0, pl.c1, pl.id, capGaps(pl));
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
        // A FULL RAIL GAP OF PAPER UNDER THE RAIL, measured off that rail's
        // own weight rather than guessed: a bar's depth from the line's
        // centre left about three units of white between the two and they
        // read as one thick thing -- "its too close to the other track".
        var shHalf = 0;
        members.forEach(function (k6) {
          var l6 = board.lineByKey(k6);
          if (l6) shHalf = Math.max(shHalf, railStroke(l6, k6).width / 2);
        });
        // UNDER THE LOWEST MEMBER, where the event's own name usually is, so
        // the two read together. Only where the paper there is clear: the
        // solver books none for this, so a shelf that would cross a caption
        // is not drawn. Measured on the demo days at five times of day across
        // six views, sixteen boards want a shelf and sixteen get one, so the
        // guard costs nothing in practice; an "if it does not fit below, try
        // above" fallback was written, measured at the same sixteen, and
        // dropped as a path nothing reaches.
        var shC = pl.c1 + shHalf + LINE_GAP + TUBE_W / 2;
        if (shTo != null && shTo > pl.a + NODE_R * 3) {
          var shClear = (board.caps || []).every(function (cp3) {
            var cb3 = cp3.box();
            return !(cb3.a0 < shTo + NODE_R && cb3.a1 > pl.a - NODE_R
                     && cb3.c0 < shC + BAR_W * 0.5 + 1 * S && cb3.c1 > shC - BAR_W * 0.5 - 1 * S);
          });
          if (shClear) {
            var shD = 'M ' + xy(tieA, pl.c1).join(' ') + ' L ' + xy(tieA, shC).join(' ')
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
          gaps.push([x.c - rw / 2 - BRIDGE_CLEAR, x.c + rw / 2 + BRIDGE_CLEAR]);
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
          // ...unless the end is INSIDE a quiet stretch of this rail. At the
          // stretch's own end the tick is the mark rule 25a asks for, and
          // without it a four-way swim had no end at all ("where is the
          // branch for zwemmen"): the rail simply went dark again.
          if ((quietOn[k] || []).some(function (r2) { return end.to > r2[0] + NODE_R && end.to < r2[1] - NODE_R; })) return;
          var half = Math.max(NODE_R * 1.05, railStroke(ln2, k).width * 1.25);
          markLine(xy(end.to, c2 - half), xy(end.to, c2 + half), ln2, k, 'stop');
        });
      });
      members.forEach(function (k) {
        var ln = board.lineByKey(k);
        var c = ln ? ln.cAt(pl.a) : null;
        if (c == null) return;
        var q = xy(tieA, c);
        var lettered = !spec.oneName && initials[k];
        var rr = NODE_R * (lettered ? 1.4 : 1) * (atEdge ? EDGE_RING : 1);
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
        if (lettered) initialIn(q, k, atEdge ? EDGE_RING : 1);
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
    // ...NOT AT THE HEAD OF A LYING BOARD, where nothing marks a start any
    // more: the pair's rails run in from the edge or from their roundels.
    if (pl.open0 && pa0 <= axisA0 + 1) { if (!horizontal) halfDiamond(axisA0, pl.c0, pl.c1, 1, pl.id); cut(pl, 0); }
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
    st = { line: st.line, a: on[0], c: on[1], kind: st.kind, todo: st.todo, done: st.done };
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
      // A MOMENT GETS ONE MARK (rule 28): its dot is its end, so no tick on
      // the same minute.
      if (board.stops.some(function (o) { return o.kind === 'start' && o.line === st.line && Math.abs(o.a - st.a) < 1; })) return;
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
    // A BRANCH THAT LEAVES A CONNECTOR IN THE COLUMN did not arrive from off
    // the paper at the first minute: it is drawn coming out of the bar, the
    // whole way. Its half dot and the dotted drop to its trunk were saying
    // "this came in from the left edge" halfway along a line that visibly
    // did, which is two marks for a fact the shape already states.
    if (st.kind === 'from') {
      var ownB = board.lineByKey(st.line);
      if (ownB && ownB.branchOf && shelfFrom[ownB.key] != null
          && Math.abs(st.a - spec.axis.a0) < NODE_R) return;
    }
    if (st.kind === 'from') {
      // (a shelf that runs in off the paper's edge needs no half dot: the
      // edge says it; the dotted drop that ties it to its rail stays)
      var offPaper = !!ranOff[st.line];
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
      if (offPaper) return;
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
      edgeMark(arc, st.line, 'stop-from');
      return;
    }
    // A TASK IS A SQUARE: "use a square for todos". A dot says something
    // happens here; a square says something is to be done by now.
    var dot = st.todo
      ? svgEl(doc, 'rect', { x: p[0] - r * 0.9, y: p[1] - r * 0.9, width: r * 1.8, height: r * 1.8,
          'stroke-width': NODE_STROKE * 0.8 })
      : svgEl(doc, 'circle', { cx: p[0], cy: p[1], r: r, 'stroke-width': NODE_STROKE * 0.8 });
    // TICKED: a task done today keeps its square and has it filled in, the
    // way a box is ticked off (rule 2q).
    var dotFill = st.todo && st.done ? INK : PAPER;
    dot.style.stroke = inkOf(st.line); dot.style.fill = dotFill;
    put(dot, 'stop-start', st.line);
    edgeMark(dot, st.line, 'stop-start', dotFill);
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
  board.lines.forEach(function (ln) {
    if (ln.pts.length < 2) return;
    // A BRANCH CUT BY THE PAPER SAYS SO THE WAY A RAIL DOES.
    //
    // A branch takes none of the end marks below: no slash, because it does
    // not end, it rejoins; no arrow, because it is not a line whose whole day
    // is a slice of something longer. That was read as "a branch needs no end
    // mark", and the dots went with them. But the dots are not an end mark.
    // They say the paper ran out, which is a fact about the BOARD and is just
    // as true of a branch: Bart's rail said "there was more before this" with
    // three dots while his Field Trip, one row above it and cut at the same
    // minute, said it with a half mark pressed against the edge. Two marks
    // for one fact, side by side.
    //
    // The half mark stays. It stands in for the slash, and the note above the
    // slash below says so in as many words: "a half mark at the edge stands
    // in for the slash, but not for the dots".
    if (ln.branchOf) {
      // WHAT THE PAYLOAD SAYS, CONFIRMED BY WHERE THE BRANCH ENDS. An event
      // carries open0 and open1 from the transform, which set them by
      // comparing its own minutes to the window's: that is the board saying
      // "there was more of this than fits", and it is the fact the dots
      // report. The geometry alone was a guess that happened to hold -- a
      // branch beginning at the board's very first minute of its own accord
      // would have been given dots it had no right to.
      var bOpen = branchOpen[ln.key] || [false, false];
      [ln.pts[0], ln.pts[ln.pts.length - 1]].forEach(function (p, end) {
        if (!bOpen[end]) return;
        // (not where the branch now runs on out of a connector in the
        // column: those dots were left standing halfway along it)
        if (!end && shelfFrom[ln.key] != null && Math.abs(p[0] - axisA0) <= 1) return;
        // ...AND CUT HERE. The payload says the event runs past the window;
        // this says the branch drawn for it really does reach the paper's
        // edge, so the dots are put where the ink stops.
        if (Math.abs(p[0] - (end ? axisA1 : axisA0)) > 1) return;
        if (!end && nameLevel[ln.branchOf]) return;   // the roundel is the head (see the trunk's case)
        var bDir = end ? 1 : -1;
        var bGap = Math.max(RAIL_W * 1.3, 2.6 * S), bR = Math.max(1.2 * S, RAIL_W * 0.42);
        for (var bi = 1; bi <= 3; bi++) {
          var bq = xy(p[0] + bDir * bGap * bi, p[1]);
          var bd = svgEl(doc, 'circle', { cx: bq[0], cy: bq[1], r: bR, stroke: 'none' });
          bd.style.fill = inkOf(ln.branchOf);
          put(bd, 'terminal-more', ln.key);
        }
      });
      return;
    }
    var r = 4 * S, w = Math.max(2 * S, (ln.width || 3) * S);
    [ln.pts[0], ln.pts[ln.pts.length - 1]].forEach(function (p, end) {
      if (!end && ranOff[ln.key]) return;
      // A NAME SET LEVEL AT THE HEAD IS THE HEAD: the roundel is the line's
      // terminus, and dots or an arrow after it were a second start mark.
      if (!end && nameLevel[ln.key]) return;
      if (end) { var ftE = farTrim(ln); if (ftE > 0) p = [p[0] - ftE, p[1]]; }
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
        // ...AND AT THE LEADING END THEY RUN THE WHOLE GUTTER: "have the dots
        // extend across the gutter", "as many as needed instead of just 3".
        // Where the legend has taken a column off the day (nameRoom, day.js)
        // the rail's own row in it is empty paper, and three dots pressed
        // against the first minute are three dots with a hole beside them.
        // They keep their own spacing and there are as many as the column
        // holds, so the line arrives out of the gutter rather than starting
        // in it. Where there is no column -- which is most boards -- there
        // is room for three and three is what is drawn.
        var lane = axisA0 - (spec.axis.edge0 == null ? axisA0 : spec.axis.edge0);
        var dots = 3;
        if (!end && !nameLevel[ln.key]) dots = Math.max(3, Math.floor((lane - dr) / gapD));
        for (var di2 = 1; di2 <= dots; di2++) {
          var q = xy(p[0] + dir * gapD * di2, p[1]);
          var dot = svgEl(doc, 'circle', { cx: q[0], cy: q[1], r: dr, stroke: 'none' });
          dot.style.fill = inkOf(ln.key);
          put(dot, 'terminal-more', ln.key);
          edgeFill(dot, 'terminal-more');
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
        // ...AND AT THE LEADING END, OUT AT THE PAPER'S EDGE WHERE THERE IS A
        // COLUMN: "why aren't the top lines going to the left of the page".
        // Every other line that began before the board -- a trunk that ran on
        // past the edge, a connector that predates it -- now reaches the
        // paper's edge across the legend's column; a line whose day is a
        // slice of something longer stopped at the first minute with its
        // arrow, a column's width short of the rest. The arrow goes to the
        // edge, and a dotted approach in the line's own ink carries it to
        // the first minute, the same approach the connector's lines take.
        var colEdge = spec.axis.edge0 == null ? p[0] : spec.axis.edge0;
        if (!end && !nameLevel[ln.key] && p[0] - colEdge > cvo.out * 2 + r2 * 3) {
          var eGp = edgeRing(S).gap;
          var tipAt = colEdge, baseAt = tipAt + cvo.out;
          var la = xy(baseAt + r2 * 0.5, p[1]), lb = xy(p[0], p[1]);
          var lead = svgEl(doc, 'line', { x1: la[0], y1: la[1], x2: lb[0], y2: lb[1],
            'stroke-width': Math.max(1.6 * S, RAIL_W * 0.84), 'stroke-linecap': 'round',
            'stroke-dasharray': '0.1 ' + (eGp * 0.92) });
          lead.style.stroke = inkOf(ln.key);
          put(lead, 'terminal-more', ln.key);
          ahead = tipAt;
        }
        var base = ahead - dir * r2;
        var t0 = xy(base, p[1] - r2), tip = xy(ahead, p[1]), t1 = xy(base, p[1] + r2);
        var ch = svgEl(doc, 'path', { d: 'M ' + t0[0] + ' ' + t0[1] + ' L ' + tip[0] + ' ' + tip[1]
          + ' L ' + t1[0] + ' ' + t1[1] + ' Z', stroke: 'none' });
        ch.style.fill = inkOf(ln.key);
        put(ch, 'terminal-open', ln.key);
        edgeFill(ch, 'terminal-open');
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
      // (0.7 of the width: at 0.9 the heavier rail's slash reached the name
      // set a row above it)
      var sw = railStroke(ln, ln.key).width, rr = Math.max(r, sw * 0.7);
      // EVERY SLASH STANDS IN A GAP. Drawn in the rail's own ink at nearly
      // its weight, a solid rail's slash fused with the end into one
      // arrow-shaped blob ("something feels off"); a shaded or hollow rail's
      // read because its own core parts it, so only the solid ones were cut
      // back -- and the ends then did not match ("some terminators have a
      // little space around, it's cool, but they should all have it"). Every
      // rail is cut back a hair either side of its slash now.
      // IN THE GROUND'S OWN COLOUR, not in white: the cut is paper, and the
      // washes that say what is past and what is night are drawn OVER the
      // map (see below), so a cut on a washed stretch takes the wash with
      // everything else on it rather than punching a white hole in it.
      {
        var hg = Math.max(1.5 * S, sw * 0.35), hl = rr + hg;
        var h0 = xy(p[0] - hl, p[1] + hl), h1 = xy(p[0] + hl, p[1] - hl);
        var halo = svgEl(doc, 'line', { x1: h0[0], y1: h0[1], x2: h1[0], y2: h1[1],
          'stroke-width': sw * 0.8 + 2 * hg, 'stroke-linecap': 'butt' });
        halo.style.stroke = PAPER;
        put(halo, 'terminal-halo', ln.key);
      }
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
      // (two rows that only touch are two rows: a forecast whose foot and an
      // hour's head met at a fraction of a pixel took "20:00" off the strip)
      if (r.length > 3 && t.length > 3 && !(r[2] < t[3] - 1 && t[2] < r[3] - 1)) return false;
      return true;
    });
  }

  var hoursFx = null, notes = [], dayBadges = [];
  // The sky row is a band of its own UNDER the rail (see the band below),
  // so the hours are set from the strip's foot as they always were.
  var SKY_ROW = 0;
  // THE STRIP'S WORDS A SIZE UP ON A FULL VIEW, with the titles: "header bar
  // could also increase in font size in that case". A slot and a standing
  // board keep the small size their column and rows are measured for.
  var STRIP_SM = !spec.oneName && horizontal ? '' : ' label--small';
  function titleBand() {
    var above = hoursFx ? hoursFx.c1 - SKY_ROW - RAIL_ROW - rowH - 8 : 0;
    return horizontal && above >= rowH * 1.6 ? above : 0;
  }
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

  // THE CLOCK, AS A BADGE ON THE SCALE. A solid-ink pill, so "now" is the one
  // time on the strip that is stated rather than annotated. Asked after the
  // date, which wants the same corner on a board read early in its own
  // window: the hour ticks already say what time it is to within the step,
  // and a refresh moves the clock clear by itself, whereas nothing else
  // anywhere says which day this is.
  function askClock() {
    if (!(nowFx && hoursFx && ctx.clock && spec.metro && spec.metro.now_min != null)) return;
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
    var cRow = horizontal ? Math.min(hoursFx.c1 - SKY_ROW - rowH / 2, hoursFx.c1 - SKY_ROW - pill.offsetHeight / 2 - 1) - RAIL_ROW
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
  // THE STRIP'S FURNITURE IN TWO PASSES: the dates, then the clock (askClock
  // below), then everything else. Whatever is placed first takes its room
  // and the rest give way, and the clock came after the forecast: at ten in
  // the morning the pill stood under "22°/16°C" and was the one dropped,
  // the strip saying the temperature and not the time. The clock has first
  // claim on the hours row (rule 2d); only the date, which nothing else on
  // the board says, is asked before it.
  function stripFixture(fx, pass) {
    if ((fx.kind === 'date') !== (pass === 0)) return;
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
      var above = hoursFx ? hoursFx.c1 - SKY_ROW - RAIL_ROW - rowH - 8 : 0;
      var titleRoom = horizontal && above >= rowH * 1.6 ? above : 0;
      var hol = null;
      ((spec.metro && spec.metro.holidays) || []).forEach(function (hd) {
        if (!hol && (hd.day || 0) === dayIx) hol = hd;
      });
      // No badge longer than a third of the scale, or past the midnight
      // that ends its day.
      // (a little more of it where the strip's words are a size up)
      // ...OF THE STRIP, WHICH IS THE PAPER'S WIDTH AND NOT THE DAY'S. The
      // legend's column comes off the axis, and measured against the axis the
      // badge lost a tenth of its room to a column it does not stand in: the
      // strip runs the whole panel, over the column and all.
      var stripRun = spec.axis.a1 - (spec.axis.edge0 == null ? spec.axis.a0 : spec.axis.edge0);
      var room = stripRun / (STRIP_SM ? 3 : 2.4);
      var dd = ((spec.metro && spec.metro.days) || [])[dayIx];
      if (dd && spec.scale) room = Math.min(room, spec.scale.at(Math.min(dd.end_min, spec.metro.day_end_min)) - fx.a0);
      // ...and on today's panel the title row runs on over the slope, so a
      // badge squeezed at the midnight may use that too (see slantAt).
      if (dayIx === 0 && slantW) room += slantAt(rowH * 1.6 + 4 * S);
      // ...and on tomorrow's panel the same slope covers the start of the
      // title row: the badge is measured against what is left of its day
      // past the ink ("Tomorrow" chosen at full size and pulled back under
      // the slope read "orrow"). Where its top would be, per form, since a
      // title is taller than a tag.
      var multiDay = ((spec.metro && spec.metro.days) || []).length > 1;
      function badgeCOf(b) {
        var bc = titleRoom ? titleRoom / 2 + 2 : c;
        if (titleRoom && multiDay) bc = Math.max(b.offsetHeight / 2 + 4 * S, (titleRoom - rowH - 4) / 2 + 2);
        return bc;
      }
      function slopeOver(b) {
        return dayIx === 1 && slantW && horizontal ? slantAt(badgeCOf(b) - b.offsetHeight / 2) : 0;
      }
      var forms0 = hol ? (hol.day_label ? [2, 1, 0] : [1, 0]) : [0];
      // THE TITLE GIVES WAY FIRST: "Today" is the one part of the badge the
      // strip already says elsewhere (the clock is on it), so a squeezed badge
      // loses the word before it loses which day of a holiday this is.
      var wantTitle = titleRoom && spec.metro && spec.metro.now_min != null && dayIx <= 1;
      // ...AND THE DATE STEPS UP WHEN THE TITLE HAS GONE. Without "Today"
      // in front of it the small outlined date was "like a secondary label
      // without a primary one": on a panel too narrow for both, the date is
      // set in the title's own size, and only then, narrower still, as the
      // tag.
      var forms = [], mode = [];
      forms0.forEach(function (fm) {
        if (wantTitle) { forms.push(fm); mode.push('title'); forms.push(fm); mode.push('big'); }
        forms.push(fm); mode.push('pill');
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
        if (mode[fi] === 'title') {
          var tt = doc.createElement('span');
          // a word's space from the date: "Today and the date too pushed together"
          tt.className = 'metro-today value value--small text--bold mr--3';
          var i18n2 = spec.metro.i18n || {};
          tt.textContent = dayIx ? (i18n2.tomorrow || 'Tomorrow') : (i18n2.today || 'Today');
          badge.appendChild(tt);
        }
        var d = doc.createElement('span');
        // an outlined tag on every day, so the clock's solid pill is the one
        // solid mark on the strip; small beside a title, the strip's size alone
        d.className = mode[fi] === 'big' ? 'metro-today metro-date value value--small text--bold'
          : 'metro-axis-note metro-date metro-pill metro-pill--quiet' + (mode[fi] === 'title' ? ' label label--small' : ' label' + STRIP_SM) + ' text--bold';
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
        if (blen + slopeOver(badge) <= room || fi === forms.length - 1) break;
      }
      // ON A BOARD OF DAYS, THE TOP ROW OF THE BAND: the forecast has the row
      // under it, and a badge centred on both left a strip of empty ink over
      // it and no room for the forecast of a short day beside it.
      var badgeC = badgeCOf(badge);
      // ON THE ROUNDELS' LEFT EDGE. The day's title is the first thing read
      // and the line names are the column under it; set thirty pixels
      // further in than them it floated. A later day's title stands in from
      // the midnight it opens on, as before.
      var titleA = dayIx ? fx.a0 + 10 * S + slopeOver(badge)
        : (spec.axis.edge0 == null ? fx.a0 + 10 * S : spec.axis.edge0 + 2 * S);
      var br = place(badge, titleA, badgeC, "left");
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
      var wxEnd = fx.a1 - 4 * S + (di === 0 && panels.length > 1 && panels[0].inverse ? slantAt(fx.c1) : 0);
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
        // ON THE HIGH ONLY: it is the headline number and the low sits under
        // it in the same reading, so the scale is said once. See day.js for
        // the one-row form, which puts it after the low for the same reason.
        hi.textContent = Math.round(wx.hi) + '\u00b0'
          + (wx.unit || (spec.metro.header_weather && spec.metro.header_weather.unit) || '');
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
      // THE SHORT DAY'S FORECAST IS SET LIKE THE LONG DAY'S: the high as a
      // headline number, the low and the sky after it in the strip's type.
      // As one line of small print under a title-sized "Today" it was the
      // one thing in the header nobody could read from across the room,
      // while tomorrow's, a panel away, was the biggest thing on it.
      if (richRoom && wx && wx.hi != null) {
        if (ic) { ic.style.width = Math.round(rowH * 1.35) + 'px'; ic.style.height = Math.round(rowH * 1.35) + 'px'; }
        var hi1 = doc.createElement('span');
        hi1.className = 'metro-wx-hi label' + STRIP_SM + ' text--bold text-stroke';
        hi1.style.fontSize = '1.35em';
        hi1.textContent = Math.round(wx.hi) + '\u00b0'
          + (wx.unit || (spec.metro.header_weather && spec.metro.header_weather.unit) || '');
        box.appendChild(hi1);
        var rest = doc.createElement('span');
        rest.className = 'metro-hour label' + STRIP_SM + ' text--bold text-stroke' + QUIET;
        var rain1 = wx.rain_chance >= 30 ? wx.rain_chance + '%' : null;
        rest.textContent = [Math.round(wx.lo) + '\u00b0', wx.condition, rain1].filter(Boolean).join(' \u00b7 ');
        box.appendChild(rest);
      } else {
        var tx = doc.createElement('span');
        tx.className = 'metro-hour label' + STRIP_SM + ' text--bold text-stroke';
        tx.textContent = fx.text;
        box.appendChild(tx);
      }
      canvas.appendChild(box);
      // Standing up the forecast is a sentence at the column's far end, and
      // level it ran across the last line's name.
      turn(box);
      // ON THE TITLE'S OWN ROW FIRST, at the day's end. Under the date the
      // one-line forecast stood on the hours row and took its labels with it
      // ("22\u00b0/16\u00b0C" cost a morning its 08:00 and its clock; tomorrow's
      // cost it every label before four). Beside the title it costs the
      // strip nothing it was using.
      // The one line of small print, where the headline form will not fit.
      function smallPrint() {
        while (box.lastChild && box.lastChild !== ic) box.removeChild(box.lastChild);
        if (ic) { ic.style.width = rowH + 'px'; ic.style.height = rowH + 'px'; }
        var tx2 = doc.createElement('span');
        tx2.className = 'metro-hour label' + STRIP_SM + ' text--bold text-stroke';
        tx2.textContent = fx.text;
        box.appendChild(tx2);
      }
      var rc = null, onTitleRow = false;
      if (dayBadges[di] && dayBadges[di].band) {
        var rowC = (dayBadges[di].r[2] + dayBadges[di].r[3]) / 2;
        var onRow = place(box, wxEnd, rowC, 'right');
        // (the headline form first, then the small print, before the row
        // under the date is even considered)
        if (!fitsDay(onRow) && box.querySelector('.metro-wx-hi')) { smallPrint(); onRow = place(box, wxEnd, rowC, 'right'); }
        if (fitsDay(onRow)) { rc = onRow; onTitleRow = true; }
      }
      if (!rc) rc = underDate ? place(box, underDate[0], c, 'left') : place(box, wxEnd, c, 'right');
      if (!onTitleRow && underDate && !(rc[1] <= wxEnd && fitsDay(rc))) rc = place(box, wxEnd, c, 'right');
      // ...and where the headline form is still too wide for its day, the
      // one line of small print, which is better than no forecast at all.
      if (!fitsDay(rc) && box.querySelector('.metro-wx-hi')) {
        smallPrint();
        rc = underDate ? place(box, underDate[0], c, 'left') : place(box, wxEnd, c, 'right');
        if (underDate && !(rc[1] <= wxEnd && fitsDay(rc))) rc = place(box, wxEnd, c, 'right');
      }
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
      if (fx.icon) {
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
      // (the moon excepted: it belongs to the midnight and stands on it)
      if (!/wi-moon/.test(fx.icon || '')) (spec.cuts || []).forEach(function (cut) {
        if (fx.a0 < cut && skyA + skyLen > cut - 4) skyA = cut - 4 - skyLen;
      });
      // (a rail's width down: the strip's rail runs along the top of this row)
      place(sky, skyA, fx.c0 + (horizontal ? sky.offsetHeight : sky.offsetWidth) / 2 + (horizontal && strip ? RAIL_W : 0), 'left');
      return;
    }
    if (fx.kind === 'rain') {
      // WHILE IT RAINS, THE ROW RAINS ("rain as a stretch, not a point", "if
      // you can make it look very nice"): a trail of little drops under the
      // time line from the glyph that says it starts to the one that says it
      // stops, a drop every so often and every other one a little lower, the
      // way rain falls on a window. Clear of every glyph in the row and of
      // the clock's line, so the icons stay the statements and the drops
      // only say how long.
      if (!horizontal) return;
      var rH = Math.max(5 * S, (fx.c1 - fx.c0) * 0.42), rStep = Math.max(7 * S, rH * 1.25);
      // (on the glyphs' own line: they stand a rail's width under the strip)
      var rMid = fx.c0 + (strip ? RAIL_W : 0) + rowH / 2 + 1 * S;
      var keepOff = (board.fixed || []).filter(function (g) { return g.kind === 'sky' || g.kind === 'now'; })
        .map(function (g) { return [g.a0 - rH * 0.5 - 2 * S, g.a1 + rH * 0.5 + 2 * S]; });
      var group = svgEl(doc, 'g', { 'data-metro-role': 'rain' });
      var n = Math.floor((fx.a1 - fx.a0) / rStep), drops = 0;
      var start = fx.a0 + ((fx.a1 - fx.a0) - n * rStep) / 2;
      for (var ri = 0; ri <= n; ri++) {
        var ra = start + ri * rStep;
        if (keepOff.some(function (k) { return ra > k[0] && ra < k[1]; })) continue;
        var rc = rMid + (ri % 2 ? 0.18 : -0.18) * rH;
        var q = xy(ra, rc), hh = rH / 2, ww = rH * 0.36;
        // a teardrop: a point at the top, round at the bottom
        var dp = svgEl(doc, 'path', { d: 'M' + q[0] + ' ' + (q[1] - hh)
          + ' C' + (q[0] + ww * 0.35) + ' ' + (q[1] - hh * 0.35) + ' ' + (q[0] + ww) + ' ' + (q[1] + hh * 0.05) + ' ' + (q[0] + ww) + ' ' + (q[1] + hh * 0.4)
          + ' A' + ww + ' ' + ww + ' 0 0 1 ' + (q[0] - ww) + ' ' + (q[1] + hh * 0.4)
          + ' C' + (q[0] - ww) + ' ' + (q[1] + hh * 0.05) + ' ' + (q[0] - ww * 0.35) + ' ' + (q[1] - hh * 0.35) + ' ' + q[0] + ' ' + (q[1] - hh) + 'Z',
          stroke: 'none' });
        dp.style.fill = INK;
        group.appendChild(dp);
        drops++;
      }
      if (drops) { group.setAttribute('data-metro-drops', drops); svg.appendChild(group); }
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
    if (fx.kind === 'terminus' && fx.tasks && fx.tasks.length) {
      // WHAT THIS PERSON STILL OWES, ACROSS THE RAIL FROM THEIR NAME ("if
      // the track label is above the track, the todo's could be below"):
      // a tick box and the words, a row each, in the box bands.js booked
      // on the other side of the rail (rule 2q). Ticked where it was done
      // today, and struck through.
      var tk = doc.createElement('div');
      tk.className = 'metro-gen metro-tasks flex flex--col flex--left gap--none absolute';
      fx.tasks.forEach(function (t) {
        var row1 = doc.createElement('div');
        row1.className = 'metro-task flex flex--row flex--center-y gap--xsmall';
        var z = Math.round(rowH * 0.78);
        var sv = svgEl(doc, 'svg', { viewBox: '0 0 16 16', 'class': 'metro-task-box flex-none', 'aria-hidden': 'true' });
        sv.style.width = z + 'px'; sv.style.height = z + 'px';
        sv.appendChild(svgEl(doc, 'rect', { x: 2.2, y: 2.2, width: 11.6, height: 11.6, rx: 3,
          fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6 }));
        if (t.done) sv.appendChild(svgEl(doc, 'path', { d: 'M4.8 8.4 7.2 10.9 11.6 5.4', fill: 'none',
          stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
        row1.appendChild(sv);
        var w1 = doc.createElement('span');
        w1.className = 'metro-task-text label label--small text--bold' + (t.done ? ' metro-task-done' + QUIET : '');
        // ONE LINE, CUT BY THE FRAMEWORK'S OWN CLAMP, and never wider than
        // the box the solver booked: a long chore wrapped to a second row
        // nobody had reserved.
        w1.setAttribute('data-clamp', '1');
        w1.style.maxWidth = Math.max(24, (fx.a1 - fx.a0) - Math.round(rowH * 0.78) - 2 * S) + 'px';
        w1.textContent = t.title;
        row1.appendChild(w1);
        tk.appendChild(row1);
      });
      canvas.appendChild(tk);
      turn(tk);
      var kA = fx.align === 'right' ? fx.a1 : fx.a0;
      place(tk, kA, (fx.c0 + fx.c1) / 2, fx.align === 'right' ? 'right' : 'left');
      if (fx.align === 'right' && horizontal) {
        tk.style.left = 'auto'; tk.style.right = Math.max(0, W - fx.a1) + 'px';
      }
      return;
    }
    if (fx.kind === 'terminus') {
      // THE LEGEND IS ON THE LINE.""" A name at the end of each rail is what a
      // transit map does instead of a key in the corner, and it is one size
      // up from the strip: it says whose day this row is.
      // AT THE SIZE THE RULER BOOKS IT AT, which is the label's base and not
      // its small: "increase the font size of those labels". The offline
      // ruler has measured a name at `label--base` since it was written
      // (test/boards/calibrate.js) while the page drew it a size down, so the
      // board has always reserved this much paper for a name -- and a legend
      // in the smallest type on the board is the one thing on it a reader
      // looks for from across the room.
      // A ROUNDEL, NOT A WORD ON PAPER: the line's name is set as a solid ink
      // badge with the letters knocked out, the way a transit map names a
      // line, so the legend is the one thing on the board that is not a
      // caption. Its own colours, so no paper outline (a white outline on
      // white letters is a blob, see the stylesheet).
      // A BOX, NOT A PILL ("can we have not rounded pills for the track
      // names? black boxes" -- "it's label--filled right"): the framework's
      // own filled label is the black box with the letters knocked out, and
      // a line's name reads as a sign on the track rather than as one more
      // route bullet.
      var tn = turn(html('metro-terminus label label--base label--filled text--bold', fx.text));
      // ONE LINE, NO WIDER THAN THE SOLVER BOOKED IT: a name longer than a
      // share of the panel is cut with an ellipsis (the stylesheet) rather
      // than pushing the legend's column out over the day (day.js nameMax).
      if (fx.nameMax != null) {
        if (horizontal) tn.style.maxWidth = fx.nameMax + 'px';
        else tn.style.maxHeight = fx.nameMax + 'px';
      }
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
        // WHERE THE SOLVER PUT IT, WHOLE. Clearing an edge ring used to be
        // done right here, with the solver left holding the rail's start:
        // bands.js books the name past the ring now, and a name that had to
        // step further in to get out of a branch is drawn where it stepped.
        var tA = fx.align === 'right' ? fx.a1 : fx.a0;
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
      // AS AN OUTLINED PILL, the quiet twin of the roundel under it: set as a
      // line of small print it "kinda fades away" beside the solid name, and
      // a state is the one thing said about that line all day.
      var rt = fx.route ? html('metro-route metro-pill metro-pill--quiet label label--small text--bold flex flex--row flex--center-y gap--xsmall') : null;
      var rs = fx.route ? svgEl(doc, 'svg', { width: 12, height: 12, viewBox: '0 0 12 12', 'class': 'metro-route-ring no-shrink' }) : null;
      if (rs) [5, 2.5].forEach(function (rr) {
        rs.appendChild(svgEl(doc, 'circle', { cx: 6, cy: 6, r: rr, fill: 'none',
          stroke: 'currentColor', 'stroke-width': 1.5 }));
      });
      // (the pill is an inline block, so the row's gap class does not reach
      // the ring: a space after it instead, and the ring on the words' middle.
      // Not a spacing property: the lint counts a few property NAMES in the
      // markup, this file included, and that one is on its list.)
      if (rs) {
        rs.style.verticalAlign = 'middle';
        rt.appendChild(rs);
        rt.appendChild(doc.createTextNode('\u00a0'));
        // ON THE LINES day.js BROKE IT INTO, no more than two, each whole.
        var rw = doc.createElement('span');
        (fx.routeLines || [fx.route]).forEach(function (ln1, li1) {
          if (li1) rw.appendChild(doc.createElement('br'));
          rw.appendChild(doc.createTextNode(ln1));
        });
        rt.appendChild(rw);
        turn(rt);
      }
      var nThick = horizontal ? tn.offsetHeight : tn.offsetWidth;
      var rThick = rt ? (horizontal ? rt.offsetHeight : rt.offsetWidth) : 0;
      // THE BADGE IS ALWAYS THE FURTHER OF THE TWO FROM THE TRACK: "Leela's
      // day event above the label ... always further out from the track".
      // The name is what says whose rail this is, so it sits against the
      // rail; what that person is doing today stands beyond it. Below the
      // rail the stack grows down from the name, above it grows up.
      var own = board.lineByKey(fx.line), railC = own ? own.cAt(fx.at == null ? spec.axis.a1 : fx.at) : null;
      var below = railC != null && fx.c0 >= railC;
      var far = fx.align === 'right';
      // A name carrying a route row is placed here rather than above, and
      // both rows take the box the solver booked -- ring, branch and all.
      var rA = far ? fx.a1 : fx.a0;
      if (below) {
        place(tn, rA, fx.c0 + nThick / 2, far ? 'right' : 'left');
        if (rt) place(rt, rA, fx.c0 + nThick + rThick / 2, far ? 'right' : 'left');
      } else {
        var bot0 = Math.max(fx.c1, fx.c0 + nThick + rThick);
        place(tn, rA, bot0 - nThick / 2, far ? 'right' : 'left');
        if (rt) place(rt, rA, bot0 - nThick - rThick / 2, far ? 'right' : 'left');
      }
      if (far && horizontal) {
        [tn, rt].forEach(function (n) { if (n) { n.style.left = 'auto'; n.style.right = Math.max(0, W - fx.a1) + 'px'; } });
      }
    }
  }
  (board.fixed || []).forEach(function (fx) { stripFixture(fx, 0); });
  askClock();
  (board.fixed || []).forEach(function (fx) { stripFixture(fx, 1); });

  // NOW AND NEXT, IN WORDS. "A plain-text two-line summary for whoever is
  // walking past the display in a hurry": what is on now and what comes
  // next, with whose it is, in the title band of today's panel between the
  // date and the forecast. Only on a full view, only where that band is two
  // rows deep, and only in the room the strip has left; a line that does not
  // fit is cut at a word, then the "Now" line goes, then the card.
  if (dayBadges[0] && dayBadges[0].band && !spec.oneName && spec.metro && spec.metro.now_min != null && horizontal) {
    // Today's panel first; late in the day, when today is a sliver, the wide
    // panel of tomorrow beside it.
    var got = false;
    for (var nb = 0; nb < Math.min(2, dayBadges.length) && !got; nb++) {
      if (dayBadges[nb] && dayBadges[nb].band) got = nowNext(dayBadges[nb], nb);
    }
    // ...AND IF TOMORROW'S PANEL COULD NOT TAKE IT, TODAY'S SAYS IT AFTER ALL.
    //
    // Sending the row to tomorrow's panel is right when tomorrow's panel has
    // room for it, and late in the evening it usually has not: the forecast
    // is already in that corner, so the row was refused there --
    // and today's panel, which by then is nearly empty black, had already
    // stood down. The line vanished off the board altogether, which is worse
    // than saying the word twice. Asked again here, with the prefix, because
    // now nothing else is going to say it.
    if (!got && dayBadges[0] && dayBadges[0].band) nowNext(dayBadges[0], 0, false, true);
  }
  // ...AND ON A BOARD OF DAYS, WHERE THE FORECAST TOOK THE ROW UNDER THE
  // DATE, ONE LINE OF IT BESIDE THE DATE.
  if (dayBadges[0] && dayBadges[0].band && !spec.oneName && spec.metro && spec.metro.now_min != null && horizontal
      && !canvas.querySelector('.metro-nownext') && ((spec.metro.days || []).length > 1)) {
    var got2 = false;
    for (var nb2 = 0; nb2 < Math.min(2, dayBadges.length) && !got2; nb2++) {
      if (dayBadges[nb2] && dayBadges[nb2].band) got2 = nowNext(dayBadges[nb2], nb2, true);
    }
    if (!got2 && dayBadges[0] && dayBadges[0].band) nowNext(dayBadges[0], 0, true, true);
  }
  function nowNext(tb, dayIx, oneRow, here) {
    var m = spec.metro, now = m.now_min, i18n = m.i18n || {};
    var names = {};
    (m.legend || []).forEach(function (p) { names[p.key] = p.name || p.key; });
    var evs = (m.events || []).filter(function (ev) { return (!ev.type || ev.type === 'event') && ev.start_min != null; });
    // WHOSE IT IS, AS THE BADGE THE MAP ALREADY USES.
    //
    // It was the person's name after a middle dot, which is the longest way to
    // say it on the one part of the board that runs out of room first: on a
    // narrow panel "Yoga 10:30 \u00b7 Mia" was cut to "Yoga\u2026" and the
    // reader lost the event AND the person. The rings on the map carry these
    // same letters, so a badge is the short way to say it and it points at the
    // line as well.
    //
    // EVERYONE IS ITS OWN BADGE. Five badges for a family of five says the
    // same thing five times and crowds out the title; one word says it once.
    // A word, so it needs the household's language (i18n.everyone).
    function badgesFor(ev) {
      var ks = [ev.owner].concat(ev.co_owners || []).filter(Boolean)
        .filter(function (k, i, all) { return all.indexOf(k) === i && names[k]; });
      var everyone = (m.legend || []).length > 1 && ks.length === (m.legend || []).length;
      if (everyone && i18n.everyone) return [{ text: i18n.everyone, wide: true }];
      return ks.map(function (k) { return { text: initials[k] || String(names[k] || k).charAt(0).toUpperCase() }; });
    }
    var on = evs.filter(function (ev) { return ev.start_min <= now && (ev.end_min || ev.start_min) > now; })
      .sort(function (p, q) { return (p.end_min - p.start_min) - (q.end_min - q.start_min); });
    // TODAY ENDS AT MIDNIGHT, WHATEVER THE BOARD'S WINDOW DOES.
    //
    // This asked for events before `day_end_min`, which is the end of the
    // drawn WINDOW -- and a rolling board's window runs on into tomorrow. So
    // at half past eleven on a Thursday with nothing left that day, "Next"
    // was tomorrow's half past eight swim, sitting beside a "Now" that was
    // today: two rows about two different days with nothing to say so.
    var midnight = (m.days && m.days[1] && m.days[1].start_min != null)
      ? m.days[1].start_min : 24 * 60;
    var later = evs.filter(function (ev) { return ev.start_min > now && ev.start_min < midnight; })
      .sort(function (p, q) { return p.start_min - q.start_min; });
    function at(ev) { return ctx.clock ? ctx.clock(ev.start_min) : ''; }
    var rows = [];
    // THE LEAD SAYS WHEN, AND ONLY SAYS IT ONCE.
    //
    // Three words were tried here and so were three marks. What they have in
    // common is the mistake: "Next" tells a reader nothing the row does not
    // already tell them, because the row says 7pm and it is half past six.
    // The label column is as wide as the widest thing in it and every row pays
    // for it, on the part of the board that runs out of room first -- so the
    // one that carries nothing goes, and what is left is the hour.
    //
    // The other two stay because they are not labels, they are facts:
    //   NOW      what is on has no time to give -- that IS the information
    //   TOMORROW which day, and nothing else on the row says it
    //
    // Grey, all three, because it is the frame; the event's name is what is
    // left in black. Read down the column it is a little timetable, which is
    // what it is.
    // A LATER DAY'S PANEL SAYS "TOMORROW" ITSELF.
    //
    // When the board has rolled far enough to draw tomorrow beside today, the
    // next thing belongs in THAT panel, under its own date, and with no
    // prefix: the header already said the word, and "Tomorrow 08:30" under a
    // badge reading Tomorrow says it twice.
    //
    // AND TODAY'S ROWS NEVER GO IN ANOTHER DAY'S PANEL.
    //
    // There used to be a fallback here: a today shrunk to a sliver has no room
    // for the card, and tomorrow's panel beside it is wide, so today's rows
    // were drawn over there. It reads as a lie. The header above the panel is
    // what says which day its contents are about, so "Nu Kantoor" under a
    // badge reading Morgen tells the reader that tomorrow, now, somebody is at
    // the office. Seen on a real board and reported in three words: "Now in
    // tomorrow?"
    //
    // A card that will not fit today's panel is not drawn. That is a real
    // loss, and it is the smaller one: the board says nothing rather than
    // something untrue, and everything the card would have said is drawn on
    // the map a few pixels below it anyway.
    if (dayIx > 0) {
      if (on.length || later.length) return false;
      var dayLo = (m.days && m.days[dayIx] && m.days[dayIx].start_min != null)
        ? m.days[dayIx].start_min : midnight;
      var own = evs.filter(function (ev) {
        return ev.start_min >= dayLo && ev.start_min < dayLo + 24 * 60;
      }).sort(function (p, q) { return p.start_min - q.start_min; });
      if (!own.length) return true;
      rows.push([at(own[0]), own[0].title, badgesFor(own[0])]);
    } else {
    if (on.length) rows.push([i18n.now || 'Now', on[0].title, badgesFor(on[0])]);
    if (later.length) {
      rows.push([at(later[0]), later[0].title, badgesFor(later[0])]);
    } else if (!on.length) {
      // NOTHING ON AND NOTHING LEFT TODAY, so the next thing really is
      // tomorrow -- and it is labelled tomorrow, not "Next". "Next 08:30" on
      // an empty evening reads as tonight, which is the whole fault above in
      // a different hat. Only with nothing on: a "Now" that is today beside a
      // row that is not is the pair a reader cannot tell apart.
      var tom = evs.filter(function (ev) {
        return ev.start_min >= midnight && ev.start_min < midnight + 24 * 60;
      }).sort(function (p, q) { return p.start_min - q.start_min; });
      if (tom.length) {
        // ...unless tomorrow has a panel of its own on this board, in which
        // case it is drawn there instead, unprefixed. Hand back a miss and the
        // loop moves along to it.
        if (!here && dayBadges.length > 1 && dayBadges[1] && dayBadges[1].band) return false;
        var tw = at(tom[0]);
        rows.push([(i18n.tomorrow || 'Tomorrow') + (tw ? '\u00a0' + tw : ''), tom[0].title, badgesFor(tom[0])]);
      }
    }
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
    if (oneRow && rows.length > 1) rows.shift();
    // THE ROW UNDER THE TITLE, WHERE THAT IS THE WIDER SLOT. Set beside the
    // date, a one-row card had the stretch between the badge and the
    // forecast, and on a full panel cut "Shift Handover" to "Shift..." with
    // the whole row under the title empty ("restructure header to use all
    // the space"). The second row runs from where the date starts to
    // whatever reaches down into it, which is the forecast's card or
    // nothing.
    var underTitle = false;
    // (room for the small size at least: on an X the title is a size up and
    // leaves the second row two thirds of one)
    if (!oneRow && rows.length === 1 && tb.band - tb.r[3] >= rowH * 0.6) {
      // (from the title's own left edge: its rect stands a hair proud of it)
      var fromB = tb.r[0] + 2 * S, toB = (dayCuts.length > dayIx ? dayCuts[dayIx] : (horizontal ? W : H)) - 10 * S;
      taken.forEach(function (t) {
        if (t === tb.r || t.length < 4 || t[2] >= tb.band || t[3] <= tb.r[3]) return;
        if (t[0] >= fromB - 2 * S && t[0] - 12 * S < toB) toB = t[0] - 12 * S;
      });
      if (toB - fromB > to - from) { from = fromB; to = toB; underTitle = true; bandH = tb.band - tb.r[3]; }
    }
    if (to - from < 80 * S) return false;
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
        // AM AND PM SET SMALLER THAN THE HOUR THEY QUALIFY.
        //
        // "7pm" is a number and a suffix, and at one size the suffix reads as
        // part of the number -- on a strip where the hour is the thing being
        // scanned for. Lower case rather than capitals, which is the older
        // typographic habit and the quieter one: SMALL CAPS of any kind on a
        // two-letter word beside a numeral shout, and this row is already the
        // frame rather than the message.
        var ap = /^(.*?\d)\s?([ap]\.?m\.?)(\u00a0*)$/i.exec(rw[0]);
        if (ap) {
          lead.textContent = ap[1];
          var sfx = doc.createElement('span');
          sfx.className = 'label--small';
          sfx.textContent = ap[2];
          lead.appendChild(sfx);
          lead.appendChild(doc.createTextNode('\u00a0\u00a0'));
        }
        var body = doc.createElement('span');
        body.className = 'text--bold';
        body.textContent = rw[1];
        line.appendChild(lead); line.appendChild(body);
        // ...and whose, after the words. `metro-pill` is the strip's own
        // badge -- the one the date and the clock wear -- so it inverts with
        // the band and costs the inline-style budget nothing, which is at its
        // limit of six (see the note by .metro-pill).
        (rw[2] || []).forEach(function (bg) {
          var b = doc.createElement('span');
          // A STEP UNDER THE ROW, NOT A FIXED SIZE. Held at label--small while
          // the row shrank around it, the badge ended up the loudest thing on
          // the line -- "Family Dinner" read as the annotation and "All" as
          // the point.
          b.className = 'metro-who metro-pill text--bold ml--1 ' + (sizes[zi + 1] || sizes[zi]);
          // ...AND IT MUST NOT MAKE THE LINE TALLER. The pill carries its own
          // line-height and two pixels of inset top and bottom, which put the
          // card over the band's depth: the size loop then gave up a whole
          // step of TEXT to buy room for a badge. Set to 1 the badge fits
          // inside the line it annotates. (`line-height` is not one of the
          // eight property names the template's linter counts, which are
          // spent -- see the note by .metro-pill.)
          b.style.lineHeight = '1';
          b.textContent = bg.text;
          line.appendChild(b);
        });
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
      if (card.offsetHeight <= bandH - (underTitle ? 0 : 2) && spans.every(function (sp) { return sp.line.offsetWidth <= to - from; })) break;
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
    if (spans.some(function (sp) { return sp.line.offsetWidth > to - from; }) || card.offsetHeight > bandH - (underTitle ? 0 : 2)) { card.remove(); return false; }
    // ON THE DATE'S OWN ROW WHEN IT IS ONE ROW TALL.
    //
    // A two-row card is centred on the two-row band, which is right. A card of
    // ONE row centred on the same band lands between the two, a few pixels
    // under the date badge beside it and a few over the forecast below --
    // level with neither, which is exactly how it looked: "Tomorrow  Wed 9 Sep
    // [gap] 08:30 Swim Training" with the second half sitting low.
    var single = spans.length < 2;
    var r = place(card, from, underTitle ? (tb.r[3] + tb.band) / 2 : (oneRow || single) ? (tb.r[2] + tb.r[3]) / 2 : tb.band / 2 + 2, 'left');
    if (free(r)) { taken.push(r); return true; }
    card.remove();
    return false;
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
      var nc = hoursFx ? hoursFx.c1 - (horizontal ? rowH : nt.offsetWidth) / 2 - RAIL_ROW : (fx.c0 + fx.c1) / 2;
      var right = fx.align === 'right', at0 = right ? fx.a1 : fx.a0;
      if (ni >= forms.length) {
        // ...past what is on ITS row only: judged along the axis alone it
        // slid past the day's title and the now-and-next card in the row
        // above and landed in the middle of tomorrow's hours. And not far:
        // a count that has to travel more than a few hours to be said is
        // better left off than said somewhere it is not true.
        var from0 = at0;
        taken.forEach(function (t) {
          if (t.length > 3 && !(nc - rowH / 2 < t[3] && t[2] < nc + rowH / 2)) return;
          if (right ? t[1] >= at0 - 60 * S : t[0] <= at0 + 60 * S) at0 = right ? Math.min(at0, t[0] - 2 * S) : Math.max(at0, t[1] + 2 * S);
        });
        if (Math.abs(at0 - from0) > 90 * S) { nt.remove(); continue; }
      }
      // ...AND NEVER ONTO ANOTHER DAY'S PANEL: "+17 earlier" is about today, and
      // slid past the clock on a two-hour sliver of it, it was written at the
      // head of tomorrow's hours, where it is not true.
      var ntLen = horizontal ? nt.offsetWidth : nt.offsetHeight;
      if (!right && dayCuts.length && at0 + ntLen > dayCuts[0] - 4 * S) { nt.remove(); continue; }
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
    // AT THE RATE MOST OF THE HOURS RUN AT, not the widest one's. The
    // widest hour is the lead in front of the first thing, drawn at full
    // rate; a step chosen for it was too fine for the quiet day behind it,
    // every other label was thinned out below, and a free Saturday showed
    // three hours in a whole panel ("it could show more times in that
    // view"). The median hour is the day as it mostly is.
    var widths = [];
    for (var pm = Math.ceil(from / 60) * 60; pm + 60 <= to; pm += 60) {
      widths.push((spec.scale.at(pm + 60) - spec.scale.at(pm)) / 60);
    }
    widths.sort(function (p, q) { return p - q; });
    var perMin = widths.length ? widths[Math.floor(widths.length / 2)] : 0;
    if (!(perMin > 0)) perMin = (spec.scale.at(from + 60) - spec.scale.at(from)) / 60;
    var probe = html('metro-hour label' + STRIP_SM + ' text--bold text-stroke', ctx.clock(0));
    var room = (horizontal ? probe.offsetWidth : probe.offsetHeight) + 10 * S;
    probe.remove();
    var STEPS = [1, 2, 3, 4, 6, 12], step = 12;
    for (var si = 0; si < STEPS.length; si++) {
      if (STEPS[si] * 60 * perMin >= room) { step = STEPS[si]; break; }
    }
    var cHour = hoursFx.c1 - SKY_ROW - rowH / 2 - RAIL_ROW;
    // (A stretch that runs fast is not labelled by a coarser step any more:
    // the spacing rule below leaves off any label closer to the last one
    // than a label is wide, which thins a compressed night by exactly as
    // much as its compression, and no more.)
    // ...AND NEVER CRAMPED AGAINST THE LAST ONE. A compressed night puts the
    // window's last hour a step of the clock but half a label's width past
    // the one before it: "8pm 12am" crowded against the paper's edge
    // ("12am isn't very clean looking"). A label closer to the last placed
    // one than a label is wide is left off; the station stays.
    var lastA = -Infinity, majors = [], minors = [], midnights = [];
    // A STATION EVERY HOUR OR TWO, BIG WITH WORDS AND SMALL WITHOUT ("have
    // the dots every 2 or 1 hours. Small without label and big with
    // label"). The words keep the step they have room for; the stations
    // run on ONE clock step the whole rail, the finest that divides the
    // words' step and still leaves the dots a few of their own widths apart
    // where the scale runs SLOWEST. Chosen at the day's rate, the day ran
    // hourly and the squeezed night and morning were thinned to every two,
    // and a rail that changes rhythm half way reads as dots gone missing
    // ("6am only has 1 dot and it's 10am"). Where even two hours are too
    // tight, a dot closer than that to the one before it is left off.
    // ...AND THE WORDS FOLLOW IT: hourly labels over two-hourly dots are
    // the same broken rhythm, so the labels' step is rounded up to a
    // multiple of the dots'.
    var DOT_GAP = 12 * S, dotStep = 2;
    var slowest = widths.length ? widths[0] : perMin;
    if (60 * slowest >= DOT_GAP) dotStep = 1;
    while (step % dotStep) step++;
    for (var h = Math.ceil(from / 60); h * 60 <= to; h++) {
      if (h % dotStep !== 0) continue;
      var hA = spec.scale.at(h * 60);
      if (h % step !== 0) { minors.push([hA, h]); continue; }
      // Not on a midnight the strip changes panel at: the day's own title
      // names that minute, and the label would be half on each panel. (Its
      // station stays: "missing the 00:00 dot".)
      if (dayCuts.length && ((spec.metro.days || []).some(function (d, di) { return di && d.start_min === h * 60; }))) { midnights.push([hA, h]); continue; }
      // (the window's last hour asks for most of a regular step: it is the
      // one label with nothing after it to balance a tight gap before it,
      // and a compressed night puts it a fraction of a step past its
      // neighbour)
      var need = h * 60 >= to - 59 ? Math.max(room, step * 60 * perMin * 0.85) : room;
      if (hA - lastA < need) { minors.push([hA, h]); continue; }
      var lab = html('metro-hour label' + STRIP_SM + ' text--bold text-stroke',
                     ctx.clock((h % 24) * 60));
      lab.setAttribute('data-metro-hour', h);   // the strip's scale, readable back
      // ...and not half under the slope: the first hours of tomorrow's panel
      // are covered by today's ink as far as the slope reaches on this row
      // ("6am" stood with its "6" under the diagonal)
      if (slantW && horizontal) {
        var hHalf = lab.offsetWidth / 2, hReach = slantAt(cHour - rowH / 2);
        if (dayCuts.some(function (cut) { return hA > cut && hA - hHalf < cut + hReach + 2 * S; })) { lab.remove(); minors.push([hA, h]); continue; }
      }
      if (!horizontal) cHour = hoursFx.c1 - lab.offsetWidth / 2 - 2 * S;
      var got = place(lab, hA, cHour, 'centre');
      // A LABEL A FEW PIXELS SHORT OF ROOM SLIDES rather than going: the
      // clock pill at a quarter to seven took "8pm" by a hair. The station
      // under it stays on the hour; the words move up to a third of their
      // width off it, never further, or they would name the next station.
      // (as far as keeps the words nearer their own station than the next
      // one on the rail, and never more than half their width: a third of
      // it left "12:00" two pixels short beside a morning clock)
      var slid = 0;
      if (!free(got) && horizontal) {
        var lw = lab.offsetWidth;
        var maxR = Math.min(lw / 2, 0.45 * (spec.scale.at((h + dotStep) * 60) - hA));
        var maxL = Math.min(lw / 2, 0.45 * (hA - spec.scale.at((h - dotStep) * 60)));
        for (var sd = 2 * S; sd <= Math.max(maxR, maxL) && !free(got); sd += 2 * S) {
          if (sd <= maxR) { got = place(lab, hA + sd, cHour, 'centre'); slid = sd; if (free(got)) break; }
          if (sd <= maxL) { got = place(lab, hA - sd, cHour, 'centre'); slid = -sd; }
        }
      }
      // ...AND NOT HELD OFF ITS STATION BY THE PAPER'S EDGE: the window's
      // last hour, set against the edge, stood well left of its dot ("00:00
      // at the end is still not aligned"). Words that the edge would move
      // further than the slide may are left off; the station stays.
      var gotMid = (got[0] + got[1]) / 2;
      if (horizontal && Math.abs(gotMid - (hA + slid)) > 2 * S) { lab.remove(); minors.push([hA, h]); continue; }
      if (free(got)) {
        taken.push(got);
        lastA = hA + slid;
        majors.push([hA, h]);
      } else { lab.remove(); minors.push([hA, h]); }
    }
    if (strip && horizontal) {
      // ...and the stations on the rail: a hollow stop, paper inside, big
      // under words and small where there are none
      var railC = strip.c1 + RAIL_W / 2;
      majors.forEach(function (mj) {
        var hq = xy(mj[0], railC);
        var hs = svgEl(doc, 'circle', { cx: hq[0], cy: hq[1], r: NODE_R * 0.75, 'stroke-width': NODE_STROKE * 0.7 });
        hs.style.fill = PAPER; hs.style.stroke = INK;
        hs.setAttribute('data-metro-hour', mj[1]);
        put(hs, 'hour-station');
      });
      // (the midnight first, and kept wherever it does not overlap a
      // station, so a squeezed night thins round it)
      var drawn = majors.map(function (mj) { return mj[0]; });
      midnights.concat(minors.sort(function (p, q) { return p[0] - q[0]; })).forEach(function (mn) {
        var mi = mn[0], clear = midnights.indexOf(mn) >= 0 ? NODE_R * 1.3 : DOT_GAP;
        if (drawn.some(function (da) { return Math.abs(da - mi) < clear; })) return;
        if (mi < NODE_R || mi > alongPx - NODE_R) return;
        drawn.push(mi);
        var mq = xy(mi, railC);
        var ms = svgEl(doc, 'circle', { cx: mq[0], cy: mq[1], r: NODE_R * 0.45, 'stroke-width': NODE_STROKE * 0.55 });
        ms.style.fill = PAPER; ms.style.stroke = INK;
        ms.setAttribute('data-metro-hour', mn[1]);
        put(ms, 'hour-station-minor');
      });
      // THE TRAIN RIDES OVER THE STATION IT IS AT ("draw the now metro over
      // the dot"), not in a gap left for it
      if (trainEl) svg.appendChild(trainEl);
    }
  }

  intoPanels();

  // THE WASHES GO OVER THE MAP. Drawn under it, every paper-filled mark --
  // a stop's ring, a bridge's cut, a texture's core -- punched a white hole
  // in the night and in the past ("the dot here has a white background
  // instead of the actual night bg"). Lifted to the top of the drawing, a
  // wash tints whatever it lies on, ink included, which at six per cent is
  // the difference between nothing and a night. The words are HTML above
  // the drawing either way.
  Array.prototype.slice.call(svg.querySelectorAll('[data-metro-role="night"],[data-metro-role="night-deep"],[data-metro-role="past"]'))
    .forEach(function (n) { svg.appendChild(n); });

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
    // ...AND A CAPTION AT THE FAR EDGE IS HELD BY THAT EDGE, the way a name
    // there is. While the legend took a column at each end there was always
    // something between the last caption and the paper; the column has gone
    // back to the day, so the last caption of the evening now ends ON the
    // edge -- and it is booked at the width the RULER measured while the
    // real face settles a few pixels wider after the board is laid out.
    // Measured here and pulled back, it is measured too early ("Dentist
    // 13:00" was still 87px wide when the box said 81); anchored to the far
    // edge it grows inward whatever the face does, and the words the reader
    // loses are the ones nearest the middle of a board that has room.
    // ...OR ANYWHERE NEAR IT. Measured here the overhang cannot be seen --
    // the element is still the width the ruler booked and settles wider
    // afterwards -- so what is asked is where the caption ENDS: within a row
    // of the paper's own edge there is nothing for the extra pixels to fall
    // on but the floor, and inward is the only way for them to grow.
    var lip = 16 * S;
    var far = cp.a + cp.w >= spec.axis.a1 - 1
      || (horizontal ? cp.a + cp.w > W - lip : cp.a + cp.w > H - lip);
    if (far) {
      var gapEnd = Math.max(0, (horizontal ? W : H) - (cp.a + cp.w));
      if (horizontal) { el.style.left = 'auto'; el.style.right = gapEnd + 'px'; }
      else { el.style.top = 'auto'; el.style.bottom = gapEnd + 'px'; }
    }
  });

  // ---- the platform display ----------------------------------------------
  //
  // THE HEADLINES, along the foot of the map, in the ink of the strip above:
  // the display under a station's departure board. One row a headline, its
  // source as a small pill in front of it, and a title too long for the row
  // cut with an ellipsis rather than wrapped (a wrapped row is two rows). The
  // rows live INSIDE the ink panel, the way the strip's words are moved into
  // theirs, so the framework's `inverse` turns them to paper.
  var newsSpec = spec.news;
  if (newsSpec && (newsSpec.rows || newsSpec.alertRows || newsSpec.taskRows)) {
    // A ROUNDED BOX, set in a little from the paper's edges ("maybe a
    // rounded--small box for the news"), not a bar flush to them: the
    // display is a thing hung on the wall, not the wall.
    // FULL WIDTH AND FLUSH: to the paper's edges and up against the map
    // ("news / weather box should take the full width and have no space
    // between the train schedule and its own box"). The top corners stay
    // rounded; the bottom ones are the paper's own.
    // A BOX PER THING IT SAYS ("maybe have separate boxes at the bottom per
    // type"): the weather, what is owed, and what the world is doing are
    // three different statements, and one box with three rows in it read as
    // one. Each gets its own ground, stacked with a hair of paper between
    // them, all of them full width and flush with the map.
    // ...AND THE BOXES MAKE ONE SIGN ("use this style", a platform sign
    // whose sections are butted together and told apart by their ground):
    // no paper between them, a hairline where one ends and the next
    // begins, and the bar's outer corners the only rounded ones.
    var nbIn = 0, nbW = W, nbGap = 0;
    var secs = [];
    var alHere = spec.metro && spec.metro.service_alert;
    // (a wrapped alert -- a long translation on a slot -- needs its two
    // rows' worth, the way the box reserved it)
    if (alHere && newsSpec.alertRows) secs.push({ kind: 'alert', h: newsSpec.alertRows * rowH * (newsSpec.alertRows > 1 ? 2.3 : 1.9) });
    if (newsSpec.taskRows) secs.push({ kind: 'tasks', h: rowH * 1.45 });
    if (newsSpec.rows) secs.push({ kind: 'news', h: newsSpec.rows * rowH * 1.45 });
    var secH = secs.reduce(function (acc, sc) { return acc + sc.h; }, 0) + nbGap * Math.max(0, secs.length - 1);
    var nbTop0 = H - Math.max(newsSpec.h, secH);
    var boxes = {};
    secs.forEach(function (sc, si) {
      var top = nbTop0 + secs.slice(0, si).reduce(function (acc, q) { return acc + q.h + nbGap; }, 0);
      var bx = doc.createElement('div');
      bx.className = 'metro-strip metro-news metro-news--' + sc.kind
        + ' absolute inverse bg--canvas' + (si ? '' : ' rounded--small');
      bx.style.left = nbIn + 'px'; bx.style.top = Math.round(top) + 'px';
      bx.style.width = nbW + 'px'; bx.style.height = Math.round(sc.h) + 'px';
      canvas.insertBefore(bx, svg);
      var rail = svgEl(doc, 'rect', { x: nbIn, y: Math.round(top), width: nbW, height: Math.round(sc.h),
        stroke: 'none', 'fill-opacity': 0 });
      rail.style.fill = INK;
      put(rail, 'news');
      boxes[sc.kind] = { el: bx, h: Math.round(sc.h) };
      // the hairline between two sections, in the paper the sign's colour
      // change stands for
      if (si) {
        var dv = svgEl(doc, 'line', { x1: nbIn, y1: Math.round(top), x2: nbIn + nbW, y2: Math.round(top),
          'stroke-width': Math.max(1.5 * S, 2), 'stroke-linecap': 'butt' });
        dv.style.stroke = PAPER;
        put(dv, 'news-divide');
      }
    });
    var nb = (boxes.news || boxes.tasks || boxes.alert).el, nbH = (boxes.news || boxes.tasks || boxes.alert).h;
    // ONE TYPE FOR THE WHOLE BOX ("different fonts... use the font of the
    // weather for everything"): the alert's own size, which is the board's
    // one sentence, and the headlines and the tasks set in it too.
    var nbSM = (spec.oneName || !horizontal) ? ' label--small' : '';
    var nbType = 'title' + ((spec.oneName || !horizontal) ? ' title--small' : '');
    var nbMaxW = nbW - 12 * S;
    // WHAT THE WORDS REALLY MEASURE. A row is absolutely placed inside its
    // box, so its own width stops at the box's edge however long the words
    // are: asked for it, the cut below never fired and a headline ran off
    // the paper. The content's own width is what overflows.
    function rowW(el) { return Math.max(el.offsetWidth, el.scrollWidth || 0); }
    // CUT BY WIDTH, NOT BY LETTERS. The words were sliced here and the
    // framework's own clamp put them back: it keeps the original text and
    // re-applies it, so anything cut by hand came back and ran off the
    // paper. The parts are added one at a time instead, and the first one
    // that does not fit is given the room that is left and told to clamp
    // itself; what comes after it is dropped.
    // ONLY THE CUT ONE GIVES WAY. Giving the row its width made it a flex
    // box narrower than its words, and a flex child gives way by default:
    // every headline was squeezed, and `.metro-hour` never wraps, so the
    // first one's words ran straight over the second's and the two were
    // printed on top of each other. What is kept whole is held at its own
    // width, and the one told to clamp is the only one that shrinks.
    // (through `classList`, because a piece can be an SVG glyph and an SVG
    // element's `className` is read-only)
    function holdWhole(n) { if (n.classList) n.classList.add('flex-none'); }
    function fitRow(row, parts, floor) {
      var kept = 0;
      for (var pi = 0; pi < parts.length; pi++) {
        var part = parts[pi];
        part.nodes.forEach(function (n) { row.appendChild(n); holdWhole(n); });
        if (rowW(row) <= nbMaxW) { kept++; continue; }
        var over = rowW(row) - nbMaxW;
        var room = (part.tx.offsetWidth || 0) - over - 2 * S;
        if (kept && room < (floor || 9 * S)) {
          part.nodes.forEach(function (n) { row.removeChild(n); });
        } else {
          // the row is given its width and the words a box to shrink in, and
          // the framework's clamp cuts them to it
          row.style.width = Math.round(nbMaxW) + 'px';
          part.tx.setAttribute('data-clamp', '1');
          part.tx.classList.remove('flex-none');
          part.tx.classList.add('metro-cut');
          kept++;
        }
        break;
      }
      return kept;
    }
    // THE WEATHER ALERT, FIRST. The banner that was a band of its own under
    // the map is the box's first row: the same classes, icon and pieces
    // (the thing bold, the clock quiet), and it may wrap where a slot's
    // width makes it, which the row is deep enough for there.
    var al = spec.metro && spec.metro.service_alert;
    if (al && newsSpec.alertRows) {
      var ar = doc.createElement('div');
      // (the banner's own size on every panel, a slot included: it is the
      // one sentence on the board, and the long translations wrap there)
      ar.className = 'metro-gen metro-banner metro-news-row title inverse bg--canvas rounded--small flex flex--row flex--left flex--center-y gap--small absolute';
      ar.setAttribute('data-metro-alert', al.kind || '');
      if (al.icon) {
        var ai = doc.createElement('img');
        ai.className = 'metro-banner-icon image--adaptive flex-none';
        ai.src = al.icon;
        ai.style.setProperty('--framework-icon-src', 'url("' + al.icon + '")');
        ai.setAttribute('data-adaptive', 'true');
        ar.appendChild(ai);
      } else if (al.kind === 'feed') {
        // a calendar gone a day: the one alert with nothing to fetch
        var fs = svgEl(doc, 'svg', { viewBox: '0 0 16 16', 'class': 'metro-banner-icon flex-none', 'aria-hidden': 'true' });
        fs.appendChild(svgEl(doc, 'path', { d: 'M8 1.5 15 14H1z', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linejoin': 'round' }));
        fs.appendChild(svgEl(doc, 'path', { d: 'M8 6v3.6', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round' }));
        fs.appendChild(svgEl(doc, 'circle', { cx: 8, cy: 11.9, r: 0.95, fill: 'currentColor' }));
        ar.appendChild(fs);
      }
      var at = doc.createElement('span');
      at.className = 'metro-banner-text';
      if (al.parts && al.parts.length) {
        al.parts.forEach(function (pc) {
          if (pc.s === 'b' || pc.s === 'q') {
            var ps = doc.createElement('span');
            ps.className = pc.s === 'b' ? 'text--bold' : 'metro-when text--muted 2bit:text--gray-30 4bit:text--gray-30';
            ps.textContent = pc.t;
            at.appendChild(ps);
          } else at.appendChild(doc.createTextNode(pc.t));
        });
      } else at.textContent = al.text || '';
      ar.appendChild(at);
      boxes.alert.el.appendChild(ar);
      ar.style.left = (3 * S) + 'px';
      ar.style.width = nbMaxW + 'px';
      ar.style.top = Math.round(Math.max(0, (boxes.alert.h - ar.offsetHeight) / 2)) + 'px';
    }
    var rowStep = newsSpec.rows ? nbH / newsSpec.rows : 0;
    // THE SOURCE AS A SOLID PILL: paper with the name knocked out, the way
    // the clock is on the strip ("invert the news source pill").
    function sourcePill(it) {
      var src = doc.createElement('span');
      src.className = 'metro-pill label label--small text--bold';
      // a tighter pill than the strip's: "less room round VRT NWS"
      src.style.setProperty('--metro-pill-x', Math.round(3 * S) + 'px');
      src.style.setProperty('--metro-pill-y', '1px');
      src.textContent = it.source;
      return src;
    }
    // A NEWSPAPER IN FRONT OF THE HEADLINES ("maybe a news icon for the
    // news?"): a little paper, drawn here like the feed alert's triangle
    // so it owes nobody a credit line; in the box's paper, like the words.
    function newsIcon() {
      var sv = svgEl(doc, 'svg', { viewBox: '0 0 16 16', 'class': 'metro-news-icon flex-none', 'aria-hidden': 'true' });
      sv.appendChild(svgEl(doc, 'path', { d: 'M2.5 3h11v9a1.5 1.5 0 0 1-1.5 1.5H2.5z M2.5 13.5A1.5 1.5 0 0 1 1 12V6',
        fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      sv.appendChild(svgEl(doc, 'rect', { x: 4.5, y: 5.2, width: 3.6, height: 3.2, fill: 'currentColor' }));
      sv.appendChild(svgEl(doc, 'path', { d: 'M9.6 5.9h2.2M9.6 7.8h2.2M4.5 10.4h7.3', stroke: 'currentColor', 'stroke-width': 1.2, 'stroke-linecap': 'round' }));
      return sv;
    }
    function headline(it) {
      var tx = doc.createElement('span');
      tx.className = 'metro-hour ' + nbType + ' text--bold';
      tx.textContent = it.title;
      return tx;
    }
    // WHAT IS STILL OWED, ALONG ONE ROW: a tick box in front of each, the
    // box ticked where it was done today, a dot between them, in the same
    // clamp the headlines use. A task is a thing with no time, so it says
    // itself in the display and takes no stop on the map (rule 2q).
    function tickBox(done) {
      var z = Math.round(rowH * 0.78), sv = svgEl(doc, 'svg', { viewBox: '0 0 16 16', 'class': 'metro-task-box flex-none', 'aria-hidden': 'true' });
      sv.style.width = z + 'px'; sv.style.height = z + 'px';
      sv.appendChild(svgEl(doc, 'rect', { x: 2.2, y: 2.2, width: 11.6, height: 11.6, rx: 3,
        fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6 }));
      if (done) sv.appendChild(svgEl(doc, 'path', { d: 'M4.8 8.4 7.2 10.9 11.6 5.4', fill: 'none',
        stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
      return sv;
    }
    if (newsSpec.taskRows && boxes.tasks) {
      var trow = doc.createElement('div');
      trow.className = 'metro-gen metro-news-row metro-task-row flex flex--row flex--center-y gap--small absolute';
      boxes.tasks.el.appendChild(trow);
      var tParts = [];
      // WHOSE IT IS, AFTER IT ("it doesn't say who the task is for"): the
      // owner's letter in a solid pill, the way the next-up card names who
      // is at a thing; a chore the whole household owes says so in a word
      // instead of spelling out every letter.
      var legendN2 = ((spec.metro && spec.metro.legend) || []).length;
      var i18n2 = (spec.metro && spec.metro.i18n) || {};
      function ownerPills(t) {
        var ks = (t.owners || []).filter(function (k, i, all) { return all.indexOf(k) === i; });
        if (!ks.length) return [];
        if (legendN2 > 1 && ks.length === legendN2 && i18n2.everyone) {
          var all1 = doc.createElement('span');
          all1.className = 'metro-pill metro-task-who label label--small text--bold';
          all1.style.setProperty('--metro-pill-x', Math.round(3 * S) + 'px');
          all1.style.setProperty('--metro-pill-y', '1px');
          all1.textContent = i18n2.everyone;
          return [all1];
        }
        return ks.map(function (k) {
          var who = doc.createElement('span');
          who.className = 'metro-pill metro-task-who label label--small text--bold';
          who.style.setProperty('--metro-pill-x', Math.round(3 * S) + 'px');
          who.style.setProperty('--metro-pill-y', '1px');
          who.textContent = initials[k] || String(k).charAt(0).toUpperCase();
          return who;
        });
      }
      // (no dot between them: every task starts with its own box, which
      // divides them already -- "doesn't need a separator does it?")
      (newsSpec.tasks || []).forEach(function (t, ti) {
        var nodes = [];
        if (ti) {
          var tgap = doc.createElement('span');
          tgap.className = 'metro-hour ' + nbType;
          tgap.textContent = '\u00a0\u00a0';
          nodes.push(tgap);
        }
        nodes.push(tickBox(t.done));
        var ttx = doc.createElement('span');
        ttx.className = 'metro-hour ' + nbType + ' text--bold' + (t.done ? ' metro-task-done' + QUIET : '');
        ttx.textContent = t.title;
        nodes.push(ttx);
        ownerPills(t).forEach(function (n) { nodes.push(n); });
        tParts.push({ nodes: nodes, tx: ttx });
      });
      fitRow(trow, tParts);
      trow.style.left = (3 * S) + 'px';
      trow.style.top = Math.round(Math.max(0, (boxes.tasks.h - trow.offsetHeight) / 2)) + 'px';
    }
    // ONE ROW, CLAMPED ("just clamp as many news headlines onto 1 line
    // with a separator"): the newest first, each with its source, a dot
    // between them, strung along the row and cut where the row ends. The
    // last one on it ends in an ellipsis; one that would be left a stub of
    // a few letters goes whole and the one before it is cut instead.
    var rows = newsSpec.fit && newsSpec.rows ? 1 : newsSpec.rows;
    // (no rows, no headlines: the tasks may have taken the row the news
    // would have had, and the one-row form built a row for a box that was
    // never made)
    var itemsFor = !newsSpec.rows || !boxes.news ? []
      : newsSpec.fit ? [newsSpec.items] : newsSpec.items.slice(0, rows).map(function (it) { return [it]; });
    // ONE SOURCE NEEDS NO NAMING ("if there's just one source, don't show
    // the source"): the pills say which paper, and with one paper they say
    // the same thing on every row.
    var sources = {};
    newsSpec.items.forEach(function (it) { if (it.source) sources[it.source] = true; });
    var namePapers = Object.keys(sources).length > 1;
    itemsFor.forEach(function (group, i) {
      var row = doc.createElement('div');
      row.className = 'metro-gen metro-news-row flex flex--row flex--center-y gap--small absolute';
      row.appendChild(newsIcon());
      boxes.news.el.appendChild(row);
      // the parts, in order: each headline with its paper's pill, and a dot
      // between one and the next
      var parts = group.map(function (it, gi) {
        var nodes = [];
        if (gi) {
          var sep = doc.createElement('span');
          sep.className = 'metro-hour ' + nbType + ' text--bold';
          sep.textContent = '\u00b7';
          nodes.push(sep);
        }
        if (namePapers && it.source) nodes.push(sourcePill(it));
        var htx = headline(it);
        nodes.push(htx);
        return { nodes: nodes, tx: htx };
      });
      fitRow(row, newsSpec.fit ? parts : parts.slice(0, 1));
      row.style.left = (3 * S) + 'px';
      row.style.top = Math.round(i * rowStep + (rowStep - row.offsetHeight) / 2) + 'px';
    });
  }

  // A FREE DAY SAYS SO. Four flat rails and two forecasts was "very boring
  // looking", and a child reading the board wants to know what an empty
  // map means: nothing planned, go and play. One friendly line in the
  // middle of the map, with the day's own sky beside it, only where there
  // is a clock (a board about today) and nothing timed on it at all.
  // (...and nothing declared at a head either: with "Weekend weg" on one
  // line, "nothing planned" is not true)
  var quietText = spec.metro && !spec.metro.board_notice && spec.metro.now_min != null
    && !((spec.wants || []).length) && !((spec.states || []).length) && (spec.metro.i18n || {}).quiet_day;
  if (quietText && horizontal && spec.cross) {
    var qBox = doc.createElement('div');
    qBox.className = 'metro-gen metro-quiet absolute flex flex--col flex--center text--center';
    var qRow = doc.createElement('div');
    qRow.className = 'flex flex--row flex--center-y gap--small bg--white outline rounded--large p--3';
    var qWx = ((spec.metro.days || [])[0] || {}).weather || spec.metro.header_weather;
    if (qWx && qWx.icon) {
      var qIc = doc.createElement('img');
      qIc.className = 'image--adaptive';
      qIc.src = qWx.icon;
      var qz = Math.round(rowH * 2.6);
      qIc.style.width = qz + 'px'; qIc.style.height = qz + 'px';
      qIc.style.setProperty('--framework-icon-src', 'url("' + qWx.icon + '")');
      qIc.setAttribute('data-adaptive', 'true');
      qRow.appendChild(qIc);
    }
    var qWords = doc.createElement('span');
    qWords.className = 'title text--bold';
    qWords.textContent = quietText;
    qRow.appendChild(qWords);
    qBox.appendChild(qRow);
    var qTop = spec.cross.c0, qH = Math.max(0, spec.cross.c1 - spec.cross.c0);
    qBox.style.left = '0px'; qBox.style.top = qTop + 'px';
    qBox.style.width = W + 'px'; qBox.style.height = qH + 'px';
    canvas.appendChild(qBox);
  }

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
                   edgeRing: edgeRing, INK: INK, PAPER: PAPER };
