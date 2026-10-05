# frozen_string_literal: true

# A half and a quadrant are slots inside a whole screen, and they are where
# this plugin has the least room and the most to say. Two things were
# spending what room there is on nothing.

require_relative '../support/layout'

RSpec.describe 'smallviews' do
  include Metro::Layout

  og = 'screen--og screen--md screen--1bit screen--density-1x'
  x = 'screen--v2 screen--lg screen--4bit screen--density-2x'
  # A slot is given in the screen's OWN css px, which for the X is 1040x780
  # (--screen-w/--screen-h), not its 1872x1404 of device pixels.
  slots = [
    { view: 'full', name: 'og-quadrant', w: 800, h: 480, slot: { w: 400, h: 240 }, classes: og },
    { view: 'full', name: 'og-half-horizontal', w: 800, h: 480, slot: { w: 800, h: 240 }, classes: og },
    { view: 'full', name: 'og-half-vertical', w: 800, h: 480, slot: { w: 400, h: 480 }, classes: og }
  ]
  # The same three slots on an X. They are far bigger in pixels, and that
  # is exactly why they went wrong: every rule about "a small view" was
  # written against a number of pixels, and an X quadrant clears all of
  # them while still being a quarter of a panel.
  xslots = [
    { view: 'full', name: 'x-quadrant', w: 1872, h: 1404, slot: { w: 520, h: 390 }, classes: x },
    { view: 'full', name: 'x-half-horizontal', w: 1872, h: 1404, slot: { w: 1040, h: 390 }, classes: x },
    { view: 'full', name: 'x-half-vertical', w: 1872, h: 1404, slot: { w: 520, h: 780 }, classes: x }
  ]
  busy = Metro.fixtures.find { it['name'] == 'busy-day' }
  # Math.round
  round = ->(n) { n.is_a?(Float) && !n.finite? ? n : (n + 0.5).floor }
  truthy = ->(n) { n.nil? || n.zero? ? nil : n }

  # The header hides the date and the weather at this size for want of
  # room, which leaves a band carrying the mark and the word "Today". On a
  # quadrant that band was a third of the board.
  # A HALF AND A QUADRANT PREFER THE MAP TO THE HEADER, AT ANY SIZE.
  #
  # The rule was a pixel count -- drop the header under 300px of depth --
  # which is true of every slot on an OG panel and of none on an X, where
  # a half-horizontal is 1040x390 and a quadrant 520x390. Both cleared the
  # threshold and kept a band saying "Today" across a view with half the
  # panel's depth to spend. What decides this is not how many pixels the
  # slot has but how much of the panel's DEPTH it got: at half or less,
  # the map wants it more than the word does.
  it 'a tiny view spends no height on a header that says nothing' do
    (slots[0, 2] + xslots[0, 2]).each do |v|
      rep = render(busy['metro'], v)
      # IN THE SAME UNITS. `rep.canvas` is device pixels and a slot is
      # given in the screen's own css px, which on an OG panel are the same
      # number and on an X are 1.8 apart -- so this compared 596 against
      # 390, passed, and said nothing at all about the panel it was added
      # for. The debug dump's own W/H are the css px the engine laid out
      # in, which is what a slot height is.
      laid_h = (rep['debug'] && truthy.(rep['debug']['H'])) || rep['canvas']['h']
      z = (rep['debug'] && truthy.(rep['debug']['Z'])) || 1
      top = (text_labels(rep).map { it['y'] } + [Float::INFINITY]).min / z
      assert(laid_h >= v[:slot][:h] * 0.9,
             "#{v[:name]}: the canvas is only #{round.(laid_h)}px of a #{v[:slot][:h]}px slot, " \
             'so something above it is still taking the height')
      assert(top < v[:slot][:h] * 0.2,
             "#{v[:name]}: the topmost thing drawn starts #{round.(top)}px down a #{v[:slot][:h]}px slot")
    end
  end

  # HALF A FAMILY DRAWN COMFORTABLY IS NOT BETTER THAN MOST OF ONE DRAWN TIGHTLY.
  #
  # `fitLines` estimates what a line costs two ways: tightly, which is what
  # a line whose events sit ON it needs, and generously, which adds the
  # clearance a line with a rung hanging off it needs. It used the generous
  # figure whenever somebody was going to be left off anyway, on the
  # argument that an incomplete board should spend its slack on the lines
  # it keeps. That is right on a full panel choosing between four
  # comfortable lines and five crowded ones. In a slot it was choosing
  # between one line and two: a half-horizontal on an 800x480 panel has
  # room for two by the tight figure and was drawing ONE of four people.
  it 'a flat slot draws as many people as it can hold, not as few' do
    lines = lambda do |rep|
      (busy['metro']['legend'] || []).length - ((rep['debug'] && rep['debug']['dropped']) || []).length
    end
    hh = render(busy['metro'], slots[1]) # og-half-horizontal, 4 lines offered
    assert(lines.(hh) >= 2, "og-half-horizontal drew #{lines.(hh)} line(s) of 4; the tight estimate says two fit")
  end

  # ...BUT NOT MORE PEOPLE THAN IT CAN WRITE DOWN.
  #
  # The same exemption, applied everywhere, filled the slots it did not
  # belong in. Standing up, every line takes a column the width of its
  # words: a half-vertical kept four lines in 60px columns and wrote
  # "Assemb / ly", "Playgro / up", "Detenti / on" -- eleven captions on top
  # of each other on an 800x480 panel, seventeen on an X. And flat, on a
  # 520px X quadrant, a fourth line's captions had no axis to spread along
  # and landed on each other. A slot that shows fewer people legibly is a
  # better answer than one that shows more of them illegibly.
  it 'a slot keeps only the people whose captions it can write legibly' do
    five = fixtures.find { it['name'] == 'five-lines' }
    overlaps_in = lambda do |rep|
      ls = text_labels(rep)
      n = 0
      (0...ls.length).each do |i|
        ((i + 1)...ls.length).each do |j|
          o = overlap(ls[i], ls[j])
          n += 1 if o && o['w'] > 2 && o['h'] > 2
        end
      end
      n
    end
    [
      [busy, slots[2], 5],  # og-half-vertical: was 11
      [five, slots[2], 3],  # og-half-vertical: was 9
      [five, xslots[2], 4], # x-half-vertical: was 17
      [five, xslots[0], 3]  # x-quadrant, 520px of axis
    ].each do |fixture, v, most|
      rep = render(fixture['metro'], v)
      n = overlaps_in.(rep)
      assert(n <= most, "#{v[:name]} (#{fixture['name']}): #{n} overlapping caption pairs, " \
                        'so it is keeping more people than it can write down')
    end
  end

  # "+3 earlier" and the clock badge are both pinned to the head of the
  # scale. On a quadrant the strip is a few hours wide and they were
  # written straight over each other: "+3 earlier1:32am".
  early = Metro.deep_copy(busy['metro'])
  early['day_start_min'] = 600 # events before this become "+n earlier"
  early['now_min'] = 605       # and the clock sits at the very head

  it 'the clock badge never lands on the overflow note' do
    slots.each do |v|
      rep = render(early, v)
      notes = text_labels(rep).select { " #{it['cls']} ".include?(' metro-axis-note ') }
      bad = []
      (0...notes.length).each do |i|
        ((i + 1)...notes.length).each do |j|
          o = overlap(notes[i], notes[j])
          bad.push("\"#{notes[i]['text']}\" over \"#{notes[j]['text']}\"") if o && o['w'] > 1 && o['h'] > 1
        end
      end
      assert(bad.empty?, "#{v[:name]}: #{bad.join('; ')}")
    end
  end

  # And when it does not fit beside the clock, the count is the half worth
  # keeping: "+3" says as much as "+3 earlier" does at the head of a scale.
  it 'an overflow note that cannot fit its word keeps its number' do
    rep = render(early, slots[0])
    notes = text_labels(rep).select { " #{it['cls']} ".include?(' metro-axis-note ') }
    counts = notes.select { /\A\+\d/.match?(it['text'].to_s) }
    assert(counts.length.positive?, 'a board with events off both ends of the window drew no overflow note at all')
    counts.each do |n|
      assert(n['x'] + n['w'] <= rep['canvas']['w'] + 1 && n['x'] >= -1, "the note \"#{n['text']}\" runs off the scale")
    end
  end
end
