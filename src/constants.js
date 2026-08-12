/**
 * constants.js
 * 
 * This module contains all the constant values used in the card game application.
 * These include suits, ranks, colors, and mappings between different card properties.
 */

// Card suits
export const SUITS = Object.freeze({
  HEARTS: 'hearts',
  DIAMONDS: 'diamonds',
  CLUBS: 'clubs',
  SPADES: 'spades'
});

// Card ranks
export const RANKS = Object.freeze({
  ACE: 'ace',
  TWO: '2',
  THREE: '3',
  FOUR: '4',
  FIVE: '5',
  SIX: '6',
  SEVEN: '7',
  EIGHT: '8',
  NINE: '9',
  TEN: '10',
  JACK: 'jack',
  QUEEN: 'queen',
  KING: 'king'
});

// Card colors
export const COLORS = Object.freeze({
  RED: 'red',
  BLACK: 'black'
});

// Suit to color mapping
export const SUIT_TO_COLOR = Object.freeze({
  [SUITS.HEARTS]: COLORS.RED,
  [SUITS.DIAMONDS]: COLORS.RED,
  [SUITS.CLUBS]: COLORS.BLACK,
  [SUITS.SPADES]: COLORS.BLACK
});

// Rank to value mapping (blackjack scoring).
// Face cards are all worth 10; the ace is worth 11 here and Hand.getValue()
// demotes it to 1 when counting it as 11 would bust the hand.
export const RANK_TO_VALUE = Object.freeze({
  [RANKS.ACE]: 11,
  [RANKS.TWO]: 2,
  [RANKS.THREE]: 3,
  [RANKS.FOUR]: 4,
  [RANKS.FIVE]: 5,
  [RANKS.SIX]: 6,
  [RANKS.SEVEN]: 7,
  [RANKS.EIGHT]: 8,
  [RANKS.NINE]: 9,
  [RANKS.TEN]: 10,
  [RANKS.JACK]: 10,
  [RANKS.QUEEN]: 10,
  [RANKS.KING]: 10
});

// Ranks that count as ten in blackjack
export const TEN_RANKS = Object.freeze([RANKS.TEN, RANKS.JACK, RANKS.QUEEN, RANKS.KING]);

// Card counting systems
export const COUNTING_SYSTEMS = Object.freeze({
  // Hi-Lo counting system
  HI_LO: {
    [RANKS.ACE]: -1,
    [RANKS.TWO]: 1,
    [RANKS.THREE]: 1,
    [RANKS.FOUR]: 1,
    [RANKS.FIVE]: 1,
    [RANKS.SIX]: 1,
    [RANKS.SEVEN]: 0,
    [RANKS.EIGHT]: 0,
    [RANKS.NINE]: 0,
    [RANKS.TEN]: -1,
    [RANKS.JACK]: -1,
    [RANKS.QUEEN]: -1,
    [RANKS.KING]: -1
  },
  // KO (Knock Out) counting system
  KO: {
    [RANKS.ACE]: -1,
    [RANKS.TWO]: 1,
    [RANKS.THREE]: 1,
    [RANKS.FOUR]: 1,
    [RANKS.FIVE]: 1,
    [RANKS.SIX]: 1,
    [RANKS.SEVEN]: 1,
    [RANKS.EIGHT]: 0,
    [RANKS.NINE]: 0,
    [RANKS.TEN]: -1,
    [RANKS.JACK]: -1,
    [RANKS.QUEEN]: -1,
    [RANKS.KING]: -1
  },
  // Omega II counting system
  OMEGA_II: {
    [RANKS.ACE]: 0,
    [RANKS.TWO]: 1,
    [RANKS.THREE]: 1,
    [RANKS.FOUR]: 2,
    [RANKS.FIVE]: 2,
    [RANKS.SIX]: 2,
    [RANKS.SEVEN]: 1,
    [RANKS.EIGHT]: 0,
    [RANKS.NINE]: -1,
    [RANKS.TEN]: -2,
    [RANKS.JACK]: -2,
    [RANKS.QUEEN]: -2,
    [RANKS.KING]: -2
  }
});

// Card ID system (1-52)
// This creates an array of objects with id, suit, and rank for each card
export const CARDS = (() => {
  const cards = [];
  let id = 1;
  
  Object.values(SUITS).forEach(suit => {
    Object.values(RANKS).forEach(rank => {
      cards.push({
        id: id++,
        suit,
        rank,
        value: RANK_TO_VALUE[rank],
        hiLoCount: COUNTING_SYSTEMS.HI_LO[rank]
      });
    });
  });
  
  return Object.freeze(cards);
})();

// Game constants
export const GAME = Object.freeze({
  MAX_PLAYERS: 4,
  CARDS_PER_HAND: 5,
  MAX_ROUNDS: 10
});