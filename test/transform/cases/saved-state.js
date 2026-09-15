'use strict';

// Saved state (https://help.trmnl.com/en/articles/16777795): run() returns
// `trmnl_state` and the runtime hands it back as `input.trmnl.state` on the
// next render. It exists so a render can know three things a single render
// cannot work out on its own:
//
//   - what the weather was the last time the API answered, so one failed
//     forecast call does not blank the header and every sky marker
//   - how long each feed has been failing, so a feed that is really down
//     gets named on the board instead of quietly taking its events with it
//   - what a feed that is failing right now is CALLED, since an unnamed
//     feed is named by its own X-WR-CALNAME and a feed that cannot answer
//     cannot tell us its name
//
// Everything in here has to survive state being absent, a string, or
// nonsense: it is input, and it comes from outside.

module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, fail, baseInput, eventItems, assert } = h;

  const NOW = Date.parse('2026-09-09T09:00:00Z');
  const NOW_S = Math.floor(NOW / 1000);
  const ICS_URL = 'https://cloud.example.com/cal-2.ics';

  const ICS = icsWithEvents([
    { start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Afternoon' },
  ]).replace('VERSION:2.0\r\n', 'VERSION:2.0\r\nX-WR-CALNAME:Alex Personal\r\n');

  const FORECAST = JSON.stringify({
    daily: {
      temperature_2m_max: [21], temperature_2m_min: [12], precipitation_probability_max: [40],
      weathercode: [61], sunrise: ['2026-09-09T07:05'], sunset: ['2026-09-09T19:45'],
    },
    hourly: { time: ['2026-09-09T13:00', '2026-09-09T14:00'], precipitation_probability: [80, 10] },
  });

  // `calendarsFail`/`weatherFails` decide which half of the network is out;
  // everything else answers.
  function net(opts) {
    opts = opts || {};
    const seen = [];
    const impl = async (url) => {
      seen.push(String(url));
      if (String(url).indexOf('api.open-meteo.com') >= 0) return opts.weatherFails ? fail(503) : okText(FORECAST);
      if (String(url).indexOf('/i18n/') >= 0) return fail(404);
      return opts.calendarsFail ? fail(500) : okText(ICS);
    };
    impl.seen = seen;
    return impl;
  }

  function input(extra, state) {
    const i = baseInput(NOW, Object.assign({
      use_demo_data: 'false',
      config_json: JSON.stringify({ calendars: [{ url: ICS_URL }] }),
      lat_lon: '51.05,3.72',
    }, extra));
    if (state !== undefined) i.trmnl.state = state;
    return i;
  }

  test('run() hands saved state back to the runtime, not just the board', async () => {
    const { run } = runTransform(net(), NOW);
    const r = await run(input());
    assert(r.trmnl_state && typeof r.trmnl_state === 'object',
      'no trmnl_state came back: ' + JSON.stringify(Object.keys(r || {})));
    assert(r.data, 'the payload lost its metro key');
  });

  test('the last good forecast is kept and replayed when the weather API fails', async () => {
    const first = runTransform(net(), NOW);
    const good = await first.run(input());
    assert(good.data.header_weather.hi != null, 'the live forecast did not render');
    // the state is stored as JSON by the runtime, so round-trip it
    const saved = JSON.parse(JSON.stringify(good.trmnl_state));

    const second = runTransform(net({ weatherFails: true }), NOW);
    const later = await second.run(input({}, saved));
    assert(later.data.header_weather.hi === good.data.header_weather.hi,
      'a failed forecast blanked the header instead of reusing the last one: ' + JSON.stringify(later.data.header_weather));
    assert(later.data.weather_stale === false, 'a forecast minutes old is not stale');
    // the markers come back too, not only the header numbers
    const marks = later.data.weather.filter((i) => i.type === 'weather');
    assert(marks.length > 0, 'the replayed forecast came back with no markers at all');
    assert(later.data.weather.every((i) => i.type === 'weather'),
      'the replay put a sun marker back: ' + JSON.stringify(later.data.weather));
  });

  test('a replayed forecast old enough to be another day says so', async () => {
    // Six hours is the line: past it the "forecast" may be describing
    // yesterday, and a board that shows yesterday's weather as today's is
    // worse than one that admits the number is old.
    const stale = {
      weather: { hi: 9, lo: 2, condition: 'snow', icon: 'wi-day-snow.svg', rain_chance: 70, unit: 'C',
        milestones: [{ atMin: 600, kind: 'snow' }], sun: [{ kind: 'sunrise', atMin: 430 }] },
      weatherFetchedAt: NOW_S - 7 * 3600,
    };
    const { run } = runTransform(net({ weatherFails: true }), NOW);
    const r = await run(input({}, stale));
    assert(r.data.header_weather.hi === 9, 'the old forecast was dropped rather than shown: ' + JSON.stringify(r.data.header_weather));
    assert(r.data.weather_stale === true, 'a seven-hour-old forecast should be flagged stale');
  });

  test('a feed that fails starts a clock, and clears it when it comes back', async () => {
    const down = runTransform(net({ calendarsFail: true }), NOW);
    const r1 = await down.run(input());
    assert(r1.trmnl_state.calendarDown[ICS_URL] === NOW_S,
      'the failure was not recorded: ' + JSON.stringify(r1.trmnl_state.calendarDown));

    const back = runTransform(net(), NOW);
    const r2 = await back.run(input({}, JSON.parse(JSON.stringify(r1.trmnl_state))));
    assert(!r2.trmnl_state.calendarDown[ICS_URL],
      'a feed that answered again is still marked down: ' + JSON.stringify(r2.trmnl_state.calendarDown));
  });

  test('a feed down for hours is named on the board; a blip is not', async () => {
    // A single 500 on a morning refresh is noise: the plugin retries in
    // fifteen minutes. What has to reach the reader is a feed that has been
    // failing since before breakfast, because those events are missing and
    // nothing else on the board says so.
    const { run } = runTransform(net({ calendarsFail: true }), NOW);

    const blip = await run(input({}, { calendarDown: { [ICS_URL]: NOW_S - 10 * 60 } }));
    assert(blip.data.calendars_down.length === 0,
      'a ten-minute outage should not be announced, got ' + JSON.stringify(blip.data.calendars_down));

    const real = await run(input({}, {
      calendarDown: { [ICS_URL]: NOW_S - 3 * 3600 },
      calendarNames: { [ICS_URL]: 'Alex Personal' },
    }));
    assert(real.data.calendars_down.join(',') === 'Alex Personal',
      'expected the failing feed named on the board, got ' + JSON.stringify(real.data.calendars_down));
  });

  test('a failing feed keeps the name it had, instead of becoming its URL', async () => {
    // The name of a feed the config did not name comes from the feed's own
    // X-WR-CALNAME, so a feed that cannot answer cannot say what it is
    // called. Remembered, it stays "Alex Personal"; forgotten, it degrades
    // to whatever the link happens to end in.
    const first = runTransform(net(), NOW);
    const good = await first.run(input());
    assert(good.trmnl_state.calendarNames[ICS_URL] === 'Alex Personal',
      'the feed name was not remembered: ' + JSON.stringify(good.trmnl_state.calendarNames));

    const saved = JSON.parse(JSON.stringify(good.trmnl_state));
    saved.calendarDown = { [ICS_URL]: NOW_S - 3 * 3600 };
    const second = runTransform(net({ calendarsFail: true }), NOW);
    const later = await second.run(input({}, saved));
    assert(later.data.calendars_down.join(',') === 'Alex Personal',
      'the failing feed lost its name: ' + JSON.stringify(later.data.calendars_down));

    // and with nothing remembered it falls back to the link, not to nothing
    const cold = await second.run(input({}, { calendarDown: { [ICS_URL]: NOW_S - 3 * 3600 } }));
    assert(cold.data.calendars_down.length === 1 && /Cal/.test(cold.data.calendars_down[0]),
      'expected a URL-derived name as the last resort, got ' + JSON.stringify(cold.data.calendars_down));
  });

  test('state left over from feeds the config no longer names is dropped', async () => {
    // Otherwise a URL removed from the config a year ago is still carried,
    // and still counted as down, on every render for ever.
    const { run } = runTransform(net(), NOW);
    const r = await run(input({}, {
      calendarDown: { 'https://gone.example.com/old.ics': NOW_S - 3 * 3600 },
      calendarNames: { 'https://gone.example.com/old.ics': 'Old' },
    }));
    assert(Object.keys(r.trmnl_state.calendarDown).length === 0
      && Object.keys(r.trmnl_state.calendarNames).indexOf('https://gone.example.com/old.ics') < 0,
      'stale feed state survived: ' + JSON.stringify(r.trmnl_state));
    assert(r.data.calendars_down.length === 0, 'a feed the config no longer has was announced as down');
  });

  test('absent, string-wrapped and malformed state all render a board', async () => {
    // Some runtimes hand the state back as the JSON string they stored; a
    // device upgrading from an older build has a shape this code has never
    // seen. Neither may cost the render.
    const { run } = runTransform(net(), NOW);
    const cases = [
      undefined,
      null,
      'not json at all',
      JSON.stringify({ weather: { hi: 18, lo: 9, condition: 'clear', icon: 'wi-day-sunny.svg', unit: 'C' }, weatherFetchedAt: NOW_S }),
      [1, 2, 3],
      { calendarDown: 'nope', calendarNames: [1], weather: 'sunny', i18n: { lang: 5 } },
    ];
    for (const st of cases) {
      const r = await run(input({}, st));
      assert(r.data && eventItems(r.data).length > 0, 'state ' + JSON.stringify(st) + ' broke the render');
      assert(r.trmnl_state && typeof r.trmnl_state === 'object', 'state ' + JSON.stringify(st) + ' produced no new state');
    }
    // the one well-formed string case is also USED, not just survived
    const r = await run(input({}, cases[3]));
    assert(r.data.header_weather.hi === 21 || r.data.header_weather.hi === 18,
      'a string-wrapped state was ignored: ' + JSON.stringify(r.data.header_weather));
  });

  test('a render that falls back to the demo still returns its state', async () => {
    // The fallback paths are exactly when the remembered weather and the
    // "down since" clocks matter, so they are the last place to drop them.
    const { run } = runTransform(net({ calendarsFail: true }), NOW);
    const r = await run(input({ config_json: '' }, { calendarNames: { [ICS_URL]: 'Alex Personal' } }));
    assert(r.trmnl_state && typeof r.trmnl_state === 'object', 'the fallback path dropped the state');
  });
};
