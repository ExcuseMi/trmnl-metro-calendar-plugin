'use strict';

// NOT LOST TO A BACK BUTTON: with the reader's own work in the page, Back
// asks first, and Stay keeps everything where it was. Only the step back
// onto the entry the page was opened on is leaving: a hash link or the bar
// at the top fires popstate too, and asks nothing.

module.exports = function (test, h) {
  const { loadEditor, click, fireInput, assert } = h;
  const offPage = (window) => new window.PopStateEvent('popstate', { state: { metroBase: 1 } });

  test('back with work in the page asks before leaving', () => {
    const { window, document } = loadEditor();
    click(document.getElementById('wzStart'));
    fireInput(document.getElementById('wzName0'), 'Quinn');
    assert(window.history.state && window.history.state.metroGuard, 'the page holds no entry of its own to go back from');
    window.dispatchEvent(offPage(window));
    const ask = document.getElementById('leaveAsk');
    assert(ask, 'Back left without a word');
    assert(/Leave the setup/.test(ask.textContent), 'the question does not say what it is about: ' + ask.textContent);
    click(document.getElementById('leaveStay'));
    assert(!document.getElementById('leaveAsk'), 'Stay did not close the question');
    assert(document.getElementById('wzName0').value === 'Quinn', 'staying lost the answer');
    assert(window.history.state && window.history.state.metroGuard, 'staying left the page with nothing to catch the next Back');
  });

  test('back with nothing typed asks nothing', () => {
    const { window, document } = loadEditor();
    window.dispatchEvent(offPage(window));
    assert(!document.getElementById('leaveAsk'), 'an empty page asked before letting the reader go');
  });

  test('the page\'s own links are not leaving: Set up from the full editor asks nothing', () => {
    const { window, document } = loadEditor(undefined, '?full');
    h.addFeed(document, 'https://calendar.example.com/sam.ics', 'Sam');
    click(document.querySelector('.mc-top nav a[href="#station-wizard"]'));
    // what a browser fires for a hash link, and for Back between two of them
    window.dispatchEvent(new window.PopStateEvent('popstate', { state: null }));
    window.dispatchEvent(new window.PopStateEvent('popstate', { state: { metroGuard: 1 } }));
    assert(!document.getElementById('leaveAsk'), 'following a link inside the page asked "Leave the setup?"');
    assert(document.getElementById('page').getAttribute('data-stage') === 'wizard', 'Set up did not open the setup');
  });

  test('what leaving costs is said as it is', () => {
    // full editor only: nothing is kept
    let ed = loadEditor(undefined, '?full');
    h.addFeed(ed.document, 'https://calendar.example.com/sam.ics', 'Sam');
    ed.window.dispatchEvent(offPage(ed.window));
    let cost = ed.document.getElementById('leaveCost').textContent;
    assert(/Nothing on this page is kept/.test(cost) && !/is gone/.test(cost), cost);
    // with the setup started, the full editor's changes are kept with it
    ed = loadEditor();
    click(ed.document.getElementById('wzStart'));
    fireInput(ed.document.getElementById('wzName0'), 'Quinn');
    ed.window.dispatchEvent(offPage(ed.window));
    cost = ed.document.getElementById('leaveCost').textContent;
    assert(/kept in this browser/.test(cost) && /full editor included/.test(cost), cost);
  });
};
