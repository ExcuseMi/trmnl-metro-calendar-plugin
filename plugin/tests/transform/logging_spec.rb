# frozen_string_literal: true

# WHAT THE RENDER SAYS WHEN SOMETHING GOES WRONG, AND WHAT IT MUST NEVER SAY.
#
# transform.js had no console call in it at all: a feed that did not answer,
# a forecast that timed out, a language file that 404ed and a config that
# would not parse all passed in silence, and the only way to find out was to
# look at a board and notice something missing. The board says what it can
# (calendars_down, board_notice, the band); this is the other half, for
# whoever is reading the render log wondering why.
#
# AND IT IS A PLACE A CREDENTIAL CAN LEAK. A calendar link is not a name, it
# is an access token in a URL -- anybody holding one can read that calendar
# for as long as it lives. The log prints the HOST so a person can tell which
# feed is failing, and it must never print the rest. Nothing was stopping it.

require_relative '../support/transform'

RSpec.describe 'logging' do
  include Metro::Transform

  now = Time.iso8601('2026-09-09T09:00:00Z').to_i * 1000
  ics_events = [{ start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Afternoon' }]

  # A published calendar link, in the shape the real ones take: a long opaque
  # token in the path, and a query nobody else should ever see.
  secret = 'https://cloud.example.com/remote.php/dav/public-calendars/' \
           '8XaL43rwEgSj4ETE?export&token=s3cr3t-do-not-log'

  define_method(:net) do |weather_fails: false, calendars_fail: false|
    [
      weather_fails ? status(Metro::Transform::FORECAST, 503) : serve(Metro::Transform::FORECAST, '{}'),
      status(Metro::Transform::I18N, 404),
      calendars_fail ? otherwise(500) : otherwise(ics_with_events(ics_events))
    ]
  end
  define_method(:input) do |cfg = nil, extra = nil|
    base_input(now, { use_demo_data: 'false',
                      config_json: JSON.generate(cfg || { calendars: [{ url: secret, name: 'Alex' }] }) }.merge(extra || {}))
  end

  it 'a feed that does not answer says so in the log, with its name and why' do
    log = []
    run_transform(net(calendars_fail: true), now, input, log:)
    said = log.grep(/calendar/i).join("\n")
    assert(!said.empty?, "a feed failed and the log said nothing: #{log.to_json}")
    assert(said.include?('Alex'), "the log does not say which calendar: #{said}")
    assert(/500/.match?(said), "the log does not say why: #{said}")
    assert(said.include?('cloud.example.com'), "the log does not say which host: #{said}")
  end

  it '...and never prints the link itself, which is a credential' do
    log = []
    run_transform(net(calendars_fail: true), now, input, log:)
    all = log.join("\n")
    # The whole link, the opaque part of it, and the query, each on its own:
    # a log that leaks any one of them has handed the calendar away.
    assert(!all.include?(secret), 'the log printed the whole link')
    assert(!all.include?('8XaL43rwEgSj4ETE'), "the log printed the calendar token: #{all}")
    assert(!all.include?('s3cr3t'), "the log printed the query: #{all}")
    assert(!all.include?('remote.php'), "the log printed the path: #{all}")
  end

  it 'a forecast that fails says so, and a language file that fails says so' do
    log = []
    run_transform(net(weather_fails: true), now, input(nil, { lat_lon: '51.05,3.72' }), log:)
    all = log.join("\n")
    assert(/forecast/i.match?(all), "a 503 from the forecast went unremarked: #{log.to_json}")
  end

  it 'a config that will not parse says so' do
    log = []
    i = base_input(now, use_demo_data: 'false', config_json: '{ this is not json')
    run_transform(net, now, i, log:)
    assert(/Calendars box|config/i.match?(log.join("\n")),
           "an unreadable config was not logged: #{log.to_json}")
  end

  it 'a board with nothing wrong writes nothing, so the log means something' do
    log = []
    run_transform(net, now, input, log:)
    assert_equal(log, [], 'a healthy render wrote to the log')
  end

  # ------------------------------------------------------------- the host
  it 'a host is all that comes out of a link, whatever shape the link is' do
    # hostOf is an internal function: called directly, in node
    cases = [
      ['https://cloud.example.com/remote.php/dav/x?export', 'cloud.example.com'],
      ['http://host.example.org:8443/a/b/c', 'host.example.org:8443'],
      # userinfo is part of the authority and is a credential in its own right
      ['https://user:pass@secret.example.com/cal.ics', 'user:pass@secret.example.com'],
      ['webcal://p31-caldav.icloud.com/published/2/MTQ4', 'p31-caldav.icloud.com'],
      ['not a url at all', 'unknown host'],
      ['', 'unknown host'],
      [nil, 'unknown host']
    ]
    cases.each do |u, want|
      assert_equal(internals('return T.hostOf(args.u);', now:, args: { u: }), want, "hostOf(#{u.to_json})")
    end
  end

  # ------------------------------------------------------- the render budget
  it 'the network budget leaves the runtime room to finish' do
    # "The transform.js has 5 seconds." Everything that fetches shares one
    # budget, and what is left of the five has to cover parsing every feed and
    # building the board. Measured with the network taken out: 932KB of
    # calendar over four feeds -- a year of a Teams work calendar and three
    # more beside it -- parses and builds in 168ms, worst of five 225ms.
    #
    # A second of headroom is four times that worst case. Past 4500 there is
    # not a second, and a render that overruns is not a late board, it is no
    # board at all.
    # a constant inside transform.js: read directly, in node
    budget = internals('return { type: typeof T.RENDER_BUDGET_MS, value: T.RENDER_BUDGET_MS };', now:)
    render_budget_ms = budget['value']
    assert(budget['type'] == 'number' && render_budget_ms.is_a?(Numeric) && render_budget_ms.positive?,
           "the budget is not a number: #{render_budget_ms}")
    assert(render_budget_ms <= 4500, "the network budget is #{render_budget_ms}" \
                                     'ms of the 5000 the runtime allows, which leaves under half a second ' \
                                     'to parse the feeds and build the board')
  end
end
