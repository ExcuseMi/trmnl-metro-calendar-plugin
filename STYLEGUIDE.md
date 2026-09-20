# Style guide

How this board should look, and why. `rules.md` says what the board draws;
this says how it is meant to read. Where the two disagree, `rules.md` wins
on behaviour and this wins on ink.

It is written from five photographs in `style/`, which is deliberately
untracked, so everything here describes what a picture shows rather than
pointing at a file nobody else has. They are named here so a later reader
knows what was being looked at:

- `sign.png` — a platform at 6th and Bronx: the overhead black sign band,
  an Exit sign in red, and the yellow tape along the platform edge.
- `sign2.png` — an overhead Exit sign: one bar in three butted sections,
  black arrow, red Exit, black bullets and destination.
- `sign3.png` — two OUTFRONT screens side by side: a live countdown board
  and a full system map. The closest thing in the set to what this plugin
  is, and the one worth arguing with.
- `entrance.png` — a street entrance: "Park Place Station" in white on
  black with two red bullets under it.
- `plan.png` — the system map itself, at the scale a person reads it.

An earlier version of this file was written from a description of similar
pictures rather than from pictures. It got the letter of several rules
right and the point of them wrong, which is worth remembering before
trusting anything here that does not name an image.

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

Every sign in the set is **sentence case, set bold**. "Uptown & The Bronx",
"To Pelham Bay Pk or Parkchester", "Port Authority Bus Terminal", "Park
Place Station", "Happening now". Not one of them shouts. Capitals appear
in exactly two places: on the word **Exit**, which is one syllable doing a
sign's whole job, and on route letters inside their bullets.

- **Sentence case, bold, for anything that is read.** Headlines, tasks, the
  weather sentence, captions, names. A row of capitals is a wall, and the
  photographs avoid it everywhere except on Exit.
- **One type per band.** A bar that mixes two sizes reads as two bars that
  failed to line up.
- **Weight carries emphasis inside a sentence, not size.** The platform
  sign sets "Uptown & The Bronx via Local" in one size and bolds only
  "Local". The board does the same in its weather line: the thing bold,
  the clock plain, the joining words quiet.
- **Sizes come from the framework's classes**, never a number in this
  repository, so `solver/measure-dom.js` measures the class the drawing
  will actually use.
- **Numbers are never quieter than the words they belong to**, and on a
  countdown board they are louder. See section 4.

## 4. What the countdown screen does

`sign3.png` is the one picture in the set that is doing this plugin's job,
so its row anatomy is worth copying almost literally. Each row is:

    (bullet)  Destination            NN
              sub-line              MIN

- a **filled roundel** with the route knocked out of it, leading the row;
- the **destination in bold**, the biggest words on the row;
- a **quieter, smaller sub-line** under it, naming the same thing more
  precisely ("Brooklyn Bridge" under "Downtown");
- the **number, large and ranged right**, with its unit set tiny beneath
  it, so the eye finds every row's number in one vertical sweep;
- rows divided by a **hairline**, on a ground that alternates faintly.

Three things follow for this board.

**The number is the point.** A person crossing the kitchen wants the time,
and on our board the time is currently the same size as everything else
around it. The screen makes it the largest thing in the row and ranges it
right so the column reads as a column.

**A section gets a name.** Below the departures the screen says "Happening
now" and then lists disruptions. It is a plain bold sentence-case label,
not a rule and not a coloured band. The foot of our board has three
sections and names none of them.

**The sub-line is a real device.** Two lines, same left edge, second one
smaller and quieter. `sign2.png` does it in three: "Port Authority / Bus
Terminal / 42 St-40 St".

## 5. Signage grammar

**A route is a filled bullet with the letter knocked out, and it is the
primary identifier.** This is the most consistent thing in the whole set.
The 6 on the platform sign, the 2 and 3 under "Park Place Station", the
grid of a dozen bullets on the Exit sign, the bullet on every row of the
countdown board, the bullets repeated along every line on the map. A route
is never named in words where a bullet will do, and the bullet is never
decoration: it is how you know which line you are being told about.

Our board announces a person's line with a rectangular name box instead,
and keeps roundels for interchanges only. That is backwards from every
photograph here.

**A bullet sits inside running text, not beside it.** The platform sign
reads "Late nights (4) to Woodlawn also stops here" with the bullet set
in the line like a word. They are sized to the type, not to the panel.

**A station name is a box, not a pill.** `entrance.png`: "Park Place
Station" is plain white type on a black rectangle. The pill shape is
reserved for route bullets, so using it for both makes a name and a route
read as the same kind of thing.

**A bar is one bar, and its sections are butted.** `sign2.png` is the
cleanest example in the set: black arrow, red Exit, black destination,
touching, no paper between them, no second frame. The change of ground IS
the divider. The foot of our board follows this now.

**Red is for the way out and for what has gone wrong.** Exit is red on
both signs. On the countdown screen the disruption notice is the only
thing that breaks the rhythm. Red is never spent on a route bullet that
happens to be red-coded in the real system, because on a four-colour panel
we have one red and only one thing worth stopping someone with.

**The platform edge is yellow, tactile and unbroken.** `sign.png` shows it
running the full length of the platform with a regular bumped texture. Two
lessons: the rhythm along it must be even, and on BWRY the strip rail is
the one place yellow is honest.

**The map tints its grounds.** `plan.png` uses pale fills for parks, water
and boroughs behind the lines. On one bit this is unavailable, but the X
has sixteen greys and currently spends almost none of them.

## 6. Layout

- **One margin, and it is the paper's.** The foot boxes run the full width
  and sit flush against the map.
- **A column ranges on one left edge**, and a column of numbers ranges on
  one right edge. The countdown screen does both at once.
- **A divider is a hairline in the ground's opposite colour**, at least 1.5
  CSS pixels, never a gap.
- **Two statements are separated by their ground, not by space.**
- **Nothing is centred that could be ranged left.** A sign centres a word
  only when the word is the whole sign.

## 7. What the board already does

Checked against the code, not remembered.

- `ONE_BIT` forces every rail solid and lets texture do the telling apart.
- The 4-bit tone ladder is mixed from the theme's ink and paper with
  `color-mix`, so it follows dark mode.
- BWRY is read from `screen--color-4bwry`, not from the depth field.
- The foot is one bar: sections butted, the alert on ink and the rest on
  paper, one glyph box, one type, one depth per row.
- A task's state is a shape, not a tone: an empty or ticked box.
- The line name is a filled box (`label--filled`), not a pill.
- Interchange rings carry initials, which is the bullet device in the one
  place the board already uses it.

## 8. What to change next, in order

1. **Give every line a bullet.** `solver/draw.js` where the terminus name
   is built: a filled roundel carrying the person's initial, leading the
   name box, the same mark the interchange rings already draw. This is the
   single most consistent thing in the photographs and the board does not
   do it.
2. **Make the next thing a big number.** The countdown screen's row: the
   time ranged right and set large, its unit tiny beneath it. Today the
   time is the same size as the words beside it.
3. **Name the foot's sections.** A plain bold sentence-case label, the way
   the screen says "Happening now". Sentence case, not capitals.
4. **A quiet sub-line under a caption** where there is room, for the place
   a thing is happening.
5. **Spend the X's greys.** A faint ground for the evening, or behind
   alternate rows, the way the map tints its boroughs and the countdown
   screen alternates its rows.
6. **Reserve red, and lay yellow tape.** On BWRY take red out of the rail
   ladder and give it to the alert; give the strip rail the yellow.
7. **Render the panels nobody renders.** `tools/sheet.js` and
   `test/layout/run.js` build 1-bit OG and 4-bit X only, so the palette
   branch and the two-grey branch are drawn by nobody.
