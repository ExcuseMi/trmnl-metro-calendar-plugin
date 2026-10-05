# frozen_string_literal: true

# Timeouts. The serverless runtime kills a render that runs long, so the
# question every fetch in transform.js has to answer is not "how long am I
# allowed" but "how much of the render is left". One dead feed must cost
# its own events and nothing else; a slow one must not be able to spend
# time the runtime was never going to give us.
#
# Every case runs through `trmnlp test`, against the real three second budget:
# a mock server that really is slow (delay:, body_delay:), one that eats the
# clock as it answers (advance_clock:), and the runtime's own record of a
# request the transform gave up on (`aborted`).

require_relative '../support/transform'

RSpec.describe 'timeouts' do
  include Metro::Transform

  now = Time.iso8601('2026-09-09T09:00:00Z').to_i * 1000
  a = 'https://a.example.com/a.ics'
  b = 'https://b.example.com/b.ics'

  define_method(:ics_text) do |title|
    ics_with_events([
      { start: '20260909T140000Z', end: '20260909T150000Z', summary: title }
    ])
  end

  define_method(:two_calendars) do |extra = {}|
    base_input(now, {
      use_demo_data: 'false',
      config_json: JSON.generate({
        lines: [{ name: 'Alex' }, { name: 'Sam' }],
        calendars: [
          { url: a, name: 'Alex', rules: [{ match: { type: 'any' }, line: 'Alex' }] },
          { url: b, name: 'Sam', rules: [{ match: { type: 'any' }, line: 'Sam' }] }
        ]
      })
    }.merge(extra))
  end

  it 'every fetch carries an abort signal, so nothing can hang for ever' do
    # A fetch with no signal has no timeout at all: whatever the deadline
    # arithmetic says, the render sits on the socket until the runtime
    # kills it. This asserts the mechanism, not the arithmetic: every server
    # answers ten seconds late, and every request has to be given up (the
    # runtime records a request whose connection the transform closed as
    # `aborted`), inside the hosted five seconds.
    late = { delay: 10 }
    input = two_calendars(lat_lon: '51.05,3.72')
    input['trmnl']['user']['locale'] = 'fr-BE' # pulls in the language file too
    r = run_transform([otherwise(ics_text('Afternoon'), **late)], now, input)
    asked = requests_of(r)
    assert(asked.length >= 4, "expected the language file, the forecast and both feeds, saw #{asked.length}")
    asked.each { |q| assert(q['aborted'] == true, "not given up, so no abort signal on #{q['url']}") }
  end

  it 'one dead feed costs its own line, not the board' do
    r = run_transform([status(a, 404), otherwise(ics_text('Sam Time'))], now, two_calendars)
    titles = event_items(r['data']).map { it['title'] }
    assert(titles.include?('Sam Time'), "the healthy feed was lost with the dead one: #{titles.join(', ')}")
  end

  it 'a feed that eats the whole deadline does not get to spend the next one' do
    # The bug this is against: buildFromConfig used to start a FRESH 4.2s
    # deadline of its own, after the weather call had already spent up to
    # three seconds against run()'s. Two budgets, one runtime limit, and a
    # slow morning blew straight through it. There is one deadline now, so
    # a feed that arrives with nothing left of it is skipped rather than
    # being handed a new four seconds.
    #
    # Asked of the real runtime: the one request every feed waits on is the
    # demo's own config, and it answers having eaten five seconds of the
    # clock (advance_clock:). Every feed is then asked for with nothing left
    # of the one deadline, so none of them is fetched at all; given budgets
    # of their own, they would be.
    late = [['https://raw.githubusercontent.com/ExcuseMi/trmnl-metro-calendar-plugin/main/demo/*/config.json',
             { body: JSON.generate({ calendars: [{ url: a, name: 'Alex' }, { url: b, name: 'Sam' }] }), advance_clock: 5 }],
            otherwise(ics_text('Sam Time'))]
    r = run_transform(late, now, base_input(now, use_demo_data: 'true'))
    calls = requests_of(r).map { it['url'] }
    assert(calls.any? { |u| %r{/config\.json\z}.match?(u) }, "the demo config was never asked for: #{calls.join(', ')}")
    assert(!calls.include?(a) && !calls.include?(b), "a feed was fetched with no budget left: #{calls.join(', ')}")
    assert(r['data'], 'the render should still produce a board')
  end

  it 'a slow forecast does not hold the feeds back: they are all asked for at once' do
    # The language file, the forecast and the feeds were fetched one after
    # the other, so a forecast that took two seconds left the calendars one.
    #
    # Asked of the real runtime: the forecast answers four seconds late (it
    # is cut at the three second budget), the feeds at once. Fetched one
    # after the other, the feeds would be asked for with nothing left of the
    # budget and their events lost; fetched together, both are on the board.
    r = run_transform([
                        status(Metro::Transform::FORECAST, 503, delay: 4),
                        serve(a, ics_text('Alex Time')), serve(b, ics_text('Sam Time'))
                      ], now, two_calendars(lat_lon: '51.05,3.72'))
    calls = requests_of(r).map { it['url'] }
    feeds = calls.grep(/\.ics\z/)
    assert(feeds.length == 2, "the feeds waited for the forecast: #{calls.join(', ')}")
    titles = event_items(r['data']).map { it['title'] }.sort
    assert(titles.join(',') == 'Alex Time,Sam Time', "the feeds lost their events to the forecast: #{titles.join(', ')}")
  end

  it 'a feed that answers at once and then sends its body slowly is cut at the deadline' do
    # The timeout used to stop when the headers arrived, and the body had
    # all the time in the world. A's answer uses up all but a sliver of the
    # budget; B's headers come at once and its body never does.
    # Asked of the real runtime: A answers 2s in (a full second short of the
    # budget: closer than that, a busy machine lost A itself), B's headers come at
    # once and its body a minute later (body_delay:). The render has to end
    # at the three second budget, not wait for the body: under the 3800ms
    # the hard-stop case allows (the budget plus node's own start-up).
    r = run_transform([status(Metro::Transform::FORECAST, 503),
                       serve(a, ics_text('Alex Time'), delay: 2),
                       serve(b, ics_text('Sam Time'), body_delay: 60)], now, two_calendars)
    took = run_of(r).duration_ms
    assert(took < 3800, "the render waited on a body that never came: #{took}ms")
    titles = event_items(r['data']).map { it['title'] }
    assert(titles.include?('Alex Time'), "the feed that answered was lost: #{titles.join(', ')}")
  end
end
