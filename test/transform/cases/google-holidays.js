'use strict';

// GOOGLE'S PUBLIC HOLIDAY CALENDARS, AS GOOGLE SERVES THEM.
//
// The config editor's wizard wrote Belgium as `en.belgian#holiday`, which
// Google answers with a 500 page: the board never had a holiday to show, and
// on a day without one nothing looked wrong. Belgium is `en.be` (or `nl.be`,
// `fr.be`). A config holding the old address is read from the right one.
//
// The feed below is trimmed from Google's own shape: whole days with an
// exclusive DTEND, TRANSP, a folded DESCRIPTION with an escaped comma, and
// years of entries either side of the one that matters.

module.exports = function (test, h) {
  const { runTransform, okText, fail, baseInput, assert, assertEqual } = h;

  const BAD = 'https://calendar.google.com/calendar/ical/en.belgian%23holiday%40group.v.calendar.google.com/public/basic.ics';
  const GOOD = 'https://calendar.google.com/calendar/ical/en.be%23holiday%40group.v.calendar.google.com/public/basic.ics';

  function day(date, summary, what) {
    const next = new Date(Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8) + 1));
    const end = next.toISOString().slice(0, 10).replace(/-/g, '');
    return 'BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:' + date + '\r\nDTEND;VALUE=DATE:' + end + '\r\n'
      + 'DTSTAMP:20260914T234036Z\r\nUID:' + date + '_x@google.com\r\nCLASS:PUBLIC\r\n'
      + (what === 'obs'
        ? 'DESCRIPTION:Observance\\nTo hide observances\\, go to Google Calendar Setting\r\n s > Holidays in Belgium\r\n'
        : 'DESCRIPTION:Public holiday\r\n')
      + 'SEQUENCE:0\r\nSTATUS:CONFIRMED\r\nSUMMARY:' + summary + '\r\nTRANSP:TRANSPARENT\r\nEND:VEVENT\r\n';
  }
  const FEED = 'BEGIN:VCALENDAR\r\nPRODID:-//Google Inc//Google Calendar 70.9054//EN\r\nVERSION:2.0\r\n'
    + 'CALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nX-WR-CALNAME:Holidays in Belgium\r\nX-WR-TIMEZONE:UTC\r\n'
    + day('20211111', 'Armistice Day') + day('20261025', 'Daylight Saving Time ends', 'obs')
    + day('20261101', 'All Saints\' Day') + day('20261111', 'Armistice Day')
    + day('20261225', 'Christmas Day') + day('20261226', 'Boxing Day') + day('20311111', 'Armistice Day')
    + 'END:VCALENDAR\r\n';

  // Google as it answers: the right id is the feed, anything else a 500.
  const google = (asked) => async (url) => {
    asked.push(String(url));
    return String(url) === GOOD ? okText(FEED) : fail(500);
  };
  function brussels(nowMs, config) {
    const input = baseInput(nowMs, { config_json: config });
    input.trmnl.user.time_zone_iana = 'Europe/Brussels';
    return input;
  }

  test('the wizard\'s old Belgian holiday link is read from the one Google serves', async () => {
    const now = Date.parse('2026-11-11T08:00:00Z');
    const asked = [];
    const { run, feedUrl } = runTransform(google(asked), now);
    assertEqual(feedUrl(BAD), GOOD);
    assertEqual(feedUrl(BAD.replace('en.belgian', 'nl.belgian')), GOOD.replace('en.be', 'nl.be'));
    assertEqual(feedUrl('https://example.com/en.belgian%23holiday%40x.ics'), 'https://example.com/en.belgian%23holiday%40x.ics');
    const r = await run(brussels(now, JSON.stringify({ calendars: [{ url: BAD, holiday: true }] })));
    assertEqual(asked, [GOOD]);
    assertEqual((r.data.holidays || []).map((x) => [x.title, x.day]), [['Armistice Day', 0]]);
    assertEqual(r.data.legend, [], 'a holiday feed drew a line');
  });

  test('a link list with the holiday word names tomorrow\'s holiday in the account\'s zone', async () => {
    // 23:30 in Brussels on Christmas Eve is still the 24th there, and 22:30 UTC.
    const now = Date.parse('2026-12-24T22:30:00Z');
    const r = await runTransform(google([]), now).run(brussels(now, GOOD + ' holiday'));
    const got = (r.data.holidays || []).map((x) => [x.title, x.day]);
    assert(got.some((x) => x[0] === 'Christmas Day' && x[1] === 1), 'Christmas is not tomorrow: ' + JSON.stringify(got));
    assert(!got.some((x) => x[0] === 'Christmas Day' && x[1] === 0), 'Christmas was announced a day early');
  });

  test('a day with no holiday in the feed has none, and nothing is down', async () => {
    const now = Date.parse('2026-09-15T08:00:00Z');
    const r = await runTransform(google([]), now).run(brussels(now, GOOD + ' holiday'));
    assertEqual(r.data.holidays, []);
    assertEqual(r.data.calendars_down, []);
  });
};
