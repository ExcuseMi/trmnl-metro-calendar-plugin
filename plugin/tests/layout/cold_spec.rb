# frozen_string_literal: true

# THE SAME BOARD, WHETHER OR NOT THE FACES WERE ALREADY THERE.
#
# A board is measured, so it is laid out in whatever faces the page has when
# it is solved. The first board a fresh browser drew came out different from
# every board after it -- same payload, same panel, the layout run once each
# time -- because a face the captions are set in was still on its way when
# the solve measured them, and nothing drew the board again when it arrived.
# On the panel that is the board somebody reads after a refresh that found
# the cache cold. The sweep saw it as one example board that flipped
# between two answers from run to run (simpsons 07:30 og-half-horizontal).
#
# `fresh_browser: true` draws in a Firefox of its own with nothing cached,
# which is the cold page; the warm one is the suite's own browser, on its
# second render of the board.

require_relative '../support/layout'

RSpec.describe 'cold' do
  digest = lambda do |r|
    Digest::SHA1.hexdigest(JSON.generate(Metro.plain([r['debug']['gaps'], r['debug']['shed'],
                                                     r['labels'].map do |l|
                                                       [l['cls'], l['text'], *%w[x y w h].map { (l[it] + 0.5).floor }]
                                                     end])))
  end

  [%w[og_png busy-day], %w[v2 five-lines]].each do |device, name|
    it "a cold page draws the board a warm one draws · #{device} · #{name}" do
      metro = Metro.fixtures.find { it['name'] == name }['metro']
      options = { device:, data: { 'data' => metro }, transform: false, **Metro::Page::PAGE }
      cold = Metro::Page.report(trmnl.render(**options, fresh_browser: true))
      trmnl.render(**options)
      warm = Metro::Page.report(trmnl.render(**options))
      assert(digest.(cold) == digest.(warm), 'the first board differs from the second')
    end
  end
end
