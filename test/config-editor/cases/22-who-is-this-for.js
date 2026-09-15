'use strict';

// A LINK, AND WHO IT IS FOR.
//
// The tool used to ask for the map's structure before anybody had the parts to
// build it out of: a Lines section at the top -- declare your people, one per
// card, with a side and a colour picker each -- and then a Calendars section
// underneath where every feed was pointed back at one of those declarations
// through a multi-select. Two forms, and the first of them asked a question
// nobody has an answer to until they have their calendars in hand.
//
// A line on the map IS a person, so one pair of answers decides everything:
// "here is Homer's calendar" adds Homer to `lines`, names the feed after him
// so the board can say whose feed is down, and writes the one rule that sends
// every event in it to his line. That is the shape demo-config.json is written
// in and the shape the plugin is built around. These cases hold the tool to
// asking exactly those two questions, and to the people section being a view
// of the answers rather than a form of its own.

module.exports = function (test, h) {
  const { loadEditor, fireInput, fireChange, click, jsonOut, addFeed, assert, assertEqual } = h;

  const cards = (document) => [...document.querySelectorAll('#calendars .card')];
  const people = (document) => [...document.querySelectorAll('#lines .card')];
  const nameOf = (card) => card.querySelector('input.title-input').value;
  const whoOf = (card) => card.querySelector('input.who-input').value;
  const status = (document) => document.getElementById('addStatus').textContent;

  test('two answers produce the configuration the plugin expects', () => {
    const { window, document } = loadEditor();
    addFeed(document, 'https://calendar.example.com/homer.ics', 'Homer');
    assertEqual(jsonOut(document), {
      lines: [{ name: 'Homer' }],
      calendars: [{
        url: 'https://calendar.example.com/homer.ics', name: 'Homer',
        line: 'Homer',
      }],
    });
    // and the plugin reads it back as one line with that feed on it. Its own
    // registry is keyed on the folded name, so it is the count and the
    // fallback that are worth asserting, not the spelling of a key.
    const parsed = window.parseConfig(document.getElementById('jsonOut').value);
    assertEqual(Object.keys(parsed.lines).length, 1);
    assertEqual(parsed.everyoneLine, 'Homer');
    assertEqual(parsed.calendars.length, 1);
  });

  test('a household is the same two answers, once per person', () => {
    const { document } = loadEditor();
    ['Homer', 'Marge', 'Bart'].forEach((n) => {
      addFeed(document, 'https://calendar.example.com/' + n.toLowerCase() + '.ics', n);
    });
    const cfg = jsonOut(document);
    assertEqual(cfg.lines.map((t) => t.name), ['Homer', 'Marge', 'Bart']);
    assertEqual(cfg.calendars.length, 3);
    cfg.calendars.forEach((c, i) => {
      assertEqual(c.line, cfg.lines[i].name,
        'calendar ' + i + ' does not route to its own person');
    });
    assertEqual(people(document).map(nameOf), ['Homer', 'Marge', 'Bart'],
      'the people section does not show what the answers produced');
  });

  // The form empties itself and puts the cursor back in the link box, because
  // the answer to "next calendar?" in a household is usually yes.
  test('adding a calendar clears the form and says whose line it went on', () => {
    const { document } = loadEditor();
    addFeed(document, 'https://calendar.example.com/lisa.ics', 'Lisa');
    assertEqual(document.getElementById('newUrl').value, '');
    assertEqual(document.getElementById('newWho').value, '');
    assert(/Lisa/.test(status(document)), 'it does not say whose calendar was added: ' + status(document));
    assertEqual(document.activeElement, document.getElementById('newUrl'),
      'the cursor is not back on the first question');
  });

  // The second calendar for somebody is a pick, not a spelling test: two
  // people called Alex and Alexa are one typo away from one line drawn twice,
  // and nothing downstream can tell them apart.
  test('a second calendar for the same person adds no second person', () => {
    const { document } = loadEditor();
    addFeed(document, 'https://calendar.example.com/homer-work.ics', 'Homer');
    addFeed(document, 'https://calendar.example.com/homer-bowling.ics', 'Homer');
    assertEqual(jsonOut(document).lines, [{ name: 'Homer' }]);
    assertEqual(jsonOut(document).calendars.length, 2);
    // and the names already in use are offered, by button and by datalist
    const quick = document.getElementById('whoQuick');
    assert(!quick.hidden, 'the people already here are not offered');
    const names = [...quick.querySelectorAll('button')].map((b) => b.textContent);
    assertEqual(names, ['Homer']);
    assertEqual([...document.querySelectorAll('#peopleNames option')].map((o) => o.value), ['Homer']);
    click(quick.querySelector('button'));
    assertEqual(document.getElementById('newWho').value, 'Homer',
      'picking somebody already here did not answer the question');
  });

  // THE PLUGIN FOLDS THE CASE AND THE EDITOR HAS TO AGREE.
  //
  // parseConfig keys its line registry on the lowered name, so "homer" on the
  // second calendar and "Homer" on the first are one line on the board. The
  // editor would have listed two people, drawn two cards and written two
  // entries in `lines`, and nothing on the page would have explained why the
  // map showed one.
  test('a name that differs only in case is the same person', () => {
    const { window, document } = loadEditor();
    addFeed(document, 'https://calendar.example.com/one.ics', 'Homer');
    const card = addFeed(document, 'https://calendar.example.com/two.ics', 'homer');
    assertEqual(jsonOut(document).lines, [{ name: 'Homer' }], 'a second person was invented out of the case');
    assertEqual(jsonOut(document).calendars[1].line, 'Homer');
    // and the box shows the spelling that was recorded, not the one typed
    fireChange(card.querySelector('input.who-input'));
    assertEqual(card.querySelector('input.who-input').value, 'Homer');
    assertEqual(Object.keys(window.parseConfig(document.getElementById('jsonOut').value).lines).length, 1);
  });

  // A calendar just added is the one being set up, so its card opens on the
  // feed's own options rather than hiding them under More options.
  test('a calendar just added opens on its own options, and only the newest one does', () => {
    const { document } = loadEditor();
    const card = addFeed(document, 'https://calendar.example.com/bins.ics', 'Homer');
    const opts = card.querySelector('details.opts');
    assert(opts && opts.open, 'the new calendar\'s options are closed');
    assert(/times and stops/i.test(opts.textContent), 'the feed options are not in it');
    assert(!card.querySelector('details.adv:not(.opts)').open, 'rules and headers opened as well');
    const other = addFeed(document, 'https://calendar.example.com/two.ics', 'Marge');
    const cards = document.querySelectorAll('#calendars .card');
    assert(other.querySelector('details.opts').open, 'the second calendar did not open');
    assert(!cards[0].querySelector('details.opts').open, 'the first one stayed open');
  });

  test('the link is required, and has to look like a link', () => {
    const { document } = loadEditor();
    fireInput(document.getElementById('newWho'), 'Homer');
    click(document.getElementById('addCalendar'));
    assertEqual(jsonOut(document).calendars, [], 'a calendar with no link was added');
    assert(/link/i.test(status(document)), 'it does not say what is missing: ' + status(document));

    fireInput(document.getElementById('newUrl'), 'my calendar');
    click(document.getElementById('addCalendar'));
    assertEqual(jsonOut(document).calendars, [], 'something that is not a link was added');
    assert(/https:\/\//.test(status(document)),
      'it does not say what a link looks like: ' + status(document));
    // nothing was thrown away while it was refused
    assertEqual(document.getElementById('newWho').value, 'Homer');
  });

  // AN UNANSWERED FEED IS THE HOUSEHOLD'S, AND THAT IS THE ZERO-CONFIGURATION
  // ANSWER FOR A SHARED CALENDAR.
  //
  // This used to say the events land on the FIRST person's line, because that
  // is what the plugin did: the household fallback was the first entry in
  // `lines`. It is every entry now. A calendar with no name and no rules is
  // nearly always the shared one -- the bin day, the meals, the feed somebody
  // pasted in without saying whose it was -- so handing it to whoever happens
  // to be first was a confident wrong answer that nothing on the board
  // admitted to, and handing it to everybody is right for the common case and
  // visibly wrong where it is wrong.
  //
  // Which makes "leave the answer blank" the complete and correct way to say
  // "this one is the whole house's": nothing is written for it at all, and the
  // message has to say so rather than naming a person.
  test('a calendar added with no answer belongs to the whole household', () => {
    const { document } = loadEditor();
    addFeed(document, 'https://calendar.example.com/bins.ics');
    assertEqual(jsonOut(document).calendars, [{ url: 'https://calendar.example.com/bins.ics' }],
      'a shared feed needs no name and no rules, so nothing should be written for it');
    assert(/household|whole house|every line/i.test(status(document)),
      'it does not say what an unanswered feed does: ' + status(document));
    assert(!/first person/i.test(status(document)),
      'it still says an unanswered feed lands on the first person, which stopped being true: '
        + status(document));
    assertEqual(jsonOut(document).lines, [], 'an unanswered feed invented a person');
  });

  // A FILE IS AN ANSWER TO THE SAME QUESTION.
  //
  // Most calendar feeds cannot be fetched from a web page at all (no CORS
  // header), so handing the page the .ics at the moment the link goes in is
  // what makes the preview draw. The link is still required -- the device
  // fetches by URL, a file only ever feeds this page -- and the file lands
  // against that URL, which is where the preview and the AI prompt look.
  test('a .ics uploaded with the link is read against it', async () => {
    const ICS = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:Homer',
      'BEGIN:VEVENT', 'UID:1@x', 'SUMMARY:Duff with Barney',
      'DTSTART:20260101T190000', 'DTEND:20260101T200000',
      'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU', 'END:VEVENT',
      'END:VCALENDAR', ''].join('\r\n');
    const { window, document } = loadEditor();
    fireInput(document.getElementById('newUrl'), 'https://calendar.example.com/homer.ics');
    fireInput(document.getElementById('newWho'), 'Homer');
    const file = document.getElementById('newFile');
    Object.defineProperty(file, 'files', { value: [new window.File([ICS], 'homer.ics')] });
    file.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 50));   // FileReader is asynchronous

    assertEqual(jsonOut(document).calendars.length, 1, 'the file did not add the calendar it belongs to');
    // the prompt is the page's own account of which feeds it has read
    click(document.getElementById('makePrompt'));
    const p = document.getElementById('promptOut').value;
    assert(/Duff with Barney/.test(p), 'the uploaded events never reached the page: ' + p.slice(-300));
    assert(!/NOT READ/.test(p), 'the feed the file answered for still counts as unread');
  });

  // ------------------------------------------------------------ the people
  //
  // Not a form any more: a view of the answers, which can be corrected. A
  // correction has to reach every place the old name was written, and there
  // are three of them -- the entry in `lines`, the rules that route to it, and
  // the calendar's own `name`, which is what an event no rule routes falls
  // back onto and is drawn as a line.

  test('renaming a person carries their calendar and its rule along', () => {
    const { document } = loadEditor();
    addFeed(document, 'https://calendar.example.com/homer.ics', 'Homer');
    const field = people(document)[0].querySelector('.title-input');
    fireInput(field, 'Homer J');
    fireChange(field);
    assertEqual(jsonOut(document), {
      lines: [{ name: 'Homer J' }],
      calendars: [{
        url: 'https://calendar.example.com/homer.ics', name: 'Homer J',
        line: 'Homer J',
      }],
    });
    assert(document.getElementById('jsonOut').value.indexOf('"Homer"') === -1,
      'the old name is still in the configuration, so the board draws it as a line of its own');
    assertEqual(whoOf(cards(document)[0]), 'Homer J', 'the calendar card still shows the old answer');
  });

  // THE CALENDAR'S NAME IS A REFERENCE TOO, AND IT WAS THE ONE THAT GOT AWAY.
  //
  // Removing a person took them out of every rule that routed to them and left
  // the feed still called Homer. An event no rule routes falls back to the
  // calendar's name, and the plugin draws that name as a line: Homer came
  // straight back onto the board with nobody called Homer anywhere in the
  // editor to explain why.
  test('removing a person leaves nothing routing to them', () => {
    const { window, document } = loadEditor();
    addFeed(document, 'https://calendar.example.com/homer.ics', 'Homer');
    addFeed(document, 'https://calendar.example.com/marge.ics', 'Marge');
    const before = document.getElementById('jsonOut').value;

    click(people(document)[0].querySelector('button[title="Remove this person"]'));
    const text = document.getElementById('jsonOut').value;
    assert(text.indexOf('Homer') === -1, 'the removed person is still named in the configuration: ' + text);
    assertEqual(jsonOut(document).lines, [{ name: 'Marge' }]);
    // AND THEIR CALENDAR GOES WITH THEM. Left behind with no name and no
    // rule, it was the household's: Homer's events on every line at once.
    assertEqual(jsonOut(document).calendars, [{ url: 'https://calendar.example.com/marge.ics', name: 'Marge',
      line: 'Marge' }],
      'the feed that was only theirs stayed, and with nobody named on it the plugin puts it on every line');
    assert(/homer\.ics went too/.test(document.getElementById('linesStatus').textContent),
      'nothing said the calendar went as well: ' + document.getElementById('linesStatus').textContent);
    // The JSON is the only place this shows. `parseConfig` reports the lines a
    // configuration DECLARES, and the phantom is not declared anywhere: it
    // appears at routing time, when an event no rule claims falls back to the
    // calendar's name. So a config that still mentions a removed person is
    // the finding, and asking the plugin about it would answer "one line" in
    // both cases.
    void window;

    click(document.getElementById('undoBtn'));
    assertEqual(document.getElementById('jsonOut').value, before,
      'undo did not put the person back with their calendar');
  });

  // BEING FIRST STOPPED MEANING ANYTHING IN PARTICULAR.
  //
  // The first person's card used to read "Also gets any event no rule claims",
  // and while the plugin's household fallback was the first entry in `lines`
  // that was true. It is every entry now, so the sentence did not just go
  // stale: it named one person out of four as the owner of the shared
  // calendar, on the card of the person it was wrong about, with nothing else
  // on the page to contradict it. The order still decides the dash patterns,
  // which is said once in the section's own lede and not four times on the
  // cards.
  test('the people can be reordered, and nobody claims to catch the strays', () => {
    const { document } = loadEditor();
    addFeed(document, 'https://calendar.example.com/bart.ics', 'Bart');
    addFeed(document, 'https://calendar.example.com/lisa.ics', 'Lisa');
    click(people(document)[1].querySelector('button[title="Move up"]'));
    assertEqual(jsonOut(document).lines.map((t) => t.name), ['Lisa', 'Bart']);
    people(document).forEach((card, i) => {
      assert(!/no rule claims/.test(card.textContent),
        'person ' + i + ' still claims to be the fallback for an unrouted calendar, which is now '
          + 'the whole household: ' + card.textContent);
    });
    // and the section says what the order DOES decide, and who an unrouted
    // calendar really goes to
    const lede = document.querySelector('#station-lines p.lede').textContent;
    assert(/whole household|every line/i.test(lede),
      'the people section does not say where an unrouted calendar goes: ' + lede);
  });

  // A person with nothing behind them draws an empty line, which on a board is
  // simply missing. There is no way to make one deliberately any more, but an
  // imported configuration can carry one, and this is where it shows.
  test('a person says which calendars their line is drawn from', () => {
    const { document } = loadEditor();
    document.getElementById('importIn').value = JSON.stringify({
      lines: [{ name: 'Homer' }, { name: 'Maggie' }],
      calendars: [{ url: 'https://calendar.example.com/homer.ics', name: 'Homer',
        line: 'Homer' }],
    });
    click(document.getElementById('loadImport'));
    // Named as the wizard names it, not by the person ("From Homer" on
    // Homer's own card says nothing) and not by a file name.
    assert(/From the calendar at example\.com/.test(people(document)[0].textContent),
      'a person does not say what their line is drawn from: ' + people(document)[0].textContent);
    assert(/No calendar yet/.test(people(document)[1].textContent),
      'a line with nothing behind it looks exactly like one with a calendar: '
        + people(document)[1].textContent);
  });

  // ------------------------------------------------------------ the shared feed
  //
  // One feed holding several people's days is a real case the format supports
  // and some households need. It stays reachable, behind the simple answer
  // rather than in front of it.

  test('a feed a couple shares is two names in the same box', () => {
    const { window, document } = loadEditor();
    addFeed(document, 'https://calendar.example.com/homer.ics', 'Homer');
    addFeed(document, 'https://calendar.example.com/both.ics', 'Marge, Homer');
    const cfg = jsonOut(document);
    assertEqual(cfg.lines.map((t) => t.name), ['Homer', 'Marge']);
    assertEqual(cfg.calendars[1], {
      url: 'https://calendar.example.com/both.ics',
      line: ['Marge', 'Homer'],
    }, 'a shared feed did not route to both of them, or was named after the pair');
    const parsed = window.parseConfig(document.getElementById('jsonOut').value);
    assertEqual(JSON.stringify(parsed.calendars[1].owner), JSON.stringify(['Marge', 'Homer']), 'the plugin does not read whose the shared feed is');
  });

  // The school feed: only SOME of it is anybody's, so it is split by rules.
  // Those are behind the card's own disclosure, and the simple answer above
  // them still says where whatever no rule claims should land.
  test('splitting a feed by rules is behind the card, and does not need the answer', () => {
    const { document } = loadEditor();
    addFeed(document, 'https://calendar.example.com/bart.ics', 'Bart');
    addFeed(document, 'https://calendar.example.com/lisa.ics', 'Lisa');
    const card = addFeed(document, 'https://calendar.example.com/school.ics');

    const adv = card.querySelector('details.adv:not(.opts)');
    assert(adv, 'the card offers no way to split the feed');
    assert(!adv.open, 'the advanced path is open by default, so the simple case pays for it');
    assert(/split this feed between people/i.test(adv.querySelector('summary').textContent),
      'the summary does not say the split lives in here: ' + adv.querySelector('summary').textContent);

    click(h.buttonByText(card, '+ Add a rule'));
    const rule = card.querySelector('.rule');
    fireInput(rule.querySelector('.cond-value'), 'L6');
    h.selectMulti(rule.querySelector('.line-picker'), ['Bart']);
    const cfg = jsonOut(document);
    assertEqual(cfg.calendars[2], {
      url: 'https://calendar.example.com/school.ics',
      rules: [{ match: { type: 'word', value: 'L6' }, line: 'Bart' }],
    });
    // the card says so on its face, so a split feed does not read as an
    // unanswered one
    assert(/split by rules between Bart/.test(cards(document)[2].textContent),
      'a feed routed by rules does not say who it is routed to: ' + cards(document)[2].textContent);
    // ...and so does the person it was routed to, two sections down. That
    // line is repainted rather than redrawn, because whoever is writing this
    // rule may be typing a name into a person's card at the same moment.
    assert(/From 2 calendars: the calendar at example\.com, the calendar at example\.com \(2\)/.test(people(document)[0].textContent),
      'the person the rule routes to still says their line comes from one feed: '
        + people(document)[0].textContent);
  });

  // The rules editor names people, and there are none until a calendar has
  // been answered for. The dead end used to point at a button that no longer
  // exists ("add a line first"), which is the worst kind of instruction.
  test('a rule with nobody to route to says how to get somebody', () => {
    const { document } = loadEditor();
    click(document.getElementById('addGlobalRule'));
    const sel = document.querySelector('#globalRules .line-picker');
    assert(!sel.querySelector('input'), 'the picker offers a choice of nobody');
    assert(/add a calendar/.test(sel.textContent),
      'it still sends the reader to a control that is gone: ' + sel.textContent);
  });
};
