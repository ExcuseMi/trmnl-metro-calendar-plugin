#!/usr/bin/env python3
"""Squeeze the sources down to what the server will accept.

Both carry a lot of explanation -- why each constant is what it is, which
screenshot each rule came from, what broke and why the fix is shaped the way
it is -- and both have outgrown the server's 100KB per-file limit. That
explanation is worth more in the repo than the bytes are on the server, so
the copy that goes to the device is squeezed and the working copy is put
straight back afterwards.

Five passes, in this order:

  1. Drop every whole-line `//` comment, and shared.liquid's Liquid
     `{% comment %}` blocks. Only lines that START with the marker go, so
     trailing comments, string contents and `https://` URLs are untouched.
  2. Minify the JavaScript, identifiers included.
  3. Minify the CSS, which until this existed was shipped as written: the
     stylesheet is a third explanation by weight, and `//` is not how CSS
     spells a comment, so pass 1 never touched a byte of it. 8.8KB of
     stylesheet is 1.5KB of stylesheet, and it was that, not the code, that
     had put this file over the limit.
  4. Rename the private fields. Everything the layout hangs off an event or
     a line is `_`-prefixed and written out in full at every use; one or two
     characters instead is 7.7KB. Safe only while no `_` field is named by a
     STRING, which is checked, because one was and the board drew spans it
     had thrown away.
  5. Move the wrapper markup and the stylesheet out of shared.liquid and
     into each of the four view files. The limit is per FILE and the views
     were two lines each, so the markup costs nothing where it goes. The
     repo keeps one copy; the four are made here, on the way out.

Run directly to WRITE the squeezed copies (push.sh restores them), or with
--check to report the sizes and change nothing, which is what ./test.sh
does so this can never be discovered at deploy time again.

The view files are found beside shared.liquid, so one path still names them
all.

Usage: squeeze.py [--check] <shared.liquid> <transform.js> <esbuild>
"""
import re
import subprocess
import sys

LIMIT = 100 * 1024
PLACEHOLDER = '__METRO_PAYLOAD_LIQUID__'


def run(esbuild, args, text, why):
    r = subprocess.run([esbuild] + args, input=text, capture_output=True, text=True)
    if r.returncode != 0:
        print('could not minify %s:\n%s' % (why, r.stderr.strip()), file=sys.stderr)
        sys.exit(1)
    return r.stdout


def uncomment(s):
    return re.sub(r'\n{3,}', '\n\n',
                  '\n'.join(l for l in s.split('\n') if l.lstrip()[:2] != '//'))


# ...AND THEN COMPRESSED, because the minified engine alone outgrew the file.
#
# The script is deflated and carried as base64 beside a 3.8KB inflater built
# from fflate (github.com/101arrowz/fflate, installed in tools/): 95KB of
# minified engine is 46KB on the server. On the page the inflater unpacks it
# synchronously and inserts it as a script right after itself, so it runs
# where the original did and `document.currentScript` is still inside the
# plugin's root. Only the Liquid payload stays outside the compression -- it
# is filled in when the page is rendered, so it has to be text Liquid can
# see -- and it is written as `window.METRO = ...`, the form the layout suite
# looks for when it swaps a fixture into the artefact that ships.
def pack(js, esbuild):
    import base64
    import zlib
    if ('window.METRO=' + PLACEHOLDER) not in js:
        print('shared.liquid: the minified script no longer assigns the payload as '
              '`window.METRO=`; teach squeeze.py the new form', file=sys.stderr)
        sys.exit(1)
    body = js.replace('window.METRO=' + PLACEHOLDER, 'window.METRO=window.METRO')
    c = zlib.compressobj(9, zlib.DEFLATED, -15)
    raw = c.compress(body.encode('utf-8')) + c.flush()
    b64 = base64.b64encode(raw).decode('ascii')
    import os
    import tempfile
    tools = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tools')
    entry = tempfile.NamedTemporaryFile('w', suffix='.js', dir=tools, delete=False)
    try:
        entry.write("import { inflateSync } from 'fflate'; window.__metroInflate = inflateSync;")
        entry.close()
        r = subprocess.run([os.path.abspath(esbuild), entry.name, '--bundle', '--minify', '--format=iife',
                            '--platform=browser'], capture_output=True, text=True, cwd=tools)
    finally:
        os.unlink(entry.name)
    if r.returncode != 0:
        print('could not build the inflater (is fflate installed in tools/?):\n' + r.stderr,
              file=sys.stderr)
        sys.exit(1)
    loader = ('(function(){var s=document.currentScript,b=atob("' + b64 + '"),n=b.length,'
              'u=new Uint8Array(n);for(var i=0;i<n;i++)u[i]=b.charCodeAt(i);'
              'var e=document.createElement("script");'
              'e.text=new TextDecoder().decode(window.__metroInflate(u));'
              's.parentNode.insertBefore(e,s.nextSibling)})();')
    return (r.stdout.strip() + '\nwindow.METRO={{ data | json }};\n' + loader)


def squeeze_transform(src, esbuild):
    return run(esbuild, ['--minify'], uncomment(src), 'transform.js')


def squeeze_liquid(src, esbuild):
    body = re.sub(r'\{%-?\s*comment\s*-?%\}.*?\{%-?\s*endcomment\s*-?%\}', '', src, flags=re.S)
    body = uncomment(body)
    # The one big inline <script>. The Liquid expression inside it is swapped
    # for a placeholder first: a minifier reads `{{ data | json }}` as a
    # syntax error, and putting it back afterwards is exact because the token
    # cannot occur in the source.
    i = body.index('<script>') + len('<script>')
    j = body.index('</script>', i)
    js = body[i:j].replace('{{ data | json }}', PLACEHOLDER)
    if PLACEHOLDER not in js:
        print('shared.liquid: the METRO payload expression moved; teach squeeze.py the new one',
              file=sys.stderr)
        sys.exit(1)
    # AND THE PRIVATE FIELDS, WHICH ARE MOST OF THE FILE.
    #
    # Everything the layout hangs off an event or a line is `_`-prefixed --
    # `_textStart`, `_routeEdge`, `_labelSign`, `_capOut`, `_route`, a hundred
    # more -- and each one is written out in full at every use. Renamed to one
    # or two characters that is 7.7KB, more than moving the markup and the
    # stylesheet out into the four view files would buy, and it costs nothing
    # in the repo: the working copy still says `_routeEdge`.
    #
    # IT IS ONLY SAFE WHILE NO `_` FIELD IS NAMED BY A STRING. esbuild
    # renames `p._octs` and leaves `p['_octs']` and `p[key]` alone, so a field
    # reached both ways becomes two fields. That is not hypothetical: the
    # `routeSpan` memo was written through `key = '_octs'` while all nine of
    # its invalidations were dotted, and with mangling on the board drew
    # spans that had been thrown away -- eight fixtures put four lines down
    # one column. Mechanical, so it is checked rather than remembered.
    #
    # The other boundary cannot be checked by pattern without false alarms,
    # so it is written down: transform.js is not mangled, so do not read a
    # `_` field off the METRO payload. `_sortMin` is the only one it makes
    # and it is deleted before the payload is handed over.
    bad = re.search(r"""(\[\s*|=\s*)['"](_[A-Za-z][A-Za-z0-9_]*)['"]""", js)
    if bad:
        print("shared.liquid: `%s` is named by a string; mangling would split it "
              "from its dotted uses. Reach it by name." % bad.group(2), file=sys.stderr)
        sys.exit(1)
    js = run(esbuild, ['--minify', '--mangle-props=^_'], js, "shared.liquid's inline script")
    js = pack(js, esbuild)
    # A STYLE TAG INSIDE THE SCRIPT, WHICH THE STYLESHEET PASS BELOW WOULD
    # SLICE THE SCRIPT AT.
    #
    # The check is on the MINIFIED script, because the source is allowed to
    # avoid this and the minifier is allowed to undo the avoidance: a module
    # that spelled its tags in halves -- `'<sty' + 'le>'` -- precisely so the
    # template would not read as opening a stylesheet had them constant-folded
    # back into literals, and the `<style>...</style>` substitution below then
    # cut from the script's copy to the template's real one and shipped a
    # script sliced in half. Nothing before the deploy could see it, because
    # nothing before the deploy runs the squeeze.
    for tag in ('<style', '</style'):
        if tag in js:
            print("shared.liquid: the minified script contains `%s`, which the "
                  "stylesheet pass would cut it at. Keep it out of the bundle."
                  % tag, file=sys.stderr)
            sys.exit(1)
    body = body[:i] + '\n' + js + body[j:]
    # ...and every <style>, which is Liquid-free and can go through whole.
    def css(m):
        return '<style>' + run(esbuild, ['--loader=css', '--minify'], m.group(1),
                               "shared.liquid's stylesheet") + '</style>'
    return re.sub(r'<style>(.*?)</style>', css, body, flags=re.S)


# THE MARKUP USED TO BE COPIED INTO EACH VIEW FILE, AND NO LONGER NEEDS TO
# BE. The limit is per file, and shared.liquid was 94KB of which a hundred
# kilobytes was the old layout engine; moving the markup and the stylesheet
# out into the four views bought the 2.5KB that made it fit. The solver that
# replaced that engine squeezes to 35KB, so the room is there again -- and
# one copy of the markup is worth more than the bytes were. The four views
# are two lines each once more.

def report(name, before, after):
    print('%s: %d -> %d bytes' % (name, before, after), file=sys.stderr)
    return after <= LIMIT


def main():
    args = sys.argv[1:]
    check = '--check' in args
    args = [a for a in args if a != '--check']
    liquid, transform, esbuild = args
    src_dir = liquid.rsplit('/', 1)[0]
    ok = True
    written = {}
    for path, fn in ((transform, squeeze_transform), (liquid, squeeze_liquid)):
        src = open(path).read()
        out = fn(src, esbuild)
        name = path.rsplit('/', 1)[-1]
        if not report(name, len(src), len(out)):
            print("%s is %d bytes over the server's %d limit."
                  % (name, len(out) - LIMIT, LIMIT), file=sys.stderr)
            ok = False
            continue
        written[path] = out
    if ok and not check:
        for path, out in written.items():
            open(path, 'w').write(out)
    if not ok:
        print('nothing was written; the working copies are untouched.', file=sys.stderr)
        sys.exit(1)


main()
