# frozen_string_literal: true

# WHAT THE PAGE SAYS IT DREW, read out of a `trmnlp test` render.
#
# The page is built and rendered by trmnlp (its own Liquid, the real framework
# CSS and its real faces, the device's screen classes and mashup slots, in
# Firefox), and this file only adds what the plugin's own suites always added
# on top:
#
#   HEAD     goes into the page's <head>: the solver's clock, an error trap,
#            and a counter of completed layouts.
#   SETTLED  is the render's wait_for: the board has stopped redrawing.
#   report() has the page report every drawn thing (page_report.js).
#
# trmnlp's own have_no_overflow works on element boxes; what this board needs
# asked is about sampled SVG paths, the solver's own debug record and the run
# count, which is why the reporter stays.

require_relative 'metro'

module Metro
  module Page
    # THIRTY SECONDS, SO THE CLOCK IS NOT WHAT DECIDES. Many pages at once on
    # one box: the solver stops at its own count of arrangements and every run
    # gets the same board, which is the only way a layout suite means anything.
    SOLVE_MS = 30_000

    # A THROWN LAYOUT IS NOT A BOARD, AND IT LOOKS EXACTLY LIKE ONE. A script
    # that threw half way through leaves a board with its rails drawn and its
    # badges missing, and every case reads that as a board that chose not to
    # draw them. So the page keeps a list of anything that threw, and a render
    # that carries one is an error rather than a result.
    #
    # Every completed layout rewrites data-metro-debug, so counting writes
    # counts layouts: a view that never settles keeps climbing. Observed from
    # the head on the whole document, since the canvas does not exist yet.
    HEAD = <<~HTML
      <script>
      window.METRO_SOLVE_MS = #{SOLVE_MS};
      window.__metroErrors = [];
      window.__metroRuns = 0;
      window.addEventListener('error', function (e) {
        window.__metroErrors.push(String((e && e.message) || e) +
          (e && e.filename ? ' (' + e.filename + ':' + e.lineno + ')' : ''));
      });
      window.addEventListener('unhandledrejection', function (e) {
        window.__metroErrors.push('unhandled rejection: ' + String((e && e.reason) || e));
      });
      new MutationObserver(function (list) {
        list.forEach(function (m) {
          if (m.attributeName !== 'data-metro-debug') return;
          window.__metroRuns++;
          window.__metroRanAt = performance.now();
        });
      }).observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['data-metro-debug'] });
      </script>
    HTML

    # WAIT FOR THE BOARD TO STOP REDRAWING, not for a fixed delay.
    #
    # The layout debounces at 60ms and re-runs on load, on fonts, and whenever
    # its own text metrics move -- which is how it corrects a first pass laid
    # out in the fallback face. A report taken a fixed delay after the first
    # run catches whichever of those happened to have landed, so the same
    # board reported differently on different runs and the suite blamed the
    # layout. So: the board has published its record (or an error) and has not
    # laid itself out again for 400ms. trmnlp stops the page's timers once
    # this holds, and captures it.
    SETTLED = <<~JS.gsub(/\s+/, ' ').strip
      (function () {
        var c = document.querySelector('.metro-canvas');
        if (!c || !(c.getAttribute('data-metro-debug') || c.getAttribute('data-metro-error'))) return false;
        return performance.now() - (window.__metroRanAt || 0) >= 400;
      })()
    JS

    # What every render of the board passes: the head, and the wait.
    PAGE = { head: HEAD, wait_for: SETTLED, wait_for_timeout: 12 }.freeze

    PAGE_REPORT = File.read(File.join(SUPPORT, 'page_report.js')).sub(/\A(\s*\/\/[^\n]*\n)+/, '').strip.freeze

    module_function

    # The report of a rendered screen. A thrown layout, a page error or a
    # board that never published its debug record is an error, not a result
    # (see HEAD).
    def report(screen) = check(screen.evaluate("#{PAGE_REPORT}()"), screen)

    # A report the page made of itself (a spec that keeps one from before it
    # poked the page hands it in here), held to the same bar.
    def check(rep, screen)
      problems = screen.problems
      label = "#{screen.device.name} #{screen.view}"
      raise 'the page made no report' unless rep
      raise "the page has no #{rep['missing']} (did the template render?): #{problems.join(' | ')}" if rep['missing']
      raise "the layout threw: #{rep['errors'].join(' | ')}" unless (rep['errors'] || []).empty?
      raise "the solver threw while laying the board out: #{rep['metroError']}" if rep['metroError']
      raise "#{label}: #{problems.join(' | ')}" unless problems.empty?
      raise 'the layout never published data-metro-debug' unless rep['debug']

      rep
    end
  end
end
