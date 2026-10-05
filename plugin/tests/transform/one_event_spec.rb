# frozen_string_literal: true

# ONE EVENT, DRAWN ONCE, and the lines that share it laid out together.
#
# Two calendars can describe the same thing. Bart's "L6 School Day" and
# Lisa's "L2 School Day" both rename to "School Day", run the same hours,
# and are the same school day; they arrived as two events and were drawn
# twice, with two captions, on lines that could be at opposite ends of the
# board. These check that they arrive as one, and that sharing an event is
# what decides which lines end up next to each other.

require_relative '../support/transform'

RSpec.describe 'one-event' do
  include Metro::Transform

  now = Time.iso8601('2026-09-07T12:00:00Z').to_i * 1000 # a Monday
  cfg_with = ->(json) { { config_json: JSON.generate(json) } }

  # two calendars, each naming the same meeting for a different person
  define_method(:two_feeds) do |summary_a, summary_b, time_a, time_b|
    [
      serve('https://example.com/a.ics', ics_with_events([{ start: time_a[0], end: time_a[1], summary: summary_a }])),
      serve('https://example.com/b.ics', ics_with_events([{ start: time_b[0], end: time_b[1], summary: summary_b }]))
    ]
  end

  same = [%w[20260907T140000Z 20260907T150000Z], %w[20260907T140000Z 20260907T150000Z]]

  it 'the same event on two calendars becomes one event on both lines' do
    r = run_transform(two_feeds('Swim Class', 'Swim Class', same[0], same[1]), now,
                      base_input(now, cfg_with.(
                        lines: [{ name: 'Ada' }, { name: 'Bo' }],
                        calendars: [
                          { url: 'https://example.com/a.ics', rules: [{ match: { type: 'any' }, line: 'Ada' }] },
                          { url: 'https://example.com/b.ics', rules: [{ match: { type: 'any' }, line: 'Bo' }] }
                        ]
                      )))
    swims = event_items(r['data']).select { it['title'] == 'Swim Class' }
    assert_equal(swims.length, 1, 'one swim class, not two')
    assert_equal((swims[0]['co_owners'] || []).length, 1, 'the second line should be a co-owner, not a second event')
  end

  it 'two events with the same title at DIFFERENT times stay two events' do
    r = run_transform(two_feeds('Swim Class', 'Swim Class',
                                %w[20260907T140000Z 20260907T150000Z], %w[20260907T160000Z 20260907T170000Z]), now,
                      base_input(now, cfg_with.(
                        lines: [{ name: 'Ada' }, { name: 'Bo' }],
                        calendars: [
                          { url: 'https://example.com/a.ics', rules: [{ match: { type: 'any' }, line: 'Ada' }] },
                          { url: 'https://example.com/b.ics', rules: [{ match: { type: 'any' }, line: 'Bo' }] }
                        ]
                      )))
    assert_equal(event_items(r['data']).select { it['title'] == 'Swim Class' }.length, 2,
                 "two o'clock and four o'clock are not the same lesson")
  end

  # Six and a half hours, which is the length that makes a block a long one.
  # Nothing declares that: the config cannot ask for it and transform.js
  # does not label it, so the only way a long block could be treated
  # differently here is by accident.
  long = [%w[20260907T083000Z 20260907T150000Z], %w[20260907T083000Z 20260907T150000Z]]

  it 'the same long event on two calendars is one event with a co-owner' do
    # Deduping has to work the same for a school day as for a swim class.
    # It did not: a long block was split off into a payload of its own
    # BEFORE the two copies could be recognised as one thing, so both
    # children were drawn separately and the school was captioned twice.
    r = run_transform(two_feeds('School Day', 'School Day', long[0], long[1]), now,
                      base_input(now, cfg_with.(
                        lines: [{ name: 'Ada' }, { name: 'Bo' }],
                        calendars: [
                          { url: 'https://example.com/a.ics', rules: [{ match: { type: 'any' }, line: 'Ada' }] },
                          { url: 'https://example.com/b.ics', rules: [{ match: { type: 'any' }, line: 'Bo' }] }
                        ]
                      )))
    st = event_items(r['data']).select { it['title'] == 'School Day' }
    assert_equal(st.length, 1, 'one school day, not one per child')
    assert_equal(st[0]['co_owners'].length, 1, 'both children really are at school, so both lines are on it')
    assert(st[0]['co_owners'][0] != st[0]['owner'], 'the two of them are different lines')
    assert_equal([st[0]['start_min'], st[0]['end_min']], [8 * 60 + 30, 15 * 60], 'and it keeps the hours it ran')
  end

  it 'lines that share an event are laid out next to each other' do
    # Ada and Cy share nothing; Bo shares a class with each of them. The
    # board is a chain -- outermost left ... spine ... outermost right -- so
    # "next to each other" means consecutive in track_offset order across
    # the whole board, and Bo must sit between the two.
    feeds = [
      serve('https://example.com/a.ics', ics_with_events([{ start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Shared One' }])),
      serve('https://example.com/b.ics', ics_with_events([
        { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Shared One' },
        { start: '20260907T160000Z', end: '20260907T170000Z', summary: 'Shared Two' }
      ])),
      serve('https://example.com/c.ics', ics_with_events([{ start: '20260907T160000Z', end: '20260907T170000Z', summary: 'Shared Two' }]))
    ]
    r = run_transform(feeds, now, base_input(now, cfg_with.(
      lines: [{ name: 'Ada' }, { name: 'Bo' }, { name: 'Cy' }],
      calendars: [
        { url: 'https://example.com/a.ics', rules: [{ match: { type: 'any' }, line: 'Ada' }] },
        { url: 'https://example.com/b.ics', rules: [{ match: { type: 'any' }, line: 'Bo' }] },
        { url: 'https://example.com/c.ics', rules: [{ match: { type: 'any' }, line: 'Cy' }] }
      ]
    )))
    # ARRANGED, not as the payload lists them: the order is the solver's now
    # (solver/order.js), and what transform sends is the household's own
    # list. `arranged` runs the two together, which is what the board does.
    # (sorted with the index as the tie-break, since a JS sort is stable)
    board = arranged(r['data']).each_with_index
                               .sort_by { |t, i| [t['line_offset'], i] }.map { |t, _| t['name'] }
    assert_equal(board.length, 3, 'three lines')
    assert_equal(board[1], 'Bo',
                 "Bo shares an event with each of the others, so Bo belongs between them; got #{board.join(' ')}")
  end

  it 'the order is the one that crosses least, not the one greed reaches first' do
    # Every line sitting between two people who share an event is a line
    # their lines have to cross to reach each other, and since a shared
    # event MOVES the trunks rather than dropping a rail from each, that
    # crossing is real ink. So the order to draw is the one with fewest of
    # them, and a household is small enough to find it exactly.
    #
    # These four events are a set greed gets wrong: it takes the strongest
    # pair first and extends from the ends, which here reaches an order
    # costing two crossings when one is available. The test does not name
    # the right answer -- it works out the best any order could do and
    # insists on it, because there is usually more than one and naming one
    # of them would be testing this run rather than the rule.
    at = ->(h) { ["20260907T#{h}0000Z", "20260907T#{h + 1}0000Z"] }
    who = { 'a' => 'Ada', 'b' => 'Bo', 'c' => 'Cy', 'd' => 'Di', 'e' => 'Ed' }
    shared = [
      { at: 9, with: %w[b e], title: 'Morning Stand' },
      { at: 11, with: %w[c d e], title: 'Late Review' },
      { at: 13, with: %w[b d], title: 'Lunch Run' },
      { at: 16, with: %w[c e], title: 'Evening Call' }
    ]
    feeds = who.keys.map do |me|
      # one of their own each, so nobody's line is dropped for being empty:
      # a shared event belongs to its primary owner, and the others would
      # have nothing of their own to keep them on the board
      mine = [{ start: at.(19)[0], end: at.(19)[1], summary: "Errand #{me}" }]
      shared.each do |g|
        mine.push({ start: at.(g[:at])[0], end: at.(g[:at])[1], summary: g[:title] }) if g[:with].include?(me)
      end
      serve("https://example.com/#{me}.ics", ics_with_events(mine))
    end
    r = run_transform(feeds, now, base_input(now, cfg_with.(
      lines: who.keys.map { |k| { name: who[k] } },
      calendars: who.keys.map do |k|
        {
          url: "https://example.com/#{k}.ics",
          rules: [{ match: { type: 'any' }, line: who[k] }]
        }
      end
    )))
    # ARRANGED, not as the payload lists them: the order is the solver's now
    # (solver/order.js), and what transform sends is the household's own
    # list. `arranged` runs the two together, which is what the board does.
    # (sorted with the index as the tie-break, since a JS sort is stable)
    board = arranged(r['data']).each_with_index
                               .sort_by { |t, i| [t['line_offset'], i] }.map { |t, _| t['name'] }
    assert_equal(board.length, 5, "five lines: #{board.join(' ')}")
    # The groups as the BOARD has them, not as this test declared them:
    # what matters is that the order is the best one for the events that
    # actually came out shared, and reading them back is also the only way
    # the two halves of the check can be talking about the same thing.
    by_key = {}
    r['data']['legend'].each { |l| by_key[l['key']] = l['name'] }
    groups = r['data']['events']
             .select { |e| !(e['co_owners'] || []).empty? }
             .map { |e| ([e['owner']] + e['co_owners']).map { |k| by_key[k] }.reject { |n| n.to_s.empty? } }
    assert(groups.length >= 3, "only #{groups.length} shared event(s) came out; nothing to order for")
    cost = lambda do |seq|
      groups.reduce(0) do |sum, g|
        ix = g.map { |n| seq.index(n) || -1 }.sort
        between = 0
        i = ix[0] + 1
        while i < ix[ix.length - 1]
          between += 1 unless ix.include?(i)
          i += 1
        end
        sum + between
      end
    end
    floor = Float::INFINITY
    walk = lambda do |seq, k|
      if k == seq.length
        floor = [floor, cost.(seq)].min
        next
      end
      (k...seq.length).each do |i|
        seq[k], seq[i] = seq[i], seq[k]
        walk.(seq, k + 1)
        seq[k], seq[i] = seq[i], seq[k]
      end
    end
    walk.(board.dup, 0)
    assert_equal(cost.(board), floor,
                 "the board crosses #{cost.(board)} times where #{floor} was available: #{board.join(' ')}")
  end

  it 'the day stretches to fit what is on it, with room after the last event' do
    # Asked before the window's first step of the day: from ten the board
    # rolls the early morning off, and this case is about how one whole
    # day's window fits its own content.
    early = ms('2026-09-07T05:00:00Z')
    # A fixed 7am-to-9pm day cut the ends off and left a late event's label
    # nothing to run into. The window now reaches an hour before the first
    # thing and an hour and a half after the last.
    r = run_transform([serve('https://example.com/a.ics', ics_with_events([
      { start: '20260907T043000Z', end: '20260907T053000Z', summary: 'Early Shift' },
      { start: '20260907T200000Z', end: '20260907T203000Z', summary: 'Late Call' },
      # A THIRD EVENT SO THE DAY STAYS ITS OWN. Two is a quiet day and a
      # quiet day borrows the next one; this case is about how ONE day's
      # window fits its own content, and it used to ask for that with
      # `rolling_view: 'one'`. That setting is gone -- a board that quietly
      # shows more of what is coming needs no opt-out -- so the day has to
      # earn being one day, the way a real board does.
      { start: '20260907T120000Z', end: '20260907T130000Z', summary: 'Midday' }
    ]))], early, base_input(early, cfg_with.(
      calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }]
    )))
    items = event_items(r['data'])
    # (Math.min and Math.max of nothing are Infinity and -Infinity)
    first = items.map { it['start_min'] }.min || Float::INFINITY
    last = items.map { it['end_min'] }.max || -Float::INFINITY
    assert(r['data']['day_start_min'] <= first, 'the day starts at or before the first event, got ' \
                                                "#{r['data']['day_start_min']} vs #{first}")
    assert(r['data']['day_end_min'] >= last + 60,
           'the day should leave at least an hour past the last event for its label, got ' \
           "#{r['data']['day_end_min']} vs #{last}")
    # ...and inside the run it gathered, which is two days where there is a
    # tomorrow to send. What of it gets DRAWN is `day.js opened()` and
    # `framed()`, against a view.
    assert(r['data']['day_start_min'] >= 0 && r['data']['day_end_min'] <= 48 * 60,
           'and stay inside the run it gathered')
  end
end
