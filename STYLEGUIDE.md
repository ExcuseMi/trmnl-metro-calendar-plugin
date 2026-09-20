# Style guide

How this board should look, and why. `rules.md` says what the board draws;
this says how it is meant to read. Where the two disagree, `rules.md` wins
on behaviour and this wins on ink.

It is written from photographs of the real thing: platform signs, departure
boards, a station map legend, the tape along a platform edge. Those pictures
live in `style/`, which is deliberately untracked, so everything here
describes what a picture shows rather than pointing at a file nobody else
has.

The one sentence behind all of it: **a sign is read at a glance by someone
who is not looking for it.** Every rule below is a way of buying that.

---

## 1. The panels this is drawn for

Taken from `https://trmnl.com/api/models` on 2026-09-20. That endpoint is
the authority; if a number here disagrees with it, the endpoint is right and
this table is stale.

| Model | Label | Pixels | Depth | Palette | Screen classes | CSS canvas |
|---|---|---|---|---|---|---|
| `og_png` | TRMNL OG (1-bit) | 800x480 | 1 bit, 2 colours | `bw` | `screen--og_png screen--md screen--density-1x` | 800x480 at 1.0 |
| `og_plus` | TRMNL OG (2-bit) | 800x480 | 2 bit, 4 colours | `bw`, `gray-4` | `screen--ogv2 screen--md screen--density-1x` | 800x480 at 1.0 |
| `og_bwry` | TRMNL OG (B/W/R/Y) | 800x480 | reported 1 bit | `color-4bwry` | `screen--og screen--md screen--density-1x` | 800x480 at 1.0 |
| `waveshare_7_5_bwry` | Waveshare 7.5" B/W/R/Y | 800x480 | reported 1 bit | `color-4bwry` | `screen--og screen--md screen--density-1x` | 800x480 at 1.0 |
| `v2` | TRMNL X | 1872x1404 | 4 bit, 16 colours | `gray-16`, `gray-4`, `bw` | `screen--v2 screen--lg screen--density-2x` | 1040x780 at 1.8 |

Two things to notice, because both have bitten this plugin before.

**The depth field is not what to branch on for colour.** The API reports the
BWRY panels as one bit with two colours and then hands them a four-colour
palette. What says a panel has red and yellow is the palette id, which
reaches the markup as `screen--color-4bwry`. `solver/draw.js` already reads
the class and not the depth, and that is the right instinct: the class is
the fact, the depth field is a compression detail.

**The CSS canvas is not the panel.** A TRMNL X is 1872x1404 real pixels but
1040x780 CSS pixels at a scale of 1.8, and the framework's type sizes are
written in those CSS pixels against `--text-ui-scale`. So a hairline is not
a CSS pixel: on the X one CSS pixel is nearly two device pixels, and on the
OG it is one. Anything drawn at less than about 1.5 CSS pixels on an OG is a
line the panel cannot commit to.

There are also Kindle, Inkplate and other byod models in the list at 2 and 8
bits. They come out of the same drawing and need no special case: a board
built for 1 bit is legible at 8, and a board that needs 8 is broken at 1.

## 2. What may carry meaning, per depth

A reader cannot be told to squint. So the question for every mark is not
"can this be drawn" but "at the worst depth this board will meet, does this
difference survive".

**At 1 bit (OG, and the BWRY panels' greyscale channel) the only honest
channels are:**

- solid ink and bare paper,
- an outline, which is ink round paper,
- shape, which is the cheapest channel of all and the most ignored,
- a dash or dot pattern along a line, at the line's full weight,
- position.

Not available at 1 bit, whatever the CSS says it is doing: grey, opacity, a
one-pixel rule, and anything whose difference from its neighbour is a tone.
The framework will dither a grey into speckle, and three pixels of speckle
is not a line. `solver/draw.js` handles this with `ONE_BIT`: every rail goes
solid and the dash patterns do the telling apart. The same rule applies to
anything new: **if it would have to be grey, give it a shape instead.**

**At 2 bit (OG 2-bit, Inkplate) there are two greys between ink and paper.**
Use them for ground, never for meaning: a band behind a row, a past wash, the
faint ground under the sky glyphs. A reader should be able to lose both greys
and still have the board say the same thing.

**At 4 bit (TRMNL X) there are sixteen.** This is where the rail ladder
earns its keep: `TONES = [55, 100, 40, 70]`, mixed from the theme's own ink
and paper with `color-mix`, so tone says which line at a glance and texture
says which line where two rails touch. Two channels, two questions. The
ladder stops at 40 per cent because a fifth line at 70 was a wash you could
lose against the paper.

**On BWRY there is black, white, red and yellow, and nothing in between.**
Red and yellow are spot colours in the signage sense: they mark one thing
each, they are never a gradient, and they are never the only difference
between two marks. A red rail and a black rail must still differ in texture,
so that the same board photographed in greyscale still reads. Yellow on
white is the weakest pair on the panel; yellow belongs on black, the way
platform tape is yellow against a dark platform edge. Red belongs to the one
thing that interrupts: an alert, a clash, a thing that is wrong. If red is
spent on decoration there is nothing left to say "stop" with.

Never, at any depth: colour as the only difference; opacity as a way of
saying "less important"; a hairline thinner than the panel can hold; text
knocked out of a texture.

## 3. Type

The signs in `style/` are almost all **sentence case, set bold**: "Spring
Street Subway Station", "Downtown & Brooklyn", "Valid Fare Required Beyond
This Point". Capitals appear only where the word IS the mark, on a short
word like Exit and on route letters in roundels. That is the rule here too.

- **Sentence case, bold, for anything that is read.** Headlines, tasks, the
  weather sentence, captions. Capitals are for a word doing a sign's job in
  one or two syllables, which on this board means the line names
  (`.metro-terminus`) and a date marker among the numbers
  (`.metro-daybreak`). A row of capitals in a headline is a wall.
- **One type per band.** A bar that mixes two sizes reads as two bars that
  failed to line up. The foot already does this: `nbType` in
  `solver/draw.js` sets every row in the box in the alert's own `title`,
  because when the headlines were `label` and the alert was `title` the two
  rows did not look related.
- **Sizes come from the framework's classes**, never from a number in this
  repository: `label--small` (12-16px CSS), `label` (16px), `title--small`
  (16px), `title` (21-26px), `value--small` (26px), each already multiplied
  by `--text-ui-scale` for the panel. This is also what makes measurement
  honest: `solver/measure-dom.js` measures the same class the drawing will
  use.
- **Minimum legible size.** On the 800x480 panels nothing that matters may
  be set below `label--small`, and a quadrant or a half slot should stay at
  `label--small` rather than inventing something smaller. On the X, one step
  up is free and should be taken: the panel is read from further away.
- **Never two fonts in one bar**, and never a second face anywhere. The
  framework's stack is the board's voice.
- **Numbers are never quieter than the words they belong to.** A time is the
  one thing a reader came for; `rules.md` 38a already says it is bold black.

## 4. Signage grammar

What the photographs actually do, turned into rules for this board.

**A bar is one bar, and its sections are butted.** The Green Line sign is a
single horizontal bar whose dark section and red section touch: no gap, no
paper between them, no second frame. The change of ground IS the divider.
This board's foot follows the shape already (`metro-news--alert`,
`metro-news--tasks`, `metro-news--news` stacked with `nbGap = 0` and a paper
hairline between them) but not yet the substance: every section is
`inverse bg--canvas`, so all three have the same ground and only the
hairline separates them. See the changes at the end.

**An icon leads its section, at the type's own height.** The weather cloud
and the newspaper glyph are both `1.7em` now, which is what makes every row
in the box start its words on the same x. Any new section gets the same
treatment: one glyph, leading, at 1.7em, and the words after it.

**Every section's words start on one line.** A column of icons with the text
starting at three different places is the single most common way a sign
looks amateur. One left edge, and everything in the bar ranges on it.

**A route is a filled roundel with the letter knocked out.** The C and E on
the Spring Street sign, the A/C/B/D on the Downtown sign. This board's
interchange rings carry initials the same way (`rules.md` 38b), and the
source pill in the foot is the same device at small size.

**A station name is a box, not a pill.** The NYC signs name a station in a
plain rectangle of ground; a pill is a route bullet, and using a pill for
both makes the two read as the same kind of thing. `.metro-terminus`
currently inherits `.metro-pill`'s 999px corner, so a line name and a route
bullet share a shape. The framework's `label--filled` is the box: filled
ground, knocked-out text, a 4px corner that reads as square at this size.

**Express and local stations differ by fill, not by size.** The map legend
draws an express station as a hollow ring and a local as a solid dot, both
the same diameter. That is a shape difference that survives 1 bit, and it is
the model for any two-state mark on this board: a task's tick box is empty
or ticked, never grey or black.

**The platform edge tape is a warning stripe with a rhythm.** Yellow,
regular, unbroken, running the length of the platform: it says "the edge is
here" without a word. The strip's rail is this board's platform edge, and
its stations are the rhythm along it. Two lessons: the rhythm must be even
(`rules.md` 2n: one clock step along the whole rail), and on BWRY the strip
rail is the one place yellow would be honest.

## 5. Layout

- **One margin, and it is the paper's.** The foot boxes run the full width
  and sit flush against the map; the map's own gutter is the legend column.
  A box set in from the edges reads as a widget on a page, which is what the
  board is not.
- **A column ranges on one left edge.** The legend, the task stacks under
  it, and the words in the foot bar all start on the same x as the thing
  above them. When a task stack was ranged on the badge's outer edge and the
  badge's letters sat 8px further in, the column looked broken.
- **A divider is a hairline in the ground's opposite colour**, at least 1.5
  CSS pixels, never a gap. Paper on ink, ink on paper. A gap between two
  statements makes two objects; a hairline makes one object with two things
  to say.
- **Two statements are separated by their ground, not by space.** This is
  the Green Line sign's whole trick and the thing to reach for before
  reaching for a gap.
- **Nothing is centred that could be ranged left.** A sign centres a word
  only when the word is the whole sign.

## 6. What the board already does, and what it does not

Checked against the code, not remembered.

Already right:

- `ONE_BIT` forces every rail solid and lets texture do the telling apart
  (`solver/draw.js`), which is the 1-bit rule above.
- The 4-bit tone ladder is mixed from the theme's ink and paper with
  `color-mix`, so it follows dark mode and needs nothing from the paint API.
- BWRY is read from `screen--color-4bwry` and the rails after the anchor
  take the panel's real colours, in the order the class names them.
- Texture and tone are two channels answering two questions, and the anchor
  line is full ink on every panel.
- The foot bar's sections are butted with no gap and divided by a paper
  hairline; only the first section carries `rounded--small`.
- One type through the whole foot bar (`nbType`), and both glyphs at 1.7em
  so the rows' words start together.
- Type sizes come from framework classes throughout, and the offline ruler
  measures the same classes.
- A task's state is a shape: an empty or ticked box (`.metro-task-box`),
  not a tone.
- The line name is set in capitals and tracked wider, so a name reads as a
  different kind of thing from a caption.

Not right yet:

- The foot sections all share one ground (`inverse bg--canvas`), so the sign's
  own device, a change of ground, is unused. They are told apart only by a
  hairline.
- `.metro-terminus` is a `.metro-pill`, so a line name has the same 999px
  corner as a route bullet. The sign grammar wants a box for the name and
  the pill shape kept for bullets.
- Red and yellow are handed to rails by rung order on a BWRY panel. Nothing
  reserves red for the thing that interrupts, so an alert on a BWRY board is
  the same black as everything else while a rail is red.
- No board suite renders a BWRY panel or a 2-bit panel: `tools/sheet.js` and
  `test/layout/run.js` build 1-bit OG and 4-bit X only, and `screen--2bit`
  appears in exactly one case (`test/layout/cases/banner.js`). The palette
  code is therefore drawn by nobody.
- `.metro-cut` and the quiet-task treatment use `text-decoration` and
  `text--muted`, which at 1 bit is the framework's `text--default`. That is
  handled, but any new "quieter" state needs the same check rather than a
  grey.

## 7. What to change next, in order

1. **Give each foot section its own ground.** `solver/draw.js`, the `secs`
   loop that builds `metro-news--alert` / `--tasks` / `--news`: keep the
   alert section `inverse bg--canvas` (it is the interruption), and set the
   news section to paper with an ink hairline above it, so the two read as
   two statements the way the dark and red halves of the Green Line sign do.
   Keep the hairline; drop nothing else.
2. **Make the line name a box.** `solver/draw.js` where the terminus is
   built (`metro-terminus metro-pill label label--base text--bold`): swap
   `metro-pill` for the framework's `label--filled`, and in
   `plugin/src/shared.liquid` drop the pill's corner from `.metro-terminus`.
   Then rerun `test/boards/calibrate.js`, because the padding changes what a
   name measures.
3. **Reserve red on BWRY.** `solver/draw.js` `palette` handling: take red out
   of the rail ladder and give it to the alert row and to a clash mark, so
   the one colour that means "stop" is spent on stopping. Rails keep black,
   yellow and the textures.
4. **Render the panels nobody renders.** `tools/sheet.js` VIEWS and
   `test/layout/run.js`: add an `og-2bit` board and an `og-bwry` board
   (`screen--og screen--md screen--density-1x screen--color-4bwry`) so the
   palette branch and the two-grey branch are drawn by the suite.
5. **Say the depth rules in `rules.md`.** They live in code comments and in
   this file; the one place a future change will look is the rules. One
   short rule: what carries meaning at each depth, and that colour is never
   the only difference.
6. **Check the strip rail against the tape.** `solver/draw.js` strip
   drawing: on a BWRY panel the rail and its stations are the one place
   yellow is honest. Worth a render before it is worth an edit.
