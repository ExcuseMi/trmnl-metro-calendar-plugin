'use strict';

// THE WIZARD: THE PAGE FOR SOMEBODY DOING THIS ONCE, ALONE.
//
// Everything the other cases in this directory exercise is the editor -- every
// control on screen at once, which is the right page for a person who already
// knows what a rule is. The wizard is the page for the person this tool is
// actually for: in their seventies, on a phone, handed a display and told it
// shows the family's day. It writes into the same state through the same
// functions, so what is under test here is not a second configuration model.
// It is the four things that make the difference between a setup that finishes
// and one that is abandoned:
//
//   1. GETTING THE LINK IS THE WALL. Not the questions. So the link screen
//      carries click-by-click instructions per calendar service, with the
//      menu names as they are spelled on screen, and the way out marked "I
//      cannot find it" leads somewhere rather than nowhere.
//   2. PROVE IT WORKED. A link is abstract; "14 appointments, the next is
//      Swimming on Tuesday at 4" is not. Nothing goes into the configuration
//      before the page has read the feed, unless the reader chooses that.
//   3. LET THE DATA ANSWER. A feed that looks like Remy's on Alex's screen is
//      a yes/no question, and it is the only thing on this page that can
//      catch the wrong tab having been copied.
//   4. THEY WILL CLOSE THE TAB. Answers are saved in this browser and offered
//      back as a question, never restored on their own.
//
// And one rule that changed underneath all of it: a calendar with no name and
// no rules belongs to the WHOLE HOUSEHOLD, not to whoever is first. That makes
// "we all share one calendar" a zero-configuration answer, and the wizard has
// to write nothing at all for it.

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../../..');
const EDITOR = fs.readFileSync(path.join(REPO, 'tools/config-editor.html'), 'utf-8');

module.exports = function (test, h) {
  const { loadEditor, click, fireInput, jsonOut, assert, assertEqual } = h;

  // A feed with a weekly swim in it, a name of its own, and enough events to
  // be worth counting.
  function ics(opts) {
    const o = opts || {};
    const rows = ['BEGIN:VCALENDAR', 'VERSION:2.0'];
    if (o.name) rows.push('X-WR-CALNAME:' + o.name);
    (o.events || [
      { t: 'Swimming', rrule: 'FREQ=WEEKLY;BYDAY=TU', at: '20260915T160000' },
      { t: 'Dentist', at: '20991103T093000' },
      { t: 'Book club', at: '20991110T193000' },
    ]).forEach((e, i) => {
      rows.push('BEGIN:VEVENT', 'UID:' + i + '@x', 'SUMMARY:' + e.t, 'DTSTART:' + e.at);
      rows.push('DTEND:' + e.at.replace(/T(\d{2})/, (m, hh) => 'T' + ('0' + (Number(hh) + 1)).slice(-2)));
      if (e.rrule) rows.push('RRULE:' + e.rrule);
      if (e.where) rows.push('LOCATION:' + e.where);
      rows.push('END:VEVENT');
    });
    rows.push('END:VCALENDAR', '');
    return rows.join('\r\n');
  }
  const template = () => Promise.resolve({ ok: true, status: 200,
    text: () => Promise.resolve(fs.readFileSync(path.join(REPO, 'plugin/src/shared.liquid'), 'utf-8')) });
  // The ordinary case: the calendar itself refuses a request made from a web
  // page (no CORS header), which is what makes the relay the only route left.
  function noDirect(url) {
    return /shared\.liquid$/.test(String(url)) ? template() : Promise.reject(new Error('Failed to fetch'));
  }
  // The rare case where the browser can read the feed on its own, and so
  // nothing is ever sent to a third party.
  function direct(body) {
    return function (url) {
      const u = String(url);
      if (/shared\.liquid$/.test(u)) return template();
      if (/\.ics$/.test(u)) return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(body) });
      return Promise.reject(new Error('Failed to fetch'));
    };
  }

  const q = (document) => document.getElementById('wzQ').textContent;
  const body = (document) => document.getElementById('wzBody').textContent;
  const said = (document) => document.getElementById('wzStatus').textContent;
  const next = (document) => document.getElementById('wzNext');
  // The save is debounced: renderJson runs per keystroke in the editor below,
  // and serialising a few hundred kilobytes of calendar text on each one is a
  // page that stutters while you type. h.flush drains microtasks, not timers.
  const settle = () => new Promise((r) => setTimeout(r, 320));
  // The wizard up to "where is <first person>'s calendar?", with the names in.
  function toFirstLink(document, names, shape) {
    click(document.getElementById('wzStart'));
    names.forEach((n, i) => {
      if (i > 0) click(h.buttonByText(document.getElementById('wzBody'), 'Add another person'));
      fireInput(document.getElementById('wzName' + i), n);
    });
    click(next(document));
    click(document.getElementById('wzShape' + (shape || 'Each')));
  }

  // ---- who lives here --------------------------------------------------

  test('the first question is who lives here, and the answers become the board', () => {
    const { document } = loadEditor();
    click(document.getElementById('wzStart'));
    assert(/who lives here/i.test(q(document)), 'the first question is not who lives here: ' + q(document));
    fireInput(document.getElementById('wzName0'), 'Alex');
    click(h.buttonByText(document.getElementById('wzBody'), 'Add another person'));
    fireInput(document.getElementById('wzName1'), 'Remy');
    click(next(document));
    // the people exist before a single link does, so the board has lines to
    // draw and the reader can see the shape of what is coming
    assertEqual(jsonOut(document).lines, [{ name: 'Alex' }, { name: 'Remy' }]);
    assert(/how are your calendars arranged/i.test(q(document)), 'it did not move on: ' + q(document));
  });

  test('a name taken off the list is taken off the board too', () => {
    const { document } = loadEditor();
    click(document.getElementById('wzStart'));
    fireInput(document.getElementById('wzName0'), 'Alex');
    click(h.buttonByText(document.getElementById('wzBody'), 'Add another person'));
    fireInput(document.getElementById('wzName1'), 'Remy');
    click(next(document));
    assertEqual(jsonOut(document).lines.length, 2);
    // back to the names, and drop one
    click(document.getElementById('wzBack'));
    assert(/who lives here/i.test(q(document)), 'Back did not return to the names: ' + q(document));
    const remove = [...document.querySelectorAll('#wzBody .wz-people button')]
      .find((b) => /Remove/.test(b.textContent) && /Remy/.test(b.getAttribute('aria-label') || ''));
    assert(remove, 'there is no way to remove a name');
    click(remove);
    click(next(document));
    assertEqual(jsonOut(document).lines, [{ name: 'Alex' }],
      'a name removed on this screen stayed on the board as an empty line');
  });

  test('a blank answer is refused in words, not by doing nothing', () => {
    const { document } = loadEditor();
    click(document.getElementById('wzStart'));
    click(next(document));
    assert(/at least one name/i.test(said(document)), 'nothing said why it did not move on: ' + said(document));
    assert(/who lives here/i.test(q(document)), 'it moved on with no names at all');
  });

  // ---- GETTING THE LINK IS THE WALL -----------------------------------

  test('the link screen names the calendar services and spells out the clicks', () => {
    const { document } = loadEditor();
    toFirstLink(document, ['Alex']);
    assert(/where is Alex's calendar/i.test(q(document)), 'the link screen does not name whose: ' + q(document));
    // every service somebody in a household is likely to be on
    ['google', 'icloud', 'outlook', 'nextcloud', 'synology', 'other'].forEach((id) => {
      assert(document.getElementById('wzProv-' + id), 'no instructions offered for ' + id);
    });
    // and nothing is shown until one is picked: six sets of instructions at
    // once is the wall again in a different shape
    assert(!document.querySelector('#wzBody .wz-steps'), 'every service\'s instructions are showing at once');

    click(document.getElementById('wzProv-google'));
    const steps = document.querySelector('#wzBody .wz-steps');
    assert(steps, 'picking a service showed no instructions');
    // THE MENU NAMES AS THEY ARE SPELLED ON SCREEN. A reader is comparing this
    // text word for word with what is in front of them, so "find the ICS feed"
    // is not an instruction and "Settings and sharing" is.
    ['Settings and sharing', 'Integrate calendar', 'Secret address in iCal format'].forEach((phrase) => {
      assert(steps.textContent.indexOf(phrase) >= 0,
        'the Google instructions never say "' + phrase + '"');
    });
    assert(/three dots/.test(steps.textContent), 'it does not say what to click');
    // and the one warning that saves a wasted attempt
    assert(/Public address/.test(steps.textContent),
      'it does not warn against the public address sitting right above the secret one');
    assert(steps.querySelectorAll('li').length >= 4, 'the instructions are not numbered steps');
  });

  test('the two links Outlook offers are told apart, because only one works', () => {
    const { document } = loadEditor();
    toFirstLink(document, ['Alex']);
    click(document.getElementById('wzProv-outlook'));
    const t = document.querySelector('#wzBody .wz-steps').textContent;
    assert(/\.ics/.test(t) && /\.html/.test(t),
      'the Outlook instructions do not say which of the two links is the calendar: ' + t);
    assert(/Shared calendars/.test(t) && /Publish a calendar/.test(t),
      'the Outlook menu names are missing: ' + t);
  });

  test('"I cannot find it" leads somewhere rather than nowhere', () => {
    const { document } = loadEditor();
    toFirstLink(document, ['Alex']);
    click(document.getElementById('wzLost'));
    const t = body(document);
    assert(/Export/.test(t), 'it does not offer the file route');
    assert(/switched off by the employer|Ask whoever/.test(t),
      'it does not admit that some calendars simply cannot be shared');
    assert(/Skip it/.test(t), 'it does not offer to carry on without this one');
  });

  // ---- a refusal has to be actionable --------------------------------

  test('a link that is not a link is refused in plain words', () => {
    const { document } = loadEditor();
    toFirstLink(document, ['Alex']);
    const check = () => click(h.buttonByText(document.getElementById('wzBody'), 'Check this link'));

    check();
    assert(/paste the link/i.test(said(document)), 'an empty box said nothing useful: ' + said(document));

    fireInput(document.getElementById('wzUrl'), 'https://cal.example.com/a b.ics');
    check();
    assert(/space/i.test(said(document)), 'a half-copied link said nothing about the space: ' + said(document));

    fireInput(document.getElementById('wzUrl'), 'notalink');
    check();
    assert(/https:\/\//.test(said(document)), 'it does not say what a link looks like: ' + said(document));

    // the mistake Outlook makes for you
    fireInput(document.getElementById('wzUrl'), 'https://outlook.office.com/owa/calendar/x/reachcalendar.html');
    check();
    assert(/web page/i.test(said(document)) && /\.ics/.test(said(document)),
      'an .html link is not explained: ' + said(document));

    assertEqual(jsonOut(document).calendars, [], 'a refused link was added anyway');
  });

  test('no status code ever reaches the reader', async () => {
    const { document } = loadEditor((url) => {
      if (/metro-calendar\/ics/.test(String(url))) {
        return Promise.resolve({ ok: false, status: 422,
          text: () => Promise.resolve('that does not look like a calendar link') });
      }
      return Promise.reject(new Error('Failed to fetch'));
    });
    toFirstLink(document, ['Alex']);
    fireInput(document.getElementById('wzUrl'), 'https://cal.example.com/not-a-calendar.ics');
    click(h.buttonByText(document.getElementById('wzBody'), 'Check this link'));
    await h.flush();
    click(document.getElementById('wzRelayYes'));
    return h.flush().then(() => {
      // said beside the buttons that asked, not in the status line below Next
      const box = document.getElementById('wzReadError');
      const msg = box ? box.textContent : said(document);
      assert(box && box.closest('.wz-consent'), 'the reason is not next to the buttons pressed');
      assert(/does not look like a calendar link/.test(msg),
        'the relay\'s own reason was swallowed: ' + msg);
      assert(!/\b(404|422|500|502|HTTP)\b/.test(msg), 'a status code reached the reader: ' + msg);
    });
  });

  // ---- PROVE IT WORKED ------------------------------------------------

  test('a link that reads shows what is in the calendar, in words', async () => {
    const { document } = loadEditor(direct(ics({ name: 'Alex' })));
    toFirstLink(document, ['Alex']);
    fireInput(document.getElementById('wzUrl'), 'https://cal.example.com/alex.ics');
    click(h.buttonByText(document.getElementById('wzBody'), 'Check this link'));
    await h.flush();
    const proof = document.querySelector('#wzBody .wz-proof');
    assert(proof, 'nothing proved the link worked: ' + body(document));
    assert(/3 appointments/.test(proof.textContent),
      'it does not count what it found: ' + proof.textContent);
    assert(/Alex/.test(proof.textContent), 'it does not say what the calendar calls itself');
    // the evidence is the CONTENTS, said the way a person would say them
    assert(/Swimming/.test(proof.textContent), 'it does not read out a single appointment');
    assert(/every Tuesday/.test(proof.textContent),
      'a weekly appointment is not described as weekly: ' + proof.textContent);
    assert(!/DTSTART|RRULE|BYDAY|VEVENT/.test(proof.textContent),
      'the raw calendar leaked into the evidence: ' + proof.textContent);
    // and nothing went to a third party, because nothing had to
    assert(/straight from your calendar/.test(said(document)), said(document));
  });

  test('nothing is added until the calendar has been read', async () => {
    const { document } = loadEditor(direct(ics({ name: 'Alex' })));
    toFirstLink(document, ['Alex']);
    fireInput(document.getElementById('wzUrl'), 'https://cal.example.com/alex.ics');
    assert(next(document).hidden, 'there is a way on before the link has been checked');
    assertEqual(jsonOut(document).calendars, []);

    click(h.buttonByText(document.getElementById('wzBody'), 'Check this link'));
    await h.flush();
    assert(!next(document).hidden, 'the link read fine and there is no way on');
    assert(/Alex/.test(next(document).textContent), 'the way on does not say what it will do');
    click(next(document));
    assertEqual(jsonOut(document).calendars, [{
      url: 'https://cal.example.com/alex.ics', name: 'Alex',
      line: 'Alex',
    }]);
  });

  test('an empty calendar is reported as empty rather than as a success', async () => {
    const { document } = loadEditor(direct('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n'));
    toFirstLink(document, ['Alex']);
    fireInput(document.getElementById('wzUrl'), 'https://cal.example.com/alex.ics');
    click(h.buttonByText(document.getElementById('wzBody'), 'Check this link'));
    await h.flush();
    const note = document.querySelector('#wzBody .wz-bad');
    assert(note && /nothing in it/i.test(note.textContent),
      'a calendar with no appointments was presented as a working one: ' + body(document));
    // it is still the reader's decision: a brand new calendar is legitimately empty
    assert(!next(document).hidden, 'an empty calendar cannot be added at all');
  });

  // A FEED OF TASKS IS NOT EMPTY: a bin-day generator exported as to-dos was
  // "a calendar, but there is nothing in it". The plugin reads each task as a
  // moment at its due time, and the check counts them the same way.
  test('a calendar of tasks is read as having something in it', async () => {
    const soon = new Date(Date.now() + 2 * 864e5), p2 = (n) => String(n).padStart(2, '0');
    const due = soon.getUTCFullYear() + p2(soon.getUTCMonth() + 1) + p2(soon.getUTCDate()) + 'T190000Z';
    const todo = (t, extra) => ['BEGIN:VTODO', 'UID:' + t, 'SUMMARY;LANGUAGE="NL":' + t, 'DUE:' + due].concat(extra || []).concat(['END:VTODO']);
    const text = ['BEGIN:VCALENDAR', 'VERSION:2.0'].concat(todo('Restafval'), todo('PMD'), todo('Glas', ['STATUS:COMPLETED']), ['END:VCALENDAR']).join('\r\n') + '\r\n';
    const { document } = loadEditor(direct(text));
    toFirstLink(document, ['Alex']);
    fireInput(document.getElementById('wzUrl'), 'https://cal.example.com/bins.ics');
    click(h.buttonByText(document.getElementById('wzBody'), 'Check this link'));
    await h.flush();
    assert(!document.querySelector('#wzBody .wz-bad'), 'a feed of tasks was called empty: ' + body(document));
    assert(/Restafval|PMD/.test(body(document)), 'the tasks are not read back: ' + body(document));
    assert(!/Glas/.test(body(document)), 'a finished task was read back as to come');
  });

  // SET IT UP WHILE IT IS IN FRONT OF YOU. A bin-day feed shows its own two
  // quirks on the check screen: every reminder written as 19:00 UTC, and
  // bins due at the same minute. The options for both are offered there,
  // ticked, with the evidence, and the list reads back the time that was chosen.
  test('a generated feed is set up on the screen that read it: times as chosen, same-time bins as one stop', async () => {
    const zone = process.env.TZ;
    process.env.TZ = 'Europe/Brussels';
    try {
      const soon = new Date(Date.now() + 2 * 864e5), p2 = (n) => String(n).padStart(2, '0');
      const day = soon.getUTCFullYear() + p2(soon.getUTCMonth() + 1) + p2(soon.getUTCDate());
      const todo = (t) => ['BEGIN:VTODO', 'UID:' + t, 'SUMMARY:' + t, 'DUE:' + day + 'T190000Z', 'END:VTODO'];
      const text = ['BEGIN:VCALENDAR', 'VERSION:2.0'].concat(todo('Restafval'), todo('PMD'), todo('Papier-karton'), ['END:VCALENDAR']).join('\r\n') + '\r\n';
      const { document } = loadEditor(direct(text));
      toFirstLink(document, ['Alex']);
      fireInput(document.getElementById('wzUrl'), 'https://cal.example.com/bins.ics');
      click(h.buttonByText(document.getElementById('wzBody'), 'Check this link'));
      await h.flush();
      const tz = document.getElementById('wzOptTz'), merge = document.getElementById('wzOptMerge');
      assert(tz && merge, 'the options are not offered on the check screen: ' + body(document));
      assert(tz.checked && merge.checked, 'a plainly generated feed did not start with both ticked');
      assert(/19:00 UTC/.test(body(document)), 'the time zone option does not show its evidence: ' + body(document));
      const listed = document.querySelector('#wzBody .wz-proof ul').textContent;
      assert(/\b(19:00|7:00\sPM)/i.test(listed) && !/\b(21:00|9:00\sPM)/i.test(listed), 'the list does not read back the chosen time: ' + listed);
      const box = document.getElementById('wzOptMerge');
      box.checked = false;
      h.fireChange(box);
      click(next(document));
      const cal = jsonOut(document).calendars[0];
      assertEqual(cal.ignoreTimezone, true, 'the time zone answer was not written');
      assert(!cal.mergeSameTime, 'an option unticked on the screen was written anyway');
    } finally {
      if (zone == null) delete process.env.TZ; else process.env.TZ = zone;
    }
  });

  test('an ordinary calendar is not offered options it has no use for', async () => {
    const { document } = loadEditor(direct(ics({ name: 'Alex' })));
    toFirstLink(document, ['Alex']);
    fireInput(document.getElementById('wzUrl'), 'https://cal.example.com/alex.ics');
    click(h.buttonByText(document.getElementById('wzBody'), 'Check this link'));
    await h.flush();
    assert(!document.getElementById('wzOptTz') && !document.getElementById('wzOptMerge'), 'generator options offered for a plain calendar');
    click(next(document));
    const cal = jsonOut(document).calendars[0];
    assert(!cal.ignoreTimezone && !cal.mergeSameTime, 'options written for a plain calendar');
  });

  // ---- the relay, and what it is allowed to do ------------------------

  test('the relay is offered only after the direct read fails, and sends nothing until chosen', async () => {
    const calls = [];
    const { document } = loadEditor((url) => { calls.push(String(url)); return noDirect(url); });
    toFirstLink(document, ['Alex']);
    fireInput(document.getElementById('wzUrl'), 'https://cal.example.com/secret-address.ics');
    click(h.buttonByText(document.getElementById('wzBody'), 'Check this link'));
    await h.flush();

    // the calendar's own host was tried first, which sends the link only to
    // the people who wrote it
    assert(calls.some((u) => /secret-address\.ics$/.test(u)), 'it never tried to read the calendar directly');
    assert(!calls.some((u) => /metro-calendar/.test(u)), 'the relay was called before anybody chose it');

    const box = document.querySelector('#wzBody .wz-consent');
    assert(box, 'nothing asked before offering to send the link on: ' + body(document));
    // the exact link, printed
    assert(box.querySelector('code').textContent === 'https://cal.example.com/secret-address.ics',
      'the consent box does not print the link it would send');
    // whose server
    assert(/trmnl\.bettens\.dev/.test(box.textContent), 'it does not name the server: ' + box.textContent);
    assert(/not to TRMNL/.test(box.textContent), 'it lets the reader think this is TRMNL\'s server');
    // what the link is
    assert(/password/.test(box.textContent), 'it does not say what a calendar link is');
    assert(/keeps no copy|never records/.test(box.textContent), 'it does not say what the server does not do');
    // and it is not a default: there is an answer that sends nothing
    assert(document.getElementById('wzRelayNo'), 'there is no way to say no');
    assert(document.getElementById('wzRelaySkip'), 'saying no is a dead end');
    assertEqual(jsonOut(document).calendars, [], 'the calendar was added while the question was still open');
  });

  test('consent is asked again for the next link, because it is a different link', async () => {
    const { document } = loadEditor(noDirect);
    toFirstLink(document, ['Alex', 'Remy']);
    async function refuse(url) {
      fireInput(document.getElementById('wzUrl'), url);
      click(h.buttonByText(document.getElementById('wzBody'), 'Check this link'));
      await h.flush();
      assert(document.querySelector('#wzBody .wz-consent'), 'no consent was asked for ' + url);
      click(document.getElementById('wzRelaySkip'));
    }
    await refuse('https://cal.example.com/alex.ics');
    assertEqual(jsonOut(document).calendars.length, 1, 'adding it unread did not add it');
    assert(/where is Remy's calendar/i.test(q(document)), 'it did not move on to the next person');
    // the second link asks all over again
    await refuse('https://cal.example.com/remy.ics');
    assertEqual(jsonOut(document).calendars.length, 2);
  });

  test('the relay reads the calendar and the evidence follows', async () => {
    const { document } = loadEditor((url) => {
      const u = String(url);
      if (/metro-calendar\/ics/.test(u)) {
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(ics({ name: 'Alex' })) });
      }
      return noDirect(u);
    });
    toFirstLink(document, ['Alex']);
    fireInput(document.getElementById('wzUrl'), 'https://cal.example.com/alex.ics');
    click(h.buttonByText(document.getElementById('wzBody'), 'Check this link'));
    await h.flush();
    click(document.getElementById('wzRelayYes'));
    await h.flush();
    assert(document.querySelector('#wzBody .wz-proof'), 'the relay read it and nothing was shown: ' + body(document));
    assert(/3 appointments/.test(body(document)));
  });

  test('adding a link unread says so, and still writes the link', async () => {
    const { document } = loadEditor(noDirect);
    toFirstLink(document, ['Alex']);
    fireInput(document.getElementById('wzUrl'), 'https://cal.example.com/alex.ics');
    click(h.buttonByText(document.getElementById('wzBody'), 'Check this link'));
    await h.flush();
    click(document.getElementById('wzRelaySkip'));
    assertEqual(jsonOut(document).calendars, [{
      url: 'https://cal.example.com/alex.ics', name: 'Alex',
      line: 'Alex',
    }], 'refusing the relay threw the link away as well');
    assert(/display will fetch it itself/.test(said(document)),
      'it does not say the board will still work: ' + said(document));
  });

  // ---- LET THE DATA ANSWER THE QUESTION ------------------------------

  test('a calendar that looks like somebody else\'s is queried, not accepted', async () => {
    // The real mistake: two tabs open, and Remy's link pasted on Alex's screen.
    const { document } = loadEditor(direct(ics({
      name: 'Remy',
      events: [
        { t: 'Remy: Swimming', at: '20991103T160000' },
        { t: 'Remy: Piano', at: '20991104T170000' },
      ],
    })));
    toFirstLink(document, ['Alex', 'Remy']);
    fireInput(document.getElementById('wzUrl'), 'https://cal.example.com/whoops.ics');
    click(h.buttonByText(document.getElementById('wzBody'), 'Check this link'));
    await h.flush();
    assert(/looks like Remy's calendar rather than Alex's/.test(body(document)),
      'it did not notice the calendar belongs to somebody else: ' + body(document));
    // and it will not move on until that is answered: a way on beside an
    // unanswered question gets pressed
    assert(next(document).hidden, 'there is a way on while the question is unanswered');
    click(document.getElementById('wzWhoGuess'));
    assert(!next(document).hidden, 'answering the question did not open the way on');
    assert(/Remy/.test(next(document).textContent), next(document).textContent);
    click(next(document));
    assertEqual(jsonOut(document).calendars[0], {
      url: 'https://cal.example.com/whoops.ics', name: 'Remy',
      line: 'Remy',
    }, 'the yes/no answer did not decide whose calendar it is');
  });

  test('a feed that matches nobody is not guessed at', async () => {
    const { document } = loadEditor(direct(ics({
      name: 'Household',
      events: [{ t: 'Bin day', at: '20991103T080000' }, { t: 'Bath night', at: '20991104T180000' }],
    })));
    toFirstLink(document, ['Alex', 'Remy']);
    fireInput(document.getElementById('wzUrl'), 'https://cal.example.com/alex.ics');
    click(h.buttonByText(document.getElementById('wzBody'), 'Check this link'));
    await h.flush();
    assert(!/looks like/.test(body(document)),
      'it invented a guess out of a calendar that names nobody: ' + body(document));
    assert(!next(document).hidden, 'the way on was held back for a question that was never asked');
  });

  // ---- THE SHARED CALENDAR IS THE ZERO-CONFIGURATION ANSWER ----------

  test('one calendar for the whole house is written as nothing but its address', async () => {
    const { document } = loadEditor(direct(ics({ name: 'Household', events: [{ t: 'Bin day', at: '20991103T080000' }] })));
    click(document.getElementById('wzStart'));
    fireInput(document.getElementById('wzName0'), 'Alex');
    click(h.buttonByText(document.getElementById('wzBody'), 'Add another person'));
    fireInput(document.getElementById('wzName1'), 'Remy');
    click(next(document));
    click(document.getElementById('wzShapeShared'));
    assert(/who is this calendar for/i.test(q(document)), 'it did not ask who the calendar is for: ' + q(document));
    assertEqual(document.getElementById('wzForAll').getAttribute('aria-pressed'), 'true',
      'the whole house is not the answer already chosen');
    click(document.getElementById('wzForAll'));
    assert(/share/i.test(q(document)), 'it did not ask for the shared calendar: ' + q(document));
    fireInput(document.getElementById('wzUrl'), 'https://cal.example.com/house.ics');
    click(h.buttonByText(document.getElementById('wzBody'), 'Check this link'));
    await h.flush();
    click(next(document));
    // NOTHING. No name, no rules. A calendar with neither belongs to every
    // line, which is what a shared household calendar means, and writing four
    // names into a rule would be wrong the day somebody moves out.
    assertEqual(jsonOut(document), {
      lines: [{ name: 'Alex' }, { name: 'Remy' }],
      calendars: [{ url: 'https://cal.example.com/house.ics' }],
    }, 'the shared calendar was spelled out instead of left alone');
    assert(/every line/.test(said(document)),
      'it does not say what a shared calendar does: ' + said(document));
    // and the plugin agrees about where those events go
    // `concat` so this is a native array of primitives: an array built inside
    // jsdom has jsdom's Array prototype, and deepStrictEqual counts that.
    const parsed = document.defaultView.parseConfig(document.getElementById('jsonOut').value);
    assertEqual([].concat(parsed.allLines), ['Alex', 'Remy'],
      'the plugin does not read this as the whole household\'s');
  });

  test('public holidays are added as the day\'s, with no name and no line', async () => {
    const { document } = loadEditor(direct(ics({ name: 'Holidays in Belgium',
      events: [{ t: 'Christmas Day', at: '20991225' }] })));
    // Two people, so both link screens offer "skip this one for now": with a
    // single person left to find there is nothing to skip TO.
    toFirstLink(document, ['Alex', 'Remy']);
    for (let i = 0; i < 3 && !/anything else/i.test(q(document)); i++) {
      const skip = document.getElementById('wzSkip');
      if (!skip) break;
      click(skip);
    }
    assert(/anything else/i.test(q(document)), 'could not reach the extras screen: ' + q(document));
    click(document.getElementById('wzAddHoliday'));
    assert(/holidays/i.test(q(document)), 'the holiday screen did not open: ' + q(document));
    // a country, not a hunt for a link
    const belgium = [...document.querySelectorAll('#wzBody .wz-providers button')]
      .find((b) => b.textContent === 'Belgium');
    assert(belgium, 'no country list is offered');
    click(belgium);
    // Google's id for Belgium is `be`: `en.belgian` answers with a 500.
    assertEqual(document.getElementById('wzUrl').value,
      'https://calendar.google.com/calendar/ical/en.be%23holiday%40group.v.calendar.google.com/public/basic.ics');
    click(h.buttonByText(document.getElementById('wzBody'), 'Check this link'));
    await h.flush();
    click(next(document));
    const cal = jsonOut(document).calendars.filter((c) => c.holiday)[0];
    assertEqual(cal.holiday, true);
    assert(!('name' in cal), 'the holiday feed was named, which is the line it must not create: '
      + JSON.stringify(cal));
    assert(!('rules' in cal), 'a holiday feed needs no rules');
  });

  // THE HOLIDAYS IN THE READER'S LANGUAGE, and the old Belgian link still read.
  test('a country\'s holidays come in the page\'s language, and en.belgian is read as en.be', async () => {
    const asked = [];
    const feed = ics({ name: 'Feestdagen in België', events: [{ t: 'Kerstmis', at: '20991225' }] });
    const { window, document } = loadEditor((url) => { asked.push(String(url)); return direct(feed)(url); });
    Object.defineProperty(window.navigator, 'language', { value: 'nl-BE', configurable: true });
    toFirstLink(document, ['Alex', 'Remy']);
    for (let i = 0; i < 3 && !/anything else/i.test(q(document)); i++) {
      const skip = document.getElementById('wzSkip');
      if (!skip) break;
      click(skip);
    }
    click(document.getElementById('wzAddHoliday'));
    click([...document.querySelectorAll('#wzBody .wz-providers button')].find((b) => b.textContent === 'Belgium'));
    assertEqual(document.getElementById('wzUrl').value,
      'https://calendar.google.com/calendar/ical/nl.be%23holiday%40group.v.calendar.google.com/public/basic.ics');
    fireInput(document.getElementById('wzUrl'),
      'https://calendar.google.com/calendar/ical/en.belgian%23holiday%40group.v.calendar.google.com/public/basic.ics');
    click(h.buttonByText(document.getElementById('wzBody'), 'Check this link'));
    await h.flush();
    assert(asked.indexOf('https://calendar.google.com/calendar/ical/en.be%23holiday%40group.v.calendar.google.com/public/basic.ics') >= 0,
      'the old link was fetched as it was written: ' + JSON.stringify(asked));
  });

  // A LINK PASTED TWICE IS THE COMMONEST CORRECTION THERE IS.
  //
  // The way out of the review screen leads to the full settings page, which is
  // the right home for splitting a school feed between two children. Deleting
  // a calendar is not that, and sending anybody to a seven-section form to do
  // it would be sending them exactly where they asked not to go.
  test('a calendar added by mistake can be removed without leaving the wizard', async () => {
    const { document } = loadEditor(direct(ics({ name: 'Alex' })));
    toFirstLink(document, ['Alex']);
    fireInput(document.getElementById('wzUrl'), 'https://cal.example.com/alex.ics');
    click(h.buttonByText(document.getElementById('wzBody'), 'Check this link'));
    await h.flush();
    click(next(document));
    click(next(document));                       // extras -> board
    assert(/here is your board/i.test(q(document)), q(document));
    const remove = [...document.querySelectorAll('#wzBody .wz-group button')]
      .find((b) => b.textContent === 'Remove');
    assert(remove, 'there is no way to take a calendar off the board: ' + body(document));
    click(remove);
    assertEqual(jsonOut(document).calendars, [], 'the calendar was not removed');
    assertEqual(jsonOut(document).lines, [{ name: 'Alex' }], 'removing the calendar removed the person too');
    assert(/Undo/.test(said(document)), 'it does not say the removal can be taken back: ' + said(document));
    // and the page's own Undo really does put it back
    click(document.getElementById('undoBtn'));
    assertEqual(jsonOut(document).calendars.length, 1, 'Undo did not put the calendar back');
  });

  // ---- THEY WILL CLOSE THE TAB ---------------------------------------

  test('progress is saved, and offered back as a question rather than restored', async () => {
    const { window, document } = loadEditor(direct(ics({ name: 'Alex' })));
    toFirstLink(document, ['Alex']);
    fireInput(document.getElementById('wzUrl'), 'https://cal.example.com/alex.ics');
    click(h.buttonByText(document.getElementById('wzBody'), 'Check this link'));
    await h.flush();
    click(next(document));
    await settle();
    const stored = window.localStorage.getItem('metro-calendar-setup-v1');
    assert(stored, 'nothing was saved, so closing the tab loses every link found so far');
    const saved = JSON.parse(stored);
    assertEqual(saved.config.calendars[0].url, 'https://cal.example.com/alex.ics');

    // a second visit, with the same store
    const again = loadEditor();
    again.window.localStorage.setItem('metro-calendar-setup-v1', stored);
    again.window.eval('void 0');
    // nothing is restored on its own
    assertEqual(jsonOut(again.document).calendars, [],
      'the saved answers were put back without being asked about');
  });

  test('the offer to carry on names when it was saved, and start-fresh deletes it', async () => {
    const first = loadEditor(direct(ics({ name: 'Alex' })));
    toFirstLink(first.document, ['Alex']);
    fireInput(first.document.getElementById('wzUrl'), 'https://cal.example.com/alex.ics');
    click(h.buttonByText(first.document.getElementById('wzBody'), 'Check this link'));
    await h.flush();
    click(next(first.document));
    await settle();
    const stored = first.window.localStorage.getItem('metro-calendar-setup-v1');
    assert(stored, 'sanity: the first visit saved nothing');

    // a fresh page that finds it
    const { window, document } = loadEditor();
    window.localStorage.setItem('metro-calendar-setup-v1', stored);
    // the welcome screen has to be painted again to see it
    click(document.querySelector('.mc-top nav a[href="#station-wizard"]'));
    assert(document.getElementById('wzResume'), 'the saved answers are not offered back: ' + body(document));
    assert(/1 calendar/.test(body(document)), 'the offer does not say what is in it: ' + body(document));
    assert(/Nothing was sent anywhere/.test(body(document)),
      'it does not say the saved answers stayed in this browser');

    click(document.getElementById('wzFresh'));
    assert(!window.localStorage.getItem('metro-calendar-setup-v1'),
      'starting fresh left the saved answers in the browser');
    assert(/who lives here/i.test(q(document)), 'starting fresh did not start: ' + q(document));
  });

  test('carrying on puts the answers and the calendars back', async () => {
    const first = loadEditor(direct(ics({ name: 'Alex' })));
    toFirstLink(first.document, ['Alex', 'Remy']);
    fireInput(first.document.getElementById('wzUrl'), 'https://cal.example.com/alex.ics');
    click(h.buttonByText(first.document.getElementById('wzBody'), 'Check this link'));
    await h.flush();
    click(next(first.document));
    await settle();
    const stored = first.window.localStorage.getItem('metro-calendar-setup-v1');
    assert(stored, 'sanity: the first visit saved nothing');

    const { window, document } = loadEditor();
    window.localStorage.setItem('metro-calendar-setup-v1', stored);
    click(document.querySelector('.mc-top nav a[href="#station-wizard"]'));
    click(document.getElementById('wzResume'));
    assertEqual(jsonOut(document).lines, [{ name: 'Alex' }, { name: 'Remy' }]);
    assertEqual(jsonOut(document).calendars.length, 1);
    // and the calendar text came back too, or the board could not be redrawn
    click(document.getElementById('makePrompt'));
    assert(/Swimming/.test(document.getElementById('promptOut').value),
      'the calendars this page had already read came back unreadable');
  });

  // ---- RECONFIGURING IS MORE COMMON THAN FIRST SETUP -----------------

  test('pasting back what TRMNL holds reopens the wizard with every answer in it', () => {
    const { document } = loadEditor();
    click(document.getElementById('wzReopen'));
    assert(/paste what you already have/i.test(q(document)), q(document));
    document.getElementById('wzPaste').value = JSON.stringify({
      lines: [{ name: 'Alex' }, { name: 'Remy' }],
      calendars: [
        { url: 'https://cal.example.com/alex.ics', name: 'Alex',
          line: 'Alex' },
        { url: 'https://cal.example.com/remy.ics', name: 'Remy',
          line: 'Remy' },
        { url: 'https://cal.example.com/house.ics' },
        { url: 'https://cal.example.com/holidays.ics', holiday: true },
      ],
    });
    click(h.buttonByText(document.getElementById('wzBody'), 'Read it and fill in my answers'));
    // it lands on the board, with every answer filled in rather than asked again
    assert(/here is your board/i.test(q(document)), 'it did not reopen filled in: ' + q(document));
    const rows = [...document.querySelectorAll('#wzBody .wz-group')].map((r) => r.textContent);
    assert(rows.some((t) => /^Alex/.test(t) && /alex\.ics/.test(t)), 'Alex is not shown with her calendar: ' + rows);
    assert(rows.some((t) => /^Remy/.test(t)), 'Remy went missing');
    assert(rows.some((t) => /^Shared/.test(t) && /Everyone in the house sees this/.test(t)),
      'the shared calendar is not shown as the household\'s: ' + rows);
    assert(rows.some((t) => /Public holidays/.test(t)), 'the holiday feed went missing: ' + rows);
    // and nothing was changed on the way through
    assertEqual(jsonOut(document).calendars.length, 4);
    assert(/2 calendars|4 calendars/.test(said(document)), said(document));
  });

  test('a paste that cannot be read changes nothing and says where to look', () => {
    const { document } = loadEditor();
    click(document.getElementById('wzReopen'));
    document.getElementById('wzPaste').value = '{"calendars": [';
    click(h.buttonByText(document.getElementById('wzBody'), 'Read it and fill in my answers'));
    assertEqual(jsonOut(document), { lines: [], calendars: [] }, 'a broken paste reached the editor');
    assert(/Nothing has changed/.test(said(document)), said(document));
    assert(/whole box/.test(said(document)), 'it does not say what usually went wrong: ' + said(document));
  });

  // ---- JSON IS AN OUTPUT, NOT A SCREEN -------------------------------

  test('the last screen is one copy button, with the text behind a disclosure', async () => {
    const { document } = loadEditor(direct(ics({ name: 'Alex' })));
    toFirstLink(document, ['Alex']);
    fireInput(document.getElementById('wzUrl'), 'https://cal.example.com/alex.ics');
    click(h.buttonByText(document.getElementById('wzBody'), 'Check this link'));
    await h.flush();
    click(next(document));
    assert(/anything else/i.test(q(document)), q(document));
    click(next(document));
    assert(/here is your board/i.test(q(document)), q(document));
    click(next(document));
    assert(/TRMNL/.test(q(document)), 'the last screen does not say where this goes: ' + q(document));

    // one copy, and nowhere else to press
    const copies = [...document.querySelectorAll('#wzBody button')].filter((b) => /^Copy/.test(b.textContent));
    assertEqual(copies.length, 1, 'there is more than one copy button on the last screen');
    // and where to put it, step by step
    const t = body(document);
    ['Set Up With', 'Configuration', 'Location', 'Save'].forEach((phrase) => {
      assert(t.indexOf(phrase) >= 0, 'the instructions never mention ' + JSON.stringify(phrase));
    });
    // the text itself is available and NOT on screen
    const wrap = document.getElementById('wzJsonWrap');
    assert(wrap && !wrap.open, 'the configuration text is on screen rather than behind a disclosure');
    assertEqual(document.getElementById('wzJson').value, document.getElementById('jsonOut').value,
      'the text behind the disclosure is not the text that gets copied');
  });

  // ---- NO JARGON -----------------------------------------------------

  test('the wizard never uses the words that mean nothing to a reader', async () => {
    // Every screen's own text, walked the way somebody walks it.
    const { document } = loadEditor(direct(ics({ name: 'Alex' })));
    const seen = [];
    function grab() { seen.push(q(document) + ' ' + document.getElementById('wzLede').textContent + ' ' + body(document)); }
    grab();
    click(document.getElementById('wzStart'));
    grab();
    fireInput(document.getElementById('wzName0'), 'Alex');
    click(next(document));
    grab();
    click(document.getElementById('wzShapeEach'));
    grab();
    ['google', 'icloud', 'outlook', 'nextcloud', 'synology', 'other'].forEach((id) => {
      click(document.getElementById('wzProv-' + id));
      grab();
      click(document.getElementById('wzProv-' + id));
    });
    click(document.getElementById('wzLost'));
    grab();
    fireInput(document.getElementById('wzUrl'), 'https://cal.example.com/alex.ics');
    click(h.buttonByText(document.getElementById('wzBody'), 'Check this link'));
    await h.flush();
    grab();
    click(next(document));
    grab();
    click(next(document));
    grab();
    click(next(document));
    grab();
    const text = seen.join('\n');
    // The words that describe the machinery rather than the household. "line"
    // stays: it is what the board draws and what the reader is looking at.
    [/\brules?\b/i, /\bmatcher/i, /\bregex/i, /\binterchange/i, /\btracks?\b/i, /\bJSON\b/,
      /\bICS feed/i, /\bCORS\b/, /\bendpoint/i, /\bconfig\b/i, /\bparse/i].forEach((rx) => {
      assert(!rx.test(text), 'the wizard says ' + rx + ': ' + (text.match(rx) || [])[0]
        + ' in "' + (text.split('\n').find((s) => rx.test(s)) || '').slice(0, 160) + '"');
    });
  });

  // ---- the shape of the thing ----------------------------------------

  test('the wizard is completable from the keyboard alone', async () => {
    // Enter in a name box adds the next one; Enter in the link box checks it.
    // Nothing here is drag-and-drop, and nothing needs a modifier key.
    const { window, document } = loadEditor(direct(ics({ name: 'Alex' })));
    click(document.getElementById('wzStart'));
    const name = document.getElementById('wzName0');
    fireInput(name, 'Alex');
    name.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert(document.getElementById('wzName1'), 'Enter on the last name box did not add another');

    click(next(document));
    click(document.getElementById('wzShapeEach'));
    const url = document.getElementById('wzUrl');
    fireInput(url, 'https://cal.example.com/alex.ics');
    url.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await h.flush();
    assert(document.querySelector('#wzBody .wz-proof'), 'Enter in the link box did not check it');

    assert(EDITOR.indexOf('dragstart') < 0 && EDITOR.indexOf('draggable') < 0,
      'something on this page can only be done by dragging it');
  });

  test('every target on the wizard is big enough to hit, and the type big enough to read', () => {
    const css = EDITOR.slice(EDITOR.indexOf('<style>'), EDITOR.indexOf('</style>'));
    const block = css.slice(css.indexOf('#station-wizard {'));
    // 44px is the accessibility floor for a touch target, not a goal
    const mins = [...block.matchAll(/#station-wizard button[^{]*\{[^}]*min-height:\s*(\d+)px/g)]
      .map((m) => Number(m[1]));
    assert(mins.length >= 2, 'the wizard sets no minimum height on its buttons');
    mins.forEach((n) => assert(n >= 44, 'a wizard button may be only ' + n + 'px tall'));
    assert(/#station-wizard\s*\{[^}]*font-size:\s*1[6-9]px/.test(block),
      'the wizard is set in the same small type as the form below it');
    assert(/\.wz-q\s*\{[^}]*font-size:\s*2[0-9]px/.test(block), 'the question is not set as a question');
  });

  test('the board comes with the reader on a phone, once there is a board to come', () => {
    // In one column the preview sits below whatever is being filled in, which
    // on the screen where somebody's family first appears on the map is the
    // one place it must not be.
    const css = EDITOR.slice(EDITOR.indexOf('<style>'), EDITOR.indexOf('</style>'));
    assert(/\[data-stage="wizard"\]\.has-board \.col-preview\s*\{[^}]*order:\s*-1/.test(css),
      'the board stays below the question at phone width');
    assert(/page\.classList\.add\("has-board"\)/.test(EDITOR),
      'nothing marks the page as having a board on it');
  });
};
