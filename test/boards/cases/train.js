'use strict';

// THE TRAIN RIDES OVER THE STATION IT IS AT ("draw the now metro over the
// dot"): drawn after every hour station on the strip's rail, so the dot at
// the hour it is passing is under it and not cut round it.

module.exports = function (test, h) {
  const { build, fixtures, assert } = h;
  // ONE RHYTHM ALONG THE RAIL ("6am only has 1 dot and it's 10am"): the
  // stations are a single clock step apart the whole way, day and squeezed
  // night alike, save a dot the night was too tight for (a gap of twice
  // the step at most).
  for (const f of fixtures) {
    for (const v of ['x-landscape', 'og-landscape']) {
      test('the stations keep one rhythm along the rail: ' + f.name + ' / ' + v, () => {
        const built = build(f.metro, v);
        const hrs = [...built.doc.querySelectorAll('[data-metro-role^="hour-station"]')]
          .map((n) => +n.getAttribute('data-metro-hour')).sort((p, q) => p - q);
        if (hrs.length < 3) return;
        const gaps = hrs.slice(1).map((x, i) => x - hrs[i]);
        const step = Math.min.apply(null, gaps);
        const odd = gaps.filter((g) => g !== step && g !== 2 * step);
        assert(!odd.length, 'stations at ' + hrs.join(',') + ': gaps ' + gaps.join(','));
        assert(step <= 2, 'stations ' + step + ' hours apart');
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
