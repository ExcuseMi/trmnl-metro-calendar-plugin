'use strict';

// A HOLIDAY IS A PROPERTY OF THE DAY, SO IT IS STATED WHERE THE DAY IS.
//
// An all-day event is a state a LINE is in: half term, leave, a night
// shift. It is declared at that line's head, and both ends of that line
// become open chevrons because its day is a slice of something longer
// (rules 54 and 55, cases/all-day.js).
//
// A public holiday is not that. Nobody owns Christmas Day: it has no hour,
// so a scale of hours is the wrong place for it and drawing it there
// prints the board's own window back as its hours; it has no owner, so a
// line's head is the wrong place for it and puts a whole country against
// whoever the rules happened to route it to; and a line of its own is the
// worst of the three, because a line costs a band of the cross axis and a
// holiday is not a person.
//
// So it is named beside the date, on the date's own row. These cases hold it
// there: that it is said once, that it is said nowhere else, that it opens
// nobody's ends, and above all that it is FREE -- a board with a holiday
// draws the same map as the same board without one, because the whole
// argument for naming it beside the date, over the three alternatives, is
// that the map does not pay for it.
//
// WHERE THE DATE IS has moved since these cases were written. It was a band
// above the map; it is now the day badge on the hour strip, which stands at
// the boundary its day begins at and costs the map nothing at all, because
// the strip was already being drawn. So `rep.badges` is what these read, and
// every assertion below is the one it always was: the holiday is named where
// the day is named, once, on that row and not under it.
//
// AND THEY GO IN THROUGH THE PAYLOAD NOW. They used to be patched into the
// demo data the BUILD reads, because the header was Liquid and a fixture
// could not reach it. The badge is script, and script reads `METRO.holidays`
// -- which is the fixture's own payload, the same route the real transform
// sends them by. So a holiday is a property of the board under test rather
// than of the page it was built into, which is both simpler and closer to
// what the device does.

module.exports = function (test, h) {
  const { layout, VIEWPORTS, fixtures, pathsWhere, hasClass, assert, assertEqual } = h;

  const ROOMY = VIEWPORTS.find((v) => v.name === 'x-landscape');
  const busy = fixtures.find((f) => f.name === 'busy-day');
  // A SLOT NARROW ENOUGH FOR A COMPACT HEADER, which none of the shared
  // viewports is: an OG full board is 800x480 and escapes `compact`, and
  // og-half is narrow enough to be `tiny`, where the header goes entirely.
  // The ladder between the two is a real size a mashup gives a board, and
  // it is the only place the give-way order can be watched.
  const COMPACT = { name: 'og-slot-600', w: 800, h: 480, slot: { w: 600, h: 480 },
    classes: 'screen--og screen--md screen--1bit screen--density-1x' };

  const CHRISTMAS = [{ title: 'Christmas Day', day_index: 0, day_span: 1, day_label: null }];
  const BREAK = [{ title: 'Spring Break', day_index: 2, day_span: 5, day_label: 'Day 3 of 5' }];
  // transform caps the list at one, so a payload carrying two is a payload
  // this board should never see. Here on purpose: what the drawing does with
  // one it was handed anyway is the thing worth pinning.
  const TWO = [
    { title: 'Christmas Day', day_index: 0, day_span: 1, day_label: null },
    { title: 'School Holiday', day_index: 4, day_span: 14, day_label: 'Day 5 of 14' },
  ];
  // The same board with a holiday on it. The holiday belongs to the day the
  // board opens on, which is what day_index and day_span are relative to.
  function withHoliday(fixture, holidays) {
    return { name: fixture.name, metro: Object.assign({}, fixture.metro, { holidays: holidays }) };
  }

  // The day badge that carries the date: the first one on the board, which is
  // the run's first day, which is the day a holiday in the payload is about.
  function badgeItems(rep, cls) {
    const b = (rep.badges || [])[0];
    return ((b && b.items) || [])
      .filter((i) => (' ' + i.cls + ' ').indexOf(' ' + cls + ' ') >= 0);
  }

  test('the harness can see the day badge at all', () => {
    // Otherwise every case below passes by having nothing to look at. The
    // badge reports as one run-together string in `labels`, so its parts
    // reached no report until they were asked for by name.
    const rep = layout(busy, ROOMY);
    assert((rep.badges || []).length > 0, 'no day badge was reported');
    assertEqual(badgeItems(rep, 'metro-date').length, 1,
      'the badge has no date for a holiday to sit beside');
  });

  test('the day is named beside its date, once', () => {
    const rep = layout(withHoliday(busy, CHRISTMAS), ROOMY);
    assertEqual(badgeItems(rep, 'metro-holiday-name').map((i) => i.text), ['Christmas Day'],
      'the holiday is not stated beside the date, or is stated twice');
  });

  test('it sits with the date rather than below it', () => {
    // Not a second row. The badge sits ON the hour strip, whose depth the map
    // has already been laid out against, so a second row would be a name
    // written over the scale or over the map itself.
    const rep = layout(withHoliday(busy, CHRISTMAS), ROOMY);
    const date = badgeItems(rep, 'metro-date')[0];
    const name = badgeItems(rep, 'metro-holiday-name')[0];
    const share = Math.min(date.y + date.h, name.y + name.h) - Math.max(date.y, name.y);
    assert(share > Math.min(date.h, name.h) * 0.5,
      'the holiday is on its own row: date at y=' + Math.round(date.y)
      + ', holiday at y=' + Math.round(name.y));
    assert(name.x > date.x, 'the holiday should read after the date it qualifies');
  });

  for (const v of VIEWPORTS) {
    test('the map is not charged for it: ' + v.name, () => {
      // THE ARGUMENT FOR NAMING IT HERE, stated as an assertion. A band on
      // the scale, a line of its own, a row at every head: each of the three
      // costs the map depth or width, on a board that is already 96% spent.
      // This one costs nothing, at any size, and if it ever starts costing
      // something the reason for having chosen it is gone.
      const without = layout(busy, v);
      const withIt = layout(withHoliday(busy, CHRISTMAS), v);
      assertEqual(Math.round(withIt.canvas.h), Math.round(without.canvas.h),
        'the canvas lost height to a holiday');
      assertEqual(withIt.paths.length, without.paths.length,
        'the drawing changed. A holiday is not a line, not a branch and not a mark');
      // ...and it did not make the strip deeper either, which is the one way
      // a word on the badge could still take height off the map.
      const a = (without.badges || [])[0], b = (withIt.badges || [])[0];
      if (a && b) {
        assert(Math.round(b.h) <= Math.round(a.h) + 1,
          'the badge grew taller: the holiday wrapped onto a second line');
      }
    });
  }

  test('nothing is drawn for it AT AN HOUR', () => {
    // The defect this replaces: an all-day entry drawn as an event spanning
    // the visible window, so the board printed its own window back as the
    // holiday's hours. A holiday has no hour at all.
    //
    // The badge itself is not that, and this case has to say which it means
    // now that the words are inside the canvas rather than in a band above
    // it. The badge stands at the day's own boundary and names the DAY; what
    // is forbidden is the holiday appearing as an event on a line, as a
    // caption at a minute, or as a second mark somewhere on the scale.
    const rep = layout(withHoliday(busy, CHRISTMAS), ROOMY);
    const said = rep.labels.filter((l) => l.text.indexOf('Christmas Day') >= 0);
    assertEqual(said.length, 1, 'the holiday is stated ' + said.length
      + ' times on the canvas; it is one fact about one day');
    assert(hasClass(said[0], 'metro-daybadge'),
      '"Christmas Day" is drawn as ' + said[0].cls + ' at ' + Math.round(said[0].x)
      + ',' + Math.round(said[0].y) + '. It has no hour to put it at.');
  });

  test('it declares nobody to be away', () => {
    // An all-day event opens both ends of its line into chevrons, because
    // that line's day really is a slice of something longer. A holiday
    // says nothing about any line: on Christmas Day everybody's line still
    // starts and ends on Christmas Day.
    const rep = layout(withHoliday(busy, CHRISTMAS), ROOMY);
    assertEqual(pathsWhere(rep, 'terminal-open').length, 0,
      'a holiday opened a line\'s ends as if that person were on it');
    assertEqual(pathsWhere(rep, 'origin-tie').length, 0,
      'a holiday tied the heads together as if it were one of them');
    const routeRows = rep.labels.filter((l) => (' ' + l.cls + ' ').indexOf(' metro-route ') >= 0);
    assertEqual(routeRows.length, 0, 'a holiday was declared at a line\'s head');
  });

  test('inside a range it says which day of it this is', () => {
    // "Spring Break" runs a week and the board draws one day of it. That
    // ordinal is the only thing telling the Monday from the Thursday, and
    // it is the fact a household actually wants.
    const rep = layout(withHoliday(busy, BREAK), ROOMY);
    assertEqual(badgeItems(rep, 'metro-holiday-name').map((i) => i.text), ['Spring Break']);
    const day = badgeItems(rep, 'metro-holiday-day');
    assertEqual(day.length, 1, 'the range said nothing about where in it we are');
    assert(day[0].text.indexOf('Day 3 of 5') >= 0,
      'expected the ordinal, got ' + JSON.stringify(day[0].text));
  });

  test('a squeezed badge keeps the name and drops the ordinal', () => {
    // THE BADGE GIVES WAY IN A STATED ORDER, and the order is about what a
    // reader loses: which day of the holiday it is EXPLAINS, and a badge with
    // no room to explain still has to name the day. A narrow slot is where to
    // watch it, because the badge competes for axis length with the hours and
    // the clock rather than for a row of its own.
    const rep = layout(withHoliday(busy, BREAK), COMPACT);
    assertEqual(badgeItems(rep, 'metro-holiday-name').filter((i) => i.shown).map((i) => i.text),
      ['Spring Break'], 'the name went with the ordinal, or the badge went entirely');
    assertEqual(badgeItems(rep, 'metro-holiday-day').filter((i) => i.shown).length, 0,
      'the ordinal survived onto a squeezed badge, where the name is what matters');
    assertEqual(badgeItems(rep, 'metro-date').filter((i) => i.shown).length, 1,
      'the date went: it is the one part of the badge that outlasts the rest');
  });

  test('a day carrying two holidays names one of them', () => {
    // transform.js hands over one name. Two of them came out as "Christmas D"
    // and "School Holid", each cut mid word, with the ordinal wrapped
    // underneath: naming the day is this badge's job, enumerating it is not.
    // The second name is dropped in the payload's own cap, not in the
    // drawing, so this is the case that keeps the drawing honest about it.
    const rep = layout(withHoliday(busy, TWO), ROOMY);
    assertEqual(badgeItems(rep, 'metro-holiday-name').map((i) => i.text), ['Christmas Day'],
      'the badge drew more than one name, or the wrong one');
  });

  test('the name reads before the weather, not through it', () => {
    // The badge is one row: date, then what the day is, then what the sky is
    // doing. Out of order or overlapping, the words stop being a statement
    // about that day and become a pile at the head of the scale.
    const rep = layout(withHoliday(busy, CHRISTMAS), ROOMY);
    const name = badgeItems(rep, 'metro-holiday-name').filter((i) => i.shown)[0];
    const wx = badgeItems(rep, 'metro-temp').filter((i) => i.shown);
    assert(name, 'the holiday was not drawn at all on a roomy board');
    if (!wx.length) return;              // a spent day keeps its name and gives up its numbers
    assert(name.x + name.w <= wx[0].x + 1,
      'the holiday runs into the weather: it ends at ' + Math.round(name.x + name.w)
      + ' and the temperature starts at ' + Math.round(wx[0].x));
  });

  test('a rolling board states the borrowed day\'s holiday on its own badge', () => {
    // THE CASE E25 WAS OPENED FOR. A rolling board draws tomorrow's
    // appointments; if tomorrow is Boxing Day it has to say so, and it has to
    // say it beside TOMORROW's date rather than beside today's, or the board
    // has declared the wrong day a holiday.
    const roll = fixtures.find((f) => f.name === 'rolling-quiet');
    if (!roll) return;                       // no two-day fixture to ask with
    // At five in the afternoon, when the board reaches into tomorrow.
    const eve = { name: roll.name, metro: Object.assign({}, roll.metro, { now_min: 17 * 60 }) };
    const rep = layout(withHoliday(eve, [
      { title: 'Boxing Day', day: 1, day_index: 0, day_span: 1, day_label: null },
    ]), ROOMY);
    const badges = rep.badges || [];
    assert(badges.length >= 2, 'this board should carry a badge for each of its days');
    const named = badges.map((b) => (b.items || [])
      .filter((i) => (' ' + i.cls + ' ').indexOf(' metro-holiday-name ') >= 0)
      .map((i) => i.text));
    assertEqual(named[0], [], 'the opening day claimed the borrowed day\'s holiday');
    assertEqual(named[1], ['Boxing Day'],
      'the borrowed day did not say what day it is: ' + JSON.stringify(named));
  });

  test('a board with no holiday says nothing about one', () => {
    const rep = layout(busy, ROOMY);
    assertEqual(badgeItems(rep, 'metro-holiday').length, 0,
      'an empty holiday list still drew its container');
  });
};
