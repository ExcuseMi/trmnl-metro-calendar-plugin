# frozen_string_literal: true

# locale, timeZone and timeFormat are properties of the BOARD, not of the
# account it happens to be provisioned under: a family screen in a Belgian
# kitchen can legitimately want US formatting, and the person writing the
# config is the one who knows. So the config wins over the account, and the
# account is only the default.

require_relative '../support/transform'

RSpec.describe 'locale-config' do
  include Metro::Transform

  # The pure builders, for the mocks built at describe level.
  h = Object.new.extend(Metro::Transform)

  now = Time.iso8601('2026-09-09T09:00:00Z').to_i * 1000

  cfg = lambda do |extra = {}|
    {
      config_json: JSON.generate({
        calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }]
      }.merge(extra)),
      use_demo_data: 'false'
    }
  end
  # Every request answers with the feed, the language file included (which
  # then fails to parse and the board reads in English), as before.
  one_event = [h.otherwise(h.ics_with_events([
    { start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Afternoon' }
  ]))]

  it 'a config locale overrides the account locale' do
    r = run_transform(one_event, now, base_input(now, cfg.(locale: 'fr-FR')))
    # the header date is rendered in the config's language, not the account's
    assert(/sept/i.match?(r['data']['date_label'].to_s), "expected a French month, got #{r['data']['date_label']}")
  end

  it 'timeFormat 12h wins over a 24-hour locale' do
    r = run_transform(one_event, now, base_input(now, cfg.(locale: 'nl-BE', timeFormat: '12h')))
    assert(r['data']['hour12'] == true, "expected a 12-hour clock, got hour12=#{r['data']['hour12']}")
  end

  it 'timeFormat 24h wins over a 12-hour locale' do
    r = run_transform(one_event, now, base_input(now, cfg.(locale: 'en-US', timeFormat: '24h')))
    assert(r['data']['hour12'] == false, "expected a 24-hour clock, got hour12=#{r['data']['hour12']}")
  end

  it 'with no timeFormat set, the locale decides -- asked of Intl, not a region list' do
    us = run_transform(one_event, now, base_input(now, cfg.(locale: 'en-US')))
    be = run_transform(one_event, now, base_input(now, cfg.(locale: 'nl-BE')))
    assert(us['data']['hour12'] == true, 'en-US should be a 12-hour clock')
    assert(be['data']['hour12'] == false, 'nl-BE should be a 24-hour clock')
  end

  it 'a bare "en" account keeps a 24-hour clock' do
    # the TRMNL default locale is "en", which Intl resolves to a 12-hour
    # clock -- but a device that was never configured should not suddenly
    # read as American
    r = run_transform(one_event, now, base_input(now, cfg.(locale: 'en')))
    assert(r['data']['hour12'] == false, 'a bare "en" should stay on a 24-hour clock')
  end

  it 'a config timeZone decides which day is "today"' do
    # 23:30 UTC on the 9th is already the 10th in Auckland
    late = ms('2026-09-09T23:30:00Z')
    fetch_impl = [otherwise(ics_with_events([
      { start: '20260910T090000Z', end: '20260910T100000Z', summary: 'Tomorrow in UTC' }
    ]))]
    r = run_transform(fetch_impl, late, base_input(late, cfg.(timeZone: 'Pacific/Auckland')))
    assert(r['data']['events'].length == 1,
           'an event on the 10th should be today in Auckland')
  end

  it 'the demo ships US formatting with a European zone, so the override path is always live' do
    # The demo's config is fetched like its calendars now, so it has to be
    # served like them.
    r = run_transform(demo_mocks, now, base_input(now, use_demo_data: 'true'))
    assert(r['data']['hour12'] == true, 'the demo should read on a 12-hour clock')
  end
end
