# frozen_string_literal: true

# The weather banner: metro.service_alert, or null.
#
# The banner is one line along the bottom edge and the template only
# prints it, so everything that could be wrong about it has to be wrong
# HERE: which breach wins when a day trips several, when the weather starts
# and when it ends, what unit a threshold was read in, which language the
# line came out in, and whether the alert cost the render a second call to
# the forecast API.
#
# The shape is deliberately { kind, icon, text, parts } or NULL. Null is
# what lets the template collapse the band and hand the space back to the
# map, so "no alert" must never arrive as an empty string or an object with
# a blank text.

require_relative '../support/transform'

RSpec.describe 'service-alert' do
  include Metro::Transform

  i18n_dir = File.join(Metro::ROOT, 'i18n')
  forecast_url = Metro::Transform::FORECAST
  i18n_url = Metro::Transform::I18N
  # the helpers are instance methods; this is one to call at describe level
  helpers = Object.new.extend(Metro::Transform)

  now = Time.iso8601('2026-09-09T09:00:00Z').to_i * 1000
  now_s = now / 1000
  ics = helpers.ics_with_events([{ start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Afternoon' }])

  # Hours across the visible day. The wettest one is 17:00, which is the
  # hour in the copy the alert lines were written against.
  hours = []
  probs = []
  (7..21).each do |hh|
    hours.push("2026-09-09T#{hh.to_s.rjust(2, '0')}:00")
    probs.push(if hh == 17 then 80 else (hh == 16 ? 30 : 5) end)
  end

  # A forecast in the shape Open-Meteo answers with. `code` drives the
  # condition bucket (71 is snow, 61 rain, 0 clear); hi/lo are whatever the
  # API was asked for, which is always the board's own unit. `codes` is the
  # hourly weathercode, left out by default: that is the shape an older
  # build saved, and the banner has to keep reading it.
  forecast = lambda do |o = nil|
    o ||= {}
    JSON.generate(
      daily: {
        temperature_2m_max: [o[:hi].nil? ? 18 : o[:hi]],
        temperature_2m_min: [o[:lo].nil? ? 11 : o[:lo]],
        precipitation_probability_max: [o[:max].nil? ? 80 : o[:max]],
        weathercode: [o[:code].nil? ? 61 : o[:code]],
        sunrise: ['2026-09-09T06:30'], sunset: ['2026-09-09T20:30']
      },
      hourly: { time: hours, precipitation_probability: o[:probs] || probs }
        .merge(o[:codes] ? { weathercode: o[:codes] } : {})
    )
  end

  # What the banner says, in the shape the template gets.
  #
  # `parts` -- the same sentence split for the banner to set in three weights
  # -- is left out of these and asserted on its own below. Every one of these
  # cases is about WHICH banner and WHAT it says; repeating the split in each
  # expected object would be writing `segments` out thirteen more times and
  # testing it against itself.
  without = ->(a) { a.is_a?(Hash) ? a.except('parts') : a }
  icon_base = 'https://trmnl.com/images/plugins/weather/'
  alert = ->(kind, text, icon) { { kind: kind, icon: icon_base + icon, text: text } }

  # Every board here is a real one (not the demo): a location, one calendar,
  # and whatever alert settings the case is about.
  define_method(:net) do |body, i18n_text = nil|
    [
      body.nil? ? status(forecast_url, 500) : serve(forecast_url, body),
      i18n_text.nil? ? status(i18n_url, 404) : serve(i18n_url, i18n_text),
      otherwise(ics)
    ]
  end

  # `state` left out is a board with no saved state at all (the JS `undefined`).
  unset = Object.new
  define_method(:input) do |fields, locale = nil, state = unset, over = nil|
    i = base_input(now, {
      use_demo_data: 'false',
      lat_lon: '51.05,3.72',
      config_json: JSON.generate(calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }])
    }.merge(fields, over || {}))
    i['trmnl']['user']['locale'] = locale unless locale.to_s.empty?
    i['trmnl']['state'] = state unless state.equal?(unset)
    i
  end

  on = { alert_enabled: 'true', alert_rain_threshold: '70' }

  # ----------------------------------------------------------- the twilight
  #
  # Sunset is one minute -- the instant the sun's upper limb crosses the
  # horizon -- so the board was going from daylight to night between two
  # pixels. What a household reads as "getting dark" is civil twilight, and
  # the forecast carries none: Open-Meteo's daily block is sunrise, sunset,
  # daylight_duration and sunshine_duration. It is astronomy, so it is worked
  # out here from the two things the board already has.
  it 'how long dusk lasts is computed for the place and the day, not assumed' do
    r = run_transform(net(forecast.call), now, input(on))
    d = (r['data']['days'] || [])[0]
    assert(d && d['weather'], 'no weather on the first day')
    assert(d['weather']['twilight_min'].is_a?(Numeric) && d['weather']['twilight_min'] > 0,
           "the board was told nothing about dusk: #{d['weather']['twilight_min'].to_json}")
    # 51N in September: a little over half an hour, and nothing like the
    # twenty minutes it would be on the equator or the two hours it would be
    # in Shetland in June.
    assert(d['weather']['twilight_min'] > 25 && d['weather']['twilight_min'] < 45,
           "dusk at 51 degrees north in September came out as #{d['weather']['twilight_min']} minutes")
  end

  it '...and it follows the latitude, which is the whole point of computing it' do
    dusk_at = lambda do |lat_lon, at_time|
      r = run_transform(net(forecast.call), ms(at_time), input(on, nil, unset, { lat_lon: lat_lon }))
      ((r['data']['days'] || [])[0] || {})['weather']['twilight_min']
    end
    equator = dusk_at.call('-0.2,-78.5', '2026-09-09T09:00:00Z')
    far = dusk_at.call('60.15,-1.15', '2026-09-09T09:00:00Z')
    assert(equator < far - 5, "dusk on the equator (#{equator}) is not shorter than dusk " \
                              "at sixty north (#{far}), so the latitude is not reaching the sum")
  end

  it 'no alert settings, no banner: service_alert is null' do
    # The field must exist and be null rather than be absent, so the
    # template has one thing to test rather than two.
    r = run_transform(net(forecast.call), now, input({}))
    assert(r['data'].key?('service_alert'), 'the payload has no service_alert key at all')
    assert_equal(r['data']['service_alert'], nil, 'an unconfigured board raised an alert')
  end

  it 'the banner is off until it is turned on, on a day that breaches everything' do
    # Thresholds filled in but the switch left alone: an alert nobody asked
    # for is an alert nobody trusts.
    r = run_transform(net(forecast.call(code: 71, hi: -2, lo: -9)), now,
                      input({ alert_rain_threshold: '10', alert_temp_low: '0' }))
    assert_equal(r['data']['service_alert'], nil, 'a board with alert_enabled unset raised an alert')
  end

  it 'rain over the threshold is the banner: when it starts, when it ends, and how likely' do
    r = run_transform(net(forecast.call), now, input(on))
    assert_equal(without.call(r['data']['service_alert']),
                 alert.call('rain', 'Rain from 17:00 until 18:00 (80%)', 'wi-rain.svg'),
                 'the English rain banner')
  end

  # ---------------------------------------------------- the banner, in pieces
  #
  # "Rain from 16:00 until 20:00 (96%)" is one line doing three jobs:
  # what is coming, when, and how sure. At one weight a reader has to read all
  # of it to find the part they wanted.
  it 'the banner comes in pieces: the thing bold, the clock quiet' do
    parts = run_transform(net(forecast.call), now, input(on))['data']['service_alert']['parts']
    assert(parts.is_a?(Array) && !parts.empty?, "no parts: #{parts.to_json}")
    # the pieces put back together are exactly the sentence
    assert_equal(parts.map { |p| p['t'] }.join, 'Rain from 17:00 until 18:00 (80%)',
                 'the pieces do not spell the line')
    bold = parts.select { |p| p['s'] == 'b' }.map { |p| p['t'] }
    lit = parts.select { |p| p['s'] == '' }.map { |p| p['t'] }.join(' ')
    quiet = parts.select { |p| p['s'] == 'q' }.map { |p| p['t'] }.join(' ')
    # what is coming, in bold: the one word that decides whether the rest is
    # worth reading. It was a badge for a while -- `.metro-pill`, the board's
    # own, white with the word knocked out of it -- and read as a button in a
    # line of running text.
    assert_equal(bold, ['Rain'], 'the thing itself is not the bold one')
    # the clocks are what a reader scans a weather line for, so they stay lit
    assert(lit.include?('17:00') && lit.include?('18:00'),
           "the clocks went quiet: #{parts.to_json}")
    # and the sentence holding them together does not compete, the
    # probability included: 80% or 96%, it is raining either way
    assert(quiet.include?('from') && quiet.include?('until'),
           "the joining words are not quiet: #{quiet}")
    assert(quiet.include?('(80%)'),
           "the probability is not quiet, or lost its brackets: #{quiet}")
  end

  it 'a temperature keeps its degree and its unit in one piece' do
    # `{v}\u00b0{u}` puts the degree sign in the literal text between two
    # placeholders, so styling the placeholders alone gives "-6" bold,
    # "\u00b0" plain and "C" bold again.
    parts = run_transform(net(forecast.call(hi: 1, lo: -6)), now,
                          input({ alert_temp_low: '-5' }.merge(on)))['data']['service_alert']['parts']
    bold = parts.select { |p| p['s'] == 'b' }.map { |p| p['t'] }
    # The word the sentence opens with is bold too -- it is the thing itself,
    # the same as `Rain` in a spell -- so the degree is the second of two.
    assert_equal(bold, ['Freezing', "-6°C"],
                 "wanted the thing and its degree, each in one piece: #{parts.to_json}")
  end

  # ------------------------------------------ the until, when it is not a clock
  #
  # "Rain from 7pm into the night (92%)", with "into the night" the same grey
  # as "from". Asked directly: "that's the until so it should be white". Two
  # of the five spell sentences end in words rather than in a time, and those
  # words answer the question a reader scans the line for, so they are lit the
  # way the clocks are. They are their own i18n key now, which is what lets
  # them be a placeholder rather than part of the sentence.
  it 'a spell that ends in words lights the words, the way it lights a clock' do
    # Wet from 17:00 to the last hour there is, read before it starts.
    r = run_transform(net(forecast.call(probs: probs.each_index.map { |k| k >= 10 ? 90 : 5 })), now, input(on))
    a = r['data']['service_alert']
    assert_equal(a['text'], 'Rain from 17:00 into the night (90%)', 'the sentence')
    lit = a['parts'].select { |p| p['s'] == '' }.map { |p| p['t'] }
    assert_equal(lit, ['17:00', 'into the night'],
                 "the until is not lit with the clock: #{a['parts'].to_json}")
  end

  it '...and so does one that has already started and runs to the end' do
    r = run_transform(net(forecast.call(probs: probs.map { 90 })),
                      ms('2026-09-09T15:30:00Z'), input(on, nil, unset))
    a = r['data']['service_alert']
    assert_equal(a['text'], 'Rain for the rest of the day (90%)', 'the sentence')
    assert_equal(a['parts'].select { |p| p['s'] == '' }.map { |p| p['t'] }, ['for the rest of the day'],
                 "the until is not lit: #{a['parts'].to_json}")
  end

  it 'a day that stays under the threshold gets no banner' do
    # 80% is the wettest hour; asked for 90 it is not an alert, and the
    # band has to disappear rather than say "Rain (80%)".
    r = run_transform(net(forecast.call), now, input({ alert_enabled: 'true', alert_rain_threshold: '90' }))
    assert_equal(r['data']['service_alert'], nil, "got #{r['data']['service_alert'].to_json}")
  end

  it 'a blank rain threshold is off, not zero' do
    # Read as 0 an empty "rain chance" field would fire on every dry day.
    # The form fills in 70, so an empty one is somebody who emptied it.
    r = run_transform(net(forecast.call), now, input({ alert_enabled: 'true', alert_rain_threshold: '' }))
    assert_equal(r['data']['service_alert'], nil, 'an emptied rain field alerted on an 80% hour')
  end

  it 'snow outranks rain: one banner, and it names the thing that stops the day' do
    r = run_transform(net(forecast.call(code: 71, hi: 1, lo: -3)), now, input(on))
    assert_equal(without.call(r['data']['service_alert']),
                 alert.call('snow', 'Snow from 17:00 until 18:00 (80%)', 'wi-snow.svg'),
                 'a snowy day with rain over the threshold should read as snow')
  end

  it 'snow needs no setting: it alerts with the rain field emptied' do
    # Nobody knows what snow threshold they want, so there is no switch
    # or number for it: snow that is likely is an alert.
    r = run_transform(net(forecast.call(code: 71, hi: 4, lo: 1)), now,
                      input({ alert_enabled: 'true', alert_rain_threshold: '' }))
    assert_equal((r['data']['service_alert'] || {})['kind'], 'snow', "got #{r['data']['service_alert'].to_json}")
  end

  # ---------------------------------------------------------------- combined
  #
  # ONE BANNER, AND WHICH ONE IS A RULE, NOT AN ACCIDENT OF ARRAY ORDER.
  #
  # A real winter day breaches several of these at once -- freezing, and
  # snowing, and over the rain line -- and until these cases the ranking
  # between them was only ever asserted a pair at a time, against rain. The
  # order is how much of the day has to change because of it: ice, snow,
  # storms, then the temperature, then rain.

  it 'a day that breaches everything raises the one that takes the road away' do
    # Freezing rain, under a freezing sky, over the rain line, with the
    # temperature field set so cold breaches too. Every rule in the ladder
    # fires and the reader gets the top of it.
    codes = hours.each_index.map { |i| i + 7 == 17 ? 67 : 3 }
    r = run_transform(net(forecast.call(code: 67, hi: 1, lo: -6, codes: codes)), now,
                      input({ alert_temp_low: '0' }.merge(on)))
    assert_equal(without.call(r['data']['service_alert']),
                 alert.call('ice', 'Freezing rain from 17:00 until 18:00 (80%)', 'wi-sleet.svg'),
                 'a freezing, icy, wet day should name the ice')
  end

  it 'freezing rain is not rain: it alerts with the rain field emptied' do
    # 66 and 67 sat inside the rain bucket, so a black-ice morning said
    # "Rain", and only if a threshold had been set and crossed. It says
    # itself now, the way snow does.
    codes = hours.each_index.map { |i| i + 7 == 17 ? 66 : 3 }
    r = run_transform(net(forecast.call(code: 66, hi: 2, lo: -1, codes: codes)), now,
                      input({ alert_enabled: 'true', alert_rain_threshold: '' }))
    assert_equal((r['data']['service_alert'] || {})['kind'], 'ice',
                 "got #{r['data']['service_alert'].to_json}")
  end

  it 'freezing drizzle is ice too, and outranks the snow behind it' do
    codes = hours.each_index.map { |i| i + 7 == 17 ? 57 : 71 }
    r = run_transform(net(forecast.call(code: 57, hi: 0, lo: -4, codes: codes)), now, input(on))
    assert_equal(r['data']['service_alert']['kind'], 'ice', 'freezing drizzle should be ice')
  end

  it 'snow outranks a freezing day: the sky before the thermometer' do
    # Both true, and only one banner. Snow is a thing happening that you can
    # see out of the window; "Freezing, down to -9" is the same day said
    # less usefully.
    r = run_transform(net(forecast.call(code: 71, hi: -2, lo: -9)), now, input({ alert_temp_low: '0' }.merge(on)))
    assert_equal((r['data']['service_alert'] || {})['kind'], 'snow',
                 "a freezing snowy day should say snow: #{r['data']['service_alert'].to_json}")
  end

  it 'snow outranks thunderstorms' do
    codes = hours.each_index.map { |i| i + 7 == 17 ? 71 : (i + 7 == 18 ? 95 : 3) }
    wet = probs.each_with_index.map { |p, i| i + 7 == 17 || i + 7 == 18 ? 80 : p }
    r = run_transform(net(forecast.call(code: 71, codes: codes, probs: wet)), now, input(on))
    assert_equal(r['data']['service_alert']['kind'], 'snow',
                 'snow and storms in one day should read as snow')
  end

  it 'hail arrives as thunderstorms, which is what it comes with' do
    # WMO has no code for hail on its own: 96 and 99 are a thunderstorm WITH
    # hail, so that is what the banner can honestly say.
    [96, 99].each do |code|
      codes = hours.each_index.map { |i| i + 7 == 17 ? code : 3 }
      r = run_transform(net(forecast.call(code: code, codes: codes)), now, input(on))
      assert_equal(r['data']['service_alert']['kind'], 'storms', "code #{code}")
    end
  end

  it 'cold and heat carry the temperature, and outrank rain' do
    cold = run_transform(net(forecast.call(hi: 1, lo: -6)), now,
                         input({ alert_temp_low: '-5' }.merge(on)))
    assert_equal(without.call(cold['data']['service_alert']),
                 alert.call('cold', 'Freezing, down to -6°C', 'wi-snowflake-cold.svg'), 'the cold banner')

    heat = run_transform(net(forecast.call(hi: 36, lo: 24)), now,
                         input({ alert_temp_high: '35' }.merge(on)))
    assert_equal(without.call(heat['data']['service_alert']),
                 alert.call('heat', 'Hot, up to 36°C', 'wi-hot.svg'), 'the heat banner')
  end

  it 'cold above freezing is called cold, not freezing' do
    # A reader who set the line at 5 is told it is cold. "Freezing, down to
    # 3" would be a wrong statement about the one number on the banner.
    r = run_transform(net(forecast.call(hi: 9, lo: 3)), now,
                      input({ alert_temp_low: '5' }.merge(on)))
    assert_equal(without.call(r['data']['service_alert']),
                 alert.call('cold', 'Cold, down to 3°C', 'wi-snowflake-cold.svg'),
                 "got #{r['data']['service_alert'].to_json}")
  end

  # "I wouldn't even know what temps I want to be alerted at." Blank cold
  # and heat fields are not off: they are a frost and a hot day in the
  # board's own unit, so the banner is useful before anyone has thought
  # about temperatures at all. Each is the line itself (fires) and one
  # degree short of it (does not).
  defaults = [
    { unit: 'c', at: { lo: 0 }, short: { lo: 1 }, kind: 'cold', text: 'Freezing, down to 0°C' },
    { unit: 'f', at: { lo: 32 }, short: { lo: 33 }, kind: 'cold', text: 'Freezing, down to 32°F' },
    { unit: 'c', at: { hi: 30 }, short: { hi: 29 }, kind: 'heat', text: 'Hot, up to 30°C' },
    { unit: 'f', at: { hi: 86 }, short: { hi: 85 }, kind: 'heat', text: 'Hot, up to 86°F' }
  ]
  defaults.each do |d|
    it "a blank #{d[:kind]} field alerts at the default for #{d[:unit].upcase}" do
      mild = d[:unit] == 'f' ? { hi: 70, lo: 55 } : { hi: 21, lo: 13 }
      dry = { probs: probs.map { 5 }, max: 5 }
      fields = { alert_enabled: 'true', temperature_unit: d[:unit], alert_temp_low: '', alert_temp_high: '' }
      hit = run_transform(net(forecast.call(dry.merge(mild, d[:at]))), now, input(fields))
      assert_equal((hit['data']['service_alert'] || {})['text'], d[:text],
                   "got #{hit['data']['service_alert'].to_json}")
      assert_equal((hit['data']['service_alert'] || {})['kind'], d[:kind], 'the kind')
      miss = run_transform(net(forecast.call(dry.merge(mild, d[:short]))), now, input(fields))
      assert_equal(miss['data']['service_alert'], nil, 'a degree short of the default alerted: ' \
                                                       "#{miss['data']['service_alert'].to_json}")
    end
  end

  it 'a filled-in temperature field overrides the default' do
    # -2 is under the default frost line; asked for -5 it is not an alert.
    r = run_transform(net(forecast.call(hi: 8, lo: -2, probs: probs.map { 5 })), now,
                      input({ alert_enabled: 'true', alert_temp_low: '-5' }))
    assert_equal(r['data']['service_alert'], nil, "got #{r['data']['service_alert'].to_json}")
  end

  it 'a temperature threshold is read in the unit the board is showing' do
    # ONE day (a low of 18C, which is 64F) and one threshold, "20". On a
    # Celsius board that is a cold morning; on a Fahrenheit board 20 is
    # -7C and nothing like it. The forecast is fetched in the board's own
    # unit (the API converts), so the way this goes wrong is comparing the
    # reader's number against the other scale.
    same_day = [
      # a regex mock is matched against the whole URL, query included
      [%r{\Ahttps://api\.open-meteo\.com/.*temperature_unit=fahrenheit}, { body: forecast.call(hi: 81, lo: 64) }],
      serve(forecast_url, forecast.call(hi: 27, lo: 18)),
      otherwise(ics)
    ]
    no_rain = on.merge(alert_rain_threshold: '', alert_temp_low: '20')

    c = run_transform(same_day, now, input({ temperature_unit: 'c' }.merge(no_rain)))
    assert_equal(without.call(c['data']['service_alert']),
                 alert.call('cold', 'Cold, down to 18°C', 'wi-snowflake-cold.svg'),
                 '18C is at or below a threshold of 20 on a Celsius board')

    f = run_transform(same_day, now, input({ temperature_unit: 'f' }.merge(no_rain)))
    assert_equal(f['data']['service_alert'], nil,
                 "64F is nowhere near a threshold of 20 on a Fahrenheit board: #{f['data']['service_alert'].to_json}")
  end

  it 'a snapshot saved in one unit is compared in the unit the board now shows' do
    # Saved state outlives the temperature setting. A -6C snapshot replayed
    # on a board switched to Fahrenheit is a 21F day, and "cold at or below
    # 25" has to fire on it.
    good = run_transform(net(forecast.call(hi: 1, lo: -6)), now, input({ temperature_unit: 'c' }.merge(on)))
    saved = deep_copy(good['trmnl_state'])
    assert_equal(saved['weather']['unit'], 'C', 'the snapshot should record the unit it was fetched in')

    later = run_transform(net(nil), now,
                          input({ temperature_unit: 'f', alert_temp_low: '25', alert_rain_threshold: '' }.merge(on),
                                nil, saved))
    assert_equal(without.call(later['data']['service_alert']),
                 alert.call('cold', 'Freezing, down to 21°F', 'wi-snowflake-cold.svg'),
                 "got #{later['data']['service_alert'].to_json}")
  end

  it 'the alert costs the render no extra network call' do
    # It reads the forecast that was already fetched. A second call would
    # come out of the same shared deadline the calendars are spending.
    r = run_transform(net(forecast.call), now, input(on))
    assert(r['data']['service_alert'], 'no alert to weigh')
    assert_equal(requests_of(r).map { |q| q['url'] }.select { |u| u.include?('api.open-meteo.com') }.length, 1,
                 'the forecast API was called more than once')
  end

  it 'a board running on the last good forecast still raises its alert' do
    # The API is down, the board is showing the snapshot out of saved
    # state, and that is exactly the day you want to be told it will rain.
    good = run_transform(net(forecast.call), now, input(on))
    saved = deep_copy(good['trmnl_state'])
    assert(saved['weather'] && saved['weather']['peak'], "the wettest hour was not saved: #{saved['weather'].to_json}")

    later = run_transform(net(nil), now, input(on, nil, saved))
    assert_equal((later['data']['service_alert'] || {})['text'], 'Rain from 17:00 until 18:00 (80%)',
                 "got #{later['data']['service_alert'].to_json}")
  end

  it 'a saved snapshot from a build that had no wettest hour does not invent one' do
    # Older state carries no `peak`. An alert that made an hour up would be
    # a time on the wall nobody's forecast ever said.
    saved = { 'weather' => { 'hi' => 18, 'lo' => 11, 'condition' => 'rain', 'icon' => 'wi-day-rain.svg',
                             'rain_chance' => 80, 'unit' => 'C' },
              'weatherFetchedAt' => now_s - 600 }
    r = run_transform(net(nil), now, input(on, nil, saved))
    assert_equal(r['data']['service_alert'], nil, "got #{r['data']['service_alert'].to_json}")
  end

  # The exact copy, per language, from the files this repo actually ships,
  # served through the actual fetch path: a spell of rain with both ends, one that has already started, snow to the end of the day,
  # and the frost line. A translator reordering the times and the
  # percentage is fine, losing one of them is not (see i18n-files.js).
  # English is here too, so all five are read the same way. NB is the
  # no-break space French and German put before a percent sign, so "80"
  # and "%" never land on two lines of a wrapped banner.
  nb = [0xa0].pack('U')
  copy = {
    'en' => { ahead: 'Rain from 17:00 until 18:00 (80%)',
              started: 'Rain until 16:00 (85%)', snow: 'Snow for the rest of the day (90%)',
              cold: 'Freezing, down to -3°C' },
    'de' => { ahead: "Regen von 17:00 bis 18:00 (80#{nb}%)",
              started: "Regen bis 16:00 (85#{nb}%)",
              snow: "Schnee für den Rest des Tages (90#{nb}%)", cold: 'Frost, Tiefstwert -3°C' },
    'es' => { ahead: 'Lluvia de 17:00 a 18:00 (80%)',
              started: 'Lluvia hasta las 16:00 (85%)',
              snow: 'Nieve el resto del día (90%)', cold: 'Heladas, mínima de -3°C' },
    'fr' => { ahead: "Pluie de 17:00 à 18:00 (80#{nb}%)",
              started: "Pluie jusqu'à 16:00 (85#{nb}%)",
              snow: "Neige jusqu'à la fin de la journée (90#{nb}%)", cold: 'Gel, minimum -3°C' },
    'nl' => { ahead: 'Regen van 17:00 tot 18:00 (80%)',
              started: 'Regen tot 16:00 (85%)',
              snow: 'Sneeuw de rest van de dag (90%)', cold: 'Vorst, minimum -3°C' }
  }

  copy.each_key do |lang|
    it "the #{lang} banner reads as it was written" do
      table = lang == 'en' ? nil : File.read(File.join(i18n_dir, "#{lang}.json"), encoding: 'UTF-8')
      loc = lang == 'en' ? 'en-GB' : "#{lang}-#{lang.upcase}"
      got = lambda do |at_ms, body|
        i = input(on, loc)
        i['trmnl']['system']['timestamp_utc'] = at_ms / 1000
        r = run_transform(net(body, table), at_ms, i)
        r['data']['service_alert'] || {}
      end
      want = copy[lang]

      ahead = got.call(now, forecast.call)
      assert_equal(ahead['text'], want[:ahead], "#{lang}: a spell still ahead")

      # 15:30, inside the 15:00 hour
      started = got.call(ms('2026-09-09T15:30:00Z'),
                         forecast.call(probs: hours.each_index.map { |k| k == 8 ? 85 : 5 }))
      assert_equal(started['text'], want[:started], "#{lang}: a spell that has started")

      # 17:00 to the last hour, 21:00, read at 17:30
      snow = got.call(ms('2026-09-09T17:30:00Z'),
                      forecast.call(code: 71, probs: hours.each_index.map { |k| k >= 10 ? 90 : 5 },
                                    codes: hours.map { 73 }))
      assert_equal(snow['text'], want[:snow], "#{lang}: snow to the end of the day")

      cold = got.call(now, forecast.call(hi: 4, lo: -3, probs: hours.map { 5 }))
      assert_equal(cold['text'], want[:cold], "#{lang}: the frost line")
    end
  end

  it 'an unreachable language file leaves an English banner, not a broken one' do
    # Same rule the rest of the strings follow: a board in English is a
    # board, a board with "alert_rain" printed on it is not.
    r = run_transform(net(forecast.call, nil), now, input(on, 'fr-FR'))
    assert_equal(without.call(r['data']['service_alert']),
                 alert.call('rain', 'Rain from 17:00 until 18:00 (80%)', 'wi-rain.svg'),
                 "got #{r['data']['service_alert'].to_json}")
  end

  it 'the banner follows the 12-hour setting like every other time on the board' do
    r = run_transform(net(forecast.call), now, input({ time_format: '12h' }.merge(on)))
    assert_equal((r['data']['service_alert'] || {})['text'], 'Rain from 5pm until 6pm (80%)',
                 "got #{r['data']['service_alert'].to_json}")
  end

  it 'a board with no location cannot raise an alert' do
    # Nothing to forecast against. Before service_alert was null-by-default
    # this is the case that would have shipped a banner with a blank in it.
    r = run_transform(net(forecast.call), now, input({ lat_lon: '' }.merge(on)))
    assert_equal(r['data']['service_alert'], nil, "got #{r['data']['service_alert'].to_json}")
  end

  it 'a demo board can show the banner without waiting for real weather' do
    # The demo carries its own forecast (see demo-weather.js) so every part
    # of the map can be seen before anyone has set a location. The banner
    # is part of the map.
    r = run_transform([otherwise(500)], now,
                      base_input(now, use_demo_data: 'true', demo_set: 'friends', alert_enabled: 'true',
                                      alert_temp_low: '0'))
    assert_equal(without.call(r['data']['service_alert']),
                 alert.call('snow', 'Snow from 15:00 until 17:00 (80%)', 'wi-snow.svg'),
                 "the freezing demo board should demonstrate the banner: #{r['data']['service_alert'].to_json}")
  end

  # -------------------------------------------------------------------
  # Nothing in the past.
  #
  # A service alert is a promise about what is COMING. "Rain from 09:00
  # until 10:00" read at seven in the evening is not a warning, it
  # is a wrong statement about a morning everyone already lived through,
  # and it is the easiest banner in the world to ship by accident: the
  # wettest hour of the day is a fact that stops changing at noon, while
  # the board keeps redrawing until midnight.
  #
  # Three ways it happens, all covered below. The forecast is fetched
  # once and read for hours (a board on saved state can be reading one
  # from this morning). The forecast covers the whole run of days, so the
  # wettest hour in the response may belong to a day that is not on the
  # board. And the board can be showing TOMORROW, where every hour is
  # still ahead and today's are all behind.
  # -------------------------------------------------------------------

  # Hours 07:00-21:00 of one date, `by` giving the probability of any
  # hour that is not the quiet 5%.
  hours_for = lambda do |date, by|
    t = []
    p = []
    (7..21).each do |hh|
      t.push("#{date}T#{hh.to_s.rjust(2, '0')}:00")
      p.push((by || {})[hh].nil? ? 5 : by[hh])
    end
    { t: t, p: p }
  end

  # The shape a DAY_SPAN board asks for: daily arrays with one entry per
  # day of the run, one hourly array running across all of them. `codes`
  # is a day's hourly weathercode by hour, anything not named a 3
  # (overcast); with no day carrying any, the codes are left out entirely.
  forecast_days = lambda do |days|
    t = []
    p = []
    c = []
    g = []
    any_codes = days.any? { |d| d[:codes] }
    # `degs` is a day's hourly temperature by hour, the rest of the day
    # filled in from `fill` (or the day's own low). A day with none is a
    # forecast that answered without them, which is the fallback path.
    any_degs = days.any? { |d| d[:degs] }
    days.each do |d|
      h = hours_for.call(d[:date], d[:by])
      t.push(*h[:t])
      p.push(*h[:p])
      (7..21).each { |hh| c.push(d[:codes] && !d[:codes][hh].nil? ? d[:codes][hh] : 3) }
      (7..21).each do |hh|
        g.push(if d[:degs] && !d[:degs][hh].nil? then d[:degs][hh]
               else (d[:fill].nil? ? (d[:lo].nil? ? 11 : d[:lo]) : d[:fill])
               end)
      end
    end
    JSON.generate(
      daily: {
        temperature_2m_max: days.map { |d| d[:hi].nil? ? 18 : d[:hi] },
        temperature_2m_min: days.map { |d| d[:lo].nil? ? 11 : d[:lo] },
        precipitation_probability_max: days.map { |d| d[:max].nil? ? 80 : d[:max] },
        weathercode: days.map { |d| d[:code].nil? ? 61 : d[:code] },
        sunrise: days.map { |d| "#{d[:date]}T06:30" }, sunset: days.map { |d| "#{d[:date]}T20:30" }
      },
      hourly: { time: t, precipitation_probability: p }
        .merge(any_codes ? { weathercode: c } : {}, any_degs ? { temperature_2m: g } : {})
    )
  end

  d0 = '2026-09-09'
  d1 = '2026-09-10'
  both_days = helpers.ics_with_events([
                                        { start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Afternoon' },
                                        { start: '20260910T140000Z', end: '20260910T150000Z',
                                          summary: 'Tomorrow afternoon' }
                                      ])

  define_method(:net_at) do |body, i18n_text = nil|
    [
      body.nil? ? status(forecast_url, 500) : serve(forecast_url, body),
      i18n_text.nil? ? status(i18n_url, 404) : serve(i18n_url, i18n_text),
      otherwise(both_days)
    ]
  end

  define_method(:at) do |hh, mm = nil|
    ms("2026-09-09T#{hh.to_s.rjust(2, '0')}:#{mm.nil? ? '00' : mm}:00Z")
  end

  define_method(:input_at) do |at_ms, fields|
    base_input(at_ms, {
      use_demo_data: 'false',
      lat_lon: '51.05,3.72',
      config_json: JSON.generate(calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }])
    }.merge(fields))
  end

  define_method(:alert_at) do |at_ms, body, fields = nil, lang = nil|
    i = input_at(at_ms, on.merge(fields || {}))
    i['trmnl']['user']['locale'] = lang[:code] if lang
    mocks = net_at(body, lang ? lang[:text] : nil)
    r = run_transform(mocks, at_ms, i)
    r['data']['service_alert']
  end

  it 'the wettest hour of the day is not an alert once it has gone' do
    # 09:00 was the wet hour, it is now 15:00, and nothing later comes
    # near the threshold. There is no alert to raise: the day the reader
    # is being warned about is over.
    a = alert_at(at(15), forecast_days.call([{ date: d0, by: { 9 => 90 } }]))
    assert_equal(a, nil, "got #{a.to_json}")
  end

  it 'when the wettest hour has gone, the banner names the wettest one still to come' do
    # Not merely silence: 18:00 is over the threshold too, and it is the
    # hour worth moving something out of. Suppressing the banner outright
    # here would lose a real warning to a technicality about 09:00.
    a = alert_at(at(15), forecast_days.call([{ date: d0, by: { 9 => 90, 18 => 75 } }]))
    assert_equal((a || {})['text'], 'Rain from 18:00 until 19:00 (75%)', "got #{a.to_json}")
  end

  it 'the hour that is happening right now is still ahead enough to warn about' do
    # The boundary. At 15:00 exactly the 15:00 hour is the rain starting,
    # not rain that has been and gone, and at 15:59 it is still falling.
    # At 16:00 it is over.
    body = forecast_days.call([{ date: d0, by: { 15 => 85 } }])
    a = alert_at(at(15), body)
    assert_equal((a || {})['text'], 'Rain until 16:00 (85%)', "got #{a.to_json}")
    late = alert_at(at(15, 59), body)
    assert_equal((late || {})['text'], 'Rain until 16:00 (85%)', "got #{late.to_json}")
    over = alert_at(at(16), body)
    assert_equal(over, nil, "an hour that ended still alerted: #{over.to_json}")
  end

  it 'a certainty says nothing about its chance' do
    # "Rain until 16:00 (100%)" ends the one weather line the board keeps
    # by repeating its own first word. The bracket goes; the sentence
    # closes on the clock.
    a = alert_at(at(15), forecast_days.call([{ date: d0, by: { 15 => 100 } }]))
    assert_equal((a || {})['text'], 'Rain until 16:00', "got #{a.to_json}")
    assert(!(a['parts'] || []).any? { |p| /%/.match?(p['t'].to_s) }, "a piece still carries a per-cent: #{a['parts'].to_json}")
    # ...and anything short of certain still says how sure it is
    nearly = alert_at(at(15), forecast_days.call([{ date: d0, by: { 15 => 99 } }]))
    assert_equal((nearly || {})['text'], 'Rain until 16:00 (99%)', "got #{nearly.to_json}")
  end

  it 'every language drops its own bracket at a certainty' do
    # The bracket is the translator's, not this file's: German and French
    # put a space before the per-cent sign, and one language could yet
    # word it differently. What must hold is that the number and whatever
    # encloses it both go, and that the rest of the sentence is untouched.
    Dir.children(i18n_dir).select { |f| f.end_with?('.json') }.sort.each do |file|
      code = file.sub(/\.json\z/, '')
      lang = { code: code, text: File.read(File.join(i18n_dir, file), encoding: 'UTF-8') }
      sure = alert_at(at(15), forecast_days.call([{ date: d0, by: { 15 => 100 } }]), nil, lang)
      unsure = alert_at(at(15), forecast_days.call([{ date: d0, by: { 15 => 90 } }]), nil, lang)
      assert(sure && unsure, "#{code}: no alert")
      # ...and this is really that language, not English quietly standing
      # in for a file that failed to load, which would make the whole loop
      # assert the English sentence eight times.
      words = JSON.parse(lang[:text])
      said = words['alert_until'].sub('{what}') { words['alert_kind_rain'] }
                                 .sub('{u}') { '16:00' }.sub('{p}') { '90' }
      assert_equal(unsure['text'], said, "#{code}: the board did not read in its own language")
      assert(!/[%\d]/.match?(sure['text'].gsub(/\d+:\d+/, '')), "#{code}: a chance survived: #{sure['text']}")
      assert(unsure['text'].include?('90'),
             "#{code}: the chance was dropped when it was not certain: #{unsure['text']}")
      # the sentence up to the bracket is the same in both
      assert(unsure['text'].start_with?(sure['text']), "#{code}: the sentence changed, not just its bracket: " \
                                                       "#{[sure['text'], unsure['text']].to_json}")
    end
  end

  # -------------------------------------------------------------------
  # When it ENDS.
  #
  # "If raining or snow or whatever, try to be specific when it ends."
  # Rain at 14:00 is a coat; rain until 17:00 is whether to wait it out.
  # The spell is the run of wet hours around the next one still to come.
  # -------------------------------------------------------------------

  it 'a spell ahead is named from its first hour to the end of its last' do
    a = alert_at(at(9), forecast_days.call([{ date: d0, by: { 14 => 75, 15 => 90, 16 => 72, 17 => 40 } }]))
    assert_equal((a || {})['text'], 'Rain from 14:00 until 17:00 (90%)', "got #{a.to_json}")
  end

  it 'once it has started the banner says only when it stops' do
    # And the chance is the likeliest hour still AHEAD: the 95% at 13:00 is
    # behind us at 14:20.
    a = alert_at(at(14, 20), forecast_days.call([{ date: d0, by: { 13 => 95, 14 => 80, 15 => 75 } }]))
    assert_equal((a || {})['text'], 'Rain until 16:00 (80%)', "got #{a.to_json}")
  end

  it 'a spell that runs past the last hour has no end to name' do
    # The hours stop at the end of the board's day, so there is no
    # "until": naming 22:00 would be inventing when it stops.
    body = forecast_days.call([{ date: d0, by: { 19 => 80, 20 => 85, 21 => 90 } }])
    ahead = alert_at(at(9), body)
    assert_equal((ahead || {})['text'], 'Rain from 19:00 into the night (90%)', "got #{ahead.to_json}")
    started = alert_at(at(19, 30), body)
    assert_equal((started || {})['text'], 'Rain for the rest of the day (90%)', "got #{started.to_json}")
  end

  it 'the NEXT spell is the banner, not the wettest one' do
    # A 72% spell at 10:00 comes before the 95% one at 18:00, and it is the
    # one somebody walking out of the door at 09:30 walks into.
    a = alert_at(at(9), forecast_days.call([{ date: d0, by: { 10 => 72, 18 => 95 } }]))
    assert_equal((a || {})['text'], 'Rain from 10:00 until 11:00 (72%)', "got #{a.to_json}")
  end

  it 'a dry hour in the middle is two spells, and the banner names the first' do
    a = alert_at(at(9), forecast_days.call([{ date: d0, by: { 12 => 80, 13 => 20, 14 => 80, 15 => 80 } }]))
    assert_equal((a || {})['text'], 'Rain from 12:00 until 13:00 (80%)', "got #{a.to_json}")
  end

  it 'the hourly codes name snow and thunderstorms, each with its own icon' do
    # The day's own condition is rain (61) in both: it is the hours that
    # say what falls, and the banner is about the hours it names.
    snow = alert_at(at(9), forecast_days.call([{ date: d0, by: { 11 => 60, 12 => 70 },
                                                 codes: { 11 => 71, 12 => 73 } }]))
    assert_equal(without.call(snow), alert.call('snow', 'Snow from 11:00 until 13:00 (70%)', 'wi-snow.svg'),
                 "got #{snow.to_json}")
    storms = alert_at(at(9), forecast_days.call([{ date: d0, by: { 16 => 55, 17 => 65 },
                                                   codes: { 16 => 95, 17 => 96 } }]))
    assert_equal(without.call(storms),
                 alert.call('storms', 'Thunderstorms from 16:00 until 18:00 (65%)', 'wi-thunderstorm.svg'),
                 "got #{storms.to_json}")
  end

  it 'thunderstorms alert under the rain line, and outrank the rain before them' do
    # 55% is under a rain threshold of 70 but it is a thunderstorm, which
    # alerts once it is likely at all; and it wins over the 90% shower
    # earlier, the way snow does.
    a = alert_at(at(9), forecast_days.call([{ date: d0, by: { 10 => 90, 19 => 55 }, codes: { 10 => 61, 19 => 95 } }]))
    assert_equal((a || {})['text'], 'Thunderstorms from 19:00 until 20:00 (55%)', "got #{a.to_json}")
    unlikely = alert_at(at(9), forecast_days.call([{ date: d0, by: { 19 => 40 }, codes: { 19 => 95 } }]))
    assert_equal(unlikely, nil, "a 40% thunderstorm alerted: #{unlikely.to_json}")
  end

  it 'a dry code on a wet hour is still the rain the reader drew the line on' do
    # Two models, two numbers: the probability says 85% while the code says
    # overcast. The threshold is on the probability.
    a = alert_at(at(9), forecast_days.call([{ date: d0, by: { 12 => 85 }, codes: { 12 => 3 } }]))
    assert_equal((a || {})['text'], 'Rain from 12:00 until 13:00 (85%)', "got #{a.to_json}")
  end

  it 'hours saved without codes read as their day did' do
    # An older build saved hours with no weathercode. A snowy day's wet
    # hours were snow then and are snow now; nothing is called a
    # thunderstorm that no forecast hour called one.
    saved = { 'weather' => { 'hi' => 1, 'lo' => -3, 'condition' => 'snow', 'unit' => 'C', 'date' => d0,
                             'perDay' => [{ 'hi' => 1, 'lo' => -3, 'condition' => 'snow',
                                            'hours' => [{ 'atMin' => 600, 'pct' => 80 },
                                                        { 'atMin' => 660, 'pct' => 85 },
                                                        { 'atMin' => 720, 'pct' => 5 }] }] },
              'weatherFetchedAt' => at(8) / 1000 }
    i = input_at(at(8), on)
    i['trmnl']['state'] = saved
    r = run_transform(net_at(nil), at(8), i)
    assert_equal(without.call(r['data']['service_alert']),
                 alert.call('snow', 'Snow from 10:00 until 12:00 (85%)', 'wi-snow.svg'),
                 "got #{r['data']['service_alert'].to_json}")

    stormy = { 'weather' => { 'hi' => 20, 'lo' => 14, 'condition' => 'storms', 'unit' => 'C', 'date' => d0,
                              'perDay' => [{ 'hi' => 20, 'lo' => 14, 'condition' => 'storms',
                                             'hours' => [{ 'atMin' => 600, 'pct' => 80 }] }] },
               'weatherFetchedAt' => saved['weatherFetchedAt'] }
    j = input_at(at(8), on)
    j['trmnl']['state'] = stormy
    s = run_transform(net_at(nil), at(8), j)
    assert_equal((s['data']['service_alert'] || {})['kind'], 'rain',
                 "an hour with no code was called a thunderstorm: #{s['data']['service_alert'].to_json}")
  end

  it 'the codes come in the same one request and are saved with the hours' do
    body = forecast_days.call([{ date: d0, by: { 12 => 85 }, codes: { 12 => 63 } }])
    r = run_transform(net_at(body), at(8), input_at(at(8), on))
    wx = requests_of(r).map { |q| q['url'] }.select { |u| u.include?('api.open-meteo.com') }
    assert_equal(wx.length, 1, 'the forecast API calls')
    assert(/hourly=precipitation_probability%2Cweathercode/.match?(wx[0].to_s),
           "hourly codes were not asked for: #{wx[0]}")
    assert_equal(r['trmnl_state']['weather']['perDay'][0]['hours'][5], { atMin: 12 * 60, pct: 85, code: 63 },
                 'the saved hour')
  end

  it 'a snowy morning read in the evening raises nothing' do
    # Snow outranks every other kind, which is exactly why it must be
    # held to the same clock: the ranking would otherwise let the one
    # banner on the board be the most confidently wrong of them.
    a = alert_at(at(19), forecast_days.call([{ date: d0, code: 71, by: { 9 => 90 } }]))
    assert_equal(a, nil, "got #{a.to_json}")

    # And it must not reach for a dry hour just to have one to name: the
    # evening it falls back to has to be an hour it is really snowing in.
    dry = alert_at(at(19), forecast_days.call([{ date: d0, code: 71, by: { 9 => 90, 20 => 30 } }]))
    assert_equal(dry, nil, "named a 30% hour as heavy snow: #{dry.to_json}")

    late = alert_at(at(19), forecast_days.call([{ date: d0, code: 71, by: { 9 => 90, 20 => 80 } }]))
    assert_equal((late || {})['text'], 'Snow from 20:00 until 21:00 (80%)',
                 "snow still to come is still an alert: #{late.to_json}")
  end

  # ---------------------------------------------- cold and heat, by the hour
  #
  # These were facts about a whole DAY, read off the daily max and min, and
  # they named no hour: a board at eight in the evening went on warning about
  # an afternoon that was over, and the minimum it warned about was usually
  # five in the morning, hours before anyone looked at it. They are held to
  # the clock now, the way rain always was, and they say which stretch of the
  # day they are about.
  hot = { alert_temp_high: '35' }

  it 'heat is the stretch of the day that is hot, and says which stretch' do
    a = alert_at(at(9), forecast_days.call([
                                             { date: d0, hi: 36, lo: 24, fill: 24,
                                               degs: { 13 => 35, 14 => 36, 15 => 36, 16 => 35 } }
                                           ]), hot)
    assert_equal(without.call(a), alert.call('heat', 'Hot, up to 36°C (13:00–17:00)', 'wi-hot.svg'),
                 "got #{a.to_json}")
  end

  it 'heat that is over is not an alert, however hot the day was' do
    # The case the whole change is for. Same day, same 36 degrees, read at
    # eight in the evening: there is nothing coming, so there is nothing to
    # say, and the banner gives its band back to the map.
    a = alert_at(at(20), forecast_days.call([
                                              { date: d0, hi: 36, lo: 24, fill: 24,
                                                degs: { 13 => 35, 14 => 36, 15 => 36, 16 => 35 } }
                                            ]), hot)
    assert_equal(a, nil, 'warned at eight in the evening about an afternoon that was over: ' \
                         "#{a.to_json}")
  end

  it 'cold at dawn is an alert at dawn and not at lunchtime' do
    day = [{ date: d0, hi: 9, lo: -4, fill: 8, degs: { 7 => -4, 8 => -2 } }]
    early = alert_at(at(7), forecast_days.call(day))
    assert_equal(without.call(early), alert.call('cold', 'Freezing, down to -4°C (07:00–09:00)',
                                                 'wi-snowflake-cold.svg'), "got #{early.to_json}")

    late = alert_at(at(12), forecast_days.call(day))
    assert_equal(late, nil, "still warning about frost at midday: #{late.to_json}")
  end

  it 'the stretch opens at the hour you are standing in, not before it' do
    # Hot since eleven, read at half past one. The range that matters is the
    # one still to come: an alert is a promise about what is coming, and a
    # reader does not need to be told about their own morning.
    a = alert_at(at(13, 30), forecast_days.call([
                                                  { date: d0, hi: 38, lo: 24, fill: 24,
                                                    degs: { 11 => 36, 12 => 38, 13 => 37, 14 => 36, 15 => 35 } }
                                                ]), hot)
    # ...and the degree is the extreme of THAT stretch: the 38 at noon has
    # been and gone, so promising it again would be promising the past.
    assert_equal(without.call(a), alert.call('heat', 'Hot, up to 37°C (13:00–16:00)', 'wi-hot.svg'),
                 "got #{a.to_json}")
  end

  it 'a single hot hour is still a stretch, with both its ends' do
    a = alert_at(at(9), forecast_days.call([
                                             { date: d0, hi: 36, lo: 24, fill: 24, degs: { 15 => 36 } }
                                           ]), hot)
    assert_equal((a || {})['text'], 'Hot, up to 36°C (15:00–16:00)', "got #{a.to_json}")
  end

  it 'a day whose hours carry no temperature is still read as a whole day' do
    # The fallback, and the shape every older snapshot has: no hourly
    # temperature to hold anything to, so the day's own figures are all
    # there is and the sentence carries no stretch.
    a = alert_at(at(20), forecast_days.call([{ date: d0, hi: 36, lo: 24, by: { 9 => 90 } }]), hot)
    assert_equal(without.call(a), alert.call('heat', 'Hot, up to 36°C', 'wi-hot.svg'), "got #{a.to_json}")
  end

  it 'the stretch is lit and the sentence around it is not' do
    a = alert_at(at(9), forecast_days.call([
                                             { date: d0, hi: 36, lo: 24, fill: 24, degs: { 13 => 36, 14 => 36 } }
                                           ]), hot)
    assert_equal(a['parts'].map { |q| q['t'] }.join, a['text'], 'the pieces do not spell the line')
    assert_equal(a['parts'].select { |q| q['s'] == 'b' }.map { |q| q['t'] }, ['Hot', "36°C"],
                 "the thing and its degree are not the bold ones: #{a['parts'].to_json}")
    lit = a['parts'].select { |q| q['s'] == '' }.map { |q| q['t'] }.join
    assert(lit.include?('13:00') && lit.include?('15:00'),
           "the clocks went quiet: #{a['parts'].to_json}")
  end

  it 'the wettest hour of TOMORROW is not an alert about today' do
    # The forecast covers the run of days, not the day on the board. Read
    # straight through, the 95% at 17:00 tomorrow becomes "expected at
    # 17:00" on a board whose own day never goes above 20%.
    a = alert_at(at(9), forecast_days.call([
                                             { date: d0, max: 20, by: {} },
                                             { date: d1, max: 95, by: { 17 => 95 } }
                                           ]))
    assert_equal(a, nil, "got #{a.to_json}")
  end

  # TWO CASES HERE NEEDED A BOARD SET TO TOMORROW, and nothing draws one now.
  #
  # They checked that such a board was warned about ITS day rather than
  # today's, and that an early hour on it counted as ahead rather than
  # behind -- the clock bounds the day it belongs to, so 08:00 tomorrow is
  # still to come at eight in the evening today. Both were about the day
  # index travelling with the alert. The half that survives is below: the
  # banner is about the day the board is drawing, asked of the day it draws.

  it 'the banner is about the day the board is drawing' do
    # An alert about a day that is not on the screen is an alert about
    # nothing. Both days are in the forecast and only one is on the board, so
    # a banner naming tomorrow's rain would be naming weather nobody can see.
    body = forecast_days.call([
                                { date: d0, max: 88, by: { 9 => 88 } },
                                { date: d1, max: 92, by: { 16 => 92 } }
                              ])
    a = alert_at(at(9), body)
    assert_equal((a || {})['text'], 'Rain until 10:00 (88%)',
                 "the banner should be about today: #{a.to_json}")
  end

  it "a board replaying this morning's snapshot does not replay this morning's alert" do
    # The one that actually reaches a wall. The API answered at 08:00 and
    # has been down since; the device is still drawing, and at 19:00 the
    # saved snapshot's wettest hour is nine hours old.
    morning = run_transform(net_at(forecast_days.call([{ date: d0, by: { 9 => 90 } }])), at(8),
                            input_at(at(8), on))
    assert_equal((morning['data']['service_alert'] || {})['text'], 'Rain from 09:00 until 10:00 (90%)',
                 'the morning board should warn about the morning')
    saved = deep_copy(morning['trmnl_state'])

    evening = run_transform(net_at(nil), at(19),
                            input_at(at(19), on).merge('trmnl' => input_at(at(19), on)['trmnl'].merge('state' => saved)))
    assert_equal(evening['data']['service_alert'], nil,
                 "the evening board replayed the morning: #{evening['data']['service_alert'].to_json}")
  end

  it 'a snapshot with only a wettest hour behind it is still held to the clock' do
    # A build older than the hourly detail saved one hour and one
    # probability. There is nothing to fall back to, so the banner has to
    # go rather than name the hour it has.
    saved = { 'weather' => { 'hi' => 18, 'lo' => 11, 'condition' => 'rain', 'icon' => 'wi-day-rain.svg',
                             'rain_chance' => 90, 'unit' => 'C', 'peak' => { 'atMin' => 9 * 60, 'pct' => 90 } },
              'weatherFetchedAt' => at(8) / 1000 }
    i = input_at(at(15), on)
    i['trmnl']['state'] = saved
    r = run_transform(net_at(nil), at(15), i)
    assert_equal(r['data']['service_alert'], nil, "got #{r['data']['service_alert'].to_json}")

    early = input_at(at(8), on)
    early['trmnl']['state'] = saved
    still = run_transform(net_at(nil), at(8), early)
    assert_equal(without.call(still['data']['service_alert']),
                 alert.call('rain', 'Rain around 09:00 (90%)', 'wi-rain.svg'),
                 "the same snapshot read before the hour is a real warning: #{still['data']['service_alert'].to_json}")
  end

  it 'the demo board obeys the clock like a real one' do
    # The demo carries a fixed forecast, so it is the one board where a
    # wettest hour is guaranteed to be in the past every single evening.
    late = run_transform([otherwise(500)], at(20),
                         base_input(at(20), use_demo_data: 'true', demo_set: 'simpsons', alert_enabled: 'true',
                                            alert_rain_threshold: '50'))
    assert_equal(late['data']['service_alert'], nil,
                 "the demo raised an alert about an hour that has gone: #{late['data']['service_alert'].to_json}")
  end

  it 'the hourly detail behind the alert is saved, per day' do
    # The banner is composed at draw time, not at fetch time, which only
    # works if the snapshot carries enough to re-pick an hour later.
    r = run_transform(net_at(forecast_days.call([
                                                  { date: d0, by: { 9 => 90, 18 => 75 } },
                                                  { date: d1, by: { 17 => 95 } }
                                                ])), at(8), input_at(at(8), on))
    w = r['trmnl_state']['weather']
    assert(w && w['perDay'].is_a?(Array) && w['perDay'].length == 2, "expected two days: #{(w && w['perDay']).to_json}")
    assert_equal(w['perDay'][0]['peak'], { atMin: 9 * 60, pct: 90 }, 'day 0 wettest hour')
    assert_equal(w['perDay'][1]['peak'], { atMin: 17 * 60, pct: 95 }, 'day 1 wettest hour')
    assert(w['perDay'][0]['hours'].length == 15, "day 0 should carry 07:00-21:00: #{w['perDay'][0]['hours'].to_json}")
    assert_equal(w['perDay'][0]['hours'][11], { atMin: 18 * 60, pct: 75 }, "the hours are the day's own")
  end

  it 'a snapshot that outlived its own day is read as the day it describes' do
    # Fetched at 23:30 and still being drawn at 04:00, which is under the
    # six hours that flags a forecast stale, so nothing else catches it.
    # The snapshot's first day is YESTERDAY by then. Indexed as though it
    # were today, its 09:00 rain becomes this morning's alert, an hour
    # that is both in the past and on the wrong day.
    body = forecast_days.call([
                                { date: d0, by: { 9 => 90 } },
                                { date: d1, by: { 16 => 85 } }
                              ])
    late_night = ms('2026-09-09T23:30:00Z')
    first = run_transform(net_at(body), late_night, input_at(late_night, on))
    saved = deep_copy(first['trmnl_state'])
    assert_equal(saved['weather']['date'], d0, 'the snapshot should record which day it starts on')

    small_hours = ms('2026-09-10T04:00:00Z')
    i = input_at(small_hours, on)
    i['trmnl']['state'] = saved
    r = run_transform(net_at(nil), small_hours, i)
    assert_equal((r['data']['service_alert'] || {})['text'], 'Rain from 16:00 until 17:00 (85%)',
                 "the morning after should be warned about the morning after: #{r['data']['service_alert'].to_json}")
  end

  it 'a snapshot older than the run it covers says nothing rather than something wrong' do
    body = forecast_days.call([{ date: d0, by: { 9 => 90 } }, { date: d1, by: { 16 => 85 } }])
    first = run_transform(net_at(body), at(8), input_at(at(8), on))
    saved = deep_copy(first['trmnl_state'])

    two_days_on = ms('2026-09-11T08:00:00Z')
    i = input_at(two_days_on, on)
    i['trmnl']['state'] = saved
    r = run_transform(net_at(nil), two_days_on, i)
    assert_equal(r['data']['service_alert'], nil,
                 "a forecast that ran out raised an alert anyway: #{r['data']['service_alert'].to_json}")
  end
end
