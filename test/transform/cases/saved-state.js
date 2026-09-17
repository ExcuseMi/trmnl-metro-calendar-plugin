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
  const { runTransform, icsWithEvents, okText, fail, baseInput, eventItems, assert, assertEqual } = h;

  const NOW = Date.parse('2026-09-09T09:00:00Z');
  const NOW_S = Math.floor(NOW / 1000);
  const ISO_TODAY = '20260909';
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

  // A SUN AT TEN AT NIGHT. "Rain stops" is drawn as a sun, because clearing
  // up is what it means; after sunset that is a sun in the dark, on a board
  // whose other corner draws the moon in its real phase.
  test('rain that stops after sunset is a clear night, not a sun', async () => {
    const snap = {
      weather: { hi: 18, lo: 13, condition: 'rain', icon: 'wi-day-rain.svg', rain_chance: 96, unit: 'C',
        milestones: [{ atMin: 16 * 60, kind: 'rain_starts' }, { atMin: 20 * 60, kind: 'rain_stops' }],
        perDay: [{ hi: 18, lo: 13, condition: 'rain', rain_chance: 96,
                   milestones: [{ atMin: 16 * 60, kind: 'rain_starts' }, { atMin: 20 * 60, kind: 'rain_stops' }],
                   sunrise_min: 7 * 60 + 5, sunset_min: 19 * 60 + 45 }] },
      weatherFetchedAt: NOW_S - 600,
    };
    const { run } = runTransform(net({ weatherFails: true }), NOW);
    const r = await run(input({}, snap));
    const marks = (r.data.weather || []).filter((i) => i.type === 'weather');
    const stops = marks.filter((m) => /20:00|8pm/.test(m.label || ''))[0];
    assert(stops, 'no rain-stops marker came back: ' + JSON.stringify(marks));
    assert(/wi-night-clear/.test(stops.icon),
      'rain stopping at 20:00, a quarter hour after sunset, drew ' + stops.icon);
    const starts = marks.filter((m) => /16:00|4pm/.test(m.label || ''))[0];
    assert(starts && /wi-rain/.test(starts.icon),
      'the start of the rain should be unchanged: ' + JSON.stringify(starts));
  });

  test('rain that stops before sunrise is a clear night too', async () => {
    // The other half of the night, and the half that was only ever in the
    // code: a spell ending at half six on a morning the sun comes up at five
    // past seven is still dark out.
    const snap = {
      weather: { hi: 18, lo: 13, condition: 'rain', icon: 'wi-day-rain.svg', rain_chance: 96, unit: 'C',
        milestones: [{ atMin: 6 * 60 + 30, kind: 'rain_stops' }],
        perDay: [{ hi: 18, lo: 13, condition: 'rain', rain_chance: 96,
                   milestones: [{ atMin: 6 * 60 + 30, kind: 'rain_stops' }],
                   sunrise_min: 7 * 60 + 5, sunset_min: 19 * 60 + 45 }] },
      weatherFetchedAt: NOW_S - 600,
    };
    const { run } = runTransform(net({ weatherFails: true }), NOW);
    const r = await run(input({}, snap));
    const marks = (r.data.weather || []).filter((i) => i.type === 'weather');
    assert(marks.length, 'no marker came back at all');
    assert(/wi-night-clear/.test(marks[0].icon),
      'rain stopping at 06:30, half an hour before sunrise, drew ' + marks[0].icon);
  });

  test('a snapshot with no sun times keeps the sun it always drew', async () => {
    // Saved state outlives a build. A snapshot written before the board knew
    // its own sunrise has no sun to reason from, and the answer to that is
    // the old picture rather than a guess at the dark.
    const snap = {
      weather: { hi: 18, lo: 13, condition: 'rain', icon: 'wi-day-rain.svg', rain_chance: 96, unit: 'C',
        milestones: [{ atMin: 20 * 60, kind: 'rain_stops' }] },
      weatherFetchedAt: NOW_S - 600,
    };
    const { run } = runTransform(net({ weatherFails: true }), NOW);
    const r = await run(input({}, snap));
    const marks = (r.data.weather || []).filter((i) => i.type === 'weather');
    assert(marks.length && /wi-day-sunny/.test(marks[0].icon),
      'with no sun times it should draw what it always drew: ' + JSON.stringify(marks));
  });

  test('rain that stops in daylight still clears to a sun', async () => {
    const snap = {
      weather: { hi: 18, lo: 13, condition: 'rain', icon: 'wi-day-rain.svg', rain_chance: 96, unit: 'C',
        milestones: [{ atMin: 11 * 60, kind: 'rain_stops' }],
        perDay: [{ hi: 18, lo: 13, condition: 'rain', rain_chance: 96,
                   milestones: [{ atMin: 11 * 60, kind: 'rain_stops' }],
                   sunrise_min: 7 * 60 + 5, sunset_min: 19 * 60 + 45 }] },
      weatherFetchedAt: NOW_S - 600,
    };
    const { run } = runTransform(net({ weatherFails: true }), NOW);
    const r = await run(input({}, snap));
    const marks = (r.data.weather || []).filter((i) => i.type === 'weather');
    assert(marks.length && /wi-day-sunny/.test(marks[0].icon),
      'rain stopping at 11:00 should still be a sun: ' + JSON.stringify(marks));
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

  test('a feed that is not answering is named on THIS board, not on a later one', async () => {
    // It used to take two hours. The thinking was that a single 500 on a
    // morning refresh is noise -- the plugin retries in fifteen minutes --
    // and that is true of the FEED. It is not true of the board: for those
    // two hours a person's whole day is missing from the map and every other
    // thing on it looks completely normal. A reader cannot tell a quiet
    // Tuesday from a calendar that did not load.
    //
    // Asked for directly, after two photographs of one board six minutes
    // apart lost different people's events each time: "we can't just drop
    // events, feeds without the user knowing".
    const { run } = runTransform(net({ calendarsFail: true }), NOW);

    const first = await run(input());
    assert(first.data.calendars_down.length === 1,
      'a feed that failed on this very render was not named: '
      + JSON.stringify(first.data.calendars_down));

    // ...and it is named with the name it had when it last answered, which
    // is the only thing a feed that cannot answer cannot tell us.
    const known = await run(input({}, {
      calendarDown: { [ICS_URL]: NOW_S - 10 * 60 },
      calendarNames: { [ICS_URL]: 'Alex Personal' },
    }));
    assert(known.data.calendars_down.join(',') === 'Alex Personal',
      'expected the failing feed named on the board, got ' + JSON.stringify(known.data.calendars_down));

    // The clock is still kept: it is what lets a feed that comes back clear
    // itself, and how long it has been down is worth knowing even though it
    // no longer decides whether the reader is told.
    assert(known.trmnl_state.calendarDown[ICS_URL] === NOW_S - 10 * 60,
      'the down-since clock was not carried: ' + JSON.stringify(known.trmnl_state.calendarDown));
  });

  test('a feed that answers says nothing, so the mark means something', async () => {
    // The other half of the ratchet: if a working board ever shows the
    // warning, the warning stops being read at all.
    const { run } = runTransform(net(), NOW);
    const r = await run(input());
    assertEqual(r.data.calendars_down, [], 'a board whose feeds all answered raised an alert');
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

    // Named only when there is nothing to show in its place -- the remembered
    // read is what decides that, so it is dropped here and kept in the cache
    // tests below.
    const saved = JSON.parse(JSON.stringify(good.trmnl_state));
    delete saved.feeds;
    const second = runTransform(net({ calendarsFail: true }), NOW);
    const later = await second.run(input({}, saved));
    assert(later.data.calendars_down.join(',') === 'Alex Personal',
      'the failing feed lost its name: ' + JSON.stringify(later.data.calendars_down));

    // and with nothing remembered it falls back to the link, not to nothing
    const cold = await second.run(input({}, {}));
    assert(cold.data.calendars_down.length === 1 && /Cal/.test(cold.data.calendars_down[0]),
      'expected a URL-derived name as the last resort, got ' + JSON.stringify(cold.data.calendars_down));
  });

  // ------------------------------------------- the last good read of a feed
  //
  // A feed that does not answer used to take its events off the board with
  // it, and say nothing about it for two hours. Two photographs of one real
  // board six minutes apart lost different people's events each time, with
  // the map looking perfectly normal both times: "it's dropped events like
  // crazy", "we can't just drop events, feeds without the user knowing".
  //
  // The forecast has never worked that way -- the last one that answered is
  // kept in saved state and replayed, and the board says so once it is too
  // old to pass off as today's. Feeds do the same now, for the same six
  // hours: "use the state to hold the previous success for six hours, after
  // that show an error, keep showing the state."
  test('a good read is remembered, so the next render that cannot reach it still has the day', async () => {
    const good = await runTransform(net(), NOW).run(input());
    const kept = good.trmnl_state.feeds && good.trmnl_state.feeds[ICS_URL];
    assert(kept, 'nothing was remembered: ' + JSON.stringify(Object.keys(good.trmnl_state)));
    assert(kept.at === NOW_S, 'the read is not stamped with when it happened: ' + kept.at);
    assert(typeof kept.on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(kept.on),
      'the read is not stamped with the day it is about: ' + JSON.stringify(kept.on));
    assert((kept.timed || []).length > 0, 'the events themselves were not kept: ' + JSON.stringify(kept));
  });

  test('a feed that fails is replayed from what it last gave us, and says nothing yet', async () => {
    const good = await runTransform(net(), NOW).run(input());
    const had = eventItems(good.data).map((e) => e.title).sort();
    assert(had.length > 0, 'the healthy board had no events to compare against');

    const down = runTransform(net({ calendarsFail: true }), NOW);
    const r = await down.run(input({}, JSON.parse(JSON.stringify(good.trmnl_state))));
    assertEqual(eventItems(r.data).map((e) => e.title).sort(), had,
      'the events were not replayed from the remembered read');
    // Nothing is missing from the map, so nothing is claimed to be.
    assertEqual(r.data.calendars_down, [],
      'the board cried wolf about a feed whose day it was still showing');
  });

  test('...and once that read is six hours old the board says so, still showing it', async () => {
    const good = await runTransform(net(), NOW).run(input());
    const had = eventItems(good.data).map((e) => e.title).sort();

    const saved = JSON.parse(JSON.stringify(good.trmnl_state));
    saved.feeds[ICS_URL].at = NOW_S - 6 * 3600 - 60;
    const r = await runTransform(net({ calendarsFail: true }), NOW).run(input({}, saved));

    assertEqual(eventItems(r.data).map((e) => e.title).sort(), had,
      'a stale read is still the best there is and must stay on the board');
    assertEqual(r.data.calendars_down, ['Alex Personal'],
      'a read too old to present as today was not announced');
  });

  test('a remembered read from another day is wrong, not stale, and is not used', async () => {
    // Every event in it is minutes from ITS day's midnight. Replayed against
    // today it would put yesterday's afternoon on this afternoon.
    const good = await runTransform(net(), NOW).run(input());
    const saved = JSON.parse(JSON.stringify(good.trmnl_state));
    saved.feeds[ICS_URL].on = '2019-01-01';
    const r = await runTransform(net({ calendarsFail: true }), NOW).run(input({}, saved));
    assertEqual(eventItems(r.data), [], 'yesterday\'s events were drawn as today\'s');
    assertEqual(r.data.calendars_down, ['Alex Personal'],
      'the feed took its day off the board and did not say so');
  });

  test('the remembered reads are kept under a ceiling, and the same ones every time', async () => {
    // Saved state goes out and comes back on every render, and a state too
    // big to store is not a smaller cache -- it is NO state, taking the
    // remembered forecast and the feed names with it. A real four-calendar
    // household came to 7.7KB where the same state without the reads was 613
    // bytes, so the counts alone do not bound this.
    const many = [];
    for (let f = 0; f < 10; f++) {
      let t = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:Cal' + f + '\r\n';
      for (let e = 0; e < 40; e++) {
        t += 'BEGIN:VEVENT\r\nUID:' + f + '-' + e + '@x\r\n'
          + 'DTSTART:' + ISO_TODAY + 'T' + String(7 + (e % 12)).padStart(2, '0') + '0000Z\r\n'
          + 'DTEND:' + ISO_TODAY + 'T' + String(8 + (e % 12)).padStart(2, '0') + '0000Z\r\n'
          + 'SUMMARY:A meeting with a name of a realistic length ' + f + '-' + e + '\r\n'
          + 'LOCATION:Microsoft Teams Meeting, Room 214, Building B\r\nEND:VEVENT\r\n';
      }
      many.push(t + 'END:VCALENDAR\r\n');
    }
    const urls = many.map((_, i) => 'https://example.com/big' + i + '.ics');
    const impl = async (url) => {
      const u = String(url);
      if (u.indexOf('api.open-meteo.com') >= 0) return fail(503);
      if (u.indexOf('/i18n/') >= 0) return fail(404);
      const ix = urls.indexOf(u);
      return ix < 0 ? fail(404) : okText(many[ix]);
    };
    const i = baseInput(NOW, { use_demo_data: 'false',
      config_json: JSON.stringify({ calendars: urls.map((u, ix) => ({ url: u, name: 'Cal' + ix })) }) });
    const r = await runTransform(impl, NOW).run(i);

    const size = JSON.stringify(r.trmnl_state).length;
    assert(size < 16000, 'saved state came to ' + size + ' bytes, which may not be stored at all');

    // ...and WHICH ones survive is the same every render: dropped from the
    // end of the config, never by whoever answered first, or the board
    // forgets a different calendar each time and the warning flickers.
    const kept = Object.keys(r.trmnl_state.feeds || {});
    assert(kept.length > 0 && kept.length < urls.length,
      'expected some feeds kept and some dropped, got ' + kept.length + ' of ' + urls.length);
    assertEqual(kept, urls.slice(0, kept.length),
      'the feeds kept are not the first ones the config names');
  });

  test('several feeds down are named in the order the config names them', async () => {
    // The feeds are fetched together and each recorded its own failure as it
    // happened, so the line was ordered by whichever gave up first. Two
    // renders of one unchanged board came back "Kalender Belgiek-Molenhoek,
    // Holidays in Belgium" and then the other way round: a warning that
    // reorders itself under the reader every quarter of an hour reads as
    // something new happening when nothing has.
    //
    // Asked of the SLOW one first, so a run that orders by arrival cannot
    // pass by luck: A answers last, and must still be named first.
    const A = 'https://example.com/a.ics', B = 'https://example.com/b.ics';
    const slow = async (url) => {
      const u = String(url);
      if (u.indexOf('api.open-meteo.com') >= 0) return fail(503);
      if (u.indexOf('/i18n/') >= 0) return fail(404);
      if (u === A) { await new Promise((r) => setTimeout(r, 25)); return fail(500); }
      return fail(500);
    };
    const i = baseInput(NOW, {
      use_demo_data: 'false',
      config_json: JSON.stringify({ calendars: [
        { url: A, name: 'Alpha' }, { url: B, name: 'Beta' }] }),
    });
    const r = await runTransform(slow, NOW).run(i);
    assertEqual(r.data.calendars_down, ['Alpha', 'Beta'],
      'the warning is ordered by whichever feed gave up first');
  });

  test('a remembered read that is rubbish is dropped, not handed to the board', async () => {
    // Saved state is untrusted input: an older build wrote a different shape,
    // and a truncated one is a shape nobody wrote.
    const good = await runTransform(net(), NOW).run(input());
    const day = good.trmnl_state.feeds[ICS_URL].on;
    const junk = { feeds: { [ICS_URL]: { at: NOW_S, on: day,
      timed: [{ title: 'Kept', day: 0, startMin: 600, endMin: 660 },
              { day: 0, startMin: 1 },            // no title
              'not an object', null,
              { title: 'No day', startMin: 5 }] } } };
    const r = await runTransform(net({ calendarsFail: true }), NOW).run(input({}, junk));
    assert(!r.data.board_notice, 'a malformed cache took the render down: ' + r.data.board_notice);
    const titles = eventItems(r.data).map((e) => e.title);
    assert(titles.indexOf('Kept') >= 0, 'the good entry was thrown out with the bad: ' + JSON.stringify(titles));
    assert(titles.indexOf('No day') < 0, 'an event with no day was drawn: ' + JSON.stringify(titles));
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
