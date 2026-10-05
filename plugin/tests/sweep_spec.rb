# frozen_string_literal: true

# THE BOARDS THE DEVICE ACTUALLY DRAWS, ACROSS EVERY VIEW.
#
#   ./test.sh trmnl tests/sweep_spec.rb                every board
#   ./test.sh trmnl tests/sweep_spec.rb -e futurama     one example day
#   ./test.sh trmnl --update tests/sweep_spec.rb    write today's numbers as the baseline
#
# The other suites ask about boards somebody wrote down: the layout specs lay
# out fixtures, the households report lays out six invented households. This
# one takes the three example days the plugin ships -- the same payloads a
# reader with no calendars sees -- through the real transform (trmnlp's own
# node wrapper, the demo's files answered from disk), at five times of day,
# and draws each on all six views in trmnlp's Firefox. It is the sweep
# that found "School Day" written across "Grocery Run" on the flat slot: a
# fault none of the fixtures had ever produced, on the payload the device was
# rendering that minute.
#
# IN THE REAL PAGE, NOT IN JSDOM. It used to lay the payloads out in node
# with test/boards' width table, and printed "90/90 clean". Drawn in the real
# page with the real faces, the same payloads disagreed on 27 of the 90
# boards (fewer captions keeping their time on the OG, a person dropped on a
# half slot) and SIX X-landscape boards, the view this plugin is designed for,
# carry `onbar` faults the jsdom board never had. The old layout harness, in
# its own headless Chromium, reports the same faults on the same payloads, so
# it is the page and not this harness. The losses baseline was re-blessed from
# the real page when the sweep moved (the jsdom numbers measured a different
# board); the faults were left failing, because they are what a reader sees.
#
# ONE BOARD USED TO FLIP between two answers from run to run (simpsons
# 07:30 og-half-horizontal): the feeds were read in whichever order they
# answered, so the same day made a different payload. They are read in the
# config's order now (transform/order.spec.js), and the console line still
# prints `runs`, how many times the page laid the board out.
#
# Faults FAIL here, unlike the households report: these are the plugin's own
# example days, and a fault in one of them is a fault a new reader sees.
#
# ...AND SO DOES LOSING ANYTHING, WHICH IS WHAT THIS DID NOT ASK FOR A LONG
# TIME. A fault is a board that is WRONG -- two names on each other, a rail
# through a word. It is not the only way a board gets worse, and it is not
# even the common one: the common one is that something quietly stops being
# drawn. A caption shed, a person dropped, a caption that gave up the time
# under its name. None of those is a fault, none of them was asked about
# here, and the sweep went on printing "90/90 clean" through a change that
# shed four captions across these very boards. It reached a real panel.
#
# So every board's losses are recorded in sweep.baseline.json and compared,
# and a board fails when any of them gets worse. It is a ratchet, not a
# target: the numbers are what the boards happen to cost today, several of
# them are not zero, and the point is only that they never grow without
# somebody saying so.
#
# Bless (--update) deliberately, and never to make a red run green: read what moved
# first. A number that goes DOWN is a win and still needs blessing, which is
# the cost of the ratchet holding in the other direction.

require_relative 'support/demo'
require_relative 'support/page'

module Sweep
  SETS = %w[simpsons futurama friends].freeze
  TIMES = %w[07:30 12:00 16:30 21:30 23:40].freeze
  VIEWS = {
    'x-landscape' => { device: 'v2', view: 'full' },
    'x-portrait' => { device: 'v2', view: 'full', orientation: :portrait },
    'og-landscape' => { device: 'og_png', view: 'full' },
    'og-half-horizontal' => { device: 'og_png', view: 'half_horizontal' },
    'og-half-vertical' => { device: 'og_png', view: 'half_vertical' },
    'og-quadrant' => { device: 'og_png', view: 'quadrant' }
  }.freeze

  BASELINE = File.join(__dir__, 'sweep.baseline.json')
  UPDATING = !ENV['TRMNLP_UPDATE_SNAPSHOTS'].to_s.empty?

  # Which way each one is allowed to move.
  WORSE = {
    'shed' => ->(was, now) { now > was },
    'dropped' => ->(was, now) { now > was },
    'caps' => ->(was, now) { now < was },
    'timed' => ->(was, now) { now < was }
  }.freeze
  MEANS = {
    'shed' => 'caption(s) not placed', 'dropped' => 'person/people off the board',
    'caps' => 'caption(s) drawn', 'timed' => 'caption(s) with their time'
  }.freeze

  MOCKS = Metro.mock_table(Metro::Demo.demo_mocks + [Metro::Demo::NOT_FOUND]).freeze

  module_function

  # WHAT A BOARD LOSES, as four numbers. Each is a thing the reader does not
  # get: a caption that could not be placed, a person left off the map
  # entirely, a caption drawn without the time under its name -- and how many
  # captions were drawn at all, which is the one that has to go UP. Read off
  # the page: the solver's own record for the first two, the drawn captions
  # (`.metro-label`, and whether each carries its clock) for the others.
  def losses(rep)
    caps = rep['labels'].select { " #{it['cls']} ".include?(' metro-label ') }
    {
      'shed' => rep['debug']['shed'] || 0,
      'dropped' => (rep['debug']['dropped'] || []).length,
      'caps' => caps.length,
      'timed' => caps.count { !it['timeCls'].to_s.empty? }
    }
  end

  def baseline
    JSON.parse(File.read(BASELINE))
  rescue SystemCallError, JSON::ParserError
    {}
  end

  # The baseline is one file and the boards may run in several processes: a
  # blessing one rewrites its own entry under a lock.
  def bless(key, lost)
    File.open("#{BASELINE}.lock", File::RDWR | File::CREAT) do |lock|
      lock.flock(File::LOCK_EX)
      all = baseline.merge(key => lost)
      File.write(BASELINE, "#{JSON.pretty_generate(all.sort.to_h)}\n")
    end
  ensure
    FileUtils.rm_f("#{BASELINE}.lock")
  end
end

RSpec.describe 'sweep' do
  Sweep::SETS.product(Sweep::TIMES, Sweep::VIEWS.keys).each do |set, time, on|
    key = "#{set} #{time} #{on}"
    it "sweep · #{key}" do
      h, mi = time.split(':').map(&:to_i)
      screen = trmnl.render(
        **Sweep::VIEWS[on], **Metro::Page::PAGE,
        # America/Chicago in September is UTC-5
        now: Time.utc(2026, 9, 15, 0, 0) + ((h + 5) * 3600) + (mi * 60),
        variables: { trmnl: { user: { time_zone_iana: 'America/Chicago', locale: 'en-US' },
                              plugin_settings: { instance_name: 'Metro' } } },
        custom_fields: { use_demo_data: 'true', demo_set: set, time_format: '12h' },
        mocks: Sweep::MOCKS
      )
      expect(screen.result.error).to be_nil
      expect(screen.result).to stay_within_serverless_limits
      metro = screen.result.data && screen.result.data['data']
      assert(((metro && metro['legend']) || []).length.positive?, 'the example day came back empty')
      rep = Metro::Page.report(screen)

      lost = Sweep.losses(rep)
      Sweep.bless(key, lost) if Sweep::UPDATING
      was = Sweep.baseline[key]
      # A board the baseline has never seen is recorded (--update) and not
      # judged: a new view or a new example day is not a regression in the
      # ones that were already there.
      slipped = []
      if was && !Sweep::UPDATING
        Sweep::WORSE.each do |k, worse|
          next if was[k].nil? || !worse.(was[k], lost[k])

          slipped << "#{k} #{was[k]} -> #{lost[k]}  (#{Sweep::MEANS[k]})"
        end
      end
      faults = rep['debug']['faults']
      puts "#{slipped.empty? && faults.empty? ? 'ok   ' : 'FAIL '}#{key.ljust(36)} runs #{rep['debug']['runs']} " \
           "#{lost.to_json}#{" was #{was.to_json}" if was}#{" faults #{faults.to_json}" unless faults.empty?}"
      aggregate_failures do
        assert(faults.empty?, "#{key}: the board knows it is wrong: #{faults.to_json}")
        assert(slipped.empty?, "#{key} lost something. If it is meant, read it, then: " \
                               "./test.sh trmnl --update tests/sweep_spec.rb\n#{slipped.join("\n")}")
      end
    end
  end
end
