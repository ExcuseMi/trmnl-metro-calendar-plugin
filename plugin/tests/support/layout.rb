# frozen_string_literal: true

# THE LAYOUT SUITE'S HARNESS, ON `trmnlp test`.
#
# trmnlp renders the board the way TRMNL does: the fixture goes in as the
# template's data (`data.*`, through trmnlp's own Liquid, so the header and
# the banner see the same payload the script does), the page gets the device's
# real screen classes, palette, orientation and mashup slot, and Firefox draws
# it in the framework's real faces. What is left here is the plugin's own
# vocabulary: the viewports the cases were written against, the report
# (page.rb), a memo, and the geometry helpers the cases share.
#
# A case says `rep = layout(fixture, viewport)` and reads the report, whose
# keys are strings (`rep['labels']`, `l['x']`); a viewport's are symbols.

require_relative 'metro'
require_relative 'page'
require_relative 'cache'

module Metro
  module Layout
    # ---------------------------------------------------------------- viewports

    # The device classes the cases were written with, and what they are to
    # trmnlp: the OG on a 1-bit panel is `og_png`, the X is `v2` (16 greys,
    # 1872x1404, laid out at 1040x780 css px and zoomed ~1.8x by the framework).
    OG = 'screen--og screen--md screen--1bit screen--density-1x'
    X = 'screen--v2 screen--lg screen--4bit screen--density-2x'

    VIEWPORTS = [
      { name: 'og-landscape', w: 800, h: 480, classes: OG },
      { name: 'x-landscape', w: 1872, h: 1404, classes: X },
      { name: 'x-portrait', w: 1404, h: 1872, classes: "#{X} screen--portrait" },
      # a slot inside the screen, not a smaller screen: see render_options
      { name: 'og-half', w: 800, h: 480, slot: { w: 400, h: 480 }, classes: OG }
    ].freeze

    def viewport(name) = VIEWPORTS.find { it[:name] == name } || raise(ArgumentError, "no viewport #{name}")

    # A viewport (as the cases write it) as `trmnl.render` options.
    #
    # A half or a quadrant is a SLOT inside the screen, not a smaller screen.
    # The framework pins .screen to the device's own size whatever the window
    # is, so asking for a 400x240 window and calling the result a quadrant
    # rendered a full 800x480 board and cropped the picture. Two ways to get a
    # slot:
    #
    #   `page: 'quadrant'`  the view's own template in TRMNL's real mashup
    #                       slot (trmnlp's `view:`), which is what a device
    #                       draws.
    #   `slot: {w:, h:}`    the FULL template in a box of that size:
    #                       `.view--full` takes its box from --full-w/--full-h,
    #                       the one knob a real mashup turns, so overriding
    #                       those gives the view the slot's box and leaves the
    #                       screen and its zoom alone.
    def render_options(viewport)
      classes = " #{viewport[:classes]} "
      x = classes.include?(' screen--v2 ')
      bits = classes[/ screen--(\d)bit /, 1]
      device = x ? 'v2' : 'og_png'
      palette = nil
      if x
        palette = { '1' => 'bw', '2' => 'gray-4' }[bits]
      elsif %w[2 4].include?(bits)
        device = 'og_plus'
        palette = 'gray-4'
      end
      view = viewport[:page] || 'full'
      options = { device:, view: }.merge(Page::PAGE)
      if viewport[:slot] && view == 'full'
        slot = viewport[:slot]
        options[:head] += "<style>.screen{--full-w:#{slot[:w].to_i}px !important;" \
                          "--full-h:#{slot[:h].to_i}px !important}</style>"
      end
      options[:palette] = palette if palette
      options[:orientation] = :portrait if classes.include?(' screen--portrait ')
      options
    end

    # ---------------------------------------------------------------- rendering

    # A render is a page in Firefox and a few seconds of solving, and the
    # cases ask for the same board at the same size over and over. Memoised
    # per process on the exact payload and options, and on disk across
    # processes and runs (cache.rb), so ten tests on one board cost one render.
    MEMO = {} # rubocop:disable Style/MutableConstant
    @renders = 0
    class << self
      attr_accessor :renders
    end

    # `extra` reaches the template's data as well as the script's payload:
    # they are one and the same, `data`. `plugin_dir` renders another copy of
    # the plugin (the squeezed one, see shipped.rb).
    def render(metro, viewport, extra = nil, plugin_dir = nil)
      data = extra ? metro.merge(Metro.plain(extra)) : metro
      options = render_options(viewport)
      dir = plugin_dir || PLUGIN
      inputs = { 'data' => data, 'opts' => options }
      MEMO[Digest::SHA1.hexdigest("#{JSON.generate(inputs)}|#{dir}")] ||= Cache.cached(dir, inputs) do
        plugin = plugin_dir ? trmnl.plugin(plugin_dir) : trmnl
        screen = plugin.render(**options, data: { 'data' => data }, transform: false)
        Layout.renders += 1
        Page.report(screen)
      end
    end

    def layout(fixture, viewport, extra = nil) = render(fixture['metro'], viewport, extra)

    # the same, from another copy of the plugin
    def layout_of(plugin_dir, fixture, viewport, extra = nil) = render(fixture['metro'], viewport, extra, plugin_dir)

    def fixtures = Metro.fixtures
    def fixture(name) = fixtures.find { it['name'] == name } || raise(ArgumentError, "no fixture #{name}")

    # ---------------------------------------------------------------- geometry helpers

    def inflate(r, by) = { 'x' => r['x'] - by, 'y' => r['y'] - by, 'w' => r['w'] + (2 * by), 'h' => r['h'] + (2 * by) }

    # nil when they do not overlap
    def overlap(a, b)
      ox = [a['x'] + a['w'], b['x'] + b['w']].min - [a['x'], b['x']].max
      oy = [a['y'] + a['h'], b['y'] + b['h']].min - [a['y'], b['y']].max
      ox.positive? && oy.positive? ? { 'w' => ox, 'h' => oy, 'area' => ox * oy } : nil
    end

    def point_in(p, r) = p[0] >= r['x'] && p[0] <= r['x'] + r['w'] && p[1] >= r['y'] && p[1] <= r['y'] + r['h']

    def has_class(label, cls) = " #{label['cls']} ".include?(" #{cls} ")

    # the text boxes a reader is meant to read: event captions, terminus
    # names, hour ticks and the sky band
    def text_labels(rep)
      rep['labels'].select do |l|
        %w[metro-label metro-terminus metro-hour metro-sky metro-axis-note].any? { has_class(l, it) }
      end
    end

    def paths_where(rep, role) = rep['paths'].select { it['role'] == role }

    # how far a path strays inside a box, in px: 0 when it never enters it
    def deepest_intrusion(path_pts, box)
      path_pts.select { point_in(it, box) }.map do |p|
        [p[0] - box['x'], box['x'] + box['w'] - p[0], p[1] - box['y'], box['y'] + box['h'] - p[1]].min
      end.max || 0
    end
  end
end
