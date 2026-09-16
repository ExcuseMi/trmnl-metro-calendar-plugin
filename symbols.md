# The board's symbols

Every mark the renderer can draw, what it means, and the name it carries in
the SVG. Written so a symbol never has to be redefined as a graphic: it is
already here, with the role the drawing stamps on it.

Each element gets `data-metro-role` (what it is) and usually
`data-metro-owner` (whose line it belongs to). That pair is how the test
suites find things, how `rule-check` reads a board, and how this document
stays honest: the roles below are the ones `solver/draw.js` actually emits.

Sizes are in panel units, which scale with `S`. The ones the rest of this
file refers to are `RAIL_W = 3S` (a rail's weight), `NODE_R = 6S` (a mark's
radius), `BAR_W = NODE_R * 1.3` (an interchange bar and the tube that
continues it, deliberately the same), and `LINE_GAP = 6S`.

## Rails

| role | what it is |
|---|---|
| `track` | a person's line, running the width of the board |
| `spur` | a branch off a line: a shelf, or a rail reaching an event |
| `away` | a stretch of a rail drawn quiet, at 42% ink, where that person is somewhere else and has nothing else in those hours. Never inside a corridor, which already says it |
| `guardrail` | the paper gap a rail leaves where another rail bridges it |
| `edge-clear` | paper pulled back over a rail's first stretch so an edge ring and its dots stand on paper rather than on the line |

### Line styles

A style belongs to a line, not to a moment: it is how you tell whose rail is
whose without reading a word. Set per person in the configuration; the
config tool offers the first four in order.

| style | drawn as |
|---|---|
| `solid` | plain ink at the rail's weight |
| `dashed` | a paper core 0.3 of the rail's width, butt ends |
| `dotted` | a paper core 0.67 wide, dashes `2.6S / 6.4S` |
| `dashdot` | a paper core 0.61 wide, round caps, `0.1S / 9S`, so it reads as dots |
| `ladder` | hollow with ink rungs, core 0.72, `5S / 1.8S`. Reserved for a shared calendar, never a person, so "Family" reads as the house's own line |

A line also carries a width and an ink shade, which is what separates two
people who happen to share a style.

## Marks on a line

Rules 28 to 30: a dot where something starts, a tick where it stops, a ring
where lines meet. A mark beside its rail is a mark about nothing.

| role | what it is |
|---|---|
| `stop-start` | a hollow dot: an event begins here |
| `stop` | a tick across the rail: an event ends here |
| `stop-core` | the paper inside a tick, so it reads on a heavy rail |
| `stop-from` | a half mark: this was already running when the board opened |
| `ring` | an interchange. Its line runs **through** it, from both sides |
| `ring-edge` | an interchange at the board's first minute, for an event already running. Its rail starts underneath it and runs away to the right, so nothing passes through it; the three dots beside it carry what came before |
| `ring-initial` | the line's first letter, set inside a ring |
| `merge` / `merge-from` | the diamond where rails join or leave a corridor |

## Ends of a line

| role | what it is |
|---|---|
| `terminal` | the slash that ends a rail |
| `terminal-core` | the paper inside that slash |
| `terminal-open` | a solid arrowhead: this line runs on past the paper. Its base sits on the rail's last point and its tip stands out as far as a slash reaches, so an arrow-ended line begins where its neighbours do |
| `terminal-more` | three dots: there was more before this, or there is more after it. At an edge ring they move to the ring's right, between it and the track |

An end carries one mark and one only. Where an edge ring stands, it is that
end's mark, and the arrow and the slash give way to it.

## Shared events

A shared event is its corridor, and nothing is drawn behind it.

| role | what it is |
|---|---|
| `capsule` | the tube an event is drawn as, at `BAR_W`, and the bar of an interchange: the same width and the same walls on purpose |
| `capsule-core` | the paper inside that tube |
| `portal` | a hairline across each mouth where the bar tunnels under a name or a busy rail |
| `origin-tie` | a dashed tie just outside the frame, joining the members of an all-day state named at one head (rule 56) |

## The board itself

| role | what it is |
|---|---|
| `river` | the black strip the hours are set in |
| `night` | the shaded stretch outside waking hours |
| `midnight` | the day boundary |
| `now` | the dotted line at the current minute |
| `state` | an all-day state drawn on the strip |
| `band` | a light rounded band along a rail for an ambient block, at 13% ink. Only for a timed state a person is simply inside, such as a desk booking. **Not** for a shared event |
| `strip-edge` | the strip's own boundary |
| `edge-drop` | the fade at the board's edge |

## Pointers

| role | what it is |
|---|---|
| `lead` | a leader from a caption to a mark on a rail |
| `leader` | a leader from a caption to a shared event's bar or tube |

A leader is a nicety and gives way: it is not drawn when it would be shorter
than the clearance it leaves, when it would travel far along the axis and
read as a rail, or when it would cross another caption.

## Words

Words are HTML, not SVG, so they take the framework's own type classes.

| class | what it is |
|---|---|
| `metro-terminus` | the line's name at the end of its rail. The legend is on the line, which is what a transit map does instead of a key in the corner |
| `metro-capmore` | `+N` after a name: how many of that line's stops the board could not name |
| `metro-route` | a note under a line's name, such as an all-day state it is in |
| `metro-bandname` | the name of an ambient block, set small where it begins |
| `metro-hour` | an hour label in the strip |
| `metro-daybadge` | the date |
| `metro-axis-note` | a note on the axis, such as how many events fell before the window |

## Reading a rendered board

`data-metro-debug` on `.metro-canvas` carries the board's own numbers and its
fault list. Read it rather than counting pixels. The panel's log says the
same thing: `metro: drawn in Nms (solve, draw), N name(s), N shed, N
mistakable`.

## Interrupted: what a cut-off thing looks like

The board shows a window onto a longer day, so almost anything on it can be
cut. These are the marks that say so, and they are worth listing together
because they are easy to confuse: three of them are about a line and one is
about an event.

| variant | mark | what it says |
|---|---|---|
| a rail runs on past the paper | `terminal-more`, three dots | the day goes on; there was more before this, or there is more after it |
| a rail's whole day is a slice of something longer | `terminal-open`, a solid arrowhead | this line does not begin or end here at all. Its base sits on the rail's last point and its tip stands out as far as a slash reaches |
| a rail simply ends | `terminal` plus `terminal-core` | a slash: this is where the line stops |
| an event was already running when the board opened | `stop-from`, a half mark | the event has no start on this paper |
| a shared event was already running | `ring-edge` with the dots beside it | they met before the paper began. The ring takes the rail's start, the dots stand to its right, the rail's ink begins after them |
| a shared event runs past the far edge | the tie's end is simply not drawn (`open1`) | nothing marks an end that is not there |

### Which of these can share an end

One end carries one mark. Where two would apply, the more specific wins and
the other is not drawn:

- `ring-edge` beats everything at that end. The slash and the arrow both give
  way to it, because either would be drawn inside the ring and through the
  line's own initial.
- `terminal-open` beats `terminal`. A line that never begins here does not
  also get a slash saying it does.
- `terminal-more` sits **beside** a slash rather than replacing it, except at
  an edge ring, where the dots move to the ring's other side.
- `stop-from` replaces the dot an event would otherwise start with, and a rail
  that has gone quiet takes no end tick for the event that quieted it.

### A branch takes the dots and nothing else

A branch has no *end* marks: no slash, because it does not end, it rejoins;
no arrowhead, because it is not a line whose whole day is a slice of
something longer. For a long time it had no dots either, which was the same
skip applied to all three, and it was wrong: the dots are not an end mark.
They say the paper ran out, which is a fact about the board and just as true
of a branch. Bart's rail said "there was more before this" with three dots
while his Field Trip, one row above and cut at the same minute, said it with
a half mark pressed against the edge.

A branch now takes the dots wherever the window clipped it, which is any end
sitting exactly on the axis. Its half mark stays: that stands in for the
slash, not for the dots.
