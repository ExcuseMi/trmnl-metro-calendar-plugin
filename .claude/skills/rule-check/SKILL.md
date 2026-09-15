---
name: rule-check
description: Read a rendered board and report which rules in rules.md it breaks. Use when a screenshot of the metro calendar needs judging, when the user sends a crop and asks what is wrong with it, or after a layout change to check the picture rather than only the suite. Takes a PNG path, or renders one first.
---

# Rule check

Judge a picture of the board against `rules.md`. The layout suite proves a
drawing is well formed; this proves it is *right*, which is a different
question and the one that has cost this project the most time.

## 1. Get a picture

If the user gave a PNG path, use it. If they gave a crop with no path, ask
for the full-size render too: a crop hides the thing a rule is about (a
line's own lane, its name, what it crosses on the way).

Otherwise render one. The scratchpad keeps `shot.sh` (screenshot at a real
device size) and `swap.js` / `swapjson.js` (put a fixture or a raw METRO
payload into `plugin/_build/full.html`). If they are not there, rebuild them
from `test/layout/run.js`'s `pageFor`, and read `AGENTS.md` first: a layout
run and a screenshot must not build at the same time.

```bash
cd plugin && trmnlp build            # only when src changed
node "$S/swap.js" five-lines         # or: node "$S/swapjson.js" board.json
"$S/shot.sh" "$S/out.png" "screen--v2 screen--lg screen--4bit screen--density-2x" 1872 1404
```

The classes matter. TRMNL X landscape is
`screen--v2 screen--lg screen--4bit screen--density-2x` at 1872x1404; OG is
`screen--og screen--md screen--1bit screen--density-1x` at 800x480. Getting
them wrong renders one panel's board at another panel's size and every
conclusion drawn from it is worthless.

## 2. Send it to an agent

Spawn ONE agent with the Agent tool. It must read the image itself, so pass
the absolute path and tell it to use Read on that path. Give it, verbatim:

- the absolute path of the PNG (and of the full-board PNG if the first is a
  crop),
- the instruction to read `rules.md` in full before looking at the picture,
- the instruction to read the "Rules that are stated but not kept" section
  at the end of `rules.md`, so it does not spend its report on the gaps that
  are already written down,
- what changed, if this is a check after an edit, and which part of the
  board to look hardest at.

Ask it to report, per finding:

- **the rule number and its text**, quoted,
- **where on the board**, in the picture's own terms ("the dotted line
  between 7pm and 8pm", not a pixel coordinate),
- **what it sees** that breaks the rule, in one sentence,
- **how sure it is**: certain, or worth a second look.

And to report rules it checked and found kept only as a one-line list at the
end, not as findings.

## 3. Show the user the picture

Send it with `SendUserFile` before you say anything about it. The whole
point of this skill is that a drawing has to be looked at, and that goes
for the user too: a description of a board is not a board.

## 4. Judge the report

The agent is reading a picture and will be wrong sometimes. Before repeating
anything to the user or acting on it:

- Check each finding against the drawing yourself. A rule that is kept and
  reported broken costs more than one missed.
- Drop anything already in the "stated but not kept" section.
- Anything the agent is unsure about, verify from the DOM rather than the
  pixels: `chrome --headless=new --dump-dom` on the shot HTML gives
  `data-metro-debug` (the route holds, the bands, every event's placement)
  and the `data-metro-role` attributes, which settle most of it exactly.

Then tell the user what actually breaks, most serious first, and say plainly
which findings you could not confirm.

## Notes

- `rules.md` is the authority, not `DESIGN.md`, and not this file.
- A rule broken in one place is a bug; the same rule broken everywhere is
  usually the rule being wrong. Say which one you think it is.
- Never report a finding the picture cannot show. "The caption is on the
  wrong side" is visible; "the wrong algorithm chose it" is not.
