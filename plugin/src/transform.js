// metro-plugin/src/transform.js — TRMNL Serverless entry point.
//
// Two data sources, chosen by the "Use Demo Data" boolean setting:
//   - demo (default): the same hardcoded dummy events this plugin has
//     always shown — no network, no config needed, safe fallback.
//   - config: a real calendar config pasted into the "Calendar Config"
//     setting, same JSON shape as this repo's calendar-config.json /
//     demo-config.json ({ calendars: [{url,name,rules}], lines, timeZone,
//     rules }). Calendars are fetched as plain ICS and parsed with a small
//     hand-rolled parser (TRMNL Serverless only guarantees the built-in
//     HTTP client, not an ICS library — see topics/serverless.md).
//
// The config parser/rule engine (parseConfig/compileMatcher/
// applyCalendarRules below) is ported from plugin/src/transform.js's own
// — same config shape, same semantics, minus the multi-day windows that
// plugin's flat agenda list needs and this single-day map doesn't. The
// saved-state pieces (last good weather, calendar-down alerts, remembered
// X-WR-CALNAME) came across too and live under "Deadline and saved
// state" below. It
// supports: string-shorthand calendars (`"https://.../a.ics"` as well as
// `{url:...}`), non-JSON config text falling back to a newline-separated
// URL list, per-calendar `headers` (sent alongside the default
// User-Agent), match types any/all/exact/word/contains/regex/status/
// weekday/and/or/not, `rewrite` and `title`, a top-level `rules` array
// applied before each calendar's own (a calendar's own rule wins when both
// assign a line to the same event), a calendar's own `line` for what no rule
// routes, a `line` that can be a list (several lines on one event are a
// shared event), and a household fallback -- EVERY entry in `lines[]` --
// for a calendar that says nothing about whose it is. The format is written
// down once, at migrateConfig.
//
// Which side of the map a line runs on and its colour are the board's to
// choose (solver/order.js). `locale` in the config overrides the account
// locale for the string table and date names.
//
// Known, deliberate limitations of the config path (documented rather
// than silently wrong):
//   - RRULE: DAILY, WEEKLY, MONTHLY and YEARLY with INTERVAL, UNTIL,
//     COUNT, BYDAY (ordinals too), BYMONTHDAY, BYMONTH, BYSETPOS and
//     WKST (see rruleFiresOn). Rules picking by week number or day of the
//     year, or firing several times a day, show on their first date only.
//     RECURRENCE-ID overrides and EXDATE are honoured.
//   - No all-day lane — all-day events are skipped (this UI has no place
//     to put them yet).
//   - A rule's `desc` match only sees an event's DESCRIPTION when that
//     calendar opts in via `includeDescription: true` — off by default
//     since most calendars don't need it parsed/matched against.
//   - Weather needs a `lat_lon` setting; without one a real board shows
//     no forecast at all rather than a made-up one. The DEMO boards are
//     the exception: they carry built-in weather (DEMO_WEATHER) so the
//     sky band can be seen without a location.
//   - Translations are downloaded (i18n/<code>.json in this repo);
//     English is inline and is what a device that cannot reach GitHub
//     reads.
//
// Both branches converge on the SAME buildMetro() — the rest of the
// pipeline (hour ticks, sub-spur detection, the "now" marker, lines
// list) doesn't care whether events came from DUMMY_EVENTS or real ICS.

// Six, not seven: an eight o'clock shelf against the left edge had its
// name over the line's -- "timeline should start at 6am to leave more space."
var DAY_START_MIN = 6 * 60;
var DAY_END_MIN = 21 * 60;
// AND THE ROOM IN FRONT OF THE FIRST EVENT IS THE POINT, not the hour the
// board happens to open at. Six on its own bought nothing: a rolling board
// works its own opening out and never reads this at all, and where it was
// read it was read as "an hour before six" rather than as room for anything,
// so an eight o'clock event still had exactly one hour of board in front of
// it. The line names are drawn INSIDE the map at the leading edge (rule 33e),
// and one hour is about one name wide, so the first shelf of the day is drawn
// in the legend: "Shift Handover shelf should not cross the track label.
// Also, there should be more time allocated before the actual events start."
var LEAD_MIN = 2 * 60;
// Line styles and stroke weights used to be handed out here. They are
// drawing decisions, so they live in shared.liquid now (`TRACK_STYLES`);
// this file says only which line is the anchor.

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

function timeLabel(min) {
  var h = Math.floor(min / 60) % 24;
  var m = min % 60;
  return pad2(h) + ':' + pad2(m);
}

// ---------------------------------------------------------------------
// i18n. Every user-facing string the plugin renders. ENGLISH IS INLINE
// and is the only table shipped in this file: it is the fallback for a
// device that cannot reach GitHub, and it is the key set every other
// language is checked against. Every other language lives in this repo's
// i18n/<code>.json and is fetched at render time (loadStrings below), so
// a new language is a pull request against a JSON file rather than an
// edit to the serverless entry point nobody outside this repo can make.
// Weekday and month names still come from Intl with the full locale, so
// they cover any language Intl knows whether or not it has a file here.
// ---------------------------------------------------------------------
var I18N = {
  en: { today: 'Today', tomorrow: 'Tomorrow', now: 'Now', next: 'Next', more: '+{n} more', earlier: '+{n} earlier', rain_pct: '{n}% rain',
        // The badge on a now/next row when the whole household is in it: one
        // word instead of a badge each, which for a family of five says the
        // same thing five times and crowds out the event.
        everyone: 'All',
        clear: 'Clear', partly_cloudy: 'Partly cloudy', cloudy: 'Cloudy', foggy: 'Foggy', rain: 'Rain', snow: 'Snow', storms: 'Storms', ice: 'Freezing rain',
        rain_starts: 'Rain starts', rain_stops: 'Rain stops',
        feed_down: '{n} unavailable', weather_stale: 'Forecast may be out of date',
        // When the board has nothing to draw, it says why (see boardNotice).
        notice_config_invalid: 'The Configuration setting could not be read. Copy it again from the setup helper.',
        notice_list_invalid: 'The Calendars setting could not be read. One calendar per row: a name, then its link.',
        notice_feeds_failed: 'None of the calendars could be read: {n}',
        notice_nothing: 'Nothing on the calendars today or tomorrow.',
        notice_demo_failed: 'The example day could not be loaded. Add your calendars in the plugin settings.',
        notice_error: 'The calendars could not be drawn this time. It tries again at the next refresh.',
        // A day with nothing timed on it, said the way a child would want to
        // hear it, in the middle of the empty map (draw.js).
        quiet_day: 'Nothing planned. Free day!',
        // THE NAMES OF THE DAYS AND THE MONTHS, in the table rather than from
        // Intl: the serverless runtime may carry English locale data only,
        // and a Dutch board then read "Sat 19 Sep" under "Vandaag". Sunday is
        // 0, as JavaScript counts; months from 1.
        wd_0: 'Sun', wdl_0: 'Sunday', wd_1: 'Mon', wdl_1: 'Monday', wd_2: 'Tue', wdl_2: 'Tuesday', wd_3: 'Wed', wdl_3: 'Wednesday', wd_4: 'Thu', wdl_4: 'Thursday', wd_5: 'Fri', wdl_5: 'Friday', wd_6: 'Sat', wdl_6: 'Saturday', mo_1: 'Jan', mo_2: 'Feb', mo_3: 'Mar', mo_4: 'Apr', mo_5: 'May', mo_6: 'Jun', mo_7: 'Jul', mo_8: 'Aug', mo_9: 'Sep', mo_10: 'Oct', mo_11: 'Nov', mo_12: 'Dec',
        // "Day 3 of 5". A week-long half term is a different fact on the
        // Monday than on the Thursday, and the one day the board draws is
        // somewhere inside it. Both numbers are named, because a language
        // may want them in the other order.
        holiday_day: 'Day {n} of {m}',
        // The weather banner: "Weather: Rain from 14:00 until 17:00, 80%
        // chance". The label is its own string because the template sets
        // it apart from the message. The message is a FRAME per shape of
        // "when" with the condition dropped into it: the prepositions live
        // in the frame ("von ... bis" in German, "de ... à" in French), so
        // each language words the whole sentence, and three conditions do
        // not have to be multiplied by five frames in every file.
        // New key names rather than the old ones reworded: a device caches
        // the last table it downloaded, and "Heavy Rain Expected at {t}"
        // dropped into a frame as {what} would be nonsense until it expired.
        alert_title: 'Weather',
        alert_kind_rain: 'Rain',
        alert_kind_snow: 'Snow',
        alert_kind_storms: 'Thunderstorms',
        alert_kind_ice: 'Freezing rain',
        alert_from_until: '{what} from {t} until {u} ({p}%)',
        alert_until: '{what} until {u} ({p}%)',
        // {u} is the until of these two, the way it is a clock in the other
        // three: a language says where an open-ended spell runs to in its own
        // words, and those words are read for the same reason a clock is, so
        // they are lit the same. Held in their own key rather than written
        // into the sentence -- a device still on an older table has the older
        // sentence, which says the same thing with the phrase inside it and
        // simply goes unlit.
        alert_from_on: '{what} from {t} {u} ({p}%)',
        alert_rest_of_day: '{what} {u} ({p}%)',
        alert_night: 'into the night',
        alert_all_day: 'for the rest of the day',
        alert_around: '{what} around {t} ({p}%)',
        alert_hot: 'Hot, up to {v}°{u}',
        alert_chilly: 'Cold, down to {v}°{u}',
        alert_freezing: 'Freezing, down to {v}°{u}' },
};

// Where the translated tables live, and how long a fetched one is trusted
// before it is asked for again. Re-fetching every render would spend a
// slice of the same deadline the calendars need on a file that changes a
// few times a year; a cached table is reused until it is this old, and a
// failed fetch falls back to the cache whatever its age.
var I18N_BASE = 'https://raw.githubusercontent.com/ExcuseMi/trmnl-metro-calendar-plugin/main/i18n/';
var I18N_TTL_S = 6 * 3600;
// ...but a table missing a key the built-in English has is from before that
// key existed, and is asked again after this long rather than after the TTL:
// "Nothing planned. Free day!" stood in English under "Vandaag" for hours.
var I18N_STALE_KEYS_S = 30 * 60;
var I18N_FETCH_MS = 1500;

// The account locale ("nl", "fr-BE", "en-US", ...): the full tag drives
// Intl (dates, 12h/24h default); the two-letter language picks the string
// table.
function userLocale(input) {
  try {
    var l = input.trmnl.user.locale;
    return (typeof l === 'string' && l.trim()) ? l.trim().replace('_', '-') : 'en';
  } catch (e) {
    return 'en';
  }
}

function langOf(locale) {
  return String(locale || 'en').slice(0, 2).toLowerCase();
}

// A downloaded table is data from the open internet, not code: only the
// keys English already has are taken, only strings, and only short ones.
// Anything else would be carried into trmnl_state and replayed on every
// later render, including whatever a malformed pull request put there.
function sanitizeStrings(raw) {
  var out = {};
  if (!raw || typeof raw !== 'object') return out;
  Object.keys(I18N.en).forEach(function (k) {
    var v = raw[k];
    if (typeof v === 'string' && v.trim() && v.length <= 120) out[k] = v.trim();
  });
  return out;
}

// A partially translated file is still worth having: the keys it does
// carry are used and the rest read in English, rather than the whole
// language falling back because someone added a string last week.
function mergeStrings(fetched) {
  return Object.assign({}, I18N.en, sanitizeStrings(fetched));
}

// Fetching a language must never delay or break a render: it is budgeted
// against the same deadline the calendars are, a failure falls back to
// the last table this device saw (kept in trmnl_state) and then to
// English, and nothing about it is surfaced to the reader: a board in
// English is a board.
async function loadStrings(locale, state, deadline) {
  var lang = langOf(locale);
  if (lang === 'en') return I18N.en;
  var cached = (state && state.i18n && state.i18n.lang === lang && state.i18n.strings) ? state.i18n : null;
  var nowS = Math.floor(Date.now() / 1000);
  var age = nowS - ((cached && cached.fetchedAt) || 0);
  var lacks = cached && Object.keys(I18N.en).some(function (k) { return !(k in cached.strings); });
  if (cached && age < I18N_TTL_S && !(lacks && age >= I18N_STALE_KEYS_S)) return mergeStrings(cached.strings);
  var budget = Math.min(msUntil(deadline), I18N_FETCH_MS);
  if (budget > 0) {
    try {
      var resp = await fetchWithTimeout(I18N_BASE + lang + '.json', budget);
      if (resp && resp.ok) {
        var body = await resp.json();
        var clean = sanitizeStrings(body);
        if (Object.keys(clean).length) {
          if (state) state.i18n = { lang: lang, strings: clean, fetchedAt: nowS };
          return mergeStrings(clean);
        }
      }
    } catch (e) {
      // offline, GitHub down, or a language nobody has translated yet
      warn('the ' + lang + ' language file could not be fetched: '
        + (e && e.message ? e.message : e));
    }
  }
  if (!cached) warn('no ' + lang + ' language file and nothing remembered; the board reads in English');
  return cached ? mergeStrings(cached.strings) : I18N.en;
}

function tr(strings, key, n) {
  var v = strings[key] || I18N.en[key] || key;
  return n == null ? v : v.replace('{n}', String(n));
}

// tr() substitutes the single count every other string carries. An alert
// line carries a time, a percentage or a temperature, and each language
// puts them in its own order, so those are named and the translated
// string decides where they land. An unknown placeholder is left standing
// rather than blanked: "at {t}" on the board says a translation is wrong,
// where "at " says nothing at all.
function fmt(str, vars) {
  return String(str).replace(/\{(\w+)\}/g, function (m, k) {
    return (vars && Object.prototype.hasOwnProperty.call(vars, k)) ? String(vars[k]) : m;
  });
}

// THE SAME SENTENCE, IN PIECES, SO THE BANNER CAN SET THEM DIFFERENTLY.
//
// "Rain from 16:00 until 20:00, 96% chance" is one line of words doing three
// jobs: what is coming, when, and how sure. At one weight the reader has to
// read all of it to find the part they wanted. The board already does this to
// its captions -- the name black, the clock grey.
//
// The split is made HERE, where the placeholders are, and not by looking for
// digits in the finished string: `{t}` is a time in one sentence and `{u}` is
// a time in that one and a UNIT in the temperature ones, and the order of the
// pieces is the translator's, not this file's. Each caller says which of its
// own placeholders are which, and the literal text between them is whatever
// the language put there.
//
//   s: 'b' the thing itself, in bold -- Rain, Snow, -6°C
//      ''  what a reader is scanning for: the clock
//      'q' everything holding the sentence together, quiet -- "from", "until",
//          "chance", and the probability, which is a qualifier and not the news
//
// `styles._` is what the literal words between the placeholders take, so a
// caller can make the sentence quiet and light up only the parts that answer
// something.
function segments(str, vars, styles) {
  var out = [], last = 0, re = /\{(\w+)\}/g, m;
  var dflt = (styles && styles._) || '';
  function lit(t) { return { t: t, s: dflt, lit: true }; }
  while ((m = re.exec(String(str))) !== null) {
    if (m.index > last) out.push(lit(String(str).slice(last, m.index)));
    var k = m[1], has = vars && Object.prototype.hasOwnProperty.call(vars, k);
    out.push({ t: has ? String(vars[k]) : m[0], s: (styles && styles[k]) || '' });
    last = m.index + m[0].length;
  }
  if (last < String(str).length) out.push(lit(String(str).slice(last)));
  out = out.filter(function (q) { return q.t !== ''; });

  // PUNCTUATION GOES WITH THE NUMBER IT BELONGS TO. `{p}% chance` and
  // `{v}\u00b0{u}` put the per-cent sign and the degree sign in the literal
  // text, so styling the placeholders alone gives a bold 96 beside a plain %,
  // and "-6" bold, "\u00b0" not, "C" bold again. Whatever follows a styled
  // piece up to the first SPACE is part of it.
  for (var i = 0; i < out.length - 1; i++) {
    if (out[i].lit || !out[i + 1].lit) continue;
    var run = /^\S+/.exec(out[i + 1].t);
    if (!run) continue;
    out[i].t += run[0];
    out[i + 1].t = out[i + 1].t.slice(run[0].length);
  }
  out = out.filter(function (q) { return q.t !== ''; });

  // THE THING ITSELF, WHEN THE SENTENCE NAMES IT RATHER THAN HOLDING A SLOT
  // FOR IT. The spell lines take what is coming as `{what}` and can style it
  // like any other placeholder. The temperature ones cannot: they say "Hot,
  // up to 32°C", and the word is the translator's own opening, chosen with
  // the rest of the sentence -- Heiss/Kalt/Frost, Calor/Frio/Heladas, three
  // wordings for two kinds. All eight languages write it the same shape,
  // thing first and a comma after, because that is how the sentence goes. So
  // `styles._0` styles that opening word, up to its comma, and the comma
  // stays behind with the sentence it punctuates.
  //
  // This runs after the sticking above and before the merge, so the opening
  // literal is still whole and still marked, and the piece split off it can
  // still join whatever follows.
  var lead = styles && styles._0;
  if (lead && out.length && out[0].lit) {
    var ix = out[0].t.indexOf(',');
    var word = ix > 0 ? out[0].t.slice(0, ix) : out[0].t;
    out.splice(0, 1, { t: word, s: lead }, { t: out[0].t.slice(word.length), s: dflt, lit: true });
    out = out.filter(function (q) { return q.t !== ''; });
  }

  // ...and two pieces set the same way, now touching, are one piece.
  var merged = [];
  out.forEach(function (q) {
    var prev = merged[merged.length - 1];
    if (prev && prev.s === q.s) prev.t += q.t; else merged.push({ t: q.t, s: q.s });
  });
  return merged;
}

// ---------------------------------------------------------------------
// Deadline and saved state.
//
// The serverless runtime kills a render that runs long, so every fetch in
// this file is given what is LEFT of one shared deadline rather than a
// timeout of its own: three feeds each allowed four seconds is twelve
// seconds of rope on a budget that never had it. msUntil is that "what is
// left", and it is allowed to go negative so a caller can see there is no
// time and skip the call entirely.
//
// Saved state (https://help.trmnl.com/en/articles/16777795): whatever
// run() returns as `trmnl_state` comes back as `input.trmnl.state` on the
// next render. It carries the things a single render cannot work out on
// its own: what the weather was the last time the API answered, how long
// each feed has been failing, what a feed that is failing right now is
// called, and the last language table this device managed to download.
// It is UNTRUSTED input: it may be absent, a string, a shape from an
// older build, or truncated, so every field is validated on the way in
// and a bad one is dropped rather than trusted.
// ---------------------------------------------------------------------

// SAY SO, IN THE PLACE A PERSON DEBUGGING THIS WOULD LOOK.
//
// Everything that can go wrong here is something the board then cannot show,
// and until now none of it left a trace anywhere: a feed that did not answer,
// a forecast that timed out, a language file that 404ed, a config that would
// not parse. The board says what it can (see `calendars_down` and
// `board_notice`); this is the other half, for whoever is looking at the
// render log wondering why.
//
// Guarded because the runtime is not promised to have a console, and a
// transform that throws while trying to log is a blank board.
function warn(msg) {
  try {
    if (typeof console !== 'undefined' && console && console.warn) console.warn('metro: ' + msg);
  } catch (e) { /* a log is never worth a render */ }
}

// Enough of a URL to recognise a feed by, and never enough to leak one: a
// calendar link is a secret (anybody holding it can read the calendar), so
// the host is logged and the path never is.
function hostOf(url) {
  var m = /^[a-z]+:\/\/([^/?#]+)/i.exec(String(url || ''));
  return m ? m[1] : 'unknown host';
}

function msUntil(deadline) {
  return deadline - Date.now();
}

// The whole render's network budget. Everything that fetches gets a slice
// of what is left of it, never a fresh one of its own.
//
// FOUR SECONDS OF FIVE, AND THE OTHER ONE IS MEASURED RATHER THAN GUESSED.
//
// Five seconds is what the runtime gives THIS FILE, not the whole render, so
// all of it is ours to spend. It was three, on the reading that parsing every
// feed and building the board would want the other two. That reading was
// never measured and it is out by an order of magnitude: 932KB of calendar over four feeds -- a year of a Teams work
// calendar and three more beside it, far past what a household actually has
// -- parses and builds in 168ms, worst of five 225ms, in 26MB of the 128
// available. A second is four times the worst of that.
//
// The second that was idle was being taken off the feeds, and the feeds are
// what needs it: a published Outlook or Teams calendar regularly takes two to
// five seconds to answer, and a feed that misses the deadline is a calendar
// that silently is not on the board (see CALENDAR_DOWN_AFTER_S -- it is not
// even NAMED for two hours). Two photographs of the same board six minutes
// apart: in one the work calendar is missing, in the other it is back and two
// others have gone. "It's dropped events like crazy."
//
// THE FEEDS CANNOT BE SOMEBODY ELSE'S PROBLEM. A TRMNL plugin can hand its
// URLs to the platform's own polling instead of fetching them here, which
// would take the whole question away -- except that if one of them fails the
// whole render fails, and a household's board going blank because one
// calendar was slow is very much worse than the same calendar being late.
// Fetched here, one slow feed costs one feed.
//
// Re-measure before moving it again: no harness for it lives in the tree, the
// one used is in the commit message.
var RENDER_BUDGET_MS = 4000;

var WEATHER_STALE_AFTER_S = 6 * 3600;  // older than this and the board says so rather than presenting it as today's forecast
// THE SAME SIX HOURS FOR A CALENDAR, AND FOR THE SAME REASON.
//
// A feed that does not answer used to take its events off the board with it,
// which is the one thing the board must never do quietly -- a reader cannot
// tell a quiet Tuesday from a calendar that failed. The forecast has never
// worked that way: the last one that answered is kept in saved state and
// replayed, and the board says so once it is too old to pass off as today's.
// Feeds do that now too: "use the state to hold the previous success for six
// hours, after that show an error, keep showing the state".
//
// Kept per feed and only for the day it was read for -- events are minutes
// into a particular day, so a cache that outlived its day is not stale, it is
// wrong.
var FEED_STALE_AFTER_S = 6 * 3600;
// ...AND A WHOLE DAY OF IT IS NOT A FOOTNOTE ANY MORE.
//
// Six hours of silence puts a marked line under the map, which is the right
// size for "this may be a little out of date". A calendar that has said
// nothing for a DAY is not that: what is on the board for those people is
// yesterday, and a line under the map is too quiet a way to say so. Past this
// it takes the band along the bottom -- the one the weather uses -- because
// that is the board's way of interrupting. "Show the errors as service alert
// after 24h."
var FEED_DOWN_LOUD_AFTER_S = 24 * 3600;
// TRMNL's own ceiling on saved state, which is the reason the remembered
// events are NOT in it:
//
//   "There is a limit of 8192 bytes. Go over it and TRMNL ignores the write,
//    keeps the last good state"
//   -- help.trmnl.com/en/articles/16777795-saved-state
//
// Nothing is truncated: the write is rejected and the device keeps what it
// had, so every clock in here stops and the board renders from a state it can
// no longer correct. A real four-calendar household's events came to 7.7KB on
// their own. What is left in state is a number per feed, and the events come
// back out of the previous render's payload instead (see replayFeed).
var STATE_LIMIT_BYTES = 8192;
// A FEED THAT IS NOT ANSWERING IS NAMED ON THIS RENDER, NOT ON A LATER ONE.
//
// It used to be named only once it had been failing for two hours, so that a
// blip -- one 500, one slow morning -- changed nothing on the board. What
// that actually bought was two hours in which a person's whole day could be
// missing from the map with nothing anywhere to say so, and the map looking
// entirely normal. That is the one thing this board must never do: "we can't
// just drop events, feeds without the user knowing".
//
// The clock is still kept, because `state.calendarDown` is what lets a feed
// that comes back clear itself, and how long it has been down is worth
// knowing. It no longer decides whether the reader is told.
var CALENDAR_DOWN_AFTER_S = 2 * 3600;  // kept for the "down since" clock in saved state; no longer gates what the board says
var STATE_MAX_URLS = 40;               // state travels with every render; a config that once had 200 feeds must not grow it forever

function readState(input) {
  var raw = null;
  try { raw = input.trmnl.state; } catch (e) { raw = null; }
  // Some runtimes hand the state back as the JSON string that was stored
  // rather than as an object.
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch (e) { raw = null; }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {};

  var out = { weather: null, weatherFetchedAt: 0, calendarDown: {}, calendarNames: {}, i18n: null, feedOk: {}, news: null, lineSlots: {} };

  if (raw.weather && typeof raw.weather === 'object' && !Array.isArray(raw.weather)) {
    out.weather = raw.weather;
    out.weatherFetchedAt = typeof raw.weatherFetchedAt === 'number' && isFinite(raw.weatherFetchedAt) ? raw.weatherFetchedAt : 0;
  }
  if (raw.calendarDown && typeof raw.calendarDown === 'object') {
    Object.keys(raw.calendarDown).slice(0, STATE_MAX_URLS).forEach(function (url) {
      var t = raw.calendarDown[url];
      if (typeof t === 'number' && isFinite(t) && t > 0) out.calendarDown[url] = t;
    });
  }
  if (raw.calendarNames && typeof raw.calendarNames === 'object') {
    Object.keys(raw.calendarNames).slice(0, STATE_MAX_URLS).forEach(function (url) {
      var n = raw.calendarNames[url];
      if (typeof n === 'string' && n.trim()) out.calendarNames[url] = n.trim().slice(0, 80);
    });
  }
  // WHEN EACH FEED LAST ANSWERED. One number per calendar -- the events it
  // drew are recovered from the previous payload, not from here, because
  // 8192 bytes is not many meetings (see replayFeed).
  if (raw.feedOk && typeof raw.feedOk === 'object' && !Array.isArray(raw.feedOk)) {
    Object.keys(raw.feedOk).slice(0, STATE_MAX_URLS).forEach(function (url) {
      var t = raw.feedOk[url];
      if (typeof t === 'number' && isFinite(t) && t > 0) out.feedOk[url] = t;
    });
  }
  // WHICH RUNG OF THE STYLE LADDER EACH PERSON HAS, by name (see lineSlots).
  if (raw.lineSlots && typeof raw.lineSlots === 'object' && !Array.isArray(raw.lineSlots)) {
    Object.keys(raw.lineSlots).slice(0, STATE_MAX_URLS).forEach(function (nm) {
      var sl = raw.lineSlots[nm];
      if (typeof nm === 'string' && nm.trim() && typeof sl === 'number' && isFinite(sl) && sl >= 0 && sl < 64) out.lineSlots[nm.trim().slice(0, 80)] = Math.floor(sl);
    });
  }
  // THE LAST HEADLINES, for a refresh on which every feed is slow: a few
  // short strings, so they fit the state beside the forecast.
  if (raw.news && typeof raw.news === 'object' && Array.isArray(raw.news.items)) {
    var nItems = raw.news.items.slice(0, NEWS_MAX_ITEMS).filter(function (it) {
      return it && typeof it.title === 'string' && it.title.trim();
    }).map(function (it) {
      return { title: it.title.slice(0, NEWS_TITLE_MAX), source: typeof it.source === 'string' ? it.source.slice(0, NEWS_SOURCE_MAX) : '' };
    });
    if (nItems.length) {
      out.news = { items: nItems, key: typeof raw.news.key === 'string' ? raw.news.key.slice(0, 400) : '',
        fetchedAt: typeof raw.news.fetchedAt === 'number' && isFinite(raw.news.fetchedAt) ? raw.news.fetchedAt : 0 };
    }
  }
  if (raw.i18n && typeof raw.i18n === 'object' && typeof raw.i18n.lang === 'string') {
    var clean = sanitizeStrings(raw.i18n.strings);
    if (Object.keys(clean).length) {
      out.i18n = { lang: raw.i18n.lang.slice(0, 8), strings: clean,
        fetchedAt: typeof raw.i18n.fetchedAt === 'number' && isFinite(raw.i18n.fetchedAt) ? raw.i18n.fetchedAt : 0 };
    }
  }
  return out;
}

// Feeds come and go from a config. Anything the config no longer names is
// dropped, so a URL that was removed a year ago is not still being carried
// (and counted as "down") on every render.
function pruneState(state, urls) {
  if (!state) return;
  var keep = {};
  (urls || []).forEach(function (u) { keep[u] = true; });
  [state.calendarDown, state.calendarNames, state.feedOk].forEach(function (map) {
    if (!map) return;
    Object.keys(map).forEach(function (u) { if (!keep[u]) delete map[u]; });
  });
}

// Weekday and month names come from Intl, one part at a time and cached.
// Formatters are not cheap to build and the same handful get asked for over
// and over, and taking the parts separately means the label can be composed
// per locale rather than accepting whatever order a full format string
// produces. Some locales return a trailing dot or a lowercase name; both are
// tidied here so the header reads consistently.
var _weekdayFmtCache = {}, _monthFmtCache = {};
function localeDatePart(locale, width, kind, y, mo, d) {
  var key = locale + '|' + width;
  var cache = kind === 'weekday' ? _weekdayFmtCache : _monthFmtCache;
  var fmt = cache[key];
  if (!fmt) {
    var opts = { timeZone: 'UTC' };
    opts[kind] = width;
    try {
      fmt = new Intl.DateTimeFormat(locale, opts);
    } catch (e) {
      fmt = new Intl.DateTimeFormat('en', opts);
    }
    cache[key] = fmt;
  }
  var raw = fmt.format(new Date(Date.UTC(y, mo - 1, d))).replace(/\.$/, '');
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

// "Tue 8 Sep" / "Di 8 sep" / "Mar 8 sept" — header date, in the board's own
// language.
// The day as a machine reads it: "2026-09-08", no locale in it anywhere.
//
// `date_label` is for a person and is therefore useless as an identity --
// it has no year in it and it changes with the language. This is what the
// drawing seeds its generator from, so that whatever the board decides by
// chance it decides the same way every time it redraws the same day, on
// every device, in every language.
function isoDate(civil) {
  if (!civil) return null;
  return civil.y + '-' + pad2(civil.mo) + '-' + pad2(civil.d);
}
// A DAY'S OR A MONTH'S NAME FROM THE TABLE FIRST. Intl was asked, but the
// serverless runtime may carry English locale data only, and then every
// language's dates came out "Sat 19 Sep". The table has them (wd_0..6,
// wdl_0..6, mo_1..12); Intl is the fallback for a table that does not.
function dateName(strings, locale, width, kind, y, mo, d) {
  var key = kind === 'month' ? 'mo_' + mo
    : (width === 'long' ? 'wdl_' : 'wd_') + new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  // (a board whose language file could not be had reads English words but
  // keeps whatever dates its Intl can give: the built-in table is not a
  // translation of anything)
  var v = strings && strings !== I18N.en && typeof strings[key] === 'string' && strings[key].trim();
  if (v) return v.charAt(0).toUpperCase() + v.slice(1);
  return localeDatePart(locale || 'en', width, kind, y, mo, d);
}
function dateLabel(civil, locale, strings) {
  if (!civil) return null;
  var loc = locale || 'en';
  var wd = dateName(strings, loc, 'short', 'weekday', civil.y, civil.mo, civil.d);
  var month = dateName(strings, loc, 'short', 'month', civil.y, civil.mo, civil.d);
  return wd + ' ' + civil.d + ' ' + month;
}

// 12-hour clocks where the locale itself uses them, unless the setting says
// otherwise. Ask Intl rather than keeping a list of regions: the runtime
// already knows every locale's clock convention, a hand-kept list is wrong
// the moment it meets a locale nobody thought of, and "does en-IE use a
// 12-hour clock" is not a question this file should be answering from
// memory.
var _hourCycleCache = {};
function localeUses12h(locale) {
  var key = String(locale || 'en');
  if (key in _hourCycleCache) return _hourCycleCache[key];
  var out = false;
  try {
    var ro = new Intl.DateTimeFormat(key, { hour: 'numeric' }).resolvedOptions();
    // hourCycle is the modern answer (h11/h12 are the 12-hour ones); hour12
    // is the older one. A bare "en" resolves to a 12-hour clock, which is
    // not what a TRMNL account defaulting to "en" wants, so that one case
    // stays explicit.
    out = ro.hourCycle ? (ro.hourCycle === 'h11' || ro.hourCycle === 'h12') : !!ro.hour12;
    if (key.toLowerCase() === 'en') out = false;
  } catch (e) { out = false; }
  _hourCycleCache[key] = out;
  return out;
}

function resolveHour12(timeFormatRaw, locale) {
  if (timeFormatRaw === '12h') return true;
  if (timeFormatRaw === '24h') return false;
  return localeUses12h(locale);
}

// ---------------------------------------------------------------------
// Timezone helpers (Intl-based, no library) — same technique used by
// this project's other plugin (plugin/src/transform.js: fromEpoch /
// zonedTimeToUtc), ported compactly rather than re-derived.
// ---------------------------------------------------------------------

var _offsetFmtCache = {};
// Validates an IANA zone name before it's ever handed to
// getOffsetMinutes()/zonedTimeToUtc() — Intl throws on anything it
// doesn't recognize (notably Windows-style TZIDs like "Eastern Standard
// Time" that Outlook exports use instead of "America/New_York"), and an
// uncaught throw here would silently drop that entire calendar's events
// (swallowed by the per-calendar try/catch in buildFromConfig) with
// nothing pointing at why. Ported from plugin/src/transform.js's own
// safeZone — same fix, same reason.
var _safeZoneCache = {};
// OUTLOOK WRITES WINDOWS ZONE NAMES. "Romance Standard Time" is Paris and
// Brussels, and a browser has never heard of it, so an Outlook invitation
// from London ("GMT Standard Time") was read in the board's own zone and
// drawn an hour early. The CLDR mapping for each name's main region.
var WINDOWS_ZONES = {
  'Dateline Standard Time': 'Etc/GMT+12', 'UTC-11': 'Etc/GMT+11', 'Aleutian Standard Time': 'America/Adak',
  'Hawaiian Standard Time': 'Pacific/Honolulu', 'Alaskan Standard Time': 'America/Anchorage',
  'Pacific Standard Time (Mexico)': 'America/Tijuana', 'Pacific Standard Time': 'America/Los_Angeles',
  'US Mountain Standard Time': 'America/Phoenix', 'Mountain Standard Time (Mexico)': 'America/Mazatlan',
  'Mountain Standard Time': 'America/Denver', 'Central America Standard Time': 'America/Guatemala',
  'Central Standard Time': 'America/Chicago', 'Central Standard Time (Mexico)': 'America/Mexico_City',
  'Canada Central Standard Time': 'America/Regina', 'SA Pacific Standard Time': 'America/Bogota',
  'Eastern Standard Time': 'America/New_York', 'Eastern Standard Time (Mexico)': 'America/Cancun',
  'US Eastern Standard Time': 'America/Indianapolis', 'Venezuela Standard Time': 'America/Caracas',
  'Atlantic Standard Time': 'America/Halifax', 'SA Western Standard Time': 'America/La_Paz',
  'Pacific SA Standard Time': 'America/Santiago', 'Newfoundland Standard Time': 'America/St_Johns',
  'E. South America Standard Time': 'America/Sao_Paulo', 'Argentina Standard Time': 'America/Buenos_Aires',
  'SA Eastern Standard Time': 'America/Cayenne', 'Greenland Standard Time': 'America/Godthab',
  'Montevideo Standard Time': 'America/Montevideo', 'UTC-02': 'Etc/GMT+2', 'Azores Standard Time': 'Atlantic/Azores',
  'Cape Verde Standard Time': 'Atlantic/Cape_Verde', 'UTC': 'Etc/UTC', 'Coordinated Universal Time': 'Etc/UTC',
  'GMT Standard Time': 'Europe/London', 'Greenwich Standard Time': 'Atlantic/Reykjavik', 'Morocco Standard Time': 'Africa/Casablanca',
  'W. Europe Standard Time': 'Europe/Berlin', 'Central Europe Standard Time': 'Europe/Budapest',
  'Romance Standard Time': 'Europe/Paris', 'Central European Standard Time': 'Europe/Warsaw',
  'W. Central Africa Standard Time': 'Africa/Lagos', 'GTB Standard Time': 'Europe/Bucharest',
  'Middle East Standard Time': 'Asia/Beirut', 'Egypt Standard Time': 'Africa/Cairo', 'E. Europe Standard Time': 'Europe/Chisinau',
  'South Africa Standard Time': 'Africa/Johannesburg', 'FLE Standard Time': 'Europe/Kiev', 'Israel Standard Time': 'Asia/Jerusalem',
  'Kaliningrad Standard Time': 'Europe/Kaliningrad', 'Jordan Standard Time': 'Asia/Amman', 'Arabic Standard Time': 'Asia/Baghdad',
  'Turkey Standard Time': 'Europe/Istanbul', 'Arab Standard Time': 'Asia/Riyadh', 'Belarus Standard Time': 'Europe/Minsk',
  'Russian Standard Time': 'Europe/Moscow', 'E. Africa Standard Time': 'Africa/Nairobi', 'Iran Standard Time': 'Asia/Tehran',
  'Arabian Standard Time': 'Asia/Dubai', 'Azerbaijan Standard Time': 'Asia/Baku', 'Georgian Standard Time': 'Asia/Tbilisi',
  'Caucasus Standard Time': 'Asia/Yerevan', 'Afghanistan Standard Time': 'Asia/Kabul', 'West Asia Standard Time': 'Asia/Tashkent',
  'Ekaterinburg Standard Time': 'Asia/Yekaterinburg', 'Pakistan Standard Time': 'Asia/Karachi', 'India Standard Time': 'Asia/Calcutta',
  'Sri Lanka Standard Time': 'Asia/Colombo', 'Nepal Standard Time': 'Asia/Katmandu', 'Central Asia Standard Time': 'Asia/Almaty',
  'Bangladesh Standard Time': 'Asia/Dhaka', 'Myanmar Standard Time': 'Asia/Rangoon', 'SE Asia Standard Time': 'Asia/Bangkok',
  'N. Central Asia Standard Time': 'Asia/Novosibirsk', 'China Standard Time': 'Asia/Shanghai', 'North Asia Standard Time': 'Asia/Krasnoyarsk',
  'Singapore Standard Time': 'Asia/Singapore', 'W. Australia Standard Time': 'Australia/Perth', 'Taipei Standard Time': 'Asia/Taipei',
  'Tokyo Standard Time': 'Asia/Tokyo', 'Korea Standard Time': 'Asia/Seoul', 'Cen. Australia Standard Time': 'Australia/Adelaide',
  'AUS Central Standard Time': 'Australia/Darwin', 'E. Australia Standard Time': 'Australia/Brisbane',
  'AUS Eastern Standard Time': 'Australia/Sydney', 'West Pacific Standard Time': 'Pacific/Port_Moresby',
  'Tasmania Standard Time': 'Australia/Hobart', 'Vladivostok Standard Time': 'Asia/Vladivostok',
  'New Zealand Standard Time': 'Pacific/Auckland', 'Fiji Standard Time': 'Pacific/Fiji', 'Tonga Standard Time': 'Pacific/Tongatapu',
};
function safeZone(name) {
  if (!name) return null;
  if (name in _safeZoneCache) return _safeZoneCache[name];
  var ok = null;
  var bare = String(name).replace(/^"|"$/g, '').trim();
  [bare, WINDOWS_ZONES[bare], bare.replace(/^\/+/, '')].some(function (z) {
    if (!z) return false;
    try { new Intl.DateTimeFormat('en-US', { timeZone: z }); ok = z; return true; } catch (e) { return false; }
  });
  _safeZoneCache[name] = ok;
  return ok;
}

function offsetFormatter(tz) {
  if (!_offsetFmtCache[tz]) {
    _offsetFmtCache[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', timeZoneName: 'longOffset' });
  }
  return _offsetFmtCache[tz];
}

function getOffsetMinutes(epochMs, tz) {
  if (typeof tz === 'number') return tz; // already a raw UTC offset in minutes — the utc_offset fallback case
  if (!isFinite(epochMs)) return 0;
  var parts = offsetFormatter(tz).formatToParts(new Date(epochMs));
  var part = parts.filter(function (p) { return p.type === 'timeZoneName'; })[0];
  var v = part ? part.value : 'GMT';
  if (v === 'GMT' || v === 'UTC') return 0;
  var m = /GMT([+-])(\d{1,2}):(\d{2})/.exec(v);
  if (m) return (m[1] === '-' ? -1 : 1) * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
  m = /GMT([+-])(\d{1,2})$/.exec(v);
  if (m) return (m[1] === '-' ? -1 : 1) * parseInt(m[2], 10) * 60;
  return 0;
}

var _civilFmtCache = {};
function civilFormatter(tz) {
  if (!_civilFmtCache[tz]) {
    _civilFmtCache[tz] = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  }
  return _civilFmtCache[tz];
}

function fromEpoch(epochMs, tz) {
  if (typeof tz === 'number') {
    var dNum = new Date(epochMs + tz * 60000);
    return { y: dNum.getUTCFullYear(), mo: dNum.getUTCMonth() + 1, d: dNum.getUTCDate(), h: dNum.getUTCHours(), mi: dNum.getUTCMinutes(), s: dNum.getUTCSeconds() };
  }
  var parts = {};
  civilFormatter(tz).formatToParts(new Date(epochMs)).forEach(function (p) { parts[p.type] = p.value; });
  var h = +parts.hour;
  if (h === 24) h = 0;
  return { y: +parts.year, mo: +parts.month, d: +parts.day, h: h, mi: +parts.minute, s: +parts.second };
}

function zonedTimeToUtc(y, mo, d, h, mi, s, tz) {
  if (typeof tz === 'number') return Date.UTC(y, mo - 1, d, h, mi, s) - tz * 60000;
  var guess = Date.UTC(y, mo - 1, d, h, mi, s);
  var off1 = getOffsetMinutes(guess, tz);
  var t1 = guess - off1 * 60000;
  var off2 = getOffsetMinutes(t1, tz);
  return guess - off2 * 60000;
}

function cf(input, key) {
  try {
    var v = input.trmnl.plugin_settings.custom_fields_values[key];
    return v == null ? '' : String(v);
  } catch (e) {
    return '';
  }
}

// User's own TRMNL account timezone/offset — the fallback chain a config
// (or demo mode, which has no timeZone of its own at all) should use
// before ever defaulting to plain UTC, so "now" and any floating-time ICS
// events land on the viewer's actual local day instead of an arbitrary
// one. Ported from plugin/src/transform.js's userTz/userUtcOffsetMinutes/
// resolveTz — same fallback order: explicit override > account IANA zone
// > account UTC offset (seconds, per the merge-variable, hence /60) > UTC.
function userTz(input) {
  try {
    var tz = input.trmnl.user.time_zone_iana;
    return (typeof tz === 'string' && tz.trim()) ? tz.trim() : null;
  } catch (e) {
    return null;
  }
}

function userUtcOffsetMinutes(input) {
  try {
    var n = Number(input.trmnl.user.utc_offset);
    return isFinite(n) ? n / 60 : null;
  } catch (e) {
    return null;
  }
}

function resolveTz(explicitTzname, input) {
  var explicit = explicitTzname ? safeZone(explicitTzname) : null;
  if (explicit) return explicit;
  var accountTz = safeZone(userTz(input));
  if (accountTz) return accountTz;
  var offsetMin = userUtcOffsetMinutes(input);
  if (offsetMin !== null) return offsetMin; // numeric — getOffsetMinutes/fromEpoch/zonedTimeToUtc all handle this
  return 'UTC';
}

// ---------------------------------------------------------------------
// buildMetro: the shared pipeline. `events`: [{track, title, startMin,
// endMin, location, interchange_with}], startMin/endMin are minutes
// since midnight LOCAL time. `lines`: [{key,name,side,hue,configured}] --
// what the household said about each person and nothing about how their
// line is drawn, which is solver/order.js's.
//
// transform.js is a pure data normalizer — it does NOT decide where
// anything sits on the canvas, which events are "close enough" to become
// a sub-spur, or which same-event entries are duplicates across feeds.
// It can't: it has no idea what the real rendered canvas height is, how
// many pixels a wrapped multi-line title needs, or whether two calendars
// happened to both return the same event. Event items here are raw facts
// only (title/times/location/owner/side/track styling); shared.liquid's
// client-side script does the dedup pass, maps start_min/end_min to a
// real pixel Y against the canvas's own measured height, measures each
// label's ACTUAL rendered box before deciding the next one's position,
// and decides sub-spur grouping from the deduped, time-sorted list
// itself. See that file's own header comment for the full breakdown.
// ---------------------------------------------------------------------

function timeLabel12(min, extra) {
  var h = Math.floor(min / 60) % 24, m = min % 60;
  if (!(extra && extra.hour12)) return pad2(h) + ':' + pad2(m);
  return (h % 12 || 12) + (m ? ':' + pad2(m) : '') + (h < 12 ? 'am' : 'pm');
}
function buildMetro(lines, events, weatherMilestones, headerWeather, nowMin, windowLabel, allDayEvents, extra) {
  var lineByKey = {};
  lines.forEach(function (t) { lineByKey[t.key] = t; });

  // ---- how much of the day is on the board -----------------------------
  //
  // A fixed 7am-to-9pm day cut the ends off: an early shift or a late
  // dinner fell outside it and became a "+1 later" note. It also left a
  // late event's label nothing to run into — the last thing on the map
  // ended AT the edge, so its caption had to be ellipsised or turned back
  // on itself.
  //
  // The day now stretches to fit what is actually on it, an hour before the
  // first thing and an hour and a half after the last, clamped to real
  // midnight either way. That tail is the room a label needs. The quiet
  // ends cost almost nothing to show because the client runs them as
  // express sections rather than at full scale, so a wider day is mostly a
  // wider view of the same busy hours.
  var dayLo = DAY_START_MIN, dayHi = DAY_END_MIN, evLo = null;
  (events || []).forEach(function (e) {
    if (e.startMin != null) {
      dayLo = Math.min(dayLo, e.startMin);
      // The earliest EVENT, kept apart from the earliest minute the board
      // covers: the lead is owed to a thing that gets drawn, and the fixed
      // opening hour and the clock are not things.
      if (evLo == null || e.startMin < evLo) evLo = e.startMin;
    }
    if (e.endMin != null) dayHi = Math.max(dayHi, e.endMin);
  });
  if (nowMin != null) { dayLo = Math.min(dayLo, nowMin); dayHi = Math.max(dayHi, nowMin); }
  // Clamped to the run of days the board covers, not to one midnight. On a
  // single-day board that is the same number it always was; on a run of
  // three it lets the window reach into day two and day three, which is
  // the whole point of sending them.
  var days = (extra && extra.days) || [];
  var runEnd = Math.max(24 * 60, days.length * 24 * 60);
  // EVERYTHING GATHERED, FROM THIS DAY'S OWN MIDNIGHT.
  //
  // This used to work out the drawn window: an hour or two of lead before the
  // first event, an hour and a half of tail after the last, a minimum span, a
  // rolling override. All of it is `day.js`'s now -- `opened()` picks the
  // start against the clock, `framed()` the end against the view -- and
  // sending a window as well meant sending an answer to a question this
  // cannot see the paper for.
  //
  // So the payload spans what was gathered and nothing is trimmed off either
  // end. What the board does not draw it still counts, at the edge it fell
  // off.
  // `runEnd` is the run this gathered, in the shown day's own minutes: one
  // day, or two where there is a tomorrow to send. (`dayLo`/`dayHi` above are
  // the extent of the EVENTS, which is a different question and no longer
  // anybody's here.)
  var DAY_LO = 0;
  var DAY_HI = runEnd;

  // A configured track with nothing on today's board gets no line and no
  // legend entry — otherwise every day carries every ever-configured
  // track's empty line, permanently eating spine width. Side/hue/style
  // stay whatever finalize() decided from the FULL registered set (so a
  // track's color/side identity doesn't shift day to day depending on
  // who else happens to be busy); only the per-side offset is repacked
  // against just today's active lines, closing the gaps a filtered-out
  // track would otherwise leave.
  var activeKeys = {};
  events.forEach(function (ev) {
    if (!lineByKey[ev.line]) return;
    activeKeys[ev.line] = true;
    (ev.interchange_with || []).forEach(function (key) { if (lineByKey[key]) activeKeys[key] = true; });
  });
  (allDayEvents || []).forEach(function (ev) { if (lineByKey[ev.line]) activeKeys[ev.line] = true; });
  lines.forEach(function (t) { if (t.keep_empty) activeKeys[t.key] = true; });
  lines = lines.filter(function (t) { return activeKeys[t.key]; });
  lines.forEach(function (t) { delete t.keep_empty; }); // bookkeeping, not payload
  // NO RENUMBERING, AND NO OFFSETS TO RENUMBER. Dropping a line used to leave
  // a gap in the offsets this file handed out, so they were sorted and dealt
  // again -- rule 42, "the order survives to the drawing", which existed
  // because the order was decided here and could be thrown away one function
  // later. Neither the order nor the offsets are decided here any more
  // (solver/order.js), so what leaves is the household's own list with
  // whoever is not on today's board left out of it, and the arranger packs
  // the offsets against the lines that actually exist.
  lineByKey = {};
  lines.forEach(function (t) { lineByKey[t.key] = t; });

  var items = [];

  events.forEach(function (ev) {
    var line = lineByKey[ev.line];
    if (!line) return; // no resolved/known line for this event — drop it rather than guess
    var coOwners = (ev.interchange_with || []).filter(function (key) { return !!lineByKey[key]; });
    items.push({
      type: 'event',
      _sortMin: ev.startMin,
      title: ev.title,
      // several things merged into one stop (`mergeSameTime`), by name
      parts: ev.parts && ev.parts.length > 1 ? ev.parts : undefined,
      // a task rather than an appointment: drawn with a square (draw.js)
      todo: ev.todo ? true : undefined,
      start_min: ev.startMin,
      end_min: ev.endMin,
      // began before the board's first midnight: the caption's time is this
      began_min: ev.beganMin != null ? ev.beganMin : undefined,
      location: ev.location || null,
      owner: line.key,
      co_owners: coOwners, // other line keys sharing this event (an interchange) — empty for a normal event
      // WHICH CALENDAR PUT IT HERE. One number, so that the NEXT render can
      // take one feed's day back out of this payload when that feed does not
      // answer (see `replayFeed`). It is the only reason this is here; the
      // board never reads it.
      f: ev.feed,
      // NO PRESENTATION HERE. Which side an event's line runs on, its
      // colour, its weight and its dash pattern all belong to the LINE, and
      // the board looks them up on the legend entry the owner names. Copied
      // onto every event they were five dead fields per item that nothing
      // read -- on a busy day, eighty-five of them, in a payload with a
      // hundred kilobyte ceiling.
    });
  });

  // AN ALL-DAY EVENT HAS NO HOUR, SO IT GETS NO PLACE ON THE AXIS.
  //
  // It was drawn as an event spanning the whole visible window, which meant
  // the board printed its OWN window back as the event's hours: every render
  // carried "6am - 11pm / Spring Break", which is not when the holiday is,
  // it is when the board decided to start and stop looking. On a multi-day
  // board it was worse, because the window covers the run and a Tuesday
  // holiday got stamped across Wednesday and Thursday too.
  //
  // It is a STATE a line is in, not a place it goes at a time, so it is
  // declared once at the line's head, where the board already says who a
  // line is. Several lines sharing one title are ONE origin named once, so
  // the grouping happens here rather than being rediscovered per line.
  var allDayByTitle = {};
  (allDayEvents || []).forEach(function (ev) {
    var line = lineByKey[ev.line];
    if (!line) return;
    var row = allDayByTitle[ev.title];
    if (!row) {
      // No hue, no style: presentation is the frontend's, and `owners`
      // already says which lines' styles to draw the badge in.
      // ...AND WHICH DAYS IT COVERS, which this used to drop on the floor.
      //
      // `ev.day` is the index of the day this firing lands on, and it has
      // been carried all the way here from the feed -- and then grouping by
      // title alone threw it away. On a one day board that costs nothing. On
      // a board showing three, an all-day event on the Thursday was declared
      // at the line's head exactly like one covering all three, and two of
      // them on different days sat side by side with nothing saying which
      // was which. A holiday is a property of a DAY (see `parseRule`), so
      // the day has to survive the grouping.
      row = allDayByTitle[ev.title] = { title: ev.title, owners: [], days: [], f: ev.feed };
    }
    if (row.owners.indexOf(line.key) < 0) row.owners.push(line.key);
    if (ev.day != null && row.days.indexOf(ev.day) < 0) row.days.push(ev.day);
  });
  Object.keys(allDayByTitle).forEach(function (t) {
    allDayByTitle[t].days.sort(function (a, b) { return a - b; });
  });
  var allDay = Object.keys(allDayByTitle).map(function (t) { return allDayByTitle[t]; });

  (weatherMilestones || []).forEach(function (w) {
    items.push({ type: 'weather', _sortMin: w.atMin, at_min: w.atMin, icon: w.icon, label: w.label });
  });

  // NO SUNRISE AND NO SUNSET. They were two of the five sky markers, and
  // they were the two nobody needed: a household does not plan around the
  // minute the sun comes up, and on a board whose whole subject is what the
  // family is doing they were the only marks that answered a question
  // nobody had asked. Rain start and rain stop change what you take with
  // you; sunrise does not.
  //
  // They also cost more than they looked. Every marker reserves a slot in
  // the strip under the ruler, and the two of them sat at the ends of the
  // day where the board is widest and the hour labels thinnest, so a
  // sunset at 19:58 was competing for that row with the rain markers and
  // with the hour ticks, and the collision rules that shuffle two markers
  // apart existed mostly to keep them out of each other's way.

  items.sort(function (a, b) { return a._sortMin - b._sortMin; });
  items.forEach(function (item) { delete item._sortMin; });

  return {
    day_start_min: DAY_LO,
    day_end_min: DAY_HI,
    // The run of days, in the same absolute minutes everything else uses:
    // day 0 is [0, 1440), day 1 is [1440, 2880), and so on. The client
    // draws as many of them as the canvas can give a day's worth of axis
    // to, so this is what it has to choose FROM, not what it will show.
    // Each carries its own date and its own forecast, because a two-day
    // board that says one temperature is lying about one of the days.
    days: (days || []).map(function (d, i) {
      return {
        index: i,
        start_min: i * 24 * 60,
        end_min: (i + 1) * 24 * 60,
        date_label: d.label || null,
        weekday_label: d.weekday || null,
        // The same weekday in as few letters as the locale writes it: what
        // a date marker falls back to where the strip is an hour label wide.
        weekday_short: d.weekdayShort || null,
        weather: d.weather || null,
      };
    }),
    // THE WINDOW INTO THE RUN, on the days a quiet one borrowed the next.
    //
    // Null on every ordinary board, and that is load bearing: the client
    // draws a whole day per day in the run and compresses the quiet parts,
    // the day the board actually shows, computed here rather than by the
    // caller, which cannot know it until the events are in
    date_label: (extra && extra.dateLabel) || null,
    // the seed for anything the drawing decides by chance; see `isoDate`
    date_iso: (extra && extra.dateIso) || null,
    // What the header calls the day. "Today" only when it is: a board set
    // to tomorrow that says Today is naming the wrong day, and the day's
    // own name is more use than the word "Tomorrow" anyway, because it is
    // what everyone else in the house will call it.
    now_min: nowMin != null ? nowMin : null, // minutes since local midnight; the client decides whether/where to draw it
    orientation: (extra && extra.orientation) || 'auto', // auto | horizontal | vertical — client picks for auto from the canvas aspect
    hour12: !!(extra && extra.hour12),
    i18n: (function (st) { return { today: tr(st, 'today'), tomorrow: tr(st, 'tomorrow'), now: tr(st, 'now'), next: tr(st, 'next'), everyone: tr(st, 'everyone'), more: tr(st, 'more'), earlier: tr(st, 'earlier'), rain_pct: tr(st, 'rain_pct'), feed_down: tr(st, 'feed_down'), weather_stale: tr(st, 'weather_stale'), draw_failed: tr(st, 'notice_error'), quiet_day: tr(st, 'quiet_day') }; })((extra && extra.strings) || I18N.en),
    // THE HEADLINES, for the platform display along the foot of the map:
    // { items: [{ title, source }], max } or null where no feed is set. The
    // board draws as many rows of it as the panel can spare, up to `max`
    // (draw.js); the transform has already read, sorted and cut them.
    news: (extra && extra.news) || null,
    header_weather: headerWeather,
    // The forecast is the last one the API answered with rather than
    // today's, and it is old enough to say so. A board that quietly shows
    // yesterday's weather as today's is worse than one that admits it.
    weather_stale: !!(extra && extra.weatherStale),
    // The banner along the bottom edge: { text, kind } or null. The text is
    // already composed and already translated (see serviceAlert): the
    // template prints it and picks a treatment from `kind`
    // (rain|snow|cold|heat), and nothing about it is assembled on the
    // client. NULL, not an empty string, when nothing is breached: the
    // banner has to disappear completely and give its space back to the
    // map, and "" would still be a thing the template had to decide about.
    service_alert: (extra && extra.serviceAlert) || null,
    // Feeds that have been failing for hours, by name (see
    // CALENDAR_DOWN_AFTER_S). A calendar that stops answering takes its
    // events off the board with it, and a board that is missing half a
    // family without saying so reads as a quiet day.
    calendars_down: (extra && extra.calendarsDown) || [],
    // WHY THE BOARD IS EMPTY, when it is: a sentence in the middle of the
    // map rather than a header over nothing (see boardNotice).
    board_notice: (extra && extra.notice) || null,
    legend: lines,
    all_day: allDay, // declared at the line's head, never on the axis: see above
    // WHAT THE DAY IS, next to the date that says which day it is.
    //
    // A holiday is not one person's state, so it is not a line's anything:
    // it has no hour to be drawn at, no owner to be declared under, and
    // nothing about it says a line's day is a slice of something longer.
    // It is a property of THE DAY, and the board already has one place
    // that says what the day is, which is the header.
    //
    // ONE NAME. Two people in a house may both subscribe to the same
    // national calendar, so the same day arrives twice and is deduplicated
    // here; and a day can genuinely carry two different ones, a public
    // holiday and a school one. The header is a single row that already
    // holds a date and a forecast, and two names on it came out as
    // "Christmas D" and "School Holid", each cut mid word, with the
    // ordinal wrapped underneath. Naming the day is the header's job and
    // enumerating it is not, so the first wins: the first feed listed,
    // which is the one order the config author controls.
    holidays: (function (list, st) {
      // ONE NAME PER DAY, not one name per board. The cap used to be one
      // outright, from when a board drew one day; a rolling board draws two
      // and each of them gets to say what it is. Two names on ONE day is
      // still refused -- that came out as "Christmas D" and "School Holid",
      // each cut mid word -- so the seen-set is keyed on the day as well as
      // the title, and a day that carries two keeps the first feed listed.
      var seen = {}, perDay = {}, out = [];
      (list || []).forEach(function (h) {
        var day = Math.max(0, h.day || 0);
        var key = day + '\u0000' + String(h.title == null ? '' : h.title).trim().toLowerCase();
        if (key.length <= 2 || seen[key]) return;
        seen[key] = true;
        if (perDay[day]) return;
        perDay[day] = true;
        var span = Math.max(1, h.span || 1);
        var ix = Math.min(span - 1, Math.max(0, h.index || 0));
        out.push({
          title: h.title,
          f: h.feed,   // which calendar it came from; see the note on an event's own
          // which day of the board it is about: 0 is the day the board opens
          // on, 1 the day a rolling board reached into
          day: day,
          day_index: ix,
          day_span: span,
          // Composed and translated HERE, the way the service alert's text
          // is: a braced placeholder inside a Liquid output tag ends the
          // tag and takes the whole template down with it, and a day that
          // is not inside a range has no ordinal to state at all.
          day_label: span > 1 ? fmt(tr(st, 'holiday_day'), { n: ix + 1, m: span }) : null,
        });
      });
      return out.slice(0, 2);
    })((extra && extra.holidays) || [], (extra && extra.strings) || I18N.en),
    // TWO LISTS, NOT ONE MIXED ONE.
    //
    // This was `items`, one list of three kinds sorted by minute, and every
    // consumer's first move was to filter it: the axis window wanted events,
    // the fit pass wanted events, the sky band wanted `weather || sun`.
    // Nothing ever wanted the mixed list, so the mixing was work done here
    // and undone four times downstream.
    //
    // `weather` is now only rain start and rain stop and the heavier
    // conditions: the sunrise and sunset markers are gone, so there is one
    // kind of sky marker left and nothing to tell apart. `header_weather`
    // is separately the header's business.
    events: items.filter(function (i) { return i.type === 'event'; }),
    weather: items.filter(function (i) { return i.type === 'weather'; }),
  };
}

// ---------------------------------------------------------------------
// Demo path — unchanged hardcoded data.
// ---------------------------------------------------------------------

// THE OFFLINE FALLBACK IS GONE, and with it a second definition of the same
// board. There used to be a hand-written Springfield day here -- its own
// tracks, events, sidings and all-day states -- used whenever this repo's
// own demo calendars could not be fetched.
//
// It was a duplicate that had drifted. Different titles for the same
// appointments ("Donut Run" against the feed's "Donut Break", "Shift
// Briefing" against "Shift Handover"), a single hardcoded day where the
// feeds recur weekly, and the only tracks in the plugin with `side` and
// `line_offset` pinned by hand -- so the ordering solver never ran on the
// board most people see, and the pinned order cost four crossings on a day
// where zero was available. Bart and Lisa share three events and sat at
// opposite ends of the board.
//
// Worse, it swapped itself in SILENTLY. The demo makes seven feed fetches
// inside one 4.2 second render budget, and a device that missed it got a
// different board, with different words on it, and nothing to say so. That
// is how this was found: a panel showing appointments that do not exist in
// this repo's demo calendars.
//
// So there is one demo: the config, against this repo's own ICS files,
// through the same pipeline a real config uses. When it cannot be fetched
// the board is honestly empty. A demo that is empty beats a demo that is
// quietly a different demo.

// Demo weather, one snapshot per board. The demo has no location and must
// not make a network call, so without this nothing on a demo board ever
// draws a sky marker and nobody can see what the band looks like until
// they have set a real lat/lon and waited for the right hour of the right
// day. Every board carries a rain start, a rain stop
// and one heavier condition, so all five marker shapes are on the screen
// at once; the three boards use a different heavy condition each
// (storms/fog/snow) so every icon in MILESTONE_ICON is exercised by the
// demo somewhere.
//
// Each carries the wettest hour of its day too (`peak`), so the service
// alert can be seen on a demo board without waiting for real weather to
// breach a threshold somewhere: Springfield trips a rain alert and the
// flatmates' freezing day trips snow. Its HOURS too, so that banner says
// when the snow stops rather than only when it is heaviest.
//
// These are SNAPSHOTS in the same shape fetchWeather returns, in Celsius,
// so they go through the same materializeWeather (and the same unit
// conversion) the real forecast does rather than a second rendering path
// that could drift from it. Demo only: a real config with no lat_lon
// still shows an empty header rather than an invented forecast.
// TWO DAYS OF IT, because a rolling board draws two: with one, the demo's
// Tuesday badge said nothing about the sky while a real forecast does.
function demoDay(hi, lo, condition, icon, rain, milestones, rise, set, wet) {
  return { hi: hi, lo: lo, condition: condition, icon: icon, rain_chance: rain, milestones: milestones,
           sunrise_min: rise != null ? rise : 7 * 60 + 5, sunset_min: set != null ? set : 19 * 60 + 40,
           hours: wet ? demoHours(wet) : undefined };
}
// A demo day's hours, so its banner can say when the weather ENDS the way a
// real one does: `wet` maps an hour to [chance, weathercode], and every
// other hour of the window is a dry, partly cloudy 5%.
function demoHours(wet) {
  var out = [];
  for (var hh = DAY_START_MIN / 60; hh <= DAY_END_MIN / 60; hh++) {
    var w = wet[hh];
    out.push({ atMin: hh * 60, pct: w ? w[0] : 5, code: w ? w[1] : 2 });
  }
  return out;
}
var DEMO_WEATHER = {
  simpsons: {
    hi: 21, lo: 13, condition: 'rain', icon: 'wi-day-rain.svg', rain_chance: 60, unit: 'C',
    peak: { atMin: 14 * 60, pct: 60 },
    milestones: [
      { atMin: 13 * 60, kind: 'rain_starts' },
      { atMin: 16 * 60, kind: 'rain_stops' },
      { atMin: 20 * 60, kind: 'storms' },
    ],
    perDay: [
      demoDay(21, 13, 'rain', 'wi-day-rain.svg', 60, [
        { atMin: 13 * 60, kind: 'rain_starts' }, { atMin: 16 * 60, kind: 'rain_stops' },
        { atMin: 20 * 60, kind: 'storms' }], null, null,
        { 13: [55, 61], 14: [60, 63], 15: [55, 61], 20: [45, 95] }),
      demoDay(24, 14, 'partly_cloudy', 'wi-day-cloudy.svg', 10, []),
    ],
  },
  futurama: {
    hi: 24, lo: 15, condition: 'foggy', icon: 'wi-day-fog.svg', rain_chance: 35, unit: 'C',
    peak: { atMin: 13 * 60, pct: 35 },
    milestones: [
      { atMin: 8 * 60, kind: 'foggy' },
      { atMin: 12 * 60, kind: 'rain_starts' },
      { atMin: 14 * 60 + 30, kind: 'rain_stops' },
    ],
    perDay: [
      demoDay(24, 15, 'foggy', 'wi-day-fog.svg', 35, [
        { atMin: 8 * 60, kind: 'foggy' }, { atMin: 12 * 60, kind: 'rain_starts' },
        { atMin: 14 * 60 + 30, kind: 'rain_stops' }], null, null,
        { 8: [10, 45], 12: [35, 61], 13: [35, 61], 14: [30, 61] }),
      demoDay(27, 16, 'clear', 'wi-day-sunny.svg', 5, []),
    ],
  },
  friends: {
    hi: 1, lo: -4, condition: 'snow', icon: 'wi-day-snow.svg', rain_chance: 80, unit: 'C',
    peak: { atMin: 16 * 60, pct: 80 },
    milestones: [
      { atMin: 9 * 60, kind: 'snow' },
      { atMin: 15 * 60, kind: 'rain_starts' },
      { atMin: 17 * 60, kind: 'rain_stops' },
    ],
    perDay: [
      demoDay(1, -4, 'snow', 'wi-day-snow.svg', 80, [
        { atMin: 9 * 60, kind: 'snow' }, { atMin: 15 * 60, kind: 'rain_starts' },
        { atMin: 17 * 60, kind: 'rain_stops' }], null, null,
        { 9: [30, 71], 15: [70, 73], 16: [80, 75] }),
      demoDay(-1, -6, 'cloudy', 'wi-cloudy.svg', 20, []),
    ],
  },
};

function demoWeatherSnapshot(name) {
  return DEMO_WEATHER[String(name || '').trim().toLowerCase()] || DEMO_WEATHER.simpsons;
}

function demoWeather(strings, unit) {
  return materializeWeather(demoWeatherSnapshot(null), strings, unit);
}

// The demo can also be driven the way a real setup is: this exact config,
// against ICS files living in this repo's demo/ folder. That keeps the demo
// honest — it exercises fetching, parsing, the rule engine and track
// resolution rather than a hand-built shortcut — and doubles as a worked
// example of the config format. It needs the network, and there is no
// offline fallback behind it: the hand-written Springfield day that used to
// sit there was removed for drifting into a second, different board and for
// swapping itself in silently (see the note above). An empty demo says so.
var DEMO_ICS_BASE = 'https://raw.githubusercontent.com/ExcuseMi/trmnl-metro-calendar-plugin/main/demo/';
// A DEMO CONFIG IS A FILE IN THIS REPO, NOT A COPY OF ONE.
//
// Three of them used to be written out here as object literals, with
// `demo/<show>/config.json` generated from them by a tool and a test to catch
// the two drifting apart. That is a lot of machinery to keep one thing in two
// places: the ICS files are already fetched from the repo at run time, so the
// config beside them can be too, and then there is one copy and nothing to
// keep in step.
//
// It costs one more fetch on the demo path only, against the same host as the
// calendars, and a demo whose config will not load draws the empty board --
// which is the same answer it already gives when the calendars will not load.
function demoConfigUrl(name) {
  var set = String(name || '').trim().toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(set)) set = 'simpsons';
  return DEMO_ICS_BASE + set + '/config.json';
}
async function demoConfigOne(url, deadline) {
  try {
    var resp = await fetchWithTimeout(url, Math.max(500, msUntil(deadline)));
    if (!resp || !resp.ok) return null;
    return JSON.parse(await resp.text());
  } catch (e) {
    return null;
  }
}
async function demoConfigFor(name, deadline) {
  var got = await demoConfigOne(demoConfigUrl(name), deadline);
  // An unknown board is Springfield, as it always was. Asked for over the
  // network the answer is a 404 rather than a missing key, which is the same
  // question wearing a different hat.
  if (!got && demoConfigUrl(name) !== demoConfigUrl('simpsons')) {
    got = await demoConfigOne(demoConfigUrl('simpsons'), deadline);
  }
  return got;
}

// AN EMPTY BOARD, when there is nothing honest to draw. This used to answer
// with the hand-written Springfield day; a board that invents appointments
// rather than look empty is lying, and it lied convincingly enough to be
// taken for the real demo. The lines and the events come from where they
// always come from, or they do not come.
function buildEmpty(weather, nowMin, extra) {
  var strings = (extra && extra.strings) || I18N.en;
  var demo = demoWeather(strings, (extra && extra.tempUnit) || 'C');
  // A board that is empty because something is wrong shows no invented sky.
  var real = !!(extra && extra.notice);
  var w = weather || (real ? { milestones: [], header: null } : demo);
  return buildMetro(
    [], [],
    w.milestones || [],
    w.header || (real ? { hi: null, lo: null, condition: null, rain_chance: null } : demo.header),
    nowMin,
    timeLabel(DAY_START_MIN) + ' ' + timeLabel(DAY_END_MIN),
    [],
    Object.assign({}, extra || {}, {
      days: (extra && extra.days) || [{ label: (extra && extra.dateLabel) || null, weekday: null, weather: null }],
      serviceAlert: alertFor(extra, 0, nowMin),
    }),
    []
  );
}

// ---------------------------------------------------------------------
// Weather — Open-Meteo (no API key), same provider/icon convention as
// plugin/src/transform.js's own fetchSky(). Ported parseLatLon/weather
// code mapping rather than re-derived, for the same reason as the TZ
// helpers above: it's already correct, no need to risk a fresh bug.
// ---------------------------------------------------------------------

function parseLatLon(raw) {
  var parts = (raw || '').split(',');
  if (parts.length !== 2) return null;
  var lat = parseFloat(parts[0].trim()), lon = parseFloat(parts[1].trim());
  return (isFinite(lat) && isFinite(lon)) ? [lat, lon] : null;
}

var WEATHER_ICON_BASE = 'https://trmnl.com/images/plugins/weather/';
// code -> { label, icon } — condition text is intentionally coarse (a
// header summary, not a forecast detail); icons reuse the exact
// filenames confirmed present in plugin/src/transform.js's own ICON_FILE
// map, plus wi-day-sunny/wi-day-cloudy for the clear/cloudy default.
function weatherCodeInfo(code) {
  if (code === 0) return { key: 'clear', icon: 'wi-day-sunny.svg' };
  if (code === 1 || code === 2) return { key: 'partly_cloudy', icon: 'wi-day-cloudy.svg' };
  if (code === 3) return { key: 'cloudy', icon: 'wi-day-cloudy.svg' };
  if (code === 45 || code === 48) return { key: 'foggy', icon: 'wi-day-fog.svg' };
  // FREEZING RAIN IS NOT RAIN. 56 and 57 are freezing drizzle, 66 and 67
  // freezing rain: water that falls wet and is ice the moment it lands. It
  // sat inside the rain range, so a black-ice morning was a board that said
  // "Rain" -- and, worse, said it only if the reader had set a rain threshold
  // and the hour crossed it, while snow and thunderstorms say themselves. Of
  // everything the forecast can name this is the one most likely to change
  // what somebody does, so it is its own kind and it alerts on its own.
  // Checked before the rain range, which still contains these codes.
  if (code === 56 || code === 57 || code === 66 || code === 67) return { key: 'ice', icon: 'wi-sleet.svg' };
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return { key: 'rain', icon: 'wi-day-rain.svg' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { key: 'snow', icon: 'wi-day-snow.svg' };
  if (code >= 95) return { key: 'storms', icon: 'wi-day-thunderstorm.svg' };
  return { key: 'clear', icon: 'wi-day-sunny.svg' };
}

// "2026-09-08T07:05" (Open-Meteo local time) → minutes since midnight
function isoToMinutes(iso) {
  var m = /T(\d{2}):(\d{2})/.exec(iso || '');
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}

var RAIN_THRESHOLD = 50; // %, precipitation_probability crossing this is what draws a "Rain Starts/Stops" milestone

// A weather SNAPSHOT is language-free and unit-tagged: the condition and
// every milestone are i18n KEYS, the icon is a filename, and the
// temperatures carry the unit they were fetched in. It has to be, because
// this is what goes into trmnl_state and is replayed on a later render,
// which may be in a different language, or after the temperature unit
// setting changed, and a cached "Rain starts 15:00" in French on a board
// that is now English is worse than no weather at all.
var MILESTONE_ICON = {
  rain_starts: 'wi-rain.svg',
  rain_stops: 'wi-day-sunny.svg',
  snow: 'wi-day-snow.svg',
  storms: 'wi-day-thunderstorm.svg',
  foggy: 'wi-day-fog.svg',
};

function convertTemp(v, from, to) {
  if (v == null || typeof v !== 'number' || !isFinite(v)) return null;
  if (!from || !to || from === to) return v;
  return Math.round(from === 'C' ? v * 9 / 5 + 32 : (v - 32) * 5 / 9);
}

// A SUN AT TEN AT NIGHT SAYS THE WRONG THING.
//
// "Rain stops" is drawn as a sun, because clearing up is what it means and a
// glyph is read before any words are. After sunset that is a sun in the dark:
// rain ending at eight on a September evening put a midday sun on the strip.
//
// The board already knows when the sun went down -- every day of the snapshot
// carries its own sunrise and sunset -- so the marker takes the night's own
// clear sky instead. Only `rain_stops` has this problem: rain starting, snow
// and storms are the same fact whatever the hour.
function nightly(kind, atMin, sun) {
  if (kind !== 'rain_stops' || !sun) return MILESTONE_ICON[kind];
  var set = sun.set, rise = sun.rise;
  var afterDark = (set != null && atMin >= set) || (rise != null && atMin < rise);
  return afterDark ? 'wi-night-clear.svg' : MILESTONE_ICON[kind];
}

function materializeMilestones(list, strings, sun) {
  return (Array.isArray(list) ? list : [])
    .filter(function (m) { return m && typeof m.atMin === 'number' && isFinite(m.atMin) && MILESTONE_ICON[m.kind]; })
    .map(function (m) {
      return { atMin: m.atMin, icon: WEATHER_ICON_BASE + nightly(m.kind, m.atMin, sun), label: tr(strings, m.kind) + ' ' + timeLabel(m.atMin) };
    });
}

// The run's first day's sun, which is the day the top-level milestones are
// about (see the note on `nightly`).
function firstSun(snap, key) {
  var d = (Array.isArray(snap.perDay) ? snap.perDay : [])[0];
  if (d && typeof d[key] === 'number') return d[key];
  return typeof snap[key] === 'number' ? snap[key] : null;
}

// snapshot -> the { header, milestones } shape buildMetro takes.
function materializeWeather(snap, strings, unit) {
  if (!snap || typeof snap !== 'object') return null;
  strings = strings || I18N.en;
  unit = unit || 'C';
  var icon = typeof snap.icon === 'string' && snap.icon ? snap.icon : 'wi-day-sunny.svg';
  return {
    date: typeof snap.date === 'string' ? snap.date : null,
    header: {
      hi: convertTemp(snap.hi, snap.unit, unit),
      lo: convertTemp(snap.lo, snap.unit, unit),
      condition: tr(strings, snap.condition || 'clear'),
      rain_chance: typeof snap.rain_chance === 'number' && isFinite(snap.rain_chance) ? snap.rain_chance : null,
      icon: icon.indexOf('http') === 0 ? icon : WEATHER_ICON_BASE + icon,
      // The board draws a bare degree sign, but which unit produced the
      // number is a fact about the payload, so it travels with it.
      unit: unit,
    },
    milestones: materializeMilestones(snap.milestones, strings,
      { rise: firstSun(snap, 'sunrise_min'), set: firstSun(snap, 'sunset_min') }),
    // One forecast per day of the run, converted the same way the header
    // is: saved state outlives the temperature setting, so a snapshot
    // taken in Celsius has to come back out in whatever the board is
    // showing now, per day as well as in the header.
    perDay: (Array.isArray(snap.perDay) ? snap.perDay : []).map(function (d) {
      var di = typeof d.icon === 'string' && d.icon ? d.icon : icon;
      return {
        hi: convertTemp(d.hi, snap.unit, unit),
        lo: convertTemp(d.lo, snap.unit, unit),
        condition: tr(strings, d.condition || 'clear'),
        rain_chance: typeof d.rain_chance === 'number' && isFinite(d.rain_chance) ? d.rain_chance : null,
        icon: di.indexOf('http') === 0 ? di : WEATHER_ICON_BASE + di,
        unit: unit,
        // A day's own sky band. The board draws one day of the run, and
        // its rain markers have to be that day's.
        milestones: materializeMilestones(d.milestones, strings,
          { rise: typeof d.sunrise_min === 'number' ? d.sunrise_min : null,
            set: typeof d.sunset_min === 'number' ? d.sunset_min : null }),
        sunrise_min: typeof d.sunrise_min === 'number' ? d.sunrise_min : null,
        sunset_min: typeof d.sunset_min === 'number' ? d.sunset_min : null,
        // How long the sky takes to cross between the two (see twilightMin).
        twilight_min: typeof d.twilight_min === 'number' ? d.twilight_min : null,
      };
    }),
  };
}

// Which unit the temperatures are in. The config wins over the account
// setting, exactly as timeFormat and locale do: the board is configured
// by whoever wrote the config, not by whose account it hangs on.
//
// AUTO IS NO LONGER OFFERED, AND IS STILL ANSWERED.
//
// The setting used to have an Auto option, and to default to it: it read the
// LOCALE's region rather than a country list, so en-US came out Fahrenheit
// and everywhere else, the rest of the English-speaking world included, came
// out Celsius. It was taken out of `settings.yml` because a board guessing
// this wrong is a board a reader cannot use and there is no sign on it that a
// guess was made.
//
// A board that CHOSE Auto while it was on the menu still has `auto` stored,
// and still gets what it chose: taking the option away is not a reason to
// overrule somebody who picked it. What changes is a board that never chose
// anything at all -- it takes the declared default, Celsius, rather than a
// guess nobody asked for, so `settings.yml` and this function have one
// opinion about the default between them instead of two.
function resolveTempUnit(configUnit, settingRaw, locale) {
  var v = String(configUnit || settingRaw || '').trim().toLowerCase();
  if (v === 'c' || v === 'celsius') return 'C';
  if (v === 'f' || v === 'fahrenheit') return 'F';
  if (v === 'auto') return localeRegion(locale) === 'US' ? 'F' : 'C';
  return 'C';
}

function localeRegion(locale) {
  var parts = String(locale || '').replace('_', '-').split('-');
  for (var i = 1; i < parts.length; i++) {
    if (/^[A-Za-z]{2}$/.test(parts[i])) return parts[i].toUpperCase();
  }
  return null;
}

// THE ADDRESS THE FEED IS READ FROM. webcal:// is https in another coat, and
// a Nextcloud calendar's public link (`/apps/calendar/p/<token>`) is the web
// page showing it: the calendar itself is that token's export under
// `/remote.php/dav/public-calendars/`, on the same server and path.
//
// Google's Belgian holidays are `<lang>.be#holiday`, not `<lang>.belgian`,
// which Google answers with a 500. The config editor's wizard wrote the
// second for a while, so a board set up with it is read from the first.
function feedKey(url, headers) { return url + (headers ? ' ' + JSON.stringify(headers) : ''); }

// A HOLIDAY FEED ON SIGHT. Every public holiday calendar Google serves
// lives at `<lang>.<country>#holiday@group.v.calendar.google.com`, so a
// link of that shape needs no word after it to say what it is. Any other
// provider still needs the word (or `holiday: true`); an explicit `false`
// wins over the guess.
function looksLikeHolidayFeed(url) {
  return /calendar\.google\.com\/calendar\/ical\/[^/]*(?:%23|#)holiday(?:%40|@)group\.v\.calendar\.google\.com/i.test(String(url || ''));
}

function feedUrl(url) {
  var u = String(url || '').trim();
  if (/^webcal:\/\//i.test(u)) u = 'https://' + u.slice('webcal://'.length);
  var nc = /^(https?:\/\/[^?#]*?)\/(?:index\.php\/)?apps\/calendar\/(?:p|embed)\/([A-Za-z0-9]+)\/?(?:[?#].*)?$/i.exec(u);
  if (nc) u = nc[1] + '/remote.php/dav/public-calendars/' + nc[2] + '/?export';
  u = u.replace(/^(https:\/\/calendar\.google\.com\/calendar\/ical\/[a-z]{2}(?:[-_][a-z]+)?)\.belgian((?:%23|#)holiday(?:%40|@))/i, '$1.be$2');
  return u;
}

// "2026-09-14T07:12" as minutes after that day's midnight; null otherwise.
// Minutes into `dayKey`'s day, so a sunset after midnight is 1504 and not
// 64: a location far from the board's own zone sets its sun on the next day
// of that zone ("why is night stopping at 12am").
// HOW LONG DUSK LASTS, WORKED OUT RATHER THAN GUESSED.
//
// The board shades the dark hours, and it was going from full daylight to
// full night between two pixels because sunset is ONE MINUTE: it is the
// instant the sun's upper limb crosses the horizon, not a period. The period
// is twilight -- civil twilight, which ends when the sun is six degrees
// below -- and that is the half hour a household actually reads as "getting
// dark".
//
// The forecast does not carry it. Open-Meteo's daily block offers sunrise,
// sunset, daylight_duration and sunshine_duration, and no twilight of any
// kind, so there is nothing to ask for. It does not need asking for: it is
// astronomy, and the two things it depends on are the latitude, which the
// board is configured with, and the date, which it has.
//
// Thirty-five minutes flat was the first answer and it is wrong everywhere
// except the middle of Europe in spring. Dusk is about twenty minutes at the
// equator and over an hour in Scotland in June, and a board that shades half
// an hour of a Shetland midsummer evening as night is telling a household
// something false about their own window.
//
//   cos H = (sin a - sin lat . sin dec) / (cos lat . cos dec)
//
// is the hour angle at which the sun stands at altitude `a`. Sunrise and
// sunset are taken at -0.833 degrees (the sun's own width plus how much the
// atmosphere bends its light), civil twilight at -6, and the gap between the
// two hour angles is the length of the dusk. Four minutes to the degree,
// because the sky turns fifteen degrees an hour.
//
// The declination is the standard one-term approximation, good to about a
// quarter of a degree, which is a minute or so of twilight -- well inside
// what anybody can see on a shaded band.
var SUN_HORIZON_DEG = -0.833;
var SUN_CIVIL_DEG = -6;
function twilightMin(lat, dayKey) {
  if (typeof lat !== 'number' || !isFinite(lat)) return null;
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dayKey || ''));
  if (!m) return null;
  var d = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  var doy = Math.floor((d - Date.UTC(+m[1], 0, 0)) / 86400000);
  var rad = Math.PI / 180;
  var dec = -23.44 * Math.cos(rad * (360 / 365) * (doy + 10));
  function hourAngle(altDeg) {
    var c = (Math.sin(rad * altDeg) - Math.sin(rad * lat) * Math.sin(rad * dec))
          / (Math.cos(rad * lat) * Math.cos(rad * dec));
    // Past the poles the sun never reaches that altitude: the day never ends
    // (c < -1) or never begins (c > 1). Either way there is no crossing to
    // measure a twilight from, so the caller is told nothing rather than a
    // number out of a domain error.
    if (c < -1 || c > 1) return null;
    return Math.acos(c) / rad;
  }
  var h0 = hourAngle(SUN_HORIZON_DEG), h1 = hourAngle(SUN_CIVIL_DEG);
  if (h0 == null || h1 == null) return null;
  return Math.max(1, Math.round((h1 - h0) * 4));
}

function clockMin(iso, dayKey) {
  var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(iso || ''));
  if (!m) return null;
  var mins = (+m[4]) * 60 + (+m[5]);
  var k = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayKey || ''));
  if (k) mins += Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(+k[1], +k[2] - 1, +k[3])) / 86400000) * 1440;
  return mins;
}

// Returns a SNAPSHOT (see above), not rendered strings, so the caller can
// put it straight into trmnl_state.
// `opts.localSun` is the EXAMPLE DAY'S weather: the sun is asked for in the
// location's own clock, so an example board whose location is six hours from
// the account's zone still gets a morning sunrise and an evening sunset. A
// real day does not do this: if the calendars are yours and the location is
// New York, the dark hours on a Brussels clock really do run to lunchtime.
async function fetchWeather(latLonRaw, tz, deadline, unit, opts) {
  var latlon = parseLatLon(latLonRaw);
  if (!latlon) return null;
  try {
    var params = new URLSearchParams({
      latitude: String(latlon[0]), longitude: String(latlon[1]),
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode,sunrise,sunset',
      // weathercode per hour too, in the same request: it is what lets the
      // banner say snow or thunderstorms for the hours it names rather than
      // for the day as a whole.
      // ...and the temperature per hour, which is what holds the cold and
      // heat banners to the clock: the daily max is a fact about a day, and
      // a board reads it at eight in the evening.
      hourly: 'precipitation_probability,weathercode,temperature_2m',
      temperature_unit: unit === 'F' ? 'fahrenheit' : 'celsius',
      timezone: (opts && opts.localSun) ? 'auto' : tz, forecast_days: String(DAY_SPAN),
    });
    var budget = msUntil(deadline);
    if (budget <= 0) return null;
    var resp = await fetchWithTimeout('https://api.open-meteo.com/v1/forecast?' + params.toString(), Math.min(budget, 3000));
    if (!resp.ok) { warn('the forecast answered HTTP ' + resp.status + '; the board keeps the last one it had'); return null; }
    var body = await resp.json();
    var daily = body.daily || {};
    var info = weatherCodeInfo((daily.weathercode || [])[0]);

    var hourly = body.hourly || {};
    var times = hourly.time || [];
    var probs = hourly.precipitation_probability || [];
    var codes = hourly.weathercode || [];
    var degs = hourly.temperature_2m || [];

    // Every in-window hour of every day of the run, kept apart BY DAY, out
    // of the SAME hourly array the milestones came from. The service alert
    // has to name an hour and a probability, and this is the only place
    // both are known; deriving them later would mean a second call to the
    // forecast API for numbers this response already carried.
    //
    // Two reasons it is the whole day's hours and not just the wettest one
    // of them. The response covers the RUN of days and the board draws one
    // of them, so the wettest hour in the response may belong to a day
    // nobody is looking at. And the snapshot outlives the fetch by hours
    // (see resolveWeather), so the hour that was worth warning about when
    // it went out can be over by the time it is read; the banner picks its
    // hour at draw time, against the clock, and needs the day behind it to
    // pick a different one.
    var dayKeys = [];
    var dayHours = [];
    for (var j = 0; j < times.length; j++) {
      var pm = /^(\d{4}-\d{2}-\d{2})T(\d{2}):/.exec(times[j]);
      if (!pm) continue;
      var pMin = (+pm[2]) * 60;
      if (pMin < DAY_START_MIN || pMin > DAY_END_MIN) continue;
      var p = probs[j];
      if (typeof p !== 'number' || !isFinite(p)) continue;
      var dk = dayKeys.indexOf(pm[1]);
      if (dk < 0) { dk = dayKeys.length; dayKeys.push(pm[1]); dayHours.push([]); }
      var hour = { atMin: pMin, pct: p };
      if (typeof codes[j] === 'number' && isFinite(codes[j])) hour.code = codes[j];
      if (typeof degs[j] === 'number' && isFinite(degs[j])) hour.deg = degs[j];
      dayHours[dk].push(hour);
    }
    var peak = wettestHour(dayHours[0], null);

    // Milestones: first threshold up-crossing -> "Rain Starts", the next
    // down-crossing after it -> "Rain Stops", within ONE day. Reading
    // straight down the response instead put tomorrow's crossings on
    // today's board as soon as today had fewer than two of its own, and
    // carried "it is raining" across the midnight gap, so a dry 07:00
    // tomorrow became a "Rain Stops 07:00" drawn six hours BEFORE the
    // "Rain Starts 13:00" it belonged to. A day's rain starts and stops
    // within that day or not at all.
    function milestonesFor(hours) {
      var out = [];
      var wasAbove = false;
      (hours || []).forEach(function (h) {
        if (out.length >= 2) return;
        var above = h.pct >= RAIN_THRESHOLD;
        if (above && !wasAbove) out.push({ atMin: h.atMin, kind: 'rain_starts' });
        else if (!above && wasAbove) out.push({ atMin: h.atMin, kind: 'rain_stops' });
        wasAbove = above;
      });
      return out;
    }
    var milestones = milestonesFor(dayHours[0]);

    var rain = Math.round((daily.precipitation_probability_max || [])[0]);
    var hi = Math.round((daily.temperature_2m_max || [])[0]);
    var lo = Math.round((daily.temperature_2m_min || [])[0]);
    // One entry per day the board may draw. The header of a two-day board
    // that shows a single high and low is telling the truth about one of
    // the days and inventing it for the other.
    var perDay = [];
    for (var pd = 0; pd < DAY_SPAN; pd++) {
      var pdHi = (daily.temperature_2m_max || [])[pd];
      if (pdHi == null) break;
      var pdInfo = weatherCodeInfo((daily.weathercode || [])[pd]);
      perDay.push({
        hi: Math.round(pdHi),
        lo: Math.round((daily.temperature_2m_min || [])[pd]),
        rain_chance: Math.round((daily.precipitation_probability_max || [])[pd]),
        // the KEY, not a label: this is a snapshot, and the string it
        // becomes depends on a language that can change between the fetch
        // and the render
        condition: pdInfo.key, icon: pdInfo.icon,
        hours: dayHours[pd] || [],
        // WHEN IT IS LIGHT, as minutes into that day, so the board can shade
        // the dark either side of it. Null where the service did not say.
        sunrise_min: clockMin((daily.sunrise || [])[pd], (daily.time || [])[pd]),
        sunset_min: clockMin((daily.sunset || [])[pd], (daily.time || [])[pd]),
        // ...and how long the sky takes to get there, for this latitude on
        // this date (see twilightMin). The board shades the shoulders of the
        // night lighter than its middle.
        // The day's own key, or the sunrise's, which carries the same date:
        // `daily.time` is always there in a real answer and this does not
        // need to depend on that.
        twilight_min: twilightMin(latlon[0], (daily.time || [])[pd] || (daily.sunrise || [])[pd]),
        peak: wettestHour(dayHours[pd], null),
        milestones: milestonesFor(dayHours[pd]),
      });
    }
    return {
      hi: isFinite(hi) ? hi : null,
      lo: isFinite(lo) ? lo : null,
      condition: info.key,
      icon: info.icon,
      // an absent probability stays absent: rendered as "0% rain" it reads
      // as a forecast of a dry day rather than as a missing number
      rain_chance: isFinite(rain) ? rain : null,
      unit: unit === 'F' ? 'F' : 'C',
      // Which civil day this snapshot's day 0 IS. A snapshot outlives its
      // fetch by hours and can outlive the day: without this, a forecast
      // taken at 23:30 is read at 04:00 as if its first day were the day
      // the reader is standing in, which is how yesterday's rain becomes
      // this morning's alert.
      // (an example day's run is read against the board's own day, since its
      // dates are the location's and may be a day either side of it)
      date: (opts && opts.localSun && opts.dateKey) || (daily.time || [])[0] || dayKeys[0] || null,
      peak: peak,
      perDay: perDay,
      milestones: milestones,
    };
  } catch (e) {
    return null;
  }
}

// One place decides what weather the board shows: today's forecast if the
// API answers, otherwise the last snapshot that DID answer, out of saved
// state, flagged stale once it is old enough to be a different day's
// weather. Before this a single failed call blanked the header and every
// sky marker until the next refresh, which is the one thing an outage
// should not do to a board that had the answer fifteen minutes ago.
//
// The raw SNAPSHOT travels back out alongside the materialized weather:
// the service alert needs the unrendered facts (which hour is wettest, the
// condition key, the temperatures in the unit they were fetched in), and
// materializeWeather has already turned those into header strings by the
// time the caller sees them. Reading it back off the header would mean
// parsing "60" out of a localized string.
async function resolveWeather(latLonRaw, tz, deadline, state, unit, strings, started, opts) {
  if (!latLonRaw) return { weather: null, stale: false, snapshot: null };
  var snap = started ? await started : await fetchWeather(latLonRaw, typeof tz === 'string' ? tz : 'GMT', deadline, unit, opts);
  var nowS = Math.floor(Date.now() / 1000);
  if (snap) {
    if (state) { state.weather = snap; state.weatherFetchedAt = nowS; }
    return { weather: materializeWeather(snap, strings, unit), stale: false, snapshot: snap };
  }
  var saved = state && state.weather;
  if (!saved) return { weather: null, stale: false, snapshot: null };
  return {
    weather: materializeWeather(saved, strings, unit),
    stale: (nowS - ((state && state.weatherFetchedAt) || 0)) > WEATHER_STALE_AFTER_S,
    snapshot: saved,
  };
}

// ---------------------------------------------------------------------
// Service alert: the weather banner.
//
// One line along the bottom edge when the forecast has something in it
// worth changing a plan for: "Weather: Rain from 14:00 until 17:00, 80%
// chance". "This has to be really useful to justify its screen space", so
// it names WHEN, and when the weather ends as well as when it starts: rain
// at 14:00 is a coat, rain until 17:00 is whether to wait it out. The label,
// the message and the icon travel apart because the template sets them
// apart, and the message is composed and translated HERE, in full, because
// the template can print a string but cannot pick a preposition.
//
// It reads the snapshot resolveWeather already resolved, so it costs the
// render nothing: no second forecast call, no slice of the shared
// deadline, and a device running on the last good snapshot out of saved
// state still gets its alert. A snapshot written by an older build has no
// hours, or hours with no weathercode in them, and is read for what it has
// rather than filled in: no code is the day's condition, no hours is the
// one wettest hour it saved or nothing.
// ---------------------------------------------------------------------

// A blank number field is not zero. Read as zero, an unset "cold at or
// below" would fire on every frost in Celsius and never once in Fahrenheit,
// which is the same setting behaving differently depending on a field the
// reader did not touch either. Blank is null, and the caller decides what
// null means for that field.
function numSetting(input, key) {
  var raw = cf(input, key).trim();
  if (!raw) return null;
  var n = Number(raw);
  return isFinite(n) ? n : null;
}

function alertSettings(input, unit, strings, hour12) {
  return {
    enabled: cf(input, 'alert_enabled').trim().toLowerCase() === 'true', // default OFF: an alert nobody asked for is an alert nobody trusts
    // blank is no rain alert: the form fills in 70, so an empty field is
    // somebody who emptied it
    rainThreshold: numSetting(input, 'alert_rain_threshold'),
    // blank is the default for the board's unit (see TEMP_DEFAULTS)
    tempLow: numSetting(input, 'alert_temp_low'),
    tempHigh: numSetting(input, 'alert_temp_high'),
    unit: unit, strings: strings, hour12: hour12,
  };
}

// "I wouldn't even know what temps I want to be alerted at." So nobody has
// to: a blank cold or heat field is a frost and a hot day in the board's own
// unit, and the fields are there for whoever does know. Per unit rather
// than converted, so each is the round number a reader of that scale would
// have typed.
var TEMP_DEFAULTS = { C: { low: 0, high: 30, freezing: 0 }, F: { low: 32, high: 86, freezing: 32 } };

// The icon is the event, not a generic warning sign: the glyph is read
// before the words are, and a snowflake has already said half the sentence.
var ALERT_ICON = {
  rain: 'wi-rain.svg', snow: 'wi-snow.svg', storms: 'wi-thunderstorm.svg',
  ice: 'wi-sleet.svg',
  heat: 'wi-hot.svg', cold: 'wi-snowflake-cold.svg',
};

// Freezing rain, snow and thunderstorms alert whenever they are likely at all:
// there is no setting for them, because nobody wants a threshold for snow.
// Likely is RAIN_THRESHOLD, this file's own line between weather and
// precipitation (it is what draws a rain_starts marker).
//
// IN THIS ORDER, and the order is the rule the banner is picked by: how much
// of the day has to change because of it. Ice first -- it is the one that
// takes a road away rather than making it unpleasant, and a reader who sees
// only one of these should see that one.
var SEVERE_KINDS = ['ice', 'snow', 'storms'];

// What falls in one hour, as a banner kind. An hour from an older build
// carries no code and reads as its day did (a snowy day's wet hours were
// snow, every other day's were rain), which is what the banner said before
// it had codes. A dry code on an hour over the reader's rain line is still
// rain: the probability is the number the reader drew the line on, and the
// two models behind the two numbers do not always agree.
function hourKind(h, dayCondition) {
  if (typeof h.code !== 'number' || !isFinite(h.code)) return dayCondition === 'snow' ? 'snow' : 'rain';
  var k = weatherCodeInfo(h.code).key;
  return (k === 'snow' || k === 'storms' || k === 'ice') ? k : 'rain';
}

// One day's hours, in order, with anything malformed dropped rather than
// defaulted: a snapshot is saved state, and an older build wrote a
// different shape.
function cleanHours(hours) {
  return (Array.isArray(hours) ? hours : []).filter(function (h) {
    return h && typeof h.atMin === 'number' && isFinite(h.atMin)
      && typeof h.pct === 'number' && isFinite(h.pct);
  }).sort(function (a, b) { return a.atMin - b.atMin; });
}

// The wettest hour at or after `from` minutes past midnight, out of one
// day's hourly probabilities: what a snapshot saves as its `peak`. Ties go
// to the earlier hour, which is the one you would move something out of.
function wettestHour(hours, from) {
  var best = null;
  cleanHours(hours).forEach(function (h) {
    if (from != null && h.atMin < from) return;
    if (!best || h.pct > best.pct) best = { atMin: h.atMin, pct: h.pct };
  });
  return best;
}

// THE NEXT SPELL OF WEATHER, start to end. The first hour that is `wet` and
// not over yet, grown both ways through the hours next to it that are wet
// too. An hour is over once the next one starts: at 14:30 the 14:00 hour is
// still falling, and that is "it is raining now", which is exactly what
// there is to say. An hour that has gone is never the alert, because an
// alert is a promise about what is COMING, and "Rain at 09:00" read at
// seven in the evening is a wrong statement about a morning everyone
// already lived through.
//
// `end` is when the last wet hour ends; `toEnd` says the spell runs off the
// end of the hours we have, so there is no end to name; `pct` is the most
// likely hour still ahead, not one already behind.
function wetRun(hours, from, wet) {
  var i = 0;
  for (; i < hours.length; i++) {
    if (wet(hours[i]) && (from == null || hours[i].atMin + 60 > from)) break;
  }
  if (i >= hours.length) return null;
  var s = i, e = i;
  while (s > 0 && wet(hours[s - 1]) && hours[s].atMin - hours[s - 1].atMin === 60) s--;
  while (e < hours.length - 1 && wet(hours[e + 1]) && hours[e + 1].atMin - hours[e].atMin === 60) e++;
  var pct = 0;
  for (var k = i; k <= e; k++) pct = Math.max(pct, hours[k].pct);
  return { start: hours[s].atMin, end: hours[e].atMin + 60, pct: pct, toEnd: e === hours.length - 1 };
}

// `opts.dayIx` is which day of the run the board is drawing and
// `opts.nowMin` what time it is, both of which only the build knows (see
// alertFor). Without them this reads the whole forecast and can warn about
// tomorrow's rain on today's board, or about an hour that has gone.
function serviceAlert(snap, opts) {
  if (!opts || !opts.enabled || !snap || typeof snap !== 'object') return null;
  var strings = opts.strings || I18N.en;
  function banner(kind, key, vars, styles, tail) {
    var tpl = tr(strings, key) + (tail || '');
    return { kind: kind, icon: WEATHER_ICON_BASE + ALERT_ICON[kind],
             text: fmt(tpl, vars),
             // the same sentence in pieces, for the banner to set (see segments)
             parts: segments(tpl, vars, styles) };
  }
  // WHAT THE READER CAME FOR IS LIT; THE SENTENCE AROUND IT IS NOT.
  //
  // The clock is the thing somebody scans a weather line for -- "from when,
  // until when" -- so the times stay full black and the words joining them go
  // quiet. The probability goes quiet with them: 80% or 96%, it is raining
  // either way, and the number qualifies the news rather than being it. What
  // is coming stays bold, because it is the one word that decides whether the
  // rest is worth reading at all.
  //
  // In the spell sentences {t} and {u} are both the clock -- {u} being either
  // an end time or the words a language ends an open-ended spell with, "into
  // the night", which is that sentence's until and is lit like one. In the
  // temperature ones {u} is the unit and belongs with the number it
  // qualifies.
  //
  // THE THING IS BOLD, NOT BADGED. It wore `.metro-pill` for a while, which
  // is the board's own badge, white with the word knocked out of it: "Rain as
  // a pill looks bad". On the hour strip a badge is a mark among numbers and
  // reads as a different kind of thing; in a line of running text it reads as
  // a button.
  var WHEN = { _: 'q', what: 'b', t: '', u: '', p: 'q' };
  var DEG = { _: 'q', _0: 'b', v: 'b', u: 'b', r: '' };
  function clock(min) { return timeLabel12(min, { hour12: opts.hour12 }); }

  var dayIx = (typeof opts.dayIx === 'number' && opts.dayIx > 0) ? opts.dayIx : 0;
  var day = (Array.isArray(snap.perDay) && snap.perDay[dayIx]) || null;
  var condition = day ? day.condition : snap.condition;
  // The caller hands over a clock only when the day on the board is the
  // day we are standing in. Every hour of a later day is still ahead,
  // including its early ones.
  var from = (typeof opts.nowMin === 'number' && isFinite(opts.nowMin)) ? opts.nowMin : null;
  var hours = day && Array.isArray(day.hours) ? cleanHours(day.hours) : null;

  // A spell of `kind`, worded by how much of it is left: "from 14:00 until
  // 17:00" ahead of it, "until 17:00" once it has started, and no end at
  // all when it runs past the last hour we have.
  function spell(kind, wet) {
    var run = wetRun(hours, from, wet);
    if (!run) return null;
    var started = from != null && run.start <= from;
    var key = run.toEnd ? (started ? 'alert_rest_of_day' : 'alert_from_on')
      : (started ? 'alert_until' : 'alert_from_until');
    return banner(kind, key, { what: tr(strings, 'alert_kind_' + kind), t: clock(run.start),
                               // ...and where the spell runs off the end of the hours there is
                               // no end to name, so {u} is the language's own words for that.
                               u: run.toEnd ? tr(strings, started ? 'alert_all_day' : 'alert_night')
                                            : clock(run.end),
                               p: Math.round(run.pct) }, WHEN);
  }
  // A snapshot from a build that saved one wettest hour and no day behind
  // it. There is no spell to find, so it is that hour or nothing, still
  // held to the clock, and it can only ever have been today's.
  var peak = (!hours && dayIx === 0) ? (cleanHours(snap.peak ? [snap.peak] : [])[0] || null) : null;
  if (peak && from != null && peak.atMin + 60 <= from) peak = null;
  function around(kind) {
    return banner(kind, 'alert_around', { what: tr(strings, 'alert_kind_' + kind), t: clock(peak.atMin),
                                          p: Math.round(peak.pct) }, WHEN);
  }

  // One banner, so the kinds are ranked by how much of the day has to
  // change because of them: snow and storms stop travel outright, a
  // temperature extreme is an all-day fact you dress for, rain is an hour
  // you move something out of. Rain last also keeps the commonest breach
  // from burying the rarer ones on a day that trips several.
  for (var sk = 0; sk < SEVERE_KINDS.length; sk++) {
    var kind = SEVERE_KINDS[sk];
    var severe = hours
      ? spell(kind, function (h) { return h.pct >= RAIN_THRESHOLD && hourKind(h, condition) === kind; })
      : (kind === 'snow' && peak && condition === 'snow' && peak.pct >= RAIN_THRESHOLD ? around('snow') : null);
    if (severe) return severe;
  }

  // The day on the board, falling back to the top-level forecast for a
  // snapshot that has no run of days in it.
  var unit = opts.unit === 'F' ? 'F' : 'C';
  var lines = TEMP_DEFAULTS[unit];
  var low = opts.tempLow != null ? opts.tempLow : lines.low;
  var high = opts.tempHigh != null ? opts.tempHigh : lines.high;
  var lo = convertTemp(day ? day.lo : snap.lo, snap.unit, unit);
  var hi = convertTemp(day ? day.hi : snap.hi, snap.unit, unit);

  // COLD AND HEAT ARE A STRETCH OF THE DAY, NOT THE DAY.
  //
  // They used to be read off the daily max and min, which is a fact about a
  // whole day and has no hour in it, so a board at eight in the evening went
  // on warning about an afternoon everyone had already lived through -- and
  // the minimum it warned about was usually five in the morning, long before
  // anybody looked. The hours carry their own temperature now, so the alert
  // is the run of them that breaches the line and is still AHEAD, held to the
  // clock exactly the way rain is (see wetRun), and the degree it names is
  // the extreme of that run rather than of the day.
  //
  // It says which stretch, in brackets after the sentence. Two clocks and a
  // dash read the same in every language the board speaks, so the range is
  // written here rather than in the copy: no translator has to be waited for,
  // and a device still holding an older table gets it in its own language.
  function degOf(h) {
    var d = convertTemp(h.deg, snap.unit, unit);
    return (typeof d === 'number' && isFinite(d)) ? d : null;
  }
  var hasDeg = !!(hours && hours.some(function (h) { return degOf(h) != null; }));
  // The hour we are standing in is the first one that counts: at 14:30 the
  // 14:00 hour is still running, and a range that opens at 06:00 is telling
  // somebody about their own morning.
  var nowHour = from != null ? Math.floor(from / 60) * 60 : null;
  function degRun(hot) {
    function hit(h) {
      var d = degOf(h);
      return d != null && (hot ? d >= high : d <= low);
    }
    var run = wetRun(hours, from, hit);
    if (!run) return null;
    var start = (nowHour != null && run.start < nowHour) ? nowHour : run.start;
    var ext = null;
    hours.forEach(function (h) {
      if (h.atMin < start || h.atMin >= run.end || !hit(h)) return;
      var d = degOf(h);
      if (ext == null || (hot ? d > ext : d < ext)) ext = d;
    });
    return ext == null ? null : { start: start, end: run.end, deg: ext };
  }
  function degBanner(kind, key, run) {
    return banner(kind, key, { v: Math.round(run.deg), u: unit,
                               r: clock(run.start) + '\u2013' + clock(run.end) }, DEG, ' ({r})');
  }

  // "Freezing" only where it is: a reader who set cold at 5 degrees is told
  // it is cold, not that it freezes.
  // ...AND IN WHICH SCALE. "Hot, up to 36" is a different sentence in the two
  // halves of the world the board is set up for, and the banner is the one
  // line of words on it that somebody else might read.
  if (hasDeg) {
    var coldRun = degRun(false);
    if (coldRun) {
      return degBanner('cold', coldRun.deg <= lines.freezing ? 'alert_freezing' : 'alert_chilly', coldRun);
    }
    var heatRun = degRun(true);
    if (heatRun) return degBanner('heat', 'alert_hot', heatRun);
  } else {
    // A snapshot from a build that saved no hourly temperature, or a day the
    // forecast answered without one. The day's own figures are all there is.
    if (lo != null && lo <= low) {
      return banner('cold', lo <= lines.freezing ? 'alert_freezing' : 'alert_chilly',
                    { v: Math.round(lo), u: unit }, DEG);
    }
    if (hi != null && hi >= high) return banner('heat', 'alert_hot', { v: Math.round(hi), u: unit }, DEG);
  }

  var thr = opts.rainThreshold;
  if (thr == null) return null;
  if (hours) return spell('rain', function (h) { return h.pct >= thr && hourKind(h, condition) !== 'snow'; });
  if (peak && peak.pct >= thr && condition !== 'snow') return around('rain');
  return null;
}

// How many civil days have passed since `iso` (a "YYYY-MM-DD" out of a
// snapshot), from the point of view of the civil day `today`. 0 when there
// is nothing to compare, so a snapshot that never recorded its day is read
// exactly as it was before.
function civilDaysSince(iso, today) {
  if (typeof iso !== 'string' || !today) return 0;
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return 0;
  var was = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  var now = Date.UTC(today.y, today.mo - 1, today.d);
  var d = Math.round((now - was) / 86400000);
  return isFinite(d) ? d : 0;
}

// The banner belongs to the day on the board, at the time it is being
// read, and neither of those is known where the forecast is resolved: the
// day is chosen from `show_day` deep inside the build, and the clock is
// the build's own `nowMin`. So the snapshot and the reader's thresholds
// travel in `extra` and the banner is composed here, once, by whichever
// build path ends up drawing.
function alertFor(extra, dayIx, nowMin) {
  if (!extra || !extra.alertOpts) return null;
  return serviceAlert(extra.wxSnapshot, Object.assign({}, extra.alertOpts,
    { dayIx: dayIx, nowMin: nowMin }));
}

// THE User-Agent IS FOR THE DEVICE, AND A PAGE MUST NOT BE ASKED TO SEND ONE.
//
// The runtime that renders the panel sends whatever headers it is handed,
// and a few calendar hosts want a name on the request. A browser is a
// different matter: User-Agent is not a CORS-safelisted header, so setting
// it turns a plain cross-origin GET into a preflighted one. Chrome hides
// that by dropping the header; Firefox honours it, sends the OPTIONS, and
// raw.githubusercontent.com answers OPTIONS with 403 and no
// Access-Control-Allow-Headers. Every demo file and every language file this
// transform fetches lives there, so in Firefox the config tool's preview drew
// "The example day could not be loaded" over an empty board, with the clock
// and the hour ruler falling back to the account's own locale because even
// the demo's config.json had been blocked. Chrome drew the same board fine,
// which is why it survived: the one place this runs in a browser is that
// preview. The header buys nothing there anyway: a browser puts its own
// User-Agent on every request it makes.
function defaultHeaders() {
  var inBrowser = (typeof window !== 'undefined' && typeof document !== 'undefined');
  return inBrowser ? {} : { 'User-Agent': 'TRMNL-Metro-Calendar' };
}

async function fetchWithTimeout(url, ms, extraHeaders) {
  var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  var headers = Object.assign(defaultHeaders(), extraHeaders || {});
  var timer = controller ? setTimeout(function () { controller.abort(); }, ms) : null;
  function clear() { if (timer) { clearTimeout(timer); timer = null; } }
  var resp;
  try {
    resp = await fetch(url, controller ? { signal: controller.signal, headers: headers } : { headers: headers });
  } catch (e) { clear(); throw e; }
  if (!resp || !resp.ok) { clear(); return resp; }
  // THE BODY IS INSIDE THE TIME TOO. The timer used to stop when the headers
  // came, and a feed that answered at once and then sent its two hundred
  // kilobytes slowly held the render past the runtime's limit. Reading it is
  // raced against the same abort, in case a runtime's fetch does not stop a
  // body it is still reading when the signal fires.
  function bounded(read) {
    return function () {
      var reading = Promise.resolve().then(function () { return read.call(resp); });
      var cut = controller ? new Promise(function (_, reject) {
        if (controller.signal.aborted) reject(new Error('timed out'));
        controller.signal.addEventListener('abort', function () { reject(new Error('timed out')); });
      }) : null;
      return (cut ? Promise.race([reading, cut]) : reading)
        .then(function (v) { clear(); return v; }, function (e) { clear(); throw e; });
    };
  }
  return { ok: resp.ok, status: resp.status, text: bounded(resp.text), json: bounded(resp.json) };
}

// One feed's text within what is left of the deadline: { ok, text }, or null
// where it could not be had at all. Never throws.
async function fetchFeedText(url, deadline, headers) {
  var budget = msUntil(deadline);
  if (budget <= 0) return null;
  try {
    var resp = await fetchWithTimeout(url, budget, headers);
    // The status travels with the failure: "HTTP 403" and "HTTP 500" are
    // different problems with different fixes, and dropping it here made
    // every one of them read "did not answer" in the log.
    if (!resp || !resp.ok) return { ok: false, text: '', status: resp ? resp.status : 0 };
    return { ok: true, text: await resp.text() };
  } catch (e) { return null; }
}

// ---------------------------------------------------------------------
// A PERSON KEEPS THEIR STYLE. The page hands out textures and the renderer
// hands out shades down a ladder, by the legend's order: the first person
// solid black, then dotted, dashed, beaded... A day on which somebody was
// dropped, or the feeds answered in another order, restyled everybody, and
// a board the household had learned to read overnight said Kato was Ward.
// Each person is given a RUNG once, kept in the saved state by name, and
// keeps it as long as they are on the board ("as long the tracks didn't
// change, reuse the once assigned track styles"). Somebody new takes the
// lowest free rung; a shared calendar's line is a ladder and takes none.
// ---------------------------------------------------------------------
function assignLineSlots(lines, state) {
  var saved = (state && state.lineSlots) || {};
  var people = (lines || []).filter(function (l) { return !l.shared; });
  var names = people.map(function (l) { return l.name; });
  var slots = {}, used = {};
  people.forEach(function (l) {
    var sl = saved[l.name];
    if (typeof sl === 'number' && !used[sl]) { slots[l.name] = sl; used[sl] = true; }
  });
  var next = 0;
  people.forEach(function (l) {
    if (slots[l.name] != null) return;
    while (used[next]) next++;
    slots[l.name] = next; used[next] = true;
  });
  people.forEach(function (l) { l.slot = slots[l.name]; });
  if (state) {
    // remembered for everybody on the board today; a name gone for good
    // drops out, and its rung is free again next time
    var keep = {};
    names.forEach(function (n) { keep[n] = slots[n]; });
    state.lineSlots = keep;
  }
  return lines;
}

// ---------------------------------------------------------------------
// THE NEWS. A few headlines from RSS or Atom feeds the household names --
// the local paper, the school, the club -- drawn along the foot of the map
// like the platform display under a station's departure board. Read here,
// with no XML parser to lean on: a feed's leaf elements never nest a tag
// of their own name, so finding each <item> or <entry> and then its <title>
// inside it is enough (the shape the comic library plugin reads with).
// ---------------------------------------------------------------------

var NEWS_MAX_ITEMS = 6;          // what travels: the board draws at most a few rows
var NEWS_TITLE_MAX = 140;
var NEWS_SOURCE_MAX = 40;
var NEWS_STALE_AFTER_S = 6 * 3600;   // older than this and a saved headline is dropped rather than shown

function xmlAttrs(str) {
  var attrs = {}, re = /([\w:-]+)\s*=\s*"([^"]*)"|([\w:-]+)\s*=\s*'([^']*)'/g, m;
  while ((m = re.exec(str || '')) !== null) attrs[(m[1] || m[3]).replace(/^[\w-]+:/, '')] = m[2] !== undefined ? m[2] : m[4];
  return attrs;
}

// Every <localName> directly in `xml`, with any namespace prefix: { attrs, content }.
function xmlElements(xml, localName) {
  var out = [], openRe = new RegExp('<(?:[\\w-]+:)?' + localName + '\\b([^>]*?)(\\/)?>', 'gi'), m;
  while ((m = openRe.exec(xml)) !== null) {
    if (m[2]) { out.push({ attrs: xmlAttrs(m[1]), content: null }); continue; }
    var rest = xml.slice(openRe.lastIndex);
    var close = rest.match(new RegExp('<\\/(?:[\\w-]+:)?' + localName + '\\s*>', 'i'));
    if (close) { out.push({ attrs: xmlAttrs(m[1]), content: rest.slice(0, close.index) }); openRe.lastIndex += close.index + close[0].length; }
    else out.push({ attrs: xmlAttrs(m[1]), content: '' });
  }
  return out;
}

// The words of an element: CDATA unwrapped, markup stripped, entities read,
// whitespace folded. A headline is one line of plain text or it is nothing.
function xmlText(content) {
  if (content == null) return '';
  var s = String(content);
  var cd = s.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  if (cd) s = cd[1];
  s = s.replace(/<[^>]*>/g, ' ');
  s = s.replace(/&(#x([0-9a-f]+)|#(\d+)|amp|lt|gt|quot|apos|nbsp);/gi, function (all, body, hex, dec) {
    if (hex) return String.fromCharCode(parseInt(hex, 16));
    if (dec) return String.fromCharCode(parseInt(dec, 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[body.toLowerCase()] || all;
  });
  // ...twice, for a feed that escaped its escapes ("&amp;quot;")
  s = s.replace(/&(amp|lt|gt|quot|apos);/gi, function (all, body) { return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[body.toLowerCase()]; });
  return s.replace(/\s+/g, ' ').trim();
}

// A feed's name as the band prints it: the site, not its slogan. "VRT NWS -
// Binnenland" is the section, which the headline already implies.
function newsSourceName(title) {
  var t = xmlText(title).replace(/\s*[|>\u2013\u2014-]\s*(rss|atom|feed|news|nieuws|actualit\u00e9s|nachrichten|noticias|notizie|wiadomo\u015bci|not\u00edcias)\b.*$/i, '');
  // ...nor its section after a colon: "VRT NWS: nieuws", "HLN:home"
  // (nor after a ">" or a colon: "NYT > Top Stories", "VRT NWS: nieuws")
  var parts = t.split(/\s+[|>\u2013\u2014-]\s+|\s*:\s*/).map(function (x) { return x.trim(); }).filter(Boolean);
  // ...and where the first part is only a section, the site is the second:
  // "World news | The Guardian" is The Guardian
  var cut = parts[0] || '';
  if (parts.length > 1 && /^(world|world news|home|top stories|headlines|news|latest|latest news)$/i.test(cut)) cut = parts[1];
  return (cut || t).slice(0, NEWS_SOURCE_MAX);
}

function parseNewsFeed(xml) {
  var s = String(xml || '');
  if (/<rss[\s>]/i.test(s) || /<channel[\s>]/i.test(s)) {
    var ch = xmlElements(s, 'channel')[0];
    if (!ch) return null;
    var chXml = ch.content || '', firstItem = chXml.search(/<(?:[\w-]+:)?item\b/i);
    var head = firstItem < 0 ? chXml : chXml.slice(0, firstItem);
    var t0 = xmlElements(head, 'title')[0];
    return { title: newsSourceName(t0 ? t0.content : ''), items: xmlElements(chXml, 'item').map(function (el) {
      var ix = el.content || '', tt = xmlElements(ix, 'title')[0], pd = xmlElements(ix, 'pubDate')[0] || xmlElements(ix, 'date')[0];
      return { title: xmlText(tt ? tt.content : ''), at: pd ? Date.parse(xmlText(pd.content)) : NaN };
    }) };
  }
  if (/<feed[\s>]/i.test(s)) {
    var fd = xmlElements(s, 'feed')[0];
    if (!fd) return null;
    var fXml = fd.content || '', firstEntry = fXml.search(/<(?:[\w-]+:)?entry\b/i);
    var fHead = firstEntry < 0 ? fXml : fXml.slice(0, firstEntry);
    var ft = xmlElements(fHead, 'title')[0];
    return { title: newsSourceName(ft ? ft.content : ''), items: xmlElements(fXml, 'entry').map(function (el) {
      var ex = el.content || '', et = xmlElements(ex, 'title')[0];
      var when = xmlElements(ex, 'published')[0] || xmlElements(ex, 'updated')[0];
      return { title: xmlText(et ? et.content : ''), at: when ? Date.parse(xmlText(when.content)) : NaN };
    }) };
  }
  return null;
}

// The News setting: one link per row, a `#` starting a remark, and any words
// beside the link ignored so a pasted "VRT https://..." still reads.
function newsLinks(raw) {
  var out = [];
  String(raw || '').split(/\r?\n/).forEach(function (line) {
    var t = line.replace(/#.*$/, '').trim();
    if (!t) return;
    t.split(/\s+/).forEach(function (w) { if (/^(https?:\/\/|webcal:\/\/)/i.test(w) && out.indexOf(w) < 0) out.push(feedUrl(w)); });
  });
  return out.slice(0, 8);
}

// Every feed asked at once inside the render's deadline; the newest headline
// of each feed in turn, so a busy wire does not drown the school's one
// notice a week; and what was read last time where nothing answers now.
async function fetchNews(urls, deadline, state, nowS, max, fit) {
  if (!urls.length) return null;
  var key = urls.join('\n');
  var got = await Promise.all(urls.map(async function (u) {
    var r = await fetchFeedText(u, deadline);
    if (!r || !r.ok) { warn('the news feed ' + u + ' ' + (r ? 'answered HTTP ' + r.status : 'did not answer')); return null; }
    var f = parseNewsFeed(r.text);
    if (!f) { warn('the news feed ' + u + ' is not RSS or Atom'); return null; }
    f.items = f.items.filter(function (it) { return it.title; })
      .sort(function (p, q) { return (isFinite(q.at) ? q.at : 0) - (isFinite(p.at) ? p.at : 0); });
    return f;
  }));
  var feeds = got.filter(function (f) { return f && f.items.length; });
  var items = [];
  for (var round = 0; items.length < NEWS_MAX_ITEMS; round++) {
    var any = false;
    feeds.forEach(function (f) {
      if (items.length >= NEWS_MAX_ITEMS || round >= f.items.length) return;
      any = true;
      items.push({ title: f.items[round].title.slice(0, NEWS_TITLE_MAX), source: f.title });
    });
    if (!any) break;
  }
  if (items.length) {
    if (state) state.news = { items: items, key: key, fetchedAt: nowS };
    return { items: items, max: max, fit: !!fit };
  }
  var saved = state && state.news;
  if (saved && saved.key === key && nowS - saved.fetchedAt <= NEWS_STALE_AFTER_S) return { items: saved.items, max: max, fit: !!fit };
  return null;
}

// Unfold RFC5545 continuation lines (a line starting with a space/tab
// continues the previous one) and split into logical lines.
function unfoldIcs(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

// A comma-separated ICS list value, split on the separators only: a comma
// the writer escaped belongs to the value it sits in.
function icsList(value) {
  var out = [], cur = '';
  for (var i = 0; i < value.length; i++) {
    var c = value.charAt(i);
    if (c === '\\' && i + 1 < value.length) { cur += c + value.charAt(i + 1); i++; continue; }
    if (c === ',') { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map(function (v) { return unescapeIcsText(v).trim(); }).filter(Boolean);
}

function unescapeIcsText(v) {
  return v.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

// Parses a raw DTSTART/DTEND value+params into {y,mo,d,h,mi,isAllDay},
// converted to civil LOCAL (fallbackTz) date/time — this is the "what
// date/time does this property mean, in our target zone" step, kept
// separate from "does that land on today" so the same parsed value can
// be reused for both a direct hit and the weekly-recurrence check below.
function parseIcsDateTime(paramsStr, value, fallbackTz, floating) {
  if (/VALUE=DATE\b/i.test(paramsStr) || /^\d{8}$/.test(value)) {
    var dm = /^(\d{4})(\d{2})(\d{2})/.exec(value);
    return dm ? { isAllDay: true, y: +dm[1], mo: +dm[2], d: +dm[3] } : { isAllDay: true };
  }

  var m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (!m) return null;
  var evY = +m[1], evMo = +m[2], evD = +m[3], evH = +m[4], evMi = +m[5], evS = +m[6], isUtc = !!m[7];

  var tzidMatch = /TZID=([^:;]+)/.exec(paramsStr);
  var epochMs;
  // A CALENDAR WHOSE ZONE IS A LIE: `ignoreTimezone` reads every time in it
  // as the wall-clock time it says, in the board's own zone. A bin-day
  // generator asked for 19:00 writes "190000Z", which is nine at night in
  // Belgium in summer and eight in winter -- no fixed shift fixes both.
  if (isUtc && floating) { isUtc = false; tzidMatch = null; }
  if (isUtc) {
    epochMs = Date.UTC(evY, evMo - 1, evD, evH, evMi, evS);
  } else {
    var eventTz = (tzidMatch && safeZone(tzidMatch[1])) || fallbackTz;
    epochMs = zonedTimeToUtc(evY, evMo, evD, evH, evMi, evS, eventTz);
  }
  var c = fromEpoch(epochMs, fallbackTz);
  c.isAllDay = false;
  return c;
}

// How many days of data transform gathers: today and tomorrow. The board
// draws ONE of them, chosen by the Show setting.
//
// A run of days on one axis was built and thrown away. On a panel this
// size it does not earn its place: three days of a family's week is three
// columns of an hour each, and what a wall calendar is for is the day you
// are in. The day model it needed stays, because it is right for its own
// reasons: absolute minutes across the run are what let a recurrence be
// evaluated per day and an event crossing midnight stay one event.
var DAY_SPAN = 2;

// A QUIET DAY BORROWS THE NEXT ONE.
//
// Two appointments on a day leave a board that is mostly empty paper, and
// the hours it is spending that paper on are hours nobody has anything in.
// Past this many events on the day being shown the board is the day itself;
// at or below it the window runs on past midnight into the next morning and
// afternoon, which is the part of "what is coming" a quiet day has to say.
//
// Counted on the day being SHOWN, over the whole of it rather than from the
// clock forwards. From the clock forwards the count falls as the day goes
// by, so a board with four meetings on it would flip into the rolling view
// somewhere in the afternoon and flip back at midnight: the panel refreshes
// every fifteen minutes and the shape of the board may not change under a
// reader between two of them. One decision per civil day, taken the same
// way at breakfast and at bedtime.
var QUIET_DAY_MAX_EVENTS = 2;
// The rolling window, in minutes from the shown day's own midnight: six in
// the morning to six in the evening of the day after it, which is the
// 36 hours the spec asks for. Anchored to the day and not to the clock,
// for the same reason the count is.
var ROLL_START_MIN = 6 * 60;
var ROLL_END_MIN = 1440 + 18 * 60;
// ...AND FURTHER WHEN TODAY IS ALREADY SPENT.
//
// Six in the evening of the following day is the right end for a board that
// opens this morning: past that it is asking a reader at breakfast to care
// about the night after next. It is the wrong end for a board read at ten at
// night, which has almost no today left in it -- nearly the whole axis is
// tomorrow already, and cutting tomorrow at six wall the one evening the
// reader is actually planning for.
//
// This is what the "Show: today, then tomorrow from the evening" setting used
// to be for, and it bought the same thing by DELETING today: at nine it threw
// away the rest of the evening while people were standing in front of the
// board. Stretching the end instead keeps both.
var ROLL_END_LATE_MIN = 1440 + 23 * 60;
// WHAT IS LEFT OF TODAY, NOT WHAT TODAY HAD, AND ONLY IN TWO STEPS.
//
// Counting the whole day answers "was this a quiet day", and nobody asks
// that. The question a board on a wall is standing there to answer is
// "what is coming", and it is asked in the evening, when a busy Tuesday
// has one thing left on it and eleven that already happened: a board that
// still calls that day busy spends itself on a morning nobody can attend
// any more.
//
// So the day is counted from a boundary that moves, and it moves exactly
// once, because a window keyed to the clock rescales under the reader
// every time the panel refreshes -- everything sliding left by a few
// pixels every fifteen minutes. Two shapes a day, at an hour anybody can
// predict, is the same contract the evening switch-over already has and
// gentler in what it does.
//
// FOUR IN THE AFTERNOON, and it was noon first. Noon is not the middle of
// a family's day, it is the middle of its working one: at 12:01 most of
// what a household does is still ahead of it, and a board that drops the
// morning then has thrown away half a day nobody had finished. Four is
// after school and before anybody is home, which is the same reasoning
// that put the switch-over at nine rather than six.
//
// The morning is not thrown away in any case: what falls before the
// window is counted at the leading edge as "+N earlier", which is an
// affordance the board already draws.
var ROLL_SPLIT_MIN = 16 * 60;
// THE WINDOW STEPS THROUGH THE DAY, ON FIXED HOURS, WHATEVER THE DAY HAS.
//
// One boundary at four only ever moved the board once, and only on a quiet
// day: at two in the afternoon a busy Tuesday was still spending its paper
// on a morning nobody could attend any more -- "why show the early morning
// events at 2pm?" The thing the single boundary protected is that the shape
// may not change under a reader between two refreshes, and that is a rule
// about the clock being read continuously, not about rolling. So the window
// steps, at hours anybody can predict, and opens two hours before the step
// so what just happened is still on the board.
var ROLL_STEPS_MIN = [10 * 60, 13 * 60, 16 * 60, 19 * 60];
var ROLL_LOOKBACK_MIN = 2 * 60;
// A SECOND FIXED HOUR WAS TRIED HERE AND WAS THE WRONG SHAPE OF ANSWER.
//
// Counting from four and never re-counting meant a day with three or more
// things after four never reached tomorrow at all, so an unconditional
// boundary at nine was added to force it. That is guessing at what the count
// could simply be asked: at a quarter past eight the same board still drew
// only Saturday, because nine had not come round yet. The count is taken on
// the hour now (see countFrom) and the guess is gone.

// Civil date arithmetic, deliberately not epoch arithmetic: "the day after
// the 30th" is a calendar question, and answering it by adding 86400
// seconds gets it wrong on the two days a year a zone changes offset.
function addCivilDays(d, n) {
  var t = new Date(Date.UTC(d.y, d.mo - 1, d.d + n));
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

// RECURRENCE. Does a series with this RRULE fire on this civil date?
//
// Weekly used to be all there was, on the grounds that standing meetings
// and family routines are weekly. Then the feeds strangers actually paste
// in: a daily standup, the first Tuesday of the month, a course that runs
// "10 times" (COUNT, which Google and Outlook both write for "ends after N
// occurrences"). COUNT was the worst of it: ignored, a ten-week course ran
// on the board for ever, which is wrong rather than incomplete.
//
// So this reads the parts calendars write: FREQ DAILY / WEEKLY / MONTHLY /
// YEARLY, INTERVAL, UNTIL, COUNT, BYDAY (with an ordinal, "2TU", "-1FR"),
// BYMONTHDAY (negative from the month's end), BYMONTH, BYSETPOS and WKST.
// A rule with parts that make several occurrences a day (BYHOUR with more
// than one value, and so on), or that pick days by week number or day of
// the year, is refused: its first date still shows, nothing is made up.
//
// Arithmetic on civil dates throughout, in UTC milliseconds, so no zone
// and no clock change can move a day. A period is the unit INTERVAL counts
// (a day, a week from WKST, a month, a year); the candidates are the dates
// the BY parts pick inside one period. Without COUNT only the period that
// holds the date is looked at; with COUNT the series is walked from its
// start, and stops as soon as it has spent its count or passed the date.
var WD_NAMES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
var R_DAY = 24 * 60 * 60 * 1000;
function rruleParts(rruleValue) {
  var parts = {};
  String(rruleValue || '').split(';').forEach(function (kv) {
    var i = kv.indexOf('=');
    if (i > 0) parts[kv.slice(0, i).trim().toUpperCase()] = kv.slice(i + 1).trim();
  });
  return parts;
}
function rNums(v) {
  return v == null ? null : String(v).split(',').map(function (x) { return parseInt(x, 10); })
    .filter(function (n) { return !isNaN(n) && n !== 0; });
}
function rOrd(y, mo, d) { return Date.UTC(y, mo - 1, d); }
function rDaysIn(y, mo) { return new Date(Date.UTC(y, mo, 0)).getUTCDate(); }
function rWeekday(ord) { return (new Date(ord).getUTCDay() + 6) % 7; }   // 0 = Monday
// BYDAY as [{ wd, n }], n 0 for "every such weekday"
function rByDay(v) {
  if (!v) return null;
  var out = [];
  String(v).split(',').forEach(function (x) {
    var m = /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/i.exec(x.trim());
    if (m) out.push({ wd: WD_NAMES.indexOf(m[2].toUpperCase()), n: m[1] ? parseInt(m[1], 10) : 0 });
  });
  return out.length ? out : null;
}
// The dates, as ordinals, that BYDAY picks within [from, from + len days).
function rWeekdaysIn(byday, from, len) {
  var hits = [];
  byday.forEach(function (b) {
    var all = [];
    for (var i = 0; i < len; i++) if (rWeekday(from + i * R_DAY) === b.wd) all.push(from + i * R_DAY);
    if (!b.n) hits = hits.concat(all);
    else {
      var pick = b.n > 0 ? all[b.n - 1] : all[all.length + b.n];
      if (pick != null) hits.push(pick);
    }
  });
  return hits;
}
function rUnique(list) {
  var seen = {}, out = [];
  list.sort(function (a, b) { return a - b; }).forEach(function (v) { if (!seen[v]) { seen[v] = true; out.push(v); } });
  return out;
}
function rSetPos(list, setpos) {
  if (!setpos) return list;
  var out = [];
  setpos.forEach(function (n) { var v = n > 0 ? list[n - 1] : list[list.length + n]; if (v != null) out.push(v); });
  return rUnique(out);
}
// Candidates in the period that starts at period index `k` of the series.
function rCandidates(r, k) {
  var st = r.start, out = [];
  if (r.freq === 'DAILY') {
    var dOrd = st.ord + k * R_DAY;
    var dd = new Date(dOrd);
    if (r.bymonth && r.bymonth.indexOf(dd.getUTCMonth() + 1) < 0) return [];
    if (r.bymonthday) {
      var dim = rDaysIn(dd.getUTCFullYear(), dd.getUTCMonth() + 1);
      if (!r.bymonthday.some(function (n) { return (n > 0 ? n : dim + n + 1) === dd.getUTCDate(); })) return [];
    }
    if (r.byday && !r.byday.some(function (b) { return !b.n && b.wd === rWeekday(dOrd); })) return [];
    return [dOrd];
  }
  if (r.freq === 'WEEKLY') {
    var wk = st.weekStart + k * 7 * R_DAY;
    if (r.byday) out = rWeekdaysIn(r.byday.map(function (b) { return { wd: b.wd, n: 0 }; }), wk, 7);
    else out = [wk + ((st.wd - r.wkst + 7) % 7) * R_DAY];
    if (r.bymonth) out = out.filter(function (o) { return r.bymonth.indexOf(new Date(o).getUTCMonth() + 1) >= 0; });
    return rSetPos(rUnique(out), r.bysetpos);
  }
  function inMonth(y, mo) {
    var first = rOrd(y, mo, 1), dim = rDaysIn(y, mo), days = [];
    if (r.bymonthday) {
      r.bymonthday.forEach(function (n) { var d = n > 0 ? n : dim + n + 1; if (d >= 1 && d <= dim) days.push(rOrd(y, mo, d)); });
      if (r.byday) days = days.filter(function (o) { return r.byday.some(function (b) { return b.wd === rWeekday(o); }); });
    } else if (r.byday) {
      days = rWeekdaysIn(r.byday, first, dim);
    } else if (st.d <= dim) {
      days = [rOrd(y, mo, st.d)];
    }
    return days;
  }
  if (r.freq === 'MONTHLY') {
    var mIx = st.y * 12 + (st.mo - 1) + k, my = Math.floor(mIx / 12), mm = mIx % 12 + 1;
    if (r.bymonth && r.bymonth.indexOf(mm) < 0) return [];
    return rSetPos(rUnique(inMonth(my, mm)), r.bysetpos);
  }
  // YEARLY
  var yy = st.y + k;
  if (r.bymonth) {
    r.bymonth.forEach(function (mo) { if (mo >= 1 && mo <= 12) out = out.concat(inMonth(yy, mo)); });
  } else if (r.byday && !r.bymonthday) {
    var y0 = rOrd(yy, 1, 1);
    out = rWeekdaysIn(r.byday, y0, Math.round((rOrd(yy + 1, 1, 1) - y0) / R_DAY));
  } else if (r.bymonthday) {
    out = inMonth(yy, st.mo);
  } else if (st.d <= rDaysIn(yy, st.mo)) {
    out = [rOrd(yy, st.mo, st.d)];
  }
  return rSetPos(rUnique(out), r.bysetpos);
}
// The period index holding `ord`, or -1 before the series.
function rPeriodOf(r, ord) {
  var st = r.start, t = new Date(ord);
  if (r.freq === 'DAILY') return Math.round((ord - st.ord) / R_DAY);
  if (r.freq === 'WEEKLY') {
    var wkOf = ord - ((rWeekday(ord) - r.wkst + 7) % 7) * R_DAY;
    return Math.round((wkOf - st.weekStart) / (7 * R_DAY));
  }
  if (r.freq === 'MONTHLY') return (t.getUTCFullYear() * 12 + t.getUTCMonth()) - (st.y * 12 + st.mo - 1);
  return t.getUTCFullYear() - st.y;
}
function compileRrule(rruleValue, dtstart, tz) {
  var p = rruleParts(rruleValue);
  var freq = (p.FREQ || '').toUpperCase();
  if (['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].indexOf(freq) < 0) return null;
  if (p.BYWEEKNO || p.BYYEARDAY) return null;
  var many = function (v) { return v != null && String(v).indexOf(',') >= 0; };
  if (many(p.BYHOUR) || many(p.BYMINUTE) || many(p.BYSECOND)) return null;
  var wkst = p.WKST ? WD_NAMES.indexOf(p.WKST.toUpperCase()) : 0;
  var ord = rOrd(dtstart.y, dtstart.mo, dtstart.d), wd = rWeekday(ord);
  var r = {
    freq: freq, interval: Math.max(1, parseInt(p.INTERVAL, 10) || 1),
    count: p.COUNT ? parseInt(p.COUNT, 10) : null,
    byday: rByDay(p.BYDAY), bymonthday: rNums(p.BYMONTHDAY), bymonth: rNums(p.BYMONTH), bysetpos: rNums(p.BYSETPOS),
    wkst: wkst < 0 ? 0 : wkst,
    start: { y: dtstart.y, mo: dtstart.mo, d: dtstart.d, ord: ord, wd: wd, h: dtstart.h || 0, mi: dtstart.mi || 0 },
    until: null,
  };
  if (p.BYDAY && !r.byday) return null;
  r.start.weekStart = ord - ((wd - r.wkst + 7) % 7) * R_DAY;
  // UNTIL is inclusive, and a timed one is a moment: 20260915T065959Z ends
  // a series of 09:00 Brussels meetings BEFORE that morning's.
  if (p.UNTIL) {
    var u = parseIcsDateTime(/^\d{8}$/.test(p.UNTIL) ? 'VALUE=DATE' : '', p.UNTIL, tz);
    if (u && u.y) r.until = { ord: rOrd(u.y, u.mo, u.d), min: u.isAllDay ? 24 * 60 : u.h * 60 + u.mi };
  }
  return r;
}
function rBeforeUntil(r, ord) {
  if (!r.until) return true;
  if (ord !== r.until.ord) return ord < r.until.ord;
  return r.start.h * 60 + r.start.mi <= r.until.min;
}
// COMPILED ONCE PER EVENT, not once per (day, back-step) it is asked about.
// `occurrenceBack` asks this for every day the board's window spans, and
// again for every day of an all-day event's own span looking backwards for
// which occurrence covers it -- a custody week asks it up to seven times
// over for the SAME series. `compileRrule` re-parses the RRULE string and
// rebuilds `start`/`weekStart` from scratch each time, all of it a pure
// function of the event alone. Keyed on the event object rather than the
// rrule string: two different VEVENTs sharing byte-identical RRULE text
// (a shared weekly meeting, say) still have their own DTSTART and must not
// share a cache entry.
var RRULE_CACHE = new WeakMap();
function compiledRruleFor(ev, tz) {
  if (!RRULE_CACHE.has(ev)) RRULE_CACHE.set(ev, compileRrule(ev.rrule, ev.dtstart, tz));
  return RRULE_CACHE.get(ev);
}
function rruleFiresOn(ev, y, mo, d, tz) {
  var r = compiledRruleFor(ev, tz);
  if (!r) return false;
  var target = rOrd(y, mo, d);
  if (target < r.start.ord || !rBeforeUntil(r, target)) return false;
  var k = rPeriodOf(r, target);
  if (k < 0 || k % r.interval !== 0) return false;
  if (rCandidates(r, k).indexOf(target) < 0) return false;
  if (r.count == null) return true;
  // COUNT: the start is the first occurrence whatever the parts say, then
  // the series in order until the count is spent.
  var n = 1;
  if (target === r.start.ord) return true;
  for (var pk = 0, guard = 0; pk <= k && guard < 20000; pk += r.interval, guard++) {
    var cands = rCandidates(r, pk);
    for (var i = 0; i < cands.length; i++) {
      if (cands[i] <= r.start.ord) continue;
      n++;
      if (n > r.count) return false;
      if (cands[i] === target) return true;
    }
  }
  return false;
}

// `includeDescription` (a per-calendar config flag, off by default) is the
// only thing that makes parseIcs pay for DESCRIPTION at all — it's usually
// a large multi-line blob and most calendars' rules never need it.
//
// Returns { timed, allDay } — allDay entries carry no time-of-day (they're
// {title, desc, status} only): only whole-day coverage decides whether one
// applies today, matched to the day's own civil date, not a UTC one.
// `days` is the run of civil dates the board covers, day 0 first. Every
// minute this returns is ABSOLUTE on that run: 09:00 on day 1 is 1980, not
// 540. One number line for the whole board is what lets a night be a
// stretch of axis like any other, an event that crosses midnight be one
// event, and every downstream comparison stay a plain comparison. A single
// day is the same code with a list of one.
function parseIcs(text, tz, days, includeDescription, floating) {
  var today = days[0];
  var rows = unfoldIcs(text);
  var raw = [];
  var cur = null;
  // The feed's own name. A config that names its calendars never needs it,
  // but the simplest setup there is — a list of ICS links and nothing else
  // — has no other way to know whose row this is.
  var calName = null;
  rows.forEach(function (row) {
    if (row === 'BEGIN:VEVENT') { cur = {}; return; }
    if (row === 'END:VEVENT') { if (cur) raw.push(cur); cur = null; return; }
    // A TO-DO IS A MOMENT AT ITS DUE TIME: "I just want to know when to set
    // them up, not when they are picked up." A bin-day feed exported as tasks
    // says "put the bins out" by the evening before; that minute is the stop.
    // Done or cancelled, it is not on the board.
    if (row === 'BEGIN:VTODO') { cur = { todo: true }; return; }
    if (row === 'END:VTODO') {
      if (cur && !cur.completed && cur.status !== 'COMPLETED' && cur.status !== 'CANCELLED') {
        var at = cur.due || cur.dtstart;
        if (at) { cur.dtstart = at; cur.dtend = at.isAllDay ? null : at; raw.push(cur); }
      }
      cur = null; return;
    }
    if (!cur) {
      if (row.indexOf('X-WR-CALNAME:') === 0) calName = unescapeIcsText(row.slice('X-WR-CALNAME:'.length)).trim() || null;
      return;
    }
    var idx = row.indexOf(':');
    if (idx < 0) return;
    var keyPart = row.slice(0, idx);
    var value = row.slice(idx + 1);
    var key = keyPart.split(';')[0];
    var params = keyPart.slice(key.length);
    if (key === 'DTSTART') cur.dtstart = parseIcsDateTime(params, value, tz, floating);
    else if (key === 'DTEND') cur.dtend = parseIcsDateTime(params, value, tz, floating);
    else if (key === 'DUE') cur.due = parseIcsDateTime(params, value, tz, floating);
    else if (key === 'COMPLETED') cur.completed = true;
    else if (key === 'SUMMARY') cur.title = unescapeIcsText(value);
    else if (key === 'LOCATION') cur.location = unescapeIcsText(value);
    // CATEGORIES is a LIST, and the property may appear more than once.
    // Split before unescaping, or an escaped comma inside one category
    // ("Kids\, school") becomes a separator and one category becomes two.
    else if (key === 'CATEGORIES') cur.categories = (cur.categories || []).concat(icsList(value));
    else if (key === 'DESCRIPTION' && includeDescription) cur.desc = unescapeIcsText(value);
    else if (key === 'STATUS') cur.status = value.trim().toUpperCase();
    else if (key === 'RRULE') cur.rrule = value;
    else if (key === 'UID') cur.uid = value.trim();
    else if (key === 'RECURRENCE-ID') cur.recurrenceId = parseIcsDateTime(params, value, tz, floating);
    // EXDATE: the occurrences of a series that were taken OUT of it. A
    // standup you deleted for one day is still in the file, as a rule that
    // fires and a date that says not this time; without this the board
    // shows a meeting the calendar says is not happening. Comma-separated
    // and repeatable, so both forms are collected.
    else if (key === 'EXDATE') {
      value.split(',').forEach(function (v) {
        var ex = parseIcsDateTime(params, v.trim(), tz, floating);
        if (!ex) return;
        (cur.exdates = cur.exdates || {})[ex.y + '-' + ex.mo + '-' + ex.d] = true;
      });
    }
  });

  var DAY_MS = 24 * 60 * 60 * 1000;
  var dayInfo = days.map(function (d) {
    return {
      d: d,
      weekday: (new Date(Date.UTC(d.y, d.mo - 1, d.d)).getUTCDay() + 6) % 7,
      key: d.y + '-' + d.mo + '-' + d.d,
      ordinal: Date.UTC(d.y, d.mo - 1, d.d),
    };
  });

  // A RECURRENCE-ID override (same UID, own DTSTART/SUMMARY) REPLACES the
  // master's occurrence on that specific date — without this, an edited
  // or moved single instance of a recurring event shows up twice: once
  // from the master's own weekly-RRULE match, once from the override's
  // own direct-hit DTSTART. Suppress the master on any date an override
  // for its UID targets, keyed by civil date (not exact minute) since
  // that's what RECURRENCE-ID identifies — "which occurrence", not "what
  // time it now is". Applies equally to timed and all-day masters.
  var overriddenDates = {};
  raw.forEach(function (ev) {
    if (!ev.uid || !ev.recurrenceId) return;
    overriddenDates[ev.uid + '|' + ev.recurrenceId.y + '-' + ev.recurrenceId.mo + '-' + ev.recurrenceId.d] = true;
  });

  var out = [], allDay = [];
  // WHICH OCCURRENCE COVERS THIS DAY. A series (or a single event) whose
  // occurrence starts `back` days before `di` and runs `spanDays` days covers
  // it. Every question below is this one: a one-day event asks with a span
  // of one, a night shift asks yesterday too, a custody week asks the six
  // days before as well.
  function occurrenceBack(ev, di, spanDays) {
    for (var back = 0; back < spanDays; back++) {
      var ord = di.ordinal - back * DAY_MS, od = new Date(ord);
      var y = od.getUTCFullYear(), mo = od.getUTCMonth() + 1, d = od.getUTCDate();
      var key = y + '-' + mo + '-' + d;
      var hit = (ev.dtstart.y === y && ev.dtstart.mo === mo && ev.dtstart.d === d)
        || (ev.rrule && rruleFiresOn(ev, y, mo, d, tz));
      if (!hit) continue;
      if (!ev.recurrenceId && ev.uid && overriddenDates[ev.uid + '|' + key]) continue;
      if (ev.exdates && ev.exdates[key]) continue;   // taken out of the series
      return { back: back, weekday: (od.getUTCDay() + 6) % 7 };
    }
    return null;
  }
  function pushAllDay(ev, di, dayIx, spanDays, back, weekday) {
    // HOW LONG IT RUNS, AND HOW FAR INTO IT THIS DAY IS. A board that draws
    // one day out of a week of half term can say which day of it that is,
    // and that ordinal is the only thing telling the Monday of Spring Break
    // from the Thursday. Counted per occurrence, so a repeating week-long
    // rota says "day 3 of 7" too.
    allDay.push({ title: ev.title, desc: ev.desc || '', status: ev.status || '',
      location: ev.location || '', categories: ev.categories || [], day: dayIx,
      span: spanDays, index: back, weekday: weekday });
  }
  raw.forEach(function (ev) {
    if (!ev.title || !ev.dtstart) return;

    if (ev.dtstart.isAllDay) {
      // Whole-day coverage: DTEND is EXCLUSIVE per RFC5545 (a single-day
      // all-day event has DTEND the day AFTER DTSTART); no DTEND means a
      // single day.
      var startOrd = Date.UTC(ev.dtstart.y, ev.dtstart.mo - 1, ev.dtstart.d);
      var endOrd = (ev.dtend && ev.dtend.isAllDay) ? Date.UTC(ev.dtend.y, ev.dtend.mo - 1, ev.dtend.d) : startOrd + DAY_MS;
      var spanDays = Math.max(1, Math.round((endOrd - startOrd) / DAY_MS));
      dayInfo.forEach(function (di, dayIx) {
        var o = occurrenceBack(ev, di, spanDays);
        if (o) pushAllDay(ev, di, dayIx, spanDays, o.back, o.weekday);
      });
      return;
    }

    // HOW LONG, FROM THE DATES AS WELL AS THE CLOCKS. Worked out from the
    // times of day alone, a custody week from Friday six to Friday six was
    // nought minutes long, and a night shift was only ever seen on the
    // evening it began. Civil minutes, so a clock change does not stretch it.
    var durationMin = null;
    if (ev.dtend && !ev.dtend.isAllDay) {
      durationMin = Math.round((Date.UTC(ev.dtend.y, ev.dtend.mo - 1, ev.dtend.d, ev.dtend.h, ev.dtend.mi)
        - Date.UTC(ev.dtstart.y, ev.dtstart.mo - 1, ev.dtstart.d, ev.dtstart.h, ev.dtstart.mi)) / 60000);
      if (durationMin < 0) durationMin = null;
    }

    // A DAY OR MORE IS A STATE, NOT A STOP. A week at the other parent's,
    // a three-day conference written with times: nothing on a scale of
    // hours can hold it, so it is read the way a multi-day all-day entry
    // is, at the head of the line with the day of it this is.
    if (durationMin != null && durationMin >= 1440) {
      var endDayMin = ev.dtstart.h * 60 + ev.dtstart.mi + durationMin;
      var spanT = Math.max(1, Math.ceil(endDayMin / 1440));
      dayInfo.forEach(function (di, dayIx) {
        var o = occurrenceBack(ev, di, spanT);
        if (o) pushAllDay(ev, di, dayIx, spanT, o.back, o.weekday);
      });
      return;
    }

    dayInfo.forEach(function (di, dayIx) {
      // Starting today; and on the first day of the run, one that started
      // yesterday and is still going (the night shift), because the day
      // before the run is not in it to have been counted there.
      var o = occurrenceBack(ev, di, 1);
      var startMin;
      if (o) {
        startMin = dayIx * 1440 + ev.dtstart.h * 60 + ev.dtstart.mi;
      } else if (dayIx === 0 && durationMin != null && ev.dtstart.h * 60 + ev.dtstart.mi + durationMin > 1440) {
        var prev = { ordinal: di.ordinal - DAY_MS };
        o = occurrenceBack(ev, prev, 1);
        if (!o) return;
        startMin = -1440 + ev.dtstart.h * 60 + ev.dtstart.mi;
      } else {
        return;
      }
      out.push({
        title: ev.title,
        desc: ev.desc || '',
        status: ev.status || '',
        location: ev.location,
        categories: ev.categories || [],
        day: dayIx,
        weekday: o.weekday,
        startMin: startMin,
        endMin: durationMin != null ? startMin + durationMin : null,
        todo: ev.todo ? true : undefined,
      });
    });
  });
  return { timed: out, allDay: allDay, calName: calName };
}

// ---------------------------------------------------------------------
// Rule engine — ported from plugin/src/transform.js's own compileMatcher/
// compileRule/compileRuleList/parseConfig/applyCalendarRules (same config
// shape, same semantics). See the file header for the feature summary.
// ---------------------------------------------------------------------

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A `track` field can be one name or a list — always normalized to a
// non-empty array (or null if nothing usable was given).
function normalizeNameList(raw) {
  var list = Array.isArray(raw) ? raw : (typeof raw === 'string' ? [raw] : []);
  var names = list.filter(function (n) { return typeof n === 'string' && n.trim(); }).map(function (n) { return n.trim(); });
  return names.length ? names : null;
}

function compileMatcher(spec) {
  if (!spec || typeof spec !== 'object') return null;
  if (spec.type === 'any' || spec.type === 'all') {
    return { rx: /[\s\S]*/i, test: function () { return true; } };
  }
  if (spec.type === 'and' || spec.type === 'or') {
    var subs = (Array.isArray(spec.matchers) ? spec.matchers : []).map(compileMatcher).filter(Boolean);
    if (!subs.length) return null;
    var isAnd = spec.type === 'and';
    return { rx: null, usesDesc: subs.some(function (m) { return m.usesDesc; }), test: function (ctx) {
      return isAnd ? subs.every(function (m) { return m.test(ctx); }) : subs.some(function (m) { return m.test(ctx); });
    } };
  }
  // Negation — the only way to express "everything except X" without this
  // used to be a regex negative lookahead, which meant hand-writing
  // backslash-heavy JSON (\\b) that's easy to mis-escape when copying
  // through a browser field. {"type":"not","matcher":{...}} covers the
  // common case with zero backslashes.
  if (spec.type === 'not') {
    // `matcher`, or `matchers` read as "none of these": written the second
    // way it used to compile to nothing and drop its whole rule, silently.
    var negated = compileMatcher(spec.matcher
      || (Array.isArray(spec.matchers) && (spec.matchers.length === 1 ? spec.matchers[0] : { type: 'or', matchers: spec.matchers })));
    if (!negated) return null;
    return { rx: null, usesDesc: negated.usesDesc, test: function (ctx) { return !negated.test(ctx); } };
  }
  if (spec.type === 'status') {
    var want = typeof spec.value === 'string' ? spec.value.trim().toUpperCase() : '';
    if (!want) return null;
    return { rx: null, test: function (ctx) { return ctx.status === want; } };
  }
  if (spec.type === 'weekday') {
    var rawDays = Array.isArray(spec.value) ? spec.value : [spec.value];
    var wanted = {};
    var any = false;
    rawDays.forEach(function (v) {
      if (typeof v !== 'string') return;
      var idx = WD_NAMES.indexOf(v.trim().toUpperCase().slice(0, 2));
      if (idx !== -1) { wanted[idx] = true; any = true; }
    });
    if (!any) return null;
    return { rx: null, test: function (ctx) { return ctx.weekday !== null && ctx.weekday !== undefined && !!wanted[ctx.weekday]; } };
  }
  // How long the event runs, in minutes. What it is FOR is the shape of a
  // day rather than its words: a block that lasts all morning is a
  // different kind of thing from a half-hour meeting, whatever either is
  // called, and "anything over four hours is a siding" says that once
  // instead of listing every status block a household can invent.
  if (spec.type === 'duration') {
    var dMin = finiteOr(spec.min, null), dMax = finiteOr(spec.max, null);
    if (dMin == null && dMax == null) return null;
    return { rx: null, test: function (ctx) {
      if (ctx.durationMin == null) return false;
      if (dMin != null && ctx.durationMin < dMin) return false;
      if (dMax != null && ctx.durationMin > dMax) return false;
      return true;
    } };
  }
  // When it starts, as minutes past the event's own midnight. `from` is
  // inclusive and `to` exclusive, so 07:00-09:00 and 09:00-12:00 tile
  // without either claiming nine o'clock twice.
  if (spec.type === 'time') {
    var tFrom = hhmmToMin(spec.from), tTo = hhmmToMin(spec.to);
    if (tFrom == null && tTo == null) return null;
    return { rx: null, test: function (ctx) {
      if (ctx.startOfDayMin == null) return false;
      if (tFrom != null && ctx.startOfDayMin < tFrom) return false;
      if (tTo != null && ctx.startOfDayMin >= tTo) return false;
      return true;
    } };
  }
  if (typeof spec.value !== 'string') return null;
  var p = spec.value.trim();
  if (!p) return null;
  var rx;
  if (spec.type === 'regex') {
    try { rx = new RegExp(p, 'i'); } catch (e) { return null; }
  } else if (spec.type === 'contains') {
    rx = new RegExp(escapeRegExp(p), 'i');
  } else if (spec.type === 'exact') {
    rx = new RegExp('^' + escapeRegExp(p) + '$', 'i');
  } else {
    rx = new RegExp('\\b' + escapeRegExp(p) + '\\b', 'i');
  }
  var field = MATCH_FIELDS[String(spec.field || '').trim().toLowerCase()] ? String(spec.field).trim().toLowerCase() : null;
  return {
    rx: rx,
    // Only an EXPLICIT request for the description makes a calendar fetch
    // it (see parseConfig): the default field already reads it when the
    // calendar opted in, and asking for it by name is opting in.
    usesDesc: field === 'description' || field === 'any',
    test: function (ctx) {
      var parts = fieldTexts(ctx, field);
      for (var i = 0; i < parts.length; i++) if (parts[i] && rx.test(parts[i])) return true;
      return false;
    },
  };
}

// Which property a text matcher reads. Absent, it reads the event's own
// text: the title, plus the description when the calendar opted into one.
// That is what a matcher with no field has always done and what every
// existing config is written against, so it stays the default rather than
// becoming "title" with a rename of the behaviour.
var MATCH_FIELDS = { title: 1, description: 1, location: 1, categories: 1, any: 1 };

// The strings one matcher tests, each on its own. Kept as a LIST rather
// than joined: `exact` anchors to the ends of what it is given, so a join
// would quietly stop it ever matching, and one event can carry several
// categories, each of which is its own whole value.
function fieldTexts(ctx, field) {
  if (field === 'title') return [ctx.title];
  if (field === 'description') return [ctx.desc];
  if (field === 'location') return [ctx.location];
  if (field === 'categories') return ctx.categories;
  if (field === 'any') return [ctx.title, ctx.desc, ctx.location].concat(ctx.categories);
  return [ctx.title, ctx.desc];
}

function finiteOr(v, dflt) {
  var n = typeof v === 'string' ? Number(v.trim()) : v;
  return typeof n === 'number' && isFinite(n) ? n : dflt;
}

// "HH:MM" (or "H:MM", or a bare hour) to minutes past midnight.
function hhmmToMin(v) {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v !== 'string') return null;
  var m = /^\s*(\d{1,2})(?::(\d{2}))?\s*$/.exec(v);
  if (!m) return null;
  var h = +m[1], mi = m[2] ? +m[2] : 0;
  if (h > 24 || mi > 59) return null;
  return h * 60 + mi;
}

function compileRule(spec) {
  if (!spec || typeof spec !== 'object') return null;
  var m = compileMatcher(spec.match);
  if (!m) return null;
  var line = normalizeNameList(spec.line);
  var allDay = spec.allDay === true;
  // A HOLIDAY IS A PROPERTY OF THE DAY, NOT A STATE OF A LINE. `allDay`
  // declares an event at ONE line's head, which is right for one person's
  // leave and wrong for Christmas Day: routed by whichever rule happened
  // to match, a national holiday landed on the first configured line and
  // said that person alone was off. This takes the event off the line
  // model altogether, so it resolves no owner and can create no line.
  var holiday = spec.holiday === true;
  var hide = spec.hide === true;
  // `siding` (and the `station` it shipped as) used to live here: a rule
  // could declare that an event's own line leaves the running line for its
  // span instead of branching into a lane. Both keys are gone, and a config
  // that still carries either is read the same as one that does not — the
  // key is simply ignored, which is what happens to any key this does not
  // recognise. The layout decides it now, from how long the block is; see
  // SIDING_MIN_MIN in buildFromConfig.

  // `rewrite` cuts what matched and puts this in its place; `title` replaces
  // the whole title.
  var rewrite = typeof spec.title === 'string' ? spec.title : typeof spec.rewrite === 'string' ? spec.rewrite : null;
  var rewriteFull = typeof spec.title === 'string';
  if (!line && !allDay && !holiday && !hide && rewrite === null) return null; // a no-op rule is dropped, not kept
  // A RULE THAT NAMES A LINE LEAVES THE TITLE ALONE. It used to replace the
  // text it matched with the line's name unless told not to, which turned
  // "L2 - Zwemmen" into "Mia - Zwemmen" on nearly every school feed.
  // Cutting is `rewrite`'s job, and only when asked.
  return { match: m.test, rx: m.rx, usesDesc: !!m.usesDesc, line: line, allDay: allDay, holiday: holiday, hide: hide, rewrite: rewrite, rewriteFull: rewriteFull };
}

function usesDesc(rule) { return !!(rule && rule.usesDesc); }

function compileRuleList(raw) {
  var rules = [];
  (Array.isArray(raw) ? raw : []).forEach(function (spec) {
    var compiled = compileRule(spec);
    if (compiled) rules.push(compiled);
  });
  return rules;
}

// A backslash means something in JSON and something else in markdown, and a
// chat window that escapes its answer for markdown hands back an escaped
// bracket around every array and a stray one at the end of every line. JSON
// allows a backslash only before one of nine characters, so any other one
// was put there by markdown and comes back out. Runs left to right, so a real
// escaped backslash is consumed as itself and cannot eat the character
// after it.
function unescapeMarkdown(whole, ch) {
  return '"\\/bfnrtu'.indexOf(ch) >= 0 ? whole : ch;
}

// Whatever an assistant or a chat client did to the JSON on its way here.
// Every substitution below is one that has actually come back from a chat
// window: the answer fenced as markdown, quotes turned typographic, spaces
// turned non-breaking, a trailing comma. This runs only after strict
// JSON.parse has already refused the text, so it can afford to be blunt.
function tidyConfigText(raw) {
  var t = String(raw == null ? '' : raw).replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\u2060]/g, '')
    .trim();
  var fence = /```[a-zA-Z0-9]*[ \t]*\r?\n([\s\S]*?)```/.exec(t);
  if (fence) t = fence[1].trim();
  t = t.replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/\u00A0/g, ' ')
    .replace(/\\(\r?\n)/g, '$1')
    .replace(/\\(.)/g, unescapeMarkdown)
    .replace(/,(\s*[}\]])/g, '$1');
  return t.trim();
}

// Did this text mean to be a configuration? A link list never opens with a
// brace or a code fence, so anything that does is a config, working or not.
function looksLikeConfigJson(raw) {
  var t = String(raw == null ? '' : raw).replace(/^\uFEFF/, '').trim();
  return t.charAt(0) === '{' || t.charAt(0) === '[' || t.indexOf('```') === 0;
}

// ONE LINK PER LINE, A NAME IN FRONT OF IT, AND ONE WORD IF IT IS A
// HOLIDAY FEED.
//
// The plain list is the low-friction path: paste links, get a line each.
// Named as the service names the feed, which is "Home" on iCloud and your
// email address on Google, so the second thing anybody wants is to say
// whose it is. A name before the link does that:
//
//   Alex  https://example.com/alex.ics
//   Sam   https://example.com/work.ics
//   Sam   https://example.com/sam.ics
//         https://example.com/family.ics
//   https://calendar.google.com/.../holidays.ics holiday
//
// A URL cannot contain a bare space, so the words before the first link
// are the name and the word after it is the option; nothing has to be
// quoted or looked up. The same name twice puts two feeds on one line. A
// link with no name beside named ones is the household's, on every line,
// which is what a calendar with no `line` already means in the JSON; with
// no names anywhere, the list is what it always was, one line per feed.
//
// Only the one trailing word, and only `holiday`: a subscribed holiday
// calendar is not a person, and pasted bare it became a rail named
// "Holidays in Belgium" with chevrons at both ends. The list is meant to
// stay a list; a second syntax with options in it is the JSON config
// wearing a disguise.
function plainListEntry(raw) {
  var line = String(raw == null ? '' : raw).trim();
  if (!line || line.charAt(0) === '#') return null;
  var words = line.split(/\s+/);
  // The link is the first word with a scheme, or with a dot and a slash in
  // it; a name has neither. A lone dotted word is still a link, as it
  // always was.
  var at = -1;
  for (var i = 0; i < words.length; i++) {
    if (/^(https?|webcal):\/\//i.test(words[i]) || /\..*\/|\/.*\./.test(words[i])) { at = i; break; }
  }
  if (at < 0) {
    if (words.length === 1 && /^\S+\.\S+$/.test(words[0])) at = 0;
    else return null;
  }
  var entry = { url: words[at] };
  var name = words.slice(0, at).join(' ');
  if (name) entry.line = name;
  if ((words[at + 1] && words[at + 1].toLowerCase() === 'holiday') || looksLikeHolidayFeed(entry.url)) entry.holiday = true;
  return entry;
}

// The list as a configuration: the names, in the order they were first
// written, are the lines, so the board is the same one the JSON would draw.
// A holiday feed is nobody's, so a name written before one ("Belgium") is
// a label, not a line.
function parseLinkList(raw) {
  var entries = String(raw == null ? '' : raw).split(/\r?\n/).map(plainListEntry).filter(Boolean);
  if (!entries.length) return null;
  var names = [];
  entries.forEach(function (e) {
    if (e.holiday) { if (e.line) { e.name = e.line; delete e.line; } return; }
    if (e.line && names.indexOf(e.line) < 0) names.push(e.line);
  });
  var data = { calendars: entries };
  if (names.length) data.lines = names.map(function (n) { return { name: n }; });
  return data;
}

// Parses the "Calendar Config (JSON)" setting text into
// { calendars, lines, timeZone, globalRules, everyoneLine }. Never
// throws: invalid JSON falls back to treating the text as a plain
// newline-separated list of calendar URLs (a low-friction path for
// someone who just wants to paste ICS links with no rules at all).
// THE CONFIGURATION'S VERSION, AND THE ONE PLACE A FORMAT CHANGE IS READ.
//
// A bug is fixed by one push; a configuration is somebody's, pasted into a
// settings box and never edited again. So every configuration says which
// format it is written in (`version`, 1 when missing), and when the format
// ever changes, the older one is turned into the current one here, before
// anything reads it, drawing what it drew. Nothing else in this file needs
// to know an older format existed.
//
// `docs` is a link to CONFIG.md, written into every configuration the editor
// makes, so an assistant handed nothing but the JSON can read what it means.
// Nothing here reads it.
//
// Version 1 is the only one so far. What it says, in one place:
//   - A calendar says whose it is with `line`. Its `name` is a label, and a
//     line only on a board with no `lines` at all.
//   - A rule that names a line leaves the title alone. `rewrite` cuts what
//     matched; `title` replaces the whole title. Every matching rewrite cuts.
//   - `hideWhenEmpty: true` on a line, `keepLine: true` on a calendar.
//   - Sides and colours are the board's; there is no setting for either.
var CONFIG_VERSION = 1;
function isPlainOwnerRule(r) {
  if (!r || typeof r !== 'object' || !r.match || !normalizeNameList(r.line)) return false;
  if (r.match.type !== 'any' && r.match.type !== 'all') return false;
  return Object.keys(r).every(function (k) { return k === 'match' || k === 'line'; })
    && Object.keys(r.match).every(function (k) { return k === 'type'; });
}
// `hoist` (the editor's): a first rule that only sends every event to a line
// becomes the calendar's `line`, which is the same board said the short way.
function migrateConfig(input, hoist) {
  var d = Array.isArray(input) ? { calendars: input } : (input && typeof input === 'object' ? input : {});
  d = JSON.parse(JSON.stringify(d));
  if (Array.isArray(d.calendars)) {
    d.calendars = d.calendars.map(function (c) {
      if (typeof c === 'string') c = plainListEntry(c) || { url: c.trim() };
      if (!hoist || !c || typeof c !== 'object' || c.line || !Array.isArray(c.rules) || !isPlainOwnerRule(c.rules[0])) return c;
      var o = Object.assign({}, c);
      o.line = c.rules[0].line;
      o.rules = c.rules.slice(1);
      if (!o.rules.length) delete o.rules;
      return o;
    });
  }
  d.version = +d.version || CONFIG_VERSION;
  return d;
}
// WHAT A CONFIGURATION SAYS THAT NOTHING READS. A misspelt key is ignored,
// which is right for the board (draw what can be drawn) and wrong for the
// person who wrote it, who is told nothing. The editor shows these.
var CONFIG_KEYS = {
  top: ['version', 'docs', 'timeZone', 'locale', 'timeFormat', 'temperatureUnit', 'lines', 'rules', 'calendars'],
  line: ['name', 'hideWhenEmpty', 'badge'],
  calendar: ['url', 'name', 'line', 'rules', 'headers', 'includeDescription', 'holiday', 'ignoreTimezone', 'mergeSameTime', 'keepLine'],
  rule: ['match', 'line', 'hide', 'holiday', 'allDay', 'rewrite', 'title'],
  matcher: ['type', 'value', 'field', 'matchers', 'matcher', 'min', 'max', 'from', 'to'],
};
var MATCHER_TYPES = ['any', 'all', 'word', 'contains', 'exact', 'regex', 'status', 'weekday', 'duration', 'time', 'and', 'or', 'not'];
function configWarnings(input) {
  var out = [];
  var d = migrateConfig(input);
  function extra(obj, allowed, where) {
    if (!obj || typeof obj !== 'object') return;
    Object.keys(obj).forEach(function (k) { if (allowed.indexOf(k) < 0) out.push(where + ': "' + k + '" is not a setting, so it does nothing'); });
  }
  var declared = (Array.isArray(d.lines) ? d.lines : []).map(function (l) { return l && l.name && String(l.name).trim().toLowerCase(); }).filter(Boolean);
  function names(list, where) {
    if (!declared.length) return;
    (normalizeNameList(list) || []).forEach(function (n) {
      if (declared.indexOf(n.toLowerCase()) < 0) out.push(where + ': "' + n + '" is not in lines, so it becomes an extra line');
    });
  }
  function matcher(m, where) {
    if (!m || typeof m !== 'object') { out.push(where + ': a rule without a match does nothing'); return; }
    extra(m, CONFIG_KEYS.matcher, where);
    if (MATCHER_TYPES.indexOf(m.type) < 0) out.push(where + ': "' + m.type + '" is not a kind of match, so the rule does nothing');
    (Array.isArray(m.matchers) ? m.matchers : []).forEach(function (x) { matcher(x, where); });
    if (m.matcher) matcher(m.matcher, where);
    if (m.type === 'regex' && typeof m.value === 'string') { try { new RegExp(m.value); } catch (e) { out.push(where + ': the pattern "' + m.value + '" is not a valid regular expression'); } }
  }
  function rules(list, where) {
    (Array.isArray(list) ? list : []).forEach(function (r, i) {
      var at = where + ', rule ' + (i + 1);
      extra(r, CONFIG_KEYS.rule, at);
      matcher(r && r.match, at);
      names(r && r.line, at);
    });
  }
  extra(d, CONFIG_KEYS.top, 'The configuration');
  (Array.isArray(d.lines) ? d.lines : []).forEach(function (l, i) { extra(l, CONFIG_KEYS.line, 'Line ' + (i + 1)); });
  rules(d.rules, 'Rules for every calendar');
  (Array.isArray(d.calendars) ? d.calendars : []).forEach(function (c, i) {
    var at = 'Calendar ' + (i + 1) + (c && c.name ? ' (' + c.name + ')' : '');
    extra(c, CONFIG_KEYS.calendar, at);
    names(c && c.line, at);
    rules(c && c.rules, at);
  });
  return out;
}

function parseConfig(raw) {
  var data = null;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      data = JSON.parse(raw);
    } catch (e) {
      // Strict JSON said no. A config that came out of a chat window is
      // usually still a config: it arrives wrapped in a ```json fence, with
      // typographic quotes the chat client substituted, or with a trailing
      // comma. Tidy it and try once more before deciding this is a list of
      // links.
      var tidy = tidyConfigText(raw);
      try {
        data = JSON.parse(tidy);
      } catch (e2) {
        // Only text that never claimed to be JSON becomes a link list. Text
        // that opens with a brace is a broken config, and reading its lines
        // as URLs would draw a board of nonsense rather than fall back to
        // the demo.
        // Text with not one link in it is no more a list than a config.
        data = (looksLikeConfigJson(raw) ? null : parseLinkList(raw)) || { _unreadable: true };
      }
    }
  }
  if (!data || typeof data !== 'object') data = {};
  data = migrateConfig(data);

  function str(v) { return typeof v === 'string' && v.trim() ? v.trim() : null; }
  // A config can set its own locale, zone and clock. All three are about how
  // this board should read rather than whose account it is on, so they beat
  // the account settings — a family board hanging in a Belgian kitchen may
  // still want a US-format demo, and the person configuring it is the one
  // who knows.
  var timeZone = str(data.timeZone);
  var locale = str(data.locale);
  var timeFormat = (function () {
    var v = str(data.timeFormat);
    if (!v) return null;
    v = v.toLowerCase();
    return v === '12h' || v === '24h' || v === 'auto' ? v : null;
  })();
  // Same reasoning as timeFormat, and the same shape: a value the config
  // sets beats the account setting, anything unrecognised is ignored
  // rather than guessed at. Deliberately not surfaced in the editor or the
  // AI prompt: it is for a board whose reader does not use the unit their
  // account language implies.
  var temperatureUnit = (function () {
    var v = str(data.temperatureUnit);
    if (!v) return null;
    v = v.toLowerCase();
    if (v === 'c' || v === 'celsius') return 'c';
    if (v === 'f' || v === 'fahrenheit') return 'f';
    return v === 'auto' ? 'auto' : null;
  })();

  var lines = {};
  // EVERY declared line, in the order declared, for the event no rule and no
  // name claims. That used to be ONE name -- the first entry in `lines[]` --
  // and the variable is still called `everyoneLine`, which is the giveaway:
  // it was written to mean "everyone" and it meant "whoever happens to be
  // first".
  //
  // A calendar nobody has routed is nearly always a HOUSEHOLD calendar: the
  // bin day, the holidays, the shared family feed. Handing it to the first
  // person on the board is a confident wrong answer and a silent one -- the
  // events show up as that person's day and nothing says otherwise. Handing
  // it to everybody is right for the common case and, where it is wrong,
  // wrong in a way you can see.
  //
  // Nothing that works today changes. This is the LAST resort: a matching
  // rule wins, and after that the calendar's own name, so a feed called
  // "Jules" still goes to Jules's line. It is reached only by a calendar with
  // no rules and no name at all -- which is exactly the shared household
  // feed somebody pasted in without saying whose it is.
  var everyoneLine = null;
  var allLines = [];
  // One name for the field, everywhere: `lines`. Nothing was released
  // under the old one, so there is nothing to keep reading it for.
  (Array.isArray(data.lines) ? data.lines : []).forEach(function (item) {
    if (!item || typeof item !== 'object') return;
    var name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!name) return;
    // Whether the badge was ASKED FOR or defaulted from the name. The two
    // have to be told apart downstream: a letter somebody chose is theirs
    // and is never rewritten, while one this file guessed may be grown to
    // keep it distinct from another line's.
    var badgePinned = typeof item.badge === 'string' && !!item.badge.trim();
    var badgeSrc = badgePinned ? item.badge.trim() : name;
    var badge = Array.from(badgeSrc)[0].toUpperCase(); // Array.from, not [0] — keeps a full surrogate pair (emoji) intact
    if (everyoneLine === null) everyoneLine = name;
    if (allLines.indexOf(name) < 0) allLines.push(name);
    // A DECLARED LINE IS DRAWN, QUIET DAY OR NOT.
    //
    // It used to be the other way round: a line with nothing on today was
    // dropped unless told otherwise. That made the board a
    // different shape every day and quietly deleted whoever had nothing on
    // -- which is exactly the day you look at a family board to check. A
    // name in `lines[]` is somebody saying "this person is on this board",
    // and an empty rail with their name on it is an answer, not noise.
    // `hideWhenEmpty: true` drops it, for a line that only matters on the
    // days it is used.
    lines[name.toLowerCase()] = { name: name, badge: badge, badgePinned: badgePinned, keepEmpty: item.hideWhenEmpty !== true };
  });

  var globalRules = compileRuleList(data.rules);

  var calendars = [];
  (Array.isArray(data.calendars) ? data.calendars : []).forEach(function (rawItem) {
    var item = typeof rawItem === 'string' ? { url: rawItem } : rawItem;
    if (!item || typeof item !== 'object' || typeof item.url !== 'string' || !item.url.trim()) return;
    var name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : null;
    // WHOSE IT IS, said once: where no rule routes an event, it is this line's
    // (applyCalendarRules). Not a rule, so a holiday rule without a line of
    // its own is still the day's, as it always was.
    var owner = normalizeNameList(item.line);
    var rules = compileRuleList(item.rules);
    // A calendar's name is a label. It is a line only where there are no
    // lines: the simplest board, one calendar per line, named after each.
    var fallbackName = allLines.length ? null : name;
    var headers = {};
    if (item.headers && typeof item.headers === 'object') {
      Object.keys(item.headers).forEach(function (k) {
        if (typeof item.headers[k] === 'string') headers[k] = item.headers[k];
      });
    }
    // Asking for the description by name IS opting in. Before this, a rule
    // reading it silently matched nothing until you also found the
    // includeDescription switch, which is a rule that looks broken.
    var includeDescription = item.includeDescription === true
      || globalRules.some(usesDesc) || rules.some(usesDesc);
    // The same switch on the calendar rather than the track: for the common
    // setup where one calendar IS one line, this is where the line is
    // declared, and there may be no lines[] entry to hang it off at all.
    // ONE WORD FOR A HOLIDAY SUBSCRIPTION. "Holidays in Belgium" is not a
    // person and has no line: everything in that feed belongs to the day.
    // Set here it applies to the whole calendar, which is the setup almost
    // everyone has, and it stops the feed both from leaking a ghost line
    // named after itself and from stamping the whole country's Christmas
    // on whoever happens to be first in `lines`. A rule can say the same
    // thing per event, for a feed that carries both kinds.
    // TWO SWITCHES FOR FEEDS THAT ARE NOT QUITE CALENDARS. `ignoreTimezone`
    // reads its times as the board's own wall clock (see parseIcsDateTime).
    // `mergeSameTime` makes things in it that start and end at the same minute
    // on the same line one stop: four bins due at seven are one reminder,
    // "Restafval · PMD · Papier-karton · GF(t)/keukenafval", not four stops
    // on one spot.
    calendars.push({ name: name, fallbackName: fallbackName, owner: owner, url: item.url.trim(), rules: rules, headers: headers,
      includeDescription: includeDescription, keepEmpty: item.keepLine === true,
      holiday: item.holiday === true || (item.holiday !== false && looksLikeHolidayFeed(item.url)), ignoreTimezone: item.ignoreTimezone === true,
      mergeSameTime: item.mergeSameTime === true });
  });

  return { unreadable: data._unreadable === true, calendars: calendars, lines: lines, timeZone: timeZone, locale: locale, timeFormat: timeFormat, temperatureUnit: temperatureUnit, globalRules: globalRules, everyoneLine: everyoneLine, allLines: allLines };
}

// A replace that never double-matches an empty-string-capable pattern
// (like the regex "any"/"all" compile to, or a user's own ".*") — a plain
// global replace on such a pattern matches the real text once, then the
// empty string right after it, turning "Quinn" into "QuinnQuinn".
function replaceMatch(text, rx, replacement) {
  if (rx.test('')) return text.replace(new RegExp(rx.source, rx.flags.replace('g', '')), replacement);
  return text.replace(new RegExp(rx.source, rx.flags.indexOf('g') !== -1 ? rx.flags : rx.flags + 'g'), replacement);
}

// Applies global rules then this calendar's own (cumulatively, in order —
// a later matching rule's track/rewrite overrides an earlier one's,
// and a calendar's own rule is listed after globals so it wins ties).
// Returns { title, lineNames, allDay, hide }; lineNames is an array
// (possibly with more than one name — a multi-track rule becomes an
// interchange event) or null if nothing assigned one.
function applyCalendarRules(ev, weekday, cal, globalRules, everyoneLine) {
  var originalTitle = ev.title;
  // Everything a matcher may ask about, in one shape, so a rule reads the
  // event rather than the four arguments somebody happened to pass down.
  // The clock fields are minutes past the event's OWN midnight: startMin
  // is absolute across the run of days, and "starts before nine" is a
  // question about a morning, not about an offset from the first one.
  var ctx = {
    title: originalTitle,
    desc: ev.desc || '',
    location: ev.location || '',
    categories: Array.isArray(ev.categories) ? ev.categories : [],
    status: ev.status || '',
    weekday: (weekday === undefined || weekday === null) ? null : weekday,
    startOfDayMin: typeof ev.startMin === 'number' ? ((ev.startMin % 1440) + 1440) % 1440 : null,
    durationMin: (typeof ev.startMin === 'number' && typeof ev.endMin === 'number') ? ev.endMin - ev.startMin : null,
  };
  var lineNames = null;
  var rewriteRules = [];
  var allDay = false;
  var holiday = false;
  var hide = false;

  globalRules.concat(cal.rules).forEach(function (rule) {
    if (!rule.match(ctx)) return;
    if (rule.hide) hide = true;
    if (rule.allDay) allDay = true;
    if (rule.holiday) holiday = true;

    if (rule.line) lineNames = rule.line;
    if (rule.rewrite !== null) rewriteRules.push(rule);
  });

  // Routed by no rule: the calendar's own line, where it says whose it is.
  var ruleLines = lineNames;
  if (!lineNames && cal.owner) lineNames = cal.owner;

  var finalTitle = originalTitle;
  // REWRITES ADD UP. Only the last one used to count, so a calendar that
  // strips "RE:", then "[ACME-2231]", then "Invitation :" showed two of the
  // three. Each cut is made on what the one before it left, in order; a
  // whole-title rewrite replaces what came before it.
  if (rewriteRules.length) {
    rewriteRules.forEach(function (rule) {
      finalTitle = rule.rewriteFull ? rule.rewrite
        : rule.rx ? replaceMatch(finalTitle, rule.rx, rule.rewrite)
        : finalTitle;
    });
  }
  // MIND THE HOLE THE RULE LEFT.
  //
  // Cutting a class code out of "L2 Zwemmen" leaves " Zwemmen", and cutting
  // one out of the middle leaves two spaces where it was. The board prints
  // the title as it is given, so that reached the panel as a caption
  // indented by a space nobody could explain. A rewrite is a cut, and
  // whatever it takes out it takes the gap out with it.
  if (finalTitle !== originalTitle) finalTitle = finalTitle.replace(/\s+/g, ' ').trim();
  // AND THE CAPITAL IT CUT OFF. "Mia logo" with the name taken off is
  // "logo"; a title that began with a capital still does.
  if (rewriteRules.length && finalTitle !== originalTitle && /^\p{Lu}/u.test(originalTitle) && /^\p{Ll}/u.test(finalTitle)
      && !rewriteRules.some(function (r) { return r.rewriteFull; })) {
    finalTitle = finalTitle.charAt(0).toUpperCase() + finalTitle.slice(1);
  }
  // NOTE: everyoneLine is deliberately NOT applied here — a calendar's
  // own name is meant to be the fallback for one that has no rule
  // assigning anyone (see buildFromConfig), and everyoneLine is the
  // last resort after THAT. Applying it here unconditionally used to make
  // the calendar-name fallback unreachable dead code: with lines[] set,
  // EVERY unnamed-by-rule event (i.e. every event from any calendar with
  // no rules at all, or whose rules didn't match this one) landed on
  // everyoneLine instead of that calendar's own name — so calendars
  // literally named after a track (a common real setup: one calendar per
  // family member, no rules needed) never got their events attributed to
  // themselves at all.

  return { title: finalTitle, lineNames: lineNames, ruleLines: ruleLines, allDay: allDay, holiday: holiday, hide: hide };
}

// A small, growable track registry — seeded from parsed.lines, but
// calendars with no track-assigning rule (e.g. a shared "Family"
// calendar) fall back to using the CALENDAR's own name as an implicit
// track, added here the first time it's encountered, so those events
// still get a track instead of silently vanishing.
//
// Which SIDE each track ends up on is decided once, in finalize() —
// called after every calendar has been fetched and every event tallied —
// not by any calendar's name. A track's `side` in config (if set) is
// honored; everyone else is balanced across the two sides by their own
// event count (heaviest first, each going to whichever side is currently
// lighter), so the split reflects the actual day's data instead of a
// fixed "Work calendar" convention.
function makeLineRegistry(parsed) {
  var order = [];
  var byName = {};
  var counts = {};
  var keyIdx = 0;

  function add(name, weight) {
    if (!byName[name]) {
      // WHAT A LINE IS, AND NOTHING ABOUT HOW IT LOOKS. `line_offset`,
      // `line_width`, `line_style` and `initial` used to travel with it: the
      // first was worked out here and is the arranger's now, and the other
      // three were sent and then thrown away by `linesFrom`, which says so in
      // as many words. `side` and `hue` stay because somebody may have asked
      // for them, and an ask is data.
      byName[name] = { key: 'p' + (keyIdx++), name: name, side: null, hue: null, configured: false };
      order.push(name);
      counts[name] = 0;
    }
    counts[name] += (weight == null ? 1 : weight);
    return byName[name];
  }

  // Registered, weightless, and kept even with nothing on it today. Used by
  // a line in `lines`, or `keepLine: true` on a calendar.
  function keep(name) {
    if (!name) return null;
    var t = add(name, 0);
    t.keep_empty = true;
    return t;
  }

  // How often two lines are in the same place at the same time. Every
  // shared event links each pair it joins, and those links decide the ORDER
  // the lines are laid out in: a family that eats dinner together should not
  // have to read across two other people's days to see that they did.
  var affinity = {};
  // ...and the GROUPS themselves, with the minute each happened. Pair counts
  // say who belongs together; only the groups say who is stranded in the
  // middle of somebody else's, and only the minute says whether two lines
  // could exchange places between one and the next instead of crossing.
  var groups = [];
  // who takes part in a shared event at all, which is who has anywhere to
  // lean to and therefore anything to cross on the way
  var sharer = {};
  function pairKey(a, b) { return a < b ? a + '\u0000' + b : b + '\u0000' + a; }
  function link(names, weight, atMin) {
    if (names.length > 1) {
      groups.push({ names: names.slice(), at: atMin == null ? 0 : atMin });
      for (var m = 0; m < names.length; m++) sharer[names[m]] = true;
    }
    for (var i = 0; i < names.length; i++) {
      for (var j = i + 1; j < names.length; j++) {
        var k = pairKey(names[i], names[j]);
        affinity[k] = (affinity[k] || 0) + (weight == null ? 1 : weight);
      }
    }
  }
  function affinityOf(a, b) { return affinity[pairKey(a, b)] || 0; }

  // WHAT ORDER, WHICH SIDE, WHO IS THE ANCHOR, WHAT LETTER: NOT HERE.
  //
  // All of it used to be decided in this file, and all of it is a fact about
  // a DRAWING rather than about a calendar. This one runs once per refresh
  // and its payload is drawn by four views at four sizes, so an order chosen
  // here is chosen blind to the paper it lands on; and whether two badges can
  // be told apart is a question about a glyph at a size, which nothing in a
  // feed knows anything about.
  //
  // So what goes out is what the HOUSEHOLD said and nothing this file worked
  // out: the order they listed their people in, a side somebody pinned, a
  // colour, a badge. `solver/order.js` does the rest, and rules 39 to 42 live
  // there now.
  function finalize() {
    order.forEach(function (name) {
      var t = byName[name];
      var configured = parsed.lines[name.toLowerCase()];
      // No side and no colour: both are the board's (solver/order.js), chosen
      // against the day and the panel, which a configuration cannot see.
      t.side = null;
      t.hue = null;
      // Which lines the config actually names, so the arranger can pick the
      // household's main line as the anchor rather than guessing at the
      // busiest one.
      t.configured = !!configured;
    });
  }

  return {
    add: add,
    keep: keep,
    link: link,
    byName: byName,
    finalize: finalize,
    // IN THE ORDER THE HOUSEHOLD LISTED THEM, which is the seed the arranger
    // starts from and the tie-break it falls back to. Sorting by side here
    // was this file arranging the board again by the back door.
    all: function () { return order.map(function (n) { return byName[n]; }); },
  };
}

// A readable name from a calendar URL, for a feed that carries no name of
// its own: "https://cloud.example.com/alex-work.ics" -> "Alex Work".
function urlLabel(url) {
  var last = String(url || '').split(/[?#]/)[0].split('/').filter(Boolean).pop() || '';
  last = last.replace(/\.ics$/i, '').replace(/[._+-]+/g, ' ').trim();
  if (!last) return null;
  return last.split(/\s+/).map(function (w) {
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

async function buildFromConfig(input, parsed, weather, extra, state) {
  var tz = resolveTz(parsed.timeZone, input); // config.timeZone > account time_zone_iana > account utc_offset > UTC
  var nowTs = (input.trmnl && input.trmnl.system && input.trmnl.system.timestamp_utc) || Math.floor(Date.now() / 1000);
  var today = fromEpoch(nowTs * 1000, tz);
  var nowMin = today.h * 60 + today.mi;
  var todayWeekday = (new Date(Date.UTC(today.y, today.mo - 1, today.d)).getUTCDay() + 6) % 7;
  // ---- which day the board is about
  //
  // Resolved HERE, before a single feed is read, because it decides how
  // long a run of days has to be gathered: a board about tomorrow that may
  // roll on into the morning after needs the day after tomorrow fetched,
  // and a fetch cannot be gone back for once the parsing is done.
  //
  // Today, tomorrow, or "tomorrow once today is mostly over". The last is
  // what a screen on a wall actually wants: in the evening, what you need
  // to see is what you are getting up to, and by then today has already
  // happened.
  // "TODAY, THEN TOMORROW FROM THE EVENING" IS WHAT THE ROLLING WINDOW DOES,
  // and it does it better, so the setting that used to say so is gone.
  //
  // That setting swapped one day for the other at a fixed hour -- nine by
  // default, late on purpose, because the evening is when a board on a wall is
  // read most and an earlier switch threw away dinner while people were
  // standing in front of it. Nine still threw away whatever was left of the
  // evening, and it did it as a cliff: the board a reader looked at before
  // brushing their teeth was a different board from the one an hour earlier.
  //
  // The rolling window reaches tomorrow from four in the afternoon, keeps the
  // rest of tonight while it does, and stretches its far end to the end of
  // tomorrow once today is spent (see ROLL_END_LATE_MIN). Measured on a busy
  // Wednesday: from 17:00 a rolling board already carried tomorrow's first
  // event with all of tonight still on it, while the switch at 21:00 deleted
  // four events to show two.
  //
  // A board somebody already set to "auto" is read as "today" rather than
  // refused: the rolling view is what they were asking for.
  // THE BOARD IS ABOUT TODAY, AND IT ROLLS. There is nothing left to ask.
  //
  // There were three settings here and each of them was a way of asking for
  // something the rolling window now does by itself.
  //
  //   "Today, then tomorrow from the evening on", with an hour beside it,
  //   swapped one day for the other at nine. Rolling reaches tomorrow from
  //   four and keeps what is left of tonight, so the switch was strictly
  //   worse and it is gone.
  //
  //   "Tomorrow" drew tomorrow instead of today, all day long. On a screen on
  //   a wall that is a board which is wrong every morning: it cannot say what
  //   time it is, because now is not on it, and it cannot mark the day,
  //   because the day it is about has not started. Everything it was for, a
  //   reader gets from this afternoon onward anyway.
  //
  //   "Quiet Days: always one day" turned the rolling off. It existed because
  //   a board that changes shape on its own needs a way to be told not to --
  //   and what actually made that alarming was the shape changing WHILE
  //   somebody read it, which the four o'clock boundary fixed. A board that
  //   quietly shows more of what is coming needs no opt-out.
  //
  // So: the day is today, always, and a quiet day always borrows the next
  // one. Every branch that existed to serve the other answers has gone with
  // them, which is most of what this change is.

  // The run of days the board may draw. Three is the ceiling: past that a
  // day gets less axis than its own events need and the board stops being
  // a timeline. How many of them are actually DRAWN is the client's call,
  // made against the real canvas; this only has to make sure the data is
  // there for it to choose from.
  //
  // The day being shown plus the one after it, which is what the rolling
  // view reaches into, and never fewer than the two days this has always
  // gathered.
  var days = [];
  var runDays = Math.max(DAY_SPAN, 2);
  for (var di = 0; di < runDays; di++) days.push(addCivilDays(today, di));

  var registry = makeLineRegistry(parsed);
  // Every explicitly-configured track is registered up front, even with
  // zero events today, so they still get a line and (if they set an
  // explicit side) it's honored regardless of load.
  Object.keys(parsed.lines).forEach(function (key) {
    var t = parsed.lines[key];
    if (t.keepEmpty) registry.keep(t.name); else registry.add(t.name, 0);
  });

  // ONE deadline for the whole render, handed down from run() rather than
  // started here. Started here it began AFTER the weather call had already
  // spent up to three seconds, so a slow forecast plus slow feeds added up
  // to more than seven seconds against a budget that never had it. The
  // fallback is for a direct caller (the config editor's preview) that has
  // no deadline of its own.
  var deadline = (extra && extra.deadline) || (Date.now() + RENDER_BUDGET_MS);
  var events = [];
  var allDayEvents = [];
  // Timed events on a day past the run this has always gathered: kept aside
  // until the rolling view is decided, and thrown away if it is not (see
  // the push site below).
  var late = [];
  // THE DAY'S OWN, BELONGING TO NOBODY. A holiday never touches the line
  // registry: no line is added for it, no weight is tallied, no empty line
  // is kept alive by it. That is the whole of the fix, because everything
  // that went wrong downstream followed from a holiday having had an owner
  // at all -- a ghost line named after the feed, a whole country's holiday
  // declared at one person's head, and a line kept on a cramped panel
  // ahead of somebody with a real day because a holiday made it look busy.
  var holidays = [];
  function addHoliday(title, dayIx, span, index) {
    if (!title) return;
    holidays.push({ title: title, day: dayIx || 0,
      span: Math.max(1, span || 1), index: Math.max(0, index || 0) });
  }
  // WHOSE DAY DOES IT CHANGE? That is the question, and the config already
  // answers it: a rule that names lines has said whose, and one that names
  // none has said nobody's.
  //
  // Christmas Day is nobody's -- it is a fact about the day, and the header
  // states it. Half term is precisely Bart's and Lisa's and precisely NOT
  // Homer's, who still goes to work, and that is what a line's head row is
  // for. Both arrive through the same subscription and the same word, so
  // `holiday` cannot mean "goes in the header": it means this is a STATE
  // rather than an appointment, which is the distinction E12 already drew.
  // Where it is drawn falls out of whether anybody owns it.
  //
  // Only an explicit `line` counts. The fallback chain is deliberately not
  // consulted: falling back is what put a whole country's Christmas on
  // whoever happened to be first in `lines[]`, and a holiday feed with no
  // name has not told us whose it is -- it has told us it is nobody's.
  // AN ALL-DAY ENTRY GOES ON EVERY LINE IT NAMES.
  //
  // Same reason as the holiday below, and the same bug: pushed as
  // `lineNames[0]`, a rule that put a school holiday on all four children
  // landed it on whichever of them happened to be first and left the other
  // three with an ordinary day. A timed event routed to several lines has
  // been an interchange all along; this is the all-day strip's version of
  // it, and `buildMetro` already groups by title and collects the owners so
  // one title is drawn once with a tie between the heads.
  function placeAllDay(resolved, names, dayIx) {
    names.forEach(function (n) {
      allDayEvents.push({ line: registry.add(n, 0.25).key, title: resolved.title, day: dayIx || 0 });
    });
  }

  function placeHoliday(resolved, dayIx, span, index) {
    // Only a rule's own line: a holiday is the day's unless a rule says whose.
    var named = resolved.ruleLines;
    if (!named || !named.length) { addHoliday(resolved.title, dayIx, span, index); return; }
    // One push per line, because `buildMetro` groups all-day entries by
    // title and collects their owners: that is what makes several lines
    // sharing one holiday ONE origin, named once, with the dashed tie
    // between their heads.
    named.forEach(function (n) {
      allDayEvents.push({ line: registry.add(n, 0.25).key, title: resolved.title, day: dayIx || 0 });
    });
  }

  // A named calendar that is kept when empty is kept when it is UNREACHABLE
  // too: a feed being down for an hour should not silently remove somebody
  // from the board. An unnamed one cannot be, since its line is named after
  // the feed and there is nothing to name it until the feed answers.
  (parsed.calendars || []).forEach(function (cal) {
    if (!cal.keepEmpty) return;
    (cal.owner || (cal.fallbackName ? [cal.fallbackName] : [])).forEach(function (n) { registry.keep(n); });
  });

  // A feed that fails must not vanish silently. Every failure is recorded
  // in saved state with the time it FIRST happened, so a blip (one 500, a
  // slow morning) changes nothing, and a feed still failing hours later is
  // named on the board. The fetches stay parallel and each keeps its own
  // catch: a 404 on one feed still renders every other line.
  // IN THE ORDER THE CONFIG NAMES THEM, NOT THE ORDER THEY GAVE UP.
  //
  // The feeds are fetched together and each writes its own failure as it
  // happens, so the order was whichever answered first -- and two renders of
  // one unchanged board said "Kalender Belgiek-Molenhoek, Holidays in
  // Belgium" and then "Holidays in Belgium, Kalender Belgiek-Molenhoek". A
  // line that reorders itself under the reader every fifteen minutes reads as
  // something new happening when nothing has. Keyed by where the calendar
  // sits in the config, which is the order the reader wrote them in.
  var downAt = {};
  // ...and the ones that have been silent for a whole day, which is a louder
  // thing (see FEED_DOWN_LOUD_AFTER_S).
  var loudAt = {};
  // Every feed that failed on THIS render, by name, and how many answered:
  // a board with nothing on it says which of the two it is (boardNotice).
  var failedAt = {}, feedsRead = 0;
  var nowS = Math.floor(Date.now() / 1000);
  // WHICH DAY A CACHED READ BELONGS TO. Every event in it is minutes from
  // this day's midnight, so it means nothing against any other day.
  var cacheDay = isoDate(today);

  // ONE FEED'S DAY, TAKEN BACK OUT OF THE LAST RENDER'S OWN OUTPUT.
  //
  //   "input.trmnl.previous_merge_variables -- the set of merge variables
  //    your last run stored, the same values your markup rendered last time"
  //   -- help.trmnl.com/en/articles/16777795-saved-state
  //
  // Saved state is 8192 bytes and that is not many meetings: remembering the
  // feeds there, the households with enough calendars to need it were exactly
  // the ones whose reads would not fit. The previous payload costs nothing,
  // and it is the same day, already resolved -- rules applied, merges done,
  // holidays sorted -- so replaying it cannot disagree with what the reader
  // saw fifteen minutes ago.
  //
  // It is read a FEED at a time (`f`, set in buildMetro), so the feeds that
  // did answer are not doubled by it.
  //
  // WHAT IT IS NOT. It is not a clock: a render that replayed a feed writes
  // the replayed events back out as its own, so the payload's age says how
  // long ago the last RENDER was, not how long ago the feed last answered.
  // That is what state is for, and all it is for now: one number per feed
  // (`feedOk`), which is small enough to never threaten the limit.
  //
  // Line keys are assigned in the order lines are registered and are not
  // stable between renders, so nothing here trusts them: every key is turned
  // back into a NAME through the previous legend and registered again.
  var prevVars = null;
  try {
    var pv = input.trmnl.previous_merge_variables;
    if (typeof pv === 'string') pv = JSON.parse(pv);
    if (pv && typeof pv === 'object' && !Array.isArray(pv)) prevVars = pv;
  } catch (e) { prevVars = null; }
  // Events are minutes into a particular day. A payload from another day is
  // not stale, it is wrong.
  if (prevVars && prevVars.date_iso !== cacheDay) prevVars = null;

  function prevNames(keys) {
    var byKey = {};
    (prevVars.legend || []).forEach(function (l) {
      if (l && typeof l.key === 'string' && typeof l.name === 'string') byKey[l.key] = l.name;
    });
    var out = [];
    (keys || []).forEach(function (k) { if (byKey[k] && out.indexOf(byKey[k]) < 0) out.push(byKey[k]); });
    return out;
  }

  // Returns how many things it put back, or 0 if there was nothing of this
  // feed's to put back.
  function replayFeed(ix) {
    if (!prevVars) return 0;
    var n = 0;
    (prevVars.events || []).forEach(function (e) {
      if (!e || e.f !== ix || e.type !== 'event') return;
      if (typeof e.title !== 'string' || !e.title) return;
      if (typeof e.start_min !== 'number' || !isFinite(e.start_min)) return;
      var names = prevNames([e.owner].concat(e.co_owners || []));
      if (!names.length) return;
      var primary = registry.add(names[0], 1);
      var others = names.slice(1).map(function (nm) { return registry.add(nm, 0.5).key; });
      if (names.length > 1) registry.link(names, null, e.start_min);
      events.push({
        line: primary.key,
        interchange_with: others.length ? others : undefined,
        title: e.title,
        parts: Array.isArray(e.parts) ? e.parts : undefined,
        todo: e.todo || undefined,
        startMin: e.start_min,
        endMin: typeof e.end_min === 'number' && isFinite(e.end_min) ? e.end_min : e.start_min + 30,
        beganMin: typeof e.began_min === 'number' ? e.began_min : undefined,
        location: e.location || null,
        feed: ix,
      });
      n++;
    });
    (prevVars.all_day || []).forEach(function (a) {
      if (!a || a.f !== ix || typeof a.title !== 'string' || !a.title) return;
      var names = prevNames(a.owners || []);
      var days = Array.isArray(a.days) && a.days.length ? a.days : [0];
      names.forEach(function (nm) {
        days.forEach(function (d) {
          allDayEvents.push({ line: registry.add(nm, 0.25).key, title: a.title, day: d, feed: ix });
          n++;
        });
      });
    });
    (prevVars.holidays || []).forEach(function (hd) {
      if (!hd || hd.f !== ix || typeof hd.title !== 'string' || !hd.title) return;
      holidays.push({ title: hd.title, day: Math.max(0, hd.day || 0),
        span: Math.max(1, hd.day_span || 1), index: Math.max(0, hd.day_index || 0), feed: ix });
      n++;
    });
    return n;
  }

  // In config order, so the two lists below can be read back out in it.
  function inOrder(map) {
    return Object.keys(map).map(Number).sort(function (a, b) { return a - b; })
      .map(function (i) { return map[i]; });
  }

  await Promise.all((parsed.calendars || []).map(async function (cal, calIx) {
    var url = feedUrl(cal.url);
    // What this feed is called when it cannot tell us: the config's own
    // name, else the name it gave the last time it answered. Without the
    // remembered one an unnamed feed that goes down loses its identity and
    // comes back as a URL fragment, which is the "Calendar 2" problem.
    var knownName = cal.name || (state && state.calendarNames[cal.url]) || null;
    // `tell` is whether the reader has to be told. A feed that failed and had
    // nothing remembered has taken its events off the board, so yes, on this
    // render (see CALENDAR_DOWN_AFTER_S). A feed that failed and was replayed
    // from a fresh enough cache has taken nothing off the board, so the log
    // gets it and the map does not -- until the cache is six hours old, when
    // it is no longer something to present as today.
    function failed(why, tell, loud) {
      var now = knownName || urlLabel(cal.url);
      if (failedAt[calIx] == null) failedAt[calIx] = now;
      if (tell !== false && downAt[calIx] == null) downAt[calIx] = now;
      if (loud && loudAt[calIx] == null) loudAt[calIx] = now;
      warn('calendar "' + now + '" did not answer' + (why ? ': ' + why : '')
        + ' (' + hostOf(cal.url) + ')');
      if (!state) return;
      if (!state.calendarDown[cal.url]) state.calendarDown[cal.url] = nowS;
      // A kept line keeps its remembered name too, so the rail that is
      // missing its events is still labelled with whose it is.
      if (cal.keepEmpty && !cal.owner && cal.fallbackName) registry.keep(cal.fallbackName);
    }
    try {
      // No time left is the same outcome as a dead feed from the board's
      // side (the events are missing), so it starts the same clock and
      // clears again on the next render that does reach it.
      // Started by run() before the language file and the forecast were
      // awaited, so every feed has the whole budget rather than what they left.
      var pre = extra && extra.prefetched && extra.prefetched[feedKey(url, cal.headers)];
      var got = pre ? await pre : await fetchFeedText(url, deadline, cal.headers);
      // WHAT THIS CALENDAR PUT ON THE BOARD, MARKED AS ITS OWN.
      //
      // The payload is one merged list and nothing in it said where a line
      // came from, so a feed that fails could not be told apart from a feed
      // that is quiet -- and the previous render's own output, which is the
      // cheapest copy of a feed's day there is, could not be read back a feed
      // at a time. Everything added between here and the end of this block is
      // this calendar's.
      //
      // Taken as a span rather than passed down through placeAllDay and
      // addHoliday, which is safe because the rest of this function has no
      // `await` in it: the callbacks are started together but each runs to
      // its end without yielding. Anything awaited below breaks that and the
      // marks have to become a parameter.
      var evs0 = events.length, ad0 = allDayEvents.length, hol0 = holidays.length;
      var parsedIcs;
      if (!got || !got.ok) {
        var why = got ? 'HTTP ' + got.status : 'no answer inside the render budget';
        // WHAT THIS CALENDAR DREW LAST TIME, out of the last render's own
        // output (see replayFeed). Same day only -- events are minutes into a
        // particular day, so another day's are not stale, they are wrong.
        var put = replayFeed(calIx);
        if (!put) {
          var downSince = state && state.calendarDown ? state.calendarDown[cal.url] : 0;
          failed(why, true, !!downSince && nowS - downSince >= FEED_DOWN_LOUD_AFTER_S);
          return;
        }
        // HOW OLD IT REALLY IS comes from state, not from the payload: a
        // render that replayed a feed writes those events back out as its
        // own, so the payload's day says nothing about when the feed last
        // answered. One number per feed, which never threatens the limit.
        var since = state && state.feedOk ? state.feedOk[cal.url] : 0;
        var oldS = since ? nowS - since : null;
        var stale = oldS == null || oldS >= FEED_STALE_AFTER_S;
        var aDay = oldS != null && oldS >= FEED_DOWN_LOUD_AFTER_S;
        failed(why + '; showing the ' + put + ' thing(s) it drew last time'
          + (oldS == null ? ', last answered before this board remembered'
             : ', last answered ' + Math.round(oldS / 60) + ' minute(s) ago')
          + (stale ? ' -- too old to present as today, so the board says so' : ''),
          stale, aDay);
        feedsRead++;
        return;
      } else {
        parsedIcs = parseIcs(got.text, tz, days, cal.includeDescription, cal.ignoreTimezone);
        feedsRead++;
        if (state) {
          delete state.calendarDown[cal.url];
          if (parsedIcs.calName) state.calendarNames[cal.url] = parsedIcs.calName;
          // WHEN IT LAST ANSWERED. The events themselves live in the payload
          // now; this is the clock that says whether they are still worth
          // presenting as today's.
          state.feedOk[cal.url] = nowS;
        }
      }
      // Last resort for whose line this is: the feed's own X-WR-CALNAME,
      // then the last thing in the URL. Only reached when the config named
      // neither the calendar nor a single track — which is the simplest
      // setup there is, a list of ICS links and nothing else. Before this
      // that setup drew an empty board.
      var calLabel = parsedIcs.calName || urlLabel(cal.url);
      // `keepLine: true` on the CALENDAR keeps the line this calendar
      // owns on the board on a day it has nothing. Which line that is can
      // only be known once the feed has been read, since an unnamed
      // calendar borrows the feed's own name.
      if (cal.keepEmpty) (cal.owner || [cal.fallbackName || parsed.everyoneLine || calLabel]).forEach(function (n) { registry.keep(n); });
      var timedItems = parsedIcs.timed.map(function (ev) {
        return { ev: ev, resolved: applyCalendarRules(ev, ev.weekday != null ? ev.weekday : todayWeekday, cal, parsed.globalRules, parsed.everyoneLine) };
      });
      if (cal.mergeSameTime) {
        // After the rules, so a rule can still rename, route or hide one of
        // them on its own; only what is left on the same line at the same
        // minutes is joined.
        var byMinute = {}, merged = [];
        timedItems.forEach(function (it) {
          var r = it.resolved;
          if (r.hide || r.holiday || r.allDay || cal.holiday) { merged.push(it); return; }
          var k = it.ev.startMin + '|' + it.ev.endMin + '|' + (r.lineNames || []).join(',');
          var first = byMinute[k];
          if (!first) { byMinute[k] = it; merged.push(it); return; }
          var parts = first.resolved.parts || [first.resolved.title];
          if (it.ev.todo) first.ev = Object.assign({}, first.ev, { todo: true });
          if (parts.indexOf(r.title) < 0) {
            // the names travel as a list too, so the board can set them one to
            // a row rather than as one long line that has to be cut
            parts = parts.concat([r.title]);
            first.resolved = Object.assign({}, first.resolved, { title: parts.join(' \u00b7 '), parts: parts });
          }
        });
        timedItems = merged;
      }
      timedItems.forEach(function (it) {
        var ev = it.ev, resolved = it.resolved;
        if (resolved.hide) return;
        // A holiday written as a timed 00:00-23:59 block is still a
        // holiday. Plenty of feeds emit one that way, and which of the two
        // shapes a feed picked is a fact about the exporter, not about the
        // day. Taken before any line is resolved: that is what makes it
        // impossible for one to be created.
        if (cal.holiday || resolved.holiday) {
          placeHoliday(resolved, Math.floor(ev.startMin / 1440), 1, 0);
          return;
        }
        var lineNames = resolved.lineNames || (cal.fallbackName ? [cal.fallbackName] : null)
          || (parsed.allLines && parsed.allLines.length ? parsed.allLines.slice() : null) || (calLabel ? [calLabel] : null);
        if (!lineNames || !lineNames.length) return;
        // A DAY THE BOARD ONLY MIGHT DRAW COSTS THE BOARD NOTHING YET.
        //
        // An event beyond the two days this has always gathered is only on
        // the board if the rolling view happens, which is not known until
        // every feed is in. Held back rather than registered, because
        // registering it would tally its line's weight and so could move
        // somebody to the other side of the map, or create a line that
        // exists on no day the board is drawing. A day that is not drawn
        // has to leave the board exactly as it found it.
        if (ev.day >= DAY_SPAN) {
          late.push({ names: lineNames, title: resolved.title, startMin: ev.startMin,
            endMin: ev.endMin != null ? ev.endMin : ev.startMin + 30,
            location: ev.location || null, allDay: !!resolved.allDay });
          return;
        }
        // A rule can mark an otherwise-timed event allDay (e.g. a calendar
        // that lists "Public Holiday" as a timed 00:00 entry) — that now
        // routes into the all-day strip instead of the timeline, same as a
        // genuine ICS all-day entry, rather than being silently dropped.
        if (resolved.allDay) {
          placeAllDay(resolved, lineNames, Math.floor(ev.startMin / 1440));
          return;
        }
        // A LONG BLOCK IS AN EVENT LIKE ANY OTHER.
        //
        // A school day, a shift, a desk booking, a delivery used to be a
        // SIDING: a second kind of thing, carried in its own array, with its
        // own geometry, its own caption pass and its own marks, whose whole
        // effect was to take the line off its own lane for the length of it.
        // Nine hours of "Desk booking" displaced Homer's entire day for a
        // fact about where he was sitting, and a line spending the day off
        // its lane is a line whose name at the head of the board points at
        // empty paper.
        //
        // A long block is a person being somewhere for a long time, which is
        // what every event on this board is. It travels as an event, and the
        // client draws it on the main track rather than out in a lane: the
        // marks and the caption say where they are and for how long, and the
        // track stays where its name says it is. Shared by two people it is
        // a shared event, which is a convergence, which is what two children
        // at the same school all day actually looks like.
        var primary = registry.add(lineNames[0], 1);
        // a co-owner on a shared/interchange event gets a smaller weight
        // toward side balancing — they have a ring there too, but it's not
        // "their" event the way the primary owner's is
        var interchangeWith = lineNames.slice(1).map(function (n) { return registry.add(n, 0.5).key; });
        if (lineNames.length > 1) registry.link(lineNames, null, ev.startMin);
        events.push({
          line: primary.key,
          interchange_with: interchangeWith.length ? interchangeWith : undefined,
          title: resolved.title,
          parts: resolved.parts,
          todo: ev.todo || undefined,
          startMin: ev.startMin,
          endMin: ev.endMin != null ? ev.endMin : ev.startMin + 30,
          location: ev.location || null,
        });
      });
      parsedIcs.allDay.forEach(function (ev) {
        var resolved = applyCalendarRules(ev, ev.weekday != null ? ev.weekday : todayWeekday, cal, parsed.globalRules, parsed.everyoneLine);
        if (resolved.hide) return;
        // The range travels with it: parseIcs already counted which day of
        // the holiday this is, and nothing further down can work it out
        // once the entry has been cut down to a day.
        if (cal.holiday || resolved.holiday) {
          placeHoliday(resolved, ev.day, ev.span, ev.index);
          return;
        }
        var lineNames = resolved.lineNames || (cal.fallbackName ? [cal.fallbackName] : null)
          || (parsed.allLines && parsed.allLines.length ? parsed.allLines.slice() : null) || (calLabel ? [calLabel] : null);
        if (!lineNames || !lineNames.length) return;
        // WHICH DAY IT IS ON, carried rather than assumed. Dropped here,
        // every all-day entry read as day 0: a holiday that is tomorrow's
        // was declared on today's board, and on a board set to tomorrow
        // the filter below threw every one of them away.
        placeAllDay(resolved, lineNames, ev.day);
      });
    } catch (e) {
      // one calendar failing must not blank the whole render, and must not
      // pass unnoticed either: it is named on the board like any other.
      failed('it could not be read: ' + (e && e.message ? e.message : e));
    }
    for (var ti = evs0; ti < events.length; ti++) events[ti].feed = calIx;
    for (var ai = ad0; ai < allDayEvents.length; ai++) allDayEvents[ai].feed = calIx;
    for (var hi = hol0; hi < holidays.length; hi++) holidays[hi].feed = calIx;
  }));

  pruneState(state, (parsed.calendars || []).map(function (c) { return c.url; }));

  // ---- one event, drawn once -------------------------------------------
  //
  // Two calendars can describe the SAME thing. Bart's "L6 School Day" and
  // Lisa's "L2 School Day" both rename to "School Day", run the same hours,
  // and are the same school day — but they arrived as two events and were
  // drawn as two sidings with two captions, on lines that could be at
  // opposite ends of the board. Anything with the same title over the same
  // minutes is one event on several lines.
  //
  // Merging them here rather than in the template also means the layout
  // learns that those two people are together, which is what decides the
  // order the lines are laid out in.
  function mergeAcrossLines(list) {
    var byWhat = {}, out = [];
    list.forEach(function (ev) {
      var k = ev.title + '\u0000' + ev.startMin + '\u0000' + ev.endMin;
      var seen = byWhat[k];
      if (!seen) { byWhat[k] = ev; out.push(ev); return; }
      var mine = [seen.line].concat(seen.interchange_with || []);
      if (mine.indexOf(ev.line) >= 0) return;             // the same line twice: a duplicate, drop it
      seen.interchange_with = (seen.interchange_with || []).concat([ev.line]);
      if (!seen.location && ev.location) seen.location = ev.location;
    });
    return out;
  }
  var keyToName = {};
  Object.keys(registry.byName).forEach(function (n) { keyToName[registry.byName[n].key] = n; });
  function linkMerged(list) {
    list.forEach(function (ev) {
      if (!ev.interchange_with || !ev.interchange_with.length) return;
      var names = [ev.line].concat(ev.interchange_with)
        .map(function (k) { return keyToName[k]; }).filter(Boolean);
      if (names.length > 1) registry.link(names, null, ev.start_min);
    });
  }
  // ---- which day the board draws
  //
  // One day, chosen by the setting (resolved at the top, before the
  // fetches), and everything is rebased onto it so the rest of the pipeline
  // sees an ordinary single-day board: minutes from that day's own
  // midnight, one entry in `days`, that day's date on the header and that
  // day's forecast beside it. Nothing downstream has to know which day it
  // is looking at, which is the point: "show tomorrow" is a question about
  // WHICH day, not about how a day is drawn.
  //
  // ONE EXCEPTION, AND IT IS STILL REBASED. A day with almost nothing on it
  // borrows the next one (see QUIET_DAY_MAX_EVENTS): the run becomes two
  // days rather than one, minute zero is still the shown day's own
  // midnight, and the board is handed an explicit window into that run.
  // Everything downstream still reads one number line starting at the day
  // it is about; all that changes is how far it goes.
  var shownDay = days[0];
  var dayLo = 0;
  // WHAT THE BOARD IS GIVEN, WHICH IS EVERYTHING THIS GATHERED.
  //
  // Where the drawing OPENS and where it CLOSES are both the solver's now
  // (`day.js opened()` and `framed()`), and the last of the layout to leave
  // this file. What used to be here -- a step, a lookback, a lead, a "quiet
  // day", a decision to borrow tomorrow and a 24-hour cap on the result --
  // was all answering a question this file cannot see the paper for: one
  // payload is drawn by four views at four sizes.
  //
  // It fed back on itself, too. The later the window opened the further its
  // 24 hours reached into tomorrow, so trimming the morning BOUGHT a night,
  // and a board with seven things still on it borrowed Tuesday to draw it.
  //
  // So: both days, from this day's own midnight, and the client takes what it
  // can hold. What falls outside is still in here and still counted, which is
  // where "+N earlier" and "+N more" come from.
  var dayHi = dayLo + (days.length > 1 ? 2880 : 1440);
  // FROM THE DAY'S OWN MIDNIGHT, NOT FROM THE WINDOW.
  //
  // An event the window has moved past is not an event the board has never
  // heard of: the client counts everything before its leading edge and
  // writes "+N earlier" there, which is how a board that has dropped the
  // morning says so instead of quietly being short of it. Filtered out
  // here, that count was zero and four meetings left the board without a
  // word. The window still decides what is DRAWN; this decides what the
  // board knows about.
  function onShownDay(list) {
    return list.filter(function (e) {
      if (e.startMin == null) return false;
      // Or still going at midnight: the night shift that began yesterday is
      // on this morning's board, from the board's midnight, and says when it
      // really began (`began_min`).
      return (e.startMin >= dayLo && e.startMin < dayHi) || (e.startMin < dayLo && e.endMin != null && e.endMin > dayLo);
    }).map(function (e) {
      var c = Object.assign({}, e);
      c.startMin = Math.max(0, e.startMin - dayLo);
      if (e.startMin < dayLo) c.beganMin = e.startMin - dayLo;
      if (e.endMin != null) c.endMin = e.endMin - dayLo;
      return c;
    });
  }
  events = onShownDay(events);
  // Tomorrow's all-day entries travel too, each carrying its day: a rolling
  // board that reaches into tomorrow says "Annual leave · Tue" at the head
  // (day.js statesFor), and one that does not draw tomorrow says nothing.
  allDayEvents = allDayEvents.filter(function (e) { return (e.day || 0) < (days.length || 1); });
  // A HOLIDAY IS A FACT ABOUT ONE DAY, AND THE BOARD MAY BE DRAWING TWO.
  //
  // Christmas is not Christmas Eve's business, so a holiday is stated on its
  // own day and nowhere else. That used to mean day zero and only day zero,
  // which was right while the board drew exactly one day and the reader could
  // pick which. A rolling board reaches into tomorrow and draws tomorrow's
  // appointments, and said nothing about tomorrow being Boxing Day -- it drew
  // the meetings and left out the one fact that explains them.
  //
  // So the borrowed day's holiday travels too, carrying the day it belongs to
  // so the badge for that day can state it (rule 59) and the other one does
  // not. Still one name per day, never two (rule 63).
  // A holiday travels with the day it belongs to, for as many days as the
  // payload carries: the badge for that day states it and the other one does
  // not. It used to be cut to day zero unless the board had decided to borrow
  // tomorrow; the board has not decided anything by this point any more.
  holidays = holidays.filter(function (h) { return (h.day || 0) < (days.length || 1); });

  events = mergeAcrossLines(events);
  linkMerged(events);

  events.sort(function (a, b) { return a.startMin - b.startMin; });
  registry.finalize(); // every calendar is in and every event tallied — decide sides now

  // Everything drawn from the forecast belongs to the day on the board.
  // Read at a fixed day 0, the rain markers and the sunset were today's on
  // a board headed with tomorrow's date, which is the same mistake as the
  // temperature and less obvious to catch.
  //
  // The index is into the SNAPSHOT's own run of days, which may have
  // started before today: a forecast fetched last night is still being
  // drawn this morning, and its day 0 is yesterday. Slide by however many
  // civil days have passed since it was taken, and if that runs off the
  // end of the run there is simply nothing to say about this day.
  var snapIx = civilDaysSince(weather && weather.date, today);
  var shownWx = (snapIx >= 0 && weather && weather.perDay && weather.perDay[snapIx]) || null;
  // The day after the one being shown, which only a rolling board draws.
  // The forecast may not reach it -- it is fetched for the run this has
  // always gathered -- and a day with no forecast simply says nothing about
  // the weather rather than borrowing the day before's.
  var nextWx = (snapIx >= 0 && weather && weather.perDay && weather.perDay[snapIx + 1]) || null;
  // One row per day the board may draw, in order, each naming its own day.
  // A short weekday travels with the long one because the board has to be
  // able to write a date marker into a strip an hour label wide.
  function dayRow(civil, wx) {
    return {
      label: dateLabel(civil, extra.locale, extra.strings),
      weekday: dateName(extra.strings, extra.locale || 'en', 'long', 'weekday', civil.y, civil.mo, civil.d),
      weekdayShort: dateName(extra.strings, extra.locale || 'en', 'short', 'weekday', civil.y, civil.mo, civil.d),
      weather: wx,
    };
  }
  var dayRows = [dayRow(shownDay, shownWx || (snapIx === 0 && weather && weather.header) || null)];
  // Sent whenever there IS a tomorrow, not only when this decided to draw
  // one: the row is how the drawn span names the day it reaches into, and
  // which span that is has moved to the client.
  if (days.length > 1) dayRows.push(dayRow(days[1], nextWx));
  function ofShownDay(key) {
    if (shownWx && Array.isArray(shownWx[key])) return shownWx[key];
    // A snapshot with no run of days in it can only be describing its own
    // first day. On any other day, nothing is better than the wrong day's.
    return (snapIx === 0 && weather && Array.isArray(weather[key])) ? weather[key] : [];
  }

  // EACH PERSON'S RUNG OF THE STYLE LADDER, remembered by name in the saved
  // state (assignLineSlots). "Shared" is decided the way the page decides
  // it: where the config names its people, a line that is not one of them
  // is a shared calendar's, and takes no rung.
  var legendLines = registry.all();
  var namedAny = legendLines.some(function (l) { return l.configured === true; });
  legendLines.forEach(function (l) { l.shared = namedAny && l.configured === false; });
  assignLineSlots(legendLines, state);
  legendLines.forEach(function (l) { delete l.shared; });
  var metro = buildMetro(
    legendLines, events,
    ofShownDay('milestones'),
    // the forecast for the day being shown, not for today: a board set to
    // tomorrow that carries today's temperature is wrong about the only
    // day it is drawing
    shownWx
      || (snapIx === 0 && weather && weather.header)
      || { hi: null, lo: null, condition: null, rain_chance: null },
    // The "now" marker, and every car riding it, is a statement about
    // where in the day we are. On a board showing tomorrow there is no
    // such minute: drawn anyway it parks a train on each line at a time
    // nobody has reached yet, and drags the axis out to hold a clock badge
    // for a day that has not started.
    nowMin,
    timeLabel(DAY_START_MIN) + ' ' + timeLabel(DAY_END_MIN),
    allDayEvents,
    Object.assign({}, extra, {
      dateLabel: dateLabel(shownDay, extra.locale, extra.strings),
      dateIso: isoDate(shownDay),
      // Composed against the day being shown and the clock on it, so it
      // can neither warn about a day nobody is looking at nor about an
      // hour that has gone.
      // The clock only travels with the day we are standing in: on any
      // other day there is no "already gone".
      // A CALENDAR SILENT FOR A DAY OUTRANKS THE WEATHER.
      //
      // One band, and two things that might want it. Rain is a fact about the
      // day the reader can see out of the window; a calendar that has said
      // nothing since yesterday means the people on this board are showing a
      // day that has been and gone, and they cannot tell by looking. The
      // weather alert is the one that waits.
      serviceAlert: feedAlert(inOrder(loudAt), (extra && extra.strings) || I18N.en)
        || alertFor(extra, snapIx, nowMin),
      // "Today" is only true when it is
      todayWord: true,
      // one entry per day the board MAY draw, each with its own date and
      // its own forecast: a two-day board showing one temperature is
      // wrong about one of the days
      days: dayRows,
      calendarsDown: inOrder(downAt), holidays: holidays })
  );
  metro.board_notice = boardNotice(metro, { failed: inOrder(failedAt), read: feedsRead }, (extra && extra.strings) || I18N.en);
  return metro;
}

// WHY THE BOARD IS EMPTY. A header over an empty map says nothing about
// whether the day is quiet, the setting is broken, or every feed is down, and
// those want three different things done about them. Null when the board has
// something on it.
// THE BAND ALONG THE BOTTOM, SAYING A CALENDAR HAS BEEN GONE A DAY.
//
// Same shape as the weather's, so the template prints it the same way, with
// no icon of its own: the mark is drawn (see the banner in shared.liquid),
// because this one has to be right on a 1-bit panel with nothing fetched.
// The words are the ones already used under the map, so nothing new is
// translated -- what changes is how loudly they are said.
function feedAlert(names, strings) {
  if (!names || !names.length) return null;
  var tpl = tr(strings, 'feed_down');
  var vars = { n: names.join(', ') };
  return { kind: 'feed', icon: null, label: null, text: fmt(tpl, vars),
           parts: segments(tpl, vars, { _: '', n: 'b' }) };
}

function boardNotice(metro, why, strings) {
  var empty = !metro || (!(metro.legend || []).length && !(metro.events || []).length && !(metro.all_day || []).length);
  // Every feed failing is said even over the lines `lines` keeps drawn:
  // empty rails with names on them look like a quiet day.
  var allFailed = why && why.failed && why.failed.length && !why.read;
  if (!empty && !allFailed && why !== 'config_invalid' && why !== 'list_invalid') return null;
  if (why === 'config_invalid') return tr(strings, 'notice_config_invalid');
  if (why === 'list_invalid') return tr(strings, 'notice_list_invalid');
  if (why === 'demo_failed') return tr(strings, 'notice_demo_failed');
  if (allFailed) return tr(strings, 'notice_feeds_failed', why.failed.join(', '));
  return tr(strings, 'notice_nothing');
}

// ---------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------

async function run(input) {
  // The demo is not something anybody has to switch on: an empty Calendars
  // box rides it already, further down. This is the developer's override --
  // run the example day even over a set of real feeds -- so it is off unless
  // the form says otherwise.
  var useDemoRaw = cf(input, 'use_demo_data').trim().toLowerCase();
  var useDemo = useDemoRaw === 'true';
  // TWO boxes, and a switch that says which one is meant. Calendar Links
  // takes a name and a link per line; Calendars takes the setup helper's
  // JSON. Only the chosen box is read: TRMNL keeps a hidden field's old
  // value, and reading both drew a stale list over an emptied config (and
  // once, a retired calendar_urls box over an emptied Calendars). A device
  // from before the switch existed has no answer in it, and reads the box
  // it always read, with the other as a fallback. Either box still takes
  // either shape, because parseConfig reads whatever is in it.
  var setupMode = cf(input, 'setup_mode').trim().toLowerCase();
  var readBox = setupMode === 'links' ? 'list' : setupMode === 'config' ? 'config'
    : (cf(input, 'config_json').trim() ? 'config' : 'list');
  var configRaw = (readBox === 'list' ? cf(input, 'calendar_list') : cf(input, 'config_json')).trim();
  // Which demo board to show. Unknown or unset falls back to Springfield.
  var demoSet = cf(input, 'demo_set');
  var latLonRaw = cf(input, 'lat_lon').trim();
  // The timeline runs along whichever side of the canvas is longer. That is
  // the only answer that is ever right — a vertical timeline on a landscape
  // panel wastes most of the board — so it is no longer a setting to get
  // wrong. The field still travels in the payload, always 'auto', because
  // the template reads it and a device on an older build still sends one.
  var orientation = 'auto';
  // Parse once, up front: locale, zone, clock and temperature unit all come
  // from the config when it sets them, and the demo is driven by a config
  // too, so both paths read the same settings from the same place. (Demo
  // mode may still fall back to the built-in day further down; that fallback
  // keeps whatever locale and clock were resolved here.)
  // RIDE THE DEMO UNTIL SOMEBODY FILLS IN SOME DATA.
  //
  // The settings promise the example day for an empty box, and a config
  // that names no calendars (`{}`, an empty `calendars`) is an empty box
  // written as JSON. Only text that cannot be read as a config or as links
  // says so on the board instead: that is a broken paste, and an example
  // day over it would hide the fault.
  var typedCfg = configRaw ? parseConfig(configRaw) : null;
  var noUsableConfig = !typedCfg || !typedCfg.calendars.length;
  var configProblem = !useDemo && typedCfg && typedCfg.unreadable ? (readBox === 'list' ? 'list_invalid' : 'config_invalid') : null;
  if (configProblem) warn('the ' + (readBox === 'list' ? 'Calendars' : 'Configuration') + ' box could not be read; the board shows the example day and says so');

  // Read before anything else needs it, and written back on every exit
  // below: what the weather was last time the API answered, which feeds
  // have been failing and since when, what those feeds are called, and the
  // last translated string table this device managed to download.
  var state = readState(input);
  // One deadline for the render, shared by the language file, the weather,
  // the demo's own config and every calendar.
  var deadline = Date.now() + RENDER_BUDGET_MS;

  // The demo's config is fetched, not carried (see demoConfigFor), so it
  // needs the deadline and it can fail. A demo with no config has no
  // calendars to read and draws the empty board, which is what it already
  // does when the calendars themselves will not load.
  var demoCfg = (useDemo || (noUsableConfig && !configProblem)) ? await demoConfigFor(demoSet, deadline) : null;
  var effectiveCfg = demoCfg ? parseConfig(JSON.stringify(demoCfg))
    : (typedCfg && typedCfg.calendars.length ? typedCfg : parseConfig('{}'));
  var locale = effectiveCfg.locale || userLocale(input);
  var tempUnit = resolveTempUnit(effectiveCfg.temperatureUnit, cf(input, 'temperature_unit').trim(), locale);

  // EVERYTHING THAT FETCHES STARTS NOW, TOGETHER. The language file, then
  // the forecast, then the feeds, one after the other, spent the budget in
  // a queue: a slow forecast left the calendars less than a second.
  var prefetched = {};
  (effectiveCfg.calendars || []).forEach(function (cal) {
    var u = feedUrl(cal.url), k = feedKey(u, cal.headers);
    if (!prefetched[k]) prefetched[k] = fetchFeedText(u, deadline, cal.headers);
  });
  // ...AND THE NEWS, which needs neither a calendar nor a location.
  var newsUrls = newsLinks(cf(input, 'news_feeds'));
  // "fit", the default: one row, as many headlines as fit along it with
  // separators; a number is that many rows
  var newsCountRaw = cf(input, 'news_count').trim().toLowerCase();
  var newsFit = newsCountRaw === 'fit' || !newsCountRaw;
  var newsMax = newsFit ? 1 : Math.max(1, Math.min(5, parseInt(newsCountRaw, 10) || 3));
  var newsStarted = newsUrls.length
    ? fetchNews(newsUrls, deadline, state, Math.floor(Date.now() / 1000), newsMax, newsFit).catch(function () { return null; })
    : null;
  var wxStarted = null, wxOpts = null;
  if (latLonRaw) {
    try {
      var wxTz = resolveTz(effectiveCfg.timeZone, input);
      // The example day borrows the location's own clock for the sun.
      if (useDemo || noUsableConfig) {
        var nowTsW = (input.trmnl && input.trmnl.system && input.trmnl.system.timestamp_utc) || Math.floor(Date.now() / 1000);
        wxOpts = { localSun: true, dateKey: isoDate(fromEpoch(nowTsW * 1000, wxTz)) };
      }
      wxStarted = fetchWeather(latLonRaw, typeof wxTz === 'string' ? wxTz : 'GMT', deadline, tempUnit, wxOpts);
    } catch (e) { warn('the forecast could not be asked for: ' + (e && e.message ? e.message : e)); wxStarted = null; }
  }

  var strings = await loadStrings(locale, state, deadline);
  var hour12 = resolveHour12(
    (effectiveCfg.timeFormat || cf(input, 'time_format').trim()).toLowerCase(), locale);
  // Read once, applied to whichever forecast each path below ends up with.
  // The thresholds are read in the board's own unit, so "cold at or below
  // 0" means 0 of whatever the header is showing.
  var alertOpts = alertSettings(input, tempUnit, strings, hour12);
  var news = newsStarted ? await newsStarted : null;
  var extra = { orientation: orientation, locale: locale, strings: strings, hour12: hour12,
    tempUnit: tempUnit, deadline: deadline, alertOpts: alertOpts, prefetched: prefetched, news: news };

  // Every exit returns through here. The runtime stores what comes back as
  // `trmnl_state` and hands it to the next render as `input.trmnl.state`, so
  // a render that fell back to the demo must still return it: dropping it
  // on the failing paths would throw away the remembered weather and the
  // "down since" clocks exactly when they matter.
  function done(metro) {
    // `data`, not `metro`: a serverless transform's returned keys ARE the
    // template's root variables, so this is the name every template path
    // starts with.
    return { data: metro, trmnl_state: state };
  }

  if (useDemo || noUsableConfig) {
    // Demo mode has no config.timeZone of its own — resolve straight to
    // the account's own zone/offset (still falling back to UTC) so the
    // "now" marker and any real weather fetch land on the viewer's
    // actual local day, not an arbitrary fixed one.
    var demoTz = resolveTz(effectiveCfg.timeZone, input);
    var demoNowMin = null;
    var demoDate = null;
    try {
      var nowTsDemo = (input.trmnl && input.trmnl.system && input.trmnl.system.timestamp_utc) || Math.floor(Date.now() / 1000);
      var demoToday = fromEpoch(nowTsDemo * 1000, demoTz);
      demoNowMin = demoToday.h * 60 + demoToday.mi;
      demoDate = dateLabel(demoToday, locale, strings);
    } catch (e) { /* no clock rather than an invented one */ }
    var demoWx = await resolveWeather(latLonRaw, demoTz, deadline, state, tempUnit, strings, wxStarted, wxOpts);
    if (configProblem) {
      return done(buildEmpty(demoWx.weather, demoNowMin, Object.assign({ dateLabel: demoDate }, extra,
        { weatherStale: demoWx.stale, wxSnapshot: demoWx.snapshot, notice: boardNotice(null, configProblem, strings) })));
    }
    // A demo board has no location, so it would draw no sunrise, no rain
    // and no header weather at all. The sky band, which is half the
    // point of the map, was invisible to anyone who had not already
    // configured a real one. The built-in board gets built-in weather;
    // it needs no network and it applies to the demo ONLY.
    if (!demoWx.weather) {
      var demoSnap = demoWeatherSnapshot(demoSet);
      demoWx = { weather: materializeWeather(demoSnap, strings, tempUnit), stale: false, snapshot: demoSnap };
    }
    var demoExtra = Object.assign({ dateLabel: demoDate }, extra,
      { weatherStale: demoWx.stale, wxSnapshot: demoWx.snapshot });
    // Prefer driving the demo through the real pipeline against this repo's
    // own ICS files, so what it shows is what a working config produces.
    // Any failure — offline device, GitHub unreachable, a bad fetch — falls
    // straight back to the built-in Springfield data rather than an empty
    // board, so the demo is never blank.
    try {
      // No state on the demo path: these are this repo's own demo files,
      // not the user's calendars, and a CDN hiccup on one of them must not
      // put "demo/simpsons/bart.ics" on the board as a feed that is down,
      // nor leave its URL in saved state after the device is configured.
      var demoMetro = await buildFromConfig(input, effectiveCfg, demoWx.weather, demoExtra, null);
      // Every demo member has something on every day, so all of them must
      // come back. Anything less means some calendars failed while others
      // answered — a stale CDN copy, a 404 on a newly added file — and a
      // half-resolved board (two lines out of five, someone else's events)
      // is worse than the offline day. "Some lines appeared" is not a
      // successful demo.
      // The demo is a known quantity: these five lines, no others. Every
      // member has something on every day, and every school/family entry
      // matches a rule that routes it to one of them, so a correct demo
      // resolves to exactly this set. Anything else means the pipeline read
      // something other than what this repo ships — a stale CDN copy of one
      // calendar while the rest are current is the case that actually
      // happens, and it renders a mixed board that is nobody's day. An
      // unexpected line is as wrong as a missing one; both fall back.
      var want = demoCfg.lines.map(function (t) { return t.name; });
      var got = (demoMetro && demoMetro.legend ? demoMetro.legend : []).map(function (t) { return t.name; });
      var complete = want.length === got.length
        && want.every(function (n) { return got.indexOf(n) >= 0; });
      // AND EVERY ONE OF THEM HAS SOMETHING ON.
      //
      // A declared line is drawn on its quiet day now rather than dropped,
      // so "all five names came back" stopped meaning "all five calendars
      // answered": a fetch that returned nothing at all still produced the
      // full set of names over a completely empty board, and that passed as
      // a good demo. Every demo member has something on every day, so an
      // idle one is the same evidence a missing one was.
      var busy = {};
      var keyOf = {};
      (demoMetro && demoMetro.legend ? demoMetro.legend : []).forEach(function (t) { keyOf[t.name] = t.key; });
      (demoMetro && demoMetro.events ? demoMetro.events : []).forEach(function (e) {
        busy[e.owner] = true;
        (e.co_owners || []).forEach(function (k) { busy[k] = true; });
      });
      (demoMetro && demoMetro.all_day ? demoMetro.all_day : []).forEach(function (a) {
        (a.owners || []).forEach(function (k) { busy[k] = true; });
      });
      var everyoneBusy = want.every(function (n) { return !!busy[keyOf[n]]; });
      // A PARTIAL DEMO IS STILL THE DEMO. This fell back to the hand-written
      // day whenever one feed was stale or missing, on the grounds that a
      // half-resolved board is worse than the offline one. There is no
      // offline one, and the reasoning does not survive without it: what a
      // stale feed produces here is exactly what a stale feed produces for
      // a real config, which is the thing the demo exists to show.
      if (!complete || !everyoneBusy) demoMetro.demo_partial = true;
      if (demoMetro.board_notice) demoMetro.board_notice = boardNotice(null, 'demo_failed', strings);
      return done(demoMetro);
    } catch (e) { /* nothing came back at all: an honestly empty board */ }
    return done(buildEmpty(demoWx.weather, demoNowMin, Object.assign({}, demoExtra, { notice: boardNotice(null, 'demo_failed', strings) })));
  }

  // Reached only with calendars to draw: `noUsableConfig` above sends an
  // empty or unusable config to the demo path, weather and all.
  var parsed = effectiveCfg; // never throws — falls back to a bare URL list on invalid JSON

  try {
    var configTz = resolveTz(parsed.timeZone, input);
    var wx = await resolveWeather(latLonRaw, configTz, deadline, state, tempUnit, strings, wxStarted);
    var cfgExtra = Object.assign({}, extra,
      { weatherStale: wx.stale, wxSnapshot: wx.snapshot });
    return done(await buildFromConfig(input, parsed, wx.weather, cfgExtra, state));
  } catch (e) {
    return done(buildEmpty(null, null, Object.assign({}, extra, { notice: tr(strings, 'notice_error') })));
  }
}

if (typeof module !== 'undefined') {
  module.exports = run;
}
