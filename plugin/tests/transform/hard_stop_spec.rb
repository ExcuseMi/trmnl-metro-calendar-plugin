# frozen_string_literal: true

# A SERVER THAT NEVER ANSWERS DOES NOT HOLD THE RENDER. The live plugin went
# degraded, "Transform timed out after 5s": a request is raced against the
# render's clock itself, not only aborted, so a runtime whose fetch ignores
# the abort still gets its board inside the platform's limit.

require_relative '../support/transform'

RSpec.describe 'hard-stop' do
  include Metro::Transform

  now = Time.iso8601('2026-09-19T10:00:00Z').to_i * 1000

  it 'a feed that never answers, abort or no abort, costs the budget and no more' do
    # never resolves in time: every server answers a minute late, through
    # the real runtime's own fetch and the mock proxy
    net = [otherwise('', delay: 60)]
    r = run_transform(net, now, base_input(now, calendar_list: 'Alpha https://x.example/a.ics', setup_mode: 'links',
                                                news_feeds: 'https://x.example/news.xml'))
    # the transform's own wall clock as the runtime measured it (node's
    # start-up included, which the old in-process harness never paid)
    took = run_of(r).duration_ms
    assert(took < 3800, "the render took #{took}ms")
    assert(r && r['data'], 'no board')
  end
end
