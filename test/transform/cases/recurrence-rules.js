// RECURRENCE BEYOND WEEKLY. The rules strangers' calendars actually carry:
// a daily standup, the third Tuesday of the month, a course that runs ten
// times (COUNT, which a series ended "after N occurrences" is written as).
// COUNT used to be ignored, so a ten-week course ran on the board for ever.
// Each case asks one question of Tuesday 15 September 2026 in Brussels, with
// local times, so what is checked is the date arithmetic and nothing else.

module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, baseInput, eventItems, assert, assertEqual } = h;
  const NOW = Date.parse('2026-09-15T06:00:00Z');   // 08:00 in Brussels

  async function firesToday(rrule, start, extra) {
    const ev = Object.assign({ uid: 'r', start: start || '20260901T090000', end: (start || '20260901T090000').replace(/T\d{2}/, 'T10'), rrule, summary: 'Series' }, extra || {});
    const input = baseInput(NOW, { config_json: JSON.stringify({ calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }] }) });
    input.trmnl.user.time_zone_iana = 'Europe/Brussels';
    const r = await runTransform(async () => okText(icsWithEvents([ev])), NOW).run(input);
    const today = eventItems(r.data).filter((e) => e.start_min >= 0 && e.start_min < 1440 && e.title === 'Series');
    const tomorrow = eventItems(r.data).filter((e) => e.start_min >= 1440 && e.title === 'Series');
    return { today: today.length > 0, tomorrow: tomorrow.length > 0 };
  }
  const yes = async (rrule, start, why, extra) => assert((await firesToday(rrule, start, extra)).today, why + ' (' + rrule + ')');
  const no = async (rrule, start, why, extra) => assert(!(await firesToday(rrule, start, extra)).today, why + ' (' + rrule + ')');

  test('DAILY fires every day, and INTERVAL counts days from the start', async () => {
    await yes('FREQ=DAILY', '20260901T090000', 'a daily series is not on today');
    await yes('FREQ=DAILY;INTERVAL=2', '20260901T090000', 'every other day, fourteen days on');
    await no('FREQ=DAILY;INTERVAL=2', '20260902T090000', 'every other day, thirteen days on');
    await no('FREQ=DAILY;BYDAY=MO,WE,FR', '20260901T090000', 'a weekday filter let a Tuesday through');
  });

  test('COUNT ends a series: ten days from the 1st is over by the 15th, fifteen is not', async () => {
    await no('FREQ=DAILY;COUNT=10', '20260901T090000', 'a series that ran out on the 10th is still on the board');
    await yes('FREQ=DAILY;COUNT=15', '20260901T090000', 'the fifteenth of fifteen was dropped');
    const last = await firesToday('FREQ=DAILY;COUNT=15', '20260901T090000');
    assert(!last.tomorrow, 'the series carried on past its count into tomorrow');
    await no('FREQ=WEEKLY;COUNT=2', '20260901T090000', 'a two-week course is on its third week');
    await yes('FREQ=WEEKLY;COUNT=3', '20260901T090000', 'the third week of three was dropped');
    await yes('FREQ=WEEKLY;BYDAY=MO,TU;COUNT=4', '20260907T090000', 'Monday and Tuesday for two weeks: today is the fourth');
    await no('FREQ=WEEKLY;BYDAY=MO,TU;COUNT=3', '20260907T090000', 'three occurrences end on Monday the 14th');
  });

  test('MONTHLY by ordinal weekday, by day of the month, from the end, and by position', async () => {
    await yes('FREQ=MONTHLY;BYDAY=3TU', '20260721T090000', 'the third Tuesday of September is the 15th');
    await no('FREQ=MONTHLY;BYDAY=2TU', '20260714T090000', 'the second Tuesday is the 8th');
    await yes('FREQ=MONTHLY;BYDAY=-3TU', '20260721T090000', 'counted from the end, the 15th is the third last Tuesday');
    await yes('FREQ=MONTHLY;BYMONTHDAY=15', '20260115T090000', 'the 15th of every month');
    await yes('FREQ=MONTHLY;BYMONTHDAY=-16', '20260115T090000', 'sixteenth from the end of a 30-day month');
    await yes('FREQ=MONTHLY', '20260615T090000', 'a plain monthly repeats the start\'s day');
    await no('FREQ=MONTHLY;INTERVAL=2', '20260815T090000', 'every other month skipped nothing');
    await yes('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=11', '20260801T090000', 'the eleventh weekday of September is the 15th');
    await no('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', '20260801T090000', 'the last weekday is the 30th');
  });

  test('YEARLY works for a timed entry too, and BYMONTH with an ordinal finds the moving date', async () => {
    await yes('FREQ=YEARLY', '20200915T180000', 'a timed yearly entry is not on its anniversary');
    await no('FREQ=YEARLY', '20200916T180000', 'a yearly entry fired a day early');
    await yes('FREQ=YEARLY;BYMONTH=9;BYDAY=3TU', '20240917T090000', 'the third Tuesday of September, a year on');
  });

  test('UNTIL is inclusive, and a timed UNTIL is a moment, not a date', async () => {
    // 06:59:59Z is 08:59:59 in Brussels, before the 09:00 occurrence
    await no('FREQ=DAILY;UNTIL=20260915T065959Z', '20260901T090000', 'an occurrence after the series ended was drawn');
    await yes('FREQ=DAILY;UNTIL=20260915T070000Z', '20260901T090000', 'the last occurrence, exactly at UNTIL, was dropped');
    await yes('FREQ=DAILY;UNTIL=20260915', '20260901T090000', 'a date UNTIL does not include its own day');
  });

  test('EXDATE still takes a day out, and a rule this does not read shows only its first date', async () => {
    await no('FREQ=DAILY', '20260901T090000', 'an excluded day was drawn', { exdate: '20260915T090000' });
    await no('FREQ=YEARLY;BYWEEKNO=38', '20250915T090000', 'a week-number rule was guessed at');
  });
};
