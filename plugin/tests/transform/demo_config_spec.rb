# frozen_string_literal: true

# The demo is driven by DEMO_CONFIG in transform.js against the ICS files in
# this repo's demo/ folder. Those two have to stay in step: a renamed track,
# a changed class code or a moved file breaks the demo for every device that
# hasn't been configured yet, and nothing else would notice.
#
# Fetches are served from demo/*.ics on disk, so this tests the real config
# against the real calendars without touching the network.

require_relative '../support/transform'

RSpec.describe 'demo-config' do
  include Metro::Transform

  demo_dir = File.join(Metro::ROOT, 'demo')

  # a Wednesday, so the weekday-limited entries (L6 Field Trip) are on
  now = Time.iso8601('2026-09-09T09:00:00Z').to_i * 1000

  # Demo calendars live under demo/<show>/, so the path after the repo's
  # own base is what names the file -- not the last segment, which would
  # resolve every show's homer.ics to the same place.
  rel_of = ->(url) { url.to_s.split('/main/demo/', -1).last }

  # Every file under demo/, answered at any URL whose path ends in
  # /main/demo/<show>/<file> (a plain list of links may point at another
  # repo's copy); `missing` files and anything else under /main/demo/ 404.
  # `swap` answers a file with other text.
  walk = lambda do |dir, rel, out|
    Dir.children(dir).sort.each do |f|
      full = File.join(dir, f)
      r = rel.empty? ? f : "#{rel}/#{f}"
      File.directory?(full) ? walk.(full, r, out) : out.push(r)
    end
    out
  end
  serve_demo_files = lambda do |missing = nil, swap = nil|
    walk.(demo_dir, '', []).map do |rel|
      url = %r{/main/demo/#{Regexp.escape(rel)}(\?.*)?\z}
      next [url, { status: 404, body: '' }] if (missing || []).include?(rel)

      [url, { body: (swap && swap[rel]) || File.read(File.join(demo_dir, rel), encoding: 'utf-8') }]
    end + [[%r{/main/demo/}, { status: 404, body: '' }]]
  end
  # What a run fetched under demo/, relative to it.
  define_method(:demo_asked) do |r|
    requests_of(r).map { it['url'] }.select { it.include?('/main/demo/') }.map(&rel_of)
  end

  define_method(:demo_input) { |now_ms| base_input(now_ms, use_demo_data: 'true') }

  it 'the demo config resolves against the repo ICS files, with a line per family member' do
    r = run_transform(serve_demo_files.call, now, demo_input(now))
    names = r['data']['legend'].map { it['name'] }.sort
    # exactly these five: every school and family entry has to be routed to
    # a person by a rule, so a stray line means a rule stopped matching and
    # the calendar's own name leaked in as a track
    assert(names.join(',') == 'Bart,Homer,Lisa,Maggie,Marge',
           "expected exactly the five family lines, got: #{names.join(', ')}")
  end

  it 'a stale copy of one calendar shows through, because there is nothing to swap to' do
    # raw.githubusercontent serves a changed file from cache for a few
    # minutes, so right after a push some calendars are current and one is
    # not. This used to fall back to a hand-written Springfield day rather
    # than render a board that is nobody's day.
    #
    # THAT REMEDY IS GONE with the offline board, and it was worse than the
    # thing it prevented: it replaced the demo with a DIFFERENT demo, in
    # different words, with no indication anything had happened. What a
    # stale feed produces here is exactly what a stale feed produces for a
    # real config, which is the thing the demo exists to show. So the case
    # now holds the two things still guaranteed -- the family is all there
    # and the board renders -- and records that the stale event is on it.
    stale = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:Demo - School\r\n" \
            "BEGIN:VEVENT\r\nUID:stale@x\r\nDTSTAMP:20240101T000000Z\r\nSUMMARY:Zwemles L2\r\n" \
            "DTSTART:20240101T100000\r\nDTEND:20240101T110000\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU\r\n" \
            "END:VEVENT\r\nEND:VCALENDAR\r\n"
    r = run_transform(serve_demo_files.([], { 'simpsons/school.ics' => stale }), now, demo_input(now))
    names = r['data']['legend'].map { it['name'] }.sort
    %w[Bart Homer Lisa Maggie Marge].each do |who|
      assert(names.include?(who), "a stale feed cost the demo a line: #{names.join(', ')}")
    end
    assert(event_items(r['data']).length.positive?, 'a stale feed emptied the whole board')
  end

  it 'every demo calendar the config names actually exists in demo/' do
    seen = demo_asked(run_transform(serve_demo_files.call, now, demo_input(now)))
    seen.each do |rel|
      assert(File.exist?(File.join(demo_dir, rel)), "config points at demo/#{rel}, which is not in the repo")
    end
    assert(seen.length >= 5, "expected the demo to fetch a calendar per member, saw #{seen.length}")
  end

  it 'school entries land on the right child by class code' do
    r = run_transform(serve_demo_files.call, now, demo_input(now))
    owners = {}
    event_items(r['data']).each { owners[it['title']] = it['owner'] }
    bart_key = r['data']['legend'].select { it['name'] == 'Bart' }.map { it['key'] }[0]
    lisa_key = r['data']['legend'].select { it['name'] == 'Lisa' }.map { it['key'] }[0]
    # the class code routes the entry and is then stripped from the title:
    # "L6 School Day" belongs to Bart and reads as "School Day"
    # day 0 only: the payload carries the whole run the board may draw, and
    # a weekly school day recurs on every one of them
    school_days = event_items(r['data'])
                  .select { it['title'] == 'School Day' && it['start_min'] < 1440 }
    assert(school_days.length == 1, "one school day, shared, not one per child: got #{school_days.length}")
    at_school = ([school_days[0]['owner']] + school_days[0]['co_owners']).sort_by(&:to_s)
    assert(at_school.length == 2, "expected exactly the two schoolchildren on it, got #{at_school.join(',')}")
    assert(at_school.include?(bart_key), 'no School Day on Bart')
    assert(at_school.include?(lisa_key), 'no School Day on Lisa')
    assert(owners['Field Trip'] == bart_key, "the L6 field trip should sit on Bart, got #{owners['Field Trip']}")
  end

  it 'the family calendar produces an interchange across everyone' do
    r = run_transform(serve_demo_files.call, now, demo_input(now))
    dinner = event_items(r['data']).select { /Family Dinner/.match?(it['title'].to_s) }[0]
    assert(dinner, 'no Family Dinner in the demo')
    assert(dinner['co_owners'].length >= 3,
           "Family Dinner should join the whole family, got #{dinner['co_owners'].length + 1} track(s)")
  end

  it 'a partly-resolved demo still shows the whole family' do
    # the failure that actually happens: new files not yet on the CDN while
    # an older one still answers, so some calendars resolve and others 404.
    # A line the config DECLARES is drawn on its quiet day rather than
    # dropped, so the family survives a feed being down without needing
    # anything to fall back to.
    r = run_transform(serve_demo_files.(['simpsons/homer.ics', 'simpsons/marge.ics', 'simpsons/maggie.ics']),
                      now, demo_input(now))
    names = r['data']['legend'].map { it['name'] }.sort
    %w[Bart Homer Lisa Maggie Marge].each do |who|
      assert(names.include?(who),
             "a feed being down cost the demo a line: #{names.join(', ')}")
    end
  end

  it 'an unreachable GitHub draws an empty board, not a made-up one' do
    # THE OPPOSITE OF WHAT THIS USED TO ASSERT. It held that an unreachable
    # GitHub must fall back to the built-in Springfield day "rather than an
    # empty board", and that was the whole mistake: the built-in day was a
    # second, drifted copy of the demo that swapped itself in silently, and
    # a panel showing it was indistinguishable from a working one until you
    # noticed the appointments did not exist in this repo.
    #
    # A board that invents appointments to avoid looking empty is lying. An
    # empty one is honest and, unlike the fake, it is obviously wrong.
    # AND IT IS EMPTIER THAN IT USED TO BE, on purpose.
    #
    # It once came out as the five Springfield lines with nothing on them:
    # the config DECLARED them, so a declared line was drawn on its quiet
    # day. The config is now a file in this repo fetched at run time like the
    # calendars beside it, rather than a copy embedded here, so an
    # unreachable GitHub costs the board the line names as well as the
    # events. That is the honest end of the same argument -- with no network
    # there is nothing this knows about the family -- and it is still
    # obviously not a working day.
    r = run_transform([otherwise(500)], now, demo_input(now))
    assert_equal(event_items(r['data']).length, 0, 'something was invented for an offline board')
    assert_equal(r['data']['legend'].length, 0, 'an offline board named lines it could not have known')
    assert(r['data']['header_weather'], 'the board lost its header along with its events')
  end

  # ------------------------------------------------------------ the other boards

  # Each demo set is a real config against real ICS files in this repo, so
  # a renamed track, a changed rule or a moved file breaks that board for
  # everyone who picks it and nothing else would notice.
  sets = {
    'simpsons' => { lines: %w[Bart Homer Lisa Maggie Marge], dir: 'simpsons' },
    'futurama' => { lines: %w[Amy Bender Fry Leela Professor], dir: 'futurama' },
    'friends' => { lines: %w[Monica Rachel], dir: 'friends' }
  }

  sets.each_key do |set|
    it "the \"#{set}\" demo resolves against the repo ICS files" do
      r = run_transform(serve_demo_files.call, now, base_input(now, use_demo_data: 'true', demo_set: set))
      names = r['data']['legend'].map { it['name'] }.sort
      assert(names.join(',') == sets[set][:lines].join(','),
             "#{set}: expected #{sets[set][:lines].join(', ')}, got #{names.join(', ')}")
      # and it fetched only its own show's files
      assert(event_items(r['data']).length.positive?, "#{set}: resolved no events")
    end
  end

  it 'an unknown demo board falls back to Springfield rather than an empty one' do
    r = run_transform(serve_demo_files.call, now, base_input(now, use_demo_data: 'true', demo_set: 'the-wire'))
    names = r['data']['legend'].map { it['name'] }.sort
    assert(names.join(',') == sets['simpsons'][:lines].join(','), "got #{names.join(', ')}")
  end

  it 'the Planet Express delivery is one long event on three lines' do
    # the shape two children at one school get, with a third line in the
    # corridor: one event, one caption, three lines, and the three of them
    # adjacent. It used to arrive as three separate siding entries tied
    # together by a shared group id, which is what made a single caption
    # something a test had to check for; one item cannot be captioned
    # twice, so what is left to protect is that it IS one item and that it
    # still names all three of the crew.
    r = run_transform(serve_demo_files.call, now, base_input(now, use_demo_data: 'true', demo_set: 'futurama'))
    runs = event_items(r['data']).select { it['title'] == 'Delivery Run' && it['start_min'] < 1440 }
    assert(runs.length == 1, "expected one Delivery Run, got #{runs.length}")
    crew = [runs[0]['owner']] + runs[0]['co_owners']
    assert(crew.length == 3, "expected the delivery on three lines, got #{crew.length}")
    key = {}
    r['data']['legend'].each_with_index { |t, i| key[t['key']] = i }
    at = crew.map { key[it] }.sort
    assert(at[2] - at[0] == 2,
           "the three lines on one delivery should end up adjacent, got positions #{at.join(',')}")
  end

  it 'every demo board names files that exist, and only its own' do
    sets.each_key do |set|
      seen = demo_asked(run_transform(serve_demo_files.call, now,
                                      base_input(now, use_demo_data: 'true', demo_set: set)))
      seen.each do |rel|
        assert(File.exist?(File.join(demo_dir, rel)), "#{set} points at demo/#{rel}, which is not in the repo")
      end
      assert(seen.length.positive?, "#{set} fetched nothing")
      seen.each do |rel|
        assert(rel.start_with?("#{sets[set][:dir]}/"), "#{set} reached for #{rel}")
      end
    end
  end

  it 'demo/<show>/config.json IS the board the plugin runs, and every one of them parses' do
    # NOTHING TO KEEP IN STEP ANY MORE. This used to compare the file on disk
    # with a copy of it embedded in transform.js, and regenerating the file
    # when they drifted was a documented step somebody had to remember. The
    # plugin fetches these files at run time now, beside the calendars they
    # name, so the file IS the board and the only thing left to check is that
    # it is a config at all -- a broken one takes its whole demo board down
    # and nothing else would notice.
    sets.each_key do |name|
      file = File.join(demo_dir, name, 'config.json')
      assert(File.exist?(file), "no demo/#{name}/config.json")
      cfg = JSON.parse(File.read(file, encoding: 'utf-8'))
      assert(cfg['calendars'].is_a?(Array) && !cfg['calendars'].empty?,
             "demo/#{name}/config.json names no calendars")
      assert(cfg['lines'].is_a?(Array) && !cfg['lines'].empty?,
             "demo/#{name}/config.json names no lines")
      cfg['calendars'].each do |c|
        assert(%r{/main/demo/}.match?(c['url'].to_s),
               "demo/#{name} points somewhere other than this repo: #{c['url']}")
      end
    end
  end

  # THE EXAMPLE PEOPLE ACTUALLY COPY.
  #
  # demo-config.json is what CONFIG.md links to and what the editor's
  # "load the example" button fetches, and until now nothing ran it: the
  # rename to `lines`/`line:` could have left it describing a schema the
  # plugin no longer reads and every test would still have passed. Run it
  # through the real transform against the repo's own ICS files.
  it 'demo-config.json, the example everyone copies, still draws a board' do
    cfg = File.read(File.join(Metro::ROOT, 'demo-config.json'), encoding: 'utf-8')
    parsed = JSON.parse(cfg)
    # The holiday feed is a real public URL, not a file in this repo.
    # It is not what this is testing, so answer it with nothing rather
    # than with a 404, which would put a service alert on the board.
    r = run_transform(serve_demo_files.call + [otherwise("BEGIN:VCALENDAR\nEND:VCALENDAR\n")], now,
                      base_input(now, use_demo_data: 'false', config_json: cfg))
    names = r['data']['legend'].map { it['name'] }.sort
    alert = r['data']['service_alert']
    assert(alert.nil? || alert == false || alert == '' || alert == 0,
           "the example board came up with a service alert: #{alert.to_json}")
    assert_equal(names, parsed['lines'].map { it['name'] }.sort,
                 'the example declares lines the board does not draw')
    titles = event_items(r['data']).map { it['title'] }
    assert(titles.length.positive?, 'the example board is empty')
    # Its two interesting rules: a class code routes a school entry and is
    # then stripped, and a family entry is shared by everyone named.
    assert(titles.none? { /\A(?:L6|K3)\s/.match?(it.to_s) },
           "a class code survived into a title: #{titles.join(', ')}")
    dinner = event_items(r['data']).find { /Family Dinner/.match?(it['title'].to_s) }
    if dinner
      assert_equal((dinner['co_owners'] || []).length, 4,
                   'Family Dinner is no longer the whole household')
    end
  end

  # ------------------------------------------------------------ the simple setup

  it 'a config that names no calendars shows the example day, as the settings promise' do
    ['{}', '{"version": 1}', '{"lines": [], "calendars": []}'].each do |text|
      r = run_transform(serve_demo_files.call, now, base_input(now, use_demo_data: 'false', config_json: text))
      assert(r['data']['legend'].length.positive?, "no example day for #{text}")
      # (null, not absent: the old comparison was of JSON, where a missing
      # key is not null)
      assert_equal(r['data'].fetch('board_notice', 'undefined'), nil, "a notice over the example day for #{text}")
    end
  end

  it 'text that is neither a config nor a link says so, instead of showing the example' do
    r = run_transform(serve_demo_files.call, now,
                      base_input(now, use_demo_data: 'false', config_json: 'my calendars'))
    assert_equal(r['data']['legend'].length, 0, 'the example was drawn over a broken paste')
    assert(/could not be read/.match?(r['data']['board_notice'] || ''), "no notice: #{r['data']['board_notice']}")
  end

  it 'a retired calendar_urls value is not drawn when Calendars is empty' do
    # TRMNL keeps a field's old value after the field leaves the form.
    r = run_transform(serve_demo_files.call, now, base_input(now,
                                                             use_demo_data: 'false', config_json: '',
                                                             calendar_urls: 'https://raw.githubusercontent.com/x/y/main/demo/friends/rachel.ics'))
    assert(r['data']['legend'].none? { /Rachel/.match?(it['name'].to_s) }, 'the retired box was read')
    assert(r['data']['legend'].length.positive?, 'no example day')
  end

  it 'a plain list of ICS links needs no JSON and no editor' do
    r = run_transform(serve_demo_files.call, now, base_input(now,
                                                             use_demo_data: 'false',
                                                             config_json: [
                                                               'https://raw.githubusercontent.com/x/y/main/demo/friends/monica.ics',
                                                               'https://raw.githubusercontent.com/x/y/main/demo/friends/rachel.ics'
                                                             ].join("\n")))
    names = r['data']['legend'].map { it['name'] }.sort
    # each calendar becomes its own line, named by the feed's own
    # X-WR-CALNAME (and, for a feed that carries none, by its URL)
    assert(names.join(',') == 'Demo - Monica,Demo - Rachel', "got [#{names.join(', ')}]")
    assert(event_items(r['data']).length.positive?, 'a bare URL list produced no events')
  end

  it 'a link to a feed with no name of its own is named from the link' do
    nameless = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n" \
               "BEGIN:VEVENT\r\nUID:n@x\r\nDTSTAMP:20240101T000000Z\r\nSUMMARY:Standup\r\n" \
               "DTSTART:20240101T090000\r\nDTEND:20240101T091500\r\n" \
               "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
    r = run_transform([otherwise(nameless)], now, base_input(now,
                                                             use_demo_data: 'false',
                                                             config_json: 'https://cloud.example.com/alex-work.ics'))
    assert(r['data']['legend'].map { it['name'] }.join(',') == 'Alex Work',
           "got #{r['data']['legend'].map { it['name'] }.join(', ')}")
  end
end
