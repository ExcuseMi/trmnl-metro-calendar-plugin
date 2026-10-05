# frozen_string_literal: true

# The hour scale used to run down the MIDDLE of the board with the lines
# split above and below it, so a grey band cut every person's day in half.
# It is a header now: a strip along the leading edge, with the map running
# the whole depth beside it.

require_relative '../support/layout'

RSpec.describe 'band' do
  include Metro::Layout

  by_name = ->(n) { Metro::Layout::VIEWPORTS.find { it[:name] == n } }
  roomy = by_name.('x-landscape')
  busy = Metro.fixtures.find { it['name'] == 'busy-day' }

  # Math.round as the messages had it, which also prints an Infinity
  # instead of raising on one
  round = ->(x) { x.respond_to?(:finite?) && !x.finite? ? x : (x + 0.5).floor }
  # a missing owner printed as "null"
  owner = ->(p) { p['owner'].nil? ? 'null' : p['owner'] }

  # "across" is y when the board is lying down and x when it is stood up:
  # every measurement here is on the cross axis, whichever one that is
  cross = ->(rep) { rep['debug']['horizontal'] ? 1 : 0 }
  span_of = lambda do |rep, parts|
    i = cross.(rep)
    lo = Float::INFINITY
    hi = -Float::INFINITY
    parts.each do |p|
      if p['pts']
        p['pts'].each do |q|
          lo = [lo, q[i]].min
          hi = [hi, q[i]].max
        end
      else
        lo = [lo, i == 1 ? p['y'] : p['x']].min
        hi = [hi, i == 1 ? p['y'] + p['h'] : p['x'] + p['w']].max
      end
    end
    { lo:, hi: }
  end
  shapes = ->(rep, role) { ((rep['paths'] || []) + (rep['rects'] || [])).select { it['role'] == role } }
  band_of = ->(rep) { span_of.(rep, shapes.(rep, 'river')) }

  # the busy board with sky markers on it: built further down, where its
  # own story is told
  sky = nil

  Metro.fixtures.each do |f|
    it "no line crosses the hour band: #{f['name']}" do
      rep = layout(f, roomy)
      band = band_of.(rep)
      assert(band[:lo].finite?, 'no hour band drawn')
      bad = []
      (paths_where(rep, 'track') + paths_where(rep, 'spur')).each do |p|
        # the strip is a header, so nothing belonging to the map may reach
        # into it -- a line that does is the old "band through the middle"
        p['pts'].each do |q|
          next unless q[1] < band[:hi] - 1

          bad.push("#{p['role']} #{owner.(p)}")
          break
        end
      end
      assert(bad.empty?, "#{bad.length} line(s) reaching into the hour band: " \
        "#{bad.uniq.first(4).join(', ')}")
    end
  end

  it 'the hour band sits at the leading edge, not through the map' do
    [roomy, by_name.('x-portrait'), by_name.('og-landscape'), by_name.('og-half')].each do |v|
      rep = render(busy['metro'], v)
      band = band_of.(rep)
      depth = rep['debug']['horizontal'] ? rep['canvas']['h'] : rep['canvas']['w']
      assert(band[:lo] <= 2, "#{v[:name]}: the band starts #{round.(band[:lo])}px in, not at the edge")
      assert(band[:hi] < depth * 0.35, "#{v[:name]}: the band reaches #{round.(band[:hi])}" \
        "px into a #{round.(depth)}px board")
    end
  end

  it 'the hours are written on the band' do
    rep = layout(busy, roomy)
    band = band_of.(rep)
    hours = text_labels(rep).select { |l| " #{l['cls']} ".include?(' metro-hour ') }
    assert(hours.length >= 3, "expected the hour scale, found #{hours.length} hour label(s)")
    off = hours.select { |l| l['y'] < band[:lo] - 2 || l['y'] + l['h'] > band[:hi] + 2 }
    assert(off.empty?, "#{off.length} hour label(s) off the band: " \
      "#{off.map { |l| "\"#{l['text']}\"" }.join(', ')}")
  end

  # Nothing is drawn across the board at "now". A rule there was the one
  # line drawn at a minute rather than belonging to anybody, so nothing
  # routed around it and it cut through captions the whole width of the
  # map. The badge on the scale says what time it is; each line's car says
  # where that person is.
  it 'nothing is ruled across the board at a moment in time' do
    [roomy, by_name.('x-portrait')].each do |v|
      rep = render(sky, v)
      # The clock's own rule down the board is the one exception, and it is
      # not ruled FROM the scale: it is a dotted hairline the captions are
      # kept off (day.js, NOW AS A LINE STRAIGHT DOWN THE BOARD).
      nows = shapes.(rep, 'now')
      # the sky markers used to drop one too
      band = band_of.(rep)
      i = cross.(rep)
      depth = rep['debug']['horizontal'] ? rep['canvas']['h'] : rep['canvas']['w']
      long = (rep['paths'] || []).reject { |p| nows.any? { it.equal?(p) } }.select do |p|
        at = p['pts'].map { |q| q[i] }
        next false if at.empty? # Math.max of nothing is -Infinity: never long

        at.max - at.min > depth * 0.5 && at.min < band[:hi] + 4
      end
      assert(long.empty?, "#{v[:name]}: #{long.length}" \
        ' line(s) still run from the scale across the whole board')
    end
  end

  it 'the clock is stated as a badge on the scale' do
    rep = layout(busy, roomy)
    # the clock's pill, not a line name's roundel (also a pill, on the map)
    pills = text_labels(rep).select do |l|
      " #{l['cls']} ".include?(' metro-pill ') && / metro-axis-note /.match?(" #{l['cls']} ")
    end
    assert(pills.length == 1, "expected one clock badge on the scale, found #{pills.length}")
    assert(/\d/.match?(pills[0]['text']), "the clock badge says \"#{pills[0]['text']}\"")
  end

  # Sky markers used to be set at the very top of the canvas. The hour
  # scale moved there, and nothing said so: a marker's own time was written
  # straight over the hour tick on the strip.
  #
  # These were `type: 'sun'` markers when the board still drew a sunrise
  # and a sunset. Those are gone and `weather` is the only kind left, so
  # the fixtures below are weather markers -- a case feeding a payload the
  # transform can no longer produce proves nothing about the board.
  sky = Metro.deep_copy(busy['metro'])
  dot = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>" \
        "<circle cx='12' cy='12' r='6' fill='black'/></svg>"
  sky['weather'] = (sky['weather'] || []) + [
    { 'type' => 'weather', 'at_min' => sky['day_start_min'] + 40, 'icon' => dot, 'label' => 'Rain starts 06:40' },
    # deliberately just before the end of the window, where the last hour
    # tick and the "+n more" note both live
    { 'type' => 'weather', 'at_min' => sky['day_end_min'] - 12, 'icon' => dot, 'label' => 'Rain stops 21:48' }
  ]

  it 'a sky marker never lands on the hour scale' do
    [roomy, by_name.('og-landscape')].each do |v|
      rep = render(sky, v)
      marks = text_labels(rep).select { |l| " #{l['cls']} ".include?(' metro-sky ') }
      next if marks.empty? # too small a board to carry them at all

      scale = text_labels(rep).select do |l|
        c = " #{l['cls']} "
        c.include?(' metro-hour ') || c.include?(' metro-axis-note ')
      end
      bad = []
      marks.each do |m|
        scale.each do |t|
          o = overlap(m, t)
          bad.push("\"#{m['text']}\" over \"#{t['text']}\"") if o && o['w'] > 1 && o['h'] > 1
        end
      end
      assert(bad.empty?, "#{v[:name]}: #{bad.length} sky marker(s) on the scale: " \
        "#{bad.uniq.join('; ')}")
      # and below the strip, not floating in it
      band = band_of.(rep)
      i = cross.(rep)
      # the day's forecast is set IN its strip panel on purpose (rule 2c)
      inside = marks.select do |m|
        !" #{m['cls']} ".include?(' metro-wx ') && (i == 1 ? m['y'] : m['x']) < band[:hi] - 1
      end
      assert(inside.empty?, "#{v[:name]}: #{inside.length} sky marker(s) inside the strip")
    end
  end

  # STANDING UP, A SKY MARKER STAYS IN ITS GUTTER.
  #
  # A standing board sets its sky markers beside the bundle, right-aligned
  # against the first rail, in the gutter between the hour strip and the
  # map. When the text was wider than that gutter the position went
  # negative, a clamp pinned it to the left edge, and the text ran rightward
  # over the hour labels and straight through the rail it was meant to sit
  # beside: "Storms 20:00" written across Homer's line and over "8pm", and
  # the next marker's text printed on top of it, because nothing kept two
  # markers apart along the axis either.
  # On the busy two-person board AND the five-person one: a wide bundle is
  # what leaves the gutter too narrow for the words, and a thin one is what
  # shows the stacking on its own.
  with_sky = lambda do |metro|
    m = Metro.deep_copy(metro)
    m['weather'] = (m['weather'] || []) + [
      { 'type' => 'weather', 'at_min' => m['day_start_min'] + 40, 'icon' => dot, 'label' => 'Rain stops 06:40' },
      { 'type' => 'weather', 'at_min' => m['day_start_min'] + 300, 'icon' => dot, 'label' => 'Rain starts 13:00' },
      # a storm four minutes after the shower stops: two markers wanting
      # one spot
      { 'type' => 'weather', 'at_min' => m['day_end_min'] - 60, 'icon' => dot, 'label' => 'Rain stops 19:00' },
      { 'type' => 'weather', 'at_min' => m['day_end_min'] - 56, 'icon' => dot, 'label' => 'Storms 20:00' }
    ]
    m
  end
  og = 'screen--og screen--md screen--1bit screen--density-1x'
  five_lines = Metro.fixtures.find { it['name'] == 'five-lines' }
  it 'standing up, a sky marker crosses neither the hour strip, nor a rail, nor another marker' do
    all_bad = []
    [
      [busy['metro'], { view: 'full', name: 'og-half-vertical', w: 800, h: 480, slot: { w: 400, h: 480 }, classes: og }],
      [five_lines['metro'], { view: 'full', name: 'og-half-vertical', w: 800, h: 480, slot: { w: 400, h: 480 }, classes: og }],
      [busy['metro'], by_name.('x-portrait')],
      [five_lines['metro'], by_name.('x-portrait')]
    ].each do |metro, v|
      rep = render(with_sky.(metro), v)
      next if rep['debug']['horizontal']

      labels = text_labels(rep)
      marks = labels.select { |l| " #{l['cls']} ".include?(' metro-sky ') }
      scale = labels.select do |l|
        c = " #{l['cls']} "
        c.include?(' metro-hour ') || c.include?(' metro-axis-note ')
      end
      bad = []
      marks.each do |m|
        scale.each do |t|
          o = overlap(m, t)
          bad.push("\"#{m['text']}\" over the scale's \"#{t['text']}\"") if o && o['w'] > 1 && o['h'] > 1
        end
        (paths_where(rep, 'track') + paths_where(rep, 'spur')).each do |p|
          next unless deepest_intrusion(p['pts'], m) > 2

          bad.push("\"#{m['text']}\" across #{owner.(p)}'s line")
          break
        end
      end
      (0...marks.length).each do |i|
        ((i + 1)...marks.length).each do |j|
          o = overlap(marks[i], marks[j])
          bad.push("\"#{marks[i]['text']}\" on \"#{marks[j]['text']}\"") if o && o['w'] > 1 && o['h'] > 1
        end
      end
      all_bad.push("#{v[:name]} (#{metro['legend'].length} lines): #{bad.uniq.join('; ')}") unless bad.empty?
    end
    assert(all_bad.empty?, all_bad.join(' | '))
  end

  # ---- A LINE'S BADGE STANDS BEYOND ITS NAME --------------------------------
  #
  # "Leela's day event above the label ... always further out from the
  # track." The name is what says whose rail this is, so it sits against the
  # rail; what that person is doing today stands beyond it. Asked of the real
  # page, where the two rows are measured by the face that draws them.
  it 'a line\'s badge is further from its rail than its name' do
    f = fixtures.find { it['name'] == 'all-day-every-track' }
    rep = layout(f, roomy)
    names = text_labels(rep).select { |l| " #{l['cls']} ".include?(' metro-terminus ') }
    badges = rep['labels'].select { |l| " #{l['cls']} ".include?(' metro-route ') }
    assert(badges.length.positive?, 'no badge drawn on a board with all-day states')
    tracks = paths_where(rep, 'track')
    bad = []
    badges.each do |b|
      bc = b['y'] + (b['h'] / 2.0)
      # its name: the one starting where it starts, nearest across
      n = names.select { |m| (m['x'] - b['x']).abs < 6 }
               .min_by { |m| (m['y'] + (m['h'] / 2.0) - bc).abs }
      unless n
        bad.push("\"#{b['text']}\" has no name beside it")
        next
      end
      nc = n['y'] + (n['h'] / 2.0)
      # its rail: the track nearest the name, at the name's own end
      rail = nil
      best = Float::INFINITY
      tracks.each do |t|
        p0 = t['pts'][0]
        d = (p0[1] - nc).abs
        if d < best
          best = d
          rail = p0[1]
        end
      end
      next if rail.nil?

      if (bc - rail).abs <= (nc - rail).abs
        bad.push("\"#{b['text']}\" at #{round.(bc)} is nearer the rail at #{round.(rail)}" \
          " than \"#{n['text']}\" at #{round.(nc)}")
      end
    end
    assert(bad.empty?, bad.join('; '))
  end

  # ---- THE NAME, ONCE, IN THE GUTTER --------------------------------------
  #
  # A transit map letters both termini, and this board did too: the head and
  # the tail, so the right-hand end of a line was not a couple of feet of
  # paper from the only thing saying whose it is.
  #
  # It is one now, at the leading end, in a column cut for it -- "remove the
  # label on the right". The word at the far end was paid for out of the
  # day: a name-wide gutter at each edge on a panel that was already
  # dropping the time off its captions to find room. One name, one gutter,
  # and the afternoon back. What is asked here is what the old case asked in
  # its own way -- that a clearance test somewhere has not silently
  # suppressed the lot -- plus the thing that makes the gutter a gutter:
  # every name starts at the same edge, so the legend is a column and not a
  # ragged hunt along the paper.
  it 'every line is named once, in a column at the leading edge' do
    rep = layout(busy, roomy)
    names = text_labels(rep).select do |l|
      " #{l['cls']} ".include?(' metro-terminus ')
    end
    lines = (busy['metro']['legend'] || []).length - (rep['debug']['dropped'] || []).length
    assert(names.length == lines, "#{names.length} name(s) for #{lines} line(s)")
    mid = rep['canvas']['w'] / 2.0
    late = names.select { |l| l['x'] > mid }
    assert(late.empty?, "#{late.length} name(s) past halfway: " \
      "#{late.map { |l| "\"#{l['text']}\" at #{round.(l['x'])}" }.join(', ')}")
    # ...AND ALL STARTING TOGETHER: "align all the track names to the left".
    # A legend is read down its left edge, and a ragged one is the whole
    # complaint the column answers: "Bart looks squished here on the left".
    # Ending together against the rails was tried and is not it -- what
    # fills the space between a short name and its rail is that line's own
    # dotted approach, which is worth drawing.
    x0 = names.map { |l| l['x'] }.min || Float::INFINITY
    ragged = names.select { |l| l['x'] > x0 + 4 }
    assert(ragged.empty?, "#{ragged.length} name(s) not at the column edge #{round.(x0)}" \
      ": #{ragged.map { |l| "\"#{l['text']}\" starts at #{round.(l['x'])}" }.join(', ')}")
  end
end
