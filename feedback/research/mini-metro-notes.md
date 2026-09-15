# What to take from Mini Metro

Reference: `mini-metro.png`.

## The one big idea

**Every station is a paper-filled shape with a heavy outline, and importance
is carried by SIZE and SHAPE, never by fill or colour.** The white fill masks
the line running behind it, so a station reads the same whether it sits on a
thick line, a thin one, or a junction of three. Colour identifies the LINE;
it never identifies a station.

That is exactly the right division for a 1-bit panel, where colour does not
survive at all. Adopted: every stop marker is now hollow, filled with the
canvas colour. A solid dot in its own line's colour was the one thing that
could not be seen, because it was the same ink as the thing it sat on.

Our size ladder now mirrors theirs: small hollow ring = a stop the line calls
at, larger hollow ring = an interchange, concentric rings = the day's
landmark, hollow diamond = a station junction.

## Already shared

- Only 45° and 90° angles, with generous rounded corners. Never an arbitrary
  angle.
- Uniform stroke width along a line, round caps.
- A short perpendicular bar for a terminus.
- A soft, flat water shape behind everything, with no grid and no chrome. Our
  time river is the same device.
- Parallel lines held at a constant gap.

## Worth considering

- **Equal line weights.** Mini Metro gives every line the same thickness and
  lets colour separate them. We vary width (4 for the anchor line, 3 for the
  rest, thinner again past a full lap of dash patterns) AND dash pattern. On
  a greyscale panel the dash pattern is doing the real work, so the width
  variation may be buying noise rather than clarity.
- **Glyphs beside a station.** Mini Metro shows waiting passengers as small
  solid shapes floating next to a station — a compact way to annotate a stop
  without a text label. A possible answer to "which of the family is at this
  interchange" that costs less room than the dashed tie.

## Deliberately not taken

- **Colour as line identity.** Dead on a 1-bit panel. Dash pattern carries it
  here instead, which is why the patterns are assigned globally rather than
  per side.
- **Dashes as tunnels.** Mini Metro reserves a dashed segment for a line
  crossing water. We have spent dashes on line identity, which is the right
  trade for greyscale, but it does mean the two grammars disagree on that one
  mark.
