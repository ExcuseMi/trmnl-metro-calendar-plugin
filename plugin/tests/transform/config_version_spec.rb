# frozen_string_literal: true

# THE CONFIGURATION FORMAT. Configurations are pasted into settings boxes and
# never edited again, so the format is pinned down here: what version 1 means,
# that the editor's shorter spelling of a calendar's owner draws the same
# board, and that the checker names what a configuration says that nothing
# reads.

require 'erb'

require_relative '../support/transform'

RSpec.describe 'config-version' do
  include Metro::Transform

  now = Time.iso8601('2026-09-15T14:00:00Z').to_i * 1000
  root = Metro::ROOT
  # migrateConfig and configWarnings are internal functions with no entry point of their own
  define_method(:migrate_config) do |cfg, hoist|
    internals('return T.migrateConfig(args.cfg, args.hoist);', now:, args: { cfg:, hoist: })
  end
  define_method(:config_warnings) { |cfg| internals('return T.configWarnings(args.cfg);', now:, args: { cfg: }) }

  ics_of = lambda do |rows|
    (['BEGIN:VCALENDAR', 'VERSION:2.0'] + rows + ['END:VCALENDAR', '']).join("\r\n")
  end
  feed = ics_of.call([
    'BEGIN:VEVENT', 'UID:1@x', 'SUMMARY:L2 - Zwemmen', 'DTSTART;TZID=Europe/Brussels:20260915T090000', 'DTEND;TZID=Europe/Brussels:20260915T100000', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:2@x', 'SUMMARY:Sportdag', 'DTSTART;TZID=Europe/Brussels:20260915T130000', 'DTEND;TZID=Europe/Brussels:20260915T140000', 'END:VEVENT'
  ])
  define_method(:payload) do |cfg, serve = nil, at = nil|
    t = at || now
    input = base_input(t, config_json: cfg.is_a?(String) ? cfg : JSON.generate(cfg))
    input['trmnl']['user']['time_zone_iana'] = 'Europe/Brussels'
    run_transform(serve || [otherwise(feed)], t, input)['data']
  end
  # a name nobody declared is JS's undefined: sorted last, and joined as nothing
  define_method(:by_line) do |d|
    nm = {}
    (d['legend'] || []).each { |l| nm[l['key']] = l['name'] }
    event_items(d).map do |e|
      owners = ([e['owner']] + (e['co_owners'] || [])).map { |k| nm[k] }
      [e['title'], owners.sort_by { [it.nil? ? 1 : 0, it.to_s] }.join('+')].join(' @ ')
    end.sort
  end

  it 'the format: a calendar says whose it is with line, and a rule naming a line leaves the title alone' do
    d = payload({ version: 1, lines: [{ name: 'Mia' }, { name: 'Noah' }],
                  calendars: [{ url: 'https://example.com/school.ics', name: 'School', line: %w[Mia Noah],
                                rules: [{ match: { type: 'word', value: 'L2' }, line: 'Mia' }] }] })
    assert_equal(by_line(d), ['L2 - Zwemmen @ Mia', 'Sportdag @ Mia+Noah'])
    assert_equal((d['legend'] || []).map { it['name'] }.sort, %w[Mia Noah], 'the calendar\'s name became a line')
  end

  it 'the format: title replaces the whole title, rewrite cuts, and name is a line only without lines' do
    d = payload({ version: 1, calendars: [{ url: 'https://example.com/school.ics', name: 'School',
                                            rules: [{ match: { type: 'regex', value: '^L\\d\\s*-\\s*' }, rewrite: '' }, { match: { type: 'contains', value: 'Sport' }, title: 'Sports day' }] }] })
    assert_equal(by_line(d), ['Sports day @ School', 'Zwemmen @ School'])
  end

  it 'a not written with matchers is read as none of them, not dropped' do
    d = payload({ version: 1, lines: [{ name: 'Mia' }], calendars: [{ url: 'https://example.com/school.ics', line: 'Mia',
                                                                      rules: [{ match: { type: 'not', matchers: [{ type: 'contains', value: 'Zwemmen' }] }, hide: true }] }] })
    assert_equal(by_line(d), ['L2 - Zwemmen @ Mia'])
  end

  # Every version 1 configuration this repository has, with the feeds it
  # draws from, migrated the way the editor migrates (hoisting the owner
  # rule into `line`) and as the plugin reads it.
  households = Dir.children(File.join(root, 'test/households')).sort
                  .select { File.exist?(File.join(root, 'test/households', it, 'config.json')) }
  households.each do |name|
    it "a household draws the same board with its owner rules said as line: #{name}" do
      dir = File.join(root, 'test/households', name)
      v1 = JSON.parse(File.read(File.join(dir, 'config.json')))
      v1.delete('version')
      # a feed is served by the last segment of its URL's path, from the
      # household's own folder; anything else is a 404
      serve = Dir.children(dir).sort.grep(/\.ics\z/).map do |f|
        [%r{/#{Regexp.escape(ERB::Util.url_encode(f))}(\?.*)?\z}, { body: File.read(File.join(dir, f)) }]
      end
      v2 = migrate_config(v1, true)
      assert_equal(v2['version'], 1)
      [now, now + 18 * 3_600_000].each do |at|
        a = payload(v1, serve, at)
        b = payload(v2, serve, at)
        assert_equal(by_line(b), by_line(a), 'the migrated configuration draws different events')
        assert_equal((b['all_day'] || []).map { it['title'] }.sort, (a['all_day'] || []).map { it['title'] }.sort, 'the all-day entries differ')
        assert_equal((b['legend'] || []).map { it['name'] }, (a['legend'] || []).map { it['name'] }, 'the lines differ')
      end
    end
  end

  %w[simpsons futurama friends].each do |name|
    it "a demo draws the same board with its owner rules said as line: #{name}" do
      v1 = JSON.parse(File.read(File.join(root, 'demo', name, 'config.json')))
      v1.delete('version')
      serve = demo_mocks
      v2 = migrate_config(v1, true)
      [now, now - 6 * 3_600_000].each do |at|
        a = payload(v1, serve, at)
        b = payload(v2, serve, at)
        assert(by_line(a).length.positive?, 'the demo drew nothing, so this proves nothing')
        assert_equal(by_line(b), by_line(a), 'the migrated demo draws different events')
        assert_equal((b['legend'] || []).map { it['name'] }, (a['legend'] || []).map { it['name'] }, 'the lines differ')
      end
    end
  end

  it 'the checker names keys nothing reads, unknown matches, bad patterns and lines that are not declared' do
    w = config_warnings({ version: 1, lines: [{ name: 'Mia' }], calender: [],
                          calendars: [{ url: 'https://x/a.ics', lines: 'Mia', line: 'Miao',
                                        rules: [{ match: { type: 'wrod', value: 'x' }, hide: true }, { match: { type: 'regex', value: '(' }, hide: true }, { match: { type: 'any' }, line: 'Mia', rename: false }] }] })
    all = w.join("\n")
    ['"calender"', '"lines" is not a setting', '"Miao" is not in lines', '"wrod" is not a kind of match', 'not a valid regular expression', '"rename" is not a setting'].each do |want|
      assert(all.include?(want), "the checker missed #{want}:\n#{all}")
    end
    assert_equal(config_warnings({ version: 1, lines: [{ name: 'Mia' }], calendars: [{ url: 'https://x/a.ics', line: 'Mia' }] }), [], 'a clean configuration has warnings')
  end
end
