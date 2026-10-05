# frozen_string_literal: true

# THE BOARD'S OWN VERDICT, ON THE PAGE.
#
# The solver can say what is wrong with a board (`check` in solver/board.js:
# a caption off the paper, on a bar, over a rail or another caption, two
# names on each other) and the page publishes that list in data-metro-debug.
# The node suites asked it of the board the solver built; nothing asked it of
# the board the page DRAWS, which is the solve plus whatever the drawing does
# afterwards in the real faces. That is where these were: the clock under an
# xlarge name stepped up a size after the solve (draw.js, bigClocks), its box
# grew down onto the ring of a shared event's bar, and four captions on the
# simpsons example day were written on the bar's rings on a TRMNL X.

require_relative '../support/layout'

RSpec.describe 'faults' do
  include Metro::Layout

  Metro.fixtures.each do |f|
    Metro::Layout::VIEWPORTS.each do |v|
      it "the drawn board knows of no fault: #{f['name']}/#{v[:name]}" do
        rep = layout(f, v)
        faults = rep['debug']['faults']
        assert(faults.empty?, "#{faults.length} fault(s): #{faults.join('; ')}")
      end
    end
  end
end
