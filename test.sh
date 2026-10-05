#!/usr/bin/env bash
# Every suite, from one place. Usage:
#
#   ./test.sh                  everything
#   ./test.sh node             only the suites that need no browser and no Docker
#   ./test.sh trmnl [args]     only the trmnlp suite; args are paths (relative to
#                              plugin/) and rspec arguments, e.g.
#                              ./test.sh trmnl tests/layout/band_spec.rb
#                              ./test.sh trmnl tests/sweep_spec.rb -e futurama
#
# TWO KINDS OF SUITE.
#
# plugin/tests is everything that renders the plugin or runs its transform, on
# trmnlp's own test framework (`trmnlp test`: RSpec, run in the trmnl/trmnlp
# image by tools/trmnl-test, needs Docker): the transform in trmnlp's runtime
# with a frozen clock and mocked feeds, the board in the real framework and
# faces on every device and view, the example days swept through both, the
# copy push.sh ships, lint and the pictures. AGENTS.md says what each spec is
# for.
#
# The rest asks questions that need no browser, in plain node, and stays
# there because it is faster that way: the layout ENGINE on its own
# (solver/cases.js), the geometry of the solver's board drawn in jsdom with a
# width table of the real faces (test/boards, ~20s cold, under a second
# warm), the config editor in jsdom (test/config-editor), and whether the
# copy of the solver inside shared.liquid is the one in solver/.
#
# Every suite runs even when an earlier one fails, and the script fails if any
# did: one red suite must not hide what the others would have said.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WHAT="${1:-all}"
[ $# -gt 0 ] && shift
FAILED=()
step() {
  local name="$1"; shift
  echo "== $name"
  if ! "$@"; then FAILED+=("$name"); fi
}

if [ "$WHAT" = all ] || [ "$WHAT" = node ]; then
  step "solver/cases.js" bash -c "cd '$ROOT' && node solver/cases.js"
  step "test/config-editor" bash -c "cd '$ROOT/test/config-editor' && npm install --no-audit --no-fund --silent && node run.js"
  step "test/boards" bash -c "cd '$ROOT' && node test/boards/run.js | tail -1; exit \${PIPESTATUS[0]}"
  # ...and that the copy of the solver inside shared.liquid is the one in
  # solver/. Two copies of a thing is how the engine this replaces came to
  # have five different opinions about where a caption goes; one copy and a
  # check is how this one keeps having one.
  step "bundle --check" bash -c "cd '$ROOT' && node plugin/bundle.js --check"
  # ...and that every file names the one framework version (settings.yml, the
  # tools that render from file://, the editor's page), and that the tool
  # that moves it moves all of them.
  step "framework-pin --check" "$ROOT/tools/framework-pin" --check
  step "framework-pin test" "$ROOT/tools/framework-pin.test.sh"
fi

# esbuild squeezes the copy that ships: the size check below and the shipped
# spec both build it.
[ -x "$ROOT/tools/node_modules/.bin/esbuild" ] ||
  (cd "$ROOT/tools" && npm ci --no-audit --no-fund --silent)

if [ "$WHAT" = all ] || [ "$WHAT" = node ]; then
  # ...and whether what all of that is testing would still fit on the server.
  #
  # The board is code on a device, and the device has a 100KB per-file limit
  # that nothing outside `push.sh` could see. A session's worth of work went
  # in with every suite green and the plugin 5KB too big to deploy, which is
  # a thing to find out from a red suite and not at the end of a deploy.
  step "squeeze --check" bash -c "cd '$ROOT' && python3 plugin/squeeze.py --check plugin/src/shared.liquid plugin/src/transform.js tools/node_modules/.bin/esbuild"
fi

if [ "$WHAT" = all ] || [ "$WHAT" = trmnl ]; then
  # Six processes unless told otherwise (METRO_SHARDS), so other work on the
  # machine keeps some CPU.
  step "plugin/tests (trmnlp test)" "$ROOT/tools/trmnl-test" "$@"
fi

if [ ${#FAILED[@]} -gt 0 ]; then
  printf '\nFAILED: %s\n' "${FAILED[@]}"
  exit 1
fi
echo
echo "all suites passed"
