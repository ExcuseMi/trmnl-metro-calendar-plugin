'use strict';

// THE TRAIN RIDES OVER THE STATION IT IS AT ("draw the now metro over the
// dot"): drawn after every hour station on the strip's rail, so the dot at
// the hour it is passing is under it and not cut round it.

module.exports = function (test, h) {
  const { build, fixtures, assert } = h;
  // NO BARE STRETCH OF RAIL ("6am only has 1 dot and it's 10am"): no two
  // neighbouring stations further apart on the PAPER than one step of the
  // words at the day's fullest rate.
  //
  // MEASURED IN PIXELS, NOT IN HOURS. It counted hours and asked for one
  // clock step the whole way, which is a rule about a linear scale: this
  // one runs the night at a quarter of the day's rate, so dots evenly
  // spaced on the paper are three and four hours apart there and one hour
  // apart in the afternoon. Counting hours, the only way to pass was to
  // put the whole rail on the night's step -- and that took the words down
  // with it, since they are rounded up to a multiple of the dots'. What
  // the complaint was actually about is a HOLE, and a hole is a distance.
  for (const f of fixtures) {
    for (const v of ['x-landscape', 'og-landscape']) {
      test('no stretch of the rail is left bare: ' + f.name + ' / ' + v, () => {
        const built = build(f.metro, v);
        const at = (h) => built.spec.scale.at(h * 60);
        const dots = [...built.doc.querySelectorAll('[data-metro-role^="hour-station"]')]
          .map((n) => +n.getAttribute('data-metro-hour')).sort((p, q) => p - q);
        if (dots.length < 3) return;
        // the words' step, and the widest an hour is drawn anywhere on the
        // board: their product is a full step of the words where the day
        // has the most room, which is the widest gap that can be right
        const said = [...built.doc.querySelectorAll('[data-metro-role="hour-station"]')]
          .map((n) => +n.getAttribute('data-metro-hour')).sort((p, q) => p - q);
        let step = Infinity;
        for (let i = 1; i < said.length; i++) step = Math.min(step, said[i] - said[i - 1]);
        if (!isFinite(step)) return;
        let widest = 0;
        for (let h = dots[0]; h < dots[dots.length - 1]; h++) widest = Math.max(widest, at(h + 1) - at(h));
        // ...and the clearance that thinned it: a dot is left off where it
        // would stand closer than that to the one before, so an hour drawn
        // at full rate next to a squeezed one runs a gap that much over a
        // full step and is not a hole (DOT_GAP, draw.js).
        const full = widest * step + 12 * built.o.S;
        for (let i = 1; i < dots.length; i++) {
          const gap = at(dots[i]) - at(dots[i - 1]);
          assert(gap <= full + 2, 'a bare stretch from ' + dots[i - 1] + ' to ' + dots[i]
            + ': ' + Math.round(gap) + 'px, over the ' + Math.round(full) + 'px of a full step');
        }
      });
    }
  }
  // TONIGHT'S MOON UNDER THE TIME LINE ("like the rain icon under the time
  // line"): TRMNL's phase icon in the sky row just past the midnight the
  // night crosses, and the midnight's station a plain dot ("keep dots at
  // night").
  test('tonight\'s moon is a sky mark just past the midnight', () => {
    const f = fixtures.find((x) => x.name === 'two-day');
    const metro = Object.assign({}, f.metro, { days: f.metro.days.map((d) => Object.assign({}, d, { moon: { illumination: 57, waxing: true } })) });
    for (const v of ['x-landscape', 'og-landscape']) {
      const built = build(metro, v);
      const moons = [...built.doc.querySelectorAll('.metro-sky img')].filter((n) => /wi-moon/.test(n.getAttribute('src')));
      assert(moons.length === 1, v + ': ' + moons.length + ' moons');
      assert(/wi-moon-alt-waxing-gibbous-1\.svg$/.test(moons[0].getAttribute('src')), v + ': the phase ' + moons[0].getAttribute('src'));
      const fx = built.board.fixed.find((x) => x.kind === 'sky' && /wi-moon/.test(x.icon || ''));
      assert(fx && fx.min === 1440, v + ': the moon is not at the midnight');
      // centred on it, "on 12 midnight"
      assert(Math.abs((fx.a0 + fx.a1) / 2 - built.spec.scale.at(1440)) < 1, v + ': the moon is off the midnight');
      const mid = built.doc.querySelector('[data-metro-hour="24"]');
      assert(!mid || mid.tagName.toLowerCase() === 'circle', v + ': the midnight station is not a dot');
    }
    // no phase, no moon
    assert(!build(f.metro, 'x-landscape').board.fixed.some((x) => /wi-moon/.test(x.icon || '')), 'a moon with no phase');
  });
  for (const name of ['two-day', 'busy-day']) {
    test('the train is drawn over the hour stations: ' + name, () => {
      const f = fixtures.find((x) => x.name === name);
      const built = build(f.metro, 'x-landscape');
      const svg = built.doc.querySelector('.metro-canvas svg');
      const all = [...svg.querySelectorAll('[data-metro-role]')];
      const train = all.findIndex((n) => n.getAttribute('data-metro-role') === 'now-train');
      assert(train >= 0, 'no train on the strip');
      const last = all.map((n) => n.getAttribute('data-metro-role')).lastIndexOf('hour-station-minor');
      const lastBig = all.map((n) => n.getAttribute('data-metro-role')).lastIndexOf('hour-station');
      assert(train > Math.max(last, lastBig), 'a station is drawn over the train');
    });
  }
};
