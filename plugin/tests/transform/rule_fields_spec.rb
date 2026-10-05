# frozen_string_literal: true

# Matching on more of an event than its title.
#
# A rule used to see two things: the words in the SUMMARY, and the words
# in the DESCRIPTION if the calendar had opted into one. Everything else a
# calendar knows about an event was invisible, so the only way to route by
# place, by kind, or by how long something lasts was to hope it was said
# in the title as well.
#
# Two shapes of answer. Text matchers take an optional `field`, naming
# which property to read. And two matchers ask about the event's shape
# rather than its words: `duration` and `time`.
#
# The compatibility rule that governs all of it: a matcher with NO field
# behaves exactly as it always did, reading the title plus the description
# when there is one. Every config in the world is written against that.

require_relative '../support/transform'

RSpec.describe 'rule-fields' do
  include Metro::Transform

  now = Time.iso8601('2026-09-09T09:00:00Z').to_i * 1000 # a Wednesday

  define_method(:net) do |ics|
    [serve(Metro::Transform::FORECAST, '{}'), otherwise(ics)]
  end

  define_method(:board) do |ics, config|
    run_transform(net(ics), now, base_input(now,
                                            use_demo_data: 'false',
                                            config_json: JSON.generate(config)))
  end

  define_method(:tracks_of) do |metro|
    event_items(metro).map do |e|
      name = (metro['legend'].find { |p| p['key'] == e['owner'] } || {})['name']
      "#{e['title']}@#{name.nil? ? 'undefined' : name}"
    end.sort
  end

  define_method(:at_school) do
    ics_with_events([
      { start: '20260909T090000Z', end: '20260909T093000Z', summary: 'Assembly', location: 'Springfield Elementary' },
      { start: '20260909T110000Z', end: '20260909T113000Z', summary: 'Budget call', location: 'Zoom' }
    ])
  end

  it 'a rule can route on where the event is, not what it is called' do
    # The case that motivates the whole thing: a school calendar where the
    # titles say nothing useful and the place says everything.
    r = board(at_school, {
      lines: [{ name: 'Work' }, { name: 'Kids' }],
      calendars: [{ url: 'https://example.com/a.ics', name: 'Work', rules: [
        { match: { type: 'contains', value: 'Elementary', field: 'location' }, line: 'Kids' }
      ] }]
    })
    assert_equal(tracks_of(r['data']), ['Assembly@Kids', 'Budget call@Work'])
  end

  it 'matching on the place leaves the title alone' do
    # `rename` defaults to true, and it works by replacing the matched text
    # in the title. There is no matched text in the title here, so the
    # event has to keep its name rather than be renamed to the track.
    r = board(at_school, {
      calendars: [{ url: 'https://example.com/a.ics', name: 'Work', rules: [
        { match: { type: 'contains', value: 'Elementary', field: 'location' }, line: 'Kids' }
      ] }]
    })
    assert_equal(tracks_of(r['data']), ['Assembly@Kids', 'Budget call@Work'],
                 'the rule has to have fired for this to be about renaming at all')
  end

  it 'a rule can read the categories a calendar sets' do
    ics = ics_with_events([
      { start: '20260909T090000Z', end: '20260909T093000Z', summary: 'Match', categories: 'Sport,Kids' },
      { start: '20260909T110000Z', end: '20260909T113000Z', summary: 'Standup', categories: 'Work' }
    ])
    r = board(ics, {
      lines: [{ name: 'Desk' }, { name: 'Club' }],
      calendars: [{ url: 'https://example.com/a.ics', name: 'Desk', rules: [
        { match: { type: 'exact', value: 'Sport', field: 'categories' }, line: 'Club' }
      ] }]
    })
    assert_equal(tracks_of(r['data']), ['Match@Club', 'Standup@Desk'])
  end

  it 'a category is a whole value, and an escaped comma does not split one' do
    # CATEGORIES is a list, so `exact` anchors to one entry rather than to
    # the whole line: "Sport,Kids" is two categories and exactly Sport is
    # one of them. A comma the writer escaped belongs to the value.
    ics = ics_with_events([
      { start: '20260909T090000Z', end: '20260909T093000Z', summary: 'Trip', categories: 'Kids\\, school,Sport' }
    ])
    r = board(ics, {
      lines: [{ name: 'Desk' }, { name: 'Club' }],
      calendars: [{ url: 'https://example.com/a.ics', name: 'Desk', rules: [
        { match: { type: 'exact', value: 'Kids, school', field: 'categories' }, line: 'Club' }
      ] }]
    })
    assert_equal(tracks_of(r['data']), ['Trip@Club'])
  end

  it 'asking for the description by name is opting into it' do
    # includeDescription is off, and the rule reads the description
    # anyway. Before this the rule silently matched nothing, which looks
    # exactly like a rule that is wrong.
    ics = ics_with_events([
      { start: '20260909T090000Z', end: '20260909T093000Z', summary: 'Block', description: 'room 4, with the sitter' }
    ])
    r = board(ics, {
      lines: [{ name: 'Desk' }, { name: 'Home' }],
      calendars: [{ url: 'https://example.com/a.ics', name: 'Desk', rules: [
        { match: { type: 'contains', value: 'sitter', field: 'description' }, line: 'Home' }
      ] }]
    })
    assert_equal(tracks_of(r['data']), ['Block@Home'])
  end

  it 'a field of "title" really means only the title' do
    # The narrowing direction. With the description switched on, the
    # default field would match this; naming the title must not.
    ics = ics_with_events([
      { start: '20260909T090000Z', end: '20260909T093000Z', summary: 'Block', description: 'sitter' }
    ])
    cfg = lambda do |field|
      {
        lines: [{ name: 'Desk' }, { name: 'Home' }],
        calendars: [{ url: 'https://example.com/a.ics', name: 'Desk', includeDescription: true, rules: [
          { match: { type: 'contains', value: 'sitter' }.merge(field.to_s.empty? ? {} : { field: field }), line: 'Home' }
        ] }]
      }
    end
    assert_equal(tracks_of(board(ics, cfg.(nil))['data']), ['Block@Home'], 'no field: the description still counts')
    assert_equal(tracks_of(board(ics, cfg.('title'))['data']), ['Block@Desk'], 'field title: the description does not')
  end

  it '"any" reads everything the event carries' do
    ics = ics_with_events([
      { start: '20260909T090000Z', end: '20260909T093000Z', summary: 'Pickup', location: 'Springfield Elementary' },
      { start: '20260909T110000Z', end: '20260909T113000Z', summary: 'Elementary theory', categories: 'Work' }
    ])
    r = board(ics, {
      lines: [{ name: 'Desk' }, { name: 'Kids' }],
      calendars: [{ url: 'https://example.com/a.ics', name: 'Desk', rules: [
        { match: { type: 'contains', value: 'Elementary', field: 'any' }, line: 'Kids' }
      ] }]
    })
    assert_equal(tracks_of(r['data']), ['Elementary theory@Kids', 'Pickup@Kids'])
  end

  it 'an unknown field falls back to the default rather than matching nothing' do
    # Same rule the rest of the config follows: a misspelling is ignored,
    # not fatal. It would otherwise be a rule that silently does nothing.
    r = board(at_school, {
      lines: [{ name: 'Desk' }, { name: 'Kids' }],
      calendars: [{ url: 'https://example.com/a.ics', name: 'Desk', rules: [
        { match: { type: 'contains', value: 'Assembly', field: 'titel' }, line: 'Kids' }
      ] }]
    })
    assert(tracks_of(r['data']).include?('Assembly@Kids'), "got #{tracks_of(r['data']).to_json}")
  end

  # ---- the shape of the day, rather than its words ---------------------

  define_method(:long_day) do
    ics_with_events([
      { start: '20260909T083000Z', end: '20260909T150000Z', summary: 'In the office' },
      { start: '20260909T100000Z', end: '20260909T103000Z', summary: 'Standup' },
      { start: '20260909T070000Z', end: '20260909T073000Z', summary: 'Gym' }
    ])
  end

  it 'a long block travels as an ordinary event, not a payload of its own' do
    # "Anything over four hours is a status block, not a meeting" is the
    # rule, and nobody has to write it down: the config used to carry
    # `siding: true` and no longer can, because the shape of a day is a
    # fact about the calendar rather than a setting. It is not something
    # transform.js writes down either. A long block used to be split out
    # into a `sidings` array and disappear from the timeline; it is an
    # event like any other now, and the client reads the clock to decide
    # how to draw it.
    r = board(long_day, {
      calendars: [{ url: 'https://example.com/a.ics', name: 'Alex' }]
    })
    # (undefined, not null: the key is not there at all)
    assert(!r['data'].key?('sidings'), "nothing is split out of the timeline any more: expected undefined, got #{r['data']['sidings'].to_json}")
    assert_equal(event_items(r['data']).map { it['title'] }.sort, ['Gym', 'In the office', 'Standup'])
    long = event_items(r['data']).select { it['title'] == 'In the office' }[0]
    assert_equal([long['start_min'], long['end_min']], [510, 900], 'the block keeps its own span')
    assert_equal(long['co_owners'], [], 'one person is at the office, so there is nobody to converge with')
  end

  it 'duration takes a ceiling as well as a floor' do
    r = board(long_day, {
      lines: [{ name: 'Alex' }, { name: 'Quick' }],
      calendars: [{ url: 'https://example.com/a.ics', name: 'Alex', rules: [
        { match: { type: 'duration', max: 30 }, line: 'Quick' }
      ] }]
    })
    # "In the office" is in the list, on the line it came in on: six and a
    # half hours is over the ceiling, so the rule never touches it. It used
    # to be missing here because a long block was split off the timeline
    # before the rules ran, which made this case quietly agree with a
    # filter instead of with the matcher it is about.
    assert_equal(tracks_of(r['data']), ['Gym@Quick', 'In the office@Alex', 'Standup@Quick'])
  end

  it 'a rule can ask when the day it belongs to starts' do
    # from is inclusive and to is exclusive, so two windows can be written
    # back to back without both claiming the hour they meet at. "In the
    # office" starts at exactly 08:30 and stays on Alex, which is the
    # exclusive end of the window being right about its own boundary.
    r = board(long_day, {
      lines: [{ name: 'Alex' }, { name: 'Early' }],
      calendars: [{ url: 'https://example.com/a.ics', name: 'Alex', rules: [
        { match: { type: 'time', to: '08:30' }, line: 'Early' }
      ] }]
    })
    assert_equal(tracks_of(r['data']), ['Gym@Early', 'In the office@Alex', 'Standup@Alex'])
  end

  it 'the shape matchers compose with the word ones' do
    # The point of and/or/not: "a short one, but not that one". Written
    # against `hide` rather than against a long block, because how a long
    # block is drawn is not something a rule can ask for.
    r = board(long_day, {
      calendars: [{ url: 'https://example.com/a.ics', name: 'Alex', rules: [
        { match: { type: 'and', matchers: [
          { type: 'duration', max: 60 },
          { type: 'not', matcher: { type: 'contains', value: 'Gym' } }
        ] }, hide: true }
      ] }]
    })
    assert_equal(event_items(r['data']).map { it['title'] }.sort, ['Gym', 'In the office'],
                 'Standup was short and unnamed, so it went; Gym was short and named, so it stayed; ' \
                 'In the office is over the ceiling, so the matcher never saw it')
  end

  it 'a duration or time matcher with nothing to compare is dropped, not always-true' do
    # A no-op rule that matched everything would silently move the whole
    # board onto one line.
    r = board(long_day, {
      lines: [{ name: 'Alex' }, { name: 'Nowhere' }],
      calendars: [{ url: 'https://example.com/a.ics', name: 'Alex', rules: [
        { match: { type: 'duration' }, line: 'Nowhere' },
        { match: { type: 'time' }, line: 'Nowhere' }
      ] }]
    })
    assert(tracks_of(r['data']).all? { (it.index('@Alex') || -1) > 0 }, "got #{tracks_of(r['data']).to_json}")
  end
end
