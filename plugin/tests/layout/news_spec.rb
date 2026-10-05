# frozen_string_literal: true

# THE ONE ROW OF HEADLINES, CLAMPED (rule 2i). The offline boards suite
# cannot measure a row, so it proves the row's pieces and nothing about
# where it ends. This does: six long headlines strung along one row are
# cut where the row ends, inside the box, the last of them with an
# ellipsis, and none of them wraps.

require_relative '../support/layout'

RSpec.describe 'news' do
  include Metro::Layout

  og = 'screen--og screen--md screen--1bit screen--density-1x'
  x = 'screen--v2 screen--lg screen--4bit screen--density-2x'
  views = [
    { name: 'og-landscape', w: 800, h: 480, classes: og },
    { name: 'x-landscape', w: 1872, h: 1404, classes: x }
  ]
  busy = Metro.fixtures.find { it['name'] == 'busy-day' }
  titles = [
    'Nieuwe speeltuin in het Citadelpark opent zaterdag om tien uur',
    'Werken aan de Dampoort: tram 4 rijdt een maand niet, bussen vervangen',
    'Gentse Feesten 2027 krijgen een extra dag en een tweede podium',
    'Stad Gent plant 300 extra bomen langs de Coupure en de Leie',
    'Zwembad Rozebroeken twee weken dicht voor onderhoud van de filters',
    'Bibliotheek De Krook opent zondag ook in de namiddag tot zes uur'
  ]
  news = lambda do |sources|
    { 'max' => 1, 'fit' => true,
      'items' => titles.each_with_index.map { |t, i| { 'title' => t, 'source' => sources[i % sources.length] } } }
  end
  row_of = lambda do |rep|
    rep['labels'].find { /metro-news-row/.match?(it['cls'].to_s) && !/metro-banner/.match?(it['cls'].to_s) }
  end
  # Math.round, and a number printed as JavaScript prints it
  round = ->(n) { n.is_a?(Float) && !n.finite? ? n : (n + 0.5).floor }
  num = ->(n) { Metro.plain(n) }

  it 'one row, clamped: the headlines are cut where the row ends, inside the box' do
    views.each do |v|
      rep = layout(busy, v, { 'news' => news.(['Het Nieuwsblad']) })
      row = row_of.(rep)
      assert(row, "#{v[:name]}: no headline row")
      assert(row['x'] + row['w'] <= rep['canvas']['w'] + 0.5,
             "#{v[:name]}: the row runs out of the box: #{round.(row['x'] + row['w'])} > #{num.(rep['canvas']['w'])}")
      # one line: no taller than a label and a half
      line_h = row['h']
      assert(line_h < 40 * (v[:w] > 1000 ? 2 : 1), "#{v[:name]}: the row wrapped, #{round.(line_h)}px tall")
      shown = titles.count { row['text'].include?(it) }
      assert(shown >= 1 && shown < titles.length, "#{v[:name]}: #{shown} whole headlines on the row")
      # the row ends in a cut headline, or the room left is too little for one
      left = rep['canvas']['w'] - (row['x'] + row['w'])
      assert(/…\z/.match?(row['text']) || left < line_h * 0.6 * 10,
             "#{v[:name]}: the row is not clamped: ends \"#{row['text'][-20..] || row['text']}\" " \
             "with #{round.(left)}px to spare")
      assert(!/metro-pill/.match?(row['cls'].to_s) && !row['text'].include?('Het Nieuwsblad'),
             "#{v[:name]}: a lone source was named")
    end
  end

  it 'only the cut headline gives way: no headline is printed over the one beside it' do
    # Giving the row its width made it a flex box narrower than its words,
    # and every piece gave way rather than only the clamped one. These
    # never wrap, so the first headline's words ran across the second's
    # and the two were printed on top of each other, which the row's own
    # box and its run-together text cannot show.
    views.each do |v|
      rep = layout(busy, v, { 'news' => news.(['Het Nieuwsblad']) })
      row = row_of.(rep)
      assert(row, "#{v[:name]}: no headline row")
      assert(row['parts'] && row['parts'].length >= 2, "#{v[:name]}: the row reported no pieces")
      cut = row['parts'].select { it['clamp'] }
      assert(cut.length <= 1, "#{v[:name]}: #{cut.length} headlines were told to clamp")
      row['parts'].each do |p|
        next if p['clamp']

        assert(!p['over'], "#{v[:name]}: \"#{p['text'][0, 40]}\" is squeezed " \
                           "#{round.(p['w'])}px wide and prints over what is beside it")
      end
      # ...and the pieces still range one after another, left to right
      (1...row['parts'].length).each do |i|
        a = row['parts'][i - 1]
        b = row['parts'][i]
        assert(b['x'] >= a['x'] + a['w'] - 0.5, "#{v[:name]}: piece #{i} starts before the one before it ends")
      end
    end
  end

  it 'two sources on the clamped row are named by their pills, in front of their headlines' do
    rep = layout(busy, views[1], { 'news' => news.(['Het Nieuwsblad', 'De Wilgenhoek']) })
    row = row_of.(rep)
    assert(row, 'no headline row')
    assert(row['x'] + row['w'] <= rep['canvas']['w'] + 0.5, 'the row runs out of the box')
    assert(/\AHet Nieuwsblad/.match?(row['text']) && /·[[:space:]]*De Wilgenhoek/.match?(row['text']),
           "the sources are not in front of their headlines: #{row['text'][0, 80]}")
  end
end
