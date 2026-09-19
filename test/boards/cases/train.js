'use strict';

// THE TRAIN RIDES OVER THE STATION IT IS AT ("draw the now metro over the
// dot"): drawn after every hour station on the strip's rail, so the dot at
// the hour it is passing is under it and not cut round it.

module.exports = function (test, h) {
  const { build, fixtures, assert } = h;
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
