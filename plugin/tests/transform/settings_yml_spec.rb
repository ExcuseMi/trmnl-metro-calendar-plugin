# frozen_string_literal: true

# settings.yml: the form every reader configures the board through.
#
# Nothing else in this repo reads it, so nothing else catches it being
# wrong. It goes wrong quietly in both directions: transform.js reads a
# setting the form never offers (dead code and a feature nobody can turn
# on), or the form offers one transform.js never reads (a switch that
# does nothing). Both have happened.
#
# The other half is the CONDITIONAL fields. A field that only applies
# under one setting has to be hidden under the others, or the form asks
# for an answer it will not use, which reads as a broken plugin rather
# than an irrelevant question. Those are declared as `conditional_validation`
# blocks naming keynames, and a keyname is exactly the kind of thing a
# rename leaves behind pointing at nothing.
#
# Deliberately parsed with a tiny reader rather than a YAML library: the
# shape it has to understand is four kinds of line, and the reader sees the
# file as it is written (a quote, a colon), which a YAML library would not.

require_relative '../support/transform'

RSpec.describe 'settings-yml' do
  include Metro::Transform

  settings_path = File.join(Metro::PLUGIN, 'src', 'settings.yml')
  transform_path = File.join(Metro::PLUGIN, 'src', 'transform.js')

  parse_fields = lambda do |text|
    lines = text.split("\n", -1)
    fields = []
    f = nil
    list = nil
    cond = nil
    in_fields = false
    lines.each do |line|
      if /\Acustom_fields:\s*\z/.match?(line)
        in_fields = true
        next
      end
      next unless in_fields
      # Back out to the top level and the list is over. A list ITEM also
      # starts in column zero, so it is anything-but-a-dash that ends it.
      break if /\A[^\s-]/.match?(line)

      m = /\A- keyname: (\S+)/.match(line)
      if m
        f = { 'keyname' => m[1], 'options' => [], 'conditions' => [] }
        fields.push(f)
        list = cond = nil
        next
      end
      next unless f

      if /\A  options:\s*\z/.match?(line)
        list = 'options'
        cond = nil
        next
      end
      if /\A  conditional_validation:\s*\z/.match?(line)
        list = 'cond'
        cond = nil
        next
      end

      if list == 'options'
        m = /\A  - .*: *(\S+)\s*\z/.match(line)
        if m
          f['options'].push(m[1])
          next
        end
      end
      if list == 'cond'
        m = /\A  - when: *'?([^'\s]+)'?\s*\z/.match(line)
        if m
          cond = { 'when' => m[1], 'hidden' => [] }
          f['conditions'].push(cond)
          next
        end
        m = /\A    - (\S+)\s*\z/.match(line)
        if m && cond
          cond['hidden'].push(m[1])
          next
        end
        next if /\A    hidden:\s*\z/.match?(line)
      end

      m = /\A  (\w+): ?(.*)\z/.match(line)
      if m && m[1] != 'options' && m[1] != 'conditional_validation'
        f[m[1]] = m[2]
        list = nil if m[1] != 'description'
      end
    end
    fields
  end

  fields = parse_fields.call(File.read(settings_path, encoding: 'UTF-8'))
  by_key = {}
  fields.each { |f| by_key[f['keyname']] = f }
  src = File.read(transform_path, encoding: 'UTF-8')

  it 'the form and the code agree on which settings exist' do
    assert(fields.length > 5, "the settings file barely parsed: #{fields.length} field(s)")

    # Any helper that takes (input, 'keyname'), not just cf: the alert
    # thresholds go through numSetting, and a reader that only knew about
    # cf would call three live settings dead.
    read = src.scan(/\(\s*input\s*,\s*'([a-z0-9_]+)'/).map { |m| m[0] }.uniq
    assert(read.size > 5, "found almost no settings being read: #{read.join(', ')}")

    missing = read.reject { |k| by_key[k] }
    assert_equal(missing, [], 'transform.js reads settings the form never offers')

    # The other direction, minus the two that are display only: an
    # author_bio is a block of text, not an answer.
    display_only = ['author_info']
    unread = fields.map { |f| f['keyname'] }
                   .select { |k| !display_only.include?(k) && !read.include?(k) }
    assert_equal(unread, [], 'the form offers settings nothing reads')
  end

  it 'every conditional names a field that exists, and a value that exists' do
    fields.each do |f|
      f['conditions'].each do |c|
        c['hidden'].each do |k|
          assert(by_key[k], "#{f['keyname']} hides \"#{k}\", which is not a setting")
          assert(k != f['keyname'], "#{f['keyname']} hides itself")
        end
        if f['field_type'] == 'select'
          assert(f['options'].include?(c['when']),
                 "#{f['keyname']} has a rule for \"#{c['when']}\", which is not one of its options " \
                 "(#{f['options'].join(', ')})")
        elsif f['field_type'] == 'boolean'
          assert(c['when'] == 'true' || c['when'] == 'false',
                 "#{f['keyname']} is a checkbox with a rule for \"#{c['when']}\"")
        end
      end
    end
  end

  it 'a setting the board no longer reads is not still asked for' do
    # Three settings used to live in "The Day" and all three are gone,
    # because the rolling window answers what each of them was asking:
    #
    #   Switch Over At -- an hour to swap today for tomorrow at.
    #   Show -- which day to draw, including that swap.
    #   Quiet Days -- whether a quiet day may borrow the next one at all.
    #
    # Rolling reaches tomorrow from four in the afternoon, keeps what is left
    # of tonight while it does, and stretches to the end of tomorrow once
    # today is spent. A settings page that offers a choice the transform
    # ignores is worse than one that offers nothing, so this case watches
    # both halves: off the form AND out of the code.
    source = File.read(File.join(Metro::PLUGIN, 'src', 'transform.js'), encoding: 'UTF-8')
    %w[show_day switch_hour rolling_view].each do |k|
      assert(!by_key[k], "#{k} is still on the form with nothing behind it")
      assert(!source.include?("cf(input, '#{k}')"),
             "the transform still reads #{k}, which the form no longer asks for")
    end
  end

  it 'turning the alert banner off takes its thresholds with it' do
    off = (by_key['alert_enabled']['conditions'].find { |c| c['when'] == 'false' } || {})['hidden'] || []
    %w[alert_rain_threshold alert_temp_low alert_temp_high].each do |k|
      assert(off.include?(k), "#{k} is still asked for with the banner switched off")
    end
  end

  # THE DEMO IS NOT A SETUP STEP.
  #
  # It used to be: Use Demo Data shipped on, and it hid the Calendars box
  # until you found it and turned it off. But an empty box already rides
  # the demo, so the switch was asking people to turn off the thing that
  # was going to happen anyway. It is an override now, off, after the
  # setup fields. The example PICKER is not behind it: it chooses what an
  # empty box shows, which is exactly when the override is off.
  it 'nobody has to find a switch to see the board work' do
    demo = by_key['use_demo_data']
    assert_equal(demo['default'], 'false', 'the demo override ships on, so it hides the box it should leave open')
    assert_equal(by_key['demo_set']['group'], demo['group'], 'the example picker is not with its switch')
    hidden = demo['conditions'].flat_map { |c| c['hidden'] }
    assert(!hidden.include?('config_json'), 'the demo override hides the Calendars box')
    assert(!hidden.include?('demo_set'), 'the example picker is hidden while it decides what an empty box shows')
    keys = fields.map { |f| f['keyname'] }
    # JS indexOf answers -1 for a key that is not there
    assert((keys.index('use_demo_data') || -1) > (keys.index('config_json') || -1),
           'the demo override comes before the calendars')
  end

  it 'every setting is optional and says what it does' do
    # A board has to render on a device nobody has configured yet, so
    # there is no such thing as a required field here.
    fields.each do |f|
      next if f['field_type'] == 'author_bio'

      assert_equal(f['optional'], 'true', "#{f['keyname']} is not optional")
      assert((f['description'] || '').length > 20, "#{f['keyname']} has no real description")
      assert(!f['name'].to_s.empty?, "#{f['keyname']} has no label")
    end
  end

  it 'a default is one of the choices offered' do
    fields.each do |f|
      next if f['default'].nil? || f['field_type'] != 'select'

      assert(f['options'].include?(f['default']),
             "#{f['keyname']} defaults to \"#{f['default']}\", which is not one of #{f['options'].join(', ')}")
    end
  end

  # A PLAIN YAML SCALAR CANNOT CONTAIN ": ".
  #
  # There is no YAML parser in this case file -- the reader above is a
  # deliberate 30 lines of regex -- so an unquoted description with a colon
  # in it parsed perfectly here and made trmnlp refuse the whole file:
  # "mapping values are not allowed in this context". Every view in the
  # layout suite then failed to build at once, which is a long way to go
  # for a punctuation mark. The existing descriptions that use a colon are
  # quoted; this says so.
  it 'a description with a colon in it is quoted, or the file will not parse' do
    text = File.read(settings_path, encoding: 'UTF-8')
    bad = []
    text.split("\n", -1).each_with_index do |line, i|
      m = /\A(\s+)(description|name|placeholder|help_text): (.*)\z/.match(line)
      next unless m

      v = m[3]
      # Already quoted, or a block scalar: YAML reads the value as text
      # and a colon inside it is just a colon.
      next if /\A['"|>]/.match?(v)

      bad.push("line #{i + 1}: #{m[2]}") if /: /.match?(v)
    end
    assert_equal(bad, [], 'unquoted YAML scalars containing ": " -- trmnlp will refuse the file')
  end

  it 'no em dash reaches the reader' do
    # House rule, and the form is the one file in the plugin whose text
    # is read by everyone who installs it.
    bad = File.read(settings_path, encoding: 'UTF-8').split("\n", -1)
              .each_with_index.map { |l, i| l.include?([0x2014].pack("U")) ? "#{i + 1}: #{l.strip[0, 60]}" : nil }
              .compact
    assert_equal(bad, [], 'em dash in settings.yml')
  end
end
