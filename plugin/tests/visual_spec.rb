# frozen_string_literal: true

# THE PICTURE, NOT THE BOOKKEEPING.
#
# Every other spec reads the board back as numbers. These keep a picture of
# the board on the two panels that matter most -- the TRMNL X lying down,
# which is the board this plugin is designed for, and the 1-bit OG -- as the
# device gets it (the screenshot reduced to the panel's palette), and fail on
# any pixel that moved. A layout change is MEANT to move pixels: look at the
# picture in the report, and when it is the change you wanted,
#
#   ./test.sh trmnl --update tests/visual_spec.rb
#
# rewrites the pictures in plugin/tests/snapshots, which are committed. That
# is the screenshot AGENTS.md asks to be sent with every drawing change.
#
# (test/visual/cars.js, the visual check this suite had, asked whether each
# line's car stood on its rail. The cars are gone from the board -- one train
# on the strip replaced them -- and it failed all six of its scenarios when
# forced on, so it was not ported.)

require_relative 'support/layout'

RSpec.describe 'visual' do
  panels = [
    { name: 'x-landscape', device: 'v2' },
    { name: 'og-landscape', device: 'og_png' }
  ]

  panels.each do |panel|
    %w[busy-day five-lines].each do |name|
      it "the board as the panel shows it · #{name} · #{panel[:name]}" do
        metro = Metro.fixtures.find { it['name'] == name }['metro']
        screen = trmnl.render(device: panel[:device], data: { 'data' => metro }, transform: false, **Metro::Page::PAGE)
        Metro::Page.report(screen) # drawn, settled and error-free first
        expect(screen).to fit_image_size_limit
        expect(screen).to match_snapshot("#{name}-#{panel[:name]}")
      end
    end
  end
end
