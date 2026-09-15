# AGENTS.md — Metro Calendar plugin guidelines

## What is true of this plugin

* **Platform:** a non-touch e-paper display (TRMNL and about fifty compatible
  panels), 1-bit to 4-bit, rendered server-side and sent as a PNG. It draws
  once per refresh; there is no interaction, no scrolling and no hover.
* **Aesthetic:** London Underground / NYC Subway diagram geometry. Events are
  **typographic signage** anchored to continuous single-stroke SVG paths.
* **Prohibited:** cards, pills, boxes or borders around event text; background
  hatching or grey fill blocks; hardcoded hex colours; and per-pixel layout in
  `transform.js`.

## Where things live, and the one rule about it

* **`plugin/src/transform.js` decides nothing about the drawing.** It reads
  calendars, applies the config's rules, resolves the weather and the clock,
  and emits facts: events with `start_min`/`end_min` and `owner`/`co_owners`,
  a legend of `{key, name, side, hue, configured}`, day rows, weather
  milestones, `now_min`. It cannot make a layout decision honestly, because it
  runs once and its payload is drawn by four views at four sizes.
* **`solver/` is the layout engine**, plain modules node can require:
  `day.js` (the payload into a spec, and which slice of it is drawn),
  `order.js` (which order the lines go in and which side of the spine),
  `bands.js` (where each line runs), `captions.js` (where each name goes),
  `rails.js`, `fit.js` (what to leave out when it will not fit), `draw.js`.
  `plugin/bundle.js` splices a generated copy into `shared.liquid` between two
  markers; edit `solver/*.js` and run `node plugin/bundle.js`.
* **`rules.md` is the specification** for what the drawing means. Read it
  before changing geometry: most of what looks like a free choice in the
  solver is one of those rules, and the reason is usually a picture somebody
  looked at.

## The payload

* `transform.js` returns `{ data, trmnl_state }`, and a serverless transform's
  returned keys ARE the template's root variables, so every template path
  starts `data.`.
* **Both days go, every time**, from the shown day's own midnight:
  `day_start_min` is 0 and `day_end_min` is the run it gathered. Where the
  board OPENS is `day.js opened()` (the 10/13/16/19 steps, plus room in front
  of the first thing drawn); where it CLOSES is `framed()`, against the view
  it is drawing on. What is not drawn is still counted, at the edge it fell
  off.
* `data.events` is the events and `data.weather` is the sky markers;
  `data.header_weather` is the header's own. These were one mixed list once,
  and every consumer's first move was to filter it by type.
* **Demo mode** fetches `demo/<show>/config.json` from this repo's `main` at
  run time, beside the ICS files it names, and runs it through the real
  fetch/parse/rule pipeline. There is no copy of it in this file and nothing
  to regenerate. There is no offline fallback either: a hardcoded Springfield
  day used to stand in when GitHub was unreachable, and a device that missed
  the fetch budget then showed a different board with no sign anything was
  wrong. With no network the demo now draws an empty board, which is honest
  and obviously not a working day.
* **The forecast covers a run of days; the board draws part of one of them.**
  Every fact taken out of the snapshot is indexed by the day it describes and,
  where it names an hour, held to the clock. This has gone wrong four separate
  ways: the wettest hour scanned across both days, so tomorrow's rain became
  today's service alert; the rain markers ran on into day 1 and drew a "Rain
  Stops 07:00" before the "Rain Starts 13:00" it belonged to; sunrise/sunset
  were a hardcoded `[0]`; and `now_min` was passed through on a board showing
  another day. The snapshot records the civil day of its own day 0
  (`snap.date`) and the index slides by the days elapsed, so a forecast
  fetched at 23:30 and read at 04:00 is read as the yesterday it is. Tests:
  `service-alert.js` and `multi-day.js`.
* **i18n:** English lives inline in `I18N` in `transform.js` and is the
  fallback; every other language is a JSON file in `i18n/<code>.json`, fetched
  at render time against the render deadline, cached in `trmnl_state`, and
  silently English on failure. A new language is a pull request. Dates use
  Intl with the account locale.

## Drawing notes that are still load-bearing

* **A colour is a ROLE.** `'black'` resolves to the theme's ink and `'white'`
  to its paper; a line assigned literal black vanished on a dark board, and it
  was the anchor. Because a colour can be a CSS variable, every stroke and
  fill goes through `.style`, never a presentation attribute -- SVG attributes
  do not accept `var()`.
* **No box behind a label.** An opaque panel over a metro map reads as a hole
  punched in it. Text carries a thin paper outline instead (`paint-order:
  stroke fill`, which puts the stroke behind the glyphs so the letterforms
  keep their weight).
* **Lines are told apart by weight and by what is knocked OUT of the stroke**,
  never by a dash pattern: on e-ink a dashed line is mostly paper and reads
  faint however dark the ink is. `plain`, `casing`, `hatch`, `beads`, all
  keeping a continuous black envelope, all drawn wider to compensate, with the
  paper cut out as an overlay clone carrying `data-metro-overlay` and no
  `data-metro-role`.
* **TRMNL X zoom:** the framework zooms high-density screens ~1.8x. Work in
  layout px (`offsetWidth`) and divide `getBoundingClientRect()` measurements
  by the zoom factor.
* **Elements carry `data-metro-role`** purely so tests can tell them apart.
  Keep one on anything new that gets drawn.

## Running it

* **Debug:** the canvas's `data-metro-debug` attribute carries the solve and
  draw times, what was shed or dropped, the faults the board knows about, and
  every event's drawn form. Read it with headless Chrome `--dump-dom`.
* **Local preview:** `.trmnlp.yml` carries a baked demo payload with the
  transform runtime disabled. `trmnlp lint` must come back clean before a
  push. Two of its checks need knowing about: it counts the STRINGS
  `padding`, `margin`, `font-size` and five more anywhere in the liquid,
  comments and `<style>` blocks included, and trips at seven, so a comment
  that says "margin" costs the same as a style attribute; and its vendored
  list of field types predates `lat_lon` (the hosted service's Location
  picker, which is real and live), so it reports that setting as an unknown
  type on every machine. 0.12.0 is the newest release and
  `FormField::DATA_PATH` is hardcoded to the gem's own file, so there is
  neither an upgrade nor a project-local schema that fixes it. **Run
  `plugin/lint.sh`**, which drops that one line and fails on everything else;
  it is also what `push.sh` runs. Editing the installed gem by hand works on
  one machine, is invisible to everybody else, and dies on the next
  `gem install`. And do not "fix" it by downgrading the field to a string.

---

## Testing the layout

This suite exists because the layout kept regressing in ways nobody noticed
until a screenshot arrived. Read this before adding to it, and before
trusting it.

### What the harness actually does

`test/layout/run.js` runs `trmnlp build`, swaps the baked demo `data:` block
for a fixture, loads the page in headless Chromium with the **real** 18MB
TRMNL framework CSS, waits for the layout to settle, and has the page report
every drawn thing in one coordinate space (screen px, canvas-relative). SVG
paths are **sampled** with `getPointAtLength`, never read as control points,
so a rounded or curved path is checked as the shape it really draws.
Assertions run out in Node against that report. `layout(fixture, viewport)` is
memoised per fixture+viewport, so ten tests on one board cost one render.

### The rule that matters: test the truth, not the tidiness

Every assertion in here is one of two kinds, and only one of them catches
real bugs on its own.

* **Well-formedness** — lines meet, nothing overlaps, markers sit on their
  line, nothing falls off the canvas. Cheap, fast, and satisfied by drawings
  that are complete nonsense.
* **Truthfulness** — the drawing says what the data says. A label is not
  drawn before the time of the event it names. A rail is as long as its
  event, not as long as its label. A tick is at the start minute and another
  at the end minute.

A branch once ran two hours backwards to find room, so "Family Dinner"
appeared at 17:00 for a 19:00 event. Every well-formedness test passed: the
line met its trunk, the label collided with nothing, the ring was centred.
`test/boards/cases/honesty.js` is the answer to that, and it is the file to extend first
when a new kind of thing gets drawn. **When a visual bug is reported and the
suite is green, the missing test is almost always a truthfulness one.**

### Do not trust a green run you have not looked at

Two failure modes have both bitten here, and both look like success:

1. **The invariant is measured against the wrong set of elements.** The ring
   test compared markers to `line` and `branch` paths only. Where a branch
   dives just a lane's minimum, the whole diagonal fits inside the corner
   fillet — so the `branch` path collapses to a point and the `fork` path IS
   the line. The test reported a tick as adrift by exactly the length of the
   diagonal it was sitting on, and the "fix" attempts all moved the drawing.
   *Before believing a geometry failure, print what the marker's nearest
   neighbours are in every role.*
2. **The test is wrong and the code is right.** A rail-connection test was
   written against the elbow when it should have been against the rail end.
   It went green on a broken build. If a test starts passing right after you
   change it, re-derive what it asserts from the picture.

### The loop

1. **Reproduce visually first.** Build, screenshot at a real device size,
   crop and zoom to the defect. Never start from the test output.
2. **Probe with numbers.** Drop a throwaway `cases/zz-probe.js` that renders
   one fixture and `assert(false, ...)`s the values you care about (console
   output from a case is not shown; the assertion message is). Read the
   canvas's `data-metro-debug` attribute for each event's chosen lane,
   direction, node/elbow/text positions and line distance.
3. **Fix, then re-screenshot.** A passing suite is not evidence the picture
   is right.
4. **Add the test that would have caught it** — stated as the property, not
   as the pixel values you just observed.
5. **Run the whole suite.** It takes a few minutes; run it in the background
   rather than narrowing to the test you just wrote.

### Writing a good case

* Assert a **property with a reason**, and put the reason in a comment: what
  broke, what it looked like, why this tolerance and not a tighter one.
  Every tolerance in this suite has a written justification, because an
  unexplained one gets loosened silently the next time it fails.
* **Loop over all fixtures** unless the case is about one specific board.
  Fixtures are bug reports: `busy-day` (the everyday case), `all-day-every-line`
  and `siding-day` (siding kinks moving every line off its baseline),
  `quiet-day` (must not invent overlaps out of empty space), `tight-pair`
  (same-owner events minutes apart), `full-day` (express-compressed head and
  tail). Add a fixture when a bug needs a board shape none of these has.
* **Failure messages carry the evidence**: which element, where, off by how
  much. `'3 label(s) with a line through them: "Team Standup" pierced 15px'`
  is debuggable from CI output alone; `'assertion failed'` costs a full
  re-derivation.
* **Check the views.** `og-*` and `x-*`, full/half-horizontal/half-vertical/
  quadrant, plus portrait. Vertical broke for weeks because one path skipped
  `toXY`; the test that found it found it on its first run.

### Known issues, not skips

`test(name, fn, { known: 'why' })` marks a real, understood, unfixed defect.
It reports without failing the run, **and fails if it ever starts passing**,
so a fix cannot land without the marker coming off. Use it for a genuine
trade-off you have decided to accept; never to quiet a failure you have not
diagnosed. The `why` string must name the trade-off, not the symptom.

### Before pushing a layout change

* `cd test/layout && npm test` — 0 failures, and the known-issue count has
  not grown without a written reason.
* `./test.sh` at the repo root for `transform.js` and the config editor.
* Screenshots of the affected views at real device sizes, zoomed on what
  changed.
