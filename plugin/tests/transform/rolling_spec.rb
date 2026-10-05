# frozen_string_literal: true

# THE WINDOW STEPS THROUGH THE DAY, AND BORROWS TOMORROW WHEN TOMORROW HAS
# SOMETHING.
#
# A board on a wall is standing there to answer "what is coming", and at two
# in the afternoon a busy Tuesday was still spending its paper on a morning
# nobody could attend any more: the window used to move once, at four, and
# only on a quiet day. It steps now, at ten, one, four and seven, and opens
# two hours before the step so what just happened is still on the board. A
# quiet morning still borrows tomorrow from six, as it did.
#
# Tomorrow is drawn only where tomorrow has an event, a holiday or a state
# to show: a busy day squeezed to make room for an empty morning is paper
# spent on nothing. Where it is drawn, it runs to six the next evening, or
# eleven once the window itself has passed the afternoon.
#
# What must not go wrong is STABILITY. The panel refreshes every fifteen
# minutes, so nothing here is read from the clock continuously: the window
# changes only at the four step hours, on the hour, and once the board has
# tomorrow it keeps it. The case that pins that down is 'the board changes
# shape only at the steps, on the hour, and never gives tomorrow back'.

require_relative '../support/transform'

RSpec.describe 'rolling' do
  include Metro::Transform

  now = Time.iso8601('2026-09-09T09:00:00Z').to_i * 1000 # a Wednesday
  day = 24 * 60
  one_cal = JSON.generate(calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }])

  define_method(:net) do |ics|
    [
      serve(Metro::Transform::FORECAST, JSON.generate(
        daily: {
          temperature_2m_max: [18, 21], temperature_2m_min: [11, 13],
          precipitation_probability_max: [10, 80], weathercode: [0, 61],
          sunrise: ['2026-09-09T06:30', '2026-09-10T06:32'],
          sunset: ['2026-09-09T20:30', '2026-09-10T20:27']
        },
        hourly: { time: [], precipitation_probability: [] }
      )),
      otherwise(ics)
    ]
  end
  define_method(:input) do |fields = nil|
    base_input(now, {
      use_demo_data: 'false', lat_lon: '51.05,3.72',
      config_json: one_cal
    }.merge(fields || {}))
  end
  # events written as [YYYYMMDD, "HHMM", "HHMM", title]
  define_method(:feed) do |rows|
    ics_with_events(rows.map do |r|
      { start: "#{r[0]}T#{r[1]}00Z", end: "#{r[0]}T#{r[2]}00Z", summary: r[3] }
    end)
  end
  define_method(:board) { |rows, fields = nil| run_transform(net(feed(rows)), now, input(fields))['data'] }
  # The same board asked at another time of day (an ISO time on the 9th).
  define_method(:board_at) do |hhmm, rows|
    at = ms("2026-09-09T#{hhmm}:00Z")
    run_transform(net(feed(rows)), at, base_input(at,
                                                  use_demo_data: 'false', lat_lon: '51.05,3.72',
                                                  config_json: one_cal))['data']
  end

  # THE BOARD IS A DAY LONG. Twenty-four hours from where its window
  # opens, so a quiet morning's board runs from six to six and what
  # tomorrow shows is its small hours: the early flight, not the review.
  quiet_rows = [
    ['20260909', '1400', '1500', 'Dentist'],
    ['20260910', '0500', '0600', 'Early Flight'],
    ['20260910', '1900', '2000', 'Book Club']
  ]

  it 'a quiet day borrows tomorrow, and from ten so does a busy one' do
    quiet = board(quiet_rows)
    assert_equal(quiet['days'].length, 2, 'one event today should have borrowed tomorrow')
    # At nine, before the first step, a busy day is still the whole day.
    busy_rows = [
      ['20260909', '0900', '0915', 'Standup'],
      ['20260909', '1100', '1200', 'Workshop'],
      ['20260909', '1400', '1500', 'Dentist'],
      ['20260910', '0700', '0800', 'Sprint Review']
    ]
    morning = board(busy_rows)
    # Both days are always SENT now; what says a busy morning is not
    # stretched is that it carries no window, so the span stays the day's.
    assert_equal(morning['days'].length, 2, 'both days should be sent, whatever gets drawn')
    assert_equal(opened(morning), 6 * 60, 'a morning board opens at six, before the first step')
    # At eleven the eleven o'clock step has passed: the window opens at ten
    # (an hour back), and LEAD_MIN of board in front of the Workshop at
    # eleven pulls it back to nine; the Standup at nine is over and off the
    # board. The lead does not cost the far end: the 24 hours are counted
    # from where the day starts, so the review at nine tomorrow is still
    # inside it.
    busy = board_at('11:00', busy_rows)
    assert_equal(busy['days'].length, 2, 'both days should be sent, whatever gets drawn')
    assert_equal(opened(busy), 9 * 60, 'the board should open two hours before the first thing it draws')
    assert_equal(busy['events'].map { it['title'] }.sort,
                 ['Dentist', 'Sprint Review', 'Standup', 'Workshop'], 'the rolled board drew the wrong events')
    # ...but a busy day with nothing tomorrow keeps its paper for itself:
    # the window still steps, and it closes at midnight.
    alone = board_at('11:00', busy_rows[0...3])
    # A day row per day GATHERED, even when that day turns out to be empty:
    # the row is what names a day the span reaches, and an empty tomorrow
    # simply gives `framed()` nothing to reach for.
    assert_equal(alone['days'].length, 2, 'both days should be sent, whatever gets drawn')
    assert(alone['events'].none? { it['start_min'] >= day }, 'an empty tomorrow brought events with it')
    assert_equal(opened(alone), 9 * 60, 'a day with an empty tomorrow should still step')
    assert_equal(alone['day_end_min'], 2 * day, 'the payload should carry the whole run it gathered')
  end

  it 'three lines at one dinner is one event, not three' do
    # The count is the count the BOARD has, after every rule and every
    # merge: one thing that three calendars describe is one stop on the map,
    # so a household whose evening is shared still reads as a quiet day.
    shared = JSON.generate(
      lines: [{ name: 'Ada' }, { name: 'Bo' }, { name: 'Cy' }],
      calendars: [{ url: 'https://example.com/a.ics',
                    rules: [{ match: { type: 'contains', value: 'Dinner' },
                              line: %w[Ada Bo Cy] }] }]
    )
    r = board([
                ['20260909', '1800', '1900', 'Family Dinner'],
                ['20260910', '0500', '0600', 'Early Flight']
              ], { config_json: shared })
    assert_equal(r['days'].length, 2, 'a shared dinner was counted once per line')
  end

  it 'an all-day state is not an event on the scale of hours' do
    # It has no hour, so it takes no room a quiet day is short of. Counted
    # as content, a line on half term would have stopped the stretch from
    # happening on exactly the emptiest day of the year.
    ics = +"BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"
    ics << "BEGIN:VEVENT\r\nUID:h\r\nDTSTART;VALUE=DATE:20260909\r\nDTEND;VALUE=DATE:20260912\r\n" \
           "SUMMARY:Half Term\r\nEND:VEVENT\r\n"
    ics << "BEGIN:VEVENT\r\nUID:t\r\nDTSTART:20260910T090000Z\r\nDTEND:20260910T100000Z\r\n" \
           "SUMMARY:Sprint Review\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
    r = run_transform(net(ics), now, input)['data']
    assert_equal(r['days'].length, 2, 'an all-day entry was counted as an event')
    assert_equal(r['all_day'].map { it['title'] }, ['Half Term'],
                 "the state itself should still be declared, once, at its line's head")
  end

  it "a quiet morning's window is the 24 hours, on the hour, from six" do
    r = board(quiet_rows)
    # The payload carries the whole run from this day's own midnight; where
    # the board OPENS inside it is `day.js opened()`, and where it closes is
    # `framed()`, against a view there is none of here.
    assert_equal([r['day_start_min'], r['day_end_min']], [0, 2 * day],
                 'the payload should carry both days, from midnight')
    assert_equal(opened(r), 6 * 60, 'a quiet morning should open at six')
    # Minute zero is still the shown day's midnight, which is what lets
    # everything downstream go on reading one number line.
    assert_equal(r['days'].map { it['start_min'] }, [0, day], 'the run is not rebased onto the shown day')
    assert(!r['days'][0]['date_label'].to_s.empty? && !r['days'][1]['date_label'].to_s.empty? &&
           r['days'][0]['date_label'] != r['days'][1]['date_label'],
           "both days have to name themselves: #{r['days'].map { it['date_label'] }.to_json}")
    assert(!r['days'][1]['weekday_short'].to_s.empty?,
           'a day with no short weekday has nothing to write in a narrow strip')
  end

  it "tomorrow morning lands at tomorrow's time, and tomorrow night is not drawn" do
    r = board(quiet_rows)
    by = {}
    r['events'].each { by[it['title']] = it }
    assert_equal(by['Dentist']['start_min'], 14 * 60, "today's event moved")
    assert(by['Early Flight'], "tomorrow's 05:00 is missing from a payload that carries both days")
    assert_equal(by['Early Flight']['start_min'], day + (5 * 60),
                 "tomorrow's 05:00 has to be 05:00 of the SECOND day, not of the first")
    # Everything gathered is SENT, whether or not a given panel has room to
    # draw it: what a view cannot hold, `framed()` cuts and counts.
    assert(by['Book Club'], 'a 19:00 event was withheld rather than sent and counted')
  end

  it 'the window opens where the step puts it, and counts what fell off the front' do
    # THE WINDOW NO LONGER REACHES BACK FOR AN EVENT THAT IS OVER.
    #
    # It used to: every event still running at the lookback pulled the
    # opening back to an hour before itself, so that a window could not cut
    # an event it had decided to draw. That undid the step it was supposed to
    # work with -- an all-day school run held the four o'clock window open in
    # the morning -- so the opening is the step's now, and a 04:30 shift that
    # ended before it is counted at the leading edge rather than fetched
    # back. What straddles the opening is drawn from the edge, clipped.
    early = board([
                    ['20260909', '0430', '0530', 'Early Shift'],
                    ['20260910', '0200', '0300', 'Night Shift']
                  ])
    assert_equal(opened(early), 6 * 60,
                 'a quiet morning opens at six, whatever happened before it')
    assert(early['events'].none? { it['title'] == 'Early Shift' && it['start_min'] >= opened(early) },
           'an event that ended before the board opened was placed inside it')
    # ...and once a step has passed, an event that ended before its lookback
    # is the morning it rolled off.
    gone = board_at('11:00', [
                      ['20260909', '0430', '0530', 'Early Shift'],
                      ['20260910', '0700', '0800', 'Sprint Review']
                    ])
    assert_equal(opened(gone), 10 * 60,
                 'an event already over pulled the morning back onto the board')
    # ...and so is one that ended in the hour before the opening: the
    # lookback is an hour, and a shift over by half past nine is not on an
    # eleven o'clock board.
    kept = board_at('11:00', [
                      ['20260909', '0830', '0930', 'Late Shift'],
                      ['20260910', '0600', '0700', 'Sprint Review']
                    ])
    assert_equal(opened(kept), 10 * 60,
                 'the board should open at the step, an hour back')
    # ...and the borrowed morning's event is sent at its own time, for a view
    # with the room to reach it.
    late = board([
                   ['20260909', '1400', '1500', 'Dentist'],
                   ['20260910', '0300', '0430', 'Handover']
                 ])
    assert_equal(late['day_end_min'], 2 * day, 'the payload should carry the whole run it gathered')
    assert(late['events'].any? { it['title'] == 'Handover' }, "the borrowed morning's event was not drawn")
  end

  # THE OPT-OUT IS GONE, AND SO IS THE DAY PICKER.
  #
  # Two cases lived here. One turned the stretch off ("Quiet Days: always one
  # day") and checked the board came out exactly as it used to; the other set
  # the board to tomorrow and checked the stretch followed it into the day
  # after.
  #
  # The opt-out existed because a board that changes shape on its own needs a
  # way to be told not to -- and what made that alarming was the shape
  # changing WHILE somebody read it, which the four o'clock boundary fixed
  # (see 'a day has two shapes at most, and it changes at four'). A board that
  # quietly shows more of what is coming needs no opt-out. The day picker went
  # with it: a board about tomorrow cannot say what time it is.
  #
  # What is left of both is that a board somebody already saved with either
  # setting still draws a board, which the case below checks.

  it 'a setting the board no longer reads still draws a board' do
    at = ms('2026-09-09T21:00:00Z')
    rows = [['20260910', '1400', '1500', 'Dentist'], ['20260911', '0900', '1000', 'Sprint Review']]
    run = lambda do |fields|
      run_transform(net(feed(rows)), at, base_input(at,
                                                    { use_demo_data: 'false', lat_lon: '51.05,3.72',
                                                      config_json: one_cal }.merge(fields)))['data']
    end
    plain = run.({})
    [{ show_day: 'auto' }, { show_day: 'tomorrow' }, { rolling_view: 'one' },
     { show_day: 'auto', switch_hour: '18', rolling_view: 'one' }].each do |stale|
      r = run.(stale)
      assert_equal(r['events'].map { it['title'] }.sort, plain['events'].map { it['title'] }.sort,
                   "#{stale.to_json} drew a different board")
      assert_equal(r['title_word'], plain['title_word'], "#{stale.to_json} named a different day")
      assert_equal(r['days'].length, plain['days'].length, "#{stale.to_json} drew a different run of days")
    end
  end

  it 'a day the board is not drawing leaves the board as it found it' do
    # The run has to be fetched before the count is known, so a busy board
    # has read a day it will not draw. Nothing about that day may reach the
    # drawing: not an event, not a line of its own, not a line's weight.
    cfg = JSON.generate(
      calendars: [
        { url: 'https://example.com/a.ics', name: 'Ada' },
        { url: 'https://example.com/b.ics', name: 'Bo' }
      ]
    )
    net_two = [
      serve(Metro::Transform::FORECAST, '{}'),
      # Bo exists on the day after tomorrow and on no other day.
      serve('https://example.com/b.ics', feed([['20260911', '1000', '1100', 'Bo Only']])),
      # Ada has today; nothing tomorrow is early enough to borrow.
      otherwise(feed([
                       ['20260909', '1400', '1500', 'Dentist'],
                       ['20260910', '0900', '0915', 'Standup'],
                       ['20260910', '1100', '1200', 'Workshop'],
                       ['20260910', '1400', '1500', 'Dentist']
                     ]))
    ]
    r = run_transform(net_two, now, base_input(now,
                                               use_demo_data: 'false', config_json: cfg, show_day: 'tomorrow'))['data']
    assert_equal(r['legend'].map { it['name'] }, ['Ada'],
                 'a line that exists only on a day the board is not drawing got a rail: ' \
                 "#{r['legend'].map { it['name'] }.to_json}")
  end

  it 'the board changes shape only at the steps, on the hour, and never gives tomorrow back' do
    # THE STABILITY CASE. An e-ink panel refreshes every fifteen minutes,
    # and a window keyed to the clock would slide under whoever is reading
    # it four times an hour. The window steps instead, on the hour from
    # ten, and between two steps every quarter of an hour lays out the same
    # board. (A step whose opening lands where the last one did is not a
    # change of shape, so not every hour flips.)
    rows = [
      ['20260909', '0900', '0915', 'Standup'],
      ['20260909', '1100', '1200', 'Workshop'],
      ['20260909', '1400', '1500', 'Dentist'],
      ['20260909', '1900', '2000', 'Book Club'],
      ['20260910', '0900', '1000', 'Sprint Review']
    ]
    shape_at = lambda do |hh|
      at = ms("2026-09-09T#{hh[0...2]}:#{hh[2..]}:00Z")
      r = run_transform(net(feed(rows)), at, base_input(at,
                                                        use_demo_data: 'false', lat_lon: '51.05,3.72',
                                                        config_json: one_cal))['data']
      # The shape a reader sees is where the board opens: the payload itself
      # is the same all day, which is the point of moving the decision.
      from = opened(r)
      { 'start' => from, 'shape' => "#{r['days'].length} day(s) from #{from}" }
    end
    seen = []
    (0...(24 * 60)).step(15) do |min|
      hh = (min / 60).to_s.rjust(2, '0') + (min % 60).to_s.rjust(2, '0')
      seen.push({ 'at' => hh }.merge(shape_at.(hh)))
    end
    flips = seen.each_with_index.select { |s, i| i.positive? && s['shape'] != seen[i - 1]['shape'] }.map(&:first)
    # Before the morning opening the window opens no later than the clock,
    # in three-hour steps, so the time is on the board at night too.
    assert_equal(flips.map { it['at'] }, %w[0300 0600 1000 1100 1300 1600 1700 1800 2100],
                 "the board changed shape at #{flips.map { "#{it['at']} -> #{it['shape']}" }.join(' | ')}")
    # Each step opens the window an hour before itself, or LEAD_MIN before
    # the first thing at or after that, whichever is earlier: the Standup at
    # nine holds ten's window at seven, the Workshop at eleven holds eleven's
    # and twelve's at nine, the Dentist at two holds one's, two's and three's
    # at twelve, the Book Club at seven holds six's, seven's and eight's at
    # three, four and five, and nine's, ten's and eleven's at five, and at
    # nine in the evening nothing of today is left and the window opens at
    # eight.
    assert_equal(flips.map { it['start'] },
                 [3 * 60, 6 * 60, 7 * 60, 9 * 60, 12 * 60, 15 * 60, 16 * 60, 17 * 60, 20 * 60],
                 'a step opened the window somewhere other than LEAD_MIN before what it keeps')
    # ...and it only ever moves forwards. The opening is a step function of
    # the clock, so it cannot walk back into a morning it has shed.
    (1...seen.length).each do |i|
      assert(seen[i]['start'] >= seen[i - 1]['start'],
             "the board opened earlier at #{seen[i]['at']} than at #{seen[i - 1]['at']}")
    end
  end

  it 'the evening board has tomorrow and tonight, and the morning has rolled off' do
    rows = [
      ['20260909', '0900', '1000', 'Book Club'],
      ['20260909', '1400', '1500', 'Reactor Core Check'],
      ['20260909', '1700', '1800', 'Skate Park'],
      ['20260909', '1900', '2000', "Moe's Tavern"],
      ['20260909', '1930', '2030', 'Family Dinner'],
      ['20260910', '1000', '1100', 'Sunday Swim']
    ]
    at = lambda do |hh|
      at_ms = ms("2026-09-09T#{hh}:00Z")
      run_transform(net(feed(rows)), at_ms, base_input(at_ms,
                                                       use_demo_data: 'false', lat_lon: '51.05,3.72',
                                                       config_json: one_cal))['data']
    end
    # Half past five: the five o'clock step has passed, so the window opens
    # at three -- LEAD_MIN before the Skate Park at five, the first thing at
    # or after four -- tomorrow is on, and the morning has rolled off.
    evening = at.('17:30')
    assert_equal(opened(evening), 15 * 60, 'the board should open LEAD_MIN before the event kept')
    titles = evening['events'].map { it['title'] }
    assert(titles.include?('Sunday Swim'), "tomorrow never arrived: #{titles.to_json}")
    assert(titles.include?('Family Dinner'), 'tonight was thrown away to get there')
    # The morning is still in the payload, but it is before the window, so
    # it is not drawn.
    club = evening['events'].find { it['title'] == 'Book Club' }
    assert(club && club['end_min'] <= opened(evening),
           'the morning is still inside the window on an evening board')
  end

  it 'a rolling board carries no sunrise and no sunset' do
    # It used to carry three: today's sunrise, today's sunset, and the
    # borrowed day's sunrise, each shifted onto the window's own number
    # line. That was the most intricate piece of the sky code and it drew
    # the two marks nobody was reading. The whole branch is gone, so what
    # is worth asserting is that it stays gone: a payload with anything but
    # a weather marker in `weather` is the old path back.
    r = board(quiet_rows)
    assert_equal(r['weather'].reject { it['type'] == 'weather' }, [],
                 "a rolling board put sky markers back on: #{r['weather'].to_json}")
  end
end
