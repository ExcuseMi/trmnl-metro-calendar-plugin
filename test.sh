#!/usr/bin/env bash
# Runs the suites that need no browser: transform.js, the LAYOUT SOLVER, the
# time axis, and the config editor. Usage: ./test.sh
#
# `test/cross` and `test/axis` are gone with the things they tested. Both
# pulled a marked block out of shared.liquid and ran it in node -- a good
# trick, and unnecessary now the layout engine is plain modules in solver/
# that node can simply require. The band solver's questions are asked by
# solver/cases.js, which also asks the ones it could not: whether the
# captions land anywhere readable, and how long the board takes.
#
# THE TIME AXIS IS BACK: solver/day.js `segmentsFor` gives a half-hour cell
# with nothing in it a fraction of the paper a busy one gets, and `scaleFor`
# takes those segments and stays monotonic. The drawing hatches the stretches
# that run fast, so the strip says the clock is not even rather than leaving a
# reader to measure an event against two different minutes.
#
# `test/boards` asks the layout questions that need no browser: the solver
# and the renderer run in node (jsdom) with text measured from a width table
# of the real faces, and a board is cached on disk until a source changes.
# What needs the framework and the real faces stays in `test/layout`.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT/test/transform" && node run.js
cd "$ROOT" && node solver/cases.js
cd "$ROOT/test/config-editor" && npm install --no-audit --no-fund --silent && node run.js
cd "$ROOT" && node test/boards/run.js | tail -1
# ...and whether what all of that is testing would still fit on the server.
#
# The board is code on a device, and the device has a 100KB per-file limit
# that nothing outside `push.sh` could see. A session's worth of work went in
# with every suite green and the plugin 5KB too big to deploy, which is a
# thing to find out from a red suite and not at the end of a deploy.
# ...and that the copy of the solver inside shared.liquid is the one in
# solver/. Two copies of a thing is how the engine this replaces came to have
# five different opinions about where a caption goes; one copy and a check is
# how this one keeps having one.
cd "$ROOT" && node plugin/bundle.js --check
[ -x "$ROOT/tools/node_modules/.bin/esbuild" ] ||
  (cd "$ROOT/tools" && npm ci --no-audit --no-fund --silent)
cd "$ROOT" && python3 plugin/squeeze.py --check plugin/src/shared.liquid \
  plugin/src/transform.js tools/node_modules/.bin/esbuild
