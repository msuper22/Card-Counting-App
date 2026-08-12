/**
 * DeviationEngine.js
 * 
 * This module analyzes game state and provides specific deviations
 * from basic strategy based on the current count and game conditions.
 * It serves as a higher-level decision engine for card counters.
 */

import Strategy from './Strategy.js';
import Counter from './Counter.js';

class DeviationEngine {
  /**
   * Create a new deviation engine
   * @param {Object} options - Configuration options
   * @param {string} options.countingSystem - The counting system to use
   * @param {number} options.numberOfDecks - Number of decks in play
   * @param {boolean} options.hitSoft17 - Whether dealer hits on soft 17
   * @param {boolean} options.surrender - Whether surrender is allowed
   * @param {boolean} options.doubleAfterSplit - Whether doubling after split is allowed
   */
  constructor(options = {}) {
    this.options = {
      countingSystem: 'HI_LO',
      numberOfDecks: 6,
      hitSoft17: true,
      surrender: true,
      doubleAfterSplit: true,
      ...options
    };

    // Initialize strategy and counter objects
    this.strategy = new Strategy({
      hitSoft17: this.options.hitSoft17,
      surrender: this.options.surrender,
      doubleAfterSplit: this.options.doubleAfterSplit
    });

    this.counter = new Counter(
      this.options.countingSystem,
      this.options.numberOfDecks
    );

    // Map of importance ratings for different deviations
    this.deviationImportance = this._initializeDeviationImportance();
  }

  /**
   * Initialize the importance ratings for different deviations
   * @returns {Object} Map of deviation importance
   * @private
   */
  _initializeDeviationImportance() {
    // This provides a ranking of which deviations are most important to learn
    // based on their frequency of occurrence and impact on expected value
    return {
      'Insurance at TC ≥ 3': 1,           // Insurance is the #1 most important index play
      '16 vs 10: S at TC ≥ 0': 2,         // 16 vs 10 is very common
      '15 vs 10: S at TC ≥ 4': 3,         // 15 vs 10 is also common
      '10 vs 10: D at TC ≥ 4': 4,         // 10 vs 10 is a high-value deviation
      '12 vs 3: S at TC ≥ 2': 5,          // 12 vs 3 occurs frequently
      '12 vs 2: S at TC ≥ 3': 6,          // 12 vs 2 occurs frequently
      '11 vs A: H at TC ≤ -1': 7,         // 11 vs A is a high-impact deviation
      '9 vs 2: D at TC ≥ 1': 8,           // 9 vs 2 is a good double opportunity
      '10 vs A: D at TC ≥ 4': 9,          // 10 vs A can significantly increase EV
      '9 vs 7: D at TC ≥ 3': 10,          // 9 vs 7 is a valuable double opportunity
      '16 vs 9: S at TC ≥ 5': 11,         // 16 vs 9 deviation has high impact
      '13 vs 2: H at TC ≤ -1': 12,        // 13 vs 2 affects common situation
      '12 vs 4: H at TC ≤ -2': 13,        // 12 vs 4 affects common situation
      '12 vs 5: H at TC ≤ -1': 14,        // 12 vs 5 affects common situation
      '12 vs 6: H at TC ≤ -1': 15,        // 12 vs 6 affects common situation
      '10,10 vs 5: P at TC ≥ 5': 16,      // Splitting 10s is rare but high impact
      '10,10 vs 6: P at TC ≥ 4': 17,      // Splitting 10s vs 6 is less frequent
      '15 vs A: Su at TC ≥ 1': 18,        // Surrender deviation completes the illustrious 18

      // Additional deviations (beyond the Illustrious 18)
      '14 vs 10: Su at TC ≥ 3': 19,
      'A,8 vs 6: D at TC ≥ 1': 20
    };
  }

  /**
   * Reset the counter to initial state
   */
  resetCounter() {
    this.counter.reset();
  }

  /**
   * Track a card and update the running count
   * @param {Card} card - The card to track
   * @returns {number} The new running count
   */
  trackCard(card) {
    return this.counter.trackCard(card);
  }

  /**
   * Track multiple cards at once
   * @param {Card[]} cards - Array of cards to track
   * @returns {number} The new running count
   */
  trackCards(cards) {
    return this.counter.trackCards(cards);
  }

  /**
   * Get the current running count
   * @returns {number} The running count
   */
  getRunningCount() {
    return this.counter.getRunningCount();
  }

  /**
   * Get the true count (running count divided by decks remaining)
   * @returns {number} The true count
   */
  getTrueCount() {
    return this.counter.getTrueCount();
  }

  /**
   * Get the optimal play for a hand based on count
   * @param {Hand} hand - The player's hand
   * @param {Card} dealerUpCard - The dealer's upcard
   * @param {Object} options - Additional options for the decision
   * @returns {Object} Decision object with play and deviation info
   */
  getOptimalPlay(hand, dealerUpCard, options = {}) {
    // Get basic strategy play first
    const basicPlay = this.strategy.getBasicStrategyPlay(hand, dealerUpCard);

    // Get count-based optimal play
    const countBasedPlay = this.strategy.getOptimalPlay(
      hand,
      dealerUpCard,
      this.counter,
      options
    );

    // Convert short codes to full words for basic strategy
    const basicPlayWord = this._convertCodeToWord(basicPlay, hand.cards.length === 2);

    // Check if this is a deviation from basic strategy
    const isDeviation = basicPlayWord !== countBasedPlay;

    // Create a description of the deviation if applicable
    let deviationDescription = null;
    let deviationImportance = null;

    if (isDeviation) {
      deviationDescription = this._createDeviationDescription(
        hand,
        dealerUpCard,
        basicPlayWord,
        countBasedPlay,
        this.counter.getTrueCount()
      );

      // Look up the importance of this deviation
      for (const [desc, importance] of Object.entries(this.deviationImportance)) {
        if (deviationDescription.includes(desc.split(':')[0])) {
          deviationImportance = importance;
          break;
        }
      }
    }

    return {
      hand: hand.getValue(),
      dealerUpCard: dealerUpCard.rank,
      isSoft: hand.isSoft(),
      isPair: hand.canSplit(),
      runningCount: this.counter.getRunningCount(),
      trueCount: this.counter.getTrueCount(),
      basicStrategy: basicPlayWord,
      optimalPlay: countBasedPlay,
      isDeviation,
      deviationDescription,
      deviationImportance,
      estimatedAdvantage: this.counter.getEstimatedAdvantage()
    };
  }

  /**
   * Convert strategy code to full word
   * @param {string} code - Strategy code (H, S, D, P, Su)
   * @param {boolean} isFreshHand - Whether the hand has exactly 2 cards
   * @returns {string} Full word (hit, stand, double, split, surrender)
   * @private
   */
  _convertCodeToWord(code, isFreshHand) {
    switch (code) {
      case 'H': return 'hit';
      case 'S': return 'stand';
      case 'D': return isFreshHand ? 'double' : 'hit';
      case 'P': return 'split';
      case 'Su': return isFreshHand && this.options.surrender ? 'surrender' : 'hit';
      default: return 'hit';
    }
  }

  /**
   * Create a human-readable description of a deviation
   * @param {Hand} hand - The player's hand
   * @param {Card} dealerUpCard - The dealer's upcard
   * @param {string} basicPlay - The basic strategy play
   * @param {string} deviationPlay - The count-based play
   * @param {number} trueCount - The true count
   * @returns {string} Human-readable description
   * @private
   */
  _createDeviationDescription(hand, dealerUpCard, basicPlay, deviationPlay, trueCount) {
    let handDescription = '';

    // Describe the hand appropriately
    if (hand.canSplit()) {
      handDescription = `${hand.cards[0].rank},${hand.cards[1].rank}`;
    } else if (hand.isSoft()) {
      // Find the non-ace card for soft hand description
      const nonAceCard = hand.cards.find(card => card.rank !== 'ace');
      handDescription = `A,${nonAceCard ? nonAceCard.rank : hand.getValue() - 11}`;
    } else {
      handDescription = hand.getValue().toString();
    }

    // Get dealer upcard value
    const dealerValue = dealerUpCard.rank === 'ace' ? 'A' :
      ['10', 'jack', 'queen', 'king'].includes(dealerUpCard.rank) ? '10' :
        dealerUpCard.rank;

    // Format deviation description
    return `${handDescription} vs ${dealerValue}: ${deviationPlay.charAt(0).toUpperCase()} at TC ${trueCount >= 0 ? '≥' : '≤'} ${Math.abs(trueCount)}`;
  }

  /**
   * Check if insurance is recommended
   * @returns {boolean} True if insurance is recommended
   */
  shouldTakeInsurance() {
    // Insurance is profitable when true count is 3 or higher
    return this.counter.getTrueCount() >= 3;
  }

  /**
   * Get a list of all applicable deviations for the current count
   * @returns {Array} List of applicable deviations sorted by importance
   */
  getApplicableDeviations() {
    const trueCount = this.counter.getTrueCount();
    const deviations = [];

    // List of all deviations from the illustrious 18 and beyond
    const allDeviations = [
      // Format: [Condition, Name, Basic Play, Deviation Play, Index]
      [trueCount >= 3, 'Insurance at TC ≥ 3', 'No Insurance', 'Take Insurance', 3],
      [trueCount >= 0, '16 vs 10: S at TC ≥ 0', 'hit', 'stand', 0],
      [trueCount >= 4, '15 vs 10: S at TC ≥ 4', 'hit', 'stand', 4],
      [trueCount >= 4, '10 vs 10: D at TC ≥ 4', 'hit', 'double', 4],
      [trueCount >= 2, '12 vs 3: S at TC ≥ 2', 'hit', 'stand', 2],
      [trueCount >= 3, '12 vs 2: S at TC ≥ 3', 'hit', 'stand', 3],
      [trueCount <= -1, '11 vs A: H at TC ≤ -1', 'double', 'hit', -1],
      [trueCount >= 1, '9 vs 2: D at TC ≥ 1', 'hit', 'double', 1],
      [trueCount >= 4, '10 vs A: D at TC ≥ 4', 'hit', 'double', 4],
      [trueCount >= 3, '9 vs 7: D at TC ≥ 3', 'hit', 'double', 3],
      [trueCount >= 5, '16 vs 9: S at TC ≥ 5', 'hit', 'stand', 5],
      [trueCount <= -1, '13 vs 2: H at TC ≤ -1', 'stand', 'hit', -1],
      [trueCount <= -2, '12 vs 4: H at TC ≤ -2', 'stand', 'hit', -2],
      [trueCount <= -1, '12 vs 5: H at TC ≤ -1', 'stand', 'hit', -1],
      [trueCount <= -1, '12 vs 6: H at TC ≤ -1', 'stand', 'hit', -1],
      [trueCount >= 5, '10,10 vs 5: P at TC ≥ 5', 'stand', 'split', 5],
      [trueCount >= 4, '10,10 vs 6: P at TC ≥ 4', 'stand', 'split', 4],
      [trueCount >= 1, '15 vs A: Su at TC ≥ 1', 'hit', 'surrender', 1],
      [trueCount >= 3, '14 vs 10: Su at TC ≥ 3', 'hit', 'surrender', 3],
      [trueCount >= 1, 'A,8 vs 6: D at TC ≥ 1', 'stand', 'double', 1]
    ];

    // Filter to only include applicable deviations
    allDeviations.forEach(([condition, name, basic, deviation, index]) => {
      if (condition) {
        deviations.push({
          name,
          basicStrategy: basic,
          deviation,
          indexValue: index,
          importance: this.deviationImportance[name] || 99
        });
      }
    });

    // Sort by importance
    return deviations.sort((a, b) => a.importance - b.importance);
  }

  /**
   * Change the counting system
   * @param {string} system - The new counting system
   * @returns {boolean} True if the system was changed successfully
   */
  changeCountingSystem(system) {
    return this.counter.changeSystem(system);
  }

  /**
   * Get estimated player advantage with current count
   * @returns {number} Estimated advantage percentage
   */
  getEstimatedAdvantage() {
    return this.counter.getEstimatedAdvantage();
  }
}

export default DeviationEngine;
