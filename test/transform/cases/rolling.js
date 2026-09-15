'use strict';

// THE WINDOW STEPS THROUGH THE DAY, AND BORROWS TOMORROW WHEN TOMORROW HAS
// SOMETHING.
//
// A board on a wall is standing there to answer "what is coming", and at two
// in the afternoon a busy Tuesday was still spending its paper on a morning
// nobody could attend any more: the window used to move once, at four, and
// only on a quiet day. It steps now, at ten, one, four and seven, and opens
// two hours before the step so what just happened is still on the board. A
// quiet morning still borrows tomorrow from six, as it did.
//
// Tomorrow is drawn only where tomorrow has an event, a holiday or a state
// to show: a busy day squeezed to make room for an empty morning is paper
// spent on nothing. Where it is drawn, it runs to six the next evening, or
// eleven once the window itself has passed the afternoon.
//
// What must not go wrong is STABILITY. The panel refreshes every fifteen
// minutes, so nothing here is read from the clock continuously: the window
// changes only at the four step hours, on the hour, and once the board has
// tomorrow it keeps it. The case that pins that down is 'the board changes
// shape only at the steps, on the hour, and never gives tomorrow back'.

module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, baseInput, assert, assertEqual } = h;

  const NOW = Date.parse('2026-09-09T09:00:00Z');   // a Wednesday
  const DAY = 24 * 60;

  function net(ics) {
    return async (url) => {
      if (String(url).indexOf('api.open-meteo.com') >= 0) {
        return okText(JSON.stringify({
          daily: {
            temperature_2m_max: [18, 21], temperature_2m_min: [11, 13],
            precipitation_probability_max: [10, 80], weathercode: [0, 61],
            sunrise: ['2026-09-09T06:30', '2026-09-10T06:32'],
            sunset: ['2026-09-09T20:30', '2026-09-10T20:27'],
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
  // events written as [YYYYMMDD, "HHMM", "HHMM", title]
  function feed(rows) {
    return icsWithEvents(rows.map((r) => ({
      start: r[0] + 'T' + r[1] + '00Z', end: r[0] + 'T' + r[2] + '00Z', summary: r[3],
    })));
  }
  const board = async (rows, fields) => (await runTransform(net(feed(rows)), NOW).run(input(fields))).data;
  // The same board asked at another time of day (an ISO time on the 9th).
  const boardAt = async (hhmm, rows) => {
    const when = Date.parse('2026-09-09T' + hhmm + ':00Z');
    return (await runTransform(net(feed(rows)), when).run(baseInput(when, {
      use_demo_data: 'false', lat_lon: '51.05,3.72',
      config_json: JSON.stringify({ calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }] }),
    }))).data;
  };

  // THE BOARD IS A DAY LONG. Twenty-four hours from where its window
  // opens, so a quiet morning's board runs from six to six and what
  // tomorrow shows is its small hours: the early flight, not the review.
  const QUIET = [
    ['20260909', '1400', '1500', 'Dentist'],
    ['20260910', '0500', '0600', 'Early Flight'],
    ['20260910', '1900', '2000', 'Book Club'],
  ];

  test('a quiet day borrows tomorrow, and from ten so does a busy one', async () => {
    const quiet = await board(QUIET);
    assertEqual(quiet.days.length, 2, 'one event today should have borrowed tomorrow');
    // At nine, before the first step, a busy day is still the whole day.
    const busyRows = [
      ['20260909', '0900', '0915', 'Standup'],
      ['20260909', '1100', '1200', 'Workshop'],
      ['20260909', '1400', '1500', 'Dentist'],
      ['20260910', '0700', '0800', 'Sprint Review'],
    ];
    const morning = await board(busyRows);
    // Both days are always SENT now; what says a busy morning is not
    // stretched is that it carries no window, so the span stays the day's.
    assertEqual(morning.days.length, 2, 'both days should be sent, whatever gets drawn');
    assertEqual(h.opened(morning), 6 * 60, 'a morning board opens at six, before the first step');
    // At eleven the ten o'clock step has passed: the window opens at seven
    // (the Standup at nine is kept, and LEAD_MIN of board in front of it is
    // what pulls it back that far) and reaches tomorrow's review. The lead
    // does not cost the far end: the 24 hours are counted from where the day
    // starts, so the review at nine tomorrow is still inside it.
    const busy = await boardAt('11:00', busyRows);
    assertEqual(busy.days.length, 2, 'both days should be sent, whatever gets drawn');
    assertEqual(h.opened(busy), 7 * 60, 'the board should open two hours before the first thing it draws');
    assertEqual(busy.events.map((e) => e.title).sort(),
      ['Dentist', 'Sprint Review', 'Standup', 'Workshop'], 'the rolled board drew the wrong events');
    // ...but a busy day with nothing tomorrow keeps its paper for itself:
    // the window still steps, and it closes at midnight.
    const alone = await boardAt('11:00', busyRows.slice(0, 3));
    // A day row per day GATHERED, even when that day turns out to be empty:
    // the row is what names a day the span reaches, and an empty tomorrow
    // simply gives `framed()` nothing to reach for.
    assertEqual(alone.days.length, 2, 'both days should be sent, whatever gets drawn');
    assert(!alone.events.some((e) => e.start_min >= DAY), 'an empty tomorrow brought events with it');
    assertEqual(h.opened(alone), 7 * 60, 'a day with an empty tomorrow should still step');
    assertEqual(alone.day_end_min, 2 * DAY, 'the payload should carry the whole run it gathered');
  });

  test('three lines at one dinner is one event, not three', async () => {
    // The count is the count the BOARD has, after every rule and every
    // merge: one thing that three calendars describe is one stop on the map,
    // so a household whose evening is shared still reads as a quiet day.
    const shared = JSON.stringify({
      lines: [{ name: 'Ada' }, { name: 'Bo' }, { name: 'Cy' }],
      calendars: [{ url: 'https://example.com/a.ics',
        rules: [{ match: { type: 'contains', value: 'Dinner' },
          line: ['Ada', 'Bo', 'Cy'] }] }],
    });
    const r = await board([
      ['20260909', '1800', '1900', 'Family Dinner'],
      ['20260910', '0500', '0600', 'Early Flight'],
    ], { config_json: shared });
    assertEqual(r.days.length, 2, 'a shared dinner was counted once per line');
  });

  test('an all-day state is not an event on the scale of hours', async () => {
    // It has no hour, so it takes no room a quiet day is short of. Counted
    // as content, a line on half term would have stopped the stretch from
    // happening on exactly the emptiest day of the year.
    let ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\n';
    ics += 'BEGIN:VEVENT\r\nUID:h\r\nDTSTART;VALUE=DATE:20260909\r\nDTEND;VALUE=DATE:20260912\r\n'
      + 'SUMMARY:Half Term\r\nEND:VEVENT\r\n';
    ics += 'BEGIN:VEVENT\r\nUID:t\r\nDTSTART:20260910T090000Z\r\nDTEND:20260910T100000Z\r\n'
      + 'SUMMARY:Sprint Review\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    const r = (await runTransform(net(ics), NOW).run(input())).data;
    assertEqual(r.days.length, 2, 'an all-day entry was counted as an event');
    assertEqual(r.all_day.map((a) => a.title), ['Half Term'],
      'the state itself should still be declared, once, at its line\'s head');
  });

  test('a quiet morning\'s window is the 24 hours, on the hour, from six', async () => {
    const r = await board(QUIET);
    // The payload carries the whole run from this day's own midnight; where
    // the board OPENS inside it is `day.js opened()`, and where it closes is
    // `framed()`, against a view there is none of here.
    assertEqual([r.day_start_min, r.day_end_min], [0, 2 * DAY],
      'the payload should carry both days, from midnight');
    assertEqual(h.opened(r), 6 * 60, 'a quiet morning should open at six');
    // Minute zero is still the shown day's midnight, which is what lets
    // everything downstream go on reading one number line.
    assertEqual(r.days.map((d) => d.start_min), [0, DAY], 'the run is not rebased onto the shown day');
    assert(r.days[0].date_label && r.days[1].date_label
      && r.days[0].date_label !== r.days[1].date_label,
      'both days have to name themselves: ' + JSON.stringify(r.days.map((d) => d.date_label)));
    assert(r.days[1].weekday_short, 'a day with no short weekday has nothing to write in a narrow strip');
  });

  test('tomorrow morning lands at tomorrow\'s time, and tomorrow night is not drawn', async () => {
    const r = await board(QUIET);
    const by = {};
    r.events.forEach((e) => { by[e.title] = e; });
    assertEqual(by.Dentist.start_min, 14 * 60, 'today\'s event moved');
    assert(by['Early Flight'], 'tomorrow\'s 05:00 is missing from a payload that carries both days');
    assertEqual(by['Early Flight'].start_min, DAY + 5 * 60,
      'tomorrow\'s 05:00 has to be 05:00 of the SECOND day, not of the first');
    // Everything gathered is SENT, whether or not a given panel has room to
    // draw it: what a view cannot hold, `framed()` cuts and counts.
    assert(by['Book Club'], 'a 19:00 event was withheld rather than sent and counted');
  });

  test('the window opens where the step puts it, and counts what fell off the front', async () => {
    // THE WINDOW NO LONGER REACHES BACK FOR AN EVENT THAT IS OVER.
    //
    // It used to: every event still running at the lookback pulled the
    // opening back to an hour before itself, so that a window could not cut
    // an event it had decided to draw. That undid the step it was supposed to
    // work with -- an all-day school run held the four o'clock window open in
    // the morning -- so the opening is the step's now, and a 04:30 shift that
    // ended before it is counted at the leading edge rather than fetched
    // back. What straddles the opening is drawn from the edge, clipped.
    const early = await board([
      ['20260909', '0430', '0530', 'Early Shift'],
      ['20260910', '0200', '0300', 'Night Shift'],
    ]);
    assertEqual(h.opened(early), 6 * 60,
      'a quiet morning opens at six, whatever happened before it');
    assert(!early.events.some((e) => e.title === 'Early Shift' && e.start_min >= h.opened(early)),
      'an event that ended before the board opened was placed inside it');
    // ...and once a step has passed, an event that ended before its lookback
    // is the morning it rolled off.
    const gone = await boardAt('11:00', [
      ['20260909', '0430', '0530', 'Early Shift'],
      ['20260910', '0700', '0800', 'Sprint Review'],
    ]);
    assertEqual(h.opened(gone), 8 * 60,
      'an event already over pulled the morning back onto the board');
    const kept = await boardAt('11:00', [
      ['20260909', '0830', '0930', 'Late Shift'],
      ['20260910', '0600', '0700', 'Sprint Review'],
    ]);
    assertEqual(h.opened(kept), 6 * 60,
      'the board should open LEAD_MIN before the first thing it draws');
    // ...and the borrowed morning's event is sent at its own time, for a view
    // with the room to reach it.
    const late = await board([
      ['20260909', '1400', '1500', 'Dentist'],
      ['20260910', '0300', '0430', 'Handover'],
    ]);
    assertEqual(late.day_end_min, 2 * DAY, 'the payload should carry the whole run it gathered');
    assert(late.events.some((e) => e.title === 'Handover'), 'the borrowed morning\'s event was not drawn');
  });

  // THE OPT-OUT IS GONE, AND SO IS THE DAY PICKER.
  //
  // Two cases lived here. One turned the stretch off ("Quiet Days: always one
  // day") and checked the board came out exactly as it used to; the other set
  // the board to tomorrow and checked the stretch followed it into the day
  // after.
  //
  // The opt-out existed because a board that changes shape on its own needs a
  // way to be told not to -- and what made that alarming was the shape
  // changing WHILE somebody read it, which the four o'clock boundary fixed
  // (see 'a day has two shapes at most, and it changes at four'). A board that
  // quietly shows more of what is coming needs no opt-out. The day picker went
  // with it: a board about tomorrow cannot say what time it is.
  //
  // What is left of both is that a board somebody already saved with either
  // setting still draws a board, which the case below checks.

  test('a setting the board no longer reads still draws a board', async () => {
    const at = Date.parse('2026-09-09T21:00:00Z');
    const rows = [['20260910', '1400', '1500', 'Dentist'], ['20260911', '0900', '1000', 'Sprint Review']];
    const run = async (fields) => (await runTransform(net(feed(rows)), at).run(baseInput(at,
      Object.assign({ use_demo_data: 'false', lat_lon: '51.05,3.72',
        config_json: JSON.stringify({ calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }] }),
      }, fields)))).data;
    const plain = await run({});
    for (const stale of [{ show_day: 'auto' }, { show_day: 'tomorrow' }, { rolling_view: 'one' },
                         { show_day: 'auto', switch_hour: '18', rolling_view: 'one' }]) {
      const r = await run(stale);
      assertEqual(r.events.map((e) => e.title).sort(), plain.events.map((e) => e.title).sort(),
        JSON.stringify(stale) + ' drew a different board');
      assertEqual(r.title_word, plain.title_word, JSON.stringify(stale) + ' named a different day');
      assertEqual(r.days.length, plain.days.length, JSON.stringify(stale) + ' drew a different run of days');
    }
  });

  test('a day the board is not drawing leaves the board as it found it', async () => {
    // The run has to be fetched before the count is known, so a busy board
    // has read a day it will not draw. Nothing about that day may reach the
    // drawing: not an event, not a line of its own, not a line's weight.
    const cfg = JSON.stringify({
      calendars: [
        { url: 'https://example.com/a.ics', name: 'Ada' },
        { url: 'https://example.com/b.ics', name: 'Bo' },
      ],
    });
    const netTwo = async (url) => {
      if (String(url).indexOf('api.open-meteo.com') >= 0) return okText('{}');
      if (String(url).indexOf('/b.ics') >= 0) {
        // Bo exists on the day after tomorrow and on no other day.
        return okText(feed([['20260911', '1000', '1100', 'Bo Only']]));
      }
      // Ada has today; nothing tomorrow is early enough to borrow.
      return okText(feed([
        ['20260909', '1400', '1500', 'Dentist'],
        ['20260910', '0900', '0915', 'Standup'],
        ['20260910', '1100', '1200', 'Workshop'],
        ['20260910', '1400', '1500', 'Dentist'],
      ]));
    };
    const r = (await runTransform(netTwo, NOW).run(baseInput(NOW, {
      use_demo_data: 'false', config_json: cfg, show_day: 'tomorrow',
    }))).data;
    assertEqual(r.legend.map((t) => t.name), ['Ada'],
      'a line that exists only on a day the board is not drawing got a rail: '
      + JSON.stringify(r.legend.map((t) => t.name)));
  });

  test('the board changes shape only at the steps, on the hour, and never gives tomorrow back', async () => {
    // THE STABILITY CASE. An e-ink panel refreshes every fifteen minutes,
    // and a window keyed to the clock would slide under whoever is reading
    // it four times an hour. The window steps instead, at ten, one, four
    // and seven, and between two steps every quarter of an hour lays out
    // the same board.
    const rows = [
      ['20260909', '0900', '0915', 'Standup'],
      ['20260909', '1100', '1200', 'Workshop'],
      ['20260909', '1400', '1500', 'Dentist'],
      ['20260909', '1900', '2000', 'Book Club'],
      ['20260910', '0900', '1000', 'Sprint Review'],
    ];
    async function shapeAt(hh) {
      const when = Date.parse('2026-09-09T' + hh.slice(0, 2) + ':' + hh.slice(2) + ':00Z');
      const r = (await runTransform(net(feed(rows)), when).run(baseInput(when, {
        use_demo_data: 'false', lat_lon: '51.05,3.72',
        config_json: JSON.stringify({ calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }] }),
      }))).data;
      // The shape a reader sees is where the board opens: the payload itself
      // is the same all day, which is the point of moving the decision.
      const from = h.opened(r);
      return { start: from, shape: r.days.length + ' day(s) from ' + from };
    }
    const seen = [];
    for (let min = 0; min < 24 * 60; min += 15) {
      const hh = String(Math.floor(min / 60)).padStart(2, '0') + String(min % 60).padStart(2, '0');
      seen.push(Object.assign({ at: hh }, await shapeAt(hh)));
    }
    const flips = seen.filter((s, i) => i > 0 && s.shape !== seen[i - 1].shape);
    // Before the morning opening the window opens no later than the clock,
    // in three-hour steps, so the time is on the board at night too.
    assertEqual(flips.map((f) => f.at), ['0300', '0600', '1000', '1300', '1600', '1900'],
      'the board changed shape at ' + flips.map((f) => f.at + ' -> ' + f.shape).join(' | '));
    // Each step opens the window two hours before itself, or LEAD_MIN before
    // an event still running then, whichever is earlier: the Standup at nine
    // holds ten's window at seven, the Workshop at eleven holds one's at
    // nine, the Dentist at two holds four's at twelve, and the Book Club at
    // seven holds seven's at five.
    assertEqual(flips.map((f) => f.start), [3 * 60, 6 * 60, 7 * 60, 9 * 60, 12 * 60, 17 * 60],
      'a step opened the window somewhere other than LEAD_MIN before what it keeps');
    // ...and it only ever moves forwards. The opening is a step function of
    // the clock, so it cannot walk back into a morning it has shed.
    for (let i = 1; i < seen.length; i++) {
      assert(seen[i].start >= seen[i - 1].start,
        'the board opened earlier at ' + seen[i].at + ' than at ' + seen[i - 1].at);
    }
  });

  test('the evening board has tomorrow and tonight, and the morning has rolled off', async () => {
    const rows = [
      ['20260909', '0900', '1000', 'Book Club'],
      ['20260909', '1400', '1500', 'Reactor Core Check'],
      ['20260909', '1700', '1800', 'Skate Park'],
      ['20260909', '1900', '2000', 'Moe\'s Tavern'],
      ['20260909', '1930', '2030', 'Family Dinner'],
      ['20260910', '1000', '1100', 'Sunday Swim'],
    ];
    const at = async (hh) => {
      const when = Date.parse('2026-09-09T' + hh + ':00Z');
      return (await runTransform(net(feed(rows)), when).run(baseInput(when, {
        use_demo_data: 'false', lat_lon: '51.05,3.72',
        config_json: JSON.stringify({ calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }] }),
      }))).data;
    };
    // Half past five: the four o'clock step has passed, so the window opens
    // at twelve -- LEAD_MIN before the Reactor Core Check, still running at
    // four's lookback -- tomorrow is on, and the morning is counted rather
    // than drawn.
    const evening = await at('17:30');
    assertEqual(h.opened(evening), 12 * 60, 'the board should open LEAD_MIN before the event kept');
    const titles = evening.events.map((e) => e.title);
    assert(titles.indexOf('Sunday Swim') >= 0, 'tomorrow never arrived: ' + JSON.stringify(titles));
    assert(titles.indexOf('Family Dinner') >= 0, 'tonight was thrown away to get there');
    // The morning is still in the payload -- the board counts it at the
    // window's leading edge as "+N earlier" -- but it is before the window,
    // so it is not drawn.
    const club = evening.events.find((e) => e.title === 'Book Club');
    assert(club && club.end_min <= h.opened(evening),
      'the morning is still inside the window on an evening board');
  });

  test('a rolling board carries no sunrise and no sunset', async () => {
    // It used to carry three: today's sunrise, today's sunset, and the
    // borrowed day's sunrise, each shifted onto the window's own number
    // line. That was the most intricate piece of the sky code and it drew
    // the two marks nobody was reading. The whole branch is gone, so what
    // is worth asserting is that it stays gone: a payload with anything but
    // a weather marker in `weather` is the old path back.
    const r = await board(QUIET);
    assertEqual(r.weather.filter((i) => i.type !== 'weather'), [],
      'a rolling board put sky markers back on: ' + JSON.stringify(r.weather));
  });
};
