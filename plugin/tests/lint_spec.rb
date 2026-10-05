# frozen_string_literal: true

# trmnlp lint, as plugin/lint.sh runs it, inside the suite: clean.
#
# (Until trmnlp 0.13.1 the gem's list of field types predated `lat_lon`, the
# hosted service's Location picker, and this spec and lint.sh both carried an
# exception for that one warning. The list knows it now, so there is none.)
#
# Lint counts the CSS declarations in `style` attributes, reports bracketed
# framework classes the framework never generates, and a recipe overview too
# short to be indexed: the checks most likely to go red after a small edit.

require 'json'
require 'open3'
require 'rbconfig'

require_relative 'support/metro'

RSpec.describe 'lint' do
  it 'trmnlp lint is clean' do
    out, = Open3.capture2e(RbConfig.ruby, $PROGRAM_NAME, 'lint', '--format', 'json', chdir: TRMNLP::Testing.plugin_dir)
    report = JSON.parse(out[out.index('{')..])
    issues = report['issues'].map { "[#{it['rule_id']}] #{it['message']}" }
    expect(issues).to eq([])
    expect(report['passed']).to be(true)
  end
end
