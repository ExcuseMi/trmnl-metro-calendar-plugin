# frozen_string_literal: true

# THE HOUR IT TURNS WINDY (rule 2n, "we could add wind as well"): the
# forecast is asked for its gusts, and the first hour of a day with gusts
# at or over 50 km/h is a "Windy" sky mark, TRMNL's strong-wind glyph, on
# the day it belongs to. A calm day has none.

require_relative '../support/transform'

RSpec.describe 'wind' do
  include Metro::Transform

  now = Time.iso8601('2026-09-09T08:00:00Z').to_i * 1000
  forecast_url = Metro::Transform::FORECAST
  forecast = lambda do |gusts|
    time = []
    pp = []
    wc = []
    t2 = []
    %w[2026-09-09 2026-09-10].each do |d|
      (0...24).each do |hr|
        time.push("#{d}T#{hr.to_s.rjust(2, '0')}:00")
        pp.push(5)
        wc.push(1)
        t2.push(18)
      end
    end
    JSON.generate(
      daily: { time: %w[2026-09-09 2026-09-10], temperature_2m_max: [20, 21], temperature_2m_min: [11, 12],
               precipitation_probability_max: [5, 5], weathercode: [1, 1],
               sunrise: %w[2026-09-09T07:05 2026-09-10T07:07], sunset: %w[2026-09-09T19:58 2026-09-10T19:56] },
      hourly: { time: time, precipitation_probability: pp, weathercode: wc, temperature_2m: t2,
                wind_gusts_10m: gusts.call(time) }
    )
  end
  define_method(:board_with) do |gusts|
    r = run_transform([
                        serve(forecast_url, forecast.call(gusts)),
                        otherwise(ics_with_events([{ start: '20260909T090000Z', end: '20260909T100000Z',
                                                     summary: 'Standup' }]))
                      ], now,
                      base_input(now, config_json: 'https://calendar.example.com/a.ics', lat_lon: '51.05,3.72'))
    { r: r, urls: requests_of(r).map { |q| q['url'] } }
  end

  it 'the first gusty hour of a day is a windy mark, and a calm day has none' do
    # gusts of 60 from 14:00 today and from 09:00 tomorrow
    board = board_with(lambda do |time|
      time.map do |t|
        hr = t[11...13].to_i
        d = t[0...10]
        (d == '2026-09-09' && hr >= 14) || (d == '2026-09-10' && hr >= 9) ? 60 : 20
      end
    end)
    r = board[:r]
    urls = board[:urls]
    wx = urls.select { |u| u.include?('api.open-meteo.com') }[0] || ''
    assert(/wind_gusts_10m/.match?(wx) && /wind_speed_unit=kmh/.match?(wx),
           "the forecast is not asked for gusts in km/h: #{wx}")
    today = r['data']['weather'].select { |w| w['kind'] == 'windy' }
    assert(today.length == 1 && today[0]['at_min'] == 14 * 60 && /wi-strong-wind\.svg\z/.match?(today[0]['icon'].to_s),
           "today's windy mark: #{today.to_json}")
    assert(/\AWindy /.match?(today[0]['label'].to_s), "the label: #{today[0]['label']}")
    tomorrow = ((r['data']['days'][1] || {})['weather'] || {})['milestones'] || []
    assert(tomorrow.any? { |m| m['kind'] == 'windy' && m['atMin'] == 9 * 60 },
           "tomorrow's windy mark: #{tomorrow.to_json}")
    calm = board_with(->(time) { time.map { 30 } })
    assert(!calm[:r]['data']['weather'].any? { |w| w['kind'] == 'windy' }, 'a calm day was marked windy')
  end
end
