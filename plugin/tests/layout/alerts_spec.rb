# frozen_string_literal: true

# WHAT THE BOARD SAYS WHEN SOMETHING WENT WRONG.
#
# A calendar that did not answer is not on the map, and every other thing on
# the map looks exactly as it always does -- so unless the board says so, a
# reader cannot tell a quiet Tuesday from a feed that failed. Two photographs
# of one real board six minutes apart lost different people's events each
# time and said nothing either time: the line existed, but a feed was only
# NAMED after it had been failing for two hours, and nothing in any suite had
# ever looked at the line at all.
#
# So: it appears on the render the failure happened on, it carries a mark, it
# is set in the board's own ink rather than the grey used for a clock, and it
# does not cost the map a row it was using.

require_relative '../support/layout'

RSpec.describe 'alerts' do
  include Metro::Layout

  busy = Metro.fixtures.find { it['name'] == 'busy-day' }
  down = { 'calendars_down' => ['Alex Personal'] }
  # JS unary plus on a computed weight: a number, or NaN when there is none
  num = ->(w) { w.nil? ? Float::NAN : (Float(w, exception: false) || Float::NAN) }

  it 'a feed that did not answer is named on the board, with a mark' do
    Metro::Layout::VIEWPORTS.each do |v|
      rep = layout(busy, v, down)
      said = (rep['alerts'] || []).select { it['text'].include?('Alex Personal') }
      assert(said.length == 1, "#{v[:name]}: the board did not say the feed was unavailable: " \
        "#{rep['alerts'].to_json}")
      assert(said[0]['icon'], "#{v[:name]}: the line carries no mark, so it reads as a footnote")
      assert(said[0]['icon']['w'] > 4 && said[0]['icon']['h'] > 4, "#{v[:name]}: the mark is " \
        "#{said[0]['icon']['w'].round}x#{said[0]['icon']['h'].round}px, which is not a mark")
      # Not the quiet grey: this is the one line on the board that is about
      # the board being wrong.
      assert(num.(said[0]['weight']) >= 700, "#{v[:name]}: the warning is set at weight " \
        "#{said[0]['weight']}, the same as everything else")
    end
  end

  it 'a board with nothing wrong says nothing, so the mark means something' do
    Metro::Layout::VIEWPORTS.each do |v|
      rep = layout(busy, v)
      assert((rep['alerts'] || []).empty?, "#{v[:name]}: a healthy board raised a warning: " \
        "#{rep['alerts'].to_json}")
    end
  end

  it 'the warning does not push the board off its own panel' do
    # It is a row under the map and the map is sized around it; a warning
    # that overflowed would cost the reader the bottom line to tell them
    # about the one that is missing.
    Metro::Layout::VIEWPORTS.each do |v|
      rep = layout(busy, v, down)
      h = v[:slot] ? v[:slot][:h] : v[:h]
      (rep['alerts'] || []).each do |a|
        assert(a['y'] + a['h'] <= h + 1, "#{v[:name]}: the warning reaches #{(a['y'] + a['h']).round}" \
          "px on a #{h}px panel")
      end
    end
  end
end
