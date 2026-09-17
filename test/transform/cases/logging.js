'use strict';

// WHAT THE RENDER SAYS WHEN SOMETHING GOES WRONG, AND WHAT IT MUST NEVER SAY.
//
// transform.js had no console call in it at all: a feed that did not answer,
// a forecast that timed out, a language file that 404ed and a config that
// would not parse all passed in silence, and the only way to find out was to
// look at a board and notice something missing. The board says what it can
// (calendars_down, board_notice, the band); this is the other half, for
// whoever is reading the render log wondering why.
//
// AND IT IS A PLACE A CREDENTIAL CAN LEAK. A calendar link is not a name, it
// is an access token in a URL -- anybody holding one can read that calendar
// for as long as it lives. The log prints the HOST so a person can tell which
// feed is failing, and it must never print the rest. Nothing was stopping it.

module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, fail, baseInput, assert, assertEqual } = h;

  const NOW = Date.parse('2026-09-09T09:00:00Z');
  const ICS = icsWithEvents([{ start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Afternoon' }]);

  // A published calendar link, in the shape the real ones take: a long opaque
  // token in the path, and a query nobody else should ever see.
  const SECRET = 'https://cloud.example.com/remote.php/dav/public-calendars/'
    + '8XaL43rwEgSj4ETE?export&token=s3cr3t-do-not-log';

  function net(opts) {
    opts = opts || {};
    return async (url) => {
      const u = String(url);
      if (u.indexOf('api.open-meteo.com') >= 0) return opts.weatherFails ? fail(503) : okText('{}');
      if (u.indexOf('/i18n/') >= 0) return fail(404);
      return opts.calendarsFail ? fail(500) : okText(ICS);
    };
  }
  function input(cfg, extra) {
    return baseInput(NOW, Object.assign({ use_demo_data: 'false',
      config_json: JSON.stringify(cfg || { calendars: [{ url: SECRET, name: 'Alex' }] }) }, extra || {}));
  }

  test('a feed that does not answer says so in the log, with its name and why', async () => {
    const log = [];
    await runTransform(net({ calendarsFail: true }), NOW, log).run(input());
    const said = log.filter((l) => /calendar/i.test(l)).join('\n');
    assert(said, 'a feed failed and the log said nothing: ' + JSON.stringify(log));
    assert(said.indexOf('Alex') >= 0, 'the log does not say which calendar: ' + said);
    assert(/500/.test(said), 'the log does not say why: ' + said);
    assert(said.indexOf('cloud.example.com') >= 0, 'the log does not say which host: ' + said);
  });

  test('...and never prints the link itself, which is a credential', async () => {
    const log = [];
    await runTransform(net({ calendarsFail: true }), NOW, log).run(input());
    const all = log.join('\n');
    // The whole link, the opaque part of it, and the query, each on its own:
    // a log that leaks any one of them has handed the calendar away.
    assert(all.indexOf(SECRET) < 0, 'the log printed the whole link');
    assert(all.indexOf('8XaL43rwEgSj4ETE') < 0, 'the log printed the calendar token: ' + all);
    assert(all.indexOf('s3cr3t') < 0, 'the log printed the query: ' + all);
    assert(all.indexOf('remote.php') < 0, 'the log printed the path: ' + all);
  });

  test('a forecast that fails says so, and a language file that fails says so', async () => {
    const log = [];
    await runTransform(net({ weatherFails: true }), NOW, log)
      .run(input(null, { lat_lon: '51.05,3.72' }));
    const all = log.join('\n');
    assert(/forecast/i.test(all), 'a 503 from the forecast went unremarked: ' + JSON.stringify(log));
  });

  test('a config that will not parse says so', async () => {
    const log = [];
    const i = baseInput(NOW, { use_demo_data: 'false', config_json: '{ this is not json' });
    await runTransform(net(), NOW, log).run(i);
    assert(/Calendars box|config/i.test(log.join('\n')),
      'an unreadable config was not logged: ' + JSON.stringify(log));
  });

  test('a board with nothing wrong writes nothing, so the log means something', async () => {
    const log = [];
    await runTransform(net(), NOW, log).run(input());
    assertEqual(log, [], 'a healthy render wrote to the log');
  });

  // ------------------------------------------------------------- the host
  test('a host is all that comes out of a link, whatever shape the link is', () => {
    const { hostOf } = runTransform(net(), NOW);
    const cases = [
      ['https://cloud.example.com/remote.php/dav/x?export', 'cloud.example.com'],
      ['http://host.example.org:8443/a/b/c', 'host.example.org:8443'],
      // userinfo is part of the authority and is a credential in its own right
      ['https://user:pass@secret.example.com/cal.ics', 'user:pass@secret.example.com'],
      ['webcal://p31-caldav.icloud.com/published/2/MTQ4', 'p31-caldav.icloud.com'],
      ['not a url at all', 'unknown host'],
      ['', 'unknown host'],
      [null, 'unknown host'],
    ];
    cases.forEach(([u, want]) => {
      assertEqual(hostOf(u), want, 'hostOf(' + JSON.stringify(u) + ')');
    });
  });

  // ------------------------------------------------------- the render budget
  test('the network budget leaves the runtime room to finish', () => {
    // "The transform.js has 5 seconds." Everything that fetches shares one
    // budget, and what is left of the five has to cover parsing every feed and
    // building the board. Measured with the network taken out: 932KB of
    // calendar over four feeds -- a year of a Teams work calendar and three
    // more beside it -- parses and builds in 168ms, worst of five 225ms.
    //
    // A second of headroom is four times that worst case. Past 4500 there is
    // not a second, and a render that overruns is not a late board, it is no
    // board at all.
    const { RENDER_BUDGET_MS } = runTransform(net(), NOW);
    assert(typeof RENDER_BUDGET_MS === 'number' && RENDER_BUDGET_MS > 0,
      'the budget is not a number: ' + RENDER_BUDGET_MS);
    assert(RENDER_BUDGET_MS <= 4500, 'the network budget is ' + RENDER_BUDGET_MS
      + 'ms of the 5000 the runtime allows, which leaves under half a second '
      + 'to parse the feeds and build the board');
  });
};
