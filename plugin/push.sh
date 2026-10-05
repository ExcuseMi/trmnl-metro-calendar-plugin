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

# THE PANEL IS FED FROM main AND NOWHERE ELSE (AGENTS.md).
#
# 471753 is a display somebody is actually reading, and a branch is for
# looking at boards locally -- tools/sheet.js and plugin/tests render without
# any deploy at all. Checked here rather than left to whoever is typing,
# because the cost of getting it wrong is a half-built board on the wall and
# the only way back is another push.
# A settings.yml carrying any other id (or none: the first push registers
# a new plugin and writes its id back) is a testing plugin, and a branch is
# exactly where that belongs.
BRANCH="$(git -C "$ROOT" branch --show-current 2>/dev/null || true)"
PLUGIN_ID="$(sed -n 's/^id: *//p' "$HERE/src/settings.yml" | tr -d "'\"")"
# ...AND THE TESTING PLUGIN IS AN OVERRIDE, NOT A COMMITTED DIFFERENCE. Off
# main, a settings.yml carrying the live id is uploaded to the testing
# plugin instead (METRO_TESTING_ID, 481781 by default), rewritten in the
# working copy the trap below puts back. Carried in the branch's own commit,
# the testing id rode every merge into main and one deploy of main went to
# the testing plugin.
TESTING_ID="${METRO_TESTING_ID:-481781}"
RETARGET=""
if [ "$BRANCH" != "main" ] && [ "$PLUGIN_ID" = "471753" ]; then
  RETARGET="$TESTING_ID"
  echo "push.sh: on '${BRANCH:-a detached HEAD}', not main: uploading to the testing plugin $TESTING_ID, not the live one."
fi

"$HERE/lint.sh" || { echo "trmnlp lint is not clean; nothing was uploaded" >&2; exit 1; }

# THE COPY THAT SHIPS HAS TO DRAW, before anything is touched. The shipped
# spec (plugin/tests/shipped_spec.rb, on `trmnlp test`) squeezes a copy of
# these sources exactly as squeeze.py is about to below, then proves it: every
# view lays a map out, the squeezed transform answers what the source answers,
# and every fixture draws the same board as from the sources. The squeeze is
# deterministic, so after squeezing in place the result is compared with the
# copy that was tested.
[ -x "$ESBUILD" ] || (cd "$ROOT/tools" && npm install --no-audit --no-fund --silent)
"$ROOT/tools/trmnl-test" tests/shipped_spec.rb ||
  { echo "the squeezed copy fails the shipped spec; nothing was uploaded" >&2; exit 1; }
TESTED="$(ruby -e 'require ARGV[0]; print Metro::Shipped.plugin' "$HERE/tests/support/shipped.rb")"
[ -f "$TESTED/src/shared.liquid" ] || { echo "no tested copy at '$TESTED'; nothing was uploaded" >&2; exit 1; }

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
if [ -n "$RETARGET" ]; then
  sed -i "s/^id: 471753$/id: $RETARGET\nname: Metro Calendar (testing)/" "$HERE/src/settings.yml"
fi

[ -x "$ESBUILD" ] || { echo "no esbuild in tools/node_modules; run 'npm install' in tools/" >&2; exit 1; }

echo "push: start $(date '+%H:%M:%S')"

python3 "$HERE/squeeze.py" "$LIQUID" "$TRANSFORM" "$ESBUILD"

# The squeezed copies have to build and load, and be the copy that was tested.
(cd "$HERE" && trmnlp build >/dev/null)
node -e "require('$TRANSFORM')" || { echo "the minified transform.js does not load" >&2; exit 1; }
for f in "$HERE"/src/*; do
  [ "$(basename "$f")" = settings.yml ] && continue   # the testing plugin's id may be swapped in
  cmp -s "$f" "$TESTED/src/$(basename "$f")" ||
    { echo "squeezed $(basename "$f") is not the copy the shipped spec tested; nothing was uploaded" >&2; exit 1; }
done

(cd "$HERE" && echo "y" | trmnlp push)
# A first push registers the plugin and writes its id into the squeezed
# settings.yml; carry it into the copy the trap is about to put back.
NEW_ID="$(sed -n 's/^id: *//p' "$HERE/src/settings.yml")"
if [ -n "$NEW_ID" ] && [ -z "$PLUGIN_ID" ]; then
  sed -i "2i id: $NEW_ID" "$BAK/settings.yml"
  echo "push: registered as plugin $NEW_ID (written to settings.yml)"
fi
echo "push: done $(date '+%H:%M:%S')"
