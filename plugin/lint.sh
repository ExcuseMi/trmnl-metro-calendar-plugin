#!/usr/bin/env bash
# trmnlp lint, failing on any finding.
#
# (This script used to drop one warning that was wrong: until 0.13.1 the gem's
# vendored list of field types predated `lat_lon`, the hosted service's
# Location picker, which this plugin's Location setting uses. The list knows
# it now, so there is no exception left, and a trmnlp older than that is told
# to upgrade instead of being worked around.)
#
# Usage: plugin/lint.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# The suite runs on trmnlp 0.18.0 (tools/trmnl-test pins its image), and its
# lint is the one the tests hold the plugin to: an older one checks less.
have="$(trmnlp version 2>/dev/null | tail -n 1)"
if [ "$(printf '%s\n0.18.0\n' "$have" | sort -V | head -n 1)" != "0.18.0" ]; then
  echo "plugin/lint.sh: trmnlp ${have:-(none)} is older than 0.18.0: gem install trmnl_preview" >&2
  exit 2
fi

cd "$HERE" && trmnlp lint
