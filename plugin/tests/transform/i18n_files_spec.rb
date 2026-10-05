# frozen_string_literal: true

# i18n as JSON files. English is inline in transform.js and is the
# fallback; every other language lives in this repo's i18n/<code>.json and
# is fetched at render time, so adding Portuguese is a pull request against
# a JSON file rather than an edit to a serverless entry point only this
# repo can deploy.
#
# The two properties that matter: the DOWNLOADED file is what the board
# reads (otherwise the files are decoration), and a language that cannot be
# downloaded costs nothing (the board renders in English and says nothing
# about it).

require_relative '../support/transform'

RSpec.describe 'i18n-files' do
  include Metro::Transform

  i18n_dir = File.join(Metro::ROOT, 'i18n')

  # The pure builders, for the mocks and inputs built at describe level.
  h = Object.new.extend(Metro::Transform)
  i18n_url = Metro::Transform::I18N

  now = Time.iso8601('2026-09-09T09:00:00Z').to_i * 1000
  now_s = now / 1000
  ics = h.ics_with_events([{ start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Afternoon' }])

  # A table that no hardcoded copy could produce, so a passing assertion
  # can only mean the fetched file was the one used.
  served = { today: 'AUJOURD-SERVED', more: '+{n} SERVED', earlier: '+{n} EARLIER-SERVED', rain_pct: '{n}% SERVED' }

  # JS `undefined`: a state the input does not carry at all.
  undefined = Object.new.freeze
  input = lambda do |locale, state = undefined, cfg = {}|
    i = h.base_input(now, {
      'use_demo_data' => 'false',
      'config_json' => JSON.generate(calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }])
    }.merge(cfg))
    i['trmnl']['user']['locale'] = locale
    i['trmnl']['state'] = state unless state.equal?(undefined)
    i
  end

  # The language file answers `i18n` (a body, a status, or OFFLINE for a
  # dropped connection); everything else answers with the feed.
  offline = { error: :reset }
  net = lambda do |i18n|
    m = if i18n.is_a?(String) then h.serve(i18n_url, i18n)
        elsif i18n.is_a?(Numeric) then h.status(i18n_url, i18n)
        else [i18n_url, i18n]
        end
    [m, h.otherwise(ics)]
  end
  i18n_asked = ->(r) { h.requests_of(r).map { it['url'] }.select { it.include?('/i18n/') } }

  it 'the language file is fetched from this repo and is what the board reads' do
    fetch_impl = net.(JSON.generate(served))
    r = run_transform(fetch_impl, now, input.('fr-BE'))
    asked = i18n_asked.(r)
    assert(asked.length == 1 && %r{ExcuseMi/trmnl-metro-calendar-plugin/main/i18n/fr\.json\z}.match?(asked[0]),
           "expected one fetch of i18n/fr.json from this repo, got #{asked.to_json}")
    assert(r['data']['i18n']['today'] == 'AUJOURD-SERVED',
           "the board did not use the downloaded table: #{r['data']['i18n'].to_json}")
  end

  it 'a half-translated file uses what it has and reads English for the rest' do
    # A contributor who adds one string should not knock the other fifteen
    # back to a language nobody asked for.
    r = run_transform(net.(JSON.generate(today: 'Vandaag-SERVED')), now, input.('nl-BE'))
    assert(r['data']['i18n']['today'] == 'Vandaag-SERVED', 'the translated key was ignored')
    assert(r['data']['i18n']['more'] == '+{n} more',
           "a missing key should fall back to English, got #{r['data']['i18n']['more']}")
  end

  it 'an unreachable GitHub renders the board in English and says nothing' do
    # Silently: a family board is not the place for a message about a CDN.
    r = run_transform(net.(offline), now, input.('fr-BE'))
    assert(r['data']['i18n']['today'] == 'Today', "expected the English fallback, got #{r['data']['i18n']['today']}")
    assert(event_items(r['data']).length > 0, 'a failed language fetch cost the events')
  end

  it 'a language nobody has translated yet is a 404, not a broken board' do
    r = run_transform(net.(404), now, input.('pt-PT'))
    assert(r['data']['i18n']['today'] == 'Today', "got #{r['data']['i18n']['today']}")
    assert(event_items(r['data']).length > 0, 'a missing language cost the events')
  end

  it 'the last downloaded table is cached in state and reused when the fetch fails' do
    good = run_transform(net.(JSON.generate(served)), now, input.('fr-BE'))
    saved = deep_copy(good['trmnl_state'])
    assert(saved['i18n'] && saved['i18n']['lang'] == 'fr', "the table was not cached: #{saved['i18n'].to_json}")

    # an older cache, so the TTL does not simply skip the fetch
    saved['i18n']['fetchedAt'] = now_s - 24 * 3600
    later = run_transform(net.(500), now, input.('fr-BE', saved))
    assert(later['data']['i18n']['today'] == 'AUJOURD-SERVED',
           "a failed fetch should fall back to the cached table, got #{later['data']['i18n']['today']}")
  end

  it 'a fresh cached table is used without spending the render on a fetch' do
    # The file changes a few times a year and the deadline is shared with
    # the calendars: re-downloading it every fifteen minutes buys nothing.
    fetch_impl = net.(JSON.generate(served))
    r = run_transform(fetch_impl, now, input.('fr-BE', {
      i18n: { lang: 'fr', strings: { today: 'CACHED' }, fetchedAt: now_s - 60 }
    }))
    assert(r['data']['i18n']['today'] == 'CACHED', "the fresh cache was not used: #{r['data']['i18n']['today']}")
    assert(i18n_asked.(r).length == 0,
           'a fresh cache should not be re-fetched')
  end

  it 'an English board fetches no language file at all' do
    fetch_impl = net.(JSON.generate(served))
    r = run_transform(fetch_impl, now, input.('en-GB'))
    assert(i18n_asked.(r).length == 0,
           'English is inline; it must not be downloaded')
    assert(r['data']['i18n']['today'] == 'Today')
  end

  it 'a language file full of junk cannot reach the board or the state' do
    # These files arrive from the open internet by pull request. Only the
    # keys English already has, only strings, only short ones: everything
    # else would otherwise be stored in trmnl_state and replayed for ever.
    junk = { today: 'Hoi', more: { nope: 1 }, evil: '<script>', earlier: 'x' * 500 }
    r = run_transform(net.(JSON.generate(junk)), now, input.('nl-BE'))
    assert(r['data']['i18n']['today'] == 'Hoi', 'the good key was dropped with the bad ones')
    assert(r['data']['i18n']['more'] == '+{n} more',
           "a non-string value reached the board: #{r['data']['i18n']['more'].to_json}")
    assert(r['data']['i18n']['earlier'] == '+{n} earlier', 'a 500-character string reached the board')
    assert(!r['trmnl_state']['i18n']['strings'].key?('evil'), 'an unknown key was stored in state')
  end

  it 'the names of the days and months come from the table, not from Intl' do
    # The serverless runtime may carry English locale data only: asked for
    # Dutch, its Intl answered "Sat 19 Sep" under "Vandaag". The table has
    # the names, and the board reads them from there.
    nl = JSON.parse(File.read(File.join(i18n_dir, 'nl.json'), encoding: 'utf-8'))
    r = run_transform(net.(JSON.generate(nl)), now, input.('nl-BE'))
    d0 = r['data']['days'][0]
    assert(d0['date_label'] == 'Wo 9 Sep', "the date label reads #{d0['date_label']}")
    assert(d0['weekday_label'] == 'Woensdag' && d0['weekday_short'] == 'Wo',
           "the weekday reads #{d0['weekday_label']} / #{d0['weekday_short']}")
  end

  it 'a cached table from before a key existed is asked again after half an hour' do
    # "Nothing planned. Free day!" stood in English under "Vandaag": the
    # device's table was fresh by the TTL and simply predated the key.
    fetch_impl = net.(JSON.generate(served.merge(quiet_day: 'RUSTIG-SERVED')))
    old = { i18n: { lang: 'fr', strings: { today: 'CACHED' }, fetchedAt: now_s - 45 * 60 } }
    r = run_transform(fetch_impl, now, input.('fr-BE', old))
    assert(i18n_asked.(r).length == 1, 'the incomplete table was not refreshed')
    assert(r['data']['i18n']['quiet_day'] == 'RUSTIG-SERVED',
           "the refreshed key did not reach the board: #{r['data']['i18n']['quiet_day']}")
  end

  it 'every i18n/<code>.json in the repo is complete and well formed' do
    # The files ARE the translations: a missing key silently reads English
    # on somebody's board, and a broken one turns the whole language off.
    # the inline English table is internal to transform.js: read directly, in node
    en = internals('return T.I18N.en;', now:)
    en_keys = en.keys.sort
    files = Dir.children(i18n_dir).select { it.end_with?('.json') }.sort
    assert(files.length >= 4, "expected the shipped languages as files, found #{files.join(', ')}")
    files.each do |f|
      assert(/\A[a-z]{2}\.json\z/.match?(f), "#{f}: a language file is named by its two-letter code")
      table = JSON.parse(File.read(File.join(i18n_dir, f), encoding: 'utf-8'))
      keys = table.keys.sort
      assert(keys.join(',') == en_keys.join(','),
             "#{f} does not carry the English key set: missing #{en_keys.reject { keys.include?(it) }.join(', ')}" \
             " / extra #{keys.reject { en_keys.include?(it) }.join(', ')}")
      keys.each do |k|
        assert(table[k].is_a?(String) && !/\A[[:space:]﻿]*\z/.match?(table[k]), "#{f}: #{k} is not a non-empty string")
        # A placeholder dropped in translation renders its value as
        # nothing: "+ more", or a service alert with no time in it. The
        # check used to name {n}, which was every placeholder there was;
        # the alert lines carry {t}, {p} and {v}, and a translator who
        # drops one of those loses the only number on the banner.
        want = en[k].scan(/\{\w+\}/).sort
        have = table[k].scan(/\{\w+\}/).sort
        assert(want.all? { have.include?(it) },
               "#{f}: #{k} lost #{want.reject { have.include?(it) }.join(', ')}" \
               " (English has #{want.join(' ')}, this has #{have.empty? ? 'none' : have.join(' ')})")
      end
    end
  end

  it 'a repo language file, served as-is, drives a real board' do
    # The end-to-end version of the test above: the actual bytes in the
    # repo, through the actual fetch path, onto the actual payload.
    fr = File.read(File.join(i18n_dir, 'fr.json'), encoding: 'utf-8')
    r = run_transform(net.(fr), now, input.('fr-FR'))
    assert(r['data']['i18n']['today'] == JSON.parse(fr)['today'],
           "expected the repo French table on the board, got #{r['data']['i18n']['today']}")
  end
end
