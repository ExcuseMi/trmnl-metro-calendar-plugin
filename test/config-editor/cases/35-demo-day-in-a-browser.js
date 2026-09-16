'use strict';

// THE PREVIEW ASKED FOR A HEADER NO PAGE IS ALLOWED TO SEND.
//
// transform.js puts `User-Agent: TRMNL-Metro-Calendar` on every fetch it
// makes, which is right on the device and wrong here. User-Agent is not a
// CORS-safelisted header, so setting it turns a plain cross-origin GET into
// a preflighted one: the browser sends an OPTIONS first and reads the
// answer's Access-Control-Allow-Headers. raw.githubusercontent.com, where
// this repo's demo day and every language file live, answers OPTIONS with
// 403 and no such header, so the GET never happens.
//
// Chrome drops the header instead of sending it, which is why this survived:
// the preview drew the example day there. Firefox honours it, and the same
// page drew "The example day could not be loaded" over a board with no lines
// on it, hour ruler and clock included, because even the demo's own
// config.json had been blocked.
//
// So: the page must ask for nothing that makes a request non-simple, and the
// example day has to come back. jsdom is a browser for this purpose (it has
// a window and a document), which is what the transform now reads.

const fs = require('fs');
const path = require('path');

module.exports = function (test, h) {
  const { loadEditor, click, assert } = h;
  const REPO_ROOT = path.join(__dirname, '../../..');

  // The CORS-safelisted request headers. Anything past this list costs an
  // OPTIONS first, and the host it is asked of may refuse to answer one.
  const SAFELISTED = ['accept', 'accept-language', 'content-language', 'content-type', 'range'];
  function unsafe(headers) {
    return Object.keys(headers || {}).filter((k) => SAFELISTED.indexOf(k.toLowerCase()) === -1);
  }

  // The repo's own demo files, off disk, under the addresses the transform
  // asks for (`/main/demo/<show>/...`, the shape test/sweep/run.js serves).
  // Nothing here reaches the network: what is on disk is what the next push
  // puts on the server.
  //
  // jsdom does not enforce CORS, so the stub does the one part of it this is
  // about: a cross-origin request carrying a header past the safelist is
  // preflighted, and github's raw host answers OPTIONS with 403. What comes
  // back at the page is a rejected fetch, which is what this stands in for.
  function stub(seen) {
    return function (url, opts) {
      const u = String(url);
      const headers = (opts && opts.headers) || {};
      seen.push({ url: u, headers: headers });
      if (/^https?:\/\/raw\.githubusercontent\.com\//.test(u) && unsafe(headers).length) {
        return Promise.reject(new TypeError('NetworkError when attempting to fetch resource.'));
      }
      if (/shared\.liquid$/.test(u)) return served(path.join(REPO_ROOT, 'plugin/src/shared.liquid'));
      const m = /\/main\/(demo\/.*|i18n\/.*)$/.exec(u);
      if (m) return served(path.join(REPO_ROOT, m[1]));
      return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') });
    };
  }
  function served(file) {
    if (!fs.existsSync(file)) return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') });
    const text = fs.readFileSync(file, 'utf-8');
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(text) });
  }

  test('the preview draws the example day when nothing is configured', async () => {
    const seen = [];
    const { document } = loadEditor(stub(seen));
    click(document.getElementById('runPreview'));
    await h.flush();

    const out = document.getElementById('resultJson').value;
    assert(out, 'the preview produced no payload at all');
    const data = JSON.parse(out).data;
    assert(!data.board_notice,
      'the board carries a notice instead of the example day: ' + data.board_notice);
    assert((data.legend || []).length > 0,
      'the example day came back with no lines on it');
    assert((data.events || []).length > 0,
      'the example day came back with no events on it');
    assert(seen.some((r) => /\/main\/demo\/[a-z0-9_-]+\/config\.json$/.test(r.url)),
      'the demo\'s own config was never asked for: ' + JSON.stringify(seen.map((r) => r.url)));
  });

  test('nothing the preview fetches carries a header that would be preflighted', async () => {
    const seen = [];
    const { document } = loadEditor(stub(seen));
    click(document.getElementById('runPreview'));
    await h.flush();

    assert(seen.length > 0, 'the preview fetched nothing at all');
    const asked = [];
    seen.forEach((r) => unsafe(r.headers).forEach((k) => asked.push(k + ' on ' + r.url)));
    assert(asked.length === 0,
      'a fetch from the page set a header a browser would preflight: ' + asked.join(', '));
  });
};
