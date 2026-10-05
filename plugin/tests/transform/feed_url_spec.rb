# frozen_string_literal: true

# A CALENDAR'S LINK IS NOT ALWAYS ITS FEED. A Nextcloud public link opens the
# calendar in a browser; the feed is that token's export on the same server.

require_relative '../support/transform'

RSpec.describe 'feed-url' do
  include Metro::Transform

  it 'a nextcloud public link is read from its export' do
    now = ms('2026-09-15T08:00:00Z')
    # feedUrl is an internal function with no entry point of its own
    feed_url = ->(url) { internals('return T.feedUrl(args.url);', now:, args: { url: }) }
    mocks = [
      otherwise(ics_with_events([{ start: '20260915T100000Z', end: '20260915T110000Z', summary: 'Swim' }]))
    ]
    assert(feed_url.('https://cloud.example.com/apps/calendar/p/AbC123') == 'https://cloud.example.com/remote.php/dav/public-calendars/AbC123/?export',
           "rewrote to #{feed_url.('https://cloud.example.com/apps/calendar/p/AbC123')}")
    assert(feed_url.('https://example.com/nextcloud/index.php/apps/calendar/embed/Tok9/') == 'https://example.com/nextcloud/remote.php/dav/public-calendars/Tok9/?export',
           "a subpath install rewrote to #{feed_url.('https://example.com/nextcloud/index.php/apps/calendar/embed/Tok9/')}")
    assert(feed_url.('webcal://p01.icloud.com/x') == 'https://p01.icloud.com/x', 'webcal is not https')
    r = run_transform(mocks, now, base_input(now, config_json: 'https://cloud.example.com/apps/calendar/p/AbC123'))
    asked = requests_of(r).map { it['url'] }
    assert(asked.any? { |u| /public-calendars\/AbC123\/\?export\z/.match?(u.to_s) }, "fetched #{asked.to_json}")
    assert((r['data']['events'] || []).any? { it['title'] == 'Swim' }, 'the event did not arrive')
  end
end
