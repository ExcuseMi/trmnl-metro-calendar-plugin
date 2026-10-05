# frozen_string_literal: true

# A HOLIDAY IS A PROPERTY OF THE DAY, NOT A STATE OF A LINE.
#
# People subscribe to "Holidays in Belgium", to Apple's equivalent, to a
# school's own term-dates feed. Those feeds are whole-day entries, often
# recurring yearly, often covering a range of days, and they belong to
# everybody in the house rather than to one person.
#
# The plugin had no concept of them. They arrived as ordinary all-day
# events, were routed by whichever rule happened to match, and landed at
# ONE line's head -- or, where the calendar carried a name and nothing
# routed them, put a whole extra LINE on the board called "Holidays in
# Belgium", with both ends drawn as open chevrons, as if the country were
# a member of the family who was away.
#
# `holiday: true`, on a calendar or on a rule, takes the event off the
# line model altogether: it reaches the payload as `data.holidays`, which
# the header states beside the date, and it resolves no owner at all.
#
# These cases pin down the four things that were wrong: that a holiday
# makes no line, that a yearly recurrence is seen at all, that a range
# says which day of it the board is drawing, and that the day an entry
# belongs to survives the trip (it did not: every all-day entry was read
# as day 0, so tomorrow's holiday was announced today and a board set to
# tomorrow threw all of them away).

require_relative '../support/transform'

RSpec.describe 'holidays' do
  include Metro::Transform

  # The pure builders, for the mocks built at describe level.
  h = Object.new.extend(Metro::Transform)
  i18n_url = Metro::Transform::I18N
  answer = h.method(:serve)

  now = Time.iso8601('2026-12-25T09:00:00Z').to_i * 1000 # Christmas Day, a Friday
  cfg_with = ->(json) { { config_json: JSON.generate(json) } }

  # A whole-day VEVENT, written the way a real holiday feed writes one:
  # DTSTART;VALUE=DATE with an EXCLUSIVE DTEND. ics_with_events() always
  # emits a plain DTSTART, so these are built here instead.
  all_day_ics = lambda do |entries, cal_name = nil|
    s = +"BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"
    s << "X-WR-CALNAME:#{cal_name}\r\n" unless cal_name.to_s.empty?
    entries.each_with_index do |e, i|
      s << "BEGIN:VEVENT\r\nUID:hol#{i}@example\r\nDTSTAMP:20260101T000000Z\r\n"
      s << "DTSTART;VALUE=DATE:#{e[:start]}\r\n"
      s << "DTEND;VALUE=DATE:#{e[:end]}\r\n" unless e[:end].to_s.empty?
      s << "RRULE:#{e[:rrule]}\r\n" unless e[:rrule].to_s.empty?
      s << "SUMMARY:#{e[:summary]}\r\nEND:VEVENT\r\n"
    end
    s << "END:VCALENDAR\r\n"
  end

  # The holiday feed answers on /hol; everything else answers empty. Served
  # to every URL alike, the holiday ICS also came back as Ada's own
  # calendar, and the case passed or failed on that instead.
  serve = ->(text) { [answer.(%r{/ada\.ics}, h.ics_with_events([])), h.otherwise(text)] }

  # The everyday setup: a line per person, plus a subscribed holiday feed
  # that names nobody.
  config = lambda do |over = nil|
    {
      lines: [{ name: 'Ada' }, { name: 'Bo' }],
      calendars: [
        { url: 'https://example.com/ada.ics', name: 'Ada',
          rules: [{ match: { type: 'any' }, line: 'Ada' }] },
        { url: 'https://example.com/hol.ics', holiday: true }
      ]
    }.merge(over || {})
  end

  # ---------------------------------------------------------------- whose

  it 'a holiday belongs to the day, not to anybody' do
    r = run_transform(serve.(all_day_ics.(
      [{ start: '20261225', end: '20261226', summary: 'Christmas Day' }], 'Holidays in Belgium'
    )), now, base_input(now, cfg_with.(config.())))
    assert_equal((r['data']['holidays'] || []).map { it['title'] }, ['Christmas Day'],
                 'the day is not named')
    assert_equal(r['data']['all_day'], [],
                 "a holiday was declared at a line's head: it is nobody's state")
  end

  # ---------------------------------------------------------- whose, exactly
  #
  # `holiday` does not mean "goes in the header". It means this is a STATE
  # rather than an appointment -- the distinction E12 drew for all-day
  # events -- and WHERE it is drawn falls out of whether anybody owns it.
  #
  # Both kinds arrive through the same subscription. Christmas Day is
  # nobody's and belongs to the day. Half term is precisely the children's
  # and precisely not the parent's, who still goes to work, and a line's
  # head row is exactly what says so. Forcing both into the header throws
  # away the one fact that makes the second one useful.

  it 'a holiday a rule gives to somebody goes to their head, not the header' do
    r = run_transform(serve.(all_day_ics.([
      { start: '20261225', end: '20261226', summary: 'Half Term' }
    ])), now, base_input(now, cfg_with.(config.({
      calendars: [
        { url: 'https://example.com/ada.ics', name: 'Ada',
          rules: [{ match: { type: 'any' }, line: 'Ada' }] },
        { url: 'https://example.com/hol.ics', holiday: true,
          rules: [{ match: { type: 'contains', value: 'Half Term' }, line: 'Bo' }] }
      ]
    }))))
    assert_equal(r['data']['holidays'], [], "a holiday somebody owns is not the day's")
    assert_equal(r['data']['all_day'].map { it['title'] }, ['Half Term'], 'it should be at a head')
    bo = r['data']['legend'].find { it['name'] == 'Bo' }
    assert(bo, 'Bo got no line, so the holiday had nowhere to be declared')
    assert_equal(r['data']['all_day'][0]['owners'], [bo['key']], 'declared against the wrong line')
    assert_equal(event_items(r['data']), [], 'and still nothing on the axis')
  end

  it 'two lines sharing one are one origin, named once' do
    r = run_transform(serve.(all_day_ics.([
      { start: '20261225', end: '20261226', summary: 'Half Term' }
    ])), now, base_input(now, cfg_with.(config.({
      lines: [{ name: 'Ada' }, { name: 'Bo' }, { name: 'Cy' }],
      calendars: [
        { url: 'https://example.com/ada.ics', name: 'Ada',
          rules: [{ match: { type: 'any' }, line: 'Ada' }] },
        { url: 'https://example.com/hol.ics', holiday: true,
          rules: [{ match: { type: 'contains', value: 'Half Term' },
                    line: %w[Bo Cy] }] }
      ]
    }))))
    assert_equal(r['data']['all_day'].length, 1, 'two children are not on two holidays')
    assert_equal(r['data']['all_day'][0]['owners'].length, 2, 'both should own it')
    assert_equal(r['data']['holidays'], [], "and it is not also the day's")
  end

  it 'the fallback chain is never consulted for a holiday' do
    # This is the whole failure being fixed. A subscribed feed that no rule
    # routes has not told us whose day it changes -- it has told us it is
    # nobody's. Letting it fall back to the calendar's name invents a line
    # called "Holidays in Belgium"; letting it fall back to `lines[0]`
    # declares the entire country's Christmas to be Ada's.
    r = run_transform(serve.(all_day_ics.([
      { start: '20261225', end: '20261226', summary: 'Christmas Day' }
    ])), now, base_input(now, cfg_with.(config.({
      calendars: [
        { url: 'https://example.com/ada.ics', name: 'Ada',
          rules: [{ match: { type: 'any' }, line: 'Ada' }] },
        { url: 'https://example.com/hol.ics', name: 'Holidays in Belgium', holiday: true }
      ]
    }))))
    assert_equal(r['data']['holidays'].map { it['title'] }, ['Christmas Day'], "it is the day's")
    assert_equal(r['data']['all_day'], [], "and nobody's")
    assert(!r['data']['legend'].any? { /Holiday/i.match?(it['name'].to_s) },
           "the feed's own name became a line: #{r['data']['legend'].map { it['name'] }.to_json}")
  end

  # ------------------------------------------------- the plain list of links

  it 'a plain list can mark a holiday feed, with no JSON at all' do
    # The low-friction path is "paste links, get a line each", which is
    # exactly wrong for a subscribed holiday calendar. Telling that user to
    # go and write JSON defeats the point of the list existing.
    r = run_transform(serve.(all_day_ics.([
      { start: '20261225', end: '20261226', summary: 'Christmas Day' }
    ], 'Holidays in Belgium')), now, base_input(now, {
      config_json: "https://example.com/ada.ics\n" \
                   "https://example.com/hol.ics holiday\n"
    }))
    assert_equal(r['data']['holidays'].map { it['title'] }, ['Christmas Day'],
                 'the marked feed did not reach the day')
    assert(!r['data']['legend'].any? { /Holiday/i.match?(it['name'].to_s) },
           "it still became a line: #{r['data']['legend'].map { it['name'] }.to_json}")
  end

  it 'the marker is the whole word at the end, not a substring of a link' do
    # A feed whose URL merely contains the word is a feed, not a marker.
    r = run_transform(serve.(all_day_ics.([
      { start: '20261225', end: '20261226', summary: 'Christmas Day' }
    ], 'Holidays in Belgium')), now, base_input(now, {
      config_json: "https://example.com/hol.ics?type=holiday\n"
    }))
    assert_equal(r['data']['holidays'], [], 'a url containing the word was read as a marker')
  end

  it 'a holiday feed puts no line on the board' do
    # The ghost line. A named calendar's name becomes a LINE for anything
    # no rule routes, so a subscribed "Holidays in Belgium" drew a rail of
    # its own, named after a country, on 11 days a year and no others.
    r = run_transform(serve.(all_day_ics.(
      [{ start: '20261225', end: '20261226', summary: 'Christmas Day' }], 'Holidays in Belgium'
    )), now, base_input(now, cfg_with.(config.({
      calendars: [
        { url: 'https://example.com/ada.ics', name: 'Ada',
          rules: [{ match: { type: 'any' }, line: 'Ada' }] },
        # named, which is exactly what makes it leak a line without this
        { url: 'https://example.com/hol.ics', name: 'Holidays in Belgium', holiday: true }
      ]
    }))))
    names = (r['data']['legend'] || []).map { it['name'] }
    assert(!names.include?('Holidays in Belgium'),
           "the holiday feed became a line: #{names.join(', ')}")
  end

  it 'without holiday:true it still lands on a line, which is the shape being fixed' do
    # Stated as a test because the two shapes have to stay distinguishable:
    # one person's leave IS a state of their line and belongs at its head
    # (rule 54), and nothing here may quietly turn every all-day entry into
    # a property of the day.
    r = run_transform(serve.(all_day_ics.(
      [{ start: '20261225', end: '20261226', summary: 'Ada on leave' }]
    )), now, base_input(now, cfg_with.({
      lines: [{ name: 'Ada' }],
      calendars: [{ url: 'https://example.com/a.ics', name: 'Ada' }]
    })))
    assert_equal((r['data']['all_day'] || []).map { it['title'] }, ['Ada on leave'],
                 "an ordinary all-day event stopped being declared at its line's head")
    assert_equal(r['data']['holidays'], [], "and it is not the day's")
  end

  it 'a rule can say it per event, for a feed that carries both kinds' do
    r = run_transform(serve.(all_day_ics.([
      { start: '20261225', end: '20261226', summary: 'Christmas Day' },
      { start: '20261225', end: '20261226', summary: 'Ada on leave' }
    ])), now, base_input(now, cfg_with.({
      lines: [{ name: 'Ada' }],
      calendars: [{
        url: 'https://example.com/a.ics', name: 'Ada',
        rules: [{ match: { type: 'contains', value: 'Christmas' }, holiday: true }]
      }]
    })))
    assert_equal((r['data']['holidays'] || []).map { it['title'] }, ['Christmas Day'])
    assert_equal((r['data']['all_day'] || []).map { it['title'] }, ['Ada on leave'],
                 'the rule took the wrong entry, or took both')
  end

  it 'a holiday written as a timed block is still a holiday' do
    # Feeds that cannot emit VALUE=DATE write midnight to midnight
    # instead. Which shape the exporter picked is not a fact about the day.
    r = run_transform(serve.(ics_with_events([
      { start: '20261225T000000', end: '20261225T235900', summary: 'Christmas Day' }
    ])), now, base_input(now, cfg_with.({
      lines: [{ name: 'Ada' }],
      calendars: [{ url: 'https://example.com/h.ics', holiday: true }]
    })))
    assert_equal((r['data']['holidays'] || []).map { it['title'] }, ['Christmas Day'])
    assert_equal(event_items(r['data']).length, 0,
                 'a holiday reached the hour scale, which is the one place it cannot be')
  end

  it 'the same holiday from two feeds is named once' do
    # Two people in a house subscribing to the same national calendar is
    # the ordinary case, and the header has no room to say it twice.
    ics = all_day_ics.([{ start: '20261225', end: '20261226', summary: 'Christmas Day' }])
    r = run_transform(serve.(ics), now, base_input(now, cfg_with.({
      lines: [{ name: 'Ada' }],
      calendars: [
        { url: 'https://example.com/h1.ics', holiday: true },
        { url: 'https://example.com/h2.ics', holiday: true }
      ]
    })))
    assert_equal((r['data']['holidays'] || []).map { it['title'] }, ['Christmas Day'])
  end

  it 'a day full of observances is still one day' do
    # The header is a single row that already carries a date and a
    # forecast. Two names on it came out as "Christmas D" and "School
    # Holid", each cut mid word: naming the day is the header's job and
    # listing it is not, so the first feed listed wins.
    r = run_transform(serve.(all_day_ics.([
      { start: '20261225', end: '20261226', summary: 'Christmas Day' },
      { start: '20261225', end: '20261226', summary: 'School Holiday' },
      { start: '20261225', end: '20261226', summary: 'Feast of the Nativity' },
      { start: '20261225', end: '20261226', summary: 'Quarter Day' }
    ])), now, base_input(now, cfg_with.(config.())))
    assert_equal((r['data']['holidays'] || []).map { it['title'] }, ['Christmas Day'])
  end

  # ------------------------------------------------------------ recurrence

  it 'a yearly recurrence is seen on its anniversary' do
    # Apple's holiday calendars and most school-term feeds write the day
    # once with FREQ=YEARLY. Only FREQ=WEEKLY was ever evaluated, so those
    # feeds drew nothing at all in every year after the one they were
    # written in, and nothing said why.
    at = ms('2027-01-01T09:00:00Z')
    r = run_transform(serve.(all_day_ics.(
      [{ start: '20200101', end: '20200102', rrule: 'FREQ=YEARLY', summary: "New Year's Day" }]
    )), at, base_input(at, cfg_with.(config.())))
    assert_equal((r['data']['holidays'] || []).map { it['title'] }, ["New Year's Day"],
                 'a yearly holiday seven years after its DTSTART was dropped')
  end

  it 'a yearly recurrence is not seen on every other day of the year' do
    r = run_transform(serve.(all_day_ics.(
      [{ start: '20200101', end: '20200102', rrule: 'FREQ=YEARLY', summary: "New Year's Day" }]
    )), now, base_input(now, cfg_with.(config.())))
    assert_equal(r['data']['holidays'], [], "Christmas Day is not New Year's Day")
  end

  it 'an ordinal BYDAY finds the moving date, not the anniversary' do
    # "The fourth Thursday in November" moves every year: the anniversary of
    # DTSTART is the WRONG answer, so the rule itself is read.
    rule = [{ start: '20261126', end: '20261127', rrule: 'FREQ=YEARLY;BYDAY=4TH;BYMONTH=11', summary: 'Thanksgiving' }]
    fourth = ms('2027-11-25T09:00:00Z') # 2027's fourth Thursday
    r = run_transform(serve.(all_day_ics.(rule)), fourth, base_input(fourth, cfg_with.(config.())))
    assert_equal(r['data']['holidays'].map { it['title'] }, ['Thanksgiving'], 'the fourth Thursday of 2027 was missed')
    anniversary = ms('2027-11-26T09:00:00Z') # a Friday
    r2 = run_transform(serve.(all_day_ics.(rule)), anniversary, base_input(anniversary, cfg_with.(config.())))
    assert(!r2['data']['holidays'].any? { it['title'] == 'Thanksgiving' },
           'the anniversary of the start date was taken for the holiday')
  end

  it 'a dated entry per year, which is what Google writes, needs no recurrence at all' do
    r = run_transform(serve.(all_day_ics.([
      { start: '20251225', end: '20251226', summary: 'Christmas Day' },
      { start: '20261225', end: '20261226', summary: 'Christmas Day' },
      { start: '20271225', end: '20271226', summary: 'Christmas Day' }
    ])), now, base_input(now, cfg_with.(config.())))
    assert_equal((r['data']['holidays'] || []).map { it['title'] }, ['Christmas Day'],
                 'the one whose date is today should be the one that shows')
  end

  # ----------------------------------------------------------------- ranges

  it 'a range says which day of it the board is drawing' do
    # Spring Break runs a week and the board draws one day of it. "Day 3
    # of 5" is the only thing distinguishing the Monday from the Thursday,
    # and it is the fact a household actually wants: when does this end.
    feed = all_day_ics.([{ start: '20270405', end: '20270410', summary: 'Spring Break' }])
    at = ->(iso) { ms(iso) }
    on = lambda do |iso|
      r = run_transform(serve.(feed), at.(iso), base_input(at.(iso), cfg_with.(config.())))
      (r['data']['holidays'] || [])[0] || nil
    end
    first = on.('2027-04-05T09:00:00Z')
    assert_equal([first['day_index'], first['day_span'], first['day_label']], [0, 5, 'Day 1 of 5'],
                 'the first day of the range')
    middle = on.('2027-04-07T09:00:00Z')
    assert_equal([middle['day_index'], middle['day_span'], middle['day_label']], [2, 5, 'Day 3 of 5'],
                 'a day INSIDE the range has to read differently from its first day')
    last = on.('2027-04-09T09:00:00Z')
    assert_equal([last['day_index'], last['day_span'], last['day_label']], [4, 5, 'Day 5 of 5'])
  end

  it 'the day after a range ends says nothing' do
    # DTEND is EXCLUSIVE: a break ending on the 10th is over on the 10th.
    at = ms('2027-04-10T09:00:00Z')
    r = run_transform(serve.(all_day_ics.(
      [{ start: '20270405', end: '20270410', summary: 'Spring Break' }]
    )), at, base_input(at, cfg_with.(config.())))
    assert_equal(r['data']['holidays'], [])
  end

  it 'a single day carries no ordinal to state' do
    r = run_transform(serve.(all_day_ics.(
      [{ start: '20261225', end: '20261226', summary: 'Christmas Day' }]
    )), now, base_input(now, cfg_with.(config.())))
    assert_equal(r['data']['holidays'][0]['day_span'], 1)
    # (The key has to be there and null: a missing one was not equal to null.)
    assert(r['data']['holidays'][0].key?('day_label'),
           '"Day 1 of 1" is a sentence about nothing, and header width is board: expected null, got undefined')
    assert_equal(r['data']['holidays'][0]['day_label'], nil,
                 '"Day 1 of 1" is a sentence about nothing, and header width is board')
  end

  it 'the ordinal is translated, not assembled on the client' do
    # Composed here the way the service alert's text is: a braced
    # placeholder inside a Liquid output tag ends the tag and takes the
    # whole template down with it.
    at = ms('2027-04-07T09:00:00Z')
    feed = all_day_ics.([{ start: '20270405', end: '20270410', summary: 'Spring Break' }])
    i18n = JSON.generate(holiday_day: 'Dag {n} van {m}')
    fetch_impl = [answer.(i18n_url, i18n), otherwise(feed)]
    input = base_input(at, cfg_with.(config.()))
    input['trmnl']['user']['locale'] = 'nl-BE'
    r = run_transform(fetch_impl, at, input)
    assert_equal(r['data']['holidays'][0]['day_label'], 'Dag 3 van 5')
  end

  # -------------------------------------------------------------- which day

  it "a holiday tomorrow is tomorrow's, and says so" do
    # Every all-day entry used to arrive here having lost the day it belongs
    # to, so it was read as day 0 whatever date it carried: Boxing Day was
    # announced on Christmas Day's board.
    #
    # It travels now, because a rolling board draws tomorrow's appointments
    # and used to say nothing about tomorrow being Boxing Day -- it drew the
    # meetings and left out the fact that explains them. What must still be
    # true is that it is not attributed to the day the board opens on: it
    # carries the day it is about, and the badge for that day states it.
    r = run_transform(serve.(all_day_ics.(
      [{ start: '20261226', end: '20261227', summary: 'Boxing Day' }]
    )), now, base_input(now, cfg_with.(config.())))
    hols = r['data']['holidays'] || []
    assert_equal(hols.select { (it['day'] || 0) == 0 }.map { it['title'] }, [],
                 "tomorrow's holiday was stated on today's board")
    # Tomorrow's holiday travels with tomorrow, whether or not a given panel
    # has the room to reach it: the payload carries both days and the day
    # badge for the second states its own. What gets drawn is `framed()`'s.
    assert_equal(hols.map { [it['title'], it['day']] }, [['Boxing Day', 1]],
                 "tomorrow's holiday should travel with tomorrow")
  end

  # THE OTHER HALF OF THAT PAIR IS GONE WITH THE SETTING IT NEEDED.
  #
  # Two cases here used to show a board set to tomorrow and check that
  # tomorrow's holiday, and tomorrow's all-day state, reached it: the same
  # lost-day bug seen from both sides, where every all-day entry arrived
  # having forgotten which day it belonged to and was read as day 0.
  #
  # Nothing draws tomorrow instead of today any more. The case above still
  # guards the half that can be asked -- tomorrow's holiday must not be
  # announced today -- and the half that cannot is recorded as
  # E25: a rolling board draws tomorrow's appointments but not tomorrow's
  # all-day states or its holiday, so a board that reaches into Christmas Day
  # does not say so.

  it 'a range that started before the board still says where it is in it' do
    # The run of days transform gathers is today and tomorrow, so a break
    # that began last Monday has no entry of its own on any day it
    # gathered except by covering it. The ordinal is counted off DTSTART,
    # not off the run.
    at = ms('2027-04-08T09:00:00Z')
    r = run_transform(serve.(all_day_ics.(
      [{ start: '20270329', end: '20270412', summary: 'Half Term' }]
    )), at, base_input(at, cfg_with.(config.())))
    assert_equal([r['data']['holidays'][0]['day_index'], r['data']['holidays'][0]['day_span']], [10, 14])
    assert_equal(r['data']['holidays'][0]['day_label'], 'Day 11 of 14')
  end

  # ------------------------------------------------------------- it is free

  it 'a holiday costs the board no line and no depth' do
    # The argument for the header over every other option costed: on a day
    # when nothing else is on, a holiday must not be the reason the board
    # draws a rail. Both lines here ask to be dropped when they have
    # nothing, so the board is genuinely empty -- and an all-day event used
    # to be enough to keep one alive, which is right for a person and wrong
    # for a country.
    r = run_transform([
      answer.(%r{/hol\.ics}, all_day_ics.([{ start: '20261225', end: '20261226', summary: 'Christmas Day' }])),
      otherwise(ics_with_events([]))
    ], now, base_input(now, cfg_with.(config.({
      lines: [{ name: 'Ada', hideWhenEmpty: true }, { name: 'Bo', hideWhenEmpty: true }]
    }))))
    assert_equal(r['data']['legend'], [], 'a holiday put a line on an empty board')
    assert_equal((r['data']['holidays'] || []).map { it['title'] }, ['Christmas Day'],
                 'and it is still stated')
  end
end
