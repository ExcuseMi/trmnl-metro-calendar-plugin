# frozen_string_literal: true

# THE COPY THAT SHIPS, built the way push.sh builds it.
#
# Both source files outgrew the server's 100KB per-file limit, so push.sh
# uploads copies squeezed by plugin/squeeze.py: whole-line comments out, the
# JavaScript minified, the template's engine deflated beside an inflater, the
# wrapper markup moved into the view files. A squeezer that broke the board
# would push cleanly and draw nothing on the panel, so the squeezed copy is
# tested as itself.
#
# Built here from plugin/src into plugin/tests/.shipped/<hash of the sources
# and the squeezer> (git-ignored), once per change: the build is
# deterministic, so push.sh can compare what it is about to upload with the
# copy this tested. Several processes may get here at once, so a build goes to
# a temp directory and is renamed into place.

require 'securerandom'

require_relative 'metro'

module Metro
  module Shipped
    SRC = File.join(PLUGIN, 'src')
    ESBUILD = File.join(ROOT, 'tools', 'node_modules', '.bin', 'esbuild')
    OUT = File.join(PLUGIN, 'tests', '.shipped')

    module_function

    def key
      digest = Digest::SHA1.new
      Dir.children(SRC).sort.each { digest.update("#{it}:#{File.binread(File.join(SRC, it))}") }
      digest.update(File.binread(File.join(PLUGIN, 'squeeze.py')))
      digest.hexdigest[0, 16]
    end

    # The squeezed plugin directory (what trmnl.plugin() takes).
    def plugin
      dir = File.join(OUT, key)
      return dir if File.exist?(File.join(dir, 'src', 'shared.liquid'))
      raise 'no esbuild in tools/node_modules: run `npm ci` in tools/ (./test.sh does)' unless File.exist?(ESBUILD)

      # (not the pid: every share of the suite is in a container of its own,
      # and they are all the same pid there)
      tmp = "#{dir}.tmp-#{SecureRandom.hex(6)}"
      FileUtils.rm_rf(tmp)
      FileUtils.mkdir_p(tmp)
      FileUtils.cp_r(SRC, tmp)
      FileUtils.cp(File.join(PLUGIN, '.trmnlp.yml'), tmp)
      out, status = Open3.capture2e('python3', File.join(PLUGIN, 'squeeze.py'), File.join(tmp, 'src', 'shared.liquid'),
                                    File.join(tmp, 'src', 'transform.js'), ESBUILD)
      raise "squeeze.py failed: #{out}" unless status.success?

      begin
        File.rename(tmp, dir)
      rescue SystemCallError
        # another process got there first: the build is the same
        FileUtils.rm_rf(tmp)
      end
      dir
    end
  end
end
