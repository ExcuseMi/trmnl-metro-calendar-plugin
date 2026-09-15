'use strict';

// i18n as JSON files. English is inline in transform.js and is the
// fallback; every other language lives in this repo's i18n/<code>.json and
// is fetched at render time, so adding Portuguese is a pull request against
// a JSON file rather than an edit to a serverless entry point only this
// repo can deploy.
//
// The two properties that matter: the DOWNLOADED file is what the board
// reads (otherwise the files are decoration), and a language that cannot be
// downloaded costs nothing (the board renders in English and says nothing
// about it).

const fs = require('fs');
const path = require('path');

const I18N_DIR = path.join(__dirname, '../../../i18n');

module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, fail, baseInput, eventItems, assert } = h;

  const NOW = Date.parse('2026-09-09T09:00:00Z');
  const NOW_S = Math.floor(NOW / 1000);
  const ICS = icsWithEvents([{ start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Afternoon' }]);

  // A table that no hardcoded copy could produce, so a passing assertion
  // can only mean the fetched file was the one used.
  const SERVED = { today: 'AUJOURD-SERVED', more: '+{n} SERVED', earlier: '+{n} EARLIER-SERVED', rain_pct: '{n}% SERVED' };

  function input(locale, state, cfg) {
    const i = baseInput(NOW, Object.assign({
      use_demo_data: 'false',
      config_json: JSON.stringify({ calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }] }),
    }, cfg));
    i.trmnl.user.locale = locale;
    if (state !== undefined) i.trmnl.state = state;
    return i;
  }

  function net(i18nResponse) {
    const seen = [];
    const impl = async (url) => {
      seen.push(String(url));
      if (String(url).indexOf('/i18n/') >= 0) return i18nResponse(String(url));
      return okText(ICS);
    };
    impl.seen = seen;
    return impl;
  }

  test('the language file is fetched from this repo and is what the board reads', async () => {
    const fetchImpl = net(() => okText(JSON.stringify(SERVED)));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(input('fr-BE'));
    const asked = fetchImpl.seen.filter((u) => u.indexOf('/i18n/') >= 0);
    assert(asked.length === 1 && /ExcuseMi\/trmnl-metro-calendar-plugin\/main\/i18n\/fr\.json$/.test(asked[0]),
      'expected one fetch of i18n/fr.json from this repo, got ' + JSON.stringify(asked));
    assert(r.data.i18n.today === 'AUJOURD-SERVED',
      'the board did not use the downloaded table: ' + JSON.stringify(r.data.i18n));
  });

  test('a half-translated file uses what it has and reads English for the rest', async () => {
    // A contributor who adds one string should not knock the other fifteen
    // back to a language nobody asked for.
    const { run } = runTransform(net(() => okText(JSON.stringify({ today: 'Vandaag-SERVED' }))), NOW);
    const r = await run(input('nl-BE'));
    assert(r.data.i18n.today === 'Vandaag-SERVED', 'the translated key was ignored');
    assert(r.data.i18n.more === '+{n} more', 'a missing key should fall back to English, got ' + r.data.i18n.more);
  });

  test('an unreachable GitHub renders the board in English and says nothing', async () => {
    // Silently: a family board is not the place for a message about a CDN.
    const { run } = runTransform(net(() => { throw new Error('offline'); }), NOW);
    const r = await run(input('fr-BE'));
    assert(r.data.i18n.today === 'Today', 'expected the English fallback, got ' + r.data.i18n.today);
    assert(eventItems(r.data).length > 0, 'a failed language fetch cost the events');
  });

  test('a language nobody has translated yet is a 404, not a broken board', async () => {
    const { run } = runTransform(net(() => fail(404)), NOW);
    const r = await run(input('pt-PT'));
    assert(r.data.i18n.today === 'Today', 'got ' + r.data.i18n.today);
    assert(eventItems(r.data).length > 0, 'a missing language cost the events');
  });

  test('the last downloaded table is cached in state and reused when the fetch fails', async () => {
    const first = runTransform(net(() => okText(JSON.stringify(SERVED))), NOW);
    const good = await first.run(input('fr-BE'));
    const saved = JSON.parse(JSON.stringify(good.trmnl_state));
    assert(saved.i18n && saved.i18n.lang === 'fr', 'the table was not cached: ' + JSON.stringify(saved.i18n));

    // an older cache, so the TTL does not simply skip the fetch
    saved.i18n.fetchedAt = NOW_S - 24 * 3600;
    const second = runTransform(net(() => fail(500)), NOW);
    const later = await second.run(input('fr-BE', saved));
    assert(later.data.i18n.today === 'AUJOURD-SERVED',
      'a failed fetch should fall back to the cached table, got ' + later.data.i18n.today);
  });

  test('a fresh cached table is used without spending the render on a fetch', async () => {
    // The file changes a few times a year and the deadline is shared with
    // the calendars: re-downloading it every fifteen minutes buys nothing.
    const fetchImpl = net(() => okText(JSON.stringify(SERVED)));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(input('fr-BE', {
      i18n: { lang: 'fr', strings: { today: 'CACHED' }, fetchedAt: NOW_S - 60 },
    }));
    assert(r.data.i18n.today === 'CACHED', 'the fresh cache was not used: ' + r.data.i18n.today);
    assert(fetchImpl.seen.filter((u) => u.indexOf('/i18n/') >= 0).length === 0,
      'a fresh cache should not be re-fetched');
  });

  test('an English board fetches no language file at all', async () => {
    const fetchImpl = net(() => okText(JSON.stringify(SERVED)));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(input('en-GB'));
    assert(fetchImpl.seen.filter((u) => u.indexOf('/i18n/') >= 0).length === 0,
      'English is inline; it must not be downloaded');
    assert(r.data.i18n.today === 'Today');
  });

  test('a language file full of junk cannot reach the board or the state', async () => {
    // These files arrive from the open internet by pull request. Only the
    // keys English already has, only strings, only short ones: everything
    // else would otherwise be stored in trmnl_state and replayed for ever.
    const junk = { today: 'Hoi', more: { nope: 1 }, evil: '<script>', earlier: 'x'.repeat(500) };
    const { run } = runTransform(net(() => okText(JSON.stringify(junk))), NOW);
    const r = await run(input('nl-BE'));
    assert(r.data.i18n.today === 'Hoi', 'the good key was dropped with the bad ones');
    assert(r.data.i18n.more === '+{n} more', 'a non-string value reached the board: ' + JSON.stringify(r.data.i18n.more));
    assert(r.data.i18n.earlier === '+{n} earlier', 'a 500-character string reached the board');
    assert(!('evil' in r.trmnl_state.i18n.strings), 'an unknown key was stored in state');
  });

  test('every i18n/<code>.json in the repo is complete and well formed', async () => {
    // The files ARE the translations: a missing key silently reads English
    // on somebody's board, and a broken one turns the whole language off.
    const { I18N } = runTransform(async () => fail(404), NOW);
    const enKeys = Object.keys(I18N.en).sort();
    const files = fs.readdirSync(I18N_DIR).filter((f) => f.endsWith('.json')).sort();
    assert(files.length >= 4, 'expected the shipped languages as files, found ' + files.join(', '));
    for (const f of files) {
      assert(/^[a-z]{2}\.json$/.test(f), f + ': a language file is named by its two-letter code');
      const table = JSON.parse(fs.readFileSync(path.join(I18N_DIR, f), 'utf-8'));
      const keys = Object.keys(table).sort();
      assert(keys.join(',') === enKeys.join(','),
        f + ' does not carry the English key set: missing ' + enKeys.filter((k) => keys.indexOf(k) < 0).join(', ')
        + ' / extra ' + keys.filter((k) => enKeys.indexOf(k) < 0).join(', '));
      for (const k of keys) {
        assert(typeof table[k] === 'string' && table[k].trim(), f + ': ' + k + ' is not a non-empty string');
        // A placeholder dropped in translation renders its value as
        // nothing: "+ more", or a service alert with no time in it. The
        // check used to name {n}, which was every placeholder there was;
        // the alert lines carry {t}, {p} and {v}, and a translator who
        // drops one of those loses the only number on the banner.
        const want = (I18N.en[k].match(/\{\w+\}/g) || []).sort();
        const have = (table[k].match(/\{\w+\}/g) || []).sort();
        assert(want.every((ph) => have.indexOf(ph) >= 0),
          f + ': ' + k + ' lost ' + want.filter((ph) => have.indexOf(ph) < 0).join(', ')
          + ' (English has ' + want.join(' ') + ', this has ' + (have.join(' ') || 'none') + ')');
      }
    }
  });

  test('a repo language file, served as-is, drives a real board', async () => {
    // The end-to-end version of the test above: the actual bytes in the
    // repo, through the actual fetch path, onto the actual payload.
    const fr = fs.readFileSync(path.join(I18N_DIR, 'fr.json'), 'utf-8');
    const { run } = runTransform(net(() => okText(fr)), NOW);
    const r = await run(input('fr-FR'));
    assert(r.data.i18n.today === JSON.parse(fr).today,
      'expected the repo French table on the board, got ' + r.data.i18n.today);
  });
};
