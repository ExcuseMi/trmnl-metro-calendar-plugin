// A CALENDAR'S LINK IS NOT ALWAYS ITS FEED. A Nextcloud public link opens the
// calendar in a browser; the feed is that token's export on the same server.

module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, baseInput, assert } = h;

  test('a nextcloud public link is read from its export', async () => {
    const asked = [];
    const now = Date.parse('2026-09-15T08:00:00Z');
    const { run, feedUrl } = runTransform(async (url) => {
      asked.push(String(url));
      return okText(icsWithEvents([{ start: '20260915T100000Z', end: '20260915T110000Z', summary: 'Swim' }]));
    }, now);
    assert(feedUrl('https://cloud.example.com/apps/calendar/p/AbC123') === 'https://cloud.example.com/remote.php/dav/public-calendars/AbC123/?export',
      'rewrote to ' + feedUrl('https://cloud.example.com/apps/calendar/p/AbC123'));
    assert(feedUrl('https://example.com/nextcloud/index.php/apps/calendar/embed/Tok9/') === 'https://example.com/nextcloud/remote.php/dav/public-calendars/Tok9/?export',
      'a subpath install rewrote to ' + feedUrl('https://example.com/nextcloud/index.php/apps/calendar/embed/Tok9/'));
    assert(feedUrl('webcal://p01.icloud.com/x') === 'https://p01.icloud.com/x', 'webcal is not https');
    const r = await run(baseInput(now, { config_json: 'https://cloud.example.com/apps/calendar/p/AbC123' }));
    assert(asked.some((u) => /public-calendars\/AbC123\/\?export$/.test(u)), 'fetched ' + JSON.stringify(asked));
    assert((r.data.events || []).some((e) => e.title === 'Swim'), 'the event did not arrive');
  });
};
