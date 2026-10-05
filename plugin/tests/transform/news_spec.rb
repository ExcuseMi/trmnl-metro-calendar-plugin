# frozen_string_literal: true

# THE NEWS: a few headlines from RSS or Atom feeds the household names, read
# without an XML parser (see parseNewsFeed) and handed to the board as
# { items: [{ title, source }], max }. Newest first within a feed, the feeds
# taken in turn, the last good read kept for a refresh on which nothing
# answers, and nothing at all when the setting is empty.

require_relative '../support/transform'

RSpec.describe 'news' do
  include Metro::Transform

  now = Time.iso8601('2026-09-19T10:00:00Z').to_i * 1000
  cal = 'https://calendar.example.com/a.ics'
  ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n"

  rss = '<?xml version="1.0"?><rss version="2.0"><channel><title>Het Nieuwsblad - Regio</title>' \
        '<link>https://x.example</link>' \
        '<item><title>Older &amp; wiser</title><pubDate>Fri, 18 Sep 2026 08:00:00 GMT</pubDate><description><![CDATA[<p>x</p>]]></description></item>' \
        '<item><title><![CDATA[Brug in <b>Gent</b> dicht &#8211; omleiding]]></title><pubDate>Sat, 19 Sep 2026 09:30:00 GMT</pubDate></item>' \
        '<item><title></title><pubDate>Sat, 19 Sep 2026 09:45:00 GMT</pubDate></item>' \
        '</channel></rss>'
  atom = '<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>School Wilgenhoek</title>' \
         '<link rel="self" href="https://s.example/feed"/><updated>2026-09-19T00:00:00Z</updated>' \
         '<entry><title>Pyjamadag vrijdag</title><published>2026-09-17T07:00:00Z</published><content type="html">&lt;p&gt;x&lt;/p&gt;</content></entry>' \
         '<entry><title>Schoolfeest 3 oktober</title><published>2026-09-18T07:00:00Z</published></entry>' \
         '</feed>'

  # The calendar answers; each mapped URL answers its text, or (nil) drops
  # the connection so the fetch throws; anything else is a 404.
  define_method(:net) do |map|
    [serve(cal, ics)] + map.map { |u, text| text.nil? ? [u, { error: :reset }] : serve(u, text) }
  end
  # `news` as the payload has it: JSON null, which a missing key is not
  # (the old assertEqual(undefined, null) failed)
  news_of = ->(r) { r['data'].fetch('news', 'undefined') }

  it 'no News setting, no news on the board' do
    r = run_transform(net({}), now, base_input(now, config_json: cal))
    assert_equal(news_of.call(r), nil)
  end

  it 'RSS and Atom are read, newest first and the feeds in turn' do
    r = run_transform(net({ 'https://x.example/rss' => rss, 'https://s.example/feed' => atom }), now,
                      base_input(now, config_json: cal,
                                      news_feeds: "# the paper\nhttps://x.example/rss\nschool https://s.example/feed\n", news_count: '2'))
    n = r['data']['news']
    assert(n && n['items'], 'no news came back')
    assert_equal(n['max'], 2)
    assert_equal(n['items'].map { it['title'] },
                 ['Brug in Gent dicht – omleiding', 'Schoolfeest 3 oktober', 'Older & wiser', 'Pyjamadag vrijdag'])
    assert_equal(n['items'].map { it['source'] }, ['Het Nieuwsblad', 'School Wilgenhoek', 'Het Nieuwsblad', 'School Wilgenhoek'])
  end

  it '"as many as fit on one row" travels as one row with the fit flag' do
    r = run_transform(net({ 'https://x.example/rss' => rss }), now,
                      base_input(now, config_json: cal, news_feeds: 'https://x.example/rss', news_count: 'fit'))
    assert_equal(r['data']['news']['max'], 1)
    assert_equal(r['data']['news']['fit'], true)
    assert_equal(r['data']['news']['items'].length, 2)
  end

  it 'a feed that is not a feed, and one that is down, are left out' do
    r = run_transform(net({ 'https://x.example/rss' => rss, 'https://h.example/' => '<html><body>hi</body></html>', 'https://d.example/' => nil }), now,
                      base_input(now, config_json: cal,
                                      news_feeds: "https://h.example/\nhttps://d.example/\nhttps://x.example/rss"))
    assert_equal(r['data']['news']['items'].length, 2)
    # the default is the one row of as many as fit
    assert_equal(r['data']['news']['max'], 1)
    assert_equal(r['data']['news']['fit'], true)
  end

  it 'the last headlines are kept for a refresh on which every feed is down' do
    r1 = run_transform(net({ 'https://x.example/rss' => rss }), now,
                       base_input(now, config_json: cal, news_feeds: 'https://x.example/rss'))
    assert(r1['trmnl_state'] && r1['trmnl_state']['news'] && r1['trmnl_state']['news']['items'].length == 2, 'the headlines were not saved')
    later = now + 30 * 60 * 1000
    second = net({ 'https://x.example/rss' => nil })
    input = base_input(later, config_json: cal, news_feeds: 'https://x.example/rss')
    input['trmnl']['state'] = r1['trmnl_state']
    r2 = run_transform(second, later, input)
    assert(r2['data']['news'] && r2['data']['news']['items'].length == 2, 'the saved headlines were not used')
    # ...but not forever, and not for a different set of feeds
    stale = now + 7 * 3600 * 1000
    third = net({ 'https://x.example/rss' => nil })
    input3 = base_input(stale, config_json: cal, news_feeds: 'https://x.example/rss')
    input3['trmnl']['state'] = r1['trmnl_state']
    assert_equal(news_of.call(run_transform(third, stale, input3)), nil)
    input4 = base_input(later, config_json: cal, news_feeds: 'https://other.example/rss')
    input4['trmnl']['state'] = r1['trmnl_state']
    assert_equal(news_of.call(run_transform(second, later, input4)), nil)
  end

  it 'the example day carries the news too' do
    r = run_transform([serve('https://x.example/rss', rss)] + demo_mocks, now,
                      base_input(now, news_feeds: 'https://x.example/rss'))
    assert(r['data']['news'] && r['data']['news']['items'].length == 2, 'the demo board has no news')
  end
end
