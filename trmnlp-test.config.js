// trmnlp-test configuration (https://github.com/ExcuseMi/trmnlp-test)
module.exports = {
  plugin: 'plugin',
  tests: 'test/trmnl',
  report: 'test/trmnl-report',
  defaults: {
    device: 'og_png',
    view: 'full',
    now: '2026-09-08T12:30:00Z',
    timeZone: 'Europe/Brussels',
  },
  screenshots: 'on-failure',
  timeout: 180000,
};
