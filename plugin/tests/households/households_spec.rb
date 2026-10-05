# frozen_string_literal: true

# SIX INVENTED HOUSEHOLDS, THROUGH THE WHOLE PIPELINE.
#
#   ./test.sh trmnl tests/households                 the feed checks and every board
#
# Each test/households/<slug>/ holds the ICS files a real household's feeds
# would serve and the config.json a careful user would write for them. This
# runs transform.js over them in trmnlp's runtime (each feed answered from the
# folder by the last segment of its URL, the language files from the repo, no
# weather) at several board times, and asks whether the payload says what the
# feeds say (an ended COUNT series is gone, an EXDATE holds, the bins are one
# stop...): those FAIL.
#
# The boards are the second half: every payload laid out on six views in the
# real page, with lines, shed, muddle, dropped lines and the board's own
# faults written to the console. Shed, muddle and dropped lines are REPORTED
# -- these are invented households and a shed caption on one is information,
# not a regression. A FAULT FAILS, except the ones in KNOWN below.
#
# KNOWN: KEEP EVERY PERSON. On the smallest slots a household of five to
# seven lines cannot have every name clear of every other and everybody on
# the board; every way of clearing these names that was measured left a
# person off instead (MAINTENANCE.md). The owner chose the people: these six
# boards keep a name written on a name or a rail through one. They are shown
# and do not fail; if one stops faulting it fails, so the list is taken down
# as boards get better, and any other fault fails at once.

require 'cgi'

require_relative '../support/transform'
require_relative '../support/layout'

module Households
  DIR = File.join(Metro::ROOT, 'test', 'households')
  KNOWN = {
    'multigen-chicago sat-0800 og-landscape' => ['namecut:  / p1'],
    'multigen-chicago wed-0800 og-half-vertical' => ['names:  / Zoe'],
    'multigen-chicago sat-0800 og-half-vertical' => ['names: Eli / Zoe'],
    'multigen-chicago wed-0800 og-quadrant' => ['names:  / Zoe'],
    'single-parent-be sat-0800 og-half-horizontal' => ['names: Liesbeth / Fien'],
    'single-parent-be sat-0800 og-quadrant' => ['namecut: L / p2']
  }.freeze
  SLUGS = Dir.children(DIR).select { File.exist?(File.join(DIR, it, 'config.json')) }.sort.freeze

  TIMES = [
    { key: 'tue-0730', date: '2026-09-15', hm: '07:30' },
    { key: 'tue-1200', date: '2026-09-15', hm: '12:00' },
    { key: 'tue-1630', date: '2026-09-15', hm: '16:30' },
    { key: 'tue-2130', date: '2026-09-15', hm: '21:30' },
    { key: 'wed-0800', date: '2026-09-16', hm: '08:00' },
    { key: 'sat-0800', date: '2026-09-19', hm: '08:00' }
  ].freeze
  OG = Metro::Layout::OG
  X = Metro::Layout::X
  VIEWS = [
    { name: 'x-landscape', classes: X },
    { name: 'x-portrait', classes: "#{X} screen--portrait" },
    { name: 'og-landscape', classes: OG },
    { name: 'og-half-horizontal', page: 'half_horizontal', classes: OG },
    { name: 'og-half-vertical', page: 'half_vertical', classes: OG },
    { name: 'og-quadrant', page: 'quadrant', classes: OG }
  ].freeze

  module_function

  # ---------------------------------------------------------------- transform

  # Local wall-clock time in `tz` to epoch ms.
  def local_to_epoch(date, hm, tz)
    y, mo, d = date.split('-').map(&:to_i)
    h, mi = hm.split(':').map(&:to_i)
    ActiveSupport::TimeZone[tz].local(y, mo, d, h, mi).to_i * 1000
  end

  # the last segment of a feed's URL, as the file it is served from
  def feed_file(url) = CGI.unescapeURIComponent(url.to_s.split('?').first.split('/').last || '')

  def feed_urls(cfg) = (cfg['calendars'] || []).map { it.is_a?(String) ? it : it['url'] }

  # A feed is served by the last segment of its URL's path, from the
  # household's own folder; a translation from the repo's i18n/.
  def mocks_for(dir, cfg)
    seen = {}
    mocks = feed_urls(cfg).filter_map do |url|
      base = feed_file(url)
      file = File.join(dir, base)
      next if !base.end_with?('.ics') || !File.exist?(file) || seen[base]

      seen[base] = true
      encoded = base.gsub(/[^A-Za-z0-9._-]/) { CGI.escapeURIComponent(it) }
      [%r{/#{Regexp.escape(encoded)}(\?.*)?\z}, { body: File.read(file) }]
    end
    mocks + Metro::Demo.demo_mocks.select { |url, _| url.include?('/i18n/') }
  end

  # ---------------------------------------------------------------- payload helpers

  # The payload as the checks read it: every event and all-day row with the
  # names of who it belongs to.
  class View
    attr_reader :data, :events, :all_day, :lines, :holidays

    def initialize(data)
      name = (data['legend'] || []).to_h { [it['key'], it['name']] }
      @data = data
      @events = (data['events'] || []).map do |e|
        e.merge('who' => ([e['owner']] + (e['co_owners'] || [])).map { name[it] || it }.sort_by(&:to_s))
      end
      @all_day = (data['all_day'] || []).map do |a|
        a.merge('who' => (a['owners'] || []).map { name[it] || it }.sort_by(&:to_s))
      end
      @lines = (data['legend'] || []).map { it['name'] }
      @holidays = data['holidays'] || []
    end

    def find(re, day = nil)
      events.select { |e| re.match?(e['title'].to_s) && (day.nil? || e['start_min'].fdiv(1440).floor == day) }
    end

    def find_all_day(re, day = nil)
      all_day.select { |a| re.match?(a['title'].to_s) && (day.nil? || (a['day'] || 0) == day) }
    end
  end

  def who(row) = row['who'].join(',')

  def hhmm(min)
    min = (min + 0.5).floor
    m = min % 1440
    d = min.div(1440)
    prefix = if d.positive? then "+#{d}d"
             elsif d.negative? then "#{d}d"
             else ''
             end
    format('%s%02d:%02d', prefix, m / 60, m % 60)
  end

  # ---------------------------------------------------------------- what the feeds say

  # Each returns a list of [ok, message]. `at.(key)` is the view of that time's payload.
  CHECKS = {
    'single-parent-be' => lambda do |at|
      v = at.('tue-1630')
      w = at.('tue-2130')
      s = at.('sat-0800')
      bins = v.find(/PMD|Papier|Glas/, 0)
      out = []
      out << [bins.length == 1, "bins due 19:00 merged into ONE stop (got #{bins.length}: #{bins.map { "#{it['title']}@#{hhmm(it['start_min'])}" }.join(', ')})"]
      out << [!bins.empty? && bins[0]['start_min'] == 19 * 60, "bins at 19:00 wall clock despite Z (got #{bins[0] ? hhmm(bins[0]['start_min']) : '-'})"]
      out << [!bins.empty? && truthy(bins[0]['todo']) && (bins[0]['parts'] || []).length == 3, "bins stop is a task with 3 parts (#{(bins[0] && bins[0]['parts']).to_json})"]
      out << [v.find(/Restafval/, 0).empty?, 'completed Restafval task (14 Sep) is absent']
      out << [v.find(/5A|6B|Technopolis/).empty? && v.find_all_day(/Technopolis/).empty?, 'other classes (5A, 6B, 3C) hidden']
      out << [v.find(/\AZwemmen\z/, 0).any? { who(it) == 'Jonas' }, '5B Zwemmen -> Jonas, code stripped']
      out << [v.find(/\ABibliotheek\z/, 0).any? { who(it) == 'Fien' }, '2A Bibliotheek -> Fien']
      out << [v.find(/schoolfotograaf/i, 0).any? { who(it) == 'Fien,Jonas' }, 'Alle klassen: schoolfotograaf shared by both kids']
      out << [v.find(/Teamoverleg/, 0).length == 1 && v.find(/Teamoverleg/, 0)[0]['start_min'] == 690, 'RECURRENCE-ID moves Teamoverleg to 11:30 once']
      out << [v.find(/Kapper/).empty?, 'cancelled Kapper hidden']
      woe = w.find(/Woensdagnamiddag/, 1)
      out << [woe.length == 1 && who(woe[0]) == 'Fien,Jonas', 'INTERVAL=2 Wednesday afternoon at papa appears tomorrow for both kids (21:30 board)']
      # a week is a state of the line, at its head, not a stop on the clock
      papa = s.find_all_day(/Kinderen bij Pieter/)
      out << [papa.length >= 1 && s.find(/Kinderen bij Pieter/).empty?, "custody week that began Fri 18:00 (INTERVAL=2) is at the head of Saturday's board (got #{papa.length})"]
      out << [at.('tue-1630').find(/Kinderen bij Pieter/, 0).empty?, 'no custody block on an off week (Tue 15)']
      out
    end,
    'nurse-couple-uk' => lambda do |at|
      v = at.('tue-1630')
      m = at.('tue-0730')
      w = at.('wed-0800')
      out = []
      night = v.find(/Night/, 0)
      out << [night.length == 1 && night[0]['start_min'] == (19 * 60) + 30 && night[0]['end_min'] == 1440 + (8 * 60), "Tue night shift 19:30 -> Wed 08:00 spans midnight (got #{night.map { "#{it['start_min']}-#{it['end_min']}" }.join(',')})"]
      out << [w.find(/Night/).any? { it['start_min'].negative? || it['start_min'].zero? || it['end_min'] == 8 * 60 }, 'Wed 08:00 board still shows the night shift ending at 08:00 (it started yesterday)']
      out << [m.find(/Pilates/, 0).length == 1, 'Pilates COUNT=8 week 3 present']
      out << [m.find(/Spin/).empty?, 'Spin class COUNT=8 (ended Aug) absent']
      out << [v.find(/Book club/, 0).length == 1, 'Book club BYDAY=3TU present on 15 Sep']
      out << [v.find(/Choir/).empty?, 'Choir BYDAY=2TU absent on 15 Sep']
      su = m.find(/stand-up/i, 0)
      out << [su.length == 1 && su[0]['start_min'] == (9 * 60) + 45, "stand-up moved to 09:45 by RECURRENCE-ID, once (got #{su.map { hhmm(it['start_min']) }.join(',')})"]
      out << [v.find(/Marcus/).empty?, 'cancelled 1:1 hidden']
      out << [at.('sat-0800').find(/Early|LD|Long day/, 0).length >= 1, 'Sat early shift present']
      out << [at.('tue-2130').find(/Football|5-a-side/).empty?, '5-a-side past UNTIL absent']
      out
    end,
    'multigen-chicago' => lambda do |at|
      v = at.('tue-1200')
      s = at.('sat-0800')
      out = []
      out << [v.data['hour12'] == true, '12h clock']
      out << [v.lines.length == 7, "7 lines (got #{v.lines.join(',')})"]
      out << [v.find(/\APiano/, 0).any? { who(it) == 'Mia' }, 'Mia: Piano routed to Mia and prefix stripped']
      out << [v.find(/Cardiology/, 0).any? { who(it) == 'Walt' }, 'Grandpa: routed to Walt']
      out << [v.find(/\A(Mia|Eli|Zoe|Grandpa|Grandma|Mom|Dad|Everyone)\b.*:/).empty?, "no name prefix left in any title (#{v.find(/\A[A-Z][a-z]+( & [A-Z][a-z]+)?:/).map { it['title'] }.join(' | ')})"]
      out << [v.find(/PT|Physical therapy/i, 0).length == 1, 'Grandma PT COUNT=12 still running on 15 Sep']
      dinner = s.find(/Aunt Carol/, 0)
      out << [dinner.length == 1 && dinner[0]['who'].length == 7, 'Everyone: dinner shared by all 7']
      out << [at.('tue-2130').find(/Dentist/, 1).any? { who(it) == 'Eli,Mia' }, 'Mia & Eli: Dentist shared by the two']
      out << [at.('tue-1630').find(/Rx|prescription/i, 0).length == 1, 'Rx pickup task present']
      out
    end,
    'flatshare-berlin' => lambda do |at|
      v = at.('tue-1200')
      w = at.('tue-2130')
      s = at.('sat-0800')
      out = []
      tob = v.events.select { it['who'].include?('Tobias') }
      out << [v.lines.include?('Tobias') == !tob.empty?, "Tobias (hideIfEmpty) in the legend only when he has something today or tomorrow (lines #{v.lines.join(',')}; his: #{tob.map { it['title'] }.join(',')})"]
      out << [s.lines.include?('Tobias'), 'Tobias present on Saturday']
      party = w.find(/Party/i, 1)
      out << [party.length == 1 && party[0]['who'].length >= 3, "WG-Party tomorrow is one shared event (got #{party.map { it['who'].join('+') }.join(' | ')})"]
      out << [v.find(/.*/, 0).count { who(it) == 'Moritz' } >= 6, 'Moritz has his 6 back-to-back lectures']
      out << [v.all_day.any? { /Küche|Putz/.match?(it['title'].to_s) } || !v.find(/Putz|Küche/).empty?, 'chores rotation (multi-day all-day, INTERVAL=4, series began in July) shows this week']
      out << [w.find(/Homeoffice/, 1).length == 1, "weekday rule (WE) rewrites tomorrow's Werkstudentin block as Homeoffice"]
      out << [v.find(/Werkstudentin|Homeoffice/, 0).all? { /Werkstudentin/.match?(it['title'].to_s) }, 'weekday rule (WE) does not fire on Tuesday']
      out << [v.find(/Lerngruppe/).empty?, 'cancelled Lerngruppe hidden']
      out
    end,
    'remote-freelance-lyon' => lambda do |at|
      v = at.('tue-1200')
      out = []
      noisy = v.events.select { /\[(Teams|Zoom)\]|\A(RE|TR|FW)\s*:|zoom\.us|\[[A-Z]+-\d+\]/i.match?(it['title'].to_s) }
      out << [noisy.empty?, "no [Teams]/[Zoom]/RE:/ticket noise left in titles (#{noisy.map { it['title'] }.join(' | ')})"]
      out << [v.find(/Focus|Pause café/).empty?, 'Focus time and coffee hidden']
      out << [v.find(/Annulé|Point de fin de journée/).empty?, 'cancelled meeting hidden']
      hq = v.find(/London HQ/, 0)
      out << [hq.length == 1 && hq[0]['start_min'] == (14 * 60) + 30, "London HQ sync written in \"GMT Standard Time\" lands at 14:30 Paris (got #{hq.map { hhmm(it['start_min']) }.join(',')})"]
      dog = v.find(/Biscuit/, 0)
      out << [dog.length == 1 && dog[0]['who'].length == 2, 'dog walker shared by both']
      camille = v.events.count { who(it) == 'Camille' && it['start_min'] < 1440 }
      out << [camille >= 10, "Camille has 10+ meetings today (#{camille})"]
      julien = v.events.count { who(it) == 'Julien' && it['start_min'] < 1440 }
      out << [julien >= 10, "Julien has 10+ meetings today (#{julien})"]
      su = v.find(/Standup client ACME/, 0)
      out << [su.length == 1 && su[0]['start_min'] == (8 * 60) + 15, 'ACME standup moved to 08:15 by RECURRENCE-ID']
      out
    end,
    'family-five-nl' => lambda do |at|
      v = at.('tue-1630')
      n = at.('tue-2130')
      w = at.('wed-0800')
      s = at.('sat-0800')
      out = []
      out << [v.holidays.any? { /Prinsjesdag/.match?(it['title'].to_s) && it['day'] == 0 }, "Prinsjesdag in the header on 15 Sep (#{v.holidays.to_json})"]
      out << [v.lines.include?('Pim'), 'quiet toddler Pim kept (hideIfEmpty false)']
      sw = v.find_all_day(/Studieweek|vrij/i, 0)
      out << [!sw.empty? && sw.all? { who(it) == 'Daan,Lotte' } && v.holidays.none? { /Studie/.match?(it['title'].to_s) }, "school week off at Daan and Lotte's heads, not the header (#{sw.map { [it['title'], it['who']] }.to_json})"]
      film = n.find(/Film/, 0)
      out << [film.length == 1 && film[0]['end_min'] > 1440, "teen film crosses midnight (end #{film[0] && film[0]['end_min']})"]
      out << [!w.find_all_day(/Riet/, 0).empty? || !w.find(/Riet/, 0).empty?, 'yearly birthday (2016 series) on 16 Sep']
      trip = s.find_all_day(/Kempervennen|Center Parcs/, 0)
      out << [!trip.empty?, 'multi-day trip on Saturday']
      out << [s.find(/Hockeywedstrijd/, 0).empty?, 'EXDATE removes Saturday hockey match during the trip']
      out << [s.events.any? { /Feest/.match?(it['title'].to_s) && it['end_min'] > 1440 }, 'Saturday party crosses midnight']
      out << [v.lines.length == 5, "5 lines, no leaked calendar line (#{v.lines.join(',')})"]
      out
    end
  }.freeze

  # what JavaScript's !! says of a JSON value
  def truthy(value) = !(value.nil? || value == false || value == 0 || value == '')
end

RSpec.describe 'households' do
  include Metro::Transform
  include Metro::Layout

  define_method(:transform_at) do |slug, t|
    dir = File.join(Households::DIR, slug)
    cfg_text = File.read(File.join(dir, 'config.json'))
    cfg = JSON.parse(cfg_text)
    tz = cfg['timeZone'] || 'UTC'
    now_ms = Households.local_to_epoch(t[:date], t[:hm], tz)
    input = { 'trmnl' => {
      'user' => { 'locale' => (cfg['locale'] || 'en').split('-').first, 'time_zone_iana' => tz },
      'plugin_settings' => { 'instance_name' => 'Household',
                             'custom_fields_values' => { 'use_demo_data' => 'false', 'config_json' => cfg_text } }
    } }
    run = trmnl.plugin(Metro::Transform.plugin_without_defaults)
               .transform(**options_for(input, Households.mocks_for(dir, cfg), now_ms))
    assert(run.error.nil? && run.data.is_a?(Hash) && run.data['data'].is_a?(Hash),
           "#{slug} #{t[:key]}: the transform failed: #{run.error}\n#{run.log.join("\n")}")
    expect(run).to stay_within_serverless_limits
    { data: run.data['data'], cfg:, dir: }
  end

  # ---------------------------------------------------------------- the feed checks

  Households::SLUGS.each do |slug|
    it "· #{slug} · the payload says what the feeds say" do
      soft = []
      payloads = {}
      Households::TIMES.each do |t|
        r = transform_at(slug, t)
        d = payloads[t[:key]] = r[:data]
        down = d['calendars_down'] || []
        soft << "#{slug} #{t[:key]}: calendars down: #{down.to_json}" unless down.empty?
        soft << "#{slug} #{t[:key]}: transform fell back to the demo" if d.key?('demo_partial')
        missing = Households.feed_urls(r[:cfg]).reject { File.exist?(File.join(r[:dir], Households.feed_file(it))) }
        soft << "#{slug}: config names feeds with no local file: #{missing.to_json}" unless missing.empty?
      end
      check = Households::CHECKS[slug]
      if check
        results = check.call(->(k) { Households::View.new(payloads[k] || raise("no payload for #{k}")) })
        results.each do |ok, msg|
          puts "#{ok ? '  ok   ' : '  FAIL '}#{slug}: #{msg}"
          soft << "#{slug}: #{msg}" unless ok == true
        end
      end
      assert(soft.empty?, soft.join("\n"))
    end
  end

  # ---------------------------------------------------------------- the boards, reported

  Households::SLUGS.each do |slug|
    Households::TIMES.each do |t|
      it "· #{slug} · #{t[:key]} · every board" do
        d = transform_at(slug, t)[:data]
        name_of = (d['legend'] || []).to_h { [it['key'], it['name']] }
        soft = []
        Households::VIEWS.each do |v|
          dbg = render(d, v)['debug']
          row = { view: v[:name], lines: (d['legend'] || []).length, shed: dbg['shed'] || 0, muddle: dbg['muddle'] || 0,
                  dropped: (dbg['dropped'] || []).map { name_of[it] || it }, faults: dbg['faults'] || [] }
          key = "#{slug} #{t[:key]} #{v[:name]}"
          puts "#{key}: #{row.to_json}"
          known = Households::KNOWN[key]
          if known
            puts "known fault: #{key}: #{known.join('; ')}"
            unless row[:faults] == known
              soft << "#{key} no longer has its known fault: take it out of KNOWN: expected #{known.to_json}, got #{row[:faults].to_json}"
            end
          elsif !row[:faults].empty?
            soft << "#{key}: the board knows it is wrong: #{row[:faults].to_json}"
          end
        end
        assert(soft.empty?, soft.join("\n"))
      end
    end
  end
end
