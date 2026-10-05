# frozen_string_literal: true

# THE NOW/NEXT CARD, WHICH ONLY EXISTS IN A BROWSER.
#
# Everything this card does is decided from measured text: which of three
# sizes it wears, whether a title is cut at a word, which day's panel it goes
# in. The jsdom harness cannot
# see any of it -- offsetWidth is zero there, so the card never cuts, never
# shrinks and never competes for space, and a case written over there passes
# whatever the panel does. Every one of the faults below was found by looking
# at a screenshot, which is a slow way to find them twice.

require_relative '../support/layout'

RSpec.describe 'nownext' do
  include Metro::Layout

  by_name = ->(n) { Metro::Layout::VIEWPORTS.find { |v| v[:name] == n } }
  roomy = by_name.('x-landscape')
  has = ->(l, c) { " #{l['cls']} ".include?(" #{c} ") }
  card_of = ->(rep) { rep['labels'].find { has.(it, 'metro-nownext') } }
  badges_of = ->(rep) { rep['labels'].select { has.(it, 'metro-daybadge') } }
  mid = ->(b) { b['y'] + (b['h'] / 2.0) }
  # Math.round
  round = ->(x) { x.is_a?(Float) && !x.finite? ? x : (x + 0.5).floor }

  Metro.fixtures.each do |f|
    it "the now/next card keeps off everything else in the strip: #{f['name']}" do
      rep = layout(f, roomy)
      card = card_of.(rep)
      next unless card # no clock, or no room: both fine

      bad = []
      rep['labels'].each do |l|
        next if l.equal?(card) || has.(l, 'metro-nownext')
        # the card sits inside the strip, so only the strip's own furniture
        # can be in its way
        next unless has.(l, 'metro-daybadge') || has.(l, 'metro-wx') || has.(l, 'metro-axis-note')

        bad.push("#{l['cls'][/metro-[a-z]+/] || '?'} \"#{l['text'][0, 20]}\"") if overlap(card, l)
      end
      assert(bad.empty?, "the card is written over #{bad.join(', ')}")
    end

    it "a one-row card is level with the date beside it: #{f['name']}" do
      # Centred on the two-row band instead, a single row lands between the
      # date above it and the forecast below, level with neither.
      rep = layout(f, roomy)
      card = card_of.(rep)
      next unless card

      badges = badges_of.(rep).select { it['h'] > 0 }
      next if badges.empty?

      # the badge this card was placed against: the nearest one to its left
      left = badges.select { it['x'] <= card['x'] + 2 }
                   .each_with_index.min_by { |b, i| [card['x'] - b['x'], i] }&.first || badges[0]
      next if card['h'] > left['h'] * 1.6 # a two-row card: centred on the band, correctly
      # ...OR UNDER THE DATE, starting where it starts, when that row is the
      # wider slot: beside the date on a full panel the card cut "Shift
      # Handover" to "Shift..." with the whole row under the title empty.
      next if (card['x'] - left['x']).abs <= 4 && card['y'] >= left['y'] + left['h'] - 2

      assert((mid.(card) - mid.(left)).abs <= [4, left['h'] * 0.35].max,
             "the card sits #{round.(mid.(card) - mid.(left))}px off the date \"#{left['text'][0, 14]}\"")
    end

    it "the card says a whole event where it has the whole strip: #{f['name']}" do
      rep = layout(f, roomy)
      card = card_of.(rep)
      next unless card
      # ONLY WHERE THE STRIP IS ONE PANEL. A rolling board splits it between
      # today and tomorrow, and today's half, less its date and its forecast,
      # is a narrow place: rolling-quiet cuts "Swim Training" to "Swim…"
      # there with no room going spare, which is the ladder working rather
      # than failing. Given the whole strip, a cut means it asked for more
      # than it should have.
      next if badges_of.(rep).count { it['h'] > 0 } > 1

      assert(!card['text'].include?('…'), "cut on a full-width board: \"#{card['text']}\"")
    end

    it "a \"now\" row is never drawn in a later day's panel: #{f['name']}" do
      # The header above a panel is what says which day its contents are
      # about, so "Nu Kantoor" under a badge reading Morgen tells the reader
      # that tomorrow, now, somebody is at the office. Reported from a real
      # board in three words: "Now in tomorrow?". It came of a fallback that
      # drew today's rows in tomorrow's panel when today had no room.
      rep = layout(f, roomy)
      card = card_of.(rep)
      next unless card

      badges = badges_of.(rep).select { it['h'] > 0 }.each_with_index.sort_by { |b, i| [b['x'], i] }.map(&:first)
      next if badges.length < 2 # one panel: nowhere else to be

      i18n_now = f['metro']['i18n'] && f['metro']['i18n']['now']
      now_word = i18n_now.to_s.empty? ? 'Now' : i18n_now
      next unless card['text'].start_with?(now_word) # not a now row

      assert(card['x'] < badges[1]['x'],
             "a \"#{now_word}\" row sits in the panel of \"#{badges[1]['text'][0, 14]}\"")
    end

    it "a card with both a now and a next keeps both rows: #{f['name']}" do
      # WHAT THE BADGE ACTUALLY BROKE, and it was worse than it looked.
      # `.metro-pill` carries its own line-height and an inset top and bottom,
      # so a row with a badge overran the band -- and the card's answer to not
      # fitting is to drop the "Now" line and keep only what is next. busy-day
      # showed "Now Design Review" over "15:30 Sprint Planning" with the badge
      # held inside its line, and only the second of them without.
      #
      # So the assertion is about ROWS, not pixels: a board with something on
      # AND something later today has two things to say and the band is deep
      # enough for both.
      m = f['metro']
      now = m['now_min']
      next if now.nil?

      evs = (m['events'] || []).select do |e|
        (e['type'].to_s.empty? || e['type'] == 'event') && !e['start_min'].nil?
      end
      day1 = m['days'] && m['days'][1]
      midnight = day1 && !day1['start_min'].nil? ? day1['start_min'] : 24 * 60
      ending = ->(e) { e['end_min'].nil? || e['end_min'].zero? ? e['start_min'] : e['end_min'] }
      on = evs.any? { |e| e['start_min'] <= now && ending.(e) > now }
      later = evs.any? { |e| e['start_min'] > now && e['start_min'] < midnight }
      next if !on || !later

      rep = layout(f, roomy)
      card = card_of.(rep)
      next unless card

      badges = badges_of.(rep).select { it['h'] > 0 }
      next if badges.empty?
      # a rolling board's today panel is half the strip and may honestly have
      # room for one line only; this is about the boards that have the room
      next if badges.length > 1

      rows = [1, round.(card['h'].fdiv(badges[0]['h']))].max
      assert(rows >= 2, "both a now and a next, but the card drew #{rows} row(s): \"#{card['text'][0, 40]}\"")
    end
  end
end
