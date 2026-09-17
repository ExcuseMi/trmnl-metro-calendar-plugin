'use strict';

// Temperature unit. Like locale, timeZone and timeFormat, this is a
// property of the BOARD rather than of the account it hangs on, so the
// config wins over the account setting and the account setting is only the
// default.
//
// Auto is no longer on the menu (settings.yml) and is still answered, because
// a board that chose it while it was there still has `auto` stored and should
// keep what it picked: it reads the locale's region, so en-US is Fahrenheit
// and everywhere else, the rest of the English-speaking world included, is
// Celsius. A board that chose NOTHING takes the declared default instead of a
// guess.

module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, baseInput, assert } = h;

  const NOW = Date.parse('2026-09-09T09:00:00Z');
  const NOW_S = Math.floor(NOW / 1000);
  const ICS = icsWithEvents([{ start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Afternoon' }]);

  // Open-Meteo converts server-side, so which unit was ASKED for is the
  // thing to assert: a board reading 21 when it meant 70 is the failure.
  const FORECAST = JSON.stringify({
    daily: {
      temperature_2m_max: [70], temperature_2m_min: [55], precipitation_probability_max: [10],
      weathercode: [0], sunrise: ['2026-09-09T07:05'], sunset: ['2026-09-09T19:45'],
    },
    hourly: { time: [], precipitation_probability: [] },
  });

  function net() {
    const seen = [];
    const impl = async (url) => {
      seen.push(String(url));
      if (String(url).indexOf('api.open-meteo.com') >= 0) return okText(FORECAST);
      return okText(ICS);
    };
    impl.seen = seen;
    impl.weatherUrl = () => seen.filter((u) => u.indexOf('api.open-meteo.com') >= 0)[0] || '';
    return impl;
  }

  function input(cfgExtra, fields, locale) {
    const i = baseInput(NOW, Object.assign({
      use_demo_data: 'false',
      lat_lon: '51.05,3.72',
      config_json: JSON.stringify(Object.assign({
        calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }],
      }, cfgExtra)),
    }, fields));
    if (locale) i.trmnl.user.locale = locale;
    return i;
  }

  test('a board that still has auto stored keeps it: en-US Fahrenheit, elsewhere Celsius', async () => {
    const us = net();
    await runTransform(us, NOW).run(input({ locale: 'en-US' }, { temperature_unit: 'auto' }));
    assert(/temperature_unit=fahrenheit/.test(us.weatherUrl()), 'en-US should ask for Fahrenheit: ' + us.weatherUrl());

    const gb = net();
    const r = await runTransform(gb, NOW).run(input({ locale: 'en-GB' }, { temperature_unit: 'auto' }));
    assert(/temperature_unit=celsius/.test(gb.weatherUrl()), 'en-GB should ask for Celsius: ' + gb.weatherUrl());
    assert(r.data.header_weather.unit === 'C', 'the payload should say which unit it is in');
  });

  // THE OPTION IS GONE, SO NOTHING CHOSEN IS NOT A CHOICE OF AUTO.
  // `settings.yml` says the default is Celsius; this says the same, rather
  // than guessing from the locale where nobody asked for a guess. An en-US
  // board that never touched the field is the one this moves.
  test('a board that chose nothing gets the declared default, not a guess', async () => {
    const us = net();
    const r = await runTransform(us, NOW).run(input({ locale: 'en-US' }));
    assert(/temperature_unit=celsius/.test(us.weatherUrl()),
      'an unset unit should be Celsius, not guessed: ' + us.weatherUrl());
    assert(r.data.header_weather.unit === 'C', 'got unit ' + r.data.header_weather.unit);
  });

  test('the config wins over the account setting, the way timeFormat does', async () => {
    const n = net();
    const r = await runTransform(n, NOW).run(
      input({ locale: 'en-US', temperatureUnit: 'celsius' }, { temperature_unit: 'f' }));
    assert(/temperature_unit=celsius/.test(n.weatherUrl()), 'the config was overruled: ' + n.weatherUrl());
    assert(r.data.header_weather.unit === 'C', 'got unit ' + r.data.header_weather.unit);
  });

  test('the account setting is used when the config says nothing', async () => {
    const n = net();
    const r = await runTransform(n, NOW).run(input({ locale: 'nl-BE' }, { temperature_unit: 'f' }));
    assert(/temperature_unit=fahrenheit/.test(n.weatherUrl()), 'the setting was ignored: ' + n.weatherUrl());
    assert(r.data.header_weather.unit === 'F', 'got unit ' + r.data.header_weather.unit);
  });

  test('an unrecognised unit is the default, not a guess', async () => {
    const n = net();
    await runTransform(n, NOW).run(input({ locale: 'en-US', temperatureUnit: 'kelvin' }));
    assert(/temperature_unit=celsius/.test(n.weatherUrl()),
      '"kelvin" should fall to the default: ' + n.weatherUrl());
  });

  test('weather replayed from state is converted, not shown in the old unit', async () => {
    // State outlives a settings change: a forecast fetched in Celsius and
    // replayed on a board that has since switched to Fahrenheit would read
    // 21 degrees on a 70 degree day.
    const { run } = runTransform(async (url) => {
      if (String(url).indexOf('api.open-meteo.com') >= 0) throw new Error('forecast down');
      return okText(ICS);
    }, NOW);
    // Fahrenheit ASKED FOR, not inferred: this case is about the conversion,
    // and it used to get its F from an unset field guessing the locale.
    const i = input({ locale: 'en-US' }, { temperature_unit: 'f' });
    i.trmnl.state = {
      weather: { hi: 21, lo: 13, condition: 'clear', icon: 'wi-day-sunny.svg', rain_chance: 10, unit: 'C', milestones: [], sun: [] },
      weatherFetchedAt: NOW_S - 600,
    };
    const r = await run(i);
    assert(r.data.header_weather.hi === 70 && r.data.header_weather.lo === 55,
      'expected 21/13 C converted to 70/55 F, got ' + JSON.stringify(r.data.header_weather));
  });
};
