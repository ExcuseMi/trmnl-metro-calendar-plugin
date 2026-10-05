# frozen_string_literal: true

# Saved state (https://help.trmnl.com/en/articles/16777795): run() returns
# `trmnl_state` and the runtime hands it back as `input.trmnl.state` on the
# next render. It exists so a render can know three things a single render
# cannot work out on its own:
#
#   - what the weather was the last time the API answered, so one failed
#     forecast call does not blank the header and every sky marker
#   - how long each feed has been failing, so a feed that is really down
#     gets named on the board instead of quietly taking its events with it
#   - what a feed that is failing right now is CALLED, since an unnamed
#     feed is named by its own X-WR-CALNAME and a feed that cannot answer
#     cannot tell us its name
#
# Everything in here has to survive state being absent, a string, or
# nonsense: it is input, and it comes from outside.

require_relative '../support/transform'

RSpec.describe 'saved-state' do
  include Metro::Transform

  # The pure builders (serve, status, otherwise, ics_with_events, base_input),
  # for the mocks and inputs built at describe level.
  h = Object.new.extend(Metro::Transform)
  forecast_url = Metro::Transform::FORECAST
  i18n = Metro::Transform::I18N

  now = Time.iso8601('2026-09-09T09:00:00Z').to_i * 1000
  now_s = now / 1000
  iso_today = '20260909'
  ics_url = 'https://cloud.example.com/cal-2.ics'

  ics = h.ics_with_events([
    { start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Afternoon' }
  ]).sub("VERSION:2.0\r\n", "VERSION:2.0\r\nX-WR-CALNAME:Alex Personal\r\n")

  forecast = JSON.generate(
    daily: {
      temperature_2m_max: [21], temperature_2m_min: [12], precipitation_probability_max: [40],
      weathercode: [61], sunrise: ['2026-09-09T07:05'], sunset: ['2026-09-09T19:45']
    },
    hourly: { time: ['2026-09-09T13:00', '2026-09-09T14:00'], precipitation_probability: [80, 10] }
  )

  # `calendarsFail`/`weatherFails` decide which half of the network is out;
  # everything else answers.
  net = lambda do |opts = {}|
    [
      opts[:weatherFails] ? h.status(forecast_url, 503) : h.serve(forecast_url, forecast),
      h.status(i18n, 404),
      opts[:calendarsFail] ? h.otherwise(500) : h.otherwise(ics)
    ]
  end

  # JS `undefined`: a state the input does not carry at all, as against null.
  undefined = Object.new.freeze
  input = lambda do |extra = {}, state = undefined|
    i = h.base_input(now, {
      'use_demo_data' => 'false',
      'config_json' => JSON.generate(calendars: [{ url: ics_url }]),
      'lat_lon' => '51.05,3.72'
    }.merge(extra))
    i['trmnl']['state'] = state unless state.equal?(undefined)
    i
  end

  # JS `x && typeof x === 'object'` (an array is one too), and JS `!x`.
  object = ->(x) { x.is_a?(Hash) || x.is_a?(Array) }
  falsy = ->(x) { x.nil? || x == false || x == 0 || x == '' }
  stringify = ->(x) { x.equal?(undefined) ? 'undefined' : x.to_json }

  it 'run() hands saved state back to the runtime, not just the board' do
    r = run_transform(net.(), now, input.())
    assert(object.(r['trmnl_state']),
           "no trmnl_state came back: #{(r || {}).keys.to_json}")
    assert(r['data'], 'the payload lost its metro key')
  end

  it 'the last good forecast is kept and replayed when the weather API fails' do
    good = run_transform(net.(), now, input.())
    assert(!good['data']['header_weather']['hi'].nil?, 'the live forecast did not render')
    # the state is stored as JSON by the runtime, so round-trip it
    saved = deep_copy(good['trmnl_state'])

    later = run_transform(net.(weatherFails: true), now, input.({}, saved))
    assert(later['data']['header_weather']['hi'] == good['data']['header_weather']['hi'],
           "a failed forecast blanked the header instead of reusing the last one: #{later['data']['header_weather'].to_json}")
    assert(later['data']['weather_stale'] == false, 'a forecast minutes old is not stale')
    # the markers come back too, not only the header numbers
    marks = later['data']['weather'].select { it['type'] == 'weather' }
    assert(marks.length > 0, 'the replayed forecast came back with no markers at all')
    assert(later['data']['weather'].all? { it['type'] == 'weather' },
           "the replay put a sun marker back: #{later['data']['weather'].to_json}")
  end

  # A SUN AT TEN AT NIGHT. "Rain stops" is drawn as a sun, because clearing
  # up is what it means; after sunset that is a sun in the dark.
  it 'rain that stops after sunset is a clear night, not a sun' do
    snap = {
      weather: { hi: 18, lo: 13, condition: 'rain', icon: 'wi-day-rain.svg', rain_chance: 96, unit: 'C',
                 milestones: [{ atMin: 16 * 60, kind: 'rain_starts' }, { atMin: 20 * 60, kind: 'rain_stops' }],
                 perDay: [{ hi: 18, lo: 13, condition: 'rain', rain_chance: 96,
                            milestones: [{ atMin: 16 * 60, kind: 'rain_starts' }, { atMin: 20 * 60, kind: 'rain_stops' }],
                            sunrise_min: 7 * 60 + 5, sunset_min: 19 * 60 + 45 }] },
      weatherFetchedAt: now_s - 600
    }
    r = run_transform(net.(weatherFails: true), now, input.({}, snap))
    marks = (r['data']['weather'] || []).select { it['type'] == 'weather' }
    stops = marks.select { |m| /20:00|8pm/.match?((m['label'] || '').to_s) }[0]
    assert(stops, "no rain-stops marker came back: #{marks.to_json}")
    assert(/wi-night-clear/.match?(stops['icon'].to_s),
           "rain stopping at 20:00, a quarter hour after sunset, drew #{stops['icon']}")
    starts = marks.select { |m| /16:00|4pm/.match?((m['label'] || '').to_s) }[0]
    assert(starts && /wi-rain/.match?(starts['icon'].to_s),
           "the start of the rain should be unchanged: #{starts.to_json}")
  end

  it 'rain that stops before sunrise is a clear night too' do
    # The other half of the night, and the half that was only ever in the
    # code: a spell ending at half six on a morning the sun comes up at five
    # past seven is still dark out.
    snap = {
      weather: { hi: 18, lo: 13, condition: 'rain', icon: 'wi-day-rain.svg', rain_chance: 96, unit: 'C',
                 milestones: [{ atMin: 6 * 60 + 30, kind: 'rain_stops' }],
                 perDay: [{ hi: 18, lo: 13, condition: 'rain', rain_chance: 96,
                            milestones: [{ atMin: 6 * 60 + 30, kind: 'rain_stops' }],
                            sunrise_min: 7 * 60 + 5, sunset_min: 19 * 60 + 45 }] },
      weatherFetchedAt: now_s - 600
    }
    r = run_transform(net.(weatherFails: true), now, input.({}, snap))
    marks = (r['data']['weather'] || []).select { it['type'] == 'weather' }
    assert(marks.length > 0, 'no marker came back at all')
    assert(/wi-night-clear/.match?(marks[0]['icon'].to_s),
           "rain stopping at 06:30, half an hour before sunrise, drew #{marks[0]['icon']}")
  end

  it 'a snapshot with no sun times keeps the sun it always drew' do
    # Saved state outlives a build. A snapshot written before the board knew
    # its own sunrise has no sun to reason from, and the answer to that is
    # the old picture rather than a guess at the dark.
    snap = {
      weather: { hi: 18, lo: 13, condition: 'rain', icon: 'wi-day-rain.svg', rain_chance: 96, unit: 'C',
                 milestones: [{ atMin: 20 * 60, kind: 'rain_stops' }] },
      weatherFetchedAt: now_s - 600
    }
    r = run_transform(net.(weatherFails: true), now, input.({}, snap))
    marks = (r['data']['weather'] || []).select { it['type'] == 'weather' }
    assert(marks.length > 0 && /wi-day-sunny/.match?(marks[0]['icon'].to_s),
           "with no sun times it should draw what it always drew: #{marks.to_json}")
  end

  it 'rain that stops in daylight still clears to a sun' do
    snap = {
      weather: { hi: 18, lo: 13, condition: 'rain', icon: 'wi-day-rain.svg', rain_chance: 96, unit: 'C',
                 milestones: [{ atMin: 11 * 60, kind: 'rain_stops' }],
                 perDay: [{ hi: 18, lo: 13, condition: 'rain', rain_chance: 96,
                            milestones: [{ atMin: 11 * 60, kind: 'rain_stops' }],
                            sunrise_min: 7 * 60 + 5, sunset_min: 19 * 60 + 45 }] },
      weatherFetchedAt: now_s - 600
    }
    r = run_transform(net.(weatherFails: true), now, input.({}, snap))
    marks = (r['data']['weather'] || []).select { it['type'] == 'weather' }
    assert(marks.length > 0 && /wi-day-sunny/.match?(marks[0]['icon'].to_s),
           "rain stopping at 11:00 should still be a sun: #{marks.to_json}")
  end

  it 'a replayed forecast old enough to be another day says so' do
    # Six hours is the line: past it the "forecast" may be describing
    # yesterday, and a board that shows yesterday's weather as today's is
    # worse than one that admits the number is old.
    stale = {
      weather: { hi: 9, lo: 2, condition: 'snow', icon: 'wi-day-snow.svg', rain_chance: 70, unit: 'C',
                 milestones: [{ atMin: 600, kind: 'snow' }], sun: [{ kind: 'sunrise', atMin: 430 }] },
      weatherFetchedAt: now_s - 7 * 3600
    }
    r = run_transform(net.(weatherFails: true), now, input.({}, stale))
    assert(r['data']['header_weather']['hi'] == 9,
           "the old forecast was dropped rather than shown: #{r['data']['header_weather'].to_json}")
    assert(r['data']['weather_stale'] == true, 'a seven-hour-old forecast should be flagged stale')
  end

  it 'a feed that fails starts a clock, and clears it when it comes back' do
    r1 = run_transform(net.(calendarsFail: true), now, input.())
    assert(r1['trmnl_state']['calendarDown'][ics_url] == now_s,
           "the failure was not recorded: #{r1['trmnl_state']['calendarDown'].to_json}")

    r2 = run_transform(net.(), now, input.({}, deep_copy(r1['trmnl_state'])))
    assert(falsy.(r2['trmnl_state']['calendarDown'][ics_url]),
           "a feed that answered again is still marked down: #{r2['trmnl_state']['calendarDown'].to_json}")
  end

  it 'a feed that is not answering is named on THIS board, not on a later one' do
    # It used to take two hours. The thinking was that a single 500 on a
    # morning refresh is noise -- the plugin retries in fifteen minutes --
    # and that is true of the FEED. It is not true of the board: for those
    # two hours a person's whole day is missing from the map and every other
    # thing on it looks completely normal. A reader cannot tell a quiet
    # Tuesday from a calendar that did not load.
    #
    # Asked for directly, after two photographs of one board six minutes
    # apart lost different people's events each time: "we can't just drop
    # events, feeds without the user knowing".
    mocks = net.(calendarsFail: true)

    first = run_transform(mocks, now, input.())
    assert(first['data']['calendars_down'].length == 1,
           "a feed that failed on this very render was not named: #{first['data']['calendars_down'].to_json}")

    # ...and it is named with the name it had when it last answered, which
    # is the only thing a feed that cannot answer cannot tell us.
    known = run_transform(mocks, now, input.({}, {
      calendarDown: { ics_url => now_s - 10 * 60 },
      calendarNames: { ics_url => 'Alex Personal' }
    }))
    assert(known['data']['calendars_down'].join(',') == 'Alex Personal',
           "expected the failing feed named on the board, got #{known['data']['calendars_down'].to_json}")

    # The clock is still kept: it is what lets a feed that comes back clear
    # itself, and how long it has been down is worth knowing even though it
    # no longer decides whether the reader is told.
    assert(known['trmnl_state']['calendarDown'][ics_url] == now_s - 10 * 60,
           "the down-since clock was not carried: #{known['trmnl_state']['calendarDown'].to_json}")
  end

  it 'a feed that answers says nothing, so the mark means something' do
    # The other half of the ratchet: if a working board ever shows the
    # warning, the warning stops being read at all.
    r = run_transform(net.(), now, input.())
    assert_equal(r['data']['calendars_down'], [], 'a board whose feeds all answered raised an alert')
  end

  it 'a failing feed keeps the name it had, instead of becoming its URL' do
    # The name of a feed the config did not name comes from the feed's own
    # X-WR-CALNAME, so a feed that cannot answer cannot say what it is
    # called. Remembered, it stays "Alex Personal"; forgotten, it degrades
    # to whatever the link happens to end in.
    good = run_transform(net.(), now, input.())
    assert(good['trmnl_state']['calendarNames'][ics_url] == 'Alex Personal',
           "the feed name was not remembered: #{good['trmnl_state']['calendarNames'].to_json}")

    # Named only when there is nothing to show in its place -- the remembered
    # read is what decides that, so it is dropped here and kept in the cache
    # tests below.
    saved = deep_copy(good['trmnl_state'])
    saved.delete('feeds')
    second = net.(calendarsFail: true)
    later = run_transform(second, now, input.({}, saved))
    assert(later['data']['calendars_down'].join(',') == 'Alex Personal',
           "the failing feed lost its name: #{later['data']['calendars_down'].to_json}")

    # and with nothing remembered it falls back to the link, not to nothing
    cold = run_transform(second, now, input.({}, {}))
    assert(cold['data']['calendars_down'].length == 1 && /Cal/.match?(cold['data']['calendars_down'][0].to_s),
           "expected a URL-derived name as the last resort, got #{cold['data']['calendars_down'].to_json}")
  end

  # ------------------------------------------- the last good read of a feed
  #
  # A feed that does not answer used to take its events off the board with
  # it, and say nothing about it for two hours. Two photographs of one real
  # board six minutes apart lost different people's events each time, with
  # the map looking perfectly normal both times: "it's dropped events like
  # crazy", "we can't just drop events, feeds without the user knowing".
  #
  # The day is put back from the LAST RENDER'S OWN OUTPUT --
  # `input.trmnl.previous_merge_variables` -- rather than from saved state,
  # which is 8192 bytes and not many meetings: remembering the feeds there,
  # the households with enough calendars to need it were exactly the ones
  # whose reads would not fit. State keeps one number per feed, which is when
  # it last answered, because the payload cannot say that about itself: a
  # render that replayed a feed writes those events back out as its own.
  prev_of = ->(data) { Metro.deep_copy(data) }
  with_prev = lambda do |state, prev, extra = nil|
    i = input.(extra || {}, state)
    i['trmnl']['previous_merge_variables'] = prev
    i
  end

  it 'every event says which calendar drew it, and state remembers when it answered' do
    good = run_transform(net.(), now, input.())
    ev = (good['data']['events'] || []).select { it['type'] == 'event' }
    assert(ev.length > 0, 'the healthy board drew no events')
    assert(ev.all? { it['f'] == 0 },
           "an event does not say which calendar drew it: #{ev.map { it['f'] }.to_json}")
    assert_equal(good['trmnl_state']['feedOk'][ics_url], now_s,
                 "state did not record when the feed answered: #{good['trmnl_state']['feedOk'].to_json}")
    # ...and that is ALL it records. The events are 8192 bytes' worth of
    # nothing waiting to happen.
    size = JSON.generate(good['trmnl_state']).length
    assert(size < 1500, "saved state is carrying more than the clocks: #{size} bytes")
  end

  it 'a feed that fails is replayed from the last render, and says nothing yet' do
    good = run_transform(net.(), now, input.())
    had = event_items(good['data']).map { it['title'] }.sort
    assert(had.length > 0, 'the healthy board had no events to compare against')

    r = run_transform(net.(calendarsFail: true), now, with_prev.(good['trmnl_state'], prev_of.(good['data'])))
    assert_equal(event_items(r['data']).map { it['title'] }.sort, had,
                 'the events were not replayed from the previous render')
    # Nothing is missing from the map, so nothing is claimed to be.
    assert_equal(r['data']['calendars_down'], [],
                 'the board cried wolf about a feed whose day it was still showing')
    # ...and they still say whose calendar they are, so the render after
    # this one can do the same again.
    assert((r['data']['events'] || []).select { it['type'] == 'event' }.all? { it['f'] == 0 },
           'the replayed events lost the mark saying which calendar drew them')
  end

  it '...and once that feed has been silent six hours the board says so, still showing it' do
    good = run_transform(net.(), now, input.())
    had = event_items(good['data']).map { it['title'] }.sort
    state = deep_copy(good['trmnl_state'])
    state['feedOk'][ics_url] = now_s - 6 * 3600 - 60

    r = run_transform(net.(calendarsFail: true), now, with_prev.(state, prev_of.(good['data'])))
    assert_equal(event_items(r['data']).map { it['title'] }.sort, had,
                 'a stale day is still the best there is and must stay on the board')
    assert_equal(r['data']['calendars_down'], ['Alex Personal'],
                 'a feed silent for six hours was not announced')
  end

  it 'a calendar silent for a whole day takes the band along the bottom' do
    # Six hours is a marked line under the map, which is the right size for
    # "this may be a little out of date". A day is not that: what is on the
    # board for those people is yesterday and they cannot tell by looking.
    # "Show the errors as service alert after 24h."
    good = run_transform(net.(), now, input.())
    had = event_items(good['data']).map { it['title'] }.sort
    state = deep_copy(good['trmnl_state'])
    state['feedOk'][ics_url] = now_s - 24 * 3600 - 60

    r = run_transform(net.(calendarsFail: true), now, with_prev.(state, prev_of.(good['data'])))
    a = r['data']['service_alert']
    assert(a && a['kind'] == 'feed', "a day-old calendar did not reach the band: #{a.to_json}")
    assert(a['text'].include?('Alex Personal'), "the band does not say which calendar: #{a['text']}")
    # Nothing to fetch: the mark is drawn by the template, because a board
    # whose network failed is the worst moment to want another request.
    # (The key has to be there and null: a missing one was not equal to null.)
    assert(a.key?('icon'), 'the feed band is asking for an icon off the network: expected null, got undefined')
    assert_equal(a['icon'], nil, 'the feed band is asking for an icon off the network')
    # ...and it is still under the map as well, and still showing the day.
    assert_equal(r['data']['calendars_down'], ['Alex Personal'], 'the quieter line was dropped')
    assert_equal(event_items(r['data']).map { it['title'] }.sort, had,
                 'the band replaced the day instead of announcing it')
  end

  it 'a calendar gone a day outranks the weather for the band' do
    # One band, two things that might want it. Rain is a fact the reader can
    # check out of the window; a day of somebody else's calendar missing is
    # not something they can check at all.
    good = run_transform(net.(), now, input.())
    state = deep_copy(good['trmnl_state'])
    state['feedOk'][ics_url] = now_s - 24 * 3600 - 60
    wet = { 'alert_enabled' => 'true', 'alert_rain_threshold' => '10' }
    r = run_transform(net.(calendarsFail: true), now, with_prev.(state, prev_of.(good['data']), wet))
    assert_equal((r['data']['service_alert'] || {})['kind'], 'feed',
                 'the weather took the band from a calendar that has been gone a day')
  end

  it '...and under a day the weather keeps the band' do
    good = run_transform(net.(), now, input.())
    state = deep_copy(good['trmnl_state'])
    state['feedOk'][ics_url] = now_s - 7 * 3600   # named under the map, not loud
    wet = { 'alert_enabled' => 'true', 'alert_rain_threshold' => '10' }
    r = run_transform(net.(calendarsFail: true), now, with_prev.(state, prev_of.(good['data']), wet))
    assert((r['data']['service_alert'] || {})['kind'] != 'feed',
           'a feed down seven hours shouted over the weather')
    assert_equal(r['data']['calendars_down'], ['Alex Personal'], 'it should still be named under the map')
  end

  it 'a previous render from another day is wrong, not stale, and is not used' do
    # Every event in it is minutes from ITS day's midnight. Replayed against
    # today it would put yesterday's afternoon on this afternoon.
    good = run_transform(net.(), now, input.())
    prev = prev_of.(good['data'])
    prev['date_iso'] = '2019-01-01'
    r = run_transform(net.(calendarsFail: true), now, with_prev.(good['trmnl_state'], prev))
    assert_equal(event_items(r['data']), [], "yesterday's events were drawn as today's")
    assert_equal(r['data']['calendars_down'], ['Alex Personal'],
                 'the feed took its day off the board and did not say so')
  end

  it 'with nothing to replay from, the feed is named at once' do
    r = run_transform(net.(calendarsFail: true), now, input.())
    assert_equal(event_items(r['data']), [], 'events appeared from nowhere')
    assert(r['data']['calendars_down'].length == 1,
           "a feed with nothing behind it was not named: #{r['data']['calendars_down'].to_json}")
  end

  it 'only the feed that failed is replayed, so a healthy one is not doubled' do
    # The whole reason an event carries the mark. Read back whole, the
    # previous payload would put every calendar's day on the board a second
    # time beside the copy that was just fetched.
    a = 'https://example.com/a.ics'
    b = 'https://example.com/b.ics'
    ics_a = ics_with_events([{ start: '20260909T100000Z', end: '20260909T110000Z', summary: 'Alpha thing' }])
    ics_b = ics_with_events([{ start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Beta thing' }])
    both = lambda do |fail_b|
      [
        status(forecast_url, 503), status(i18n, 404), serve(a, ics_a),
        fail_b ? otherwise(500) : otherwise(ics_b)
      ]
    end
    cfg = JSON.generate(calendars: [
      { url: a, name: 'Alpha' }, { url: b, name: 'Beta' }
    ])
    good = run_transform(both.(false), now, base_input(now, use_demo_data: 'false', config_json: cfg))
    assert_equal(event_items(good['data']).map { it['title'] }.sort, ['Alpha thing', 'Beta thing'],
                 'the healthy board is not what this test assumes')

    i = base_input(now, use_demo_data: 'false', config_json: cfg)
    i['trmnl']['state'] = good['trmnl_state']
    i['trmnl']['previous_merge_variables'] = prev_of.(good['data'])
    r = run_transform(both.(true), now, i)
    assert_equal(event_items(r['data']).map { it['title'] }.sort, ['Alpha thing', 'Beta thing'],
                 'the failed feed was not replayed, or the healthy one was drawn twice')
    assert_equal(r['data']['calendars_down'], [], 'nothing was missing, so nothing should be announced')
  end

  it 'a previous render that is rubbish is dropped, not handed to the board' do
    # It is the last run's output, but it has been through storage and an
    # older build wrote a different shape.
    junk = { date_iso: '2026-09-09', legend: [{ key: 'p0', name: 'Alex' }, 'not a line'],
             events: [{ type: 'event', f: 0, title: 'Kept', owner: 'p0', start_min: 600, end_min: 660 },
                      { type: 'event', f: 0, owner: 'p0', start_min: 700 },        # no title
                      { type: 'event', f: 0, title: 'No owner', owner: 'nope', start_min: 800 },
                      { type: 'event', f: 0, title: 'No clock', owner: 'p0' },
                      'not an object', nil] }
    r = run_transform(net.(calendarsFail: true), now, with_prev.({}, junk))
    assert(falsy.(r['data']['board_notice']),
           "a malformed previous render took this one down: #{r['data']['board_notice']}")
    titles = event_items(r['data']).map { it['title'] }
    assert_equal(titles, ['Kept'], "the bad entries were not dropped one by one: #{titles.to_json}")
  end

  it "saved state stays under TRMNL's limit, for a household of twelve calendars" do
    # "There is a limit of 8192 bytes. Go over it and TRMNL ignores the
    # write, keeps the last good state" -- help.trmnl.com, saved-state.
    #
    # Nothing is truncated: the write is REJECTED and the device keeps what
    # it had, so every clock in saved state stops -- how long a feed has been
    # down, what the weather was, what a feed is called -- and the board goes
    # on rendering from a state it can never correct.
    #
    # This is a ratchet on the whole of it, not on any one thing in it. It is
    # the test that would have caught remembering the feeds' events in here:
    # a real four-calendar household measured 7715 bytes that way, inside the
    # margin of a limit nobody had read.
    big = +"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:A calendar with quite a long name\r\n"
    70.times do |e|
      big << "BEGIN:VEVENT\r\nUID:x#{e}@x\r\n" \
             "DTSTART:#{iso_today}T#{(7 + (e % 12)).to_s.rjust(2, '0')}0000Z\r\n" \
             "DTEND:#{iso_today}T#{(8 + (e % 12)).to_s.rjust(2, '0')}0000Z\r\n" \
             "SUMMARY:A meeting title of the length people actually use #{e}\r\n" \
             "LOCATION:Microsoft Teams Meeting, Room 214, Building B, Second Floor\r\nEND:VEVENT\r\n"
    end
    big << "END:VCALENDAR\r\n"
    urls = []
    12.times { |f| urls.push("https://a-fairly-long-host-name.example.com/calendars/user#{f}.ics") }
    impl = [status(forecast_url, 503), status(i18n, 404)].concat(urls.map { |u| serve(u, big) })
    r = run_transform(impl, now, base_input(now, use_demo_data: 'false',
                                                 config_json: JSON.generate(calendars: urls.map { |u| { url: u } })))
    size = JSON.generate(r['trmnl_state']).length
    assert(size <= 8192, "saved state came to #{size} bytes on twelve busy calendars; " \
                         "TRMNL's limit is 8192 and over it the write is ignored")
  end

  it 'several feeds down are named in the order the config names them' do
    # The feeds are fetched together and each recorded its own failure as it
    # happened, so the line was ordered by whichever gave up first. Two
    # renders of one unchanged board came back "Kalender Belgiek-Molenhoek,
    # Holidays in Belgium" and then the other way round: a warning that
    # reorders itself under the reader every quarter of an hour reads as
    # something new happening when nothing has.
    #
    # Asked of the SLOW one first, so a run that orders by arrival cannot
    # pass by luck: A answers last (a real 300ms later, through the mock
    # proxy), and must still be named first.
    a = 'https://example.com/a.ics'
    b = 'https://example.com/b.ics'
    slow = [status(forecast_url, 503), status(i18n, 404),
            status(a, 500, delay: 0.3), status(b, 500)]
    i = base_input(now,
                   use_demo_data: 'false',
                   config_json: JSON.generate(calendars: [
                     { url: a, name: 'Alpha' }, { url: b, name: 'Beta' }
                   ]))
    r = run_transform(slow, now, i)
    assert_equal(r['data']['calendars_down'], %w[Alpha Beta],
                 'the warning is ordered by whichever feed gave up first')
  end

  it 'state left over from feeds the config no longer names is dropped' do
    # Otherwise a URL removed from the config a year ago is still carried,
    # and still counted as down, on every render for ever.
    r = run_transform(net.(), now, input.({}, {
      calendarDown: { 'https://gone.example.com/old.ics' => now_s - 3 * 3600 },
      calendarNames: { 'https://gone.example.com/old.ics' => 'Old' }
    }))
    assert(r['trmnl_state']['calendarDown'].keys.length == 0 &&
           !r['trmnl_state']['calendarNames'].keys.include?('https://gone.example.com/old.ics'),
           "stale feed state survived: #{r['trmnl_state'].to_json}")
    assert(r['data']['calendars_down'].length == 0, 'a feed the config no longer has was announced as down')
  end

  it 'absent, string-wrapped and malformed state all render a board' do
    # Some runtimes hand the state back as the JSON string they stored; a
    # device upgrading from an older build has a shape this code has never
    # seen. Neither may cost the render.
    mocks = net.()
    cases = [
      undefined,
      nil,
      'not json at all',
      JSON.generate(weather: { hi: 18, lo: 9, condition: 'clear', icon: 'wi-day-sunny.svg', unit: 'C' }, weatherFetchedAt: now_s),
      [1, 2, 3],
      { calendarDown: 'nope', calendarNames: [1], weather: 'sunny', i18n: { lang: 5 } }
    ]
    cases.each do |st|
      r = run_transform(mocks, now, input.({}, st))
      assert(r['data'] && event_items(r['data']).length > 0, "state #{stringify.(st)} broke the render")
      assert(object.(r['trmnl_state']), "state #{stringify.(st)} produced no new state")
    end
    # the one well-formed string case is also USED, not just survived
    r = run_transform(mocks, now, input.({}, cases[3]))
    assert(r['data']['header_weather']['hi'] == 21 || r['data']['header_weather']['hi'] == 18,
           "a string-wrapped state was ignored: #{r['data']['header_weather'].to_json}")
  end

  it 'a render that falls back to the demo still returns its state' do
    # The fallback paths are exactly when the remembered weather and the
    # "down since" clocks matter, so they are the last place to drop them.
    r = run_transform(net.(calendarsFail: true), now,
                      input.({ 'config_json' => '' }, { calendarNames: { ics_url => 'Alex Personal' } }))
    assert(object.(r['trmnl_state']), 'the fallback path dropped the state')
  end
end
