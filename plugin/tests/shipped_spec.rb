# frozen_string_literal: true

# DOES THE COPY THAT SHIPS ACTUALLY RUN, AND DRAW THE SAME BOARD?
#
# push.sh strips, minifies and compresses both source files on the way to the
# device (support/shipped.rb builds the same copy). The only checks it used to
# make were that `trmnlp build` succeeded and that a marker string was there;
# neither runs a line of the template's script, and a minifier that broke the
# layout would have pushed cleanly and drawn nothing on the panel. This was
# plugin/verify-build.js (every view of the squeezed copy, on an X, must lay a
# map out) and `node -e "require(transform.js)"`; it now also asks that the
# squeezed copy draw exactly the board the sources draw, fixture by fixture,
# and that the squeezed transform return exactly what the sources return.
#
#   ./test.sh trmnl tests/shipped_spec.rb

require_relative 'support/layout'
require_relative 'support/shipped'
require_relative 'support/demo'

RSpec.describe 'shipped' do
  include Metro::Layout

  shipped = Metro::Shipped.plugin

  # EVERY VIEW, not just the full one. They are four different files on the
  # server and the squeeze rewrites all four; a deploy that proves one of them
  # draws is a deploy that has proved a quarter of what it is sending. On an X,
  # with the demo day baked into .trmnlp.yml, as verify-build did. (A test
  # does not see .trmnlp.yml's variables unless it passes them.)
  demo_day = YAML.safe_load_file(File.join(Metro::PLUGIN, '.trmnlp.yml'))['variables']
  %w[full half_horizontal half_vertical quadrant].each do |view|
    it "the squeezed copy lays a map out · #{view}" do
      screen = trmnl.plugin(shipped).render(device: 'v2', view:, transform: false, variables: demo_day,
                                            **Metro::Page::PAGE)
      # THE SCRIPT SAYS WHEN IT FAILS, and report() asks that first: a solver
      # that threw leaves data-metro-error behind, and the message in it is
      # worth more than "the map never laid itself out".
      dbg = Metro::Page.report(screen)['debug']
      # A BOARD WITH NO LINES ON IT IS NOT A BOARD. `gaps` is one entry per
      # line plus the two margins, so anything under three means nothing was
      # placed.
      assert(dbg['gaps'].length >= 3, 'the map laid out with no lines on it')
      # ...AND NOTHING A READER CANNOT READ. Shed names and dropped lines are
      # DECISIONS and are allowed; a caption nobody can pair with a mark is not.
      assert(dbg['muddle'] <= 2, "#{dbg['muddle']} name(s) a reader cannot pin to a mark; that is too many to ship")
    end
  end

  # The squeezed transform loads and answers exactly as the source does: the
  # demo day, through trmnlp's node wrapper, at two times.
  mocks = Metro.mock_table(Metro::Demo.demo_mocks + [Metro::Demo::NOT_FOUND])
  %w[2026-09-15T12:30:00Z 2026-09-16T02:40:00Z].each do |at|
    it "the squeezed transform returns what the source returns · #{at}" do
      options = { now: at, mocks:, custom_fields: { use_demo_data: 'true', demo_set: 'simpsons' },
                  variables: { trmnl: { user: { time_zone_iana: 'America/Chicago', locale: 'en-US' } } } }
      squeezed = trmnl.plugin(shipped).transform(**options)
      expect(squeezed.error).to be_nil
      expect(squeezed).to stay_within_serverless_limits
      assert((squeezed.data.dig('data', 'legend') || []).length.positive?, 'the squeezed transform drew nobody')
      source = trmnl.transform(**options)
      # (the feeds are read in the config's order, so the two agree exactly:
      # tests/transform/order_spec.rb)
      expect(squeezed.data.except('trmnl')).to eq(source.data.except('trmnl'))
      expect(squeezed.state).to eq(source.state)
    end
  end

  # THE SAME BOARD, fixture by fixture, on the four views the layout suite
  # renders most. Everything the board reports about itself and everything it
  # drew, rounded to a pixel.
  r = ->(n) { (n + 0.5).floor }
  digest = lambda do |rep|
    Metro.plain(
      canvas: [r.(rep['canvas']['w']), r.(rep['canvas']['h'])], debug: rep['debug'].except('ms', 'runs'),
      labels: rep['labels'].map { [it['cls'], it['text'], r.(it['x']), r.(it['y']), r.(it['w']), r.(it['h']), it['timeCls']] },
      paths: rep['paths'].map { [it['role'], it['owner'], r.(it['len']), it['pts'].empty? ? 0 : it['pts'][0].map(&r)] },
      circles: rep['circles'].map { [it['role'], it['owner'], r.(it['x']), r.(it['y'])] }
    )
  end

  Metro.fixtures.each do |f|
    Metro::Layout::VIEWPORTS.each do |v|
      it "the squeezed copy draws the board the sources draw · #{f['name']} · #{v[:name]}" do
        expect(digest.(layout_of(shipped, f, v))).to eq(digest.(layout(f, v)))
      end
    end
  end
end
