# frozen_string_literal: true

# A BOARD THAT CROSSES A MIDNIGHT NAMES THE DAY IT CROSSES INTO, ON THE STRIP.
#
# Whether a board crosses, where tomorrow's events land and whether a name
# straddles the midnight are the solver's answers and asked in test/boards
# (cases/window.js). What is left is the badge: the framework lays it out, so
# only a real page can say where it is drawn and what it is drawn over.

require_relative '../support/layout'

RSpec.describe 'rolling' do
  include Metro::Layout

  by_name = ->(n) { Metro::Layout::VIEWPORTS.find { |v| v[:name] == n } }
  roomy = by_name.('x-landscape')
  base = Metro.fixtures.find { it['name'] == 'rolling-quiet' }
  # Five in the afternoon: little left today, so the board reaches tomorrow.
  roll = { 'name' => 'rolling-evening', 'metro' => base['metro'].merge('now_min' => 17 * 60) }

  has_cls = ->(l, c) { " #{l['cls']} ".include?(" #{c} ") }
  daybreaks = ->(rep) { rep['labels'].select { has_cls.(it, 'metro-daybreak') } }
  midnight_x = lambda do |rep|
    # (the unpainted marker at the cut: the rule itself is no longer drawn)
    m = (rep['rects'] || []).find { it['role'] == 'midnight-cut' }
    m ? m['x'] + (m['w'] / 2.0) : nil
  end
  # Math.round
  round = ->(x) { x.is_a?(Float) && !x.finite? ? x : (x + 0.5).floor }

  it 'the second day is named on the strip, where the midnight is' do
    [roomy, by_name.('og-landscape')].each do |v|
      rep = layout(roll, v)
      mid = midnight_x.(rep)
      assert(!mid.nil?, "#{v[:name]}: the evening board drew no midnight")
      marks = daybreaks.(rep)
      assert(marks.length >= 1, "#{v[:name]}: no date marker at all on a two-day board")
      # It names the day the midnight OPENS, so it starts at that midnight.
      assert(marks.any? { (it['x'] - mid).abs < it['w'] + 20 },
             "#{v[:name]}: the date marker is at x#{round.(marks[0]['x'])} and the midnight is at x#{round.(mid)}")
    end
  end

  it 'a date marker has nothing written over it' do
    [roomy, by_name.('og-landscape'), by_name.('og-half')].each do |v|
      rep = layout(roll, v)
      others = text_labels(rep).reject { has_cls.(it, 'metro-daybreak') }
      bad = []
      daybreaks.(rep).each do |m|
        others.each do |o|
          ov = overlap(m, o)
          bad.push("\"#{m['text']}\" over \"#{o['text']}\"") if ov && ov['w'] > 1 && ov['h'] > 1
        end
      end
      assert(bad.empty?, "#{v[:name]}: #{bad.join('; ')}")
    end
  end
end
