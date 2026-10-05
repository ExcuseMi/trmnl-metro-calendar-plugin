# frozen_string_literal: true

# The service alert banner (E6). Everything else this suite measures is
# drawn by the script from the METRO payload; the banner is drawn by
# LIQUID, from the same payload, before any of that runs. So it is the one
# part of the board a fixture cannot reach and the one part that had never
# been rendered in a test: it had only been seen by hand-injecting the
# markup into a built page, which proves the CSS and nothing about the
# template. These cases render it for real, through a build of its own
# (`layout(fixture, view, { 'service_alert' => ... })`).
#
# THE BANNER IS THE FIRST ROW OF THE BOX ALONG THE FOOT OF THE MAP now,
# drawn by the script with the same classes and pieces it always had (one
# box with the headlines, not a band and a box: "can weather alert combine
# with news alerts?"). The claim is the same in spirit: the map gives up
# the box's height, the rails end above it, and nothing is drawn under it.

require_relative '../support/layout'

RSpec.describe 'banner' do
  include Metro::Layout

  og = 'screen--og screen--md screen--1bit screen--density-1x'
  og2 = 'screen--og screen--md screen--2bit screen--density-1x'
  x = 'screen--v2 screen--lg screen--4bit screen--density-2x'
  views = [
    { name: 'og-landscape', w: 800, h: 480, classes: og },
    { name: 'og-quadrant', w: 800, h: 480, slot: { w: 400, h: 240 }, classes: og },
    { name: 'x-landscape', w: 1872, h: 1404, classes: x }
  ]
  # Every bit depth the badge's colour is mapped for, which is the whole
  # reason it is a framework variable and not a colour of this file's.
  depths = views + [{ name: 'og-2bit', w: 800, h: 480, classes: og2 }]
  busy = Metro.fixtures.find { it['name'] == 'busy-day' }

  # JS unary plus on a computed weight: a number, or NaN when there is none
  num = ->(w) { w.nil? ? Float::NAN : (Float(w, exception: false) || Float::NAN) }

  # What transform.js actually composes, copied from the English strings
  # rather than invented here: the banner is fully assembled and translated
  # by then, and the template's whole job is to print it unchanged.
  icons = 'https://trmnl.com/images/plugins/weather/'
  rain = { 'kind' => 'rain', 'icon' => "#{icons}wi-rain.svg",
           'text' => 'Rain from 14:00 until 17:00 (80%)' }
  # One of the longest lines this plugin can produce: a German snow alert
  # out of i18n/de.json. It is one line on a full OG board
  # and two on a quadrant, which is the case E6 was left open on.
  long_alert = { 'kind' => 'snow', 'icon' => "#{icons}wi-snow.svg",
                 'text' => "Schnee ab 17:00 bis in die Nacht, 80 % Wahrscheinlichkeit" }
  # The control for the wrap case: the same band, one line, same padding.
  short_alert = { 'kind' => 'rain', 'icon' => "#{icons}wi-rain.svg", 'text' => 'Regen' }

  # the banners that come in pieces: built further down, where their own
  # story is told
  parts = nil
  heat = nil

  it 'the banner prints what transform composed, unchanged' do
    views.each do |v|
      rep = layout(busy, v, { 'service_alert' => rain })
      assert(rep['banner'], "#{v[:name]}: service_alert was set and no banner was drawn at all")
      assert_equal(rep['banner']['text'], rain['text'], "#{v[:name]}: the banner text")
      assert_equal(rep['banner']['icon'] && rep['banner']['icon']['src'], rain['icon'], "#{v[:name]}: the icon")
      # The kind reaches the markup as an attribute so a stylesheet can
      # tell a snow day from a hot one without parsing the sentence.
      assert_equal(rep['banner']['kind'], rain['kind'], "#{v[:name]}: data-metro-alert")
      # icon, then message, along one row
      assert(rep['banner']['icon']['x'] < rep['banner']['message']['x'],
             "#{v[:name]}: the parts are out of order: icon #{rep['banner']['icon']['x'].round}" \
             ", message #{rep['banner']['message']['x'].round}")
    end
  end

  it 'no alert, no banner: the element is absent, not empty' do
    # `null` is what lets the map have the height back. A zero-height band
    # still occupies a flex slot and still carries its own padding, so
    # "collapses completely" has to mean the element is not there.
    views.each do |v|
      rep = layout(busy, v)
      assert_equal(rep['banner'], nil, "#{v[:name]}: a board with no alert drew a banner anyway")
    end
  end

  it 'the banner sits in the box at the foot, and the map ends above it' do
    # Inside the canvas now, but not over the map: the box is taken off the
    # cross extent, so every rail ends above the banner's top and the box
    # itself ends inside the canvas.
    views.each do |v|
      with_alert = layout(busy, v, { 'service_alert' => rain })
      assert(with_alert['banner'], "#{v[:name]}: service_alert was set and no banner was drawn")
      b = with_alert['banner']
      assert(b['y'] + b['h'] <= with_alert['canvas']['h'] + 1, "#{v[:name]}: the banner runs " \
        "#{(b['y'] + b['h'] - with_alert['canvas']['h']).round}px off the bottom of the canvas")
      rails = (with_alert['paths'] || []).select { |p| p['role'] == 'track' || p['role'] == 'spur' }
      assert(!rails.empty?, "#{v[:name]}: no rails to measure against")
      rails.each do |r|
        bottom = if r['y'].nil?
                   (r['pts'] || [[0, 0]]).map { |q| q[1] }.max || -Float::INFINITY
                 else
                   r['y'] + (r['h'] || 0)
                 end
        assert(bottom <= b['y'] + 1, "#{v[:name]}: a rail reaches #{(bottom - b['y']).round}px into the banner")
      end
    end
  end

  it 'the banner does not push the board off its own panel' do
    # A flex-none band at the bottom of a column that does not shrink
    # grows the column instead, and a board taller than its slot is not
    # reported anywhere: the device just cuts the bottom off, which on
    # this board means cutting off the alert. Checked on the busiest
    # fixtures and at the smallest slot, where there is least to give.
    %w[busy-day seven-lines full-day].each do |f|
      fx = fixtures.find { it['name'] == f }
      views.each do |v|
        rep = layout(fx, v, { 'service_alert' => rain })
        # THE FOOT GIVES WAY BEFORE A NAME DOES ("we should show user content
        # over alert and news at all times", fit.js refoot): a board that can
        # only name everything without the band drops the band, and that
        # board has to come out clean for it. Seven lines on an X did, once a
        # name written beside the wrong stop stopped counting as placed.
        unless rep['banner']
          shed = rep['debug']['shed']
          assert((shed.nil? || shed == false || shed == 0) && rep['debug']['faults'].empty?, "#{f} #{v[:name]}" \
            ': no banner was drawn, and the board was not the cleaner for it')
          next
        end
        over = (rep['root']['y'] + rep['root']['h']) - (rep['view']['y'] + rep['view']['h'])
        assert(over <= 1, "#{f} #{v[:name]}: the board runs #{over.round}" \
          "px past the bottom of its #{v[:slot] ? "#{v[:slot][:w]}x#{v[:slot][:h]}" : "#{v[:w]}x#{v[:h]}"}" \
          ' panel')
        cut = (rep['banner']['y'] + rep['banner']['h']) - (rep['view']['y'] + rep['view']['h'])
        assert(cut <= 1, "#{f} #{v[:name]}: #{cut.round}" \
          'px of the banner is off the bottom of the panel')
      end
    end
  end

  it 'a banner translation that wraps to two lines still fits on the board' do
    # The German snow line is 57 characters. On a quadrant it wraps, and
    # wrapping is allowed on purpose (an alert cut in half is worse than a
    # tall one) but only if the second line is on the panel and the map
    # has paid for it.
    # The quadrant's OWN build, not the full view scaled into a 400px slot:
    # the framework sets its type larger there, and that is where a long
    # alert actually wraps on a real device.
    v = { name: 'og-quadrant-view', page: 'quadrant', w: 400, h: 240, classes: og }
    long = layout(busy, v, { 'service_alert' => long_alert })
    assert(long['banner'], 'no banner on the quadrant')
    assert_equal(long['banner']['text'], long_alert['text'], 'the long banner was cut short')
    # Measured against the SAME banner carrying a short string rather than
    # against a line height plus padding: the band's own padding is most
    # of a line, so "taller than one and a half lines" was true of a
    # one-line banner too and this case was quietly not about wrapping at
    # all.
    one = layout(busy, v, { 'service_alert' => short_alert })
    grew = long['banner']['h'] - one['banner']['h']
    assert(grew >= one['banner']['lineHeight'] * 0.8, 'this case is only about a banner that wraps, ' \
      "and this one did not: #{long['banner']['h'].round}px against " \
      "#{one['banner']['h'].round}px for a short string. Pick a longer string or a " \
      'narrower slot.')
    # The root is the whole board; the banner's last line has to be inside it.
    root_bottom = long['root']['y'] + long['root']['h']
    assert(long['banner']['y'] + long['banner']['h'] <= root_bottom + 1, 'the wrapped banner runs ' \
      "#{(long['banner']['y'] + long['banner']['h'] - root_bottom).round}px off the bottom of the board")
    # ...and inside its box: the solver gave the alert two rows on a slot for
    # exactly this, so the wrapped line is not painted over the box's edge.
    assert(long['banner']['y'] + long['banner']['h'] <= long['canvas']['h'] + 1, 'the wrapped banner runs ' \
      "#{(long['banner']['y'] + long['banner']['h'] - long['canvas']['h']).round}px off the bottom of the canvas")
  end

  it 'the weather\'s own name is the loud one, on every bit depth' do
    # The band used to open with a label reading "Weather", which is the one
    # thing about a banner that can only ever be about the weather that
    # nobody has to be told. The word that IS worth the ink -- Rain, Snow,
    # Freezing rain -- carries the weight instead. It was a badge for a
    # while, `.metro-pill`, white with the word knocked out of it: on the
    # hour strip that reads as a different KIND of thing among the numbers,
    # and in a line of running text it read as a button. "Rain as a pill
    # looks bad."
    #
    # Bold is not a colour, so there is nothing here for a bit depth to map
    # wrong -- which is why it is still asked on all of them: the word has to
    # come out heavier than its neighbours and in the band's own paper rather
    # than the grey, on the panel that dithers as well as the one that does
    # not.
    depths.each do |v|
      rep = layout(busy, v, { 'service_alert' => parts })
      pieces = rep['banner']['pieces'] || []
      at = ->(t) { pieces.select { |p| p['text'].include?(t) }[0] || {} }
      assert(num.(at.('Rain')['weight']) > num.(at.('from')['weight']), "#{v[:name]}: the thing itself is not heavier " \
        "than the words around it: #{at.('Rain')['weight']} vs #{at.('from')['weight']}")
      assert_equal(at.('Rain')['color'], rep['banner']['paper'], "#{v[:name]}: the thing is " \
        "#{at.('Rain')['color']} on a band whose paper is #{rep['banner']['paper']}")
      assert(at.('from')['color'] != rep['banner']['paper'], "#{v[:name]}: the words around it are the " \
        'same colour, so there is no hierarchy at all')
    end
  end

  it 'the banner icon is drawn in the band\'s paper, a shade larger than the words' do
    # An adaptive icon is a mask painted in the text colour, so on the ink
    # band it comes out white by itself; a plain image would be a black
    # glyph on black. It is a solid shape and not a font, so there is no
    # weight to ask it for and size is the only lever it has: it is set
    # above the words it introduces so it reads as their equal.
    views.each do |v|
      rep = layout(busy, v, { 'service_alert' => rain })
      b = rep['banner']
      assert(b && b['icon'], "#{v[:name]}: no icon on the banner")
      size = Metro.plain(b['message']['fontSize'])
      assert(b['icon']['w'] >= b['message']['fontSize'] && b['icon']['h'] >= b['message']['fontSize'],
             "#{v[:name]}: the icon is " \
             "#{b['icon']['w'].round}px, smaller than the #{size}px words beside it")
      assert(/wi-rain\.svg/.match?(b['icon']['mask'].to_s),
             "#{v[:name]}: the icon is not masked, so it is not recoloured: " \
             "#{b['icon']['mask']}")
      assert_equal(b['icon']['bg'], b['paper'], "#{v[:name]}: the icon is painted #{b['icon']['bg']} on the #{b['ink']} band")
      assert_equal(b['message']['color'], b['paper'], "#{v[:name]}: the message should be in the band's paper")
      assert(b['icon']['h'] > b['message']['fontSize'], "#{v[:name]}: the icon (#{b['icon']['h'].round}" \
        "px) is not set above the #{size}px words it introduces")
      assert(b['radius'].positive?, "#{v[:name]}: the band has square corners")
    end
  end

  it 'solid ink, paper text: the banner reads as an interruption' do
    # It is the one thing on the board that is not part of the map, and it
    # has to look like it. Both colours come from framework variables with
    # literal fallbacks, so a mistyped variable name still renders black on
    # white on a light board. What it would break is the INVERSION, which
    # is what this asserts rather than the two hex values.
    views.each do |v|
      rep = layout(busy, v, { 'service_alert' => rain })
      assert(rep['banner'], "#{v[:name]}: service_alert was set and no banner was drawn")
      assert(rep['banner']['ink'] != rep['banner']['paper'], "#{v[:name]}: the banner is " \
        "#{rep['banner']['paper']} text on a #{rep['banner']['ink']} band, which is invisible")
      assert_equal(rep['banner']['paper'], rep['boardBg'], "#{v[:name]}: the banner text should be knocked " \
        "out of the band in the canvas colour (#{rep['boardBg']})")
      assert(rep['banner']['ink'] != rep['boardBg'], "#{v[:name]}: the band is the same colour as the " \
        'board, so it is not a band')
    end
  end

  # THE SENTENCE IN THREE WEIGHTS. transform.js splits the banner at its own
  # placeholders and the template prints each piece in its own span; whether
  # that actually lands as bold and as grey is a computed style, and this is
  # the only harness that has one.
  parts = {
    'kind' => 'rain', 'icon' => "#{icons}wi-rain.svg",
    'text' => 'Rain from 14:00 until 17:00 (80%)',
    'parts' => [{ 't' => 'Rain', 's' => 'b' }, { 't' => ' from ', 's' => 'q' }, { 't' => '14:00', 's' => '' },
                { 't' => ' until ', 's' => 'q' }, { 't' => '17:00', 's' => '' }, { 't' => ' (80%)', 's' => 'q' }]
  }
  # A heat banner: the badge, a bold temperature and the stretch of the day
  # it is about. Three kinds of emphasis in one line, which is the most this
  # banner ever carries.
  heat = {
    'kind' => 'heat', 'icon' => "#{icons}wi-hot.svg", 'text' => "Hot, up to 36°C (13:00–17:00)",
    'parts' => [{ 't' => 'Hot', 's' => 'b' }, { 't' => ', up to ', 's' => 'q' }, { 't' => "36°C", 's' => 'b' },
                { 't' => ' (', 's' => 'q' }, { 't' => "13:00–17:00)", 's' => '' }]
  }

  it 'the banner sets the thing bold and the clock quiet' do
    rep = layout(busy, views[2], { 'service_alert' => parts })
    assert_equal(rep['banner']['text'], parts['text'], 'the pieces must still read as the line')
    pieces = rep['banner']['pieces'] || []
    assert(pieces.length > 1, "the banner was printed as one piece: #{pieces.to_json}")
    weight = ->(t) { (pieces.select { |p| p['text'].include?(t) }[0] || {})['weight'] }
    plain = (pieces.select { |p| p['text'].include?('from') }[0] || {})['weight']
    assert(num.(weight.('Rain')) > num.(plain), 'the thing itself is not bolder than the words around it: ' \
      "#{weight.('Rain')} vs #{plain}")
    clock = pieces.select { |p| p['text'].include?('14:00') }[0]
    body = pieces.select { |p| p['text'].include?('from') }[0]
    assert(clock && body && clock['color'] != body['color'],
           "the clock is the same colour as the words: #{[clock, body].to_json}")
  end

  it 'a heat banner bolds the weather and its degree, and lights the stretch' do
    # The busiest line this banner draws: three kinds of emphasis, and the
    # clock range that says which part of the day it is about.
    rep = layout(busy, views[2], { 'service_alert' => heat })
    assert_equal(rep['banner']['text'], heat['text'], 'the pieces must still read as the line')
    pieces = rep['banner']['pieces'] || []
    at = ->(t) { pieces.select { |p| p['text'].include?(t) }[0] || {} }
    assert(num.(at.('36')['weight']) > num.(at.('up to')['weight']), 'the temperature is not bolder than the words around it: ' \
      "#{at.('36')['weight']} vs #{at.('up to')['weight']}")
    assert(at.('13:00')['color'] != at.('up to')['color'],
           "the stretch is the same colour as the words holding it: #{pieces.to_json}")
  end

  it 'a banner with no parts still prints its whole line' do
    # Older saved state and anything else that never learned about `parts`.
    rep = layout(busy, views[2], { 'service_alert' => rain })
    assert_equal(rep['banner']['text'], rain['text'], 'the fallback dropped the sentence')
  end
end
