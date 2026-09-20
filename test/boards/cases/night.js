'use strict';

// THE SKY ROW IS ITS OWN BAND, AND THE NIGHT IS NOT DRAWN (rule 2b-i). The
// dark was a pale column per span across the map with a deeper one inside
// its twilights; beside the past wash and the boxes at the foot the greys
// were "not that clean", so the map is paper from the strip to its foot. It
// came back for a while behind the sky glyphs and went again ("remove the
// twilight & night bg for the weather band"): that row keeps a faint ground
// of its own, and says nothing else about the sky.

module.exports = function (test, h) {
  const { layout, build, fixtures, assert } = h;
  const twoDay = fixtures.find((f) => f.name === 'badge-and-branch');
  for (const v of ['x-landscape', 'og-landscape', 'x-portrait']) {
    test('no night is drawn, and the sky row has its ground: ' + v, () => {
      const rep = layout(twoDay, v);
      const dark = (rep.nights || []).filter((n) => n.role === 'night' || n.role === 'night-deep');
      assert(!dark.length, dark.length + ' dark span(s) on a board that should be paper');
      // (the ground is a rect, which the offline report does not carry, so
      // it is asked of the drawing itself)
      const built = build(twoDay.metro, v);
      const skyH = built.spec.skyH || 0;
      const ground = [...built.doc.querySelectorAll('[data-metro-role="sky-band"]')];
      if (!skyH) { assert(!ground.length, 'a band with no sky row'); return; }
      assert(ground.length === 1, ground.length + ' grounds for one sky row');
      // ...and it ends where the map begins
      const flat = !/portrait/.test(v);
      const hi = flat ? +ground[0].getAttribute('y') + +ground[0].getAttribute('height')
        : +ground[0].getAttribute('x') + +ground[0].getAttribute('width');
      assert(hi <= built.spec.cross.c0 + 1, 'the band runs into the map: ' + Math.round(hi));
    });
  }
};
