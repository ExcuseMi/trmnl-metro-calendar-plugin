# Keeping this plugin honest

How to improve the board without making it worse. Written after a long run of
doing exactly that, including the times it went wrong.

The board is a search: it decides where every name goes, and almost every
change here is a change to what the search prefers. That means a change is
never "better" on its own -- it is better on some boards and worse on others,
and the only way to know which way it nets out is to measure. Everything below
is about that.

## The one rule

**Measure before and after, on the same boards, and write the numbers down.**

A change that has not been measured is a guess, whatever it looks like in one
render. Three times in one session an obvious improvement measured worse and
was reverted: a binary search in the hottest function (11% slower), a memoised
box on the hot object (2% slower), and dropping a name's second row to save
space (three more people left off boards entirely).

## What to measure

Four numbers, from `node test/households/run.js` (216 boards, no browser):

| | what it means | worse means |
|---|---|---|
| `dropped` | a person's whole line left off the board | the most serious, a person disappears |
| `faults` | ink on ink: a rail through a name, two names on each other, two rings as one | a board that is wrong, not just full |
| `shed` | an event drawn but not named (the line's name carries "+1") | an event you have to guess at |
| `muddle` | a name a reader could attribute to the wrong stop or line | a name that lies |

Roughly in that order of badness. A trade is worth making when it moves an
earlier column down and a later one up, not the other way.

Then the suites, all of which must pass:

```
./test.sh                        # transform, config editor, boards, bundle freshness
node solver/cases.js             # the layout engine's own cases
cd test/layout && node run.js    # real Chromium, the framework's own faces
node test/sweep/run.js           # the example days, five times of day, six views
plugin/lint.sh
```

## Where to look for problems

**The device, not the corpus.** The households are six invented families; the
example days are what a reader with no calendars sees; your own board is
neither. A caption written straight across another one sat on the real board
for weeks while every fixture said the board was clean. `test/sweep/run.js`
exists because of that, and it is still not enough on its own: when the user
sends a screenshot, rebuild *that* payload and look at it.

**The logs on the panel.** Every render says `metro: start WxH` and
`metro: drawn in Nms (solve, draw), N name(s), N shed, N mistakable` in the
device's own log. That is how the double solve was found: the preview was
laying the board out twice and throwing the first one away.

**`data-metro-debug`** on `.metro-canvas` in any rendered page carries the same
numbers plus the fault list. Read it rather than counting pixels.

## Performance

The device's budget is five seconds for the transform and `solve_seconds`
(three, at the top of `plugin/src/shared.liquid`) for the page. The page's
search also has a work budget, `EVAL_POOL` in `solver/fit.js`, so on most
boards it stops because it has spent its evaluations, not its time.

- **Profile in the browser, not only in node.** The node harness measures
  captions with a table; the page measures them with the real DOM, so the two
  have different hot spots. A change that is 38% faster in node was 5-10% on
  the panel.
- **A/B interleaved, on an idle machine.** Run A, B, A, B, A, B and compare;
  a sequential A-then-B is a comparison of two different machine loads. Check
  `uptime` first. `bench.js` in the scratchpad does best-of-N over four boards.
- **Faster is only worth having if the boards are identical.** Diff the four
  household numbers. If they moved, it is not an optimisation, it is a change
  to the layout wearing one's clothes.
- Micro-optimisation in `solver/captions.js` is close to exhausted. The wins
  left are structural: fewer trials, or a cheaper cache key. Do not re-try the
  ones listed in the "measured and rejected" section below.

## Layout

- **Fix it upstream.** A two-row name that does not fit a shallow panel was
  patched three ways in the band search, each making something else worse; the
  fix was to not give the line a second row on that panel at all, so the search
  never sees the box. Ask where the bad shape is *created*.
- **Price, do not forbid.** Hard rules starve boards that have no alternative.
  A line's own branch through its own name was fixed by making it cost four
  mistakable captions, not by banning the branch.
- **The valuation is where the decisions really live.** Two people drawn as one
  line was counted as one lost caption, so a board over its own capacity always
  kept the extra person. Counting it as six changed that one board and nothing
  else.
- **A trade that costs a dropped line is almost never worth it.**

## Things that measured worse (do not redo without new evidence)

- Binary search plus a segment hint in `Line.cAt`: 11% slower, three rounds.
- Memoising a caption's box on the caption: 2% slower.
- Dropping a name's route row when it crosses a rail: three more dropped lines.
- Ordering two of one line's stacked captions by time: six more mistakable
  captions at every price tried.
- Clearing the stale `overBar` flag (which is a real bug): two more dropped
  lines. If it is ever fixed, the `OVER_BAR` price likely has to come down with
  it.

## Working notes

Keep a `track.md` (gitignored) while working: what was tried, the numbers, and
what was reverted and why. Most of this file came out of one.

## The device

`plugin/push.sh` deploys. Never `trmnlp pull` in the working tree. After a
push, the server's copy can be fetched with `trmnlp clone <dir> <id>` and
compared -- a clone taken seconds after a push can still show the old build.

**The renderer that draws the panel is not the preview and not your browser.**
It captures the page on its own clock. Delaying the first draw, or arming a
redraw a couple of seconds in, both looked right in headless Chromium and in
the preview, and the panel stopped drawing the board at all. Draw as soon as
the faces are ready.
