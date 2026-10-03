# Metro Calendar: agent notes

- The plugin lives in `plugin/` (TRMNL Serverless: `src/transform.js` + `src/*.liquid`); its own guidelines are in `plugin/AGENTS.md`, the drawing rules in `rules.md`, the config schema in `CONFIG.md`.
- **`transform.js` decides nothing about the drawing.** It normalises calendars, weather and the clock, and it sends both days; everything about where ink goes is `solver/`. Line order, which side of the spine, the offsets and which line is the anchor are `solver/order.js` (rules 39-42); the drawn time span is `day.js framed()`. If you find yourself computing a position in transform, it belongs on the other side of the payload.
- Use TRMNL framework classes (https://trmnl.com/framework/docs/3.3) over inline styles wherever a class exists.
- NEVER run `trmnlp pull`. It overwrites every local plugin file with the server's copy, and the server's `shared.liquid` is the comment-stripped build `push.sh` uploads: one pull deleted 1,200 lines of comments and reverted uncommitted work. To see what the server holds, read it somewhere else (`trmnlp clone` into /tmp).
- The server owns some settings the push does NOT overwrite: `no_screen_padding` has been `'no'` in the repo for a long time while the server still had `'yes'`. Toggle those in the TRMNL UI; changing settings.yml alone does nothing.
- **NOTHING IS COMMITTED TO `main` WITHOUT THE USER SAYING SO.** Work on a
  branch and ask before the commit lands on main -- not after, and not "I'll
  merge it since the suite is green". A green suite is not approval. This
  applies to every file, docs and working notes included; if a change is
  urgent enough to want on main immediately, that is a reason to ask, not a
  reason to skip asking.
- **AND NOTHING IS PUSHED TO THE PANEL EXCEPT FROM `main`.** `plugin/push.sh`
  uploads to plugin 471753, which is the display somebody is actually reading.
  Check `git branch --show-current` first: off main, do not push, whatever the
  suite says. A branch is for looking at boards locally (`tools/sheet.js`,
  `test/trmnl`), and those need no deploy.
- Deploy with `plugin/push.sh`, not `trmnlp push`. BOTH source files outgrew the server's 100KB per-file limit, so the script pushes copies with whole-line comments stripped and the JavaScript minified (184KB to 62KB, 107KB to 46KB), checks each against the limit, proves the squeezed copy draws (`trmnlp-test run shipped`: every view lays a map out, the squeezed transform answers what the source does, every fixture draws the same board; then the in-place squeeze is compared byte for byte with the copy that was tested), then restores the sources. The template's script is then deflated and shipped as base64 beside a 3.8KB inflater built from fflate (`tools/`), which unpacks it on the page and inserts it right after itself: 95KB of minified engine is about 53KB on the server. Only `window.METRO = {{ data | json }}` stays outside the compression. The explanation in the comments is worth more in the repo than the bytes are on the server. The minifier deliberately leaves identifiers alone, so a stack trace off the device still names its function. esbuild lives in `tools/`; push.sh installs it if missing.
- **One command: `./test.sh`** (`./test.sh node` for the plain-node half, `./test.sh trmnl [playwright args]` for the other). Every suite runs even after one fails, and the script fails if any did.
  - **Plain node, no browser:** `solver/cases.js` (the layout engine), `test/boards` (the drawing's geometry, solver and renderer in jsdom, text measured from `test/boards/metrics.json`; ~20s cold, under a second warm), `test/config-editor` (jsdom), `plugin/bundle.js --check` (the bundle inside `shared.liquid` is the one in `solver/`) and `plugin/squeeze.py --check` (the copy that ships still fits the server's 100KB per file). A geometry question goes in `test/boards/cases`; `node test/boards/calibrate.js` rewrites the width table when the framework or label classes change.
  - **trmnlp-test** ([ExcuseMi/trmnlp-test](https://github.com/ExcuseMi/trmnlp-test), `gem install trmnlp-test`, Docker; specs in `test/trmnl/`, config in `trmnlp-test.config.js`, report in `test/trmnl-report/index.html`). Everything that renders the plugin or runs its transform, the way TRMNL does it: trmnlp's Liquid and node runtime, the real framework CSS and faces, real device models, palettes, portrait and mashup slots, a frozen clock and mocked feeds. `transform/` is the payload (365 cases, one spec per old case file: a feed is a mock per URL, a slow server is `delayMs`, saved state goes round through `trmnl_state`; a server that eats the clock is `advanceClockMs`, a request the transform gave up on is recorded `aborted`; only the transform's internal functions, which no runtime can call, are loaded into a node vm (`internals`)). `layout/` is what needs the real page and faces: label boxes against the canvas, the strip and its badges, the banner, slots, standing captions (`lib/page.js` has the page report every drawn thing in canvas px with SVG paths sampled, `lib/layout.js` the viewports and helpers; reports are cached on disk in `test/trmnl/.cache`, keyed on the plugin's sources). `sweep.spec.js` takes the three example days through the real transform at five times of day onto all six views, FAILS on a fault and ratchets what each board loses against `sweep.baseline.json` (`trmnlp-test run sweep -u` to bless, deliberately). `shipped.spec.js` tests the squeezed copy push.sh uploads, `lint.spec.js` is `trmnlp lint`, `visual.spec.js` keeps pictures of the X and OG boards (`-u` after a change you meant), and `households/` checks six invented households' payloads against their feeds (their 216 boards report shed, muddle and dropped lines, and fail on a fault, except six accepted ones listed as KNOWN in the spec). Always write `trmnlp-test run ...`; put `--repo`/`--mount` before `run`; `TRMNLP_TEST_WORKERS=4` (test.sh's default) leaves the machine some CPU.
  - Run all of it, plus `plugin/lint.sh`, before pushing.
- `solver/` is the layout engine, written as plain modules node can require, and `plugin/bundle.js` splices a generated copy into `shared.liquid` between two markers. Edit `solver/*.js` and run `node plugin/bundle.js`; never edit the bundle in the template.
- Two standalone measuring tools, deliberately not part of any suite: `node solver/bench.js` (how long a board takes, on days harder than real ones) and `node solver/capacity.js` (what each layout box and view can hold, and what the shedding cap costs).
- The layout suite measures text in the framework's REAL faces. The stylesheet asks for them by absolute path (`url("/fonts/TRMNL16-Regular.woff2")`), which under `file://` resolves to `file:///fonts/...` and silently fails, so for a long time every label box it measured was sized in whatever Chromium fell back to. The framework sets `--label-font-family: TRMNL16`, `--label-small: TRMNL12`, `--title: TRMNL21`: pixel fonts, nothing like a fallback sans in width. It looked fine because the tests agreed with each other, and with nothing on the device. The old harness learned to fetch the faces; trmnlp-test serves them from its cache the way TRMNL's page asks for them, and `tools/framework-assets.js` does the same for the tools that render from file://. Turning the real faces on immediately found a real defect the fallback had been hiding.
- **SEND THE SCREENSHOT, do not describe it.** Every time the drawing changes, put a picture in front of the user with `SendUserFile`: the full board at TRMNL X landscape, plus a crop of whatever changed when the change is small enough to hunt for. A description of a layout is not a layout, and the user cannot judge "PTA Meeting now sits on the diagonal" from a sentence. Send it when the change lands, not batched at the end, and re-send after a revert so the last picture they have is the board they actually have.
- **TRMNL X FULL VIEW IS THE TARGET.** That is the board to optimise: 1872x1404, classes `screen--v2 screen--lg screen--4bit screen--density-2x`, 1020x701 in layout px. The OG panel and the half and quadrant slots may crop lines or the time span to fit; they are not the thing being designed for, and a board that packs there is not a reason to make the X board worse.
- Layout changes need a screenshot at a real device size, zoomed on what changed, **as well as** a green suite. Read `plugin/AGENTS.md` "Testing the layout" first: it covers what the harness measures, the difference between a well-formed drawing and a truthful one, and the two ways a green run has lied here before.
- Demo boards live in `demo/<show>/`: real ICS files plus a `config.json`, and the plugin FETCHES both at run time from raw.githubusercontent. There is no copy of a demo config in `transform.js` any more and nothing to regenerate; edit the file and push git. Push git BEFORE pushing the plugin whenever those paths change, and note that a demo with no network now draws a wholly empty board, because the config it would name the family from is itself on GitHub.
- `tools/config-editor.html` runs `plugin/src/transform.js` and the `<script>` from `plugin/src/shared.liquid` unmodified for its preview. It used to hand-build a copy of the template's header beside that, which drifted four ways at once; the board draws everything outside the map itself now, so there is nothing left to keep in sync. `test/config-editor/cases/07-header-mirror.js` holds that: the template must not grow a header band back without the preview learning to mirror it again.
- That page is two pages sharing one model. The **wizard** (`#station-wizard`, `data-stage="wizard"`, everything named `wz*`) is the front door: one question per screen, click-by-click instructions for finding a calendar's link in five services, a check that reads the feed back in words before anything is added, and answers saved in `localStorage` and offered back as a question. The **editor** below it is the old page, every control at once, reachable by `?full` or the link at the foot of every wizard screen. They write the same `state` through the same functions, so there is exactly one export, one importer and one preview: never add a second model of a configuration to serve one of them. Its cases are `23-wizard.js`; everything else in `test/config-editor/cases/` exercises the editor.

## Judging a picture

`/rule-check` (`.claude/skills/rule-check/`) renders or takes a screenshot and
has an agent read it against `rules.md`, finding by finding. The layout suite
proves a drawing is well formed; this is for whether it is right, which is a
different question and the one that has cost the most time here.

## Where the rules live

`rules.md` lists every rule the board draws by, with the reason attached.
Read it before changing geometry: most of what looks like a free choice in
`shared.liquid` is one of those rules, and the reason is usually a picture
somebody looked at.

`MAINTENANCE.md` is the method for changing any of it without making the board
worse: what to measure, in what order of badness (a person dropped, then ink on
ink, then an event unnamed, then a name that could be misread), and a list of
changes that looked obvious and measured worse. Read it before the first
"obvious" optimisation or layout tweak; three of them in one session had to be
reverted after measuring.

## How the board says somebody is elsewhere

Four shapes, and they are not interchangeable. Texture on this board means
WHO -- each line wears its own -- so a new texture cannot be used to mean
anything else.

- A BRIEF shared event is one bar with a ring on each line in it.
- A LONG one is drawn once, as its own tube off that bar (or as a corridor
  where the rails converge). It hangs off whichever rail hosts it, which is
  not necessarily a rail of anybody in it: who joined is in the payload
  (`co_owners`), not in the shape.
- Meanwhile, each member's OWN rail is drawn lighter for those hours (same
  width, same texture, `data-metro-role="away"` in `draw.js`), starting at the
  edge of the ring they joined by. Only where that person has nothing else in
  those hours. The per-member end tick is suppressed there too, or one event
  draws four terminators.
- A SHORT event (under 1.4 shelf depths) takes no shelf: it is a dot and a
  tick on the person's own rail. At 45 degrees the lead is as long as the
  shelf is deep, so the corner ate the run before the dot.

Shapes tried and rejected for "away", with pictures in the history: a band
behind the stretch (too quiet), a hairline trunk (throws away whose line it
is), a trunk that narrows and widens (reads as a wasp waist, i.e. a fault in
the line), shade ramps with terminator slashes at each end (read as random
marks), and a 45-degree ramp that IS the event -- that one fights the grammar,
since vertical position means whose line it is, so a diagonal says the person
is changing rows and the duration ends up measured on a slope.

## Things that have cost real time here

- **The board's own numbers, and where they are.** Every rendered page carries `data-metro-debug` on `.metro-canvas`: `ms.solve`, `ms.draw`, `shed`, `muddle`, `dropped` and the fault list. The page also logs `metro: start WxH` and `metro: drawn in Nms (...)` to the device's console, which is how a double solve was caught. Read those rather than counting pixels.
- **Keep every person (the owner's decision).** In the smallest slots a few overlapping names are accepted rather than dropping a person: measured, every way of clearing them left one to three people off. Six household boards carry such a fault and are KNOWN in `test/trmnl/households/households.spec.js`; any other fault fails. MAINTENANCE.md has the numbers.
- **Where the board currently stands** (September 2026): across the 216 example-household boards, 36 events unnamed, 36 mistakable captions, 30 lines dropped, 1 fault -- a name cut by its own branch on a seven-line 800x480 board, which trades against an unnamed event elsewhere. (Those are the jsdom numbers. Drawn in the real page, October 2026: shed 52, muddle 59, dropped 31, faults 15; and the sweep of the example days, clean in jsdom, has `onbar` faults on six X-landscape boards. See test/trmnl/sweep.spec.js.) Known and deliberately not fixed: `readable` writes `overBar` onto a candidate and nothing clears it, so a cached candidate can carry a flag from a board where the bar stood elsewhere; clearing it is correct and costs two more dropped lines, so it needs the `OVER_BAR` price revisited at the same time.
- **The device's renderer captures the page on its own clock, and it is not the preview's.** Delaying the first draw (a quarter second, waiting for the canvas box to hold still) and arming a redraw two seconds later both worked in a browser here and in TRMNL's preview, and the panel stopped drawing the board at all until they were taken out again. Draw as soon as the faces are ready, and lay the board out again only when the box really changes. Whatever a preview wastes solving twice is worth less than the panel drawing at all.

- **A failing suite is a question, not a verdict.** The most expensive habit
  in this project has been: try a change, watch the layout number drop, revert,
  report that it "regressed". That is giving up on a half built solution and
  calling the tests the reason. The number moving is the START of the work.
  Find out WHICH cases and WHY. Three separate times the answer was a real bug
  that took twenty minutes once it was actually chased: a branch rail drawn at
  x = -219 on a board whose first pixel is 4; an event converted to a mark
  keeping the lane it no longer had; a packing rule that read "more rungs than
  banding" as "fits more content", which stopped being true the moment events
  could be drawn without a rung at all. Every one of those was hiding behind a
  revert.
  Also: do not stack four changes and measure once. One variable, one run, and
  when the number moves, read the failure text before touching anything.


- **A half or a quadrant is a SLOT inside the screen, not a smaller screen.** The framework pins `.screen` to the device's own size whatever the window is, so asking headless Chromium for a 400x240 window and calling the result a quadrant renders a full 800x480 board and crops the picture. Override `--full-w` / `--full-h`, which is the one knob a real mashup turns; `renderOptions` in `test/trmnl/lib/layout.js` does this via a viewport's `slot` (trmnlp-test's `slotSize`) (and a viewport's `page` renders the view's own template in TRMNL's real mashup slot). Until this was found, every small-view case in the layout suite was measuring a full-size board under a small view's name. Any conclusion drawn from one before that is worth re-checking, comments included.
- **A placeholder in a Liquid output tag ends the tag.** An output tag whose default string contains a braced placeholder takes the whole template down with a syntax error that shows up only as a 900-byte build. Build the string with an assign tag first, the way `rain_pct` does. The same bites markdown in this repo: GitHub Pages runs every `.md` through Liquid, so do not write such an example into a doc.
- **The inline-style lint scans the raw markup for property names, comments included.** `LimitedInlineStyles` counts `justify-content`, `padding`, `margin`, `background-color`, `border-radius`, `text-align`, `object-fit` and `font-size` anywhere in the file, with a budget of 6 for the whole template. Naming one in a comment costs exactly as much as using it.
- **Ties in the band search go to whatever is offered first.** The descent keeps a move only if it is strictly cheaper, and the two sides of a rail usually cost the same, so with the modes listed `[0, 2, -2]` every coin flip landed downward -- which is why every short branch on the board pointed down for months. `modesFor` offers the roomier side first now. Anywhere else a list of equal-cost options is walked, the same bias is waiting.
- **A test that passes the moment you write it has told you nothing.** Two did in one session. Before believing a new layout test, put the old file back and watch it fail: `git show HEAD:plugin/src/shared.liquid > plugin/src/shared.liquid`, build, run, restore. `git stash` does not work for this, it takes the new test away too.
- **Do not `git add -A` while a subagent is running.** It sweeps their in-flight files into a commit whose message says nothing about them. Commit explicit paths.
- **Never build in the tracked `plugin/`.** A build variant needs `.trmnlp.yml` patched, and that file is tracked source; patched in place with a restore in a `finally`, it left `"service_alert"` baked into the file three times in one day when two things built at once. trmnlp-test never builds there (it renders from the sources in its own process), `tools/framework-assets.js builtPage()` builds in a temp copy, and the squeezed copy is made in `test/trmnl/.shipped/`.
- **Under `--dump-dom` the framework's engines never run, and the page still looks fine.** The terminalize pipeline (the overflow engine included) is scheduled on `requestAnimationFrame`, and headless Chromium producing no frames means that callback never arrives: the DOM is dumped with nothing applied. Measurements taken that way are of a board the device never shows, and they are plausible rather than obviously broken, which is what makes them expensive. Found in the sibling family-calendar plugin, whose new layout suite reported rows sitting on top of the footer that a real browser trims away, and reported it differently on different runs. Two parts to the fix, and the second matters more: shim `requestAnimationFrame` onto a timer BEFORE the framework script loads, so its scheduler captures the shim; then refuse to report at all unless the page carries the framework's own `trmnl:terminalize:stats` (it also leaves `window.__TRMNL_LAST_STATS__`), because a suite that cannot prove the engines ran should fail, not average. Same shape as the font-path bug above: the tests agreed with each other while agreeing with nothing on the panel.
- **`document.fonts.ready` does not mean the font is loaded.** It resolves when the fonts that are PENDING have finished, and a face nothing has asked for yet is not pending: on a cold page it resolves before the board has drawn a word. The first layout then measures every label in the fallback face, requests the real face BY measuring, and the real face arrives afterwards 12 to 17 per cent wider. Nothing re-ran, because `load` had fired too. Every number in this engine is a measurement, so the whole board was laid out for text narrower than the text it draws: hours booked clear of each other came out touching, a label clamped to the leading edge hung off it, and captions the assignment believed were clean came out grazing. Found by stashing the layout's own measurement on the element and comparing it with the drawn rect (34 vs 38 on OG, 36.3 vs 42.3 on an X). The board now asks `document.fonts.load()` for the face of every class it is measured in, punctuation included, before it solves (a second at most); `test/trmnl/layout/cold.spec.js` draws a board on a page with no faces in it and again warm, and wants one board. The suite waits for the run count to stand still rather than for a fixed 250ms (`settled()` in `test/trmnl/lib/page.js`, passed to trmnlp-test as `waitFor`), because it was reporting whichever pass happened to have landed.
- **Every board on one sheet: `node tools/sheet.js`.** The suites prove a board is well formed; they do not show it to you, and nearly every fault this project has shipped was found by somebody looking at a picture. It renders all eighteen layout fixtures and the three demo days at three times each, captions every tile and montages them, so a change can be scanned in one image instead of one crop at a time. `--view x-landscape|og-half|x-portrait` for a device's real size, `--only shared,corridor` to filter, `--out` for the path. It rebuilds the plugin first, so do not run it beside a layout run (see the note above about racing builds).
- Screenshots: `trmnlp-test` attaches every device picture of a failing test to its report (`screenshots: 'on-failure'` in the config; `always` for all of them), `tools/sheet.js` has a `pageFor` of its own, and the scratchpad keeps throwaway `swap.py` (put a fixture into `_build/full.html`) and `shotv.sh` (screenshot at a given VIEW size, which is the one that tells the truth about small views). A Liquid-side change will not show up through `swap.py`, which only replaces the runtime payload; rebuild instead.
