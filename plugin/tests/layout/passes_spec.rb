# frozen_string_literal: true

# ONE BOARD, HOWEVER MANY TIMES THE PAGE LAYS IT OUT.
#
# The page lays the board out again when its box changes (a preview resized,
# a slot settling), and every pass starts from the solver's own caches. A
# board that came out differently on a second pass would be a board that
# depends on what happened to the page, not on the day. The sweep once saw
# an example board (simpsons 07:30 og-half-horizontal) flip between two
# answers from run to run and blamed this; it was the feeds' order (see
# transform/order_spec.rb) and a cold page's faces (cold_spec.rb), but the
# property is worth holding: the box is narrowed and given back, which lays
# the board out twice more, and the board must be what it was.
#
# trmnlp stops the page's timers once a render's `wait_for` holds, so a board
# cannot be poked after the render the way the old suite did it. The whole
# sequence runs INSIDE the wait instead: settle, keep the report, narrow the
# box and give it back, settle again.

require_relative '../support/layout'
require_relative '../support/demo'

RSpec.describe 'passes' do
  # Polled by trmnlp until it is true. Step 0 waits for the first board and
  # keeps its report, step 1 is the box being narrowed and given back, step 2
  # waits for the board to settle again.
  two_more_passes = <<~JS
    (function () {
      var s = window.__metroPasses || (window.__metroPasses = { step: 0 });
      var settled = #{Metro::Page::SETTLED};
      if (s.step === 0) {
        if (!settled) return false;
        s.once = #{Metro::Page::PAGE_REPORT}();
        s.step = 1;
        var root = document.querySelector('.metro-root');
        root.style.width = 'calc(100% - 7px)';
        requestAnimationFrame(function () { requestAnimationFrame(function () { setTimeout(function () {
          root.style.width = ''; s.at = performance.now(); s.step = 2;
        }, 300); }); });
        return false;
      }
      if (s.step === 1) return false;
      return performance.now() - s.at >= 300 && settled;
    })()
  JS
  page = { head: Metro::Page::HEAD, wait_for: two_more_passes, wait_for_timeout: 30 }

  digest = lambda do |r|
    Digest::SHA1.hexdigest(JSON.generate(Metro.plain([r['debug']['gaps'], r['debug']['shed'], r['debug']['dropped'],
                                                     r['labels'].map do |l|
                                                       [l['cls'], l['text'], *%w[x y w h].map { (l[it] + 0.5).floor }]
                                                     end])))
  end

  define_method(:same_passes) do |screen|
    once = Metro::Page.check(screen.evaluate('window.__metroPasses.once'), screen)
    again = screen.evaluate("#{Metro::Page::PAGE_REPORT}()")
    assert(again['debug']['runs'] > once['debug']['runs'], 'the box change did not lay the board out again')
    assert_equal(again['errors'], [])
    assert(digest.(again) == digest.(once), 'the board changed on another pass')
  end

  %w[og_png v2].each do |device|
    Metro.fixtures.each do |f|
      it "the same board after more passes · #{device} · #{f['name']}" do
        same_passes(trmnl.render(device:, data: { 'data' => f['metro'] }, transform: false, **page))
      end
    end
  end

  it 'the example board that flipped is the same board after more passes' do
    same_passes(trmnl.render(
                  device: 'og_png', view: 'half_horizontal', now: Time.utc(2026, 9, 15, 12, 30), **page,
                  variables: { trmnl: { user: { time_zone_iana: 'America/Chicago', locale: 'en-US' },
                                        plugin_settings: { instance_name: 'Metro' } } },
                  custom_fields: { use_demo_data: 'true', demo_set: 'simpsons', time_format: '12h' },
                  mocks: Metro.mock_table(Metro::Demo.demo_mocks + [Metro::Demo::NOT_FOUND])
                ))
  end
end
