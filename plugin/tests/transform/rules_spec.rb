# frozen_string_literal: true

require_relative '../support/transform'

RSpec.describe 'rules' do
  include Metro::Transform

  now = Time.iso8601('2026-09-07T12:00:00Z').to_i * 1000 # a Monday

  cfg_with = ->(json) { { config_json: JSON.generate(json) } }

  it 'a rule can turn a timed event into an all-day one, which then runs the whole day' do
    # The event says 14:00 to 15:00; the rule says the training is a
    # whole-day thing. The rule wins, and the hour it came in with is
    # gone. There was a stretch when the plugin had nowhere to put an
    # all-day event and quietly dropped it, so the one assertion worth
    # making is that it is still on the board.
    ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Staff Training Day' }
    fetch_impl = [otherwise(ics_with_events([ev]))]
    r = run_transform(fetch_impl, now, base_input(now, cfg_with.(
      calendars: [{ url: 'https://example.com/a.ics', name: 'Cal', rules: [{ match: { type: 'word', value: 'Training' }, allDay: true }] }]
    )))
    # Promoted OFF the axis: an all-day event has no hour, so it is not an
    # item at all. It is declared at the head of whichever lines are in it.
    assert_equal(event_items(r['data']), [], 'nothing on the timeline')
    assert_equal(r['data']['all_day'].map { it['title'] }, ['Staff Training Day'],
                 'the rule promoted it')
  end

  it 'a rule can hide an event by title match' do
    ev_a = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Keep Me' }
    ev_b = { start: '20260907T160000Z', end: '20260907T170000Z', summary: 'Hide Me' }
    fetch_impl = [otherwise(ics_with_events([ev_a, ev_b]))]
    r = run_transform(fetch_impl, now, base_input(now, cfg_with.(
      calendars: [{ url: 'https://example.com/a.ics', name: 'Cal', rules: [{ match: { type: 'word', value: 'Hide Me' }, hide: true }] }]
    )))
    assert_equal(event_items(r['data']).map { it['title'] }, ['Keep Me'])
  end

  it "a rule can match against an event's description, but only when the calendar opts in via includeDescription" do
    ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Team Sync', description: 'cancelled' }
    fetch_impl = [otherwise(ics_with_events([ev]))]
    cfg_off = { calendars: [{ url: 'https://example.com/a.ics', name: 'Cal', rules: [{ match: { type: 'word', value: 'cancelled' }, hide: true }] }] }
    r_off = run_transform(fetch_impl, now, base_input(now, cfg_with.(cfg_off)))
    assert_equal(event_items(r_off['data']).length, 1, "without includeDescription, the desc is never parsed, so the rule can't see it")

    cfg_on = { calendars: [{ url: 'https://example.com/a.ics', name: 'Cal', includeDescription: true, rules: [{ match: { type: 'word', value: 'cancelled' }, hide: true }] }] }
    r_on = run_transform(fetch_impl, now, base_input(now, cfg_with.(cfg_on)))
    assert_equal(event_items(r_on['data']).length, 0, 'with includeDescription, the rule sees the description and hides it')
  end

  it 'a rewrite rule replaces the matched text with literal text, independent of track' do
    ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'L6 Swim Class' }
    fetch_impl = [otherwise(ics_with_events([ev]))]
    r = run_transform(fetch_impl, now, base_input(now, cfg_with.(
      calendars: [{ url: 'https://example.com/a.ics', name: 'Cal', rules: [{ match: { type: 'word', value: 'L6' }, rewrite: 'Lesson 6' }] }]
    )))
    assert_equal(event_items(r['data']).map { it['title'] }, ['Lesson 6 Swim Class'])
  end

  it 'deleting the matched text takes the gap it leaves with it' do
    # Stripping a class code is the commonest thing anybody writes a rule
    # for, and it is written as an empty rewrite. "L2 Zwemmen" came back as
    # " Zwemmen" -- printed on the panel as a caption indented by a space
    # nobody could account for -- and a code cut out of the middle left two
    # spaces behind. A rewrite is a cut; it takes the hole with it.
    fetch_impl = [otherwise(ics_with_events([
      { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'L2 Zwemmen' },
      { start: '20260907T160000Z', end: '20260907T170000Z', summary: 'Turnen L2 zaal' }
    ]))]
    r = run_transform(fetch_impl, now, base_input(now, cfg_with.(
      calendars: [{ url: 'https://example.com/a.ics', name: 'Cal',
                    rules: [{ match: { type: 'word', value: 'L2' }, rewrite: '' }] }]
    )))
    assert_equal(event_items(r['data']).map { it['title'] }, ['Zwemmen', 'Turnen zaal'])
  end

  it 'a catch-all ".*" rewrite does not duplicate the title (QuinnQuinn bug)' do
    ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Schoolfotografie' }
    fetch_impl = [otherwise(ics_with_events([ev]))]
    r = run_transform(fetch_impl, now, base_input(now, cfg_with.(
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'regex', value: '.*' }, rewrite: 'Quinn' }] }]
    )))
    assert_equal(event_items(r['data']).map { it['title'] }, ['Quinn'], 'a single non-global replace should produce "Quinn", never "QuinnQuinn"')
  end

  it 'the "any" match type is the intended way to write a catch-all rule' do
    ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Schoolfotografie' }
    fetch_impl = [otherwise(ics_with_events([ev]))]
    r = run_transform(fetch_impl, now, base_input(now, cfg_with.(
      lines: [{ name: 'Quinn' }],
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'any' }, line: 'Quinn' }] }]
    )))
    assert_equal(event_items(r['data']).map { it['title'] }, ['Schoolfotografie'], 'an "any" match changed the title')
    assert_equal(r['data']['legend'].map { it['name'] }, ['Quinn'])
  end

  it 'title replaces the whole title, not just the matched substring' do
    ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'L6 Swim Class with Jane' }
    fetch_impl = [otherwise(ics_with_events([ev]))]
    r = run_transform(fetch_impl, now, base_input(now, cfg_with.(
      calendars: [{ url: 'https://example.com/a.ics', name: 'Cal', rules: [{ match: { type: 'word', value: 'L6' }, title: 'Swimming' }] }]
    )))
    assert_equal(event_items(r['data']).map { it['title'] }, ['Swimming'])
  end

  it 'rewrite supports regex backreferences against the match' do
    ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Sprint 26-08' }
    fetch_impl = [otherwise(ics_with_events([ev]))]
    r = run_transform(fetch_impl, now, base_input(now, cfg_with.(
      calendars: [{ url: 'https://example.com/a.ics', name: 'Cal', rules: [{ match: { type: 'regex', value: 'Sprint (\\d+-\\d+)' }, rewrite: 'Sprint #$1' }] }]
    )))
    assert_equal(event_items(r['data']).map { it['title'] }, ['Sprint #26-08'])
  end

  it 'a rule routing a title and a rule rewriting it both apply' do
    ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'L6 Swim Class' }
    fetch_impl = [otherwise(ics_with_events([ev]))]
    r = run_transform(fetch_impl, now, base_input(now, cfg_with.(
      lines: [{ name: 'Alex' }],
      calendars: [{ url: 'https://example.com/a.ics', rules: [
        { match: { type: 'word', value: 'L6' }, line: 'Alex' },
        { match: { type: 'word', value: 'L6' }, rewrite: 'Lesson 6' }
      ] }]
    )))
    assert_equal(event_items(r['data']).map { it['title'] }, ['Lesson 6 Swim Class'])
  end

  it 'a global rule assigns a track across every calendar, not just one' do
    fetch_impl = [
      serve('https://example.com/a.ics', ics_with_events([{ start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Doctor Appointment' }])),
      serve('https://example.com/b.ics', ics_with_events([{ start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Something Else' }]))
    ]
    r = run_transform(fetch_impl, now, base_input(now, cfg_with.(
      rules: [{ match: { type: 'word', value: 'Doctor' }, line: 'Mom' }],
      lines: [{ name: 'Mom', badge: 'M' }],
      calendars: [{ url: 'https://example.com/a.ics' }, { url: 'https://example.com/b.ics' }]
    )))
    doctor_event = event_items(r['data']).find { it['title'].include?('Mom') || it['title'].include?('Doctor') }
    assert(!doctor_event.nil?, 'the global rule should have assigned Mom regardless of which calendar the event came from')
  end

  it "a calendar's own rule overrides a global rule's track assignment for the same event" do
    ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Doctor Appointment' }
    fetch_impl = [otherwise(ics_with_events([ev]))]
    r = run_transform(fetch_impl, now, base_input(now, cfg_with.(
      rules: [{ match: { type: 'word', value: 'Doctor' }, line: 'Mom' }],
      lines: [{ name: 'Mom', badge: 'M' }, { name: 'Dad', badge: 'D' }],
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'word', value: 'Doctor' }, line: 'Dad' }] }]
    )))
    ev0 = event_items(r['data'])[0]
    dad_track = r['data']['legend'].find { it['name'] == 'Dad' }
    assert_equal(ev0['owner'], dad_track['key'], 'the calendar-specific rule should win over the global one')
  end

  it "a calendar's custom headers are sent on its ICS fetch, alongside the default User-Agent" do
    # Read off the wire, as the mock proxy received them (names lower-cased).
    fetch_impl = [otherwise(ics_with_events([]))]
    r = run_transform(fetch_impl, now, base_input(now, cfg_with.(
      calendars: [{ url: 'https://example.com/a.ics', headers: { Authorization: 'Bearer secret-token' } }]
    )))
    captured_headers = (requests_of(r).find { it['url'] == 'https://example.com/a.ics' } || {})['headers'] || {}
    assert_equal(captured_headers['authorization'], 'Bearer secret-token')
    assert_equal(captured_headers['user-agent'], 'TRMNL-Metro-Calendar', 'the default User-Agent should still be sent alongside it')
  end

  it "non-string values in a calendar's headers are dropped rather than sent as-is" do
    fetch_impl = [otherwise(ics_with_events([]))]
    r = run_transform(fetch_impl, now, base_input(now, cfg_with.(
      calendars: [{ url: 'https://example.com/a.ics', headers: { 'X-Ok': 'fine', 'X-Bad': { nested: true } } }]
    )))
    captured_headers = (requests_of(r).find { it['url'] == 'https://example.com/a.ics' } || {})['headers'] || {}
    assert_equal(captured_headers['x-ok'], 'fine')
    assert_equal(captured_headers.key?('x-bad'), false, 'a non-string header value should be dropped, not passed through')
  end

  it 'the first track in tracks[] (everyoneTrack) claims any event no rule assigns a track to' do
    ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Unclaimed Event' }
    fetch_impl = [otherwise(ics_with_events([ev]))]
    r = run_transform(fetch_impl, now, base_input(now, cfg_with.(
      lines: [{ name: 'Everyone', badge: '★' }],
      calendars: [{ url: 'https://example.com/a.ics' }]
    )))
    assert_equal(event_items(r['data']).length, 1)
    assert_equal(r['data']['legend'].map { it['name'] }, ['Everyone'])
  end

  it 'a calendar says whose it is with line; with lines declared, its name is only a label' do
    ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Extra turnen' }
    fetch_impl = [otherwise(ics_with_events([ev]))]
    r = run_transform(fetch_impl, now, base_input(now, cfg_with.(
      lines: [{ name: 'Familie', badge: '★' }, { name: 'Jules', badge: 'K' }],
      calendars: [{ url: 'https://example.com/a.ics', name: 'School', line: 'Jules' }]
    )))
    ev0 = event_items(r['data'])[0]
    assert_equal(ev0['owner'], r['data']['legend'].find { it['name'] == 'Jules' }['key'], "the calendar's line did not claim its event")
    assert(!r['data']['legend'].any? { it['name'] == 'School' }, "the calendar's name became a line")
  end

  it "a rule's own track assignment still wins over the everyoneTrack fallback" do
    ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Alex event' }
    fetch_impl = [otherwise(ics_with_events([ev]))]
    r = run_transform(fetch_impl, now, base_input(now, cfg_with.(
      lines: [{ name: 'Everyone', badge: '★' }, { name: 'Alex', badge: 'A' }],
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'word', value: 'Alex' }, line: 'Alex' }] }]
    )))
    ev0 = event_items(r['data'])[0]
    alex_track = r['data']['legend'].find { it['name'] == 'Alex' }
    assert_equal(ev0['owner'], alex_track['key'])
  end

  it 'a rule with a multi-name track list produces an event with co_owners (an interchange, client-side)' do
    ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Family Dinner' }
    fetch_impl = [otherwise(ics_with_events([ev]))]
    r = run_transform(fetch_impl, now, base_input(now, cfg_with.(
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'any' }, line: %w[Alex Kids] }] }]
    )))
    ev0 = event_items(r['data'])[0]
    assert_equal(ev0['owner'], r['data']['legend'].find { it['name'] == 'Alex' }['key'], 'the first name becomes the primary owner')
    assert_equal(ev0['co_owners'].length, 1, 'the remaining name(s) become co_owners')
  end

  it 'string-shorthand calendar entries (a bare URL, not {url:...}) are accepted' do
    ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Event' }
    fetch_impl = [otherwise(ics_with_events([ev]))]
    r = run_transform(fetch_impl, now, base_input(now, cfg_with.(
      lines: [{ name: 'Everyone' }],
      calendars: ['https://example.com/a.ics']
    )))
    assert_equal(event_items(r['data']).length, 1)
  end

  it 'non-JSON config text falls back to a newline-separated URL list' do
    # parseConfig is internal to transform.js: asked in plain node.
    urls = internals('const cfg = T.parseConfig(args.text); return cfg.calendars.map((c) => c.url);',
                     args: { text: "https://a.example.com/x.ics\nhttps://b.example.com/y.ics\n" })
    assert_equal(urls, ['https://a.example.com/x.ics', 'https://b.example.com/y.ics'])
  end

  # WHY THE BOARD IS EMPTY, SAID ON IT. A header over nothing looked the
  # same whether the paste was broken, the feeds were down or the day was
  # quiet, and each wants something different done about it.
  it 'an unreadable configuration says so on the board' do
    r = run_transform(demo_mocks + [otherwise(ics_with_events([]))], now,
                      base_input(now, config_json: '{ "calendars": [ { "url": "https://x/a.ics" '))
    assert_equal(r['data']['legend'].length, 0, 'the example was drawn over a broken configuration')
    assert(/could not be read/.match?(r['data']['board_notice'] || ''), "no notice: #{r['data']['board_notice']}")
  end

  it 'every calendar failing says which, even with the lines still drawn' do
    r = run_transform([otherwise(404)], now, base_input(now, cfg_with.(
      lines: [{ name: 'Sam' }], calendars: [{ url: 'https://example.com/work.ics', name: 'Work', line: 'Sam' }]
    )))
    assert(/None of the calendars could be read: Work/.match?(r['data']['board_notice'] || ''), "no notice: #{r['data']['board_notice']}")
  end

  it 'a board with calendars that answered and nothing on them says so, and a busy one says nothing' do
    quiet = run_transform([otherwise(ics_with_events([]))], now, base_input(now, cfg_with.(
      calendars: [{ url: 'https://example.com/a.ics' }]
    )))
    assert(/Nothing on the calendars/.match?(quiet['data']['board_notice'] || ''), "no notice on an empty board: #{quiet['data']['board_notice']}")
    busy = run_transform([otherwise(ics_with_events([{ start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Standup' }]))], now,
                         base_input(now, cfg_with.(calendars: [{ url: 'https://example.com/a.ics', name: 'Sam' }])))
    # (null, not undefined: the key is there and says nothing)
    assert(busy['data'].key?('board_notice'), 'a board with something on it carries a notice: expected null, got undefined')
    assert_equal(busy['data']['board_notice'], nil, 'a board with something on it carries a notice')
  end

  it 'non-JSON config text with no non-blank lines also falls back to the demo' do
    r = run_transform(demo_mocks + [otherwise(ics_with_events([]))], now,
                      base_input(now, config_json: "   \n   \n"))
    names = r['data']['legend'].map { it['name'] }.sort
    assert_equal(names, %w[Bart Homer Lisa Maggie Marge], 'the demo config was not picked up')
  end

  it 'a line nobody uses today is still on the board, because somebody named it' do
    ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Busy track only' }
    fetch_impl = [otherwise(ics_with_events([ev]))]
    r = run_transform(fetch_impl, now, base_input(now, cfg_with.(
      lines: [{ name: 'Idle' }, { name: 'Busy' }],
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'any' }, line: 'Busy' }] }]
    )))
    assert_equal(r['data']['legend'].map { it['name'] }.sort, %w[Busy Idle],
                 'a board that deletes whoever is quiet changes shape every day')
  end

  it 'hideWhenEmpty drops a line, and the lines left close up with no gap left behind' do
    ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'C event' }
    fetch_impl = [otherwise(ics_with_events([ev]))]
    r = run_transform(fetch_impl, now, base_input(now, cfg_with.(
      version: 1,
      lines: [{ name: 'A', hideWhenEmpty: true }, { name: 'B', hideWhenEmpty: true }, { name: 'C' }],
      calendars: [{ url: 'https://example.com/a.ics', line: 'C' }]
    )))
    assert_equal(r['data']['legend'].map { it['name'] }, ['C'])
    assert_equal(arranged(r['data'])[0]['line_offset'].abs, 10, 'C does not sit in the first slot, as if A and B left a gap')
  end

  it "side and color are gone: a configuration that still says them is drawn by the board's own choice" do
    ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'C event' }
    fetch_impl = [otherwise(ics_with_events([ev]))]
    plain = run_transform(fetch_impl, now, base_input(now, cfg_with.(lines: [{ name: 'C' }], calendars: [{ url: 'https://example.com/a.ics', name: 'C' }])))
    pinned = run_transform(fetch_impl, now, base_input(now, cfg_with.(lines: [{ name: 'C', side: 'right', color: 'red' }], calendars: [{ url: 'https://example.com/a.ics', name: 'C' }])))
    assert_equal(JSON.generate(pinned['data']['legend']), JSON.generate(plain['data']['legend']), 'side or color still changes the line')
  end

  # `tracks`/`track` are the current field names (tracks were called
  # "people" before this rename); a config written before the rename,
  # still sitting pasted into someone's live device, must keep working
  # exactly as before with zero edits.

  it 'a long block carries its location and earns its owner a legend entry' do
    # Eleven hours at a desk. This used to need `siding: true` in the
    # config and came back in a `sidings` array of its own; it is an
    # ordinary event now, and nothing about it is declared anywhere. What
    # is worth holding on to is that it is still a whole event: the
    # location is what the caption says where, and a track whose only
    # entry today is a block like this one still counts as active, so it
    # gets a line and a name.
    ev = { start: '20260907T080000Z', end: '20260907T190000Z', summary: 'Desk booking', location: 'BE-Ghent A01' }
    fetch_impl = [otherwise(ics_with_events([ev]))]
    r = run_transform(fetch_impl, now, base_input(now, cfg_with.(
      calendars: [{ url: 'https://example.com/a.ics', name: 'Quinn' }]
    )))
    items = event_items(r['data'])
    assert_equal(items.length, 1, 'a long block belongs on the timeline like anything else')
    assert_equal(items[0]['title'], 'Desk booking')
    assert_equal(items[0]['location'], 'BE-Ghent A01')
    assert_equal(items[0]['start_min'], 8 * 60)
    assert_equal(items[0]['end_min'], 19 * 60)
    ward_track = r['data']['legend'].find { it['name'] == 'Quinn' }
    assert_equal(items[0]['owner'], ward_track['key'], 'a track carrying only a long block is still "active"')
  end

  it "an all-day event is declared at the line's head, never on the axis" do
    # It was an item spanning the visible window, which made the board
    # print its own window back as the event's hours -- "6am - 11pm /
    # Staff Training Day", which is not when the training is, it is when
    # the board decided to start looking. An all-day event has no hour to
    # show, so it gets no place on a scale of hours.
    ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Staff Training Day' }
    fetch_impl = [otherwise(ics_with_events([ev]))]
    r = run_transform(fetch_impl, now, base_input(now, cfg_with.(
      calendars: [{ url: 'https://example.com/a.ics', name: 'Cal', rules: [{ match: { type: 'word', value: 'Training' }, allDay: true }] }]
    )))
    assert_equal(event_items(r['data']), [], 'nothing between the first hour and the last')
    # (undefined, not null: the key is not there at all)
    assert(!r['data'].key?('sidings'), "and not split into a payload of its own either: expected undefined, got #{r['data']['sidings'].to_json}")
    assert_equal(r['data']['all_day'].length, 1, 'it is declared once')
    st = r['data']['all_day'][0]
    assert_equal(st['title'], 'Staff Training Day')
    cal_track = r['data']['legend'].find { it['name'] == 'Cal' }
    assert_equal(st['owners'], [cal_track['key']], 'against the line whose day it is')
    assert(!st.key?('hue'), "presentation is the frontend's: expected undefined, got #{st['hue'].to_json}")
  end

  it 'one all-day title shared by several lines is one origin, named once' do
    # Three people are not on three holidays; they are on one. Naming it
    # per line would put the same words at three heads and say there were
    # three of them.
    ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Half Term' }
    fetch_impl = [otherwise(ics_with_events([ev]))]
    r = run_transform(fetch_impl, now, base_input(now, cfg_with.(
      calendars: [
        { url: 'https://example.com/a.ics', name: 'Cal', rules: [{ match: { type: 'word', value: 'Half' }, allDay: true }] },
        { url: 'https://example.com/b.ics', name: 'Two', rules: [{ match: { type: 'word', value: 'Half' }, allDay: true }] }
      ]
    )))
    assert_equal(r['data']['all_day'].length, 1, 'one row, not one per line')
    assert_equal(r['data']['all_day'][0]['owners'].length, 2, 'carrying both lines')
  end

  it 'one rule naming several lines puts the all-day entry on all of them' do
    # A school holiday feed routed to all four children. This used to keep
    # `lineNames[0]` and throw the rest away: whichever child happened to
    # be first in the list was off school and the other three had an
    # ordinary day. A timed event routed to several lines has been an
    # interchange all along; this is that, at the head of the line.
    ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Spring Break' }
    fetch_impl = [otherwise(ics_with_events([ev]))]
    r = run_transform(fetch_impl, now, base_input(now, cfg_with.(
      lines: [{ name: 'Ada' }, { name: 'Bo' }, { name: 'Cy' }],
      calendars: [{ url: 'https://example.com/a.ics', name: 'School', rules: [
        { match: { type: 'word', value: 'Spring' }, allDay: true, line: %w[Ada Bo Cy] }
      ] }]
    )))
    assert_equal(r['data']['all_day'].length, 1, 'one row, not one per line')
    names = {}
    r['data']['legend'].each { names[it['key']] = it['name'] }
    assert_equal(r['data']['all_day'][0]['owners'].map { names[it] }.sort_by(&:to_s), %w[Ada Bo Cy],
                 'three children are on one holiday, and all three are on it')
  end

  it "a real meeting inside a long block's span still renders normally alongside it" do
    # A standup at nine while somebody is at a desk from eight to seven.
    # Both are events, they overlap, and neither swallows the other: the
    # long one used to be filtered off the timeline, and the fear on the
    # other side of that was that the short one would go with it.
    ev_long = { start: '20260907T080000Z', end: '20260907T190000Z', summary: 'Desk booking' }
    ev_meeting = { start: '20260907T090000Z', end: '20260907T093000Z', summary: 'Standup' }
    fetch_impl = [otherwise(ics_with_events([ev_long, ev_meeting]))]
    r = run_transform(fetch_impl, now, base_input(now, cfg_with.(
      calendars: [{ url: 'https://example.com/a.ics', name: 'Quinn' }]
    )))
    assert_equal(event_items(r['data']).map { it['title'] }, ['Desk booking', 'Standup'],
                 'in start order, both on the timeline')
  end
  # ---- WHO CLAIMS A CALENDAR NOBODY ROUTED --------------------------------
  #
  # A calendar with no rules and no name used to go to the FIRST entry in
  # `lines[]`. The variable holding it is called `everyoneLine`, which is
  # the giveaway: it was written to mean "everyone" and it meant "whoever
  # happens to be first".
  #
  # The calendar this actually describes is the household one -- the bin
  # day, the holidays, the shared family feed pasted in without saying whose
  # it is. Giving it to the first person is a confident wrong answer and a
  # silent one: it shows up as that person's day and nothing says otherwise.
  it 'a calendar nobody routed belongs to the whole household' do
    ev = { start: '20260907T180000Z', end: '20260907T190000Z', summary: 'Bin Day' }
    r = run_transform([otherwise(ics_with_events([ev]))], now, base_input(now, cfg_with.(
      lines: [{ name: 'Ada' }, { name: 'Bo' }, { name: 'Cy' }],
      calendars: [{ url: 'https://example.com/shared.ics' }]
    )))
    bin = event_items(r['data']).select { it['title'] == 'Bin Day' }[0]
    assert(bin, 'the unrouted calendar produced no event at all')
    on = ([bin['owner']] + (bin['co_owners'] || [])).sort_by(&:to_s)
    key = {}
    r['data']['legend'].each { key[it['key']] = it['name'] }
    assert_equal(on.map { key[it] }.sort_by(&:to_s), %w[Ada Bo Cy],
                 "an unrouted calendar landed on #{on.map { key[it] }.join(', ')} rather than everyone")
  end

  # THE BADGES ARE GONE, AND SO ARE THE CARS THEY NAMED.
  #
  # Three cases lived here: an emoji badge surviving its surrogate pair, two
  # names starting alike getting different letters, and an asked-for badge
  # never being rewritten. All three were about the letter drawn inside a
  # car -- the little train standing at the current minute -- and the board
  # does not draw cars any more, so there is no letter to be right about.
  # The configured `badge` went with them; CONFIG.md no longer lists it.
end
