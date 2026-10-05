# frozen_string_literal: true

# REPORTS THAT SURVIVE THE PROCESS, shared by every shard.
#
# A board takes a few seconds to render and solve, and the cases ask for the
# same (payload, view) from many spec files, which ./test.sh spreads over
# several `trmnlp test` processes. Each report is written to
# plugin/tests/.cache/reports under a key made of the EXACT inputs: every file
# of the plugin being rendered (so a change to shared.liquid changes every key
# and nothing stale can come back), the harness files in this directory (they
# decide what is measured), trmnlp's version (its Firefox, framework assets
# and page), and the payload and render options. Editing only a spec changes
# no key at all, which is the loop this is for: rewriting an expectation
# re-reads boards instead of re-rendering them.
#
# Two processes asking for the same board at once: the first takes a lock file
# and renders, the second waits for its report, which is what keeps the
# suite's shares (METRO_SHARD) from each drawing the boards they have in
# common. METRO_CACHE=off turns it off.
#
# Entries older than a week are dropped on the way in.

require 'securerandom'

require_relative 'metro'

module Metro
  module Cache
    DIR = File.join(PLUGIN, 'tests', '.cache', 'reports')
    OFF = ENV['METRO_CACHE'] == 'off'
    WEEK = 7 * 24 * 3600

    module_function

    def hash_dir(digest, dir)
      Dir.children(dir).sort.each do |name|
        full = File.join(dir, name)
        digest.update("#{name}:#{File.binread(full)}|") if File.file?(full)
      end
    rescue Errno::ENOENT
      nil
    end

    # What a render reads, besides the payload: the plugin's sources and this
    # harness. Hashed once per process.
    def stamp(plugin_dir)
      (@stamps ||= {})[plugin_dir] ||= begin
        digest = Digest::SHA1.new
        hash_dir(digest, File.join(plugin_dir, 'src'))
        hash_dir(digest, SUPPORT)
        digest.update("trmnlp #{defined?(TRMNLP::VERSION) ? TRMNLP::VERSION : ''}")
        digest.hexdigest
      end
    end

    def prune
      return if OFF || @pruned

      @pruned = true
      Dir.glob(File.join(DIR, '*')).each { File.delete(it) if File.mtime(it) < Time.now - WEEK }
    rescue SystemCallError
      nil
    end

    def cached(plugin_dir, inputs)
      return yield if OFF

      prune
      key = Digest::SHA1.hexdigest("#{stamp(plugin_dir)}|#{JSON.generate(inputs)}")
      file = File.join(DIR, "#{key}.json")
      lock = "#{file}.lock"
      FileUtils.mkdir_p(DIR)
      waited = 0.0
      loop do
        hit = read(file)
        return hit if hit

        begin
          File.open(lock, File::WRONLY | File::CREAT | File::EXCL).close
        rescue Errno::EEXIST
          # somebody else is rendering it; a lock older than three minutes is
          # a process that died holding it
          File.delete(lock) if (Time.now - File.mtime(lock) rescue 0) > 180
          return yield if waited > 300

          sleep 0.25
          waited += 0.25
          next
        end
        begin
          report = yield
          # through a temp name: a run killed mid-write must not leave a
          # truncated report for the next one to read as a hit
          part = "#{file}.#{SecureRandom.hex(6)}.part"
          File.write(part, JSON.generate(report))
          File.rename(part, file)
          return report
        ensure
          FileUtils.rm_f(lock)
        end
      end
    end

    def read(file)
      JSON.parse(File.read(file))
    rescue SystemCallError, JSON::ParserError
      nil
    end
  end
end
