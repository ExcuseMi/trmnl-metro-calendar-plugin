# frozen_string_literal: true

# NOTHING ON TOMORROW'S PANEL STANDS UNDER THE SLOPE (rule 2l). Today's
# ink panel runs on over the midnight at 45 degrees, covering the start of
# each of tomorrow's rows by as much as the row stands above the rail. A
# title measured without it was chosen too long and pulled back under the
# ink, and the OG read "orrow" for "Tomorrow" whenever today's header
# carried the Now card.

require_relative '../support/layout'

RSpec.describe 'slope' do
  include Metro::Layout

  views = %w[x-landscape og-landscape].map { |n| Metro::Layout::VIEWPORTS.find { it[:name] == n } }

  views.each do |v|
    Metro.fixtures.each do |f|
      next unless (f['metro']['days'] || []).length > 1

      it "tomorrow's words clear the slope: #{f['name']} / #{v[:name]}" do
        rep = layout(f, v)
        next unless rep['debug'] && rep['debug']['horizontal']

        bands = (rep['rects'] || []).select { it['role'] == 'river' }.sort_by { it['x'] }
        next if bands.length < 2

        s = rep['debug']['S'] || 1
        cut = bands[1]['x']
        strip_c1 = bands[0]['y'] + bands[0]['h']
        slant_max = [bands[0]['h'], (bands[1]['w'] * 0.4).floor].min
        next if slant_max < 8 * s

        bad = rep['labels'].select do |l|
          next false unless /metro-daybadge|metro-wx|metro-hour|metro-axis-note/.match?(l['cls'])
          next false if l['y'] + l['h'] > strip_c1 + 1 || l['x'] + (l['w'] / 2.0) < cut

          reach = [slant_max, [0, strip_c1 - l['y'] - (2 * s)].max].min
          l['x'] < cut + reach - 2
        end
        assert(bad.empty?, bad.map do |l|
          under = (cut + [slant_max, strip_c1 - l['y'] - (2 * s)].min - l['x']).round
          "\"#{l['text']}\" starts #{under}px under the slope"
        end.join('; '))
      end
    end
  end
end
