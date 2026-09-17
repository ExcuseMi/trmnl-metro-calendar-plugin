'use strict';

// The weather banner: metro.service_alert, or null.
//
// The banner is one line along the bottom edge and the template only
// prints it, so everything that could be wrong about it has to be wrong
// HERE: which breach wins when a day trips several, when the weather starts
// and when it ends, what unit a threshold was read in, which language the
// line came out in, and whether the alert cost the render a second call to
// the forecast API.
//
// The shape is deliberately { kind, icon, text, parts } or NULL. Null is
// what lets the template collapse the band and hand the space back to the
// map, so "no alert" must never arrive as an empty string or an object with
// a blank text.

const fs = require('fs');
const path = require('path');

const I18N_DIR = path.join(__dirname, '../../../i18n');

module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, fail, baseInput, assert, assertEqual } = h;

  const NOW = Date.parse('2026-09-09T09:00:00Z');
  const NOW_S = Math.floor(NOW / 1000);
  const ICS = icsWithEvents([{ start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Afternoon' }]);

  // Hours across the visible day. The wettest one is 17:00, which is the
  // hour in the copy the alert lines were written against.
  const HOURS = [];
  const PROBS = [];
  for (let hh = 7; hh <= 21; hh++) {
    HOURS.push('2026-09-09T' + String(hh).padStart(2, '0') + ':00');
    PROBS.push(hh === 17 ? 80 : (hh === 16 ? 30 : 5));
  }

  // A forecast in the shape Open-Meteo answers with. `code` drives the
  // condition bucket (71 is snow, 61 rain, 0 clear); hi/lo are whatever the
  // API was asked for, which is always the board's own unit. `codes` is the
  // hourly weathercode, left out by default: that is the shape an older
  // build saved, and the banner has to keep reading it.
  function forecast(o) {
    o = o || {};
    return JSON.stringify({
      daily: {
        temperature_2m_max: [o.hi == null ? 18 : o.hi],
        temperature_2m_min: [o.lo == null ? 11 : o.lo],
        precipitation_probability_max: [o.max == null ? 80 : o.max],
        weathercode: [o.code == null ? 61 : o.code],
        sunrise: ['2026-09-09T06:30'], sunset: ['2026-09-09T20:30'],
      },
      hourly: Object.assign({ time: HOURS, precipitation_probability: o.probs || PROBS },
        o.codes ? { weathercode: o.codes } : {}),
    });
  }

  // What the banner says, in the shape the template gets.
  //
  // `parts` -- the same sentence split for the banner to set in three weights
  // -- is left out of these and asserted on its own below. Every one of these
  // cases is about WHICH banner and WHAT it says; repeating the split in each
  // expected object would be writing `segments` out thirteen more times and
  // testing it against itself.
  function without(a) {
    if (!a || typeof a !== 'object') return a;
    const o = Object.assign({}, a); delete o.parts; return o;
  }
  const ICON = 'https://trmnl.com/images/plugins/weather/';
  function alert(kind, text, icon) {
    return { kind: kind, icon: ICON + icon, text: text };
  }

  // Every board here is a real one (not the demo): a location, one calendar,
  // and whatever alert settings the case is about.
  function net(body, i18nText) {
    const seen = [];
    const impl = async (url) => {
      seen.push(String(url));
      if (String(url).indexOf('api.open-meteo.com') >= 0) return body == null ? fail(500) : okText(body);
      if (String(url).indexOf('/i18n/') >= 0) return i18nText == null ? fail(404) : okText(i18nText);
      return okText(ICS);
    };
    impl.seen = seen;
    return impl;
  }

  function input(fields, locale, state) {
    const i = baseInput(NOW, Object.assign({
      use_demo_data: 'false',
      lat_lon: '51.05,3.72',
      config_json: JSON.stringify({ calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }] }),
    }, fields));
    if (locale) i.trmnl.user.locale = locale;
    if (state !== undefined) i.trmnl.state = state;
    return i;
  }

  const ON = { alert_enabled: 'true', alert_rain_threshold: '70' };

  test('no alert settings, no banner: service_alert is null', async () => {
    // The field must exist and be null rather than be absent, so the
    // template has one thing to test rather than two.
    const { run } = runTransform(net(forecast()), NOW);
    const r = await run(input({}));
    assert('service_alert' in r.data, 'the payload has no service_alert key at all');
    assertEqual(r.data.service_alert, null, 'an unconfigured board raised an alert');
  });

  test('the banner is off until it is turned on, on a day that breaches everything', async () => {
    // Thresholds filled in but the switch left alone: an alert nobody asked
    // for is an alert nobody trusts.
    const { run } = runTransform(net(forecast({ code: 71, hi: -2, lo: -9 })), NOW);
    const r = await run(input({ alert_rain_threshold: '10', alert_temp_low: '0' }));
    assertEqual(r.data.service_alert, null, 'a board with alert_enabled unset raised an alert');
  });

  test('rain over the threshold is the banner: when it starts, when it ends, and how likely', async () => {
    const { run } = runTransform(net(forecast()), NOW);
    const r = await run(input(ON));
    assertEqual(without(r.data.service_alert),
      alert('rain', 'Rain from 17:00 until 18:00 (80%)', 'wi-rain.svg'),
      'the English rain banner');
  });

  // ---------------------------------------------------- the banner, in pieces
  //
  // "Rain from 16:00 until 20:00 (96%)" is one line doing three jobs:
  // what is coming, when, and how sure. At one weight a reader has to read all
  // of it to find the part they wanted.
  test('the banner comes in pieces: the thing badged, the clock quiet', async () => {
    const { run } = runTransform(net(forecast()), NOW);
    const parts = (await run(input(ON))).data.service_alert.parts;
    assert(Array.isArray(parts) && parts.length, 'no parts: ' + JSON.stringify(parts));
    // the pieces put back together are exactly the sentence
    assertEqual(parts.map((p) => p.t).join(''), 'Rain from 17:00 until 18:00 (80%)',
      'the pieces do not spell the line');
    const badge = parts.filter((p) => p.s === 'p').map((p) => p.t);
    const lit = parts.filter((p) => p.s === '').map((p) => p.t).join(' ');
    const quiet = parts.filter((p) => p.s === 'q').map((p) => p.t).join(' ');
    // what is coming, in the badge: the one word that decides whether the
    // rest is worth reading, and the only thing on the banner that is not
    // either a clock or a joining word
    assertEqual(badge, ['Rain'], 'the thing itself is not the badged one');
    // the clocks are what a reader scans a weather line for, so they stay lit
    assert(lit.indexOf('17:00') >= 0 && lit.indexOf('18:00') >= 0,
      'the clocks went quiet: ' + JSON.stringify(parts));
    // and the sentence holding them together does not compete, the
    // probability included: 80% or 96%, it is raining either way
    assert(quiet.indexOf('from') >= 0 && quiet.indexOf('until') >= 0,
      'the joining words are not quiet: ' + quiet);
    assert(quiet.indexOf('(80%)') >= 0,
      'the probability is not quiet, or lost its brackets: ' + quiet);
  });

  test('a temperature keeps its degree and its unit in one piece', async () => {
    // `{v}\u00b0{u}` puts the degree sign in the literal text between two
    // placeholders, so styling the placeholders alone gives "-6" bold,
    // "\u00b0" plain and "C" bold again.
    const { run } = runTransform(net(forecast({ hi: 1, lo: -6 })), NOW);
    const parts = (await run(input(Object.assign({ alert_temp_low: '-5' }, ON)))).data.service_alert.parts;
    const bold = parts.filter((p) => p.s === 'b').map((p) => p.t);
    assertEqual(bold, ['-6\u00b0C'], 'wanted one bold piece: ' + JSON.stringify(parts));
  });

  test('a day that stays under the threshold gets no banner', async () => {
    // 80% is the wettest hour; asked for 90 it is not an alert, and the
    // band has to disappear rather than say "Rain (80%)".
    const { run } = runTransform(net(forecast()), NOW);
    const r = await run(input({ alert_enabled: 'true', alert_rain_threshold: '90' }));
    assertEqual(r.data.service_alert, null, 'got ' + JSON.stringify(r.data.service_alert));
  });

  test('a blank rain threshold is off, not zero', async () => {
    // Read as 0 an empty "rain chance" field would fire on every dry day.
    // The form fills in 70, so an empty one is somebody who emptied it.
    const { run } = runTransform(net(forecast()), NOW);
    const r = await run(input({ alert_enabled: 'true', alert_rain_threshold: '' }));
    assertEqual(r.data.service_alert, null, 'an emptied rain field alerted on an 80% hour');
  });

  test('snow outranks rain: one banner, and it names the thing that stops the day', async () => {
    const { run } = runTransform(net(forecast({ code: 71, hi: 1, lo: -3 })), NOW);
    const r = await run(input(ON));
    assertEqual(without(r.data.service_alert),
      alert('snow', 'Snow from 17:00 until 18:00 (80%)', 'wi-snow.svg'),
      'a snowy day with rain over the threshold should read as snow');
  });

  test('snow needs no setting: it alerts with the rain field emptied', async () => {
    // Nobody knows what snow threshold they want, so there is no switch
    // or number for it: snow that is likely is an alert.
    const { run } = runTransform(net(forecast({ code: 71, hi: 4, lo: 1 })), NOW);
    const r = await run(input({ alert_enabled: 'true', alert_rain_threshold: '' }));
    assertEqual((r.data.service_alert || {}).kind, 'snow', 'got ' + JSON.stringify(r.data.service_alert));
  });

  // ---------------------------------------------------------------- combined
  //
  // ONE BANNER, AND WHICH ONE IS A RULE, NOT AN ACCIDENT OF ARRAY ORDER.
  //
  // A real winter day breaches several of these at once -- freezing, and
  // snowing, and over the rain line -- and until these cases the ranking
  // between them was only ever asserted a pair at a time, against rain. The
  // order is how much of the day has to change because of it: ice, snow,
  // storms, then the temperature, then rain.

  test('a day that breaches everything raises the one that takes the road away', async () => {
    // Freezing rain, under a freezing sky, over the rain line, with the
    // temperature field set so cold breaches too. Every rule in the ladder
    // fires and the reader gets the top of it.
    const codes = HOURS.map((_, i) => (i + 7 === 17 ? 67 : 3));
    const { run } = runTransform(net(forecast({ code: 67, hi: 1, lo: -6, codes })), NOW);
    const r = await run(input(Object.assign({ alert_temp_low: '0' }, ON)));
    assertEqual(without(r.data.service_alert),
      alert('ice', 'Freezing rain from 17:00 until 18:00 (80%)', 'wi-sleet.svg'),
      'a freezing, icy, wet day should name the ice');
  });

  test('freezing rain is not rain: it alerts with the rain field emptied', async () => {
    // 66 and 67 sat inside the rain bucket, so a black-ice morning said
    // "Rain", and only if a threshold had been set and crossed. It says
    // itself now, the way snow does.
    const codes = HOURS.map((_, i) => (i + 7 === 17 ? 66 : 3));
    const { run } = runTransform(net(forecast({ code: 66, hi: 2, lo: -1, codes })), NOW);
    const r = await run(input({ alert_enabled: 'true', alert_rain_threshold: '' }));
    assertEqual((r.data.service_alert || {}).kind, 'ice',
      'got ' + JSON.stringify(r.data.service_alert));
  });

  test('freezing drizzle is ice too, and outranks the snow behind it', async () => {
    const codes = HOURS.map((_, i) => (i + 7 === 17 ? 57 : 71));
    const { run } = runTransform(net(forecast({ code: 57, hi: 0, lo: -4, codes })), NOW);
    assertEqual((await run(input(ON))).data.service_alert.kind, 'ice', 'freezing drizzle should be ice');
  });

  test('snow outranks a freezing day: the sky before the thermometer', async () => {
    // Both true, and only one banner. Snow is a thing happening that you can
    // see out of the window; "Freezing, down to -9" is the same day said
    // less usefully.
    const { run } = runTransform(net(forecast({ code: 71, hi: -2, lo: -9 })), NOW);
    const r = await run(input(Object.assign({ alert_temp_low: '0' }, ON)));
    assertEqual((r.data.service_alert || {}).kind, 'snow',
      'a freezing snowy day should say snow: ' + JSON.stringify(r.data.service_alert));
  });

  test('snow outranks thunderstorms', async () => {
    const codes = HOURS.map((_, i) => (i + 7 === 17 ? 71 : (i + 7 === 18 ? 95 : 3)));
    const probs = PROBS.map((p, i) => (i + 7 === 17 || i + 7 === 18 ? 80 : p));
    const { run } = runTransform(net(forecast({ code: 71, codes, probs })), NOW);
    assertEqual((await run(input(ON))).data.service_alert.kind, 'snow',
      'snow and storms in one day should read as snow');
  });

  test('hail arrives as thunderstorms, which is what it comes with', async () => {
    // WMO has no code for hail on its own: 96 and 99 are a thunderstorm WITH
    // hail, so that is what the banner can honestly say.
    for (const code of [96, 99]) {
      const codes = HOURS.map((_, i) => (i + 7 === 17 ? code : 3));
      const { run } = runTransform(net(forecast({ code, codes })), NOW);
      assertEqual((await run(input(ON))).data.service_alert.kind, 'storms', 'code ' + code);
    }
  });

  test('cold and heat carry the temperature, and outrank rain', async () => {
    const cold = await runTransform(net(forecast({ hi: 1, lo: -6 })), NOW)
      .run(input(Object.assign({ alert_temp_low: '-5' }, ON)));
    assertEqual(without(cold.data.service_alert),
      alert('cold', 'Freezing, down to -6°C', 'wi-snowflake-cold.svg'), 'the cold banner');

    const heat = await runTransform(net(forecast({ hi: 36, lo: 24 })), NOW)
      .run(input(Object.assign({ alert_temp_high: '35' }, ON)));
    assertEqual(without(heat.data.service_alert),
      alert('heat', 'Hot, up to 36°C', 'wi-hot.svg'), 'the heat banner');
  });

  test('cold above freezing is called cold, not freezing', async () => {
    // A reader who set the line at 5 is told it is cold. "Freezing, down to
    // 3" would be a wrong statement about the one number on the banner.
    const r = await runTransform(net(forecast({ hi: 9, lo: 3 })), NOW)
      .run(input(Object.assign({ alert_temp_low: '5' }, ON)));
    assertEqual(without(r.data.service_alert), alert('cold', 'Cold, down to 3°C', 'wi-snowflake-cold.svg'),
      'got ' + JSON.stringify(r.data.service_alert));
  });

  // "I wouldn't even know what temps I want to be alerted at." Blank cold
  // and heat fields are not off: they are a frost and a hot day in the
  // board's own unit, so the banner is useful before anyone has thought
  // about temperatures at all. Each is the line itself (fires) and one
  // degree short of it (does not).
  const DEFAULTS = [
    { unit: 'c', at: { lo: 0 }, short: { lo: 1 }, kind: 'cold', text: 'Freezing, down to 0°C' },
    { unit: 'f', at: { lo: 32 }, short: { lo: 33 }, kind: 'cold', text: 'Freezing, down to 32°F' },
    { unit: 'c', at: { hi: 30 }, short: { hi: 29 }, kind: 'heat', text: 'Hot, up to 30°C' },
    { unit: 'f', at: { hi: 86 }, short: { hi: 85 }, kind: 'heat', text: 'Hot, up to 86°F' },
  ];
  for (const d of DEFAULTS) {
    test('a blank ' + d.kind + ' field alerts at the default for ' + d.unit.toUpperCase(), async () => {
      const mild = d.unit === 'f' ? { hi: 70, lo: 55 } : { hi: 21, lo: 13 };
      const dry = { probs: PROBS.map(() => 5), max: 5 };
      const fields = { alert_enabled: 'true', temperature_unit: d.unit, alert_temp_low: '', alert_temp_high: '' };
      const hit = await runTransform(net(forecast(Object.assign({}, dry, mild, d.at))), NOW).run(input(fields));
      assertEqual((hit.data.service_alert || {}).text, d.text, 'got ' + JSON.stringify(hit.data.service_alert));
      assertEqual((hit.data.service_alert || {}).kind, d.kind, 'the kind');
      const miss = await runTransform(net(forecast(Object.assign({}, dry, mild, d.short))), NOW).run(input(fields));
      assertEqual(miss.data.service_alert, null, 'a degree short of the default alerted: '
        + JSON.stringify(miss.data.service_alert));
    });
  }

  test('a filled-in temperature field overrides the default', async () => {
    // -2 is under the default frost line; asked for -5 it is not an alert.
    const r = await runTransform(net(forecast({ hi: 8, lo: -2, probs: PROBS.map(() => 5) })), NOW)
      .run(input({ alert_enabled: 'true', alert_temp_low: '-5' }));
    assertEqual(r.data.service_alert, null, 'got ' + JSON.stringify(r.data.service_alert));
  });

  test('a temperature threshold is read in the unit the board is showing', async () => {
    // ONE day (a low of 18C, which is 64F) and one threshold, "20". On a
    // Celsius board that is a cold morning; on a Fahrenheit board 20 is
    // -7C and nothing like it. The forecast is fetched in the board's own
    // unit (the API converts), so the way this goes wrong is comparing the
    // reader's number against the other scale.
    const sameDay = async (url) => {
      if (String(url).indexOf('api.open-meteo.com') >= 0) {
        const f = /temperature_unit=fahrenheit/.test(String(url));
        return okText(forecast(f ? { hi: 81, lo: 64 } : { hi: 27, lo: 18 }));
      }
      return okText(ICS);
    };
    const noRain = Object.assign({}, ON, { alert_rain_threshold: '', alert_temp_low: '20' });

    const c = await runTransform(sameDay, NOW).run(input(Object.assign({ temperature_unit: 'c' }, noRain)));
    assertEqual(without(c.data.service_alert), alert('cold', 'Cold, down to 18°C', 'wi-snowflake-cold.svg'),
      '18C is at or below a threshold of 20 on a Celsius board');

    const f = await runTransform(sameDay, NOW).run(input(Object.assign({ temperature_unit: 'f' }, noRain)));
    assertEqual(f.data.service_alert, null,
      '64F is nowhere near a threshold of 20 on a Fahrenheit board: ' + JSON.stringify(f.data.service_alert));
  });

  test('a snapshot saved in one unit is compared in the unit the board now shows', async () => {
    // Saved state outlives the temperature setting. A -6C snapshot replayed
    // on a board switched to Fahrenheit is a 21F day, and "cold at or below
    // 25" has to fire on it.
    const first = runTransform(net(forecast({ hi: 1, lo: -6 })), NOW);
    const good = await first.run(input(Object.assign({ temperature_unit: 'c' }, ON)));
    const saved = JSON.parse(JSON.stringify(good.trmnl_state));
    assertEqual(saved.weather.unit, 'C', 'the snapshot should record the unit it was fetched in');

    const later = await runTransform(net(null), NOW)
      .run(input(Object.assign({ temperature_unit: 'f', alert_temp_low: '25', alert_rain_threshold: '' }, ON), null, saved));
    assertEqual(without(later.data.service_alert), alert('cold', 'Freezing, down to 21°F', 'wi-snowflake-cold.svg'),
      'got ' + JSON.stringify(later.data.service_alert));
  });

  test('the alert costs the render no extra network call', async () => {
    // It reads the forecast that was already fetched. A second call would
    // come out of the same shared deadline the calendars are spending.
    const fetchImpl = net(forecast());
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(input(ON));
    assert(r.data.service_alert, 'no alert to weigh');
    assertEqual(fetchImpl.seen.filter((u) => u.indexOf('api.open-meteo.com') >= 0).length, 1,
      'the forecast API was called more than once');
  });

  test('a board running on the last good forecast still raises its alert', async () => {
    // The API is down, the board is showing the snapshot out of saved
    // state, and that is exactly the day you want to be told it will rain.
    const first = runTransform(net(forecast()), NOW);
    const good = await first.run(input(ON));
    const saved = JSON.parse(JSON.stringify(good.trmnl_state));
    assert(saved.weather && saved.weather.peak, 'the wettest hour was not saved: ' + JSON.stringify(saved.weather));

    const later = await runTransform(net(null), NOW).run(input(ON, null, saved));
    assertEqual((later.data.service_alert || {}).text, 'Rain from 17:00 until 18:00 (80%)',
      'got ' + JSON.stringify(later.data.service_alert));
  });

  test('a saved snapshot from a build that had no wettest hour does not invent one', async () => {
    // Older state carries no `peak`. An alert that made an hour up would be
    // a time on the wall nobody's forecast ever said.
    const saved = { weather: { hi: 18, lo: 11, condition: 'rain', icon: 'wi-day-rain.svg', rain_chance: 80, unit: 'C' },
      weatherFetchedAt: NOW_S - 600 };
    const r = await runTransform(net(null), NOW).run(input(ON, null, saved));
    assertEqual(r.data.service_alert, null, 'got ' + JSON.stringify(r.data.service_alert));
  });

  // The exact copy, per language, from the files this repo actually ships,
  // served through the actual fetch path: a spell of rain with both ends, one that has already started, snow to the end of the day,
  // and the frost line. A translator reordering the times and the
  // percentage is fine, losing one of them is not (see i18n-files.js).
  // English is here too, so all five are read the same way. NB is the
  // no-break space French and German put before a percent sign, so "80"
  // and "%" never land on two lines of a wrapped banner.
  const NB = '\u00a0';
  const COPY = {
    en: { ahead: 'Rain from 17:00 until 18:00 (80%)',
          started: 'Rain until 16:00 (85%)', snow: 'Snow for the rest of the day (90%)',
          cold: 'Freezing, down to -3°C' },
    de: { ahead: 'Regen von 17:00 bis 18:00 (80' + NB + '%)',
          started: 'Regen bis 16:00 (85' + NB + '%)',
          snow: 'Schnee für den Rest des Tages (90' + NB + '%)', cold: 'Frost, Tiefstwert -3°C' },
    es: { ahead: 'Lluvia de 17:00 a 18:00 (80%)',
          started: 'Lluvia hasta las 16:00 (85%)',
          snow: 'Nieve el resto del día (90%)', cold: 'Heladas, mínima de -3°C' },
    fr: { ahead: 'Pluie de 17:00 à 18:00 (80' + NB + '%)',
          started: "Pluie jusqu'à 16:00 (85" + NB + '%)',
          snow: "Neige jusqu'à la fin de la journée (90" + NB + '%)', cold: 'Gel, minimum -3°C' },
    nl: { ahead: 'Regen van 17:00 tot 18:00 (80%)',
          started: 'Regen tot 16:00 (85%)',
          snow: 'Sneeuw de rest van de dag (90%)', cold: 'Vorst, minimum -3°C' },
  };

  for (const lang of Object.keys(COPY)) {
    test('the ' + lang + ' banner reads as it was written', async () => {
      const table = lang === 'en' ? null : fs.readFileSync(path.join(I18N_DIR, lang + '.json'), 'utf-8');
      const loc = lang === 'en' ? 'en-GB' : lang + '-' + lang.toUpperCase();
      const got = async (now, body) => {
        const i = input(ON, loc);
        i.trmnl.system.timestamp_utc = Math.floor(now / 1000);
        const r = await runTransform(net(body, table), now).run(i);
        return r.data.service_alert || {};
      };
      const want = COPY[lang];

      const ahead = await got(NOW, forecast());
      assertEqual(ahead.text, want.ahead, lang + ': a spell still ahead');

      // 15:30, inside the 15:00 hour
      const started = await got(Date.parse('2026-09-09T15:30:00Z'),
        forecast({ probs: HOURS.map((t, k) => (k === 8 ? 85 : 5)) }));
      assertEqual(started.text, want.started, lang + ': a spell that has started');

      // 17:00 to the last hour, 21:00, read at 17:30
      const snow = await got(Date.parse('2026-09-09T17:30:00Z'), forecast({ code: 71, probs: HOURS.map((t, k) => (k >= 10 ? 90 : 5)),
        codes: HOURS.map(() => 73) }));
      assertEqual(snow.text, want.snow, lang + ': snow to the end of the day');

      const cold = await got(NOW, forecast({ hi: 4, lo: -3, probs: HOURS.map(() => 5) }));
      assertEqual(cold.text, want.cold, lang + ': the frost line');
    });
  }

  test('an unreachable language file leaves an English banner, not a broken one', async () => {
    // Same rule the rest of the strings follow: a board in English is a
    // board, a board with "alert_rain" printed on it is not.
    const { run } = runTransform(net(forecast(), null), NOW);
    const r = await run(input(ON, 'fr-FR'));
    assertEqual(without(r.data.service_alert), alert('rain', 'Rain from 17:00 until 18:00 (80%)', 'wi-rain.svg'),
      'got ' + JSON.stringify(r.data.service_alert));
  });

  test('the banner follows the 12-hour setting like every other time on the board', async () => {
    const { run } = runTransform(net(forecast()), NOW);
    const r = await run(input(Object.assign({ time_format: '12h' }, ON)));
    assertEqual((r.data.service_alert || {}).text, 'Rain from 5pm until 6pm (80%)',
      'got ' + JSON.stringify(r.data.service_alert));
  });

  test('a board with no location cannot raise an alert', async () => {
    // Nothing to forecast against. Before service_alert was null-by-default
    // this is the case that would have shipped a banner with a blank in it.
    const { run } = runTransform(net(forecast()), NOW);
    const r = await run(input(Object.assign({ lat_lon: '' }, ON)));
    assertEqual(r.data.service_alert, null, 'got ' + JSON.stringify(r.data.service_alert));
  });

  test('a demo board can show the banner without waiting for real weather', async () => {
    // The demo carries its own forecast (see demo-weather.js) so every part
    // of the map can be seen before anyone has set a location. The banner
    // is part of the map.
    const { run } = runTransform(async () => fail(500), NOW);
    const r = await run(baseInput(NOW, { use_demo_data: 'true', demo_set: 'friends', alert_enabled: 'true', alert_temp_low: '0' }));
    assertEqual(without(r.data.service_alert), alert('snow', 'Snow from 15:00 until 17:00 (80%)', 'wi-snow.svg'),
      'the freezing demo board should demonstrate the banner: ' + JSON.stringify(r.data.service_alert));
  });

  // -------------------------------------------------------------------
  // Nothing in the past.
  //
  // A service alert is a promise about what is COMING. "Rain from 09:00
  // until 10:00" read at seven in the evening is not a warning, it
  // is a wrong statement about a morning everyone already lived through,
  // and it is the easiest banner in the world to ship by accident: the
  // wettest hour of the day is a fact that stops changing at noon, while
  // the board keeps redrawing until midnight.
  //
  // Three ways it happens, all covered below. The forecast is fetched
  // once and read for hours (a board on saved state can be reading one
  // from this morning). The forecast covers the whole run of days, so the
  // wettest hour in the response may belong to a day that is not on the
  // board. And the board can be showing TOMORROW, where every hour is
  // still ahead and today's are all behind.
  // -------------------------------------------------------------------

  // Hours 07:00-21:00 of one date, `by` giving the probability of any
  // hour that is not the quiet 5%.
  function hoursFor(date, by) {
    const t = [], p = [];
    for (let hh = 7; hh <= 21; hh++) {
      t.push(date + 'T' + String(hh).padStart(2, '0') + ':00');
      p.push((by || {})[hh] == null ? 5 : by[hh]);
    }
    return { t: t, p: p };
  }

  // The shape a DAY_SPAN board asks for: daily arrays with one entry per
  // day of the run, one hourly array running across all of them. `codes`
  // is a day's hourly weathercode by hour, anything not named a 3
  // (overcast); with no day carrying any, the codes are left out entirely.
  function forecastDays(days) {
    const t = [], p = [], c = [], g = [];
    const anyCodes = days.some((d) => d.codes);
    // `degs` is a day's hourly temperature by hour, the rest of the day
    // filled in from `fill` (or the day's own low). A day with none is a
    // forecast that answered without them, which is the fallback path.
    const anyDegs = days.some((d) => d.degs);
    days.forEach((d) => {
      const h = hoursFor(d.date, d.by); t.push(...h.t); p.push(...h.p);
      for (let hh = 7; hh <= 21; hh++) c.push(d.codes && d.codes[hh] != null ? d.codes[hh] : 3);
      for (let hh = 7; hh <= 21; hh++) {
        g.push(d.degs && d.degs[hh] != null ? d.degs[hh]
          : (d.fill == null ? (d.lo == null ? 11 : d.lo) : d.fill));
      }
    });
    return JSON.stringify({
      daily: {
        temperature_2m_max: days.map((d) => (d.hi == null ? 18 : d.hi)),
        temperature_2m_min: days.map((d) => (d.lo == null ? 11 : d.lo)),
        precipitation_probability_max: days.map((d) => (d.max == null ? 80 : d.max)),
        weathercode: days.map((d) => (d.code == null ? 61 : d.code)),
        sunrise: days.map((d) => d.date + 'T06:30'), sunset: days.map((d) => d.date + 'T20:30'),
      },
      hourly: Object.assign({ time: t, precipitation_probability: p },
        anyCodes ? { weathercode: c } : {}, anyDegs ? { temperature_2m: g } : {}),
    });
  }

  const D0 = '2026-09-09', D1 = '2026-09-10';
  const BOTH_DAYS = icsWithEvents([
    { start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Afternoon' },
    { start: '20260910T140000Z', end: '20260910T150000Z', summary: 'Tomorrow afternoon' },
  ]);

  function netAt(body) {
    return async (url) => {
      if (String(url).indexOf('api.open-meteo.com') >= 0) return body == null ? fail(500) : okText(body);
      if (String(url).indexOf('/i18n/') >= 0) return fail(404);
      return okText(BOTH_DAYS);
    };
  }

  function at(hh, mm) { return Date.parse('2026-09-09T' + String(hh).padStart(2, '0') + ':' + String(mm == null ? '00' : mm) + ':00Z'); }

  function inputAt(now, fields) {
    return baseInput(now, Object.assign({
      use_demo_data: 'false',
      lat_lon: '51.05,3.72',
      config_json: JSON.stringify({ calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }] }),
    }, fields));
  }

  async function alertAt(now, body, fields) {
    const r = await runTransform(netAt(body), now).run(inputAt(now, Object.assign({}, ON, fields)));
    return r.data.service_alert;
  }

  test('the wettest hour of the day is not an alert once it has gone', async () => {
    // 09:00 was the wet hour, it is now 15:00, and nothing later comes
    // near the threshold. There is no alert to raise: the day the reader
    // is being warned about is over.
    const a = await alertAt(at(15), forecastDays([{ date: D0, by: { 9: 90 } }]));
    assertEqual(a, null, 'got ' + JSON.stringify(a));
  });

  test('when the wettest hour has gone, the banner names the wettest one still to come', async () => {
    // Not merely silence: 18:00 is over the threshold too, and it is the
    // hour worth moving something out of. Suppressing the banner outright
    // here would lose a real warning to a technicality about 09:00.
    const a = await alertAt(at(15), forecastDays([{ date: D0, by: { 9: 90, 18: 75 } }]));
    assertEqual((a || {}).text, 'Rain from 18:00 until 19:00 (75%)', 'got ' + JSON.stringify(a));
  });

  test('the hour that is happening right now is still ahead enough to warn about', async () => {
    // The boundary. At 15:00 exactly the 15:00 hour is the rain starting,
    // not rain that has been and gone, and at 15:59 it is still falling.
    // At 16:00 it is over.
    const body = forecastDays([{ date: D0, by: { 15: 85 } }]);
    const a = await alertAt(at(15), body);
    assertEqual((a || {}).text, 'Rain until 16:00 (85%)', 'got ' + JSON.stringify(a));
    const late = await alertAt(at(15, 59), body);
    assertEqual((late || {}).text, 'Rain until 16:00 (85%)', 'got ' + JSON.stringify(late));
    const over = await alertAt(at(16), body);
    assertEqual(over, null, 'an hour that ended still alerted: ' + JSON.stringify(over));
  });

  // -------------------------------------------------------------------
  // When it ENDS.
  //
  // "If raining or snow or whatever, try to be specific when it ends."
  // Rain at 14:00 is a coat; rain until 17:00 is whether to wait it out.
  // The spell is the run of wet hours around the next one still to come.
  // -------------------------------------------------------------------

  test('a spell ahead is named from its first hour to the end of its last', async () => {
    const a = await alertAt(at(9), forecastDays([{ date: D0, by: { 14: 75, 15: 90, 16: 72, 17: 40 } }]));
    assertEqual((a || {}).text, 'Rain from 14:00 until 17:00 (90%)', 'got ' + JSON.stringify(a));
  });

  test('once it has started the banner says only when it stops', async () => {
    // And the chance is the likeliest hour still AHEAD: the 95% at 13:00 is
    // behind us at 14:20.
    const a = await alertAt(at(14, 20), forecastDays([{ date: D0, by: { 13: 95, 14: 80, 15: 75 } }]));
    assertEqual((a || {}).text, 'Rain until 16:00 (80%)', 'got ' + JSON.stringify(a));
  });

  test('a spell that runs past the last hour has no end to name', async () => {
    // The hours stop at the end of the board's day, so there is no
    // "until": naming 22:00 would be inventing when it stops.
    const body = forecastDays([{ date: D0, by: { 19: 80, 20: 85, 21: 90 } }]);
    const ahead = await alertAt(at(9), body);
    assertEqual((ahead || {}).text, 'Rain from 19:00 into the night (90%)', 'got ' + JSON.stringify(ahead));
    const started = await alertAt(at(19, 30), body);
    assertEqual((started || {}).text, 'Rain for the rest of the day (90%)', 'got ' + JSON.stringify(started));
  });

  test('the NEXT spell is the banner, not the wettest one', async () => {
    // A 72% spell at 10:00 comes before the 95% one at 18:00, and it is the
    // one somebody walking out of the door at 09:30 walks into.
    const a = await alertAt(at(9), forecastDays([{ date: D0, by: { 10: 72, 18: 95 } }]));
    assertEqual((a || {}).text, 'Rain from 10:00 until 11:00 (72%)', 'got ' + JSON.stringify(a));
  });

  test('a dry hour in the middle is two spells, and the banner names the first', async () => {
    const a = await alertAt(at(9), forecastDays([{ date: D0, by: { 12: 80, 13: 20, 14: 80, 15: 80 } }]));
    assertEqual((a || {}).text, 'Rain from 12:00 until 13:00 (80%)', 'got ' + JSON.stringify(a));
  });

  test('the hourly codes name snow and thunderstorms, each with its own icon', async () => {
    // The day's own condition is rain (61) in both: it is the hours that
    // say what falls, and the banner is about the hours it names.
    const snow = await alertAt(at(9), forecastDays([{ date: D0, by: { 11: 60, 12: 70 }, codes: { 11: 71, 12: 73 } }]));
    assertEqual(without(snow), alert('snow', 'Snow from 11:00 until 13:00 (70%)', 'wi-snow.svg'),
      'got ' + JSON.stringify(snow));
    const storms = await alertAt(at(9), forecastDays([{ date: D0, by: { 16: 55, 17: 65 }, codes: { 16: 95, 17: 96 } }]));
    assertEqual(without(storms), alert('storms', 'Thunderstorms from 16:00 until 18:00 (65%)', 'wi-thunderstorm.svg'),
      'got ' + JSON.stringify(storms));
  });

  test('thunderstorms alert under the rain line, and outrank the rain before them', async () => {
    // 55% is under a rain threshold of 70 but it is a thunderstorm, which
    // alerts once it is likely at all; and it wins over the 90% shower
    // earlier, the way snow does.
    const a = await alertAt(at(9), forecastDays([{ date: D0, by: { 10: 90, 19: 55 }, codes: { 10: 61, 19: 95 } }]));
    assertEqual((a || {}).text, 'Thunderstorms from 19:00 until 20:00 (55%)', 'got ' + JSON.stringify(a));
    const unlikely = await alertAt(at(9), forecastDays([{ date: D0, by: { 19: 40 }, codes: { 19: 95 } }]));
    assertEqual(unlikely, null, 'a 40% thunderstorm alerted: ' + JSON.stringify(unlikely));
  });

  test('a dry code on a wet hour is still the rain the reader drew the line on', async () => {
    // Two models, two numbers: the probability says 85% while the code says
    // overcast. The threshold is on the probability.
    const a = await alertAt(at(9), forecastDays([{ date: D0, by: { 12: 85 }, codes: { 12: 3 } }]));
    assertEqual((a || {}).text, 'Rain from 12:00 until 13:00 (85%)', 'got ' + JSON.stringify(a));
  });

  test('hours saved without codes read as their day did', async () => {
    // An older build saved hours with no weathercode. A snowy day's wet
    // hours were snow then and are snow now; nothing is called a
    // thunderstorm that no forecast hour called one.
    const saved = { weather: { hi: 1, lo: -3, condition: 'snow', unit: 'C', date: D0,
      perDay: [{ hi: 1, lo: -3, condition: 'snow', hours: [{ atMin: 600, pct: 80 }, { atMin: 660, pct: 85 }, { atMin: 720, pct: 5 }] }] },
      weatherFetchedAt: Math.floor(at(8) / 1000) };
    const i = inputAt(at(8), ON);
    i.trmnl.state = saved;
    const r = await runTransform(netAt(null), at(8)).run(i);
    assertEqual(without(r.data.service_alert), alert('snow', 'Snow from 10:00 until 12:00 (85%)', 'wi-snow.svg'),
      'got ' + JSON.stringify(r.data.service_alert));

    const stormy = { weather: { hi: 20, lo: 14, condition: 'storms', unit: 'C', date: D0,
      perDay: [{ hi: 20, lo: 14, condition: 'storms', hours: [{ atMin: 600, pct: 80 }] }] },
      weatherFetchedAt: saved.weatherFetchedAt };
    const j = inputAt(at(8), ON);
    j.trmnl.state = stormy;
    const s = await runTransform(netAt(null), at(8)).run(j);
    assertEqual((s.data.service_alert || {}).kind, 'rain', 'an hour with no code was called a thunderstorm: '
      + JSON.stringify(s.data.service_alert));
  });

  test('the codes come in the same one request and are saved with the hours', async () => {
    const seen = [];
    const body = forecastDays([{ date: D0, by: { 12: 85 }, codes: { 12: 63 } }]);
    const r = await runTransform(async (url) => {
      seen.push(String(url));
      if (String(url).indexOf('api.open-meteo.com') >= 0) return okText(body);
      if (String(url).indexOf('/i18n/') >= 0) return fail(404);
      return okText(BOTH_DAYS);
    }, at(8)).run(inputAt(at(8), ON));
    const wx = seen.filter((u) => u.indexOf('api.open-meteo.com') >= 0);
    assertEqual(wx.length, 1, 'the forecast API calls');
    assert(/hourly=precipitation_probability%2Cweathercode/.test(wx[0]), 'hourly codes were not asked for: ' + wx[0]);
    assertEqual(r.trmnl_state.weather.perDay[0].hours[5], { atMin: 12 * 60, pct: 85, code: 63 }, 'the saved hour');
  });

  test('a snowy morning read in the evening raises nothing', async () => {
    // Snow outranks every other kind, which is exactly why it must be
    // held to the same clock: the ranking would otherwise let the one
    // banner on the board be the most confidently wrong of them.
    const a = await alertAt(at(19), forecastDays([{ date: D0, code: 71, by: { 9: 90 } }]));
    assertEqual(a, null, 'got ' + JSON.stringify(a));

    // And it must not reach for a dry hour just to have one to name: the
    // evening it falls back to has to be an hour it is really snowing in.
    const dry = await alertAt(at(19), forecastDays([{ date: D0, code: 71, by: { 9: 90, 20: 30 } }]));
    assertEqual(dry, null, 'named a 30% hour as heavy snow: ' + JSON.stringify(dry));

    const late = await alertAt(at(19), forecastDays([{ date: D0, code: 71, by: { 9: 90, 20: 80 } }]));
    assertEqual((late || {}).text, 'Snow from 20:00 until 21:00 (80%)',
      'snow still to come is still an alert: ' + JSON.stringify(late));
  });

  // ---------------------------------------------- cold and heat, by the hour
  //
  // These were facts about a whole DAY, read off the daily max and min, and
  // they named no hour: a board at eight in the evening went on warning about
  // an afternoon that was over, and the minimum it warned about was usually
  // five in the morning, hours before anyone looked at it. They are held to
  // the clock now, the way rain always was, and they say which stretch of the
  // day they are about.
  const HOT = { alert_temp_high: '35' };

  test('heat is the stretch of the day that is hot, and says which stretch', async () => {
    const a = await alertAt(at(9), forecastDays([
      { date: D0, hi: 36, lo: 24, fill: 24, degs: { 13: 35, 14: 36, 15: 36, 16: 35 } },
    ]), HOT);
    assertEqual(without(a), alert('heat', 'Hot, up to 36°C (13:00–17:00)', 'wi-hot.svg'),
      'got ' + JSON.stringify(a));
  });

  test('heat that is over is not an alert, however hot the day was', async () => {
    // The case the whole change is for. Same day, same 36 degrees, read at
    // eight in the evening: there is nothing coming, so there is nothing to
    // say, and the banner gives its band back to the map.
    const a = await alertAt(at(20), forecastDays([
      { date: D0, hi: 36, lo: 24, fill: 24, degs: { 13: 35, 14: 36, 15: 36, 16: 35 } },
    ]), HOT);
    assertEqual(a, null, 'warned at eight in the evening about an afternoon that was over: '
      + JSON.stringify(a));
  });

  test('cold at dawn is an alert at dawn and not at lunchtime', async () => {
    const day = [{ date: D0, hi: 9, lo: -4, fill: 8, degs: { 7: -4, 8: -2 } }];
    const early = await alertAt(at(7), forecastDays(day));
    assertEqual(without(early), alert('cold', 'Freezing, down to -4°C (07:00–09:00)',
      'wi-snowflake-cold.svg'), 'got ' + JSON.stringify(early));

    const late = await alertAt(at(12), forecastDays(day));
    assertEqual(late, null, 'still warning about frost at midday: ' + JSON.stringify(late));
  });

  test('the stretch opens at the hour you are standing in, not before it', async () => {
    // Hot since eleven, read at half past one. The range that matters is the
    // one still to come: an alert is a promise about what is coming, and a
    // reader does not need to be told about their own morning.
    const a = await alertAt(at(13, 30), forecastDays([
      { date: D0, hi: 38, lo: 24, fill: 24, degs: { 11: 36, 12: 38, 13: 37, 14: 36, 15: 35 } },
    ]), HOT);
    // ...and the degree is the extreme of THAT stretch: the 38 at noon has
    // been and gone, so promising it again would be promising the past.
    assertEqual(without(a), alert('heat', 'Hot, up to 37°C (13:00–16:00)', 'wi-hot.svg'),
      'got ' + JSON.stringify(a));
  });

  test('a single hot hour is still a stretch, with both its ends', async () => {
    const a = await alertAt(at(9), forecastDays([
      { date: D0, hi: 36, lo: 24, fill: 24, degs: { 15: 36 } },
    ]), HOT);
    assertEqual((a || {}).text, 'Hot, up to 36°C (15:00–16:00)', 'got ' + JSON.stringify(a));
  });

  test('a day whose hours carry no temperature is still read as a whole day', async () => {
    // The fallback, and the shape every older snapshot has: no hourly
    // temperature to hold anything to, so the day's own figures are all
    // there is and the sentence carries no stretch.
    const a = await alertAt(at(20), forecastDays([{ date: D0, hi: 36, lo: 24, by: { 9: 90 } }]), HOT);
    assertEqual(without(a), alert('heat', 'Hot, up to 36°C', 'wi-hot.svg'), 'got ' + JSON.stringify(a));
  });

  test('the stretch is lit and the sentence around it is not', async () => {
    const a = await alertAt(at(9), forecastDays([
      { date: D0, hi: 36, lo: 24, fill: 24, degs: { 13: 36, 14: 36 } },
    ]), HOT);
    assertEqual(a.parts.map((q) => q.t).join(''), a.text, 'the pieces do not spell the line');
    assertEqual(a.parts.filter((q) => q.s === 'p').map((q) => q.t), ['Hot'],
      'the thing itself is not the badged one: ' + JSON.stringify(a.parts));
    const lit = a.parts.filter((q) => q.s === '').map((q) => q.t).join('');
    assert(lit.indexOf('13:00') >= 0 && lit.indexOf('15:00') >= 0,
      'the clocks went quiet: ' + JSON.stringify(a.parts));
  });

  test('the wettest hour of TOMORROW is not an alert about today', async () => {
    // The forecast covers the run of days, not the day on the board. Read
    // straight through, the 95% at 17:00 tomorrow becomes "expected at
    // 17:00" on a board whose own day never goes above 20%.
    const a = await alertAt(at(9), forecastDays([
      { date: D0, max: 20, by: {} },
      { date: D1, max: 95, by: { 17: 95 } },
    ]));
    assertEqual(a, null, 'got ' + JSON.stringify(a));
  });

  // TWO CASES HERE NEEDED A BOARD SET TO TOMORROW, and nothing draws one now.
  //
  // They checked that such a board was warned about ITS day rather than
  // today's, and that an early hour on it counted as ahead rather than
  // behind -- the clock bounds the day it belongs to, so 08:00 tomorrow is
  // still to come at eight in the evening today. Both were about the day
  // index travelling with the alert. The half that survives is below: the
  // banner is about the day the board is drawing, asked of the day it draws.

  test('the banner is about the day the board is drawing', async () => {
    // An alert about a day that is not on the screen is an alert about
    // nothing. Both days are in the forecast and only one is on the board, so
    // a banner naming tomorrow's rain would be naming weather nobody can see.
    const body = forecastDays([
      { date: D0, max: 88, by: { 9: 88 } },
      { date: D1, max: 92, by: { 16: 92 } },
    ]);
    const a = await alertAt(at(9), body);
    assertEqual((a || {}).text, 'Rain until 10:00 (88%)',
      'the banner should be about today: ' + JSON.stringify(a));
  });

  test('a board replaying this morning\'s snapshot does not replay this morning\'s alert', async () => {
    // The one that actually reaches a wall. The API answered at 08:00 and
    // has been down since; the device is still drawing, and at 19:00 the
    // saved snapshot's wettest hour is nine hours old.
    const morning = await runTransform(netAt(forecastDays([{ date: D0, by: { 9: 90 } }])), at(8))
      .run(inputAt(at(8), ON));
    assertEqual((morning.data.service_alert || {}).text, 'Rain from 09:00 until 10:00 (90%)',
      'the morning board should warn about the morning');
    const saved = JSON.parse(JSON.stringify(morning.trmnl_state));

    const evening = await runTransform(netAt(null), at(19)).run(
      Object.assign(inputAt(at(19), ON), { trmnl: Object.assign({}, inputAt(at(19), ON).trmnl, { state: saved }) }));
    assertEqual(evening.data.service_alert, null,
      'the evening board replayed the morning: ' + JSON.stringify(evening.data.service_alert));
  });

  test('a snapshot with only a wettest hour behind it is still held to the clock', async () => {
    // A build older than the hourly detail saved one hour and one
    // probability. There is nothing to fall back to, so the banner has to
    // go rather than name the hour it has.
    const saved = { weather: { hi: 18, lo: 11, condition: 'rain', icon: 'wi-day-rain.svg', rain_chance: 90,
      unit: 'C', peak: { atMin: 9 * 60, pct: 90 } }, weatherFetchedAt: Math.floor(at(8) / 1000) };
    const i = inputAt(at(15), ON);
    i.trmnl.state = saved;
    const r = await runTransform(netAt(null), at(15)).run(i);
    assertEqual(r.data.service_alert, null, 'got ' + JSON.stringify(r.data.service_alert));

    const early = inputAt(at(8), ON);
    early.trmnl.state = saved;
    const still = await runTransform(netAt(null), at(8)).run(early);
    assertEqual(without(still.data.service_alert), alert('rain', 'Rain around 09:00 (90%)', 'wi-rain.svg'),
      'the same snapshot read before the hour is a real warning: ' + JSON.stringify(still.data.service_alert));
  });

  test('the demo board obeys the clock like a real one', async () => {
    // The demo carries a fixed forecast, so it is the one board where a
    // wettest hour is guaranteed to be in the past every single evening.
    const late = await runTransform(async () => fail(500), at(20)).run(
      baseInput(at(20), { use_demo_data: 'true', demo_set: 'simpsons', alert_enabled: 'true', alert_rain_threshold: '50' }));
    assertEqual(late.data.service_alert, null,
      'the demo raised an alert about an hour that has gone: ' + JSON.stringify(late.data.service_alert));
  });

  test('the hourly detail behind the alert is saved, per day', async () => {
    // The banner is composed at draw time, not at fetch time, which only
    // works if the snapshot carries enough to re-pick an hour later.
    const r = await runTransform(netAt(forecastDays([
      { date: D0, by: { 9: 90, 18: 75 } },
      { date: D1, by: { 17: 95 } },
    ])), at(8)).run(inputAt(at(8), ON));
    const w = r.trmnl_state.weather;
    assert(w && Array.isArray(w.perDay) && w.perDay.length === 2, 'expected two days: ' + JSON.stringify(w && w.perDay));
    assertEqual(w.perDay[0].peak, { atMin: 9 * 60, pct: 90 }, 'day 0 wettest hour');
    assertEqual(w.perDay[1].peak, { atMin: 17 * 60, pct: 95 }, 'day 1 wettest hour');
    assert(w.perDay[0].hours.length === 15, 'day 0 should carry 07:00-21:00: ' + JSON.stringify(w.perDay[0].hours));
    assertEqual(w.perDay[0].hours[11], { atMin: 18 * 60, pct: 75 }, 'the hours are the day\'s own');
  });

  test('a snapshot that outlived its own day is read as the day it describes', async () => {
    // Fetched at 23:30 and still being drawn at 04:00, which is under the
    // six hours that flags a forecast stale, so nothing else catches it.
    // The snapshot's first day is YESTERDAY by then. Indexed as though it
    // were today, its 09:00 rain becomes this morning's alert, an hour
    // that is both in the past and on the wrong day.
    const body = forecastDays([
      { date: D0, by: { 9: 90 } },
      { date: D1, by: { 16: 85 } },
    ]);
    const lateNight = Date.parse('2026-09-09T23:30:00Z');
    const first = await runTransform(netAt(body), lateNight).run(inputAt(lateNight, ON));
    const saved = JSON.parse(JSON.stringify(first.trmnl_state));
    assertEqual(saved.weather.date, D0, 'the snapshot should record which day it starts on');

    const smallHours = Date.parse('2026-09-10T04:00:00Z');
    const i = inputAt(smallHours, ON);
    i.trmnl.state = saved;
    const r = await runTransform(netAt(null), smallHours).run(i);
    assertEqual((r.data.service_alert || {}).text, 'Rain from 16:00 until 17:00 (85%)',
      'the morning after should be warned about the morning after: ' + JSON.stringify(r.data.service_alert));
  });

  test('a snapshot older than the run it covers says nothing rather than something wrong', async () => {
    const body = forecastDays([{ date: D0, by: { 9: 90 } }, { date: D1, by: { 16: 85 } }]);
    const first = await runTransform(netAt(body), at(8)).run(inputAt(at(8), ON));
    const saved = JSON.parse(JSON.stringify(first.trmnl_state));

    const twoDaysOn = Date.parse('2026-09-11T08:00:00Z');
    const i = inputAt(twoDaysOn, ON);
    i.trmnl.state = saved;
    const r = await runTransform(netAt(null), twoDaysOn).run(i);
    assertEqual(r.data.service_alert, null,
      'a forecast that ran out raised an alert anyway: ' + JSON.stringify(r.data.service_alert));
  });
};
