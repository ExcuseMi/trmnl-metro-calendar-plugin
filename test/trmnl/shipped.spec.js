'use strict';

// DOES THE COPY THAT SHIPS ACTUALLY RUN, AND DRAW THE SAME BOARD?
//
// push.sh strips, minifies and compresses both source files on the way to the
// device (lib/shipped.js builds the same copy). The only checks it used to
// make were that `trmnlp build` succeeded and that a marker string was there;
// neither runs a line of the template's script, and a minifier that broke the
// layout would have pushed cleanly and drawn nothing on the panel. This was
// plugin/verify-build.js (every view of the squeezed copy, on an X, must lay a
// map out) and `node -e "require(transform.js)"`; it now also asks that the
// squeezed copy draw exactly the board the sources draw, fixture by fixture,
// and that the squeezed transform return exactly what the sources return.
//
//   trmnlp-test run shipped

const { test, expect, matrix, VIEWS } = require('trmnlp-test');
const { shippedPlugin } = require('./lib/shipped');
const { HEAD, report } = require('./lib/page');
const { cases } = require('./lib/layout');
const { demoMocks, NOT_FOUND } = require('./lib/demo');

const SHIPPED = shippedPlugin();

// EVERY VIEW, not just the full one. They are four different files on the
// server and the squeeze rewrites all four; a deploy that proves one of them
// draws is a deploy that has proved a quarter of what it is sending. On an X,
// with the demo day baked into .trmnlp.yml, as verify-build did.
for (const view of VIEWS) {
  test('the squeezed copy lays a map out · ' + view, async ({ trmnl }) => {
    const screen = await trmnl.plugin(SHIPPED).render({ device: 'v2', view, transform: false, head: HEAD });
    // THE SCRIPT SAYS WHEN IT FAILS, and report() asks that first: a solver
    // that threw leaves data-metro-error behind, and the message in it is
    // worth more than "the map never laid itself out".
    const rep = await report(screen);
    const dbg = rep.debug;
    // A BOARD WITH NO LINES ON IT IS NOT A BOARD. `gaps` is one entry per
    // line plus the two margins, so anything under three means nothing was
    // placed.
    expect(dbg.gaps.length, 'the map laid out with no lines on it').toBeGreaterThanOrEqual(3);
    // ...AND NOTHING A READER CANNOT READ. Shed names and dropped lines are
    // DECISIONS and are allowed; a caption nobody can pair with a mark is not.
    expect(dbg.muddle, dbg.muddle + ' name(s) a reader cannot pin to a mark; that is too many to ship').toBeLessThanOrEqual(2);
  });
}

// The squeezed transform loads and answers exactly as the source does: the
// demo day, through trmnlp's node wrapper, at two times.
for (const at of ['2026-09-15T12:30:00Z', '2026-09-16T02:40:00Z']) {
  test('the squeezed transform returns what the source returns · ' + at, async ({ trmnl }) => {
    const opts = { now: at, timeZone: 'America/Chicago', locale: 'en-US', trmnlpYml: false, data: {},
      fields: { use_demo_data: 'true', demo_set: 'simpsons' }, mocks: demoMocks().concat([NOT_FOUND]) };
    const shipped = await trmnl.plugin(SHIPPED).transform(opts);
    expect(shipped).toTransformCleanly();
    expect(shipped).toStayWithinServerlessLimits();
    expect((shipped.output.data.legend || []).length, 'the squeezed transform drew nobody').toBeGreaterThan(0);
    const source = await trmnl.transform(opts);
    // (the feeds are read in the config's order, so the two agree exactly:
    // test/trmnl/transform/order.spec.js)
    expect(shipped.output).toEqual(source.output);
  });
}

// THE SAME BOARD, fixture by fixture, on the four views the layout suite
// renders most. Everything the board reports about itself and everything it
// drew, rounded to a pixel.
function digest(rep) {
  const r = (n) => Math.round(n);
  const dbg = Object.assign({}, rep.debug);
  delete dbg.ms; delete dbg.runs;
  return {
    canvas: [r(rep.canvas.w), r(rep.canvas.h)], debug: dbg,
    labels: rep.labels.map((l) => [l.cls, l.text, r(l.x), r(l.y), r(l.w), r(l.h), l.timeCls]),
    paths: rep.paths.map((p) => [p.role, p.owner, r(p.len), p.pts.length && p.pts[0].map(r)]),
    circles: rep.circles.map((c) => [c.role, c.owner, r(c.x), r(c.y)]),
  };
}

cases('shipped', (t, h) => {
  for (const f of h.fixtures) {
    for (const v of h.VIEWPORTS) {
      t('the squeezed copy draws the board the sources draw · ' + f.name + ' · ' + v.name, async () => {
        const source = digest(await h.layout(f, v));
        const shipped = digest(await h.layoutOf(SHIPPED, f, v));
        expect(shipped).toEqual(source);
      });
    }
  }
});
