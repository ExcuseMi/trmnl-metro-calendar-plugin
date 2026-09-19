'use strict';

// Demo weather. A demo board has no location, so before this nothing on one
// ever drew a sky marker: the strip under the ruler and the rain start/stop
// markers were all invisible until someone had set a real lat/lon and
// waited for the right hour of the right day. Every demo board now carries
// its own forecast (no network call, no setting), and between the three of
// them every marker icon is exercised.
//
// It applies to the demo ONLY: a real config with no location still shows
// an empty header rather than an invented forecast.

const fs = require('fs');
const path = require('path');

const DEMO_DIR = path.join(__dirname, '../../../demo');

module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, fail, baseInput, assert } = h;

  const NOW = Date.parse('2026-09-09T09:00:00Z');
  const relOf = (url) => String(url).split('/main/demo/').pop();

  // demo/*.ics off disk, and nothing else answers: a demo board must not
  // need the weather API at all.
  function serveDemoOnly(seen) {
    return async (url) => {
      (seen || []).push(String(url));
      if (String(url).indexOf('/main/demo/') < 0) return fail(404);
      const full = path.join(DEMO_DIR, relOf(url));
      return fs.existsSync(full) ? okText(fs.readFileSync(full, 'utf-8')) : fail(404);
    };
  }

  const SETS = ['simpsons', 'futurama', 'friends'];

  for (const set of SETS) {
    test('the "' + set + '" demo board draws a full sky band with no network weather', async () => {
      const seen = [];
      const { run } = runTransform(serveDemoOnly(seen), NOW);
      const r = await run(baseInput(NOW, { use_demo_data: 'true', demo_set: set }));

      assert(seen.filter((u) => u.indexOf('api.open-meteo.com') >= 0).length === 0,
        set + ': the demo asked the weather API for a board that has no location');

      // and NO sunrise or sunset: they were markers once and are not any
      // more, so a payload carrying one is the old path coming back.
      assert(r.data.weather.every((i) => i.type === 'weather'),
        set + ': the sky band carries something that is not a weather marker: '
        + JSON.stringify(r.data.weather.map((i) => i.type)));

      const wx = r.data.weather.filter((i) => i.type === 'weather').map((i) => i.label);
      assert(wx.some((l) => /^Rain starts/.test(l)), set + ': no rain start marker, got ' + JSON.stringify(wx));
      assert(wx.some((l) => /^Rain stops/.test(l)), set + ': no rain stop marker, got ' + JSON.stringify(wx));
      // and one heavier condition, so the snow/storm/fog icons are seen too
      assert(wx.some((l) => /^(Snow|Storms|Foggy)/.test(l)),
        set + ': no snow/storm/fog marker, got ' + JSON.stringify(wx));

      assert(r.data.header_weather.hi != null && r.data.header_weather.condition,
        set + ': the header has no weather: ' + JSON.stringify(r.data.header_weather));
      // every marker carries an icon, or it draws as a floating caption
      r.data.weather
        .forEach((i) => assert(/^https:\/\/trmnl\.com\/images\/plugins\/weather\/wi-[a-z-]+\.svg$/.test(i.icon),
          set + ': bad marker icon ' + i.icon));
    });
  }

  test('between them the demo boards exercise every heavy condition', async () => {
    // One board with three rain markers would satisfy every case above and
    // still leave the snow and fog icons unseen by anybody.
    const heavy = new Set();
    for (const set of SETS) {
      const { run } = runTransform(serveDemoOnly(), NOW);
      const r = await run(baseInput(NOW, { use_demo_data: 'true', demo_set: set }));
      r.data.weather.filter((i) => i.type === 'weather').forEach((i) => {
        const m = /^(Snow|Storms|Foggy)/.exec(i.label);
        if (m) heavy.add(m[1]);
      });
    }
    assert(heavy.size === 3, 'expected snow, storms and fog across the three boards, got ' + [...heavy].join(', '));
  });

  test('sunrise and sunset come back as a day\'s dark hours, never as sky markers', async () => {
    // The transform sends no sunrise or sunset MARKER: nobody plans around
    // the minute the sun comes up, and the sunset the board does draw (rule
    // 2n) it makes itself from the day's own time, in the row it can spare,
    // so it never stretches the night. The TIMES came back,
    // for the grey the map is shaded with before sunrise and after sunset
    // (rules.md 2b-i), so they travel on each day's forecast and nowhere else.
    const urls = [];
    const { run } = runTransform(async (url) => {
      urls.push(String(url));
      if (String(url).indexOf('api.open-meteo.com') >= 0) {
        return okText(JSON.stringify({
          daily: {
            temperature_2m_max: [20, 22], temperature_2m_min: [10, 11],
            precipitation_probability_max: [10, 5], weathercode: [0, 1],
            sunrise: ['2026-09-09T07:05', '2026-09-10T07:07'], sunset: ['2026-09-09T19:58', '2026-09-10T19:56'],
            time: ['2026-09-09', '2026-09-10'],
          },
          hourly: { time: [], precipitation_probability: [] },
        }));
      }
      return okText(icsWithEvents([{ start: '20260909T090000Z', end: '20260909T100000Z', summary: 'Standup' }]));
    }, NOW);
    const r = await run(baseInput(NOW, { config_json: 'https://calendar.example.com/a.ics', lat_lon: '51.05,3.72' }));
    const wx = urls.filter((u) => u.indexOf('api.open-meteo.com') >= 0);
    assert(wx.length > 0 && /sunrise/.test(wx[0]) && /sunset/.test(wx[0]), 'the forecast query does not ask for the sun');
    const d0 = (r.data.days || [])[0];
    assert(d0 && d0.weather && d0.weather.sunrise_min === 425 && d0.weather.sunset_min === 1198,
      'the day does not carry its sunrise and sunset: ' + JSON.stringify(d0 && d0.weather));
    assert(!r.data.weather.some((i) => /sun/i.test(i.label || '')), 'a sunrise or sunset marker came back');
  });

  test('the offline demo fallback keeps its weather too', async () => {
    // GitHub unreachable: the board falls back to the built-in Springfield
    // day, which is exactly when an empty sky band would be noticed.
    const { run } = runTransform(async () => fail(500), NOW);
    const r = await run(baseInput(NOW, { use_demo_data: 'true' }));
    assert(r.data.weather.filter((i) => i.type === 'weather').length >= 2, 'the offline demo lost its weather markers');
    assert(r.data.weather.every((i) => i.type === 'weather'), 'the offline demo grew a marker that is not weather');
  });

  test('demo weather does not leak into a real board that has no location', async () => {
    // Inventing a forecast for somebody's actual calendar would be a lie on
    // the wall, not a demo.
    const { run } = runTransform(async () => okText(icsWithEvents([
      { start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Afternoon' },
    ])), NOW);
    const r = await run(baseInput(NOW, {
      use_demo_data: 'false',
      config_json: JSON.stringify({ calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }] }),
    }));
    assert(r.data.header_weather.hi == null, 'a real board invented a temperature: ' + JSON.stringify(r.data.header_weather));
    assert(r.data.weather.length === 0,
      'a real board with no location drew sky markers');
  });

  test('a demo board with a real location prefers the real forecast', async () => {
    const forecast = JSON.stringify({
      daily: {
        temperature_2m_max: [30], temperature_2m_min: [20], precipitation_probability_max: [5],
        weathercode: [0], sunrise: ['2026-09-09T06:30'], sunset: ['2026-09-09T20:30'],
      },
      hourly: { time: [], precipitation_probability: [] },
    });
    const { run } = runTransform(async (url) => {
      if (String(url).indexOf('api.open-meteo.com') >= 0) return okText(forecast);
      const full = path.join(DEMO_DIR, relOf(url));
      return fs.existsSync(full) ? okText(fs.readFileSync(full, 'utf-8')) : fail(404);
    }, NOW);
    const r = await run(baseInput(NOW, { use_demo_data: 'true', lat_lon: '51.05,3.72' }));
    // 30C asked for in Fahrenheit (the demo board pins en-US) comes back
    // already converted by the API, so the number is the one it sent
    assert(r.data.header_weather.hi === 30,
      'the demo weather overrode a real forecast: ' + JSON.stringify(r.data.header_weather));
    // The API is still asked for the day's forecast and still answers with
    // a sunrise and a sunset in the body; the board simply no longer builds
    // a marker out of either.
    assert(r.data.weather.every((i) => i.type === 'weather'),
      'the real forecast put a sun marker back on the board: ' + JSON.stringify(r.data.weather));
  });

  // THE EXAMPLE DAY'S SUN IS THE LOCATION'S OWN CLOCK. A location six hours
  // from the account's zone (New York on a Brussels account) gave the example
  // board a sunrise at half past twelve and a sunset after midnight, so the
  // night ran through the middle of the day. A real day still gets the true
  // times, which is the whole point of them.
  function sunQuery(seen) {
    return async (url) => {
      seen.push(String(url));
      if (String(url).indexOf('api.open-meteo.com') >= 0) {
        return okText(JSON.stringify({
          daily: { temperature_2m_max: [24], temperature_2m_min: [14],
            precipitation_probability_max: [0], weathercode: [0],
            sunrise: ['2026-09-09T06:36'], sunset: ['2026-09-09T19:04'], time: ['2026-09-09'] },
          hourly: { time: [], precipitation_probability: [] },
        }));
      }
      if (String(url).indexOf('/main/demo/') >= 0) {
        const full = path.join(DEMO_DIR, relOf(url));
        return fs.existsSync(full) ? okText(fs.readFileSync(full, 'utf-8')) : fail(404);
      }
      return okText(icsWithEvents([{ start: '20260909T090000Z', end: '20260909T100000Z', summary: 'Standup' }]));
    };
  }

  test('the example day asks for the sun in the location\'s own clock; a real day does not', async () => {
    const demoSeen = [];
    await runTransform(sunQuery(demoSeen), NOW).run(baseInput(NOW, { use_demo_data: 'true', lat_lon: '40.71,-74.00' }));
    const demoWx = demoSeen.find((u) => u.indexOf('api.open-meteo.com') >= 0);
    assert(/timezone=auto/.test(demoWx), 'the example day asked in the account zone: ' + demoWx);

    const realSeen = [];
    const r = await runTransform(sunQuery(realSeen), NOW).run(baseInput(NOW,
      { config_json: 'https://calendar.example.com/a.ics', lat_lon: '40.71,-74.00' }));
    const realWx = realSeen.find((u) => u.indexOf('api.open-meteo.com') >= 0);
    assert(!/timezone=auto/.test(realWx), 'a real day lost the account zone: ' + realWx);
    assert((r.data.days[0].weather || {}).sunrise_min === 396, 'the real day should keep the true sunrise');
  });
};
