# frozen_string_literal: true

# A STATION FOR EVERY HOUR OF THE STEP (rule 2n). The night runs at a
# quarter of the day's rate and a clock pill takes the hour it stands on,
# so the words cannot follow the whole scale; "hours on the timeline are
# not very consistent, many are missing" was the strip saying 4pm, then
# 10pm, then 6am, then 10am. Every hour of the step keeps a station on the
# rail, a smaller one where its words did not fit, and every word stands
# over its own station.

require_relative '../support/layout'

RSpec.describe 'hours' do
  include Metro::Layout

  views = %w[x-landscape og-landscape].map { |n| Metro::Layout::VIEWPORTS.find { it[:name] == n } }

  hour_of = lambda do |text|
    t = text.to_s.gsub(/\A[[:space:]]+|[[:space:]]+\z/, '')
    m = /\A(\d{1,2})(?::(\d\d))?[[:space:]]*(am|pm)\z/i.match(t)
    next (m[1].to_i % 12) + (/pm/i.match?(m[3]) ? 12 : 0) if m

    m = /\A(\d{1,2}):00\z/.match(t)
    m ? m[1].to_i : nil
  end
  gcd = ->(a, b) { b.zero? ? a : gcd.(b, a.remainder(b)) }
  # Math.round
  round = ->(x) { x.is_a?(Float) && !x.finite? ? x : (x + 0.5).floor }
  # a sort that keeps equal keys in the order they came, as JavaScript's does
  by_x = ->(list) { list.each_with_index.sort_by { |l, i| [l['x'], i] }.map(&:first) }

  views.each do |v|
    Metro.fixtures.each do |f|
      it "every hour of the step has a station on the rail: #{f['name']} / #{v[:name]}" do
        rep = layout(f, v)
        next unless rep['debug'] && rep['debug']['horizontal']

        # (a night hour is a star and the midnight a moon: paths, placed
        # by the middle of their extent)
        stations = (rep['circles'] || []).select { %w[hour-station hour-station-minor].include?(it['role']) }
                                         .map { it['x'] + (it['w'] / 2.0) }
                                         .concat((rep['paths'] || [])
                                           .select { it['role'] == 'hour-station-minor' && !it['pts'].empty? }
                                           .map do |p|
                                             xs = p['pts'].map { it[0] }
                                             (xs.min + xs.max) / 2.0
                                           end)
                                         .sort
        # the midnight the panels change at has its station ("missing the
        # 00:00 dot")
        bands = by_x.((rep['rects'] || []).select { it['role'] == 'river' })
        if bands.length > 1
          cut = bands[1]['x']
          assert(stations.any? { (it - cut).abs <= 3 }, "no station at the midnight (#{round.(cut)})")
        end
        # and the train rides over its station, not in a gap left for it
        labs = by_x.(text_labels(rep)
          .select { " #{it['cls']} ".include?(' metro-hour ') && !hour_of.(it['text']).nil? }
          .map { { 'x' => it['x'] + (it['w'] / 2.0), 'w' => it['w'], 'hr' => hour_of.(it['text']), 'text' => it['text'] } })
        next if labs.length < 2

        # the hours along the strip, the day's wrap unwound
        add = 0
        labs.each_with_index do |l, i|
          add += 24 if i.positive? && l['hr'] + add <= labs[i - 1]['abs']
          l['abs'] = l['hr'] + add
        end
        step = 0
        labs.each_with_index { |l, i| step = gcd.(step, l['abs'] - labs[i - 1]['abs']) if i.positive? }
        next if step.zero?

        # every word over its own station
        own = labs.map do |l|
          best = nil
          stations.each_with_index do |s, i|
            best = i if best.nil? || (s - l['x']).abs < (stations[best] - l['x']).abs
          end
          off = best.nil? ? Float::INFINITY : (stations[best] - l['x']).abs
          # (a label may slide up to half its width to clear the clock, and
          # is never held off its station by the edge)
          assert(off <= (l['w'] / 2.0) + 3, "\"#{l['text']}\" has no station under it")
          best
        end
        # and no stretch of the rail is bare: no two neighbouring stations
        # are further apart than one step of the labels at the day's
        # fullest rate, the widest a station step can ever be (a squeezed
        # night is thinned to a dot's width apart, never more)
        # (per step of the labels, over every pair of neighbouring labels:
        # the scale runs at more than one rate, so the widest step is
        # wherever the day is busiest)
        full = 0
        (1...labs.length).each do |i|
          full = [full, (stations[own[i]] - stations[own[i - 1]]) / (labs[i]['abs'] - labs[i - 1]['abs']).fdiv(step)].max
        end
        next if full.zero?

        (1...stations.length).each do |i|
          assert(stations[i] - stations[i - 1] <= full + 3,
                 "a bare stretch of rail: #{round.(stations[i - 1])} to #{round.(stations[i])}, " \
                 "over the #{round.(full)} of a full step")
        end
      end

      # AND THE STEP IS AS FINE AS THE RAIL CAN CARRY. The dots' step was
      # taken from the TIGHTEST hour on the board and the words were
      # rounded up to a multiple of it, so a lead-in two pixels short of
      # the dots' clearance put the whole day on two-hour words: twelve
      # hours of panel with five labels on it, room for eleven ("why isn't
      # it showing hourly here"). Where a station stands clear of both its
      # neighbouring words by the width a word is placed at, a word
      # belonged on it.
      it "the hour words are as fine as the rail can carry: #{f['name']} / #{v[:name]}" do
        rep = layout(f, v)
        next unless rep['debug'] && rep['debug']['horizontal']

        all = text_labels(rep)
        labs = by_x.(all
          .select { " #{it['cls']} ".include?(' metro-hour ') && !hour_of.(it['text']).nil? }
          .map { { 'x' => it['x'] + (it['w'] / 2.0), 'w' => it['w'], 'text' => it['text'] } })
        next if labs.length < 2

        stations = (rep['circles'] || []).select { %w[hour-station hour-station-minor].include?(it['role']) }
                                         .map { it['x'] + (it['w'] / 2.0) }.sort
        # the clock's own pill takes an hour off the words, and so does the
        # midnight a panel changes at: a gap kept for either is not a step
        # too coarse
        keep_out = all.select { " #{it['cls']} ".include?(' metro-axis-note ') }
                      .map { [it['x'] - 4, it['x'] + it['w'] + 4] }
                      .concat((rep['rects'] || []).select { it['role'] == 'river' }
                                                  .map { [it['x'] - 4, it['x'] + it['w'] + 4] })
        (1...labs.length).each do |i|
          # what the drawing books a word at: its own width and a little
          # over, centre to centre (draw.js `room`), with a quarter again
          # so a word a few pixels short of fitting is not a failure
          # (the drawing books in its own units; the harness measures the
          # screen, so the clearance is carried across at the same ratio)
          dw = rep['debug']['W']
          z = dw.nil? || dw.zero? ? 1 : rep['canvas']['w'].fdiv(dw)
          ds = rep['debug']['S']
          s1 = ds.nil? || ds.zero? ? 1 : ds
          room = 1.25 * ([labs[i]['w'], labs[i - 1]['w']].max + (10 * s1 * z))
          spare = stations.select do |s|
            s - labs[i - 1]['x'] >= room && labs[i]['x'] - s >= room &&
              keep_out.none? { |k| s > k[0] && s < k[1] }
          end
          assert(spare.empty?, "a word belonged between \"#{labs[i - 1]['text']}\" and \"#{labs[i]['text']}\"" \
                               ": #{spare.length} station(s) clear of both by #{round.(room)}px")
        end
      end
    end
  end
end
