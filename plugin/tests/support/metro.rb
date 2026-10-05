# frozen_string_literal: true

# WHAT EVERY SPEC HERE SHARES, ON `trmnlp test`.
#
# The suite runs on trmnlp's own test framework (RSpec files under
# plugin/tests, `trmnlp test`, in the trmnl/trmnlp image: ./test.sh trmnl).
# The plugin's solver, its fixtures and the transform's internal functions are
# JavaScript, so anything a case needs from them is asked of node (bridge.js,
# internals.js) and comes back as JSON.
#
# ONE RULE ABOUT KEYS. Anything that came from JSON (a fixture, a payload, a
# report off the page, what node answered) has STRING keys; a viewport and the
# options of a run or a render have SYMBOL keys.

require 'digest'
require 'fileutils'
require 'json'
require 'open3'
require 'tmpdir'
require 'yaml'

module Metro
  SUPPORT = __dir__
  PLUGIN = File.expand_path('../..', __dir__)
  ROOT = File.expand_path('..', PLUGIN)

  module_function

  # ---------------------------------------------------------------- node

  def node(script, input)
    out, err, status = Open3.capture3('node', File.join(SUPPORT, script), stdin_data: JSON.generate(input))
    raise "node #{script} failed: #{err.strip[-1500..] || err.strip}" unless status.success?

    JSON.parse(out, allow_nan: true)
  end

  # `fn` of a module in the repo (path from the repo root), called with JSON
  # arguments: node_call('solver/order', 'arrange', legend, events). Without
  # `fn`, the module's own value.
  def node_call(mod, fn = nil, *args) = node('bridge.js', { module: mod, fn:, args: })['result']

  # The layout fixtures (test/layout/fixtures.js): [{ 'name', 'metro' }].
  def fixtures = @fixtures ||= node_call('test/layout/fixtures').freeze

  # A copy a case may change: fixtures are shared by every case in the process.
  def deep_copy(value) = Marshal.load(Marshal.dump(value))

  # ---------------------------------------------------------------- asserting

  # A whole number is the same number however it was arrived at: JSON.stringify
  # prints 2 for what Ruby calls 2.0.
  def plain(value)
    case value
    when Float then value.finite? && value == value.to_i ? value.to_i : value
    when Array then value.map { plain(it) }
    when Hash then value.to_h { |k, v| [k.to_s, plain(v)] }
    when Symbol then value.to_s
    else value
    end
  end

  def flunk(message) = raise(RSpec::Expectations::ExpectationNotMetError, message.to_s)

  module Assertions
    def assert(cond, msg = nil)
      Metro.flunk(msg || 'assertion failed') unless cond
    end

    # Equal as JSON, which is how the cases were written (key order included).
    def assert_equal(actual, expected, msg = nil)
      a = JSON.generate(Metro.plain(actual))
      e = JSON.generate(Metro.plain(expected))
      Metro.flunk("#{"#{msg}: " if msg}expected #{e}, got #{a}") unless a == e
    end

    def deep_copy(value) = Metro.deep_copy(value)

    # A defect that is real, understood and not fixed yet: reported, does not
    # fail the run, and FAILS once it starts passing, so a fix cannot land
    # without the marker coming off. Call first thing in the example.
    def known(why) = (pending(why) if why)
  end
end

# Loaded outside a test run too (push.sh asks shipped.rb where the tested copy is).
if defined?(RSpec)
  RSpec.configure do |config|
    config.include Metro::Assertions

    # ONE SHARE OF THE SUITE. tools/trmnl-test starts the whole suite n times
    # with METRO_SHARD=0/n .. (n-1)/n, and each process keeps the examples
    # whose name falls to it: by example and not by file, because the files
    # are nothing like the same size (one of them draws 216 boards). Set on
    # examples only: a group that carried it would take all of its own out.
    if (shard = ENV['METRO_SHARD'].to_s.match(%r{\A(\d+)/(\d+)\z}))
      require 'zlib'
      index = shard[1].to_i
      count = shard[2].to_i
      config.define_derived_metadata do |meta|
        next unless meta.key?(:example_group)

        meta[:metro_other_shard] = true unless Zlib.crc32(meta[:full_description].to_s) % count == index
      end
      config.filter_run_excluding metro_other_shard: true
    end
  end
end
