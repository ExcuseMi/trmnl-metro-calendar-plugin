# frozen_string_literal: true

# TONIGHT'S MOON (rule 2n): every day row carries the night's lit fraction
# and whether it is growing, counted offline, for the moon the board draws
# under the time line. September 2026 has its new moon on the 11th and its
# full moon on the 26th.

require_relative '../support/transform'

RSpec.describe 'moon' do
  include Metro::Transform

  net = [[Metro::Transform::ELSE_404[0], { body: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n" }]]
  cfg = JSON.generate(version: 1, lines: [{ name: 'Alpha' }],
                      calendars: [{ url: 'https://x.example/a.ics', line: 'Alpha' }])

  define_method(:moon_on) do |iso|
    now = ms("#{iso}T10:00:00Z")
    r = run_transform(net, now, base_input(now, config_json: cfg))
    (r['data']['days'] || []).map { it['moon'] }
  end

  it "each day carries its night's moon, lit and growing as the sky has it" do
    new_moon = moon_on('2026-09-11')
    assert(new_moon[0] && new_moon[0]['illumination'] <= 3, "the new moon: #{new_moon[0].to_json}")
    full = moon_on('2026-09-26')
    assert(full[0] && full[0]['illumination'] >= 97, "the full moon: #{full[0].to_json}")
    waxing = moon_on('2026-09-19')
    assert(waxing[0]['waxing'] == true && waxing[0]['illumination'] > 30 && waxing[0]['illumination'] < 80,
           "a waxing moon: #{waxing[0].to_json}")
    assert(waxing[1] && waxing[1]['illumination'] > waxing[0]['illumination'], "tomorrow's moon is not fuller")
    waning = moon_on('2026-10-02')
    assert(waning[0]['waxing'] == false, "a waning moon: #{waning[0].to_json}")
  end
end
