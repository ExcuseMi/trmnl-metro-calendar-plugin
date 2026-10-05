# frozen_string_literal: true

# FEEDS THAT ARE NOT QUITE CALENDARS: a bin-day generator.
#
# "I have these for garbage collection, they are marked as todos." The feed
# is VTODOs with a DUE time the evening before collection, written as UTC
# although it was asked for in local time, and several bins fall due at the
# same minute. Three things, each checked here: a to-do is a moment at its
# due time; `ignoreTimezone` reads a calendar's times as the board's own wall
# clock; `mergeSameTime` makes things due at the same minute one stop.

require_relative '../support/transform'

RSpec.describe 'todo-feeds' do
  include Metro::Transform

  now = Time.iso8601('2026-09-15T08:00:00Z').to_i * 1000 # a Tuesday morning
  brussels = 'Europe/Brussels'

  todo = lambda do |summary, due, extra = nil|
    (['BEGIN:VTODO', "UID:#{summary}#{due}", 'DTSTAMP:20260916T000000Z',
      "SUMMARY;LANGUAGE=\"NL\":#{summary}", "DUE:#{due}"] + (extra || []) + ['END:VTODO']).join("\r\n")
  end
  feed = lambda do |items|
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:recycle\r\n#{items.join("\r\n")}\r\nEND:VCALENDAR\r\n"
  end
  bins = feed.call([
    todo.call('Restafval', '20260915T190000Z'),
    todo.call('PMD', '20260915T190000Z'),
    todo.call('Papier-karton', '20260915T190000Z'),
    todo.call('Tuinafvalbak', '20260914T190000Z'), # yesterday evening
    todo.call('Glas', '20260915T180000Z', ['STATUS:COMPLETED'])
  ])

  define_method(:input) do |cal|
    i = base_input(now, config_json: JSON.generate({
      lines: [{ name: 'Bins' }],
      calendars: [{ url: 'https://example.com/bins.ics', name: 'Bins' }.merge(cal)]
    }))
    i['trmnl']['user']['time_zone_iana'] = brussels
    i
  end
  define_method(:run_bins) { |cal| run_transform([otherwise(bins)], now, input(cal)) }
  # minutes past today's midnight, the payload's own clock
  at = ->(e) { e['start_min'] }
  define_method(:today_of) { |r| event_items(r['data']).select { |e| e['start_min'].is_a?(Numeric) && e['start_min'] >= 0 && e['start_min'] < 1440 } }

  it 'a to-do is a stop at its due time, and one that is done is not' do
    r = run_bins({})
    today = today_of(r)
    titles = today.map { it['title'] }.sort
    assert_equal(titles, %w[PMD Papier-karton Restafval], 'the to-dos due today')
    # 19:00Z is 21:00 in Brussels in September
    assert(today.all? { |e| at.call(e) == 21 * 60 }, "due at #{today.map(&at).join(', ')}")
    assert(today.all? { |e| e['end_min'] == e['start_min'] }, 'a to-do has no length: it is a moment')
  end

  it 'ignoreTimezone reads the feed\'s UTC times as the board\'s own clock' do
    r = run_bins({ ignoreTimezone: true })
    today = today_of(r)
    assert(today.length == 3, "#{today.length} to-dos today")
    assert(today.all? { |e| at.call(e) == 19 * 60 }, "due at #{today.map(&at).join(', ')}, not 19:00")
  end

  it 'mergeSameTime makes things due at the same minute on one line one stop' do
    r = run_bins({ ignoreTimezone: true, mergeSameTime: true })
    today = today_of(r)
    assert_equal(today.length, 1, 'one stop for the three bins')
    assert_equal(today[0]['title'].split(' · ').sort, %w[PMD Papier-karton Restafval], 'every bin named once')
    # and as a list, so the board can set them a name to a row
    assert_equal((today[0]['parts'] || []).sort, %w[PMD Papier-karton Restafval], 'the names do not travel as a list')
  end

  it 'without mergeSameTime they stay separate, and a rule still acts on one of them' do
    plain = run_bins({ ignoreTimezone: true })
    assert_equal(today_of(plain).length, 3, 'three stops')
    hid = run_bins({ ignoreTimezone: true, mergeSameTime: true,
                rules: [{ match: { type: 'contains', value: 'PMD' }, hide: true }] })
    today = today_of(hid)
    assert_equal(today.length, 1, 'still one stop')
    assert(!today[0]['title'].include?('PMD'), "a hidden bin was merged in: #{today[0]['title']}")
  end
end
