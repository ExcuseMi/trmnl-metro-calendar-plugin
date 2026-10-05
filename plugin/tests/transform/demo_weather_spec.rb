# frozen_string_literal: true

# Demo weather. A demo board has no location, so before this nothing on one
# ever drew a sky marker: the strip under the ruler and the rain start/stop
# markers were all invisible until someone had set a real lat/lon and
# waited for the right hour of the right day. Every demo board now carries
# its own forecast (no network call, no setting), and between the three of
# them every marker icon is exercised.
#
# It applies to the demo ONLY: a real config with no location still shows
# an empty header rather than an invented forecast.

require_relative '../support/transform'

RSpec.describe 'demo-weather' do
  include Metro::Transform

  now = Time.iso8601('2026-09-09T09:00:00Z').to_i * 1000
  define_method(:urls_of) { |r| requests_of(r).map { it['url'] } }

  # demo/*.ics off disk, and nothing else answers: a demo board must not
  # need the weather API at all.
  define_method(:serve_demo_only) { demo_mocks(i18n: false) }

  sets = %w[simpsons futurama friends]

  sets.each do |set|
    it "the \"#{set}\" demo board draws a full sky band with no network weather" do
      r = run_transform(serve_demo_only, now, base_input(now, use_demo_data: 'true', demo_set: set))
      seen = urls_of(r)

      assert(seen.none? { it.include?('api.open-meteo.com') },
             "#{set}: the demo asked the weather API for a board that has no location")

      # and NO sunrise or sunset: they were markers once and are not any
      # more, so a payload carrying one is the old path coming back.
      assert(r['data']['weather'].all? { it['type'] == 'weather' },
             "#{set}: the sky band carries something that is not a weather marker: " \
             "#{r['data']['weather'].map { it['type'] }.to_json}")

      wx = r['data']['weather'].select { it['type'] == 'weather' }.map { it['label'] }
      assert(wx.any? { /\ARain starts/.match?(it.to_s) }, "#{set}: no rain start marker, got #{wx.to_json}")
      assert(wx.any? { /\ARain stops/.match?(it.to_s) }, "#{set}: no rain stop marker, got #{wx.to_json}")
      # and one heavier condition, so the snow/storm/fog icons are seen too
      assert(wx.any? { /\A(Snow|Storms|Foggy)/.match?(it.to_s) },
             "#{set}: no snow/storm/fog marker, got #{wx.to_json}")

      assert(!r['data']['header_weather']['hi'].nil? && !r['data']['header_weather']['condition'].to_s.empty?,
             "#{set}: the header has no weather: #{r['data']['header_weather'].to_json}")
      # every marker carries an icon, or it draws as a floating caption
      r['data']['weather'].each do |i|
        assert(%r{\Ahttps://trmnl\.com/images/plugins/weather/wi-[a-z-]+\.svg\z}.match?(i['icon'].to_s),
               "#{set}: bad marker icon #{i['icon']}")
      end
    end
  end

  it 'between them the demo boards exercise every heavy condition' do
    # One board with three rain markers would satisfy every case above and
    # still leave the snow and fog icons unseen by anybody.
    heavy = []
    sets.each do |set|
      r = run_transform(serve_demo_only, now, base_input(now, use_demo_data: 'true', demo_set: set))
      r['data']['weather'].select { it['type'] == 'weather' }.each do |i|
        m = /\A(Snow|Storms|Foggy)/.match(i['label'].to_s)
        heavy.push(m[1]) if m && !heavy.include?(m[1])
      end
    end
    assert(heavy.size == 3, "expected snow, storms and fog across the three boards, got #{heavy.join(', ')}")
  end

  it "sunrise and sunset come back as a day's dark hours, never as sky markers" do
    # The transform sends no sunrise or sunset MARKER: nobody plans around
    # the minute the sun comes up, and the sunset the board does draw (rule
    # 2n) it makes itself from the day's own time, in the row it can spare,
    # so it never stretches the night. The TIMES came back,
    # for the grey the map is shaded with before sunrise and after sunset
    # (rules.md 2b-i), so they travel on each day's forecast and nowhere else.
    r = run_transform([
                        serve(Metro::Transform::FORECAST, JSON.generate(
                          daily: {
                            temperature_2m_max: [20, 22], temperature_2m_min: [10, 11],
                            precipitation_probability_max: [10, 5], weathercode: [0, 1],
                            sunrise: ['2026-09-09T07:05', '2026-09-10T07:07'],
                            sunset: ['2026-09-09T19:58', '2026-09-10T19:56'],
                            time: %w[2026-09-09 2026-09-10]
                          },
                          hourly: { time: [], precipitation_probability: [] }
                        )),
                        otherwise(ics_with_events([{ start: '20260909T090000Z', end: '20260909T100000Z',
                                                     summary: 'Standup' }]))
                      ], now, base_input(now, config_json: 'https://calendar.example.com/a.ics',
                                              lat_lon: '51.05,3.72'))
    wx = urls_of(r).select { it.include?('api.open-meteo.com') }
    assert(wx.length.positive? && /sunrise/.match?(wx[0]) && /sunset/.match?(wx[0]),
           'the forecast query does not ask for the sun')
    d0 = (r['data']['days'] || [])[0]
    assert(d0 && d0['weather'] && d0['weather']['sunrise_min'] == 425 && d0['weather']['sunset_min'] == 1198,
           "the day does not carry its sunrise and sunset: #{(d0 && d0['weather']).to_json}")
    assert(r['data']['weather'].none? { /sun/i.match?(it['label'] || '') }, 'a sunrise or sunset marker came back')
  end

  it 'the offline demo fallback keeps its weather too' do
    # GitHub unreachable: the board falls back to the built-in Springfield
    # day, which is exactly when an empty sky band would be noticed.
    r = run_transform([otherwise(500)], now, base_input(now, use_demo_data: 'true'))
    assert(r['data']['weather'].select { it['type'] == 'weather' }.length >= 2,
           'the offline demo lost its weather markers')
    assert(r['data']['weather'].all? { it['type'] == 'weather' }, 'the offline demo grew a marker that is not weather')
  end

  it 'demo weather does not leak into a real board that has no location' do
    # Inventing a forecast for somebody's actual calendar would be a lie on
    # the wall, not a demo.
    r = run_transform([otherwise(ics_with_events([
                                                   { start: '20260909T140000Z', end: '20260909T150000Z',
                                                     summary: 'Afternoon' }
                                                 ]))], now,
                      base_input(now,
                                 use_demo_data: 'false',
                                 config_json: JSON.generate(calendars: [{ url: 'https://example.com/a.ics',
                                                                          name: 'Cal' }])))
    assert(r['data']['header_weather']['hi'].nil?,
           "a real board invented a temperature: #{r['data']['header_weather'].to_json}")
    assert(r['data']['weather'].length.zero?,
           'a real board with no location drew sky markers')
  end

  it 'a demo board with a real location prefers the real forecast' do
    forecast = JSON.generate(
      daily: {
        temperature_2m_max: [30], temperature_2m_min: [20], precipitation_probability_max: [5],
        weathercode: [0], sunrise: ['2026-09-09T06:30'], sunset: ['2026-09-09T20:30']
      },
      hourly: { time: [], precipitation_probability: [] }
    )
    r = run_transform([serve(Metro::Transform::FORECAST, forecast)] + demo_mocks(i18n: false), now,
                      base_input(now, use_demo_data: 'true', lat_lon: '51.05,3.72'))
    # 30C asked for in Fahrenheit (the demo board pins en-US) comes back
    # already converted by the API, so the number is the one it sent
    assert(r['data']['header_weather']['hi'] == 30,
           "the demo weather overrode a real forecast: #{r['data']['header_weather'].to_json}")
    # The API is still asked for the day's forecast and still answers with
    # a sunrise and a sunset in the body; the board simply no longer builds
    # a marker out of either.
    assert(r['data']['weather'].all? { it['type'] == 'weather' },
           "the real forecast put a sun marker back on the board: #{r['data']['weather'].to_json}")
  end

  # THE EXAMPLE DAY'S SUN IS THE LOCATION'S OWN CLOCK. A location six hours
  # from the account's zone (New York on a Brussels account) gave the example
  # board a sunrise at half past twelve and a sunset after midnight, so the
  # night ran through the middle of the day. A real day still gets the true
  # times, which is the whole point of them.
  define_method(:sun_query) do
    [
      serve(Metro::Transform::FORECAST, JSON.generate(
        daily: { temperature_2m_max: [24], temperature_2m_min: [14],
                 precipitation_probability_max: [0], weathercode: [0],
                 sunrise: ['2026-09-09T06:36'], sunset: ['2026-09-09T19:04'], time: ['2026-09-09'] },
        hourly: { time: [], precipitation_probability: [] }
      ))
    ] + demo_mocks(i18n: false) +
      [otherwise(ics_with_events([{ start: '20260909T090000Z', end: '20260909T100000Z', summary: 'Standup' }]))]
  end

  it "the example day asks for the sun in the location's own clock; a real day does not" do
    demo = run_transform(sun_query, now, base_input(now, use_demo_data: 'true', lat_lon: '40.71,-74.00'))
    demo_wx = urls_of(demo).find { it.include?('api.open-meteo.com') }
    assert(/timezone=auto/.match?(demo_wx.to_s), "the example day asked in the account zone: #{demo_wx}")

    r = run_transform(sun_query, now, base_input(now,
                                                 config_json: 'https://calendar.example.com/a.ics',
                                                 lat_lon: '40.71,-74.00'))
    real_wx = urls_of(r).find { it.include?('api.open-meteo.com') }
    assert(!/timezone=auto/.match?(real_wx.to_s), "a real day lost the account zone: #{real_wx}")
    assert((r['data']['days'][0]['weather'] || {})['sunrise_min'] == 396, 'the real day should keep the true sunrise')
  end
end
