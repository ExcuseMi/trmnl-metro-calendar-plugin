# frozen_string_literal: true

# Temperature unit. Like locale, timeZone and timeFormat, this is a
# property of the BOARD rather than of the account it hangs on, so the
# config wins over the account setting and the account setting is only the
# default.
#
# Auto is no longer on the menu (settings.yml) and is still answered, because
# a board that chose it while it was there still has `auto` stored and should
# keep what it picked: it reads the locale's region, so en-US is Fahrenheit
# and everywhere else, the rest of the English-speaking world included, is
# Celsius. A board that chose NOTHING takes the declared default instead of a
# guess.

require_relative '../support/transform'

RSpec.describe 'temperature-unit' do
  include Metro::Transform

  now = Time.iso8601('2026-09-09T09:00:00Z').to_i * 1000
  now_s = now / 1000
  forecast_url = Metro::Transform::FORECAST
  ics_events = [{ start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Afternoon' }]

  # Open-Meteo converts server-side, so which unit was ASKED for is the
  # thing to assert: a board reading 21 when it meant 70 is the failure.
  forecast = JSON.generate({
    daily: {
      temperature_2m_max: [70], temperature_2m_min: [55], precipitation_probability_max: [10],
      weathercode: [0], sunrise: ['2026-09-09T07:05'], sunset: ['2026-09-09T19:45']
    },
    hourly: { time: [], precipitation_probability: [] }
  })

  # The forecast answers, and so does everything else, with the feed. Which
  # forecast URL was asked for is read off the run's requests.
  define_method(:net) { [serve(forecast_url, forecast), otherwise(ics_with_events(ics_events))] }
  define_method(:weather_url) do |r|
    requests_of(r).map { it['url'] }.find { |u| u.include?('api.open-meteo.com') } || ''
  end

  define_method(:input) do |cfg_extra = nil, fields = nil, locale = nil|
    i = base_input(now, {
      use_demo_data: 'false',
      lat_lon: '51.05,3.72',
      config_json: JSON.generate({
        calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }]
      }.merge(cfg_extra || {}))
    }.merge(fields || {}))
    i['trmnl']['user']['locale'] = locale unless locale.to_s.empty?
    i
  end

  it 'a board that still has auto stored keeps it: en-US Fahrenheit, elsewhere Celsius' do
    us = run_transform(net, now, input({ locale: 'en-US' }, { temperature_unit: 'auto' }))
    assert(/temperature_unit=fahrenheit/.match?(weather_url(us)), "en-US should ask for Fahrenheit: #{weather_url(us)}")

    r = run_transform(net, now, input({ locale: 'en-GB' }, { temperature_unit: 'auto' }))
    assert(/temperature_unit=celsius/.match?(weather_url(r)), "en-GB should ask for Celsius: #{weather_url(r)}")
    assert(r['data']['header_weather']['unit'] == 'C', 'the payload should say which unit it is in')
  end

  # THE OPTION IS GONE, SO NOTHING CHOSEN IS NOT A CHOICE OF AUTO.
  # `settings.yml` says the default is Celsius; this says the same, rather
  # than guessing from the locale where nobody asked for a guess. An en-US
  # board that never touched the field is the one this moves.
  it 'a board that chose nothing gets the declared default, not a guess' do
    r = run_transform(net, now, input({ locale: 'en-US' }))
    assert(/temperature_unit=celsius/.match?(weather_url(r)),
           "an unset unit should be Celsius, not guessed: #{weather_url(r)}")
    assert(r['data']['header_weather']['unit'] == 'C', "got unit #{r['data']['header_weather']['unit']}")
  end

  it 'the config wins over the account setting, the way timeFormat does' do
    r = run_transform(net, now,
                      input({ locale: 'en-US', temperatureUnit: 'celsius' }, { temperature_unit: 'f' }))
    assert(/temperature_unit=celsius/.match?(weather_url(r)), "the config was overruled: #{weather_url(r)}")
    assert(r['data']['header_weather']['unit'] == 'C', "got unit #{r['data']['header_weather']['unit']}")
  end

  it 'the account setting is used when the config says nothing' do
    r = run_transform(net, now, input({ locale: 'nl-BE' }, { temperature_unit: 'f' }))
    assert(/temperature_unit=fahrenheit/.match?(weather_url(r)), "the setting was ignored: #{weather_url(r)}")
    assert(r['data']['header_weather']['unit'] == 'F', "got unit #{r['data']['header_weather']['unit']}")
  end

  it 'an unrecognised unit is the default, not a guess' do
    r = run_transform(net, now, input({ locale: 'en-US', temperatureUnit: 'kelvin' }))
    assert(/temperature_unit=celsius/.match?(weather_url(r)),
           "\"kelvin\" should fall to the default: #{weather_url(r)}")
  end

  it 'weather replayed from state is converted, not shown in the old unit' do
    # State outlives a settings change: a forecast fetched in Celsius and
    # replayed on a board that has since switched to Fahrenheit would read
    # 21 degrees on a 70 degree day.
    # the forecast's connection is dropped: the fetch throws, as before
    mocks = [[forecast_url, { error: :reset }], otherwise(ics_with_events(ics_events))]
    # Fahrenheit ASKED FOR, not inferred: this case is about the conversion,
    # and it used to get its F from an unset field guessing the locale.
    i = input({ locale: 'en-US' }, { temperature_unit: 'f' })
    i['trmnl']['state'] = {
      'weather' => { 'hi' => 21, 'lo' => 13, 'condition' => 'clear', 'icon' => 'wi-day-sunny.svg', 'rain_chance' => 10, 'unit' => 'C', 'milestones' => [], 'sun' => [] },
      'weatherFetchedAt' => now_s - 600
    }
    r = run_transform(mocks, now, i)
    assert(r['data']['header_weather']['hi'] == 70 && r['data']['header_weather']['lo'] == 55,
           "expected 21/13 C converted to 70/55 F, got #{r['data']['header_weather'].to_json}")
  end
end
