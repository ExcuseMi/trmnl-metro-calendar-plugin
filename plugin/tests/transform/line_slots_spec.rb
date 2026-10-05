# frozen_string_literal: true

# A PERSON KEEPS THEIR STYLE. The page hands out textures and shades down a
# ladder by the legend's order, and the order moves with the day (Order.
# arrange, who was dropped, which feed answered first). Each person is given
# a rung once, kept in the saved state by name, and keeps it: "as long the
# tracks didn't change, reuse the once assigned track styles".

require_relative '../support/transform'

RSpec.describe 'line-slots' do
  include Metro::Transform

  now = Time.iso8601('2026-09-19T10:00:00Z').to_i * 1000
  ics = lambda do |summary, hm|
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:#{summary}\r\n" \
      "DTSTART:20260919T#{hm}00Z\r\nDTEND:20260919T#{hm}30Z\r\nSUMMARY:#{summary}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
  end
  feeds = {
    'https://x.example/a.ics' => ics.('Alpha', '1200'), 'https://x.example/b.ics' => ics.('Bravo', '0900'),
    'https://x.example/c.ics' => ics.('Charlie', '1500'), 'https://x.example/d.ics' => ics.('Delta', '1800')
  }
  # (the pairs serve() and otherwise() make, written out: those are instance
  # methods and this list is built once, for every case)
  net = feeds.keys.map { |u| [u, { body: feeds[u] }] } +
        [[Metro::Transform::ELSE_404[0], { body: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n" }]]
  cfg = lambda do |names|
    JSON.generate(version: 1,
                  lines: names.map { |n| { name: n } },
                  calendars: names.map { |n| { url: "https://x.example/#{n[0].downcase}.ics", line: n } })
  end
  # (keys in name order, so the comparison is about the rungs and not about
  # the order the legend happened to arrive in)
  # A legend entry with no `slot` at all has no key here, as an undefined
  # value has none in the JSON the cases compare.
  slots_of = lambda do |r|
    o = {}
    (r['data']['legend'] || []).sort_by { |l| "#{l['name']},#{l['slot']}" }.each do |l|
      l.key?('slot') ? o[l['name']] = l['slot'] : o.delete(l['name'])
    end
    o
  end

  it "every person gets a rung, in the legend's order the first time, and it is saved" do
    r = run_transform(net, now, base_input(now, config_json: cfg.(%w[Alpha Bravo Charlie])))
    assert_equal(slots_of.(r), { Alpha: 0, Bravo: 1, Charlie: 2 })
    assert_equal(r['trmnl_state']['lineSlots'], { Alpha: 0, Bravo: 1, Charlie: 2 })
  end

  it 'the rungs come back from the state whatever order the legend arrives in' do
    input = base_input(now, config_json: cfg.(%w[Charlie Alpha Bravo]))
    input['trmnl']['state'] = { 'lineSlots' => { 'Alpha' => 0, 'Bravo' => 1, 'Charlie' => 2 } }
    r = run_transform(net, now, input)
    assert_equal(slots_of.(r), { Alpha: 0, Bravo: 1, Charlie: 2 })
  end

  it 'somebody new takes the lowest free rung; somebody gone frees theirs' do
    input = base_input(now, config_json: cfg.(%w[Alpha Charlie Delta]))
    input['trmnl']['state'] = { 'lineSlots' => { 'Alpha' => 0, 'Bravo' => 1, 'Charlie' => 2 } }
    r = run_transform(net, now, input)
    assert_equal(slots_of.(r), { Alpha: 0, Charlie: 2, Delta: 1 })
    assert_equal(r['trmnl_state']['lineSlots'], { Alpha: 0, Charlie: 2, Delta: 1 })
  end

  it "a shared calendar's line takes no rung" do
    shared = JSON.generate(version: 1, lines: [{ name: 'Alpha' }, { name: 'Bravo' }],
                           calendars: [{ url: 'https://x.example/a.ics', line: 'Alpha' }, { url: 'https://x.example/b.ics', line: 'Bravo' },
                                       { url: 'https://x.example/c.ics', name: 'Family' }])
    r = run_transform(net, now, base_input(now, config_json: shared))
    s = slots_of.(r)
    assert_equal(s['Alpha'], 0)
    assert_equal(s['Bravo'], 1)
    assert(s['Family'].nil?, "the shared line took a rung: #{s['Family']}")
  end

  it 'junk in the saved rungs is dropped, not replayed' do
    input = base_input(now, config_json: cfg.(%w[Alpha Bravo]))
    input['trmnl']['state'] = { 'lineSlots' => { 'Alpha' => 'x', 'Bravo' => -3, '' => 2 } }
    r = run_transform(net, now, input)
    assert_equal(slots_of.(r), { Alpha: 0, Bravo: 1 })
  end
end
