'use strict';

// THE NEWS: a few headlines from RSS or Atom feeds the household names, read
// without an XML parser (see parseNewsFeed) and handed to the board as
// { items: [{ title, source }], max }. Newest first within a feed, the feeds
// taken in turn, the last good read kept for a refresh on which nothing
// answers, and nothing at all when the setting is empty.

module.exports = function (test, h) {
  const { runTransform, okText, fail, baseInput, assert, assertEqual } = h;
  const NOW = Date.parse('2026-09-19T10:00:00Z');
  const CAL = 'https://calendar.example.com/a.ics';
  const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';

  const RSS = '<?xml version="1.0"?><rss version="2.0"><channel><title>Het Nieuwsblad - Regio</title>'
    + '<link>https://x.example</link>'
    + '<item><title>Older &amp; wiser</title><pubDate>Fri, 18 Sep 2026 08:00:00 GMT</pubDate><description><![CDATA[<p>x</p>]]></description></item>'
    + '<item><title><![CDATA[Brug in <b>Gent</b> dicht &#8211; omleiding]]></title><pubDate>Sat, 19 Sep 2026 09:30:00 GMT</pubDate></item>'
    + '<item><title></title><pubDate>Sat, 19 Sep 2026 09:45:00 GMT</pubDate></item>'
    + '</channel></rss>';
  const ATOM = '<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>School Wilgenhoek</title>'
    + '<link rel="self" href="https://s.example/feed"/><updated>2026-09-19T00:00:00Z</updated>'
    + '<entry><title>Pyjamadag vrijdag</title><published>2026-09-17T07:00:00Z</published><content type="html">&lt;p&gt;x&lt;/p&gt;</content></entry>'
    + '<entry><title>Schoolfeest 3 oktober</title><published>2026-09-18T07:00:00Z</published></entry>'
    + '</feed>';

  function net(map) {
    return async (url) => {
      const u = String(url);
      if (u === CAL) return okText(ICS);
      if (map[u] === undefined) return fail(404);
      if (map[u] === null) throw new Error('down');
      return okText(map[u]);
    };
  }

  test('no News setting, no news on the board', async () => {
    const { run } = runTransform(net({}), NOW);
    const r = await run(baseInput(NOW, { config_json: CAL }));
    assertEqual(r.data.news, null);
  });

  test('RSS and Atom are read, newest first and the feeds in turn', async () => {
    const { run } = runTransform(net({ 'https://x.example/rss': RSS, 'https://s.example/feed': ATOM }), NOW);
    const r = await run(baseInput(NOW, { config_json: CAL,
      news_feeds: '# the paper\nhttps://x.example/rss\nschool https://s.example/feed\n', news_count: '2' }));
    const n = r.data.news;
    assert(n && n.items, 'no news came back');
    assertEqual(n.max, 2);
    assertEqual(n.items.map((i) => i.title),
      ['Brug in Gent dicht – omleiding', 'Schoolfeest 3 oktober', 'Older & wiser', 'Pyjamadag vrijdag']);
    assertEqual(n.items.map((i) => i.source), ['Het Nieuwsblad', 'School Wilgenhoek', 'Het Nieuwsblad', 'School Wilgenhoek']);
  });

  test('a feed that is not a feed, and one that is down, are left out', async () => {
    const { run } = runTransform(net({ 'https://x.example/rss': RSS, 'https://h.example/': '<html><body>hi</body></html>', 'https://d.example/': null }), NOW);
    const r = await run(baseInput(NOW, { config_json: CAL,
      news_feeds: 'https://h.example/\nhttps://d.example/\nhttps://x.example/rss' }));
    assertEqual(r.data.news.items.length, 2);
    assertEqual(r.data.news.max, 3);
  });

  test('the last headlines are kept for a refresh on which every feed is down', async () => {
    const first = runTransform(net({ 'https://x.example/rss': RSS }), NOW);
    const r1 = await first.run(baseInput(NOW, { config_json: CAL, news_feeds: 'https://x.example/rss' }));
    assert(r1.trmnl_state && r1.trmnl_state.news && r1.trmnl_state.news.items.length === 2, 'the headlines were not saved');
    const later = NOW + 30 * 60 * 1000;
    const second = runTransform(net({ 'https://x.example/rss': null }), later);
    const input = baseInput(later, { config_json: CAL, news_feeds: 'https://x.example/rss' });
    input.trmnl.state = r1.trmnl_state;
    const r2 = await second.run(input);
    assert(r2.data.news && r2.data.news.items.length === 2, 'the saved headlines were not used');
    // ...but not forever, and not for a different set of feeds
    const stale = NOW + 7 * 3600 * 1000;
    const third = runTransform(net({ 'https://x.example/rss': null }), stale);
    const input3 = baseInput(stale, { config_json: CAL, news_feeds: 'https://x.example/rss' });
    input3.trmnl.state = r1.trmnl_state;
    assertEqual((await third.run(input3)).data.news, null);
    const input4 = baseInput(later, { config_json: CAL, news_feeds: 'https://other.example/rss' });
    input4.trmnl.state = r1.trmnl_state;
    assertEqual((await second.run(input4)).data.news, null);
  });

  test('the example day carries the news too', async () => {
    const { run } = runTransform(async (url) => {
      const u = String(url);
      if (u === 'https://x.example/rss') return okText(RSS);
      return h.demoNet ? h.demoNet(url) : fail(404);
    }, NOW);
    const r = await run(baseInput(NOW, { news_feeds: 'https://x.example/rss' }));
    assert(r.data.news && r.data.news.items.length === 2, 'the demo board has no news');
  });
};
