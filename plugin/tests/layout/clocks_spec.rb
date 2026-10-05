# frozen_string_literal: true

# THE CLOCK UNDER A NAME IS ONE SIZE PER BOARD.
#
# A caption's time is set a step under its name so the name reads first.
# Under the xlarge names the X takes that gap ran to two steps and the time
# came out as a footnote ("time labels in the captions could be a bit
# larger"), so the drawing steps it up afterwards, out of depth that is
# already free (draw.js, bigClocks).
#
# It cannot be a form in the ladder -- measured three ways, every one of
# them cost captions and times, because a taller row is depth and depth is
# what a time row is paid out of (measure-dom's TIME_BIG_CLS) -- and it
# happens in the real DOM, after the solve, so this is the suite that can
# see it at all: offline there are no elements to measure or to grow.
#
# What has to hold is that the step is taken by a whole board at a time.
# Growing each caption on its own merits would set the ones below their rails
# larger and the ones above them smaller, which reads as a mistake rather
# than as a decision. Asked of the captions set in the SAME NAME SIZE: a
# board may carry an xlarge name and a merged list at `large` beside it, and
# each clock is sized against the name it stands under.

require_relative '../support/layout'

RSpec.describe 'clocks' do
  include Metro::Layout

  # the caption is one element to the report; its clock is the child the
  # harness names in `timeCls`
  stacked = ->(l) { !l['timeCls'].to_s.empty? && !/metro-inline/.match?(l['timeCls']) }
  size_of = lambda do |cls|
    if /text--base/.match?(cls) then 'base'
    elsif /text--small/.match?(cls) then 'small'
    else 'other'
    end
  end

  Metro.fixtures.each do |fx|
    it "every clock under the same size of name matches: #{fx['name']}" do
      bad = []
      Metro::Layout::VIEWPORTS.each do |v|
        rep = layout(fx, v)
        next unless rep['debug']

        # the stacked form only: a time set beside its name shares the
        # name's line and is not what this is about
        by_name = {}
        rep['labels'].select(&stacked).each do |l|
          nm = if /text--xlarge/.match?(l['titleCls'].to_s) then 'xlarge'
               elsif /text--large/.match?(l['titleCls'].to_s) then 'large'
               else 'base'
               end
          (by_name[nm] ||= []).push(size_of.(l['timeCls']))
        end
        by_name.each_key do |nm|
          kinds = by_name[nm].uniq
          bad.push("#{v[:name]}/#{nm}: #{kinds.join(' and ')}") if kinds.length > 1
        end
      end
      assert(bad.empty?, bad.first(3).join('; '))
    end
  end

  # AND IT IS ACTUALLY TAKEN, on a board with room under every caption.
  # Without this the rule above is satisfied by never stepping up at all,
  # which is what the first two attempts at this did.
  it 'a board with room under its captions steps its clocks up' do
    v = viewport('x-landscape')
    seen = []
    fixtures.each do |fx|
      rep = layout(fx, v)
      next unless rep['debug']

      times = rep['labels'].select(&stacked)
      next if times.empty?

      seen.push("#{fx['name']}:#{size_of.(times[0]['timeCls'])}")
    end
    assert(!seen.empty?, 'no board on the X drew a stacked time row at all')
    assert(seen.any? { /:base\z/.match?(it) },
           "not one board took the step: #{seen.first(8).join(' ')}")
  end
end
