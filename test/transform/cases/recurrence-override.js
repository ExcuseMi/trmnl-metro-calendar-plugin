module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, fail, baseInput, eventItems, assert, assertEqual } = h;

  // a board with one calendar on it and no weather, which is all the
  // recurrence cases need
  function net(ics) {
    return async (url) => (String(url).indexOf('api.open-meteo.com') >= 0 ? fail(500) : okText(ics));
  }
  function input(nowMs) {
    return baseInput(nowMs, {
      use_demo_data: 'false',
      config_json: JSON.stringify({ calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }] }),
    });
  }
  const titles = (r) => r.data.events.map((i) => i.title);

  // "We also have standup twice" — an Outlook-style export where a weekly
  // series has a same-UID RECURRENCE-ID override for one occurrence (an
  // attendee-response-only edit, or a moved time). Without suppressing the
  // master's own occurrence on that date, both the master's weekly-RRULE
  // match AND the override's own direct-hit DTSTART show up, doubling it.

  test('a no-op RECURRENCE-ID override does not duplicate the master\'s own occurrence', async () => {
    const MONDAY = Date.parse('2026-09-07T09:30:00Z');
    const events = [
      { uid: 'series-1', start: '20260601T090000Z', end: '20260601T091500Z', rrule: 'FREQ=WEEKLY;BYDAY=MO', summary: 'Team Standup' },
      { uid: 'series-1', recurrenceId: '20260907T090000Z', start: '20260907T090000Z', end: '20260907T091500Z', summary: 'Team Standup' },
    ];
    const fetchImpl = async () => okText(icsWithEvents(events));
    const cfg = JSON.stringify({ calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }] });
    const r = await runTransform(fetchImpl, MONDAY).run(baseInput(MONDAY, { config_json: cfg }));
    assertEqual(eventItems(r.data).length, 1, 'the override should replace the master\'s occurrence, not add a second "Team Standup"');
  });

  test('a RECURRENCE-ID override that moves the occurrence still suppresses the master\'s original slot', async () => {
    const MONDAY = Date.parse('2026-09-07T09:30:00Z');
    const events = [
      { uid: 'series-2', start: '20260907T090000Z', end: '20260907T091500Z', rrule: 'FREQ=WEEKLY;BYDAY=MO', summary: 'Standup' },
      { uid: 'series-2', recurrenceId: '20260907T090000Z', start: '20260907T110000Z', end: '20260907T111500Z', summary: 'Standup (moved)' },
    ];
    const fetchImpl = async () => okText(icsWithEvents(events));
    const cfg = JSON.stringify({ calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }] });
    const r = await runTransform(fetchImpl, MONDAY).run(baseInput(MONDAY, { config_json: cfg }));
    const titles = eventItems(r.data).map((e) => e.title);
    assertEqual(titles, ['Standup (moved)'], 'the original 09:00 occurrence should be suppressed and only the moved override should show');
  });

  test('an override for a DIFFERENT date does not suppress today\'s own occurrence', async () => {
    const MONDAY = Date.parse('2026-09-07T09:30:00Z');
    const events = [
      { uid: 'series-3', start: '20260601T090000Z', end: '20260601T091500Z', rrule: 'FREQ=WEEKLY;BYDAY=MO', summary: 'Standup' },
      { uid: 'series-3', recurrenceId: '20260914T090000Z', start: '20260914T100000Z', end: '20260914T101500Z', summary: 'Standup (moved next week)' },
    ];
    const fetchImpl = async () => okText(icsWithEvents(events));
    const cfg = JSON.stringify({ calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }] });
    const r = await runTransform(fetchImpl, MONDAY).run(baseInput(MONDAY, { config_json: cfg }));
    assertEqual(eventItems(r.data).map((e) => e.title), ['Standup'], 'today\'s own occurrence is untouched by an override targeting a different date');
  });

  // ---- occurrences the series does NOT have -------------------------
  //
  // Both of these were reported the same way: "why does the board show a
  // meeting that is not in my calendar?". Both were the same shape of
  // mistake, reading a recurrence rule as if it said less than it does,
  // and both got three times as visible the day the board started drawing
  // three days instead of one.

  test('a fortnightly meeting does not happen every week', async () => {
    // FREQ=WEEKLY;INTERVAL=2 read as plain weekly fires on the off weeks
    // too. The ceremonies most likely to carry an INTERVAL are exactly the
    // ones a work calendar is full of: sprint reviews, retros, 1:1s.
    //
    // The series starts Thu 10 Sep 2026 and runs fortnightly, so it is on
    // the 10th and the 24th, and NOT on the 17th.
    const ics = icsWithEvents([
      { start: '20260910T100000Z', end: '20260910T110000Z', summary: 'Sprint Review',
        rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TH' },
    ]);
    const onWeek = await runTransform(net(ics), Date.parse('2026-09-10T08:00:00Z'))
      .run(input(Date.parse('2026-09-10T08:00:00Z')));
    assert(titles(onWeek).indexOf('Sprint Review') >= 0,
      'the fortnightly meeting is missing from the week it is actually on');

    const offWeek = await runTransform(net(ics), Date.parse('2026-09-17T08:00:00Z'))
      .run(input(Date.parse('2026-09-17T08:00:00Z')));
    assertEqual(titles(offWeek).filter((t) => t === 'Sprint Review').length, 0,
      'a fortnightly meeting was drawn on its off week');
  });

  test('an occurrence taken out of a series is not drawn', async () => {
    // A standup you deleted for one day is still in the file: the rule
    // fires and an EXDATE says not this time. Ignored, the board shows a
    // meeting the calendar says is not happening.
    const ics = icsWithEvents([
      { start: '20260910T093000Z', end: '20260910T094500Z', summary: 'Standup',
        rrule: 'FREQ=WEEKLY;BYDAY=TH,FR', exdate: '20260911T093000Z' },
    ]);
    const r = await runTransform(net(ics), Date.parse('2026-09-10T08:00:00Z')).run(input(Date.parse('2026-09-10T08:00:00Z')));
    const standups = r.data.events.filter((i) => i&& i.title === 'Standup');
    const days = standups.map((e) => Math.floor(e.start_min / 1440));
    assert(days.indexOf(0) >= 0, 'Thursday\'s standup is missing');
    assertEqual(days.indexOf(1), -1, 'Friday\'s standup was drawn, and the calendar says it '
      + 'was taken out of the series');
  });
};
