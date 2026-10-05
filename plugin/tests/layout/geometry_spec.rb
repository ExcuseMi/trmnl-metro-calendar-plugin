# frozen_string_literal: true

# WHAT ONLY A REAL PAGE CAN SAY ABOUT THE DRAWING.
#
# The geometry questions -- marks on rails, rings, spurs, captions beside
# their own rails, corridors -- are asked of the solver's board in node, in
# test/boards. What is left here needs the framework and the real faces: a
# label's drawn box against the canvas, whether everything drawn got paint,
# and whether a line's name collides with the hour labels on the strip.

require_relative '../support/layout'

RSpec.describe 'geometry' do
  include Metro::Layout

  by_name = ->(n) { Metro::Layout::VIEWPORTS.find { |v| v[:name] == n } }
  roomy = by_name.('x-landscape')
  # Math.round, and a number printed as JavaScript prints it
  round = ->(x) { x.is_a?(Float) && !x.finite? ? x : (x + 0.5).floor }
  num = ->(x) { Metro.plain(x) }

  tight = by_name.('og-landscape')
  Metro.fixtures.each do |f|
    it "fits the small panel: #{f['name']}" do
      rep = layout(f, tight)
      cw = rep['canvas']['w']
      ch = rep['canvas']['h']
      off = text_labels(rep).select do |l|
        l['x'] < -2 || l['y'] < -2 || l['x'] + l['w'] > cw + 2 || l['y'] + l['h'] > ch + 2
      end
      assert(off.empty?, "#{off.length} label(s) off-canvas: " +
        off.first(5).map do |l|
          "\"#{l['text']}\" #{[l['x'], l['y'], l['w'], l['h']].map { round.(it) }.join(',')}" \
            " in #{num.(cw)}x#{num.(ch)}"
        end.join(', '))
      tracks = paths_where(rep, 'track')
      tracks.each do |t|
        ys = t['pts'].map { it[1] }
        assert((ys.min || Float::INFINITY) >= -2 && (ys.max || -Float::INFINITY) <= ch + 2,
               "track #{t['owner']} runs off the canvas")
      end
    end
  end

  # ------------------------------------------------------------ staying on the canvas

  Metro.fixtures.each do |f|
    it "every label stays inside the canvas: #{f['name']}" do
      rep = layout(f, roomy)
      cw = rep['canvas']['w']
      ch = rep['canvas']['h']
      bad = text_labels(rep).select do |l|
        l['x'] < -2 || l['y'] < -2 || l['x'] + l['w'] > cw + 2 || l['y'] + l['h'] > ch + 2
      end
      assert(bad.empty?, "#{bad.length} label(s) off-canvas: #{bad.first(5).map { "\"#{it['text']}\"" }.join(', ')}")
    end
  end

  # Nothing is drawn with no paint. An SVG shape given neither a stroke nor
  # a fill renders as nothing at all: it is in the DOM, the right size, in
  # the right place, and invisible. That is exactly how the interchange tie
  # disappeared -- its literal stroke was removed on the way to making the
  # colours theme-aware and never replaced, leaving three rings on three
  # lines with no visible reason to be there. Every other geometry test
  # passed, because the tie was still perfectly positioned.
  Metro.fixtures.each do |f|
    it "everything drawn is actually visible: #{f['name']}" do
      rep = layout(f, roomy)
      none = ->(v) { v.nil? || v == '' || v == 'none' || v == 'rgba(0, 0, 0, 0)' || v == 'transparent' }
      zero = ->(n) { n.nil? || n.zero? }
      bad = []
      (rep['painted'] || []).each do |el|
        next if zero.(el['w']) && zero.(el['h']) # not laid out
        # The COURSE is deliberately unpainted. It is where a line goes,
        # kept as one unbroken path so anything downstream can ask how far
        # along itself the line is at a given minute; the visible line is
        # drawn separately, in runs, because it breaks wherever it passes
        # under something. Nothing is meant to see this one.
        next if el['role'] == 'course'
        # ...and so is the marker at a midnight: the cut is a fact the tests
        # read back; the rule that used to be painted there is switched off.
        next if el['role'] == 'midnight-cut'

        # A <line> cannot be filled -- only its stroke draws anything -- and
        # its computed fill defaults to black, so counting fill as paint let
        # the strokeless tie through. This test passed on the broken build
        # the first time it was run, which is the whole reason for the note.
        fills = el['tag'] != 'line' && el['tag'] != 'polyline'
        inked = (!none.(el['stroke']) && !el['strokeWidth'].nil? && el['strokeWidth'] > 0) ||
                (fills && !none.(el['fill']))
        if !inked
          bad.push("#{el['role']}#{el['owner'].to_s.empty? ? '' : "/#{el['owner']}"} <#{el['tag']}>")
        elsif el['opacity'] == 0 # rubocop:disable Style/NumericPredicate
          bad.push("#{el['role']} is fully transparent")
        end
      end
      assert(bad.empty?, "#{bad.length} element(s) drawn with no paint: #{bad.uniq.first(5).join('; ')}")
    end
  end

  Metro.fixtures.each do |f|
    it "no line name lands in the river: #{f['name']}" do
      # The track nearest the spine sits close enough that its name went
      # into the water with the hour labels, which are the one thing on the
      # board it must never share space with.
      rep = layout(f, roomy)
      hours = text_labels(rep).select { " #{it['cls']} ".include?(' metro-hour ') }
      names = text_labels(rep).select { " #{it['cls']} ".include?(' metro-terminus ') }
      bad = []
      names.each do |n|
        hours.each do |h|
          if overlap(n, h)
            bad.push("\"#{n['text']}\" over \"#{h['text']}\"")
            break
          end
        end
      end
      assert(bad.empty?, "#{bad.length} line name(s) in the river: #{bad.first(3).join('; ')}")
    end
  end
end
