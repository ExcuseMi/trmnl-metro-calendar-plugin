# Calendar Config reference

The **Calendars** field takes a JSON object with this shape. The
[configuration editor](https://excusemi.github.io/trmnl-metro-calendar-plugin/tools/config-editor.html)
lists anything in a pasted configuration that nothing reads, such as a
misspelt key or a line a rule names that is not in `lines`.

```
{
  "version": 1,                    // the format this is written in
  "docs"?: "https://raw.githubusercontent.com/ExcuseMi/trmnl-metro-calendar-plugin/main/CONFIG.md",   // this page, so the JSON explains itself
  "timeFormat"?: "auto" | "12h" | "24h",   // the clock (default: "auto", which follows the locale)
  "temperatureUnit"?: "auto" | "c" | "f",  // (default: "auto", which follows the locale)
  "timeZone"?: string,             // overrides the TRMNL account zone; set only if that is wrong
  "locale"?: string,               // overrides the account language: "en", "fr", "es", "de", "nl", "en-US"
  "lines"?: Line[],
  "rules"?: Rule[],                // applied to every calendar, before the calendar's own rules
  "calendars": Calendar[]
}
```

`docs` links to this page. It does nothing on the board; it is there so
anyone, or any AI assistant, handed only the JSON can find out what it
means before changing it.

`version` says which format a configuration is written in. If the format
ever changes, the plugin reads the older one for you, so a configuration
never has to be edited because of an update.

## Line

```
{ "name": "Alex", "hideWhenEmpty"?: true }
```

- Each line is one line on the map, drawn every day, quiet or not.
  `hideWhenEmpty` leaves it off on a day it has nothing on it.
- Lines run in the order listed, unless another order puts fewer lines
  between people who share an event. Sides, shades and textures are the
  board's choice.

A line a rule names that is not in `lines` is added, drawn as a ladder, a
style no person gets. Usually that is a typo.

## Calendar

```
{
  "url": "https://…/calendar.ics",       // or webcal://
  "line"?: string | string[],            // whose calendar this is
  "name"?: "Work",                       // a label, used when the feed stops answering
  "rules"?: Rule[],
  "headers"?: { "Authorization": "…" },  // sent with the feed request
  "includeDescription"?: true,           // let rules also match DESCRIPTION (a rule naming the description turns it on by itself)
  "keepLine"?: true,                     // keep its line when the feed is empty or unreachable
  "holiday"?: true,                      // everything in this feed belongs to the DAY, not to a line (see Public holidays)
  "ignoreTimezone"?: true,               // read every time in the feed as local wall-clock time, even one marked UTC
  "mergeSameTime"?: true                 // things at the same minute on the same line are one stop
}
```

**Whose it is: `line`.** Anything in the calendar that no rule routes goes on
that line, or on each of a list of lines for a feed some of the household
shares. A calendar with no `line` is the whole household's: what no rule
routes goes on every line.

**`name` is a label.** It names the feed on the board when the feed stops
answering. It is a line only on a board with no `lines` at all, where each
calendar becomes a line named after it.

Tasks (VTODO) are read too: each is a moment at its `DUE` time (or its
`DTSTART` if it has no due time); a task marked completed or cancelled is
left off. A task is drawn as a square stop. A bin-day feed exported as
tasks is the case this is for: set `ignoreTimezone` when the generator
writes the time you chose as UTC, and `mergeSameTime` so the bins due on one
evening are one stop, captioned as a list of names (two to a row, or the
first name and a count such as "Restafval +3", where room is short).

## Rule

```
{
  "match": Matcher,
  "line"?: string | string[],     // put the event on this line; several = a shared event
  "rewrite"?: string,             // replace the matched text ("" cuts it out)
  "title"?: string,               // replace the whole title
  "hide"?: true,
  "allDay"?: true,                // draw it at the line's head, not at a time, whatever the ICS says
  "holiday"?: true                // a state, not an appointment: the day's if no `line`, that line's head if there is one
}
```

A rule that names a line only routes the event; the title stays as it is.

### Long blocks look after themselves

There is nothing to write for a status block that spans real meetings
without being one itself: a desk booking, an "In the office" block, a
shift. **One person's timed event of seven hours or more is drawn as a
light band behind their line** for its hours, named once along it. Meetings
inside it still branch off the line as usual.

A shared event is a bar across its people's lines. Two people at something
three hours or longer (two children at one school) run their lines together
for it instead.

Rules run in order, global ones first; for each effect the last matching
rule wins, so a calendar's own rule overrides a global one. Rewrites are
the exception: every matching `rewrite` cuts in turn, so one rule for
"RE:" and another for a ticket code both apply.

A timed event that lasts a day or more (a week at the other parent's, a
conference written with times) is shown like a multi-day all-day entry, at
the head of its line with the day of it this is. One that began the evening
before and is still running, like a night shift, is on the morning board
from midnight with its real start time.

### Public holidays

A subscribed holiday feed ("Holidays in Belgium", Apple's equivalent, a
school's term dates) is not a person and has no line. Everything in it is a
property of **the day**: it has no hour, so there is nowhere on a scale of
hours to draw it, and no owner, so there is no head to declare it at.

Say so once, on the calendar:

```json
{ "url": "https://calendar.google.com/…/holidays.ics", "holiday": true }
```

Google's are `https://calendar.google.com/calendar/ical/<lang>.<region>%23holiday%40group.v.calendar.google.com/public/basic.ics`,
with Google's own region name: `nl.be` is Belgium in Dutch (`belgian` is an
error page, read as `be`), `fr.french` France in French.

The day's names then read in the header, beside the date: `Today · Fri 25
Dec · Christmas Day`. Nothing is drawn on the map, no line is created, and
on a day with no holiday it takes no room at all.

**Leave the `name` off.** With `holiday` set nothing in the feed becomes a
line, so there is nothing for a name to do.

For a feed that carries both kinds, say it per event instead:

```json
{ "match": { "type": "exact", "value": "Public holiday", "field": "categories" }, "holiday": true }
```

#### Whose day does it change?

`holiday` does not mean "put it in the header". It means this is a **state**
rather than an appointment. Where it is drawn follows from whether anybody
owns it, and the rule that routes it is what says:

```json
{ "match": { "type": "contains", "value": "Half Term" },
  "holiday": true, "line": ["Bart", "Lisa"] }
```

Christmas Day is nobody's, so it belongs to the day and reads in the header.
Half term is precisely the children's and precisely **not** the parent who
still goes to work, so it reads at their heads, exactly as one person's
leave does, named once with the dashed tie between them. Both arrive through
the same subscription; a school feed can route its term dates to the
children and its INSET days to nobody.

Only a rule's own `line` counts. A feed nobody has routed has not told the
board whose day it changes, so it is the day's: that is what stops a
national calendar landing on whoever happens to be first in `lines`.

Details worth knowing:

- **A range says which day of it this is.** "Spring Break" running from the
  5th to the 9th reads as `Spring Break · Day 3 of 5` on the Wednesday.
  The board draws one day, and which day of the holiday that is is the only
  thing telling the Monday from the Thursday. A one-day holiday says just
  its name.
- **The day gets one name.** Two feeds that both fire on the same day
  (a national calendar and a school one) are read, deduplicated and then
  cut to the first: the header is a single row that already carries a date
  and a forecast, and two names on it cut each other short. List the feed
  whose names you want first.
- **A holiday is not the same thing as an all-day event.** One person's
  leave IS a state of their line, and it stays where it was: declared at
  that line's head, with both ends of the line drawn as open chevrons.
  `holiday` on its own is for the days nobody owns; `holiday` with a `line`
  puts a state at that line's head, which is the same drawing an all-day
  event gets. A rule that sets both `allDay` and `holiday` is read as a
  holiday, because that is the more specific claim about the same event.
- **It rides with the date.** A panel too small to carry a header has
  already given up saying which day it is, and the holiday goes with it
  rather than being moved somewhere the map has to pay for.

Recurrence: a holiday written once with `FREQ=YEARLY` shows every year, and
a moving one (`FREQ=YEARLY;BYMONTH=11;BYDAY=4TH`, the American
Thanksgiving) lands on the right date.

## Matcher

```
{ "type": "word",     "value": "L2" }        // whole word, case-insensitive
{ "type": "contains", "value": "staff" }
{ "type": "exact",    "value": "Standup" }
{ "type": "regex",    "value": "^Piano" }    // double every backslash in JSON
{ "type": "status",   "value": "tentative" } // confirmed | tentative | cancelled
{ "type": "weekday",  "value": ["MO", "WE"] }
{ "type": "duration", "min": 240, "max": 600 }   // minutes; either bound alone is fine
{ "type": "time",     "from": "07:00", "to": "09:00" } // when it STARTS
{ "type": "any" }
{ "type": "and" | "or", "matchers": [Matcher, …] }
{ "type": "not", "matcher": Matcher }
```

### `field`: which part of the event the words are looked for in

The four text matchers (`word`, `contains`, `exact`, `regex`) take an
optional `field`:

| `field` | reads |
| --- | --- |
| *(omitted)* | the title, plus the description when the calendar has one |
| `"title"` | the title only |
| `"location"` | LOCATION |
| `"description"` | DESCRIPTION |
| `"categories"` | CATEGORIES, each category as a whole value |
| `"any"` | all of the above |

Omitting it is what a matcher has always meant, so nothing you already
have changes. Name one when the title is not where the answer is:

```json
{ "match": { "type": "contains", "value": "Elementary", "field": "location" },
  "line": "Kids" }
```

That routes on the *place*, which is the case a school or an office feed
usually is: every title is a code or a room number, and the only thing
that reliably says whose day it is sits in LOCATION.

Two details worth knowing. `exact` anchors to whatever it is handed, so
against `categories` it matches one whole category out of a list rather
than the whole list. And naming `description` or `any` switches
`includeDescription` on for that calendar by itself: a rule that reads the
notes should not also have to remember a separate switch. A `field` the
plugin does not recognise is ignored, and the matcher falls back to the
default.

### `duration` and `time`: the shape of the day, not its words

`duration` is in minutes and takes `min` (inclusive), `max` (inclusive) or
both. It only ever matches an event with both a start and an end.

```json
{ "match": { "type": "duration", "min": 240 }, "hide": true }
```

That hides every block of four hours or more, however the household spells
it this week, without listing "In the office", "WFH", "Desk booking" and
whatever gets invented next.

`time` asks when an event STARTS, as "HH:MM" on its own day. `from` is
inclusive and `to` is exclusive, so `07:00`-`09:00` and `09:00`-`12:00`
tile without both claiming nine o'clock. Either bound alone is fine.

Neither matcher takes a `value` or a `field`, and one with no bounds at all
is dropped rather than treated as "everything", so a half-filled rule does
nothing instead of quietly moving the whole board onto one line.

Combine `and`/`or`/`not` to express "one of these, but not that one" without
ever touching a regex. For example, hide every class code except two of your own:

```json
{
  "match": {
    "type": "and",
    "matchers": [
      { "type": "or", "matchers": [
        { "type": "word", "value": "L1" }, { "type": "word", "value": "L3" }
      ] },
      { "type": "not", "matcher": { "type": "word", "value": "L2" } }
    ]
  },
  "hide": true
}
```

A regex negative lookahead can express the same thing more compactly, but
needs every backslash doubled in JSON (`\\b`), an easy way to end up with a
rule that silently matches nothing if something along the way (a paste, a
rich-text field) re-escapes it again. Prefer `not` unless you need a real
regex feature `and`/`or`/`not` can't express.

## Example

[demo-config.json](demo-config.json) is a complete working example with a
work calendar, per-line calendars, a school calendar split by class code,
and a shared family calendar.

The [configuration editor](https://excusemi.github.io/trmnl-metro-calendar-plugin/tools/config-editor.html)
carries three more, in
the **Examples** section, one button each, for when you have no ICS links
yet:

- **Family of 4**: one calendar per person plus a shared household feed and
  the school's. Dinner and the school run are `line` lists, so they are drawn
  once across everyone on them rather than once per person; the school feed's menu
  postings are hidden, and the quiet toddler's feed keeps its line with `keepLine`.
- **Parent on Shifts**: a hospital rota beside the other parent's week and a
  child's clubs, with a top-level rule that hides cancelled events in every
  calendar.
- **One Shared Calendar**: the whole family in one feed, each title starting
  with a name. Rules route on that prefix and a `rewrite` strips it, so the
  board reads "Ballet" and not "Ella: Ballet".

Every example has events today and tomorrow, since the board reaches into
tomorrow as the day runs out. Each loads into the editor exactly as an import does, with placeholder
`calendar.example.com` links to swap for your own.
