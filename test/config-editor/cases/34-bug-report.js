'use strict';

// A BUG REPORT THAT REPRODUCES AND GIVES NOTHING AWAY. The report carries the
// configuration and the calendar data around the day shown, scrambled: names
// made up, every word swapped for one of the same length the same way in the
// feeds and the rules, links, locations and descriptions gone. What is under
// test is both halves: nothing private survives, and the scrambled report,
// run through the plugin, draws the same board as the real data did.

module.exports = function (test, h) {
  const { loadEditor, click, fireInput, addFeed, assert, assertEqual } = h;

  const day = new Date(), p2 = (n) => String(n).padStart(2, '0');
  const ymd = (d) => d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate());
  const today = ymd(day), later = ymd(new Date(Date.now() + 40 * 864e5));
  const ICS = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:Zimmermann family',
    'BEGIN:VEVENT', 'UID:a1@private.example', 'SUMMARY:Quentin: Cello with Mrs Halvorsen',
    'DTSTART:' + today + 'T160000', 'DTEND:' + today + 'T170000', 'LOCATION:12 Wexford Lane',
    'DESCRIPTION:door code 4471', 'ATTENDEE:mailto:quentin@private.example', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:a2@private.example', 'SUMMARY:Ottilie: L6 Orchestra',
    'DTSTART:' + today + 'T090000', 'DTEND:' + today + 'T100000', 'RRULE:FREQ=WEEKLY', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:a3@private.example', 'SUMMARY:Quentin: Dentist far away',
    'DTSTART:' + later + 'T090000', 'DTEND:' + later + 'T100000', 'END:VEVENT',
    'END:VCALENDAR', '',
  ].join('\r\n');
  const URL = 'https://calendar.example.com/secret-token-77af/basic.ics';
  const serve = (text) => (u) => (String(u).indexOf('.ics') >= 0
    ? Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(text) })
    : Promise.reject(new Error('Failed to fetch')));

  async function reported() {
    const { window, document } = loadEditor(serve(ICS));
    addFeed(document, URL, 'Quentin, Ottilie');
    const card = [...document.querySelectorAll('#calendars .card')].pop();
    click(h.buttonByText(card, '+ Add a rule'));
    const rule = card.querySelector('.rule');
    fireInput(rule.querySelector('.cond-value'), 'Cello');
    h.selectMulti(rule.querySelector('.line-picker'), ['Quentin']);
    await h.flush(20);
    fireInput(document.getElementById('reportWhat'), 'Cello is on the wrong line');
    click(document.getElementById('reportBuild'));
    return { window, document, text: document.getElementById('reportOut').value };
  }
  function parts(text) {
    const cfg = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(text)[1]);
    const ics = /<summary>feed-1\.ics[^<]*<\/summary>\n\n```\n([\s\S]*?)\n```/.exec(text)[1];
    return { cfg, ics };
  }

  test('the report leaves out the link, the names, the words, the place and the notes', async () => {
    const { text } = await reported();
    assert(text.length > 200, 'no report was built');
    for (const secret of ['secret-token-77af', 'Quentin', 'Ottilie', 'Zimmermann', 'Halvorsen', 'Cello', 'Wexford', '4471', 'private.example', 'mailto']) {
      assert(text.indexOf(secret) < 0, 'the report still contains "' + secret + '"');
    }
    const { ics } = parts(text);
    assert(/RRULE:FREQ=WEEKLY/.test(ics), 'the repeat was dropped');
    assert(ics.indexOf('T160000') >= 0 && ics.indexOf('T090000') >= 0, 'the times were dropped');
    assert(/SUMMARY:\w+: L6 \w+/.test(ics), 'a class code was scrambled, or the title lost its shape: ' + ics);
    assert(ics.indexOf(later) < 0, 'an event weeks away was included');
  });

  test('the scrambled report draws the same board as the real data', async () => {
    const { window, text } = await reported();
    const { cfg, ics } = parts(text);
    const realCfg = JSON.parse(window.document.getElementById('jsonOut').value);
    async function board(config, feed) {
      window.fetch = serve(feed);
      const r = await window.run({ trmnl: { system: { timestamp_utc: Math.floor(Date.now() / 1000) },
        user: { locale: 'en', time_zone_iana: Intl.DateTimeFormat().resolvedOptions().timeZone },
        plugin_settings: { instance_name: 'T', custom_fields_values: { use_demo_data: 'false', config_json: JSON.stringify(config) } } } });
      const names = {};
      (r.data.legend || []).forEach((l, i) => { names[l.key] = i; });
      return (r.data.events || []).filter((e) => e.start_min >= 0 && e.start_min < 1440)
        .map((e) => [e.start_min, e.end_min, [e.owner].concat(e.co_owners || []).map((k) => names[k]).sort().join('+'), e.title.length]).sort();
    }
    const real = await board(realCfg, ICS), scrambled = await board(cfg, ics);
    assert(real.length >= 2, 'the real board has nothing on it: ' + JSON.stringify(real));
    assert(JSON.stringify(scrambled) === JSON.stringify(real), 'the scrambled report draws a different board: ' + JSON.stringify(scrambled) + ' vs ' + JSON.stringify(real) + '\n' + JSON.stringify(cfg) + '\n' + ics);
  });
};
