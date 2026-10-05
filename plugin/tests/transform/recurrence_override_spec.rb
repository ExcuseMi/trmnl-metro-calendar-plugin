# frozen_string_literal: true

require_relative '../support/transform'

RSpec.describe 'recurrence-override' do
  include Metro::Transform

  # a board with one calendar on it and no weather, which is all the
  # recurrence cases need
  define_method(:net) do |ics|
    [status(Metro::Transform::FORECAST, 500), otherwise(ics)]
  end
  define_method(:input) do |now_ms|
    base_input(now_ms,
               use_demo_data: 'false',
               config_json: JSON.generate(calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }]))
  end
  titles_of = ->(r) { r['data']['events'].map { |i| i['title'] } }

  # "We also have standup twice" -- an Outlook-style export where a weekly
  # series has a same-UID RECURRENCE-ID override for one occurrence (an
  # attendee-response-only edit, or a moved time). Without suppressing the
  # master's own occurrence on that date, both the master's weekly-RRULE
  # match AND the override's own direct-hit DTSTART show up, doubling it.

  it "a no-op RECURRENCE-ID override does not duplicate the master's own occurrence" do
    monday = ms('2026-09-07T09:30:00Z')
    events = [
      { uid: 'series-1', start: '20260601T090000Z', end: '20260601T091500Z', rrule: 'FREQ=WEEKLY;BYDAY=MO', summary: 'Team Standup' },
      { uid: 'series-1', recurrenceId: '20260907T090000Z', start: '20260907T090000Z', end: '20260907T091500Z', summary: 'Team Standup' }
    ]
    fetch_impl = [otherwise(ics_with_events(events))]
    cfg = JSON.generate(calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }])
    r = run_transform(fetch_impl, monday, base_input(monday, config_json: cfg))
    assert_equal(event_items(r['data']).length, 1, %q(the override should replace the master's occurrence, not add a second "Team Standup"))
  end

  it "a RECURRENCE-ID override that moves the occurrence still suppresses the master's original slot" do
    monday = ms('2026-09-07T09:30:00Z')
    events = [
      { uid: 'series-2', start: '20260907T090000Z', end: '20260907T091500Z', rrule: 'FREQ=WEEKLY;BYDAY=MO', summary: 'Standup' },
      { uid: 'series-2', recurrenceId: '20260907T090000Z', start: '20260907T110000Z', end: '20260907T111500Z', summary: 'Standup (moved)' }
    ]
    fetch_impl = [otherwise(ics_with_events(events))]
    cfg = JSON.generate(calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }])
    r = run_transform(fetch_impl, monday, base_input(monday, config_json: cfg))
    titles = event_items(r['data']).map { it['title'] }
    assert_equal(titles, ['Standup (moved)'], 'the original 09:00 occurrence should be suppressed and only the moved override should show')
  end

  it "an override for a DIFFERENT date does not suppress today's own occurrence" do
    monday = ms('2026-09-07T09:30:00Z')
    events = [
      { uid: 'series-3', start: '20260601T090000Z', end: '20260601T091500Z', rrule: 'FREQ=WEEKLY;BYDAY=MO', summary: 'Standup' },
      { uid: 'series-3', recurrenceId: '20260914T090000Z', start: '20260914T100000Z', end: '20260914T101500Z', summary: 'Standup (moved next week)' }
    ]
    fetch_impl = [otherwise(ics_with_events(events))]
    cfg = JSON.generate(calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }])
    r = run_transform(fetch_impl, monday, base_input(monday, config_json: cfg))
    assert_equal(event_items(r['data']).map { it['title'] }, ['Standup'], "today's own occurrence is untouched by an override targeting a different date")
  end

  # ---- occurrences the series does NOT have -------------------------
  #
  # Both of these were reported the same way: "why does the board show a
  # meeting that is not in my calendar?". Both were the same shape of
  # mistake, reading a recurrence rule as if it said less than it does,
  # and both got three times as visible the day the board started drawing
  # three days instead of one.

  it 'a fortnightly meeting does not happen every week' do
    # FREQ=WEEKLY;INTERVAL=2 read as plain weekly fires on the off weeks
    # too. The ceremonies most likely to carry an INTERVAL are exactly the
    # ones a work calendar is full of: sprint reviews, retros, 1:1s.
    #
    # The series starts Thu 10 Sep 2026 and runs fortnightly, so it is on
    # the 10th and the 24th, and NOT on the 17th.
    ics = ics_with_events([
      { start: '20260910T100000Z', end: '20260910T110000Z', summary: 'Sprint Review',
        rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TH' }
    ])
    on_week = run_transform(net(ics), ms('2026-09-10T08:00:00Z'),
                            input(ms('2026-09-10T08:00:00Z')))
    assert(titles_of.(on_week).include?('Sprint Review'),
           'the fortnightly meeting is missing from the week it is actually on')

    off_week = run_transform(net(ics), ms('2026-09-17T08:00:00Z'),
                             input(ms('2026-09-17T08:00:00Z')))
    assert_equal(titles_of.(off_week).select { it == 'Sprint Review' }.length, 0,
                 'a fortnightly meeting was drawn on its off week')
  end

  it 'an occurrence taken out of a series is not drawn' do
    # A standup you deleted for one day is still in the file: the rule
    # fires and an EXDATE says not this time. Ignored, the board shows a
    # meeting the calendar says is not happening.
    ics = ics_with_events([
      { start: '20260910T093000Z', end: '20260910T094500Z', summary: 'Standup',
        rrule: 'FREQ=WEEKLY;BYDAY=TH,FR', exdate: '20260911T093000Z' }
    ])
    r = run_transform(net(ics), ms('2026-09-10T08:00:00Z'), input(ms('2026-09-10T08:00:00Z')))
    standups = r['data']['events'].select { |i| i && i['title'] == 'Standup' }
    days = standups.map { |e| (e['start_min'] / 1440.0).floor }
    assert(days.include?(0), "Thursday's standup is missing")
    assert_equal(days.index(1) || -1, -1, "Friday's standup was drawn, and the calendar says it " \
                                          'was taken out of the series')
  end
end
