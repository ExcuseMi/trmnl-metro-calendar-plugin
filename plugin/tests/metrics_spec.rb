# frozen_string_literal: true

# THE WIDTH TABLE MATCHES THE PAGE.
#
# test/boards/metrics.json is how every node-side layout (test/boards,
# solver tools) knows how wide a word is. It is a measurement, and a stale one
# is worse than none: the node suites lay out a board the panel never draws
# and pass it. When the sweep moved into the real page it disagreed with the
# jsdom sweep on 27 of 90 boards, and the table turned out to be out of date
# (calibrate.js, run again, rewrote most of the OG's large face).
#
# So the table is checked here against the page TRMNL renders, on the OG
# (1-bit) and the X, and `./test.sh trmnl --update tests/metrics_spec.rb`
# rewrites it (that is what test/boards/calibrate.js runs now).

require_relative 'support/layout'

RSpec.describe 'metrics' do
  file = File.join(Metro::ROOT, 'test', 'boards', 'metrics.json')
  probe = File.read(File.join(__dir__, 'metrics_probe.js')).sub(/\A(\s*\/\/[^\n]*\n)+/, '').strip
  # a hundredth of a pixel: the advances are fractional, rounded to 1/1000
  tol = 0.01

  classes = {
    'title' => 'metro-title-text text--base text--bold',
    'time' => 'metro-time-tag text--small text--bold',
    # the time row under an xlarge name (measure-dom's TIME_BIG_CLS)
    'timeBig' => 'metro-time-tag text--base text--bold',
    'large' => 'metro-title-text text--large text--bold',
    # the step above, taken on a panel the size of the X (measure-dom's XL tiers)
    'xlarge' => 'metro-title-text text--xlarge text--bold',
    'strip' => 'metro-hour label text--bold',
    'small' => 'metro-title-text text--small text--bold',
    'name' => 'metro-terminus metro-pill label label--base text--bold',
    # a line's badge, in the type it is drawn in (draw.js, the route row)
    'route' => 'metro-route metro-pill metro-pill--quiet label text--bold'
  }

  { 'og' => 'og_png', 'x' => 'v2' }.each do |dev, device|
    it "the width table is what the page measures · #{dev}" do
      metro = Metro.fixtures.find { it['name'] == 'busy-day' }['metro']
      screen = trmnl.render(device:, data: { 'data' => metro }, transform: false, **Metro::Page::PAGE)
      Metro::Page.report(screen) # the faces are in and the board has settled
      measured = screen.evaluate("#{probe}(#{JSON.generate(classes)})")
      if ENV['TRMNLP_UPDATE_SNAPSHOTS'].to_s != ''
        # one file, and the two panels may be measured in two processes
        File.open("#{file}.lock", File::RDWR | File::CREAT) do |lock|
          lock.flock(File::LOCK_EX)
          table = begin
            JSON.parse(File.read(file))
          rescue SystemCallError, JSON::ParserError
            {}
          end
          table[dev] = measured
          File.write(file, JSON.generate(Metro.plain(table)))
        end
        FileUtils.rm_f("#{file}.lock")
        next
      end
      table = JSON.parse(File.read(file))[dev] || {}
      off = []
      classes.each_key do |k|
        want = measured[k]
        have = table[k]
        next off << "#{k}: missing" unless have

        %w[h pad boxPad].each do |f|
          off << "#{k}.#{f} #{have[f]} in the table, #{want[f]} in the page" if (want[f] - have[f]).abs > tol
        end
        want['w'].each do |ch, width|
          if have['w'][ch].nil? || (width - have['w'][ch]).abs > tol
            off << "#{k} #{ch.to_json} #{have['w'][ch]} in the table, #{width} in the page"
          end
        end
      end
      ns = table['nameStanding']
      if !ns || (ns['h'] - measured['nameStanding']['h']).abs > tol
        off << "nameStanding.h #{ns && ns['h']} in the table, #{measured['nameStanding']['h']} in the page"
      end
      assert(off.empty?, "#{off.length} width(s) out of date: ./test.sh trmnl --update tests/metrics_spec.rb\n" \
                         "#{off.first(25).join("\n")}")
    end
  end
end
