# frozen_string_literal: true

# THE SAME FEEDS, THE SAME BOARD, WHICHEVER ANSWERS FIRST.
#
# The feeds are fetched together, and each one's events used to be put on
# the board as its answer arrived; the list was then sorted by start minute
# alone. So two events in the same minute came out in whichever order the
# network answered -- and so did the lines themselves, which are registered
# as their first event is read. Found by comparing the squeezed transform
# with the source on the demo: same input, same code, a different payload.
# These answer the feeds in both orders and ask for one answer.

require_relative '../support/transform'

RSpec.describe 'order' do
  include Metro::Transform

  now = Time.iso8601('2026-09-09T09:00:00Z').to_i * 1000
  a = 'https://a.example.com/a.ics'
  b = 'https://b.example.com/b.ics'
  c = 'https://c.example.com/c.ics'
  define_method(:at) { |title| ics_with_events([{ start: '20260909T140000Z', end: '20260909T150000Z', summary: title }]) }
  define_method(:input) do
    base_input(now, config_json: JSON.generate(calendars: [
      { url: a, name: 'Ann' }, { url: b, name: 'Ben' }, { url: c, name: 'Cy' }
    ]))
  end
  # `slow` answers 400ms late, the rest at once
  define_method(:net) do |slow|
    [status(Metro::Transform::FORECAST, 503), status(Metro::Transform::I18N, 404)] + [[a, 'Dentist'], [b, 'Swim'], [c, 'Piano']]
      .map { |u, t| serve(u, at(t), **(u == slow ? { delay: 0.4 } : {})) }
  end

  it 'events in the same minute, and the lines, come out in the order the config names the calendars' do
    runs = []
    [a, b, c].each { |slow| runs.push(run_transform(net(slow), now, input)) }
    shape = lambda do |r|
      { events: r['data']['events'].map { |e| [e['title'], e['owner'], e['start_min']] },
        legend: r['data']['legend'].map { |l| [l['key'], l['name']] } }
    end
    assert_equal(shape.(runs[0])[:events].map { |e| e[0] }, %w[Dentist Swim Piano], 'the order of the config')
    assert_equal(shape.(runs[1]), shape.(runs[0]), 'with the second feed answering last')
    assert_equal(shape.(runs[2]), shape.(runs[0]), 'with the third feed answering last')
  end
end
