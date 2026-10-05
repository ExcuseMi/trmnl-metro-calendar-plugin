# frozen_string_literal: true

# A view has to reach a final layout and stop. The header sits above the
# canvas, so its height decides how much canvas there is; deciding the
# header's size FROM the canvas is a feedback loop, and near a breakpoint it
# oscillates forever -- half-horizontal at lg did exactly that, redrawing for
# as long as the device was on. This is cheap to check and impossible to
# notice by eye in a screenshot.

require_relative '../support/layout'

RSpec.describe 'settles' do
  include Metro::Layout

  # sizes around the header's compact/large breakpoints, where it flipped.
  # Every view on both panels, each the view's own template in TRMNL's real
  # mashup slot. (These were window sizes in the old harness, which the
  # framework ignores: the screen is pinned to the device, so all four were
  # the full board in a smaller window.)
  og = Metro::Layout::OG
  x = Metro::Layout::X
  sizes = [
    { name: 'og-full', page: 'full', classes: og },
    { name: 'og-half-horizontal', page: 'half_horizontal', classes: og },
    { name: 'og-half-vertical', page: 'half_vertical', classes: og },
    { name: 'og-quadrant', page: 'quadrant', classes: og },
    { name: 'x-full', page: 'full', classes: x },
    { name: 'x-half-horizontal', page: 'half_horizontal', classes: x },
    { name: 'x-half-vertical', page: 'half_vertical', classes: x },
    { name: 'x-quadrant', page: 'quadrant', classes: x }
  ]

  busy = Metro.fixtures.find { it['name'] == 'busy-day' }

  sizes.each do |size|
    it "settles instead of redrawing forever: #{size[:name]}" do
      rep = render(busy['metro'], size)
      runs = rep['debug']['runs']
      assert(runs.is_a?(Numeric), 'no run count reported')
      # a couple of passes is normal: first paint, then fonts arriving, then
      # load. Anything beyond that is the layout chasing its own tail.
      assert(runs <= 4, "#{size[:name]} laid out #{runs} times and was still going")
    end
  end
end
