# frozen_string_literal: true

# A configuration usually arrives here by being copied out of somewhere
# else: a chat window, a code block on a web page, an editor that helpfully
# straightens quotes. Every one of those leaves marks on the text, and
# strict JSON refuses all of them. The setting box is the only way in, so
# the parser has to read what people actually paste, not what a JSON file
# would have looked like.

require_relative '../support/transform'

RSpec.describe 'pasted-config' do
  include Metro::Transform

  now = Time.iso8601('2026-09-09T09:00:00Z').to_i * 1000
  url = 'https://cal.example.com/crew.ics'
  # anything else is a 404
  define_method(:crew) do
    [serve(url, ics_with_events([{ summary: 'Standup', start: '20260909T090000Z', end: '20260909T091500Z' }]))]
  end

  config = {
    lines: [{ name: 'Fry' }, { name: 'Leela' }],
    calendars: [{ url:, name: 'Crew', rules: [{ match: { type: 'contains', value: 'Fry:' }, line: 'Fry' }] }]
  }
  # JSON.stringify(x, null, 1)
  pretty_of = ->(value) { JSON.pretty_generate(value, indent: ' ') }
  pretty = pretty_of.call(config)

  # parseConfig is an internal function: called directly, in node. `body` is
  # JavaScript that says what to hand back of `cfg`, the parsed configuration.
  define_method(:parse) do |raw, body|
    internals("const cfg = T.parseConfig(args.raw);\n#{body}", now:, args: { raw: })
  end
  # what the config actually says, in the terms the rest of the pipeline
  # reads it in: two lines, one feed, one routing rule
  define_method(:shape) do |raw|
    parse(raw, <<~JS)
      return Object.keys(cfg.lines).map((k) => cfg.lines[k].name).join(',') + ' | '
        + cfg.calendars.map((c) => c.name + '@' + c.url + ':' + c.rules.length).join(',');
    JS
  end
  define_method(:want) { shape(pretty) }

  it 'a configuration pasted as plain JSON reads, as it always did' do
    assert_equal(want, "Fry,Leela | Crew@#{url}:1", 'the fixture itself does not parse')
  end

  # The one that sent us here. A chat client that escapes its answer for
  # markdown writes every bracket as \[ and \], and ends every line with a
  # backslash. None of that is JSON, and all of it is on the clipboard.
  it 'a configuration escaped for markdown still reads' do
    escaped = pretty
              .gsub(/([\[\]{}])/) { "\\#{Regexp.last_match(1)}" }
              .split("\n", -1).join("\\\n")
    assert(escaped.include?('\\['), 'the fixture is not actually escaped')
    assert_equal(shape(escaped), want, 'markdown escaping ate the configuration')
  end

  it 'a configuration still wrapped in its code fence reads' do
    assert_equal(shape("```json\n#{pretty}\n```"), want, 'the fence ate the configuration')
    # and with the assistant talking either side of it
    assert_equal(shape("Here you go:\n\n```json\n#{pretty}\n```\n\nPaste that in."), want,
                 'a fenced block in the middle of a reply was not found')
  end

  it 'quotes an editor straightened, and a trailing comma, still read' do
    curly = pretty.gsub('"') { Regexp.last_match.begin(0).odd? ? '”' : '“' }
    assert_equal(shape(curly), want, 'typographic quotes ate the configuration')
    assert_equal(shape(pretty.sub(/\}\n\s*\]\n\}\z/, "},\n ]\n}")), want,
                 'a trailing comma ate the configuration')
    assert_equal(shape(pretty.gsub(' ', " ").gsub(" \"", ' "')), want,
                 'non-breaking spaces ate the configuration')
  end

  # A backslash IS legal in JSON, inside a string, and a regex rule is
  # nothing but backslashes. Un-escaping markdown must not touch those.
  it 'a regex rule survives the tidying' do
    with_regex = pretty_of.call({
                                  calendars: [{ url:, name: 'Crew', rules: [{ match: { type: 'regex', value: '^\\d+ ' }, line: 'Fry' }] }]
                                })
    cfg = parse(with_regex.gsub(/([\[\]])/) { "\\#{Regexp.last_match(1)}" }, <<~JS)
      return { calendars: cfg.calendars.length, rules: cfg.calendars[0] ? cfg.calendars[0].rules.length : null };
    JS
    assert_equal(cfg['calendars'], 1, 'the escaped config did not parse at all')
    assert_equal(cfg['rules'], 1, 'the regex rule was lost')
  end

  it 'a plain list of links is still a plain list of links' do
    urls = parse("https://a.example/x.ics\nwebcal://b.example/y.ics\n", 'return cfg.calendars.map((c) => c.url);')
    assert_equal(urls,
                 ['https://a.example/x.ics', 'webcal://b.example/y.ics'], 'the simple setup broke')
  end

  # The list with names in front: the names are the lines, in the order
  # they were first written, a repeated name is one line with two feeds,
  # and a bare link beside named ones belongs to everybody.
  it 'a name before a link puts that calendar on that line' do
    cfg = parse("Alex  https://a.example/x.ics\nSam https://b.example/y.ics\nSam webcal://b.example/z.ics\n   https://c.example/family.ics\nhttps://d.example/be.ics holiday\n", <<~JS)
      return { names: Object.values(cfg.lines).map((l) => l.name),
        calendars: cfg.calendars.map((c) => (c.owner || []).join('+') + '@' + c.url + (c.holiday ? ' holiday' : '')) };
    JS
    assert_equal(cfg['names'], %w[Alex Sam], 'the names are not the lines')
    assert_equal(cfg['calendars'],
                 ['Alex@https://a.example/x.ics', 'Sam@https://b.example/y.ics', 'Sam@webcal://b.example/z.ics', '@https://c.example/family.ics', '@https://d.example/be.ics holiday'],
                 'the calendars are not on the lines the list said')
  end

  it 'a two-word name and a comment line both read as meant' do
    cfg = parse("# the kids\nAunt May https://a.example/x.ics\n", <<~JS)
      return { names: Object.values(cfg.lines).map((l) => l.name), calendars: cfg.calendars.length };
    JS
    assert_equal(cfg['names'], ['Aunt May'], 'the name was cut at the space')
    assert_equal(cfg['calendars'], 1, 'the comment line became a calendar')
  end

  # Which box is read is the switch's to say. A hidden box keeps its old
  # text, so a list left behind in Calendar Links must not draw over a
  # configuration that was chosen, and the other way round.
  it 'the Set Up With switch says which box is read' do
    list = "Fry #{url}\n"
    jsoncfg = JSON.generate({ lines: [{ name: 'Leela' }], calendars: [{ url:, line: 'Leela' }] })
    both = { use_demo_data: 'false', calendar_list: list, config_json: jsoncfg }
    links = run_transform(crew, now, base_input(now, { setup_mode: 'links' }.merge(both)))
    assert_equal(links['data']['legend'].map { it['name'] }, ['Fry'], 'links mode read the configuration')
    config = run_transform(crew, now, base_input(now, { setup_mode: 'config' }.merge(both)))
    assert_equal(config['data']['legend'].map { it['name'] }, ['Leela'], 'config mode read the list')
    # A device from before the switch existed has no answer in it: the
    # box it always read comes first, the new one is the fallback.
    older = run_transform(crew, now, base_input(now, both))
    assert_equal(older['data']['legend'].map { it['name'] }, ['Leela'], 'an older device lost its configuration')
    only_list = run_transform(crew, now, base_input(now, use_demo_data: 'false', calendar_list: list))
    assert_equal(only_list['data']['legend'].map { it['name'] }, ['Fry'], 'an older device did not fall back to the list')
  end

  # Unreadable text says which box it was in, because the advice differs:
  # a list wants a name and a link per row, a configuration wants copying
  # again from the setup helper.
  it 'unreadable text is reported for the box it was read from' do
    list = run_transform(crew, now, base_input(now, use_demo_data: 'false', setup_mode: 'links', calendar_list: 'just some words'))
    assert(/\AThe Calendars setting/.match?(list['data']['board_notice'] || ''), "the list box was not named: #{list['data']['board_notice']}")
    cfg = run_transform(crew, now, base_input(now, use_demo_data: 'false', setup_mode: 'config', config_json: '{ "calendars": [ oops'))
    assert(/\AThe Configuration setting/.match?(cfg['data']['board_notice'] || ''), "the configuration box was not named: #{cfg['data']['board_notice']}")
  end

  # Text that opens with a brace meant to be a configuration. Reading its
  # lines as URLs finds no URLs and draws a board of nothing, which looks
  # like the plugin is broken rather than like the config is. Nothing
  # usable means nothing usable, and the caller falls back to the demo.
  it 'a configuration too broken to read is not mistaken for a list of links' do
    count = parse("{ \"calendars\": [ { \"url\": \"#{url}\" oops ] }", 'return cfg.calendars.length;')
    assert_equal(count, 0, 'a broken configuration was read as URLs')
  end

  it 'a board builds from a configuration that arrived escaped' do
    escaped = pretty_of.call({
                               lines: [{ name: 'Fry' }],
                               calendars: [{ url:, name: 'Fry', rules: [{ match: { type: 'any' }, line: 'Fry' }] }]
                             }).gsub(/([\[\]])/) { "\\#{Regexp.last_match(1)}" }
    r = run_transform(crew, now, base_input(now, use_demo_data: 'false', config_json: escaped))
    assert_equal(r['data']['legend'].map { it['name'] }, ['Fry'], 'the board is not the one the config asked for')
    assert_equal(event_items(r['data']).map { it['title'] }, ['Standup'], 'the events did not arrive')
  end
end
