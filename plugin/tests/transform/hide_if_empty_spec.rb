# frozen_string_literal: true

# Whether a line with nothing on today is drawn anyway.
#
# A line NAMED IN `lines[]` is: somebody wrote that person's name down, and
# a board that deletes them on their quiet day is a board that changes
# shape daily and hides the answer you came to it for. `hideWhenEmpty: true`
# drops it, for a line that only matters on the days it is used.
#
# A line that exists only because a CALENDAR is named is not the same
# thing, and keeps the old default: a feed called "School" whose events all
# get routed to the children is a router, not a person, and an empty School
# rail is noise. `keepLine: true` on the calendar keeps it.

require_relative '../support/transform'

RSpec.describe 'hide-if-empty' do
  include Metro::Transform

  now = Time.iso8601('2026-09-09T09:00:00Z').to_i * 1000
  busy = 'https://cal.example.com/busy.ics'
  quiet = 'https://cal.example.com/quiet.ics'

  # one feed with something on today, one with nothing at all
  busy_events = [{ summary: 'Standup', start: '20260909T090000Z', end: '20260909T091500Z' }]
  empty_ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:Quiet\r\nEND:VCALENDAR\r\n"

  define_method(:net) do |down: false|
    [serve(busy, ics_with_events(busy_events)), down ? status(quiet, 503) : serve(quiet, empty_ics)]
  end

  define_method(:board) do |cfg, **opts|
    run_transform(net(**opts), now, base_input(now, use_demo_data: 'false', config_json: JSON.generate(cfg)))
  end

  tracks = ->(r) { r['data']['legend'].map { it['name'] }.sort.join(',') }

  it 'a line somebody named is on the board on its quiet day too' do
    r = board({
                lines: [{ name: 'Busy' }, { name: 'Quiet' }],
                calendars: [
                  { name: 'Busy', url: busy, rules: [{ match: { type: 'any' }, line: 'Busy' }] },
                  { name: 'Quiet', url: quiet, rules: [{ match: { type: 'any' }, line: 'Quiet' }] }
                ]
              })
    assert(tracks.call(r) == 'Busy,Quiet', "got #{tracks.call(r)}")
    # and it really is empty: nothing was invented to fill it
    assert(event_items(r['data']).length == 1, "expected the one real event, got #{event_items(r['data']).length}")
  end

  it 'a calendar that only routes elsewhere does not become an empty rail' do
    # "School" sends every entry to a child by class code and owns no line
    # of its own. Named, so the rules can talk about it; drawn, it would be
    # a rail with nobody on it.
    r = board({
                lines: [{ name: 'Busy' }],
                calendars: [
                  { name: 'Busy', url: busy, rules: [{ match: { type: 'any' }, line: 'Busy' }] },
                  { name: 'School', url: quiet, rules: [{ match: { type: 'any' }, line: 'Busy' }] }
                ]
              })
    assert(tracks.call(r) == 'Busy', "got #{tracks.call(r)}")
  end

  it 'keepLine on a calendar keeps the line that calendar owns' do
    r = board({
                calendars: [
                  { name: 'Busy', url: busy },
                  { name: 'Quiet', url: quiet, keepLine: true }
                ]
              })
    assert(tracks.call(r) == 'Busy,Quiet', "got #{tracks.call(r)}")
  end

  it 'a kept calendar survives its feed being down, not just being empty' do
    # a feed unreachable for an hour should not silently remove somebody
    r = board({
                calendars: [
                  { name: 'Busy', url: busy },
                  { name: 'Quiet', url: quiet, keepLine: true }
                ]
              }, down: true)
    assert(tracks.call(r) == 'Busy,Quiet', "got #{tracks.call(r)}")
  end

  it 'an unnamed kept calendar takes its line name from the feed' do
    r = board({
                calendars: [
                  { name: 'Busy', url: busy },
                  { url: quiet, keepLine: true }
                ]
              })
    assert(tracks.call(r) == 'Busy,Quiet', "got #{tracks.call(r)}")
  end

  it 'hideWhenEmpty drops a line that is only worth drawing when used' do
    r = board({
                lines: [{ name: 'Busy' }, { name: 'Quiet', hideWhenEmpty: true }],
                calendars: [
                  { name: 'Busy', url: busy, rules: [{ match: { type: 'any' }, line: 'Busy' }] },
                  { name: 'Quiet', url: quiet, rules: [{ match: { type: 'any' }, line: 'Quiet' }] }
                ]
              })
    assert(tracks.call(r) == 'Busy', "got #{tracks.call(r)}")
  end
end
