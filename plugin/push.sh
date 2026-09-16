#!/usr/bin/env bash
# Push to TRMNL, squeezed to fit the server's 100KB per-file limit.
#
# What the squeeze is and why is in `squeeze.py`, which ./test.sh also runs
# in --check mode so a board that has outgrown the server is a red suite
# rather than a surprise at deploy time. This script's own job is the order
# of operations: lint the real sources, squeeze, prove the squeezed copies
# still draw a map, upload, and put the working copies back whatever happens.
#
# Lint runs on the REAL sources, before the squeeze strips the comments out
# of them: one of trmnlp's checks counts words that appear in comments, so a
# stripped copy is a different question from the one the reader of this
# repository is asking, and the easier one.
#
# Nothing is uploaded until the squeezed copies have been built AND actually
# run: a minifier that broke the layout would otherwise push cleanly and
# draw nothing on the panel.
#
# Usage: ./push.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
LIQUID="$HERE/src/shared.liquid"
TRANSFORM="$HERE/src/transform.js"
ESBUILD="$ROOT/tools/node_modules/.bin/esbuild"

"$HERE/lint.sh" || { echo "trmnlp lint is not clean; nothing was uploaded" >&2; exit 1; }

# EVERY SOURCE FILE, not the two that used to change. squeeze.py now moves
# the wrapper markup and the stylesheet out of shared.liquid and into each of
# the four view files -- the server's limit is per file and the views were two
# lines each -- so the four are working copies that need putting back as much
# as the other two do. Backed up as a directory rather than as a list, so the
# next file squeeze.py learns to touch is restored without anyone editing
# this.
BAK="$(mktemp -d)"
cp "$HERE"/src/* "$BAK/"
restore() { cp "$BAK"/* "$HERE/src/"; rm -rf "$BAK"; }
trap restore EXIT

[ -x "$ESBUILD" ] || (cd "$ROOT/tools" && npm install --no-audit --no-fund --silent)
[ -x "$ESBUILD" ] || { echo "no esbuild in tools/node_modules; run 'npm install' in tools/" >&2; exit 1; }

echo "push: start $(date '+%H:%M:%S')"

python3 "$HERE/squeeze.py" "$LIQUID" "$TRANSFORM" "$ESBUILD"

# The squeezed copies have to build, load, and actually lay a map out.
(cd "$HERE" && trmnlp build >/dev/null)
node -e "require('$TRANSFORM')" || { echo "the minified transform.js does not load" >&2; exit 1; }
# EVERY VIEW, not just the full one. They are four different files on the
# server and the squeeze rewrites all four; a deploy that proves one of them
# draws is a deploy that has proved a quarter of what it is sending.
for v in full half_horizontal half_vertical quadrant; do
  node "$HERE/verify-build.js" "$HERE/_build/$v.html"
done

(cd "$HERE" && echo "y" | trmnlp push)
echo "push: done $(date '+%H:%M:%S')"
