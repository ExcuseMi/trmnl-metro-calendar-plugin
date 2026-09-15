// WHAT SIX INVENTED HOUSEHOLDS FOUND (test/households). Each case is one of
// them, cut down to the feed line that showed it: a custody week written with
// times, a night shift seen the morning after, clean-up rules that have to add
// up, a weekday rule asked about tomorrow, an Outlook zone name, and a rota
// that repeats a week-long all-day block.

module.exports = function (test, h) {
  const { runTransform, okText, baseInput, eventItems, assert, assertEqual } = h;

  function ics(rows) {
    return ['BEGIN:VCALENDAR', 'VERSION:2.0'].concat(rows, ['END:VCALENDAR', '']).join('\r\n');
  }
  function ev(props) {
    return ['BEGIN:VEVENT', 'UID:' + Math.random() + '@x'].concat(props, ['END:VEVENT']);
  }
  async function board(feed, nowIso, cal, zone) {
    const now = Date.parse(nowIso);
    const input = baseInput(now, { config_json: JSON.stringify({ calendars: [Object.assign({ url: 'https://example.com/a.ics', name: 'Sam' }, cal || {})] }) });
    input.trmnl.user.time_zone_iana = zone || 'Europe/Brussels';
    return (await runTransform(async () => okText(feed), now).run(input)).data;
  }

  test('a timed event of a day or more is a state at the head of the line, day by day', async () => {
    const feed = ics(ev(['SUMMARY:Kids at the other home', 'DTSTART;TZID=Europe/Brussels:20260911T180000',
      'DTEND;TZID=Europe/Brussels:20260918T180000']));
    const d = await board(feed, '2026-09-15T06:00:00Z');
    assertEqual(eventItems(d).filter((e) => /Kids/.test(e.title)).length, 0, 'a week was drawn as a stop on the clock');
    const heads = (d.all_day || []).filter((a) => /Kids/.test(a.title) && (a.day || 0) === 0);
    assertEqual(heads.length, 1, 'the week is not at the head of the line on its fifth day');
  });

  test('a night shift that began yesterday is on this morning\'s board, and says when it began', async () => {
    const feed = ics(ev(['SUMMARY:Night shift', 'DTSTART:20260914T190000Z', 'DTEND:20260915T070000Z']));
    const d = await board(feed, '2026-09-15T05:00:00Z', {}, 'Europe/London');
    const shift = eventItems(d).filter((e) => e.title === 'Night shift' && e.start_min < 1440);
    assertEqual(shift.length, 1, 'the shift is gone from the morning it is still running');
    assertEqual(shift[0].start_min, 0, 'it does not start the board at midnight');
    assertEqual(shift[0].began_min, -240, 'it does not say it began at 20:00 the evening before');
    assertEqual(shift[0].end_min, 480, 'it does not end at 08:00');
  });

  test('clean-up rules add up: every matching rewrite cuts, in order', async () => {
    const feed = ics(ev(['SUMMARY:RE: [ACME-2231] Invitation : Design review', 'DTSTART;TZID=Europe/Brussels:20260915T100000',
      'DTEND;TZID=Europe/Brussels:20260915T110000']));
    const d = await board(feed, '2026-09-15T06:00:00Z', { rules: [
      { match: { type: 'regex', value: '^RE:\\s*' }, rewrite: '' },
      { match: { type: 'regex', value: '\\[[A-Z]+-\\d+\\]\\s*' }, rewrite: '' },
      { match: { type: 'contains', value: 'Invitation :' }, rewrite: '' },
    ] });
    assertEqual(eventItems(d).map((e) => e.title), ['Design review'], 'only some of the rewrites were applied');
  });

  test('a title that began with a capital keeps one after its prefix is cut', async () => {
    const feed = ics(ev(['SUMMARY:Mia logo', 'DTSTART;TZID=Europe/Brussels:20260915T160000', 'DTEND;TZID=Europe/Brussels:20260915T163000']));
    const d = await board(feed, '2026-09-15T06:00:00Z', { rules: [{ match: { type: 'regex', value: '^Mia\\s+' }, rewrite: '' }] });
    assertEqual(eventItems(d).map((e) => e.title), ['Logo'], 'the cut left a lower-case title');
  });

  test('a weekday rule asks the weekday of the event, not of today', async () => {
    const feed = ics(ev(['SUMMARY:Office block', 'DTSTART;TZID=Europe/Brussels:20260916T090000',
      'DTEND;TZID=Europe/Brussels:20260916T100000']));
    const d = await board(feed, '2026-09-15T19:30:00Z', { rules: [
      { match: { type: 'and', matchers: [{ type: 'weekday', value: ['WE'] }, { type: 'contains', value: 'Office' }] }, title: 'Wednesday office' },
    ] });
    const tomorrow = eventItems(d).filter((e) => e.start_min >= 1440);
    assertEqual(tomorrow.map((e) => e.title), ['Wednesday office'], 'Wednesday\'s event was judged as a Tuesday');
  });

  test('an Outlook zone name is read as the zone it names', async () => {
    const feed = ics(ev(['SUMMARY:London sync', 'DTSTART;TZID=GMT Standard Time:20260915T133000',
      'DTEND;TZID=GMT Standard Time:20260915T143000']));
    const d = await board(feed, '2026-09-15T06:00:00Z', {}, 'Europe/Paris');
    assertEqual(eventItems(d).map((e) => e.start_min), [14 * 60 + 30], '13:30 in London is not 14:30 in Paris');
  });

  test('a week-long all-day block repeating every four weeks comes back', async () => {
    const feed = ics(ev(['SUMMARY:Kitchen duty', 'DTSTART;VALUE=DATE:20260720', 'DTEND;VALUE=DATE:20260727',
      'RRULE:FREQ=WEEKLY;INTERVAL=4']));
    const d = await board(feed, '2026-09-16T06:00:00Z');   // 14-20 Sep is a duty week; Wed is day 3
    const heads = (d.all_day || []).filter((a) => a.title === 'Kitchen duty' && (a.day || 0) === 0);
    assertEqual(heads.length, 1, 'the repeating week is missing');
  });
};
