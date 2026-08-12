/**
 * Hand.js
 * 
 * This class represents a hand of cards in a card game.
 * It provides methods for adding, removing, and evaluating cards in a hand.
 */

import { TEN_RANKS } from './constants.js';

class Hand {
  /**
   * Create a new hand
   * @param {string} owner - The owner of the hand (e.g., 'player', 'dealer')
   */
  constructor(owner = 'player') {
    this.cards = [];
    this.owner = owner;

    // Each hand carries its own wager so splits and doubles settle independently
    this.bet = 0;
    this.isDoubled = false;
    this.isSurrendered = false;
    this.isFromSplit = false;
    this.isComplete = false;  // player has finished acting on this hand
    this.result = null;  // 'win' | 'lose' | 'push' | 'blackjack' | 'surrender'
    this.payout = 0;
  }

  /**
   * Add a card to the hand
   * @param {Card} card - The card to add
   */
  addCard(card) {
    this.cards.push(card);
  }

  /**
   * Add multiple cards to the hand
   * @param {Card[]} cards - The cards to add
   */
  addCards(cards) {
    this.cards.push(...cards);
  }

  /**
   * Remove a card from the hand by index
   * @param {number} index - The index of the card to remove
   * @returns {Card|null} The removed card, or null if the index is invalid
   */
  removeCard(index) {
    if (index < 0 || index >= this.cards.length) {
      return null;
    }

    return this.cards.splice(index, 1)[0];
  }

  /**
   * Remove all cards from the hand
   * @returns {Card[]} The cards that were removed
   */
  removeAllCards() {
    const cards = [...this.cards];
    this.cards = [];
    return cards;
  }

  /**
   * Get the current number of cards in the hand
   * @returns {number} The number of cards
   */
  getCount() {
    return this.cards.length;
  }

  /**
   * Calculate the total value of the hand
   * @param {boolean} aceHigh - Whether aces should be counted as high (default: true)
   * @returns {number} The total value of the cards in the hand
   */
  getValue(aceHigh = true) {
    const hard = this.getHardValue();

    if (!aceHigh || !this.cards.some(card => card.rank === 'ace')) {
      return hard;
    }

    // At most one ace can ever be worth 11 without busting, so there is only
    // one promotion to consider.
    return hard + 10 <= 21 ? hard + 10 : hard;
  }

  /**
   * Calculate the hand's value counting every ace as 1
   * @returns {number} The hard total of the hand
   */
  getHardValue() {
    return this.cards.reduce(
      (total, card) => total + (card.rank === 'ace' ? 1 : card.value),
      0
    );
  }

  /**
   * Check if the hand has a blackjack (an ace and a 10-value card)
   * @returns {boolean} True if the hand is a blackjack
   */
  hasBlackjack() {
    // 21 on a split hand is just 21, never a natural
    if (this.cards.length !== 2 || this.isFromSplit) {
      return false;
    }

    const hasAce = this.cards.some(card => card.rank === 'ace');
    const hasTenCard = this.cards.some(card => TEN_RANKS.includes(card.rank));

    return hasAce && hasTenCard;
  }

  /**
   * Check if the hand is a bust (value over 21)
   * @returns {boolean} True if the hand is a bust
   */
  isBust() {
    return this.getValue() > 21;
  }

  /**
   * Check if the hand is soft (contains an ace counted as 11)
   * @returns {boolean} True if the hand is soft
   */
  isSoft() {
    // The hand is soft only if an ace is actually being counted as 11 right now.
    // Comparing against the hard total handles multi-ace hands correctly
    // (A,A,10 is a hard 12, not a soft hand).
    return this.getValue() > this.getHardValue();
  }

  /**
   * Check if the hand can be split (has exactly two cards of the same rank)
   * @returns {boolean} True if the hand can be split
   */
  canSplit() {
    return this.cards.length === 2 && this.cards[0].rank === this.cards[1].rank;
  }

  /**
   * Sort the cards in the hand by rank
   */
  sortByRank() {
    this.cards.sort((a, b) => a.value - b.value);
  }

  /**
   * Sort the cards in the hand by suit then rank
   */
  sortBySuit() {
    this.cards.sort((a, b) => {
      if (a.suit !== b.suit) {
        // Order by suit first (using string comparison)
        return a.suit.localeCompare(b.suit);
      }
      // Then by value/rank
      return a.value - b.value;
    });
  }

  /**
   * Get a description of the hand
   * @returns {string} A description of the cards in the hand
   */
  getDescription() {
    if (this.cards.length === 0) {
      return `${this.owner}'s hand is empty`;
    }

    const cardNames = this.cards.map(card => card.getName()).join(', ');
    return `${this.owner}'s hand: ${cardNames}`;
  }

  /**
   * Count the number of cards of a specific rank in the hand
   * @param {string} rank - The rank to count
   * @returns {number} The number of cards with that rank
   */
  countRank(rank) {
    return this.cards.filter(card => card.rank === rank).length;
  }

  /**
   * Count the number of cards of a specific suit in the hand
   * @param {string} suit - The suit to count
   * @returns {number} The number of cards with that suit
   */
  countSuit(suit) {
    return this.cards.filter(card => card.suit === suit).length;
  }

  /**
   * Get the best blackjack play according to basic strategy
   * @param {Card} dealerUpCard - The dealer's face-up card
   * @returns {string} The recommended action ('hit', 'stand', 'double', 'split', 'surrender')
   */
  getBlackjackPlay(dealerUpCard) {
    // This is a simplified implementation of blackjack basic strategy
    const value = this.getValue();
    const isSoft = this.isSoft();
    const canSplit = this.canSplit();

    // Check for splitting
    if (canSplit) {
      const rank = this.cards[0].rank;

      if (rank === 'ace' || rank === '8') {
        return 'split'; // Always split aces and 8s
      }

      if (rank === '9' && dealerUpCard.value < 7) {
        return 'split'; // Split 9s against dealer 2-6
      }

      if ((rank === '7' || rank === '6' || rank === '3' || rank === '2') &&
        dealerUpCard.value < 7) {
        return 'split'; // Split 7s, 6s, 3s, 2s against dealer 2-6
      }

      if (rank === '4' && (dealerUpCard.rank === '5' || dealerUpCard.rank === '6')) {
        return 'split'; // Split 4s against dealer 5-6
      }
    }

    // Check for soft hands (hands with an ace counted as 11)
    if (isSoft) {
      if (value >= 19) {
        return 'stand'; // Always stand on soft 19+
      }

      if (value === 18) {
        if (dealerUpCard.value < 9) {
          return 'stand'; // Stand on soft 18 vs dealer 2-8
        } else {
          return 'hit'; // Hit on soft 18 vs dealer 9-A
        }
      }

      if (value === 17 && dealerUpCard.value >= 3 && dealerUpCard.value <= 6) {
        return 'double'; // Double on soft 17 vs dealer 3-6
      }

      return 'hit'; // Otherwise, hit soft hands
    }

    // Hard hands
    if (value >= 17) {
      return 'stand'; // Always stand on hard 17+
    }

    if (value === 16 && dealerUpCard.value < 7) {
      return 'stand'; // Stand on 16 vs dealer 2-6
    }

    if (value >= 13 && dealerUpCard.value < 7) {
      return 'stand'; // Stand on 13-15 vs dealer 2-6
    }

    if (value === 12 && dealerUpCard.value >= 4 && dealerUpCard.value <= 6) {
      return 'stand'; // Stand on 12 vs dealer 4-6
    }

    if (value === 11) {
      return 'double'; // Always double on 11
    }

    if (value === 10 && dealerUpCard.value < 10) {
      return 'double'; // Double on 10 vs dealer 2-9
    }

    if (value === 9 && dealerUpCard.value >= 3 && dealerUpCard.value <= 6) {
      return 'double'; // Double on 9 vs dealer 3-6
    }

    return 'hit'; // Otherwise, hit
  }
}
export default Hand;
