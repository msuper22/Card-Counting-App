/**
 * CardView.js
 *
 * Renders a card as DOM. Sizing is entirely CSS-driven (--card-w), so the same
 * markup works on a phone and a tablet without measuring anything in JS.
 */

import { el } from './dom.js';

const SUIT_GLYPHS = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠'
};

const RANK_LABELS = {
  ace: 'A',
  jack: 'J',
  queen: 'Q',
  king: 'K'
};

/**
 * Short display label for a rank ('king' -> 'K')
 * @param {string} rank
 * @returns {string}
 */
export function rankLabel(rank) {
  return RANK_LABELS[rank] || rank;
}

/**
 * Suit symbol for a suit name
 * @param {string} suit
 * @returns {string}
 */
export function suitGlyph(suit) {
  return SUIT_GLYPHS[suit] || '?';
}

/**
 * Build the DOM for a single card.
 * @param {Object} card - Serialized card from getGameState()
 * @param {number} [index] - Position in the hand, used to stagger the deal animation
 * @returns {HTMLElement}
 */
export function renderCard(card, index = 0) {
  const delay = `${Math.min(index, 6) * 60}ms`;

  if (!card.faceUp) {
    return el('div.card.card--back', {
      style: `animation-delay:${delay}`,
      'aria-label': 'face down card'
    });
  }

  const isRed = card.suit === 'hearts' || card.suit === 'diamonds';
  const label = rankLabel(card.rank);
  const glyph = suitGlyph(card.suit);

  return el(
    `div.card.card--${isRed ? 'red' : 'black'}`,
    {
      style: `animation-delay:${delay}`,
      'aria-label': `${label} of ${card.suit}`
    },
    [
      el('div.card__corner', {}, [
        el('span', { text: label }),
        el('span', { text: glyph })
      ]),
      el('div.card__center', {}, el('span.card__pip', { text: glyph }))
    ]
  );
}
