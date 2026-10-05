# frozen_string_literal: true

# THE DEMO'S OWN FILES, SERVED FROM THE REPO, as mocks.
#
# The demo board is a config and a set of ICS files in demo/<show>/, and the
# languages are i18n/<code>.json, all fetched at run time from this repo's
# main branch on raw.githubusercontent. A suite must not need them from the
# network, and what is on disk is what the next push puts on the server, so
# every one of those files is answered from disk. Anything else the transform
# asks for (the forecast, a feed nobody mocked) answers 404 (NOT_FOUND).

require_relative 'metro'

module Metro
  module Demo
    BASE = 'https://raw.githubusercontent.com/ExcuseMi/trmnl-metro-calendar-plugin/main/'
    NOT_FOUND = ['*', { status: 404, body: '' }].freeze

    module_function

    # `missing` names files (relative to the repo root, e.g.
    # 'demo/simpsons/bart.ics') to withhold, which is how a stale or failing
    # feed is written. A list of [url, answer] pairs: see Metro.mock_table.
    def demo_mocks(missing: [], i18n: true)
      dirs = ['demo'] + (i18n ? ['i18n'] : [])
      dirs.flat_map do |dir|
        Dir.glob(File.join(ROOT, dir, '**', '*')).select { File.file?(it) }.sort.map do |full|
          rel = full.delete_prefix("#{ROOT}/")
          missing.include?(rel) ? [BASE + rel, { status: 404, body: '' }] : [BASE + rel, { body: File.read(full) }]
        end
      end
    end
  end

  # A list of [url, answer] pairs as the Hash trmnlp's `mocks:` takes. The
  # first pair that matches a request answers it, so of two pairs for one url
  # the first stands.
  def self.mock_table(pairs)
    pairs.each_with_object({}) { |(url, answer), table| table[url] = answer unless table.key?(url) }
  end
end
