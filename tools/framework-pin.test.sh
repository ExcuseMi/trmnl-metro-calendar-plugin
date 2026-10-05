#!/usr/bin/env bash
# tools/framework-pin on a copy of the three files: it moves every line, only
# upwards, and --check sees a line left behind. Run by ./test.sh node.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/plugin/src" "$T/tools"
cp "$HERE/../plugin/src/settings.yml" "$T/plugin/src/"
cp "$HERE/framework-assets.js" "$HERE/config-editor.html" "$T/tools/"
pin() { FRAMEWORK_PIN_ROOT="$T" "$HERE/framework-pin" "$@" 2>&1; }
fails=0
want() { # want <exit code> <text in the output> -- args
  local code="$1" text="$2"; shift 3
  local out; out="$(pin "$@")"; local got=$?
  if [ "$got" != "$code" ] || [[ "$out" != *"$text"* ]]; then
    echo "FAIL framework-pin $*: exit $got (want $code), said: $out (want: $text)"; fails=$((fails + 1))
  fi
}
START="$(pin)"
want 0 "in every file" -- --check
want 2 "not a version" -- set latest
want 2 "not a version" -- set "9.9"
want 2 "older than" -- set 0.0.1
[ "$(pin)" = "$START" ] || { echo "FAIL a refused set moved the pin"; fails=$((fails + 1)); }
want 0 "framework 99.1.2 in every file" -- set 99.1.2
[ "$(pin)" = 99.1.2 ] || { echo "FAIL the pin did not move"; fails=$((fails + 1)); }
[ "$(grep -c 'trmnl.com/\(css\|js\)/99.1.2/' "$T/tools/framework-assets.js")" = 2 ] || { echo "FAIL framework-assets.js not moved"; fails=$((fails + 1)); }
grep -q 'trmnl.com/css/99.1.2/' "$T/tools/config-editor.html" || { echo "FAIL config-editor.html not moved"; fails=$((fails + 1)); }
# one line left behind is what --check is for
sed -i 's#trmnl.com/css/99.1.2/#trmnl.com/css/3.3.1/#' "$T/tools/config-editor.html"
want 1 "config-editor.html asks for 3.3.1" -- --check
[ "$fails" = 0 ] && echo "framework-pin: 9 checks passed" || exit 1
