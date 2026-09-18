'use strict';

// WHAT THE SEARCH'S BUDGET BUYS ON A REAL DAY.
//
// The board search stops after a fixed number of arrangements priced
// (solver/fit.js EVAL_POOL), and each one is charged by the square of how
// many captions it had to place. On a five-line rolling day with two dozen
// names that charge is forty units an arrangement, so a pool sized for
// smaller boards bought about a thousand: the descent that starts with every
// event on a shelf ran out before it had traded any of them, and the board
// came back with its rails flat and four names nobody could pin to a stop.
// "The shelves are gone."
//
// This is that day, off the device: the example at four minutes to midnight,
// rolling into tomorrow. It is not a preference about how it looks -- it is
// the difference between a board that ran its search and one that stopped
// halfway.

module.exports = function (test, h) {
  const { layout, assert } = h;
  const day = () => ({ name: 'rolling-x', metro: require('../rolling-x.json') });

  test('a dense rolling day still spends its search: shelves, and nothing mistakable', () => {
    const rep = layout(day(), 'x-landscape');
    const spurs = rep.board.lines.filter((l) => l.branchOf);
    assert(spurs.length >= 6, 'only ' + spurs.length + ' shelf/shelves on the whole board');
    // TWO, SINCE THE LEGEND TOOK ITS GUTTER. A name set once, off the
    // paper's edge in a column of its own, costs this board a tenth of its
    // width, and the narrower a day is drawn the more captions there are
    // that could be read as either of two lines. What this case is about is
    // whether the search RAN, which the shelves answer and which is
    // unchanged; the bar moved by one because the paper did.
    assert(rep.board.muddle <= 2, 'muddle ' + rep.board.muddle);
    assert(rep.board.shed === 0, 'shed ' + rep.board.shed);
  });

  // One mistakable name, as lying down allows: at the widths the panel really
  // draws (the ruler used to read a caption a dozen pixels narrow) the column
  // has one caption it cannot pin, and the question this case asks is whether
  // the search ran, which the shelves answer.
  test('the same day standing up gets its shelves too', () => {
    const rep = layout(day(), 'x-portrait');
    const spurs = rep.board.lines.filter((l) => l.branchOf);
    assert(spurs.length >= 6, 'only ' + spurs.length + ' shelf/shelves standing up');
    assert(rep.board.muddle <= 1, 'muddle ' + rep.board.muddle);
  });
};
