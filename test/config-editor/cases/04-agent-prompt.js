'use strict';

// The prompt the tool hands to an AI assistant. It has to carry everything
// the assistant cannot see for itself: what this plugin draws, the shape of
// a configuration, what makes a board read well, and above all what is
// actually in the calendars, since fetching an ICS is the one part most
// assistants cannot do.

module.exports = function (test, h) {
  const { loadEditor, click, fireInput, assert, assertEqual, jsonOut } = h;

  const ICS = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:Planet Express',
    'BEGIN:VEVENT', 'UID:1@x', 'SUMMARY:Fry: Coffee (100 cups)',
    'DTSTART:20240101T073000', 'DTEND:20240101T080000',
    'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'LOCATION:Kitchen', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:2@x', 'SUMMARY:Leela: Pre-flight Check',
    'DTSTART:20240101T080000', 'DTEND:20240101T083000',
    'RRULE:FREQ=WEEKLY;BYDAY=MO,TU', 'END:VEVENT',
    'END:VCALENDAR', '',
  ].join('\r\n');

  function withOneCalendar() {
    const { document } = loadEditor();
    document.getElementById('importIn').value = JSON.stringify({
      calendars: [{ url: 'https://a.example/crew.ics' }],
    });
    click(document.getElementById('loadImport'));
    return document;
  }

  test('the prompt states the task, the format and the design rules', () => {
    const document = withOneCalendar();
    click(document.getElementById('makePrompt'));
    const p = document.getElementById('promptOut').value;
    assert(p.length > 800, 'the prompt is only ' + p.length + ' characters');
    for (const must of ['Metro Calendar', '## What to do', '## Format', '## Calendars',
      'keepLine', 'ONE JSON object']) {
      assert(p.indexOf(must) >= 0, 'the prompt never mentions ' + JSON.stringify(must));
    }
    // the schema is quoted from the page's own reference, not a second copy
    const ref = document.getElementById('schemaRef').textContent.trim().split('\n')[1];
    assert(p.indexOf(ref) >= 0, 'the prompt does not carry the page\'s own schema');
  });

  // THE FEEDS NOBODY THINKS TO ADD. People paste their own calendars; the bin
  // day is what a wall board is most useful for, and nobody goes looking for
  // its feed unless asked. The prompt has the assistant ask, with or without
  // calendars given.
  test('the prompt has the assistant ask about a bin collection feed, and the other easily forgotten ones', () => {
    for (const document of [withOneCalendar(), loadEditor().document]) {
      click(document.getElementById('makePrompt'));
      const p = document.getElementById('promptOut').value;
      assert(/## Feeds worth asking about/.test(p), 'no section about the feeds worth asking for');
      assert(/bin or waste collection/i.test(p) && /ics|webcal|webdav/i.test(p), 'bin collection feeds are not asked about by their link');
      assert(/public holidays/i.test(p) && /school/i.test(p), 'holidays and school are not mentioned');
    }
  });

  test('the prompt lists the calendars, and says so when it has not read one', () => {
    const document = withOneCalendar();
    click(document.getElementById('makePrompt'));
    const p = document.getElementById('promptOut').value;
    assert(p.indexOf('https://a.example/crew.ics') >= 0, 'the URL is missing');
    assert(/ask for its \.ics TEXT/.test(p),
      'an unread feed should send the assistant after the text, not leave it at a refusal');
    // A browser cannot read most calendar feeds -- no CORS header -- so an
    // assistant that cannot fetch either has to be able to say what WILL
    // work, or the user gets a refusal with no way forward.
    assert(/CORS/.test(p), 'the prompt does not say why the tool could not read the feed');
    assert(/Paste \/ upload instead/.test(p),
      'the prompt does not name the control that gets the events in by hand');
  });

  test('a feed the tool has read is digested into the prompt', () => {
    // this is the part that makes the answer good: the titles, when they
    // run and on which days are what a pattern looks like
    const document = withOneCalendar();
    const ta = document.querySelector('#sources textarea');
    ta.value = ICS;
    ta.dispatchEvent(new document.defaultView.Event('input'));
    click(document.getElementById('makePrompt'));
    const p = document.getElementById('promptOut').value;
    assert(p.indexOf('Fry: Coffee (100 cups)') >= 0, 'the event titles are missing');
    assert(p.indexOf('07:30-08:00') >= 0, 'the times are missing');
    assert(p.indexOf('MO,TU,WE,TH,FR') >= 0, 'the days are missing');
    assert(p.indexOf('@ Kitchen') >= 0, 'the location is missing');
    assert(p.indexOf('Feed name: Planet Express') >= 0, "the feed's own name is missing");
    assert(!/Fetch this URL yourself/.test(p), 'it should not ask for a feed it already has');
  });

  test('an existing configuration is handed over to improve on', () => {
    const { document } = loadEditor();
    document.getElementById('importIn').value = JSON.stringify({
      lines: [{ name: 'Fry' }],
      calendars: [{ url: 'https://a.example/crew.ics',
        rules: [{ match: { type: 'regex', value: '^Fry:' }, line: 'Fry' }] }],
    });
    click(document.getElementById('loadImport'));
    click(document.getElementById('makePrompt'));
    const p = document.getElementById('promptOut').value;
    assert(p.indexOf('## The configuration so far') >= 0, 'the existing config is not offered');
    assert(p.indexOf('"^Fry:"') >= 0, 'the existing rules are not in it');
    // and it is the same JSON the tool would hand to TRMNL
    assert(p.indexOf(document.getElementById('jsonOut').value) >= 0,
      'the config in the prompt is not the one the tool produces');
  });

  // The answer is pasted into a settings box by hand, so how it is written
  // matters as much as what it says. Unfenced JSON comes back out of a chat
  // window escaped for markdown, with a backslash before every bracket, and
  // the parser on the other end is a JSON parser and nothing else.
  test('the prompt pins down the shape of the reply', () => {
    const document = withOneCalendar();
    click(document.getElementById('makePrompt'));
    const p = document.getElementById('promptOut').value;
    assert(p.indexOf('## How to reply') >= 0, 'the prompt never says how to reply');
    assert(/fenced code block/.test(p), 'it does not ask for a fenced block, which is what stops the escaping');
    assert(/escape the JSON for markdown/.test(p), 'it does not forbid markdown escaping');
    assert(/Straight ASCII quotes/.test(p), 'it does not forbid typographic quotes');
    assert(/No comments, no trailing commas/.test(p), 'it does not forbid comments and trailing commas');
  });

  // An assistant that cannot reach the network will happily write a
  // configuration from what a URL looks like it contains. That config parses,
  // loads, and routes nothing: every rule matches an event that was guessed.
  //
  // The first answer to that was "refuse", and it worked too well: ChatGPT
  // and DeepSeek both came back with a flat "I cannot read these feeds",
  // which is true, correct, and of no use to anybody. Neither the browser
  // nor the assistant can fetch a calendar feed, so a route through the
  // network was never going to open. The .ics TEXT is the route that does
  // work: it can be pasted into the chat or into the tool. So the rule is
  // still "no guessing", but the instruction is to ask rather than to stop.
  test('the prompt asks for the calendar text rather than settling for a refusal', () => {
    const document = withOneCalendar();
    click(document.getElementById('makePrompt'));
    const p = document.getElementById('promptOut').value;
    assert(/Do not guess what is in a feed/.test(p), 'guessing from the URL is not ruled out');
    assert(/ASK for the calendar's \.ics text/.test(p),
      'the prompt does not send the assistant after the text it can actually read');
    assert(/Write no configuration until you have real events/.test(p),
      'nothing stops it writing a configuration from nothing');
    assert(/most assistants cannot/.test(p),
      'the prompt still pretends fetching the URL is a route that works');
  });

  // THE TOOL KNOWS BEFORE THE ROUND TRIP IS SPENT.
  //
  // A prompt with no events in it comes back as a refusal every time, and
  // the tool can see that the moment the button is pressed: it knows how
  // many feeds are configured and how many it has actually read.
  test('generating a prompt with no events read says so, and says what to do', () => {
    const document = withOneCalendar();
    click(document.getElementById('makePrompt'));
    const st = document.getElementById('promptStatus');
    assert(/no events/.test(st.textContent), 'it does not warn that the prompt is empty of events');
    assert(/Draw the map first/.test(st.textContent), 'it does not say what would fix it');
    assert(st.className.indexOf('err') >= 0, 'a prompt that will be refused is reported as fine');
  });

  // NOTHING TO READ MEANS ASK, NOT GUESS.
  //
  // The prompt used to note "(none added yet)" under Calendars and then
  // carry on with every rule about how to write the configuration. An
  // assistant given all that and nothing to apply it to writes one anyway:
  // it invents three people, invents their feeds, and hands back something
  // that looks right and routes nothing. With no links the only useful
  // answer is a question.
  test('with no calendars the prompt asks for links instead of inviting a guess', () => {
    const { document } = loadEditor();
    click(document.getElementById('makePrompt'));
    const p = document.getElementById('promptOut').value;
    assert(/STOP: no calendars were given/.test(p), 'it does not say there is nothing to read');
    assert(/Do NOT write a configuration/.test(p), 'it does not forbid writing one anyway');
    assert(/Secret address in iCal format/.test(p), 'it does not say where to find a link');
    assert(p.indexOf('## The configuration so far') < 0, 'there is no configuration to offer yet');
  });

  test('with a calendar in, the prompt stops asking and starts working', () => {
    const { document } = loadEditor();
    h.addFeed(document, 'https://example.com/a.ics', 'Fry');
    click(document.getElementById('makePrompt'));
    const p = document.getElementById('promptOut').value;
    assert(!/STOP: no calendars were given/.test(p), 'it still thinks it has nothing to read');
    assert(p.indexOf('https://example.com/a.ics') >= 0, 'the calendar is not in the prompt');
  });
  // The bug that made this section worth rewriting: an assistant gave every calendar a
  // friendly name, one event in two of them matched no rule, and the board came back with
  // seven lines for five people. The schema alone cannot teach that, so the prompt has to
  // say it in words.
  test('the prompt says whose a calendar is goes in line, and that a name is only a label', () => {
    const document = withOneCalendar();
    click(document.getElementById('makePrompt'));
    const p = document.getElementById('promptOut').value;
    assert(/Say whose a calendar is with `"line"`/.test(p), 'the prompt does not say how a calendar says whose it is');
    assert(/`name` is only a label/.test(p), 'it does not say what a calendar name is');
    assert(/never changes the title/.test(p) && /`"title": "Standup"`/.test(p), 'it does not say routing leaves titles alone, or how to replace one');
    assert(/Count the lines your configuration produces/.test(p), 'it never asks for the count to be checked');
  });

  // A schema tells you what is allowed. It does not tell you what a good answer looks like,
  // and every assistant that only got the schema wrote rules that parse and route nothing.
  test('the prompt carries a complete worked example', () => {
    const document = withOneCalendar();
    click(document.getElementById('makePrompt'));
    const p = document.getElementById('promptOut').value;
    assert(p.indexOf('## A worked example') >= 0, 'there is no worked example');

    // it has to be JSON that actually parses: a broken example teaches broken output
    const block = p.slice(p.indexOf('## A worked example'));
    const fence = /```json\n([\s\S]*?)\n```/.exec(block);
    assert(fence, 'the worked example is not in a json fence');
    const ex = JSON.parse(fence[1]);

    assert(ex.lines.length >= 3, 'the example has no tracks to speak of');
    const rules = ex.calendars.reduce((all, c) => all.concat(c.rules || []), []);
    assert(rules.some((r) => r.rewrite === '' && r.match.type === 'regex' && /\^\[A-Za-z\]\+:/.test(r.match.value)),
      'no rule that strips a name prefix off the title');
    assert(rules.some((r) => Array.isArray(r.line) && r.line.length > 1), 'no shared event with a track list');
    assert(!rules.some((r) => r.siding === true || r.station === true),
      'the worked example still teaches a key the config does not have any more');
    assert(rules.some((r) => r.hide === true), 'no hide rule');
    assert(ex.calendars.some((c) => !c.name), 'every calendar in the example is named, which is the mistake it is meant to teach');

    // and it is checked against the same parser the device runs
    const parsed = document.defaultView.parseConfig(JSON.stringify(ex));
    assert(parsed.calendars.length === ex.calendars.length, 'the worked example does not survive parseConfig');
    assert(Object.keys(parsed.lines).length === ex.lines.length, 'the example\'s tracks do not survive parseConfig');

    // EVERY RULE IN IT HAS TO DO SOMETHING.
    //
    // `compileRule` drops any rule that names no track, hides nothing,
    // rewrites nothing and sets no allDay -- `rename` on its own is not an
    // effect. The example carried one of those for a long time
    // (`{"contains": "Plant Shift", "rename": false}`) and nothing noticed,
    // because parsing the config still succeeded: the rule was simply gone.
    //
    // An example inside a prompt teaches by imitation, and an assistant
    // cannot tell an inert line from a subtle one. It will copy either.
    for (let i = 0; i < ex.calendars.length; i++) {
      const wrote = (ex.calendars[i].rules || []).length;
      const kept = (parsed.calendars[i].rules || []).length;
      assertEqual(kept, wrote, 'calendar ' + i + ' of the worked example: '
        + (wrote - kept) + ' of its ' + wrote + ' rules compile to nothing and are '
        + 'dropped. A rule needs an effect -- a track, a hide, a rewrite or an '
        + 'allDay -- and `rename` alone is not one.');
    }
  });

  // The one mistake in this prompt that costs nothing to make and gives
  // nothing back: `and` and `or` take a list called `matchers`, and `not`
  // takes a single `matcher`. Told otherwise, an assistant writes
  // `{"type":"not","matchers":[...]}`, `compileMatcher` returns null for the
  // missing `spec.matcher`, and `compileRule` then drops the whole rule --
  // no error, no warning, just a rule that quietly is not there.
  test('the prompt gets the shape of `not` right', () => {
    const document = withOneCalendar();
    click(document.getElementById('makePrompt'));
    const text = document.getElementById('promptOut').value;
    assert(/\bnot.{0,80}\bmatcher\b/s.test(text),
      'the prompt never says `not` takes a single `matcher`');
    assert(!/`not`\s*taking\s*`matchers`/.test(text)
      && !/`and`\s*\/\s*`or`\s*\/\s*`not`\s*taking\s*`matchers`/.test(text),
      'the prompt still says `not` takes `matchers`, which compiles to a dropped rule');
  });

  // timeZone and locale are account settings. An assistant has no way to know either, and a
  // guessed zone silently redraws the whole day at the wrong hour, so the prompt must not
  // put them in front of it at all.
  test('the prompt never offers timeZone or locale', () => {
    const document = withOneCalendar();
    click(document.getElementById('makePrompt'));
    const p = document.getElementById('promptOut').value;
    const schema = p.slice(p.indexOf('## Format'), p.indexOf('## A worked example'));
    assert(schema.indexOf('timeZone') < 0, 'the schema still offers timeZone');
    assert(schema.indexOf('"locale"') < 0, 'the schema still offers locale');
    assert(p.indexOf('Europe/Brussels') < 0, 'the prompt still shows a time zone to copy');
  });

  // Both are chosen by the plugin now, against data the assistant cannot see (the day's
  // real event counts, the panel's theme). Anything it picks can only be worse.
  test('the prompt does not offer side or color, and says not to set them', () => {
    const document = withOneCalendar();
    click(document.getElementById('makePrompt'));
    const p = document.getElementById('promptOut').value;
    const schema = p.slice(p.indexOf('## Format'), p.indexOf('## A worked example'));
    assert(schema.indexOf('"side"') < 0, 'the schema still lists side');
    assert(schema.indexOf('"color"') < 0, 'the schema still lists color');
    assert(/no setting for either/.test(p), 'the prompt does not say there is no setting for them');
  });

  // LET THE AI ASK. Forced to answer with JSON alone, an assistant that could
  // not tell which class code was whose child hid both children's school
  // days. What the calendars cannot settle comes back as short questions
  // with a guess each, and the JSON after; the people already known are said,
  // so they are not asked about.
  test('the prompt lets the assistant ask first, and names the people it already knows', () => {
    const document = withOneCalendar();
    click(document.getElementById('makePrompt'));
    let p = document.getElementById('promptOut').value;
    assert(/Before writing any configuration, list what the calendars do not settle/.test(p), 'no question step');
    assert(/class code/.test(p) && /for everyone or only some/.test(p) && /noise/.test(p), 'the step does not say what to ask about');
    const reply = p.slice(p.indexOf('## How to reply'), p.indexOf('## What makes this board read well'));
    assert(/FIRST reply is only a short numbered list of questions/.test(reply) && /at most six/.test(reply), reply);
    assert(/best guess/.test(reply) && /No JSON in that reply/.test(reply), reply);
    assert(/Nothing outside the fence/.test(reply), 'the JSON reply lost its one-fence rule');
    assert(p.indexOf('## People') < 0, 'no people are known yet, and the prompt lists some');

    h.addFeed(document, 'https://a.example/quinn.ics', 'Quinn');
    h.addFeed(document, 'https://a.example/jules.ics', 'Jules');
    click(document.getElementById('makePrompt'));
    p = document.getElementById('promptOut').value;
    assert(/## People\nAlready known, one line each: Quinn, Jules\. Do not ask who lives here\./.test(p), 'the known people are not listed');
    assert(/listed under "People" are known/.test(p));
  });
};
