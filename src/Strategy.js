/**
 * Strategy.js
 * 
 * This class implements basic blackjack strategy and count-based deviations.
 * It provides decision-making methods for optimal play in different situations.
 */

import { RANKS } from './constants.js';

class Strategy {
  /**
   * Create a new strategy object
   * @param {Object} options - Strategy options
   * @param {boolean} options.hitSoft17 - Whether dealer hits on soft 17
   * @param {boolean} options.surrender - Whether surrender is allowed
   * @param {boolean} options.doubleAfterSplit - Whether doubling after split is allowed
   */
  constructor(options = {}) {
    this.options = {
      hitSoft17: true,
      surrender: true,
      doubleAfterSplit: true,
      ...options
    };

    // Initialize basic strategy tables
    this.initializeBasicStrategy();

    // Initialize the Illustrious 18 deviations (top 18 most important deviations)
    this.initializeIllustrious18();
  }

  /**
   * Initialize the basic strategy tables
   * @private
   */
  initializeBasicStrategy() {
    // Hard totals strategy table: [playerTotal][dealerUpcard]
    // Values: 'H' (hit), 'S' (stand), 'D' (double), 'Su' (surrender)
    this.hardTotals = {
      // Player total 8 or less always hits
      8: { 2: 'H', 3: 'H', 4: 'H', 5: 'H', 6: 'H', 7: 'H', 8: 'H', 9: 'H', 10: 'H', 11: 'H' },
      9: { 2: 'H', 3: 'D', 4: 'D', 5: 'D', 6: 'D', 7: 'H', 8: 'H', 9: 'H', 10: 'H', 11: 'H' },
      10: { 2: 'D', 3: 'D', 4: 'D', 5: 'D', 6: 'D', 7: 'D', 8: 'D', 9: 'D', 10: 'H', 11: 'H' },
      11: { 2: 'D', 3: 'D', 4: 'D', 5: 'D', 6: 'D', 7: 'D', 8: 'D', 9: 'D', 10: 'D', 11: 'D' },
      12: { 2: 'H', 3: 'H', 4: 'S', 5: 'S', 6: 'S', 7: 'H', 8: 'H', 9: 'H', 10: 'H', 11: 'H' },
      13: { 2: 'S', 3: 'S', 4: 'S', 5: 'S', 6: 'S', 7: 'H', 8: 'H', 9: 'H', 10: 'H', 11: 'H' },
      14: { 2: 'S', 3: 'S', 4: 'S', 5: 'S', 6: 'S', 7: 'H', 8: 'H', 9: 'H', 10: 'H', 11: 'H' },
      15: { 2: 'S', 3: 'S', 4: 'S', 5: 'S', 6: 'S', 7: 'H', 8: 'H', 9: 'H', 10: 'Su', 11: 'H' },
      16: { 2: 'S', 3: 'S', 4: 'S', 5: 'S', 6: 'S', 7: 'H', 8: 'H', 9: 'Su', 10: 'Su', 11: 'Su' },
      17: { 2: 'S', 3: 'S', 4: 'S', 5: 'S', 6: 'S', 7: 'S', 8: 'S', 9: 'S', 10: 'S', 11: 'S' }
      // 18 and above always stands
    };

    // Soft totals strategy table (hands with an Ace counted as 11)
    this.softTotals = {
      13: { 2: 'H', 3: 'H', 4: 'H', 5: 'D', 6: 'D', 7: 'H', 8: 'H', 9: 'H', 10: 'H', 11: 'H' }, // A-2
      14: { 2: 'H', 3: 'H', 4: 'H', 5: 'D', 6: 'D', 7: 'H', 8: 'H', 9: 'H', 10: 'H', 11: 'H' }, // A-3
      15: { 2: 'H', 3: 'H', 4: 'D', 5: 'D', 6: 'D', 7: 'H', 8: 'H', 9: 'H', 10: 'H', 11: 'H' }, // A-4
      16: { 2: 'H', 3: 'H', 4: 'D', 5: 'D', 6: 'D', 7: 'H', 8: 'H', 9: 'H', 10: 'H', 11: 'H' }, // A-5
      17: { 2: 'H', 3: 'D', 4: 'D', 5: 'D', 6: 'D', 7: 'H', 8: 'H', 9: 'H', 10: 'H', 11: 'H' }, // A-6
      18: { 2: 'S', 3: 'D', 4: 'D', 5: 'D', 6: 'D', 7: 'S', 8: 'S', 9: 'H', 10: 'H', 11: 'H' }, // A-7
      19: { 2: 'S', 3: 'S', 4: 'S', 5: 'S', 6: 'D', 7: 'S', 8: 'S', 9: 'S', 10: 'S', 11: 'S' }, // A-8
      20: { 2: 'S', 3: 'S', 4: 'S', 5: 'S', 6: 'S', 7: 'S', 8: 'S', 9: 'S', 10: 'S', 11: 'S' }  // A-9
    };

    // Pairs strategy table (for pair splitting decisions)
    this.pairs = {
      '2': { 2: 'P', 3: 'P', 4: 'P', 5: 'P', 6: 'P', 7: 'P', 8: 'H', 9: 'H', 10: 'H', 11: 'H' },
      '3': { 2: 'P', 3: 'P', 4: 'P', 5: 'P', 6: 'P', 7: 'P', 8: 'H', 9: 'H', 10: 'H', 11: 'H' },
      '4': { 2: 'H', 3: 'H', 4: 'H', 5: 'P', 6: 'P', 7: 'H', 8: 'H', 9: 'H', 10: 'H', 11: 'H' },
      '5': { 2: 'D', 3: 'D', 4: 'D', 5: 'D', 6: 'D', 7: 'D', 8: 'D', 9: 'D', 10: 'H', 11: 'H' },
      '6': { 2: 'P', 3: 'P', 4: 'P', 5: 'P', 6: 'P', 7: 'H', 8: 'H', 9: 'H', 10: 'H', 11: 'H' },
      '7': { 2: 'P', 3: 'P', 4: 'P', 5: 'P', 6: 'P', 7: 'P', 8: 'H', 9: 'H', 10: 'H', 11: 'H' },
      '8': { 2: 'P', 3: 'P', 4: 'P', 5: 'P', 6: 'P', 7: 'P', 8: 'P', 9: 'P', 10: 'P', 11: 'P' },
      '9': { 2: 'P', 3: 'P', 4: 'P', 5: 'P', 6: 'P', 7: 'S', 8: 'P', 9: 'P', 10: 'S', 11: 'S' },
      '10': { 2: 'S', 3: 'S', 4: 'S', 5: 'S', 6: 'S', 7: 'S', 8: 'S', 9: 'S', 10: 'S', 11: 'S' },
      '11': { 2: 'P', 3: 'P', 4: 'P', 5: 'P', 6: 'P', 7: 'P', 8: 'P', 9: 'P', 10: 'P', 11: 'P' } // Aces
    };

    // Adjust strategy based on dealer hitting soft 17
    if (this.options.hitSoft17) {
      // Common adjustments for H17 games
      this.softTotals[18][2] = 'D'; // Double A-7 vs 2 in H17 games
      // Additional adjustments can be added here
    }

    // Adjust strategy if surrender is not available
    if (!this.options.surrender) {
      // Replace all 'Su' with 'H' or 'S' as appropriate
      for (const total in this.hardTotals) {
        for (const upcard in this.hardTotals[total]) {
          if (this.hardTotals[total][upcard] === 'Su') {
            // For 16 vs 10, hit if surrender not available
            if (total === '16' && (upcard === '10' || upcard === '11')) {
              this.hardTotals[total][upcard] = 'H';
            } else if (total === '15' && upcard === '10') {
              this.hardTotals[total][upcard] = 'H';
            }
          }
        }
      }
    }
  }

  /**
   * Initialize the Illustrious 18 count-based deviations
   * @private
   */
  initializeIllustrious18() {
    // The Illustrious 18 is a list of the 18 most important index plays
    // Each entry has: player hand, dealer upcard, basic strategy play,
    // deviation play, and the true count index at which to deviate
    this.illustrious18 = [
      // [playerHand, dealerUpcard, basicStrategy, deviation, indexValue]
      // Insurance
      ['Insurance', 11, 'No Insurance', 'Take Insurance', 3],

      // Hard hands
      [16, 10, 'H', 'S', 0],   // 16 vs 10: Stand at 0 or higher (instead of hit)
      [15, 10, 'H', 'S', 4],   // 15 vs 10: Stand at +4 or higher
      [10, 10, 'H', 'D', 4],   // 10 vs 10: Double at +4 or higher
      [12, 3, 'H', 'S', 2],    // 12 vs 3: Stand at +2 or higher
      [12, 2, 'H', 'S', 3],    // 12 vs 2: Stand at +3 or higher
      [11, 11, 'D', 'H', -1],  // 11 vs A: Hit at -1 or lower (instead of double)
      [9, 2, 'H', 'D', 1],     // 9 vs 2: Double at +1 or higher
      [10, 11, 'H', 'D', 4],   // 10 vs A: Double at +4 or higher
      [9, 7, 'H', 'D', 3],     // 9 vs 7: Double at +3 or higher
      [16, 9, 'H', 'S', 5],    // 16 vs 9: Stand at +5 or higher
      [13, 2, 'S', 'H', -1],   // 13 vs 2: Hit at -1 or lower
      [12, 4, 'S', 'H', -2],   // 12 vs 4: Hit at -2 or lower
      [12, 5, 'S', 'H', -1],   // 12 vs 5: Hit at -1 or lower
      [12, 6, 'S', 'H', -1],   // 12 vs 6: Hit at -1 or lower

      // Pair splitting
      [['10', '10'], 5, 'S', 'P', 5],  // 10,10 vs 5: Split at +5 or higher
      [['10', '10'], 6, 'S', 'P', 4],  // 10,10 vs 6: Split at +4 or higher

      // Surrender
      [15, 11, 'H', 'Su', 1]   // 15 vs A: Surrender at +1 or higher
    ];
  }

  /**
   * Get the basic strategy play for a hand
   * @param {Hand} hand - The player's hand
   * @param {Card} dealerUpCard - The dealer's upcard
   * @returns {string} The recommended play: 'H' (hit), 'S' (stand), 'D' (double), 'P' (split), 'Su' (surrender)
   */
  getBasicStrategyPlay(hand, dealerUpCard) {
    const dealerValue = this._getDealerIndexValue(dealerUpCard);

    // Check for pair splitting first
    if (hand.canSplit()) {
      const pairKey = this._getPairKey(hand.cards[0]);
      if (this.pairs[pairKey] && this.pairs[pairKey][dealerValue]) {
        return this.pairs[pairKey][dealerValue];
      }
    }

    // Check for soft totals
    if (hand.isSoft()) {
      const total = hand.getValue();
      if (this.softTotals[total] && this.softTotals[total][dealerValue]) {
        return this.softTotals[total][dealerValue];
      }
    }

    // Handle hard totals
    const total = hand.getValue();

    // Handle 8 or less
    if (total <= 8) {
      return 'H';
    }

    // Handle 17 or more
    if (total >= 17) {
      return 'S';
    }

    // Handle remaining hard totals
    if (this.hardTotals[total] && this.hardTotals[total][dealerValue]) {
      return this.hardTotals[total][dealerValue];
    }

    // Default to hitting if nothing else matches
    return 'H';
  }

  /**
   * Get the count-based strategy play for a hand
   * @param {Hand} hand - The player's hand
   * @param {Card} dealerUpCard - The dealer's upcard
   * @param {number} trueCount - The true count
   * @param {boolean} allowSurrender - Whether surrender is allowed in the current situation
   * @returns {string} The recommended play: 'H' (hit), 'S' (stand), 'D' (double), 'P' (split), 'Su' (surrender)
   */
  getCountBasedPlay(hand, dealerUpCard, trueCount, allowSurrender = true) {
    const basicPlay = this.getBasicStrategyPlay(hand, dealerUpCard);
    const dealerValue = this._getDealerIndexValue(dealerUpCard);

    // Special case for insurance
    if (dealerUpCard.rank === 'ace' && trueCount >= 3) {
      // This would be handled separately, but including for completeness
      console.log('Insurance recommended at true count:', trueCount);
    }

    // Check for pair splitting deviations
    if (hand.canSplit()) {
      const pairKey = this._getPairKey(hand.cards[0]);

      // Look for deviations in Illustrious 18
      for (const [playerHand, upcard, basic, deviation, index] of this.illustrious18) {
        // Check if this is a pair splitting deviation
        if (Array.isArray(playerHand) &&
          playerHand[0] === pairKey &&
          playerHand[1] === pairKey &&
          upcard === dealerValue) {

          // Apply deviation if true count is at or above the index value
          if ((basic === basicPlay) &&
            ((deviation === 'P' && trueCount >= index) ||
              (deviation !== 'P' && trueCount <= index))) {
            return deviation;
          }
        }
      }
    }

    // Check for hard total deviations
    const total = hand.getValue();
    const isSoft = hand.isSoft();

    if (!isSoft) {
      for (const [playerHand, upcard, basic, deviation, index] of this.illustrious18) {
        // Skip pair splitting deviations and insurance
        if (Array.isArray(playerHand) || playerHand === 'Insurance') {
          continue;
        }

        // Check if this deviation applies to the current hand
        if (playerHand === total && upcard === dealerValue) {
          // Apply the deviation if the true count is at the right threshold
          if ((basic === basicPlay) &&
            ((deviation === 'S' && trueCount >= index) ||
              (deviation === 'H' && trueCount <= index) ||
              (deviation === 'D' && trueCount >= index) ||
              (deviation === 'Su' && trueCount >= index && allowSurrender))) {

            // Don't allow surrender if it's not permitted
            if (deviation === 'Su' && !allowSurrender) {
              return 'H'; // Default to hitting if surrender isn't allowed
            }

            return deviation;
          }
        }
      }
    }

    // If no deviations apply, return the basic strategy play
    return basicPlay;
  }

  /**
   * Convert a card to its strategy index value
   * @param {Card} card - The card to convert
   * @returns {number} The index value (2-11)
   * @private
   */
  _getDealerIndexValue(card) {
    if (card.rank === 'ace') {
      return 11;
    }

    if (['10', 'jack', 'queen', 'king'].includes(card.rank)) {
      return 10;
    }

    // For number cards, convert string to number
    return parseInt(card.rank, 10);
  }

  /**
   * Map a card to its key in the pairs table.
   * The table is keyed '2'-'10' plus '11' for aces, so named ranks
   * ('ace', 'king', ...) have to be translated or the lookup silently misses.
   * @param {Card} card - One card of the pair
   * @returns {string} The pairs-table key
   * @private
   */
  _getPairKey(card) {
    if (card.rank === 'ace') {
      return '11';
    }

    if (['10', 'jack', 'queen', 'king'].includes(card.rank)) {
      return '10';
    }

    return card.rank;
  }

  /**
   * Get the optimal play considering both basic strategy and count
   * @param {Hand} hand - The player's hand
   * @param {Card} dealerUpCard - The dealer's upcard
   * @param {Counter} counter - The counter object
   * @param {Object} options - Additional options
   * @returns {string} The recommended play as a full word: 'hit', 'stand', 'double', 'split', 'surrender'
   */
  getOptimalPlay(hand, dealerUpCard, counter, options = {}) {
    const allowSurrender = options.allowSurrender !== false && this.options.surrender;
    const isFreshHand = hand.cards.length === 2;

    // Get the true count from the counter
    const trueCount = counter ? counter.getTrueCount() : 0;

    // Get the recommended play based on count
    const play = this.getCountBasedPlay(hand, dealerUpCard, trueCount, allowSurrender && isFreshHand);

    // Convert the short code to a full word
    switch (play) {
      case 'H': return 'hit';
      case 'S': return 'stand';
      case 'D':
        // If can't double (more than 2 cards), convert to hit
        return (isFreshHand && options.allowDouble !== false) ? 'double' : 'hit';
      case 'P':
        // If can't split, get the non-splitting play
        return (options.allowSplit !== false) ? 'split' : this._getNonSplittingPlay(hand, dealerUpCard, trueCount);
      case 'Su':
        // If can't surrender, convert to appropriate alternative
        return (isFreshHand && allowSurrender) ? 'surrender' : 'hit';
      default: return 'hit';
    }
  }

  /**
   * Get the best play when splitting is not allowed
   * @param {Hand} hand - The player's hand
   * @param {Card} dealerUpCard - The dealer's upcard
   * @param {number} trueCount - The true count
   * @returns {string} The recommended play: 'hit', 'stand', 'double'
   * @private
   */
  _getNonSplittingPlay(hand, dealerUpCard, trueCount) {
    // Treat the hand as a non-pair and get the basic strategy play
    const dealerValue = this._getDealerIndexValue(dealerUpCard);
    const total = hand.getValue();
    const isSoft = hand.isSoft();

    if (isSoft) {
      if (this.softTotals[total] && this.softTotals[total][dealerValue]) {
        const play = this.softTotals[total][dealerValue];
        if (play === 'D') return 'double';
        if (play === 'S') return 'stand';
        return 'hit';
      }
    } else {
      if (total <= 8) return 'hit';
      if (total >= 17) return 'stand';

      if (this.hardTotals[total] && this.hardTotals[total][dealerValue]) {
        const play = this.hardTotals[total][dealerValue];
        if (play === 'D') return 'double';
        if (play === 'S') return 'stand';
        if (play === 'Su') return 'hit'; // If we can't split or surrender, we hit
        return 'hit';
      }
    }

    return 'hit'; // Default
  }
}

export default Strategy;
