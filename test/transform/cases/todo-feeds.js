// FEEDS THAT ARE NOT QUITE CALENDARS: a bin-day generator.
//
// "I have these for garbage collection, they are marked as todos." The feed
// is VTODOs with a DUE time the evening before collection, written as UTC
// although it was asked for in local time, and several bins fall due at the
// same minute. Three things, each checked here: a to-do is a moment at its
// due time; `ignoreTimezone` reads a calendar's times as the board's own wall
// clock; `mergeSameTime` makes things due at the same minute one stop.

module.exports = function (test, h) {
  const { runTransform, okText, baseInput, eventItems, assert, assertEqual } = h;

  const NOW = Date.parse('2026-09-15T08:00:00Z');   // a Tuesday morning
  const BRUSSELS = 'Europe/Brussels';

  function todo(summary, due, extra) {
    return ['BEGIN:VTODO', 'UID:' + summary + due, 'DTSTAMP:20260916T000000Z',
      'SUMMARY;LANGUAGE="NL":' + summary, 'DUE:' + due].concat(extra || []).concat(['END:VTODO']).join('\r\n');
  }
  function feed(items) {
    return 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:recycle\r\n' + items.join('\r\n') + '\r\nEND:VCALENDAR\r\n';
  }
  const BINS = feed([
    todo('Restafval', '20260915T190000Z'),
    todo('PMD', '20260915T190000Z'),
    todo('Papier-karton', '20260915T190000Z'),
    todo('Tuinafvalbak', '20260914T190000Z'),          // yesterday evening
    todo('Glas', '20260915T180000Z', ['STATUS:COMPLETED']),
  ]);

  function input(cal) {
    const i = baseInput(NOW, { config_json: JSON.stringify({
      lines: [{ name: 'Bins' }],
      calendars: [Object.assign({ url: 'https://example.com/bins.ics', name: 'Bins' }, cal)],
    }) });
    i.trmnl.user.time_zone_iana = BRUSSELS;
    return i;
  }
  const run = (cal) => runTransform(async () => okText(BINS), NOW).run(input(cal));
  // minutes past today's midnight, the payload's own clock
  const at = (e) => e.start_min;

  test('a to-do is a stop at its due time, and one that is done is not', async () => {
    const r = await run({});
    const today = eventItems(r.data).filter((e) => e.start_min >= 0 && e.start_min < 1440);
    const titles = today.map((e) => e.title).sort();
    assertEqual(titles, ['PMD', 'Papier-karton', 'Restafval'], 'the to-dos due today');
    // 19:00Z is 21:00 in Brussels in September
    assert(today.every((e) => at(e) === 21 * 60), 'due at ' + today.map(at).join(', '));
    assert(today.every((e) => e.end_min === e.start_min), 'a to-do has no length: it is a moment');
  });

  test('ignoreTimezone reads the feed\'s UTC times as the board\'s own clock', async () => {
    const r = await run({ ignoreTimezone: true });
    const today = eventItems(r.data).filter((e) => e.start_min >= 0 && e.start_min < 1440);
    assert(today.length === 3, today.length + ' to-dos today');
    assert(today.every((e) => at(e) === 19 * 60), 'due at ' + today.map(at).join(', ') + ', not 19:00');
  });

  test('mergeSameTime makes things due at the same minute on one line one stop', async () => {
    const r = await run({ ignoreTimezone: true, mergeSameTime: true });
    const today = eventItems(r.data).filter((e) => e.start_min >= 0 && e.start_min < 1440);
    assertEqual(today.length, 1, 'one stop for the three bins');
    assertEqual(today[0].title.split(' · ').sort(), ['PMD', 'Papier-karton', 'Restafval'], 'every bin named once');
    // and as a list, so the board can set them a name to a row
    assertEqual((today[0].parts || []).slice().sort(), ['PMD', 'Papier-karton', 'Restafval'], 'the names do not travel as a list');
  });

  test('without mergeSameTime they stay separate, and a rule still acts on one of them', async () => {
    const plain = await run({ ignoreTimezone: true });
    assertEqual(eventItems(plain.data).filter((e) => e.start_min >= 0 && e.start_min < 1440).length, 3, 'three stops');
    const hid = await run({ ignoreTimezone: true, mergeSameTime: true,
      rules: [{ match: { type: 'contains', value: 'PMD' }, hide: true }] });
    const today = eventItems(hid.data).filter((e) => e.start_min >= 0 && e.start_min < 1440);
    assertEqual(today.length, 1, 'still one stop');
    assert(today[0].title.indexOf('PMD') < 0, 'a hidden bin was merged in: ' + today[0].title);
  });
};
