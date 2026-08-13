/**
 * Book.js
 *
 * "The Book" — the basic strategy chart, generated from the EV engine rather
 * than hard-coded, so it always reflects the table rules actually in force
 * (H17 vs S17, surrender on or off, double after split).
 */

import { analyze, addCard } from '../EV.js';
import { el } from './dom.js';

const UPCARDS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 1];

const CODES = {
  hit: { letter: 'H', title: 'Hit' },
  stand: { letter: 'S', title: 'Stand' },
  double: { letter: 'D', title: 'Double (hit if not allowed)' },
  split: { letter: 'P', title: 'Split' },
  surrender: { letter: 'R', title: 'Surrender (hit if not allowed)' }
};

/**
 * Build one row of plays.
 * @private
 */
function row(evaluate, rules) {
  return UPCARDS.map(up => CODES[evaluate(up, rules).best] || CODES.hit);
}

/**
 * Render the chart.
 * @param {Object} rules - { hitSoft17, surrender, doubleAfterSplit }
 * @returns {HTMLElement}
 */
export function renderBook(rules = {}) {
  const opts = {
    hitSoft17: rules.hitSoft17 !== false,
    surrender: rules.allowSurrender !== false,
    doubleAfterSplit: rules.allowDoubleAfterSplit !== false
  };

  const header = () => el('tr', {}, [
    el('th.book__corner', { text: '' }),
    ...UPCARDS.map(up => el('th', { text: up === 1 ? 'A' : String(up) }))
  ]);

  const section = (title, rows) => el('div.book__section', {}, [
    el('h3.book__title', { text: title }),
    el('div.book__scroll', {}, el('table.book__table', {}, [
      el('thead', {}, header()),
      el('tbody', {}, rows)
    ]))
  ]);

  const makeRow = (label, cells) => el('tr', {}, [
    el('th.book__rowhead', { text: label }),
    ...cells.map(code => el('td', {
      text: code.letter,
      title: code.title,
      class: `book__cell book__cell--${code.letter}`
    }))
  ]);

  // Hard totals worth charting; 5-7 and 18+ are always hit / always stand
  const hardRows = [];
  for (let total = 8; total <= 17; total++) {
    hardRows.push(makeRow(
      String(total),
      row(up => analyze({ total, soft: false, pairValue: null, cardCount: 2 }, up, opts), opts)
    ));
  }

  const softRows = [];
  for (let total = 13; total <= 20; total++) {
    softRows.push(makeRow(
      `A,${total - 11}`,
      row(up => analyze({ total, soft: true, pairValue: null, cardCount: 2 }, up, opts), opts)
    ));
  }

  const pairRows = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(card => {
    const base = addCard(0, false, card);
    const hand = addCard(base.total, base.soft, card);
    const label = card === 1 ? 'A,A' : `${card},${card}`;

    return makeRow(label, row(
      up => analyze(
        { total: hand.total, soft: hand.soft, pairValue: card, cardCount: 2 },
        up,
        opts
      ),
      opts
    ));
  });

  // Only list plays the current rules actually permit
  const legendEntries = [
    ['H', 'Hit'], ['S', 'Stand'], ['D', 'Double'], ['P', 'Split']
  ];
  if (opts.surrender) legendEntries.push(['R', 'Surrender']);

  const legend = el('div.book__legend', {}, legendEntries.map(([letter, label]) => el('span.book__key', {}, [
    el('span', { text: letter, class: `book__cell book__cell--${letter}` }),
    el('span', { text: label })
  ])));

  return el('div.book', {}, [
    el('p.field__hint', {
      text: `Generated for the rules you're playing: ${opts.hitSoft17 ? 'H17' : 'S17'}, ` +
            `${opts.surrender ? 'late surrender' : 'no surrender'}, ` +
            `${opts.doubleAfterSplit ? 'double after split' : 'no double after split'}. ` +
            'Change the rules in Settings and this chart changes with them.',
      style: 'margin-bottom:0.75rem;line-height:1.45'
    }),
    legend,
    section('Hard totals', hardRows),
    section('Soft totals', softRows),
    section('Pairs', pairRows),
    el('p.field__hint', {
      text: 'Read down to your hand, across to the dealer\'s upcard. ' +
            'D means double if you can, otherwise hit. R means surrender if you can, otherwise hit.',
      style: 'margin-top:0.75rem;line-height:1.45'
    })
  ]);
}

export default renderBook;
