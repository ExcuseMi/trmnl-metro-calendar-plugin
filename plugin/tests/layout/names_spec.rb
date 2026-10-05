# frozen_string_literal: true

# A LINE'S NAME IS AT THE END OF ITS LINE.
#
# That is the whole of what a terminus name does: it says whose rail this is,
# by being at the end of it, at both ends, because a reader comes to the
# board from whichever side they are standing on. A name that has wandered in
# from the end is not a name a little out of place -- it is a word floating
# in the middle of a map, naming nothing, with rails either side of it.
#
# It happened, on the example day the plugin ships, and it was reported from
# a photograph: "Bart end label is in the middle of the page". Bart's head at
# the far end carries a route row -- the all-day badge, "Spring Break · Fri",
# under his name -- and the escape that steps a name in off the edge to get
# out from under a branch measured its allowance off the BOX, which for a
# head with a route row is as wide as the row. Twice that is most of a TRMNL
# X, and he stepped four hundred and sixty pixels in.
#
# Nothing saw it: `check` has no opinion about where a terminus is, the sweep
# asks about faults, and no fixture had a two-row head with a branch under
# it. This is the ratchet, and it is deliberately blunt -- a name belongs
# near an end, and how near is not worth arguing about.

require_relative '../support/layout'

RSpec.describe 'names' do
  include Metro::Layout

  # A name may step in off the edge -- out from under its own branch, past an
  # edge ring -- and still be that rail's. A fifth of the board is far more
  # slack than any of those need and far less than being adrift.
  slack = 0.2
  # Math.round
  round = ->(x) { x.is_a?(Float) && !x.finite? ? x : (x + 0.5).floor }

  Metro.fixtures.each do |fx|
    it "every line is named at the ends of its own rail: #{fx['name']}" do
      bad = []
      Metro::Layout::VIEWPORTS.each do |v|
        rep = layout(fx, v)
        next unless rep['debug']

        horiz = rep['debug']['horizontal']
        span = horiz ? rep['canvas']['w'] : rep['canvas']['h']
        next if span.nil? || span.zero?

        rep['labels'].select { /metro-terminus/.match?(it['cls'].to_s) }.each do |l|
          lo = horiz ? l['x'] : l['y']
          size = horiz ? l['w'] : l['h']
          in_from_end = [lo, span - (lo + size)].min
          next unless in_from_end > span * slack

          bad.push("#{v[:name]}: \"#{l['text']}\" is #{round.(in_from_end)}" \
                   "px in from either end of a #{round.(span)}px board")
        end
      end
      assert(bad.empty?, bad.first(3).join('; '))
    end
  end
end
