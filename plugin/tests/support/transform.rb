# frozen_string_literal: true

# THE TRANSFORM SUITE'S HARNESS, ON `trmnlp test`.
#
# The transform runs the way TRMNL runs it: trmnlp's own node wrapper as a
# subprocess, the clock started at the case's time by libfaketime (and running
# on from there, as a real one does), every HTTP(S) request through a mock
# proxy, and the hosted limits measured. A case says
#
#   r = run_transform(mocks, NOW, base_input(NOW, fields))   # -> { 'data', 'trmnl_state' }, as returned
#
# `mocks` is a list of [url, answer] pairs (serve, status, otherwise below),
# first match wins; the requests that were made are requests_of(r), the run
# itself (duration_ms, max_memory_mb, log) is run_of(r), and a slow server is
# `delay:` in SECONDS (`body_delay:`, `advance_clock:` likewise).
#
# Only the transform's internal functions, which no runtime can call on their
# own, are loaded into a node vm (`internals`).

require 'securerandom'
require 'time'

require_relative 'metro'
require_relative 'demo'

module Metro
  module Transform
    # What the old fake fetch did for anything it was not told about: a 404.
    ELSE_404 = ['*', { status: 404, body: '' }].freeze
    # The forecast and the language files, the two hosts nearly every case
    # wants answered one way or the other.
    FORECAST = 'https://api.open-meteo.com/v1/forecast*'
    I18N = 'https://raw.githubusercontent.com/ExcuseMi/trmnl-metro-calendar-plugin/main/i18n/*'
    TRANSFORM_PATH = File.join(PLUGIN, 'src', 'transform.js')

    # What a run returned, and the run it came from.
    class Output < Hash
      attr_accessor :run
    end

    # WHAT THE TRANSFORM RETURNED AS `trmnl_state`, not what trmnlp kept of it.
    # trmnlp takes the key out of the output and saves it for the next run, and
    # a test only gets the saved copy back (`run.state`): a transform that
    # returned no state at all reads as the state it was seeded with, and one
    # trmnlp refused (not an object, over 8192 bytes) as none. The cases ask
    # about what the transform RETURNED, so it is noted here on its way past.
    module ReturnedState
      def extract!(output, **)
        returned = output.is_a?(Hash) && output.key?(TRMNLP::TransformState::KEY)
        Thread.current[:metro_returned_state] = returned ? [output[TRMNLP::TransformState::KEY]] : []
        super
      end
    end
    unless TRMNLP::TransformState.method_defined?(:extract!)
      raise 'trmnlp no longer takes trmnl_state out with TransformState#extract!: see ReturnedState'
    end
    TRMNLP::TransformState.prepend(ReturnedState)

    # ---------------------------------------------------------------- mocks

    # A mock answering `url` with `body` (a String, or a JSON value), 200.
    def serve(url, body, **extra) = [url, (body.is_a?(String) ? { body: } : { json: body }).merge(extra)]

    # A mock answering `url` with an error status.
    def status(url, code, **extra) = [url, { status: code, body: '' }.merge(extra)]

    # Everything not answered by an earlier mock (a calendar feed, say),
    # answered with `body` or, given a number, that status.
    def otherwise(body_or_status, **extra)
      answer = body_or_status.is_a?(Integer) ? { status: body_or_status, body: '' } : { body: body_or_status }
      [ELSE_404[0], answer.merge(extra)]
    end

    def demo_mocks(**) = Demo.demo_mocks(**)

    def ics_with_events(events)
      s = +"BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"
      events.each do |event|
        e = event.transform_keys(&:to_sym)
        s << "BEGIN:VEVENT\r\nUID:#{e[:uid] || SecureRandom.hex(8)}\r\nDTSTAMP:20260101T000000Z\r\n"
        s << "RECURRENCE-ID:#{e[:recurrenceId]}\r\n" if e[:recurrenceId]
        s << "DTSTART:#{e[:start]}\r\nDTEND:#{e[:end]}\r\n"
        s << "RRULE:#{e[:rrule]}\r\n" if e[:rrule]
        s << "EXDATE:#{e[:exdate]}\r\n" if e[:exdate]
        s << "SUMMARY:#{e[:summary]}\r\n"
        s << "DESCRIPTION:#{e[:description]}\r\n" if e[:description]
        s << "LOCATION:#{e[:location]}\r\n" if e[:location]
        # Written raw: a case testing how a list value is split needs to be
        # able to put an escaped comma in one.
        s << "CATEGORIES:#{e[:categories]}\r\n" if e[:categories]
        s << "STATUS:#{e[:status]}\r\n" if e[:status]
        s << "LOCATION:#{e[:location]}\r\n" if e[:location]
        s << "END:VEVENT\r\n"
      end
      s << "END:VCALENDAR\r\n"
    end

    # ---------------------------------------------------------------- input

    # A clock as the cases keep it: milliseconds, so `NOW + 3_600_000` reads
    # as it always did.
    def ms(iso) = (Time.iso8601(iso).to_f * 1000).round

    # input.trmnl.system.timestamp_utc is set to match the clock the case runs
    # at, as before. (The hosted runtime does not hand `system` to a
    # transform, and trmnlp does not either, so transform.js reads the clock.)
    def base_input(now_ms, custom_fields = {})
      fields = { 'use_demo_data' => 'false' }.merge(custom_fields.transform_keys(&:to_s))
      { 'trmnl' => {
        'system' => { 'timestamp_utc' => now_ms / 1000 },
        'user' => { 'locale' => 'en', 'time_zone_iana' => 'UTC' },
        'plugin_settings' => { 'instance_name' => 'Test', 'custom_fields_values' => fields }
      } }
    end

    # ---------------------------------------------------------------- running

    # THE FORM'S DEFAULTS, AS A CASE NEVER SAW THEM. The cases were written
    # against an input carrying only the fields they name -- a device whose
    # form predates a field -- and the hosted form's defaults make a different
    # board: with `setup_mode` defaulting to `links`, a case's config_json is
    # never read at all. trmnlp fills a blank field with its default, as TRMNL
    # does, so the cases run a copy of the plugin whose settings.yml declares
    # no defaults; the sources are otherwise the same files.
    def self.plugin_without_defaults
      @plugin_without_defaults ||= begin
        dir = Dir.mktmpdir('metro-no-defaults-')
        at_exit { FileUtils.rm_rf(dir) }
        FileUtils.cp_r(File.join(PLUGIN, 'src'), dir)
        settings = YAML.safe_load_file(File.join(PLUGIN, 'src', 'settings.yml'))
        settings['custom_fields'].each { it.delete('default') }
        File.write(File.join(dir, 'src', 'settings.yml'), YAML.dump(settings))
        File.write(File.join(dir, '.trmnlp.yml'), "---\n")
        dir
      end
    end

    # A case's input as `trmnl.transform` options. `input.trmnl.state` is the
    # saved state, `input.trmnl.previous_merge_variables` the previous
    # render's output (transform.js replays a failed feed's day from it), and
    # any key beside `trmnl` is polled data.
    def options_for(input, mocks, now_ms, **more)
      t = (input && input['trmnl']) || {}
      settings = t['plugin_settings'] || {}
      data = (input || {}).except('trmnl')
      options = {
        now: Time.at(now_ms / 1000r).utc,
        custom_fields: settings['custom_fields_values'] || {},
        variables: { 'trmnl' => { 'user' => t['user'] || {},
                                  'plugin_settings' => settings.except('custom_fields_values') } },
        mocks: Metro.mock_table(mocks + [ELSE_404])
      }
      options[:data] = data unless data.empty?
      options[:state] = t['state'] if t.key?('state')
      options[:previous_merge_variables] = t['previous_merge_variables'] unless t['previous_merge_variables'].nil?
      options.merge(more)
    end

    # The transform's own console, as lines (it writes to stdout and stderr).
    def lines_of(run)
      run.log.flat_map { it.sub(/\Atransform (stdout|stderr): /, '').split("\n") }.reject { it.strip.empty? }
    end

    # What the transform returned. A transform that errored, timed out or
    # printed no JSON is a failed test, with what it said. `log:` is an Array
    # the transform's console lines are added to.
    def run_transform(mocks, now_ms, input, log: nil, **more)
      raise ArgumentError, 'run_transform takes a fixed clock (ms)' unless now_ms.is_a?(Integer)

      Thread.current[:metro_returned_state] = nil
      run = trmnl.plugin(Transform.plugin_without_defaults).transform(**options_for(input, mocks || [], now_ms, **more))
      log&.concat(lines_of(run))
      returned = Thread.current[:metro_returned_state]
      if run.error || returned.nil? || !run.data.is_a?(Hash) || !run.data.key?('data')
        Metro.flunk("the transform failed: #{run.error || 'no output'}\n#{run.log.join("\n")[-1500..] || run.log.join("\n")}")
      end
      output = Output.new.merge!(run.data.except('trmnl'))
      # no key at all when the transform returned none, as before
      output['trmnl_state'] = returned[0] unless returned.empty?
      output.tap { it.run = run }
    end

    # What a run asked for: [{ 'method', 'url', 'mocked', 'status', 'aborted' }].
    def requests_of(output) = output.run.requests.map { |request| request.transform_keys(&:to_s) }

    # The run itself: duration_ms, max_memory_mb, log, error.
    def run_of(output) = output.run

    # ---------------------------------------------------------------- internals

    # The transform's internal functions (see internals.js). `body` is the
    # body of a JavaScript function (T, args) -- T has parseConfig,
    # applyCalendarRules, parseIcs, fromEpoch, I18N, feedUrl, migrateConfig,
    # configWarnings, hostOf, RENDER_BUDGET_MS -- and what it returns comes
    # back as JSON: internals('return T.hostOf(args.url);', args: { url: })
    def internals(body, now: nil, args: nil) = Metro.node('internals.js', { now:, body:, args: })['result']

    # ---------------------------------------------------------------- shared helpers

    # The payload carries `events` and `weather` as two lists now. This stays,
    # because every case that uses it wants "the events" and should not have
    # to know which key they arrived under.
    def event_items(data) = (data['events'] || []).dup

    # WHAT THE BOARD MAKES OF THE PAYLOAD. Order, side, the anchor and the
    # badges are the solver's now (solver/order.js), not transform's; the
    # cases that were about those answers run the two together.
    def arranged(data) = Metro.node_call('solver/order', 'arrange', data['legend'] || [], data['events'] || [])

    # WHERE THE BOARD OPENS, which is the solver's too: `day.js opened()`.
    def opened(data) = Metro.node_call('solver/day', 'opened', data)['day_start_min']
  end
end
