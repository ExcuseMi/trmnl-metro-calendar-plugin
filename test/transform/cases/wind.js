'use strict';

// THE HOUR IT TURNS WINDY (rule 2n, "we could add wind as well"): the
// forecast is asked for its gusts, and the first hour of a day with gusts
// at or over 50 km/h is a "Windy" sky mark, TRMNL's strong-wind glyph, on
// the day it belongs to. A calm day has none.

module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, baseInput, assert } = h;
  const NOW = Date.parse('2026-09-09T08:00:00Z');
  function forecast(gusts) {
    const time = [], pp = [], wc = [], t2 = [];
    for (const d of ['2026-09-09', '2026-09-10']) for (let hr = 0; hr < 24; hr++) {
      time.push(d + 'T' + String(hr).padStart(2, '0') + ':00'); pp.push(5); wc.push(1); t2.push(18);
    }
    return JSON.stringify({
      daily: { time: ['2026-09-09', '2026-09-10'], temperature_2m_max: [20, 21], temperature_2m_min: [11, 12],
        precipitation_probability_max: [5, 5], weathercode: [1, 1],
        sunrise: ['2026-09-09T07:05', '2026-09-10T07:07'], sunset: ['2026-09-09T19:58', '2026-09-10T19:56'] },
      hourly: { time, precipitation_probability: pp, weathercode: wc, temperature_2m: t2, wind_gusts_10m: gusts(time) },
    });
  }
  async function boardWith(gusts) {
    const urls = [];
    const { run } = runTransform(async (url) => {
      urls.push(String(url));
      if (String(url).indexOf('api.open-meteo.com') >= 0) return okText(forecast(gusts));
      return okText(icsWithEvents([{ start: '20260909T090000Z', end: '20260909T100000Z', summary: 'Standup' }]));
    }, NOW);
    const r = await run(baseInput(NOW, { config_json: 'https://calendar.example.com/a.ics', lat_lon: '51.05,3.72' }));
    return { r, urls };
  }

  test('the first gusty hour of a day is a windy mark, and a calm day has none', async () => {
    // gusts of 60 from 14:00 today and from 09:00 tomorrow
    const { r, urls } = await boardWith((time) => time.map((t) => {
      const hr = +t.slice(11, 13), d = t.slice(0, 10);
      return (d === '2026-09-09' && hr >= 14) || (d === '2026-09-10' && hr >= 9) ? 60 : 20;
    }));
    const wx = urls.filter((u) => u.indexOf('api.open-meteo.com') >= 0)[0] || '';
    assert(/wind_gusts_10m/.test(wx) && /wind_speed_unit=kmh/.test(wx), 'the forecast is not asked for gusts in km/h: ' + wx);
    const today = r.data.weather.filter((w) => w.kind === 'windy');
    assert(today.length === 1 && today[0].at_min === 14 * 60 && /wi-strong-wind\.svg$/.test(today[0].icon), 'today\'s windy mark: ' + JSON.stringify(today));
    assert(/^Windy /.test(today[0].label), 'the label: ' + today[0].label);
    const tomorrow = ((r.data.days[1] || {}).weather || {}).milestones || [];
    assert(tomorrow.some((m) => m.kind === 'windy' && m.atMin === 9 * 60), 'tomorrow\'s windy mark: ' + JSON.stringify(tomorrow));
    const calm = await boardWith((time) => time.map(() => 30));
    assert(!calm.r.data.weather.some((w) => w.kind === 'windy'), 'a calm day was marked windy');
  });
};
