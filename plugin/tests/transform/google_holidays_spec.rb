# frozen_string_literal: true

# GOOGLE'S PUBLIC HOLIDAY CALENDARS, AS GOOGLE SERVES THEM.
#
# The config editor's wizard wrote Belgium as `en.belgian#holiday`, which
# Google answers with a 500 page: the board never had a holiday to show, and
# on a day without one nothing looked wrong. Belgium is `en.be` (or `nl.be`,
# `fr.be`). A config holding the old address is read from the right one.
#
# The feed below is trimmed from Google's own shape: whole days with an
# exclusive DTEND, TRANSP, a folded DESCRIPTION with an escaped comma, and
# years of entries either side of the one that matters.

require 'date'

require_relative '../support/transform'

RSpec.describe 'google-holidays' do
  include Metro::Transform

  # The pure builders, for the mocks and inputs built at describe level.
  h = Object.new.extend(Metro::Transform)

  bad = 'https://calendar.google.com/calendar/ical/en.belgian%23holiday%40group.v.calendar.google.com/public/basic.ics'
  good = 'https://calendar.google.com/calendar/ical/en.be%23holiday%40group.v.calendar.google.com/public/basic.ics'

  day = lambda do |date, summary, what = nil|
    following = Date.new(date[0...4].to_i, date[4...6].to_i, date[6...8].to_i) + 1
    last = following.strftime('%Y%m%d')
    "BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:#{date}\r\nDTEND;VALUE=DATE:#{last}\r\n" \
      "DTSTAMP:20260914T234036Z\r\nUID:#{date}_x@google.com\r\nCLASS:PUBLIC\r\n" +
      (if what == 'obs'
         "DESCRIPTION:Observance\\nTo hide observances\\, go to Google Calendar Setting\r\n s > Holidays in Belgium\r\n"
       else
         "DESCRIPTION:Public holiday\r\n"
       end) +
      "SEQUENCE:0\r\nSTATUS:CONFIRMED\r\nSUMMARY:#{summary}\r\nTRANSP:TRANSPARENT\r\nEND:VEVENT\r\n"
  end
  feed = "BEGIN:VCALENDAR\r\nPRODID:-//Google Inc//Google Calendar 70.9054//EN\r\nVERSION:2.0\r\n" \
         "CALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nX-WR-CALNAME:Holidays in Belgium\r\nX-WR-TIMEZONE:UTC\r\n" +
         day.('20211111', 'Armistice Day') + day.('20261025', 'Daylight Saving Time ends', 'obs') +
         day.('20261101', "All Saints' Day") + day.('20261111', 'Armistice Day') +
         day.('20261225', 'Christmas Day') + day.('20261226', 'Boxing Day') + day.('20311111', 'Armistice Day') +
         "END:VCALENDAR\r\n"

  # Google as it answers: the right id is the feed, anything else a 500.
  google = -> { [h.serve(good, feed), h.otherwise(500)] }
  brussels = lambda do |now_ms, config|
    input = h.base_input(now_ms, config_json: config)
    input['trmnl']['user']['time_zone_iana'] = 'Europe/Brussels'
    input
  end

  it "the wizard's old Belgian holiday link is read from the one Google serves" do
    now = ms('2026-11-11T08:00:00Z')
    # feedUrl is an internal function: called directly, in node
    feed_url = ->(url) { internals('return T.feedUrl(args.url);', now:, args: { url: }) }
    assert_equal(feed_url.(bad), good)
    assert_equal(feed_url.(bad.sub('en.belgian', 'nl.belgian')), good.sub('en.be', 'nl.be'))
    assert_equal(feed_url.('https://example.com/en.belgian%23holiday%40x.ics'), 'https://example.com/en.belgian%23holiday%40x.ics')
    r = run_transform(google.(), now, brussels.(now, JSON.generate(calendars: [{ url: bad, holiday: true }])))
    assert_equal(requests_of(r).map { it['url'] }, [good])
    assert_equal((r['data']['holidays'] || []).map { [it['title'], it['day']] }, [['Armistice Day', 0]])
    assert_equal(r['data']['legend'], [], 'a holiday feed drew a line')
  end

  it "a link list with the holiday word names tomorrow's holiday in the account's zone" do
    # 23:30 in Brussels on Christmas Eve is still the 24th there, and 22:30 UTC.
    now = ms('2026-12-24T22:30:00Z')
    r = run_transform(google.(), now, brussels.(now, "#{good} holiday"))
    got = (r['data']['holidays'] || []).map { [it['title'], it['day']] }
    assert(got.any? { it[0] == 'Christmas Day' && it[1] == 1 }, "Christmas is not tomorrow: #{got.to_json}")
    assert(!got.any? { it[0] == 'Christmas Day' && it[1] == 0 }, 'Christmas was announced a day early')
  end

  # Google's address says what the feed is, so the word is not needed for
  # it. An explicit `holiday: false` still wins.
  it 'a Google holiday link is a holiday feed without the word' do
    now = ms('2026-11-11T08:00:00Z')
    r = run_transform(google.(), now, brussels.(now, "Belgium #{good}"))
    assert_equal((r['data']['holidays'] || []).map { it['title'] }, ['Armistice Day'], 'the Google feed was not read as holidays')
    assert_equal(r['data']['legend'], [], 'a Google holiday feed drew a line')
    as_line = run_transform(google.(), now,
                            brussels.(now, JSON.generate(calendars: [{ url: good, holiday: false, line: 'BE' }])))
    assert_equal(as_line['data']['legend'].map { it['name'] }, ['BE'], 'holiday: false did not win')
  end

  it 'a day with no holiday in the feed has none, and nothing is down' do
    now = ms('2026-09-15T08:00:00Z')
    r = run_transform(google.(), now, brussels.(now, "#{good} holiday"))
    assert_equal(r['data']['holidays'], [])
    assert_equal(r['data']['calendars_down'], [])
  end
end
