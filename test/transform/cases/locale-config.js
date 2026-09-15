'use strict';

// locale, timeZone and timeFormat are properties of the BOARD, not of the
// account it happens to be provisioned under: a family screen in a Belgian
// kitchen can legitimately want US formatting, and the person writing the
// config is the one who knows. So the config wins over the account, and the
// account is only the default.

module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, baseInput, assert } = h;

  const NOW = Date.parse('2026-09-09T09:00:00Z');

  function cfg(extra) {
    return {
      config_json: JSON.stringify(Object.assign({
        calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }],
      }, extra)),
      use_demo_data: 'false',
    };
  }
  const oneEvent = async () => okText(icsWithEvents([
    { start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Afternoon' },
  ]));

  test('a config locale overrides the account locale', async () => {
    const { run } = runTransform(oneEvent, NOW);
    const r = await run(baseInput(NOW, cfg({ locale: 'fr-FR' })));
    // the header date is rendered in the config's language, not the account's
    assert(/sept/i.test(r.data.date_label), 'expected a French month, got ' + r.data.date_label);
  });

  test('timeFormat 12h wins over a 24-hour locale', async () => {
    const { run } = runTransform(oneEvent, NOW);
    const r = await run(baseInput(NOW, cfg({ locale: 'nl-BE', timeFormat: '12h' })));
    assert(r.data.hour12 === true, 'expected a 12-hour clock, got hour12=' + r.data.hour12);
  });

  test('timeFormat 24h wins over a 12-hour locale', async () => {
    const { run } = runTransform(oneEvent, NOW);
    const r = await run(baseInput(NOW, cfg({ locale: 'en-US', timeFormat: '24h' })));
    assert(r.data.hour12 === false, 'expected a 24-hour clock, got hour12=' + r.data.hour12);
  });

  test('with no timeFormat set, the locale decides — asked of Intl, not a region list', async () => {
    const { run } = runTransform(oneEvent, NOW);
    const us = await run(baseInput(NOW, cfg({ locale: 'en-US' })));
    const be = await run(baseInput(NOW, cfg({ locale: 'nl-BE' })));
    assert(us.data.hour12 === true, 'en-US should be a 12-hour clock');
    assert(be.data.hour12 === false, 'nl-BE should be a 24-hour clock');
  });

  test('a bare "en" account keeps a 24-hour clock', async () => {
    // the TRMNL default locale is "en", which Intl resolves to a 12-hour
    // clock — but a device that was never configured should not suddenly
    // read as American
    const { run } = runTransform(oneEvent, NOW);
    const r = await run(baseInput(NOW, cfg({ locale: 'en' })));
    assert(r.data.hour12 === false, 'a bare "en" should stay on a 24-hour clock');
  });

  test('a config timeZone decides which day is "today"', async () => {
    // 23:30 UTC on the 9th is already the 10th in Auckland
    const late = Date.parse('2026-09-09T23:30:00Z');
    const fetchImpl = async () => okText(icsWithEvents([
      { start: '20260910T090000Z', end: '20260910T100000Z', summary: 'Tomorrow in UTC' },
    ]));
    const { run } = runTransform(fetchImpl, late);
    const r = await run(baseInput(late, cfg({ timeZone: 'Pacific/Auckland' })));
    assert(r.data.events.length === 1,
      'an event on the 10th should be today in Auckland');
  });

  test('the demo ships US formatting with a European zone, so the override path is always live', async () => {
    // The demo's config is fetched like its calendars now, so it has to be
    // served like them.
    const { run } = runTransform(h.demoNet(), NOW);
    const r = await run(baseInput(NOW, { use_demo_data: 'true' }));
    assert(r.data.hour12 === true, 'the demo should read on a 12-hour clock');
  });
};
