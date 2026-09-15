# Demo boards

Three example days, each a real configuration driven by real ICS files in
this folder. **Example Day** in the plugin's settings picks which one the
board shows, and each `config.json` is a worked example you can copy and
point at your own calendars.

They are deliberately different shapes, because the map is:

| Board | Who | What it shows |
| --- | --- | --- |
| [`simpsons/`](simpsons/) | A family of five | One calendar per person, plus a school feed split by class code and a shared family calendar. Bart and Lisa share a School Day corridor; the whole family meets at dinner. |
| [`futurama/`](futurama/) | A work crew of five | **One** team calendar with everything in it, split onto lines by a `Name:` prefix. Fry, Leela and Bender spend the day on the same delivery: one bar across three lines, ticked where it ends. |
| [`friends/`](friends/) | Two flatmates | The smallest board worth drawing. Each has a long block in one place, drawn as a light band behind their own line, and an evening they are both at. |

The ICS files are plain `RRULE:FREQ=WEEKLY` entries so the same day renders
whenever you look at it. `config.json` beside them IS the board: the plugin
fetches it from raw.githubusercontent at run time, the same way it fetches
the calendars it names, so editing this file changes the demo for every
device showing it and there is nothing to regenerate.

`test/transform/cases/demo-config.js` fails if a config names a file that is
not here, if one stops parsing, or if a board stops resolving to the people
it is supposed to.
