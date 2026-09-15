'use strict';

// The day model, and which day the board draws.
//
// The board draws ONE day. A run of days on one axis was built and thrown
// away: on a panel this size three days of a family's week is three columns
// of an hour each, and what a wall calendar is for is the day you are in.
//
// One exception, and it has a file of its own (cases/rolling.js): a day with
// almost nothing on it borrows the next one, so the run becomes two days and
// the payload carries a window into it. Every case here is about WHICH day
// is drawn and how it is rebased, which is a different question, so they run
// with that stretch switched off rather than with days busy enough to avoid
// it by accident.
//
// What stayed is the day MODEL, because it is right for its own reasons.
// Transform gathers today and tomorrow, and every minute it works in is
// absolute across that pair: 09:00 tomorrow is 1980, not 540. That is what
// lets a recurrence be evaluated per day, an EXDATE be matched to the day
// it names, and an event crossing midnight stay one event. The day being
// SHOWN is then rebased onto its own midnight, so everything downstream
// sees an ordinary single-day board and none of it has to know which day
// it is looking at.

module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, baseInput, assert, assertEqual } = h;

  const NOW = Date.parse('2026-09-09T09:00:00Z');   // a Wednesday
  const DAY = 24 * 60;

  function net(ics) {
    return async (url) => {
      if (String(url).indexOf('api.open-meteo.com') >= 0) {
        return okText(JSON.stringify({
          daily: {
            temperature_2m_max: [18, 21, 15], temperature_2m_min: [11, 13, 9],
            precipitation_probability_max: [10, 80, 40], weathercode: [0, 61, 3],
            sunrise: ['2026-09-09T06:30'], sunset: ['2026-09-09T20:30'],
          },
          hourly: { time: [], precipitation_probability: [] },
        }));
      }
      return okText(ics);
    };
  }
  function input(fields) {
    return baseInput(NOW, Object.assign({
      use_demo_data: 'false', lat_lon: '51.05,3.72',
      config_json: JSON.stringify({ calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }] }),
    }, fields || {}));
  }
  // A DAY WITH ENOUGH ON IT TO STAY ONE DAY. These cases used to ask for a
  // single-day board with `rolling_view: 'one'`; that setting is gone and a
  // quiet day always borrows the next one now, so a case that wants one day
  // has to earn it the way a real board does -- by having a day on it.
  // Something on tomorrow, so a quiet day has a tomorrow worth borrowing.
  // In tomorrow's small hours: a day-long board opened at six reaches five
  // in the morning of the next day and no further.
  const TOMORROW = { start: '20260910T040000Z', end: '20260910T050000Z', summary: 'Tomorrow' };
  const BUSY_TODAY = [
    { start: '20260909T090000Z', end: '20260909T093000Z', summary: 'Standup' },
    { start: '20260909T110000Z', end: '20260909T120000Z', summary: 'Workshop' },
    { start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Today' },
  ];

  test('the payload describes both days, and the client picks between them', async () => {
    // THE CONTRACT CHANGED, AND THIS IS WHERE IT IS WRITTEN DOWN.
    //
    // The payload used to carry exactly the days the board drew, which meant
    // transform chose the span -- in the one place that cannot choose it,
    // since it runs once and four views at four sizes draw the result. It
    // also fed back on itself: the later the window opened the further its
    // 24 hours reached into tomorrow, so trimming the morning bought a night.
    //
    // Now both days go every time and `day.js framed()` cuts against the view
    // it is drawing on. So the count here is a count of what was SENT.
    const busy = await runTransform(net(icsWithEvents(BUSY_TODAY)), NOW).run(input());
    assert(Array.isArray(busy.data.days), 'no days array at all');
    assertEqual(busy.data.days.length, 2, 'both days should be sent, whatever gets drawn');
    assertEqual(busy.data.days[0].start_min, 0, 'the first day does not start at its own midnight');
    assertEqual(busy.data.days[1].start_min, DAY, 'the second day is not a day after the first');

    const quiet = await runTransform(net(icsWithEvents([BUSY_TODAY[2], TOMORROW])), NOW).run(input());
    assertEqual(quiet.data.days.length, 2, 'a quiet board was sent only one day');
  });

  test('the day being drawn is rebased onto its own midnight', async () => {
    // Everything downstream reads minutes from midnight, and none of it
    // should have to know which midnight.
    const r = await runTransform(net(icsWithEvents(BUSY_TODAY)), NOW).run(input());
    const e = r.data.events.find((i) => i && i.title === 'Today');
    assert(e, 'the afternoon event is missing');
    assertEqual(e.start_min, 14 * 60, 'a 14:00 event should be at 840');
    assertEqual(r.data.days[0].start_min, 0, 'the day being shown does not start at zero');
    assertEqual(r.data.days[0].end_min, DAY, 'the day being shown is not a day long');
  });

  test('a busy board draws today and nothing else', async () => {
    // THE SETTING THAT USED TO SAY WHICH DAY IS GONE. "Tomorrow" drew
    // tomorrow all day long, which on a screen on a wall is a board that is
    // wrong every morning: it cannot say what time it is, because now is not
    // on it. What a reader wanted from it they get from the afternoon onward
    // anyway, and with today still underneath.
    const ics = icsWithEvents(BUSY_TODAY.concat([
      { start: '20260910T090000Z', end: '20260910T100000Z', summary: 'Tomorrow Meeting' },
    ]));
    const t = await runTransform(net(ics), NOW).run(input());
    // Tomorrow's meeting is SENT -- the client decides whether a busy
    // Wednesday has room to reach it -- and it is sent at tomorrow's time,
    // which is the part that was ever in doubt.
    assertEqual(t.data.events.map((i) => i.title).sort(),
      ['Standup', 'Today', 'Tomorrow Meeting', 'Workshop'],
      'the payload should carry both days');
    const tm = t.data.events.find((i) => i.title === 'Tomorrow Meeting');
    assertEqual(tm.start_min, DAY + 9 * 60, 'tomorrow\'s meeting is not at tomorrow\'s nine');
  });

  test('a recurrence is evaluated against the day it lands on', async () => {
    // It is Wednesday. A Thursday-only standup is not on a board about
    // Wednesday, and IS on the Thursday a quiet Wednesday borrows. Evaluated
    // against today whichever day it is drawn on, the borrowed day would show
    // Wednesday's meetings at Thursday's date, which is the worst of both.
    // At five in the morning: a day-long board opened at six reaches
    // tomorrow's small hours and no further.
    const rec = { start: '20260903T050000Z', end: '20260903T051500Z', summary: 'Thursday Standup',
      rrule: 'FREQ=WEEKLY;BYDAY=TH' };
    const busy = await runTransform(net(icsWithEvents(BUSY_TODAY.concat([rec]))), NOW).run(input());
    const th = busy.data.events.filter((e) => e.title === 'Thursday Standup');
    // Sent, because both days are always sent, and sent at THURSDAY's five in
    // the morning. The fault this case exists for is a Thursday standup
    // wearing Wednesday's minutes, which would draw it on the wrong day
    // whichever span the client picks.
    assertEqual(th.length, 1, 'the Thursday standup is missing from the day it lands on');
    assertEqual(th[0].start_min, DAY + 5 * 60, 'a Thursday standup is wearing Wednesday\'s minutes');

    const quiet = await runTransform(net(icsWithEvents([rec])), NOW).run(input());
    const t = quiet.data.events.filter((e) => e.title === 'Thursday Standup');
    assertEqual(t.length, 1, 'the Thursday standup is missing from the borrowed Thursday');
    assertEqual(t[0].start_min, DAY + 5 * 60, 'it is not at its own time of day');
  });

  test('the window stays inside the day being drawn, unless the board rolled', async () => {
    const ics = icsWithEvents(BUSY_TODAY.concat([
      { start: '20260909T060000Z', end: '20260909T070000Z', summary: 'Early' },
      { start: '20260909T220000Z', end: '20260909T230000Z', summary: 'Late' },
    ]));
    const r = await runTransform(net(ics), NOW).run(input());
    assert(r.data.day_start_min >= 0, 'the window starts before midnight');
    // The far end is now the far end of what was SENT, and both days are
    // always sent. Where the board actually stops is `framed()`'s, against
    // the view -- there is no view here to ask.
    assert(r.data.day_end_min <= 2 * DAY, 'the payload reaches past the days it gathered');
    assert(r.data.day_end_min > r.data.day_start_min, 'the window is empty');
  });

  test('the forecast is the one for the day it is about', async () => {
    const busy = await runTransform(net(icsWithEvents(BUSY_TODAY)), NOW).run(input());
    assertEqual(busy.data.header_weather.hi, 18, 'today\'s high is not today\'s');
    assertEqual(busy.data.days[0].weather.hi, 18, 'the drawn day carries somebody else\'s weather');

    // ...and the borrowed day carries its own, which is the whole reason a
    // rolling board has two of them.
    const quiet = await runTransform(net(icsWithEvents([BUSY_TODAY[2], TOMORROW])), NOW).run(input());
    assertEqual(quiet.data.days.length, 2, 'a quiet board did not borrow tomorrow');
    assertEqual(quiet.data.days[1].weather.hi, 21,
      'the borrowed day shows today\'s high, which is a fact about the wrong day');
  });

  test('the board is always about today, and says so', async () => {
    // `title_word` names the day when the board is NOT about today. Nothing
    // draws another day outright any more -- a rolling board is today PLUS
    // tomorrow, not tomorrow instead of today -- so it is always null, and
    // the date is always today's.
    // `title_word` is gone with the setting that named another day: nothing
    // draws a day other than today, so there was never a word to carry and
    // the field was read by nothing.
    const r = await runTransform(net(icsWithEvents(BUSY_TODAY)), NOW).run(input());
    assert(r.data.date_label, 'the board carries no date at all');
    assert(r.data.now_min != null, 'a board about today should carry the time');
  });

  test('the board reaches tomorrow by rolling, not by giving up on today', async () => {
    // THIS REPLACES A SETTING. There was a "today, then tomorrow from the
    // evening on" option with an hour beside it, and at that hour the board
    // swapped one day for the other -- a cliff, and a lossy one: at nine it
    // threw away whatever was left of the evening while the family was still
    // standing in front of it. The rolling window reaches tomorrow from four
    // in the afternoon and keeps tonight while it does, which is what that
    // setting was trying to buy. So the setting is gone and this case watches
    // the behaviour that replaced it.
    // A BUSY today on purpose: a day with one thing left on it is quiet, and a
    // quiet day borrows tomorrow at any hour, which is a different rule (see
    // cases/rolling.js). What this case is about is the board reaching
    // tomorrow because today is SPENT, so today has to have had something in
    // it to spend.
    const ics = icsWithEvents([
      { start: '20260909T090000Z', end: '20260909T093000Z', summary: 'Standup' },
      { start: '20260909T110000Z', end: '20260909T120000Z', summary: 'Workshop' },
      { start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Today Meeting' },
      { start: '20260910T090000Z', end: '20260910T100000Z', summary: 'Tomorrow Meeting' },
    ]);
    const at = (iso) => Date.parse(iso);
    const board = async (nowIso, fields) => {
      const when = at(nowIso);
      const r = await runTransform(net(ics), when).run(
        baseInput(when, Object.assign({
          use_demo_data: 'false', lat_lon: '51.05,3.72',
          config_json: JSON.stringify({ calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }] }),
        }, fields)));
      return r.data;
    };
    const morning = await board('2026-09-09T09:00:00Z');
    // Tomorrow's meeting is in the payload at nine in the morning too -- both
    // days always are. What says the morning board is about today is that it
    // is not ROLLING: no window, so the span is the day's, and `framed()` has
    // nothing to reach tomorrow with.
    assertEqual(morning.events.map((i) => i.title).sort(),
      ['Standup', 'Today Meeting', 'Tomorrow Meeting', 'Workshop'],
      'the payload should carry both days');
    assertEqual(h.opened(morning), 6 * 60, 'a morning board opens at six, before the first step');

    // By the evening it carries both, and today is still on it: that is the
    // whole difference from the switch it replaced.
    const evening = await board('2026-09-09T19:00:00Z');
    const titles = evening.events.map((i) => i.title);
    assert(titles.indexOf('Tomorrow Meeting') >= 0,
      'the evening board never reached tomorrow: ' + JSON.stringify(titles));
    assert(titles.indexOf('Today Meeting') >= 0,
      'the evening board dropped today to get there: ' + JSON.stringify(titles));

    // ...AND MOSTLY TOMORROW ONCE TODAY IS SPENT. Read at ten at night the
    // board opens at five in the afternoon, so almost everything left in
    // front of it belongs to the next day.
    const late = await board('2026-09-09T22:00:00Z');
    assertEqual(h.opened(late), 17 * 60, 'a board read late should have shed the day behind it');
    assertEqual(late.day_end_min, 48 * 60, 'the payload should carry the whole run it gathered');
    assert(late.events.some((e) => e.title === 'Tomorrow Meeting' && e.start_min >= 24 * 60),
      'tomorrow\'s meeting should be in front of a board opened at five');

    // A board somebody had already set to "auto" is read as today rather than
    // refused: rolling is what they were asking for.
    const legacy = await board('2026-09-09T22:00:00Z', { show_day: 'auto' });
    assertEqual(legacy.events.map((i) => i.title).sort(),
      late.events.map((i) => i.title).sort(),
      'a saved "auto" should draw the same board as today does');
    assertEqual(h.opened(legacy), h.opened(late),
      'a saved "auto" opened somewhere other than today does');
  });

  // -------------------------------------------------------------------
  // The sky band, the clock, and the day they belong to.
  //
  // The forecast is fetched for the whole run and the board draws one day
  // of it. Everything read out of that response at a fixed day 0 is right
  // by accident on a board showing today and wrong on every other one.
  // -------------------------------------------------------------------

  // Two days of hourly probabilities, 07:00-21:00 each. Today rains from
  // 13:00 and is still raining at nightfall (one crossing, not two);
  // tomorrow rains from 09:00 to 12:00 (two).
  function twoDayForecast() {
    const time = [], pp = [];
    const push = (date, wet) => {
      for (let hh = 7; hh <= 21; hh++) {
        time.push(date + 'T' + String(hh).padStart(2, '0') + ':00');
        pp.push(wet(hh) ? 80 : 5);
      }
    };
    push('2026-09-09', (hh) => hh >= 13);
    push('2026-09-10', (hh) => hh >= 9 && hh < 12);
    return JSON.stringify({
      daily: {
        temperature_2m_max: [18, 21], temperature_2m_min: [11, 13],
        precipitation_probability_max: [80, 80], weathercode: [61, 61],
        sunrise: ['2026-09-09T06:30', '2026-09-10T06:32'],
        sunset: ['2026-09-09T20:30', '2026-09-10T20:27'],
      },
      hourly: { time: time, precipitation_probability: pp },
    });
  }

  function skyNet(ics) {
    return async (url) => {
      if (String(url).indexOf('api.open-meteo.com') >= 0) return okText(twoDayForecast());
      return okText(ics);
    };
  }

  const BOTH = icsWithEvents([
    { start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Today Meeting' },
    { start: '20260910T090000Z', end: '20260910T100000Z', summary: 'Tomorrow Meeting' },
  ]);

  function sky(metro, kind) {
    return metro.weather.filter((i) => i.type === kind).map((i) => i.at_min);
  }

  test('rain markers start and stop within one day, in that order', async () => {
    // Read straight down the response, today borrowed tomorrow's first
    // crossing as soon as it had fewer than two of its own, and carried
    // "it is raining" over the midnight gap: a dry 07:00 tomorrow came out
    // as "Rain Stops 07:00" drawn six hours BEFORE the 13:00 it belonged
    // to. A day's rain starts and stops inside that day or not at all.
    const r = await runTransform(skyNet(BOTH), NOW).run(input());
    const at = sky(r.data, 'weather');
    assertEqual(at, [13 * 60], 'today has one crossing of its own: ' + JSON.stringify(at));
    const labels = r.data.weather.filter((i) => i.type === 'weather').map((i) => i.label);
    assert(/Rain Starts/i.test(labels[0] || ''), 'the one marker should be the rain starting: ' + JSON.stringify(labels));
  });

  test('the sky belongs to the day the board opens on', async () => {
    // This used to be about the sun: a couple of minutes between one day's
    // sunset and the next, which nobody would ever spot on the board, so it
    // was spotted here. The sun markers are gone, and what the case is
    // really guarding is that the sky is read per day rather than at a
    // fixed [0] -- so it asks that of the markers that are left.
    const today = await runTransform(skyNet(BOTH), NOW).run(input());
    assertEqual(sky(today.data, 'sun'), [], 'a sun marker came back');
    assert(sky(today.data, 'weather').length > 0,
      'the day lost its rain markers along with its sun');
  });

  test('the board carries the clock, because it is about now', async () => {
    // now_min is what draws the clock badge and parks a car on every line at
    // that minute. It used to be withheld from a board set to tomorrow, where
    // that minute had not happened to anybody. There is no such board now:
    // a rolling board is today PLUS tomorrow, and now is on the today half.
    const r = await runTransform(skyNet(BOTH), NOW).run(input());
    assertEqual(r.data.now_min, 9 * 60, 'the board should carry the clock');
  });

  test('the day on the board carries its own forecast in days[0]', async () => {
    // The header and days[0].weather are the same fact told twice, and
    // they disagreed: a snapshot with no run of days in it left the header
    // filled and days[0].weather null.
    const r = await runTransform(skyNet(BOTH), NOW).run(input());
    assert(r.data.days[0].weather, 'no forecast on the day being drawn');
    assertEqual(r.data.days[0].weather.hi, 18, 'today\'s high');
    assertEqual(r.data.header_weather.hi, 18, 'the header should agree with it');
  });

  test('a sunset after the board\'s midnight is counted into the next day, not wrapped to 1am of this one', async () => {
    // Open-Meteo answers in the board's zone; for New York on a Brussels
    // account the sun sets at 01:04 on the following date.
    const forecast = JSON.stringify({
      daily: { time: ['2026-09-09', '2026-09-10'], temperature_2m_max: [24, 25], temperature_2m_min: [13, 14],
        precipitation_probability_max: [0, 0], weathercode: [1, 1],
        sunrise: ['2026-09-09T12:36', '2026-09-10T12:37'], sunset: ['2026-09-10T01:04', '2026-09-11T01:03'] },
      hourly: { time: [], precipitation_probability: [] },
    });
    const r = await runTransform(async (url) => String(url).indexOf('api.open-meteo.com') >= 0 ? okText(forecast) : okText(BOTH), NOW).run(input());
    assertEqual(r.data.days[0].weather.sunrise_min, 756);
    assertEqual(r.data.days[0].weather.sunset_min, 1504);
  });
};
