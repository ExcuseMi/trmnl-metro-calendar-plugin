# frozen_string_literal: true

# THE STANDING VIEWS GET THE SAME BAR AS THE FLAT ONES.
#
# Almost every geometry case runs on x-landscape, and a portrait panel is
# not a landscape one turned on its side: the axis that holds the day
# becomes the tall one, and a caption -- which stays horizontal, because
# text always does -- now takes its width out of the SAME axis the rails
# are spread along. So the two compete for one dimension in a way they
# never do lying down, and nothing was checking it.
#
# What that cost: the caption column was sized from the paper left over
# after both bundles, read through a function that reports each track's
# SOLVED distance from the spine -- and nothing has solved one at that
# point in the layout. Both sides measured zero, the two columns were
# handed the whole cross axis, and the solver was then left to place five
# rails in what remained. It put them in the left 45% of the panel with
# 420px of blank paper beside them and wrote every left-hand rail's
# captions off the edge of the board. Every case in this file passed
# throughout, because every case in this file was landscape.

require 'set'
require_relative '../support/layout'

RSpec.describe 'standing' do
  include Metro::Layout

  by_name = ->(n) { Metro::Layout::VIEWPORTS.find { |v| v[:name] == n } }
  standing = ['x-portrait']
  overlap_tol = 2
  intrusion_tol = 4
  # Math.round
  round = ->(x) { x.is_a?(Float) && !x.finite? ? x : (x + 0.5).floor }

  # MEASURED, NOT GUESSED. Standing up, a caption takes its WIDTH out of the
  # same axis the rails are spread along, and two captions on one line
  # twenty minutes apart are taller than the twenty minutes between them.
  # The caption solver slides and ladders them along the axis when the
  # board is flat; standing up it does neither, so they stack on one
  # column and lie across each other and across the next rail along.
  #
  # That is a real defect and it is not this change's to fix: it predates
  # every case in this file, which is exactly why the cases are here. See
  # Standing up, captions are never slid or laddered along the axis.
  why = 'portrait captions are not slid or laddered along the axis: E13'

  # STANDING UP THE WORDS RUN DOWN THE RAIL (draw.js), so a caption's drawn
  # box is the box the solver booked, and the lists of boards these failed
  # on are empty. A new entry needs a reason that is not "portrait".
  overlap_known = Set.new([])
  pierce_known = Set.new([])

  Metro.fixtures.each do |f|
    standing.each do |vname|
      it "no two captions overlap standing up: #{f['name']}/#{vname}" do
        known(why) if overlap_known.include?(f['name'])
        rep = layout(f, by_name.(vname))
        ls = text_labels(rep)
        bad = []
        (0...ls.length).each do |i|
          ((i + 1)...ls.length).each do |j|
            o = overlap(ls[i], ls[j])
            next unless o && o['w'] > overlap_tol && o['h'] > overlap_tol

            bad.push("\"#{ls[i]['text']}\" x \"#{ls[j]['text']}\" (#{round.(o['w'])}x#{round.(o['h'])}px)")
          end
        end
        assert(bad.empty?, "#{bad.length} overlapping label pair(s): #{bad.first(6).join('; ')}")
      end
    end
  end

  Metro.fixtures.each do |f|
    standing.each do |vname|
      it "no rail runs through somebody else's caption standing up: #{f['name']}/#{vname}" do
        known(why) if pierce_known.include?(f['name'])
        # Standing up this is the one that catches a caption column wider
        # than the gap between two rails: the words simply lie across the
        # next line along.
        rep = layout(f, by_name.(vname))
        ls = text_labels(rep)
        lines = paths_where(rep, 'track') + paths_where(rep, 'spur')
        owns = {}
        f['metro']['legend'].each { owns[it['name']] = it['key'] }
        bad = []
        ls.each do |box|
          lines.each do |p|
            bare = box['text'].to_s.sub(/[[:space:]]*\+\d+\z/, '')
            next if !owns[bare].to_s.empty? && owns[bare] == p['owner']

            d = deepest_intrusion(p['pts'], box)
            bad.push("\"#{box['text']}\" pierced #{round.(d)}px by #{p['role']} #{p['owner']}") if d > intrusion_tol
          end
        end
        assert(bad.empty?, "#{bad.length} label(s) with a line through them: #{bad.first(6).join('; ')}")
      end
    end
  end
end
