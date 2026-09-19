'use strict';

// THE SKY ROW UNDER THE TIME LINE (rule 2n): the rain as a stretch of drops
// between the glyph that says it starts and the one that says it stops
// ("rain as a stretch, not a point"), each day's sunset at its minute, and
// the weather first where two glyphs want the same room.

module.exports = function (test, h) {
  const { build, fixtures, assert } = h;
  const five = fixtures.find((f) => f.name === 'five-lines') || fixtures[0];
  const ICON = 'https://trmnl.com/images/plugins/weather/';
  const RAIN = [
    { type: 'weather', at_min: 780, icon: ICON + 'wi-rain.svg', label: 'Rain starts 13:00', kind: 'rain_starts' },
    { type: 'weather', at_min: 960, icon: ICON + 'wi-day-sunny.svg', label: 'Rain stops 16:00', kind: 'rain_stops' },
  ];
  const day = (start, extra) => Object.assign({ index: start / 1440, start_min: start, end_min: start + 1440,
    date_label: 'Day', weekday_label: 'Day',
    weather: Object.assign({ hi: 20, lo: 12, condition: 'Rain', rain_chance: 60, icon: '', sunrise_min: 420, sunset_min: 1180,
      milestones: [] }, extra || {}) });
  const skyOf = (built) => built.board.fixed.filter((f) => f.kind === 'sky');

  test('while it rains the row rains: drops between the start and the stop, clear of the glyphs', () => {
    const metro = Object.assign({}, five.metro, {
      day_start_min: 420, day_end_min: 1320, now_min: 600,
      weather: RAIN,
      days: [day(0, { milestones: RAIN.map((w) => ({ atMin: w.at_min, kind: w.kind, icon: w.icon, label: w.label })) })],
    });
    const built = build(metro, 'x-landscape');
    const rain = built.board.fixed.find((f) => f.kind === 'rain');
    assert(rain, 'no rain stretch');
    const s = built.spec.scale;
    assert(Math.abs(rain.a0 - s.at(780)) < 1 && Math.abs(rain.a1 - s.at(960)) < 1, 'the stretch is not 13:00 to 16:00');
    const g = built.doc.querySelector('[data-metro-role="rain"]');
    assert(g && +g.getAttribute('data-metro-drops') >= 4, 'too few drops: ' + (g && g.getAttribute('data-metro-drops')));
    // no drop under a glyph
    const glyphs = skyOf(built);
    const xs = [...g.querySelectorAll('path')].map((p) => parseFloat(p.getAttribute('d').slice(1)));
    for (const x of xs) {
      assert(x > rain.a0 - 1 && x < rain.a1 + 1, 'a drop outside the stretch at ' + Math.round(x));
      assert(!glyphs.some((f) => x > f.a0 && x < f.a1), 'a drop under a glyph at ' + Math.round(x));
    }
    // no stop, rain to the day's end; no rain, no drops
    const noStop = build(Object.assign({}, metro, { days: [day(0, { milestones: [{ atMin: 780, kind: 'rain_starts', icon: RAIN[0].icon, label: RAIN[0].label }] })] }), 'x-landscape');
    const open = noStop.board.fixed.find((f) => f.kind === 'rain');
    assert(open && open.a1 >= noStop.spec.scale.at(1300), 'rain without a stop does not run to the end of the day');
    const dry = build(Object.assign({}, metro, { weather: [], days: [day(0)] }), 'x-landscape');
    assert(!dry.board.fixed.some((f) => f.kind === 'rain'), 'rain on a dry day');
  });

  test('each day\'s sunset is a glyph at its minute, and gives way to the weather', () => {
    const metro = Object.assign({}, five.metro, {
      day_start_min: 900, day_end_min: 2880, now_min: 960, weather: [],
      days: [day(0), day(1440, { sunset_min: 1170 })],
    });
    const built = build(metro, 'x-landscape');
    const sets = skyOf(built).filter((f) => /wi-sunset/.test(f.icon));
    assert(sets.length === 2, sets.length + ' sunsets');
    assert(sets[0].min === 1180 && sets[1].min === 1440 + 1170, 'the sunsets are not at their minutes: ' + sets.map((f) => f.min));
    // a storm on the sunset's minute keeps its place; the sunset stands
    // beside it, snug, rather than going ("a solution when there's a
    // weather event at the same time")
    const storm = { type: 'weather', at_min: 1180, icon: ICON + 'wi-day-thunderstorm.svg', label: 'Storms 19:40', kind: 'storms' };
    const both = build(Object.assign({}, metro, { weather: [storm] }), 'x-landscape');
    const at = skyOf(both).filter((f) => f.min === 1180);
    const st = at.find((f) => /thunderstorm/.test(f.icon)), sun = at.find((f) => /wi-sunset/.test(f.icon));
    assert(st && sun, 'both glyphs should be drawn: ' + at.map((f) => f.icon).join(', '));
    const s = both.spec.scale.at(1180);
    assert(Math.abs((st.a0 + st.a1) / 2 - s) < 1, 'the storm left its minute');
    assert(sun.a1 <= st.a0 + 0.5 || sun.a0 >= st.a1 - 0.5, 'the two glyphs overlap');
    const gap = Math.min(Math.abs(sun.a1 - st.a0), Math.abs(sun.a0 - st.a1));
    assert(gap <= st.a1 - st.a0, 'the sunset is not beside the storm: ' + Math.round(gap) + 'px off');
  });
};
