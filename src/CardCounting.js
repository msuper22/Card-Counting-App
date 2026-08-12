/**
 * CardCounting.js
 * 
 * This module serves as the main entry point for all card counting features.
 * It exports all card counting related classes and utilities for easy access.
 */

import Counter from './Counter.js';
import Strategy from './Strategy.js';
import DeviationEngine from './DeviationEngine.js';
import BettingStrategy from './BettingStrategy.js';


/**
 * CardCounting module provides a convenient wrapper around all card counting components
 */
class CardCounting {
  /**
   * Create a new CardCounting instance with all required components
   * @param {Object} options - Configuration options for all components
   */
  constructor(options = {}) {
    this.options = {
      // Counter options
      countingSystem: 'HI_LO',
      numberOfDecks: 6,

      // Strategy options
      hitSoft17: true,
      surrender: true,
      doubleAfterSplit: true,

      // Betting options
      bankroll: 10000,
      minBet: 25,
      maxBet: 500,
      betSpread: 12,
      riskTolerance: 'medium',
      kelly: 0.8,

      ...options
    };

    // Initialize counter, strategy, and betting components
    this.counter = new Counter(
      this.options.countingSystem,
      this.options.numberOfDecks
    );

    this.strategy = new Strategy({
      hitSoft17: this.options.hitSoft17,
      surrender: this.options.surrender,
      doubleAfterSplit: this.options.doubleAfterSplit
    });

    this.deviationEngine = new DeviationEngine({
      countingSystem: this.options.countingSystem,
      numberOfDecks: this.options.numberOfDecks,
      hitSoft17: this.options.hitSoft17,
      surrender: this.options.surrender,
      doubleAfterSplit: this.options.doubleAfterSplit
    });

    this.bettingStrategy = new BettingStrategy({
      bankroll: this.options.bankroll,
      minBet: this.options.minBet,
      maxBet: this.options.maxBet,
      betSpread: this.options.betSpread,
      riskTolerance: this.options.riskTolerance,
      kelly: this.options.kelly
    });
  }

  /**
   * Track a card and update the running count
   * @param {Card} card - The card to track
   * @returns {number} The new running count
   */
  trackCard(card) {
    // Track in both counter and deviation engine to keep them in sync
    this.counter.trackCard(card);
    return this.deviationEngine.trackCard(card);
  }

  /**
   * Track multiple cards at once
   * @param {Card[]} cards - Array of cards to track
   * @returns {number} The new running count
   */
  trackCards(cards) {
    // Track in both counter and deviation engine to keep them in sync
    this.counter.trackCards(cards);
    return this.deviationEngine.trackCards(cards);
  }

  /**
   * Reset the counter to initial state
   */
  resetCount() {
    this.counter.reset();
    this.deviationEngine.resetCounter();
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
   * Get the optimal bet size based on the current count
   * @returns {number} The recommended bet amount
   */
  getOptimalBet() {
    const trueCount = this.getTrueCount();
    const playerAdvantage = this.counter.getEstimatedAdvantage() / 100;
    const recommendedBet = this.bettingStrategy.getOptimalBet(trueCount);

    return recommendedBet;
  }

  /**
   * Get detailed betting recommendation
   * @returns {Object} Detailed betting recommendation
   */
  getBettingRecommendation() {
    const trueCount = this.getTrueCount();
    const playerAdvantage = this.counter.getEstimatedAdvantage() / 100;

    return this.bettingStrategy.getBettingRecommendation(trueCount, playerAdvantage);
  }

  /**
   * Get the optimal play for a hand based on the current count
   * @param {Hand} hand - The player's hand
   * @param {Card} dealerUpCard - The dealer's upcard
   * @param {Object} options - Additional options for the decision
   * @returns {Object} Decision object with play and deviation info
   */
  getOptimalPlay(hand, dealerUpCard, options = {}) {
    return this.deviationEngine.getOptimalPlay(hand, dealerUpCard, options);
  }

  /**
   * Check if insurance is recommended at the current count
   * @returns {boolean} True if insurance is recommended
   */
  shouldTakeInsurance() {
    return this.deviationEngine.shouldTakeInsurance();
  }

  /**
   * Get a list of all applicable deviations for the current count
   * @returns {Array} List of applicable deviations sorted by importance
   */
  getApplicableDeviations() {
    return this.deviationEngine.getApplicableDeviations();
  }

  /**
   * Get the estimated player advantage with current count
   * @returns {number} Estimated advantage percentage
   */
  getEstimatedAdvantage() {
    return this.counter.getEstimatedAdvantage();
  }

  /**
   * Get the number of decks remaining
   * @returns {number} The estimated number of decks remaining
   */
  getDecksRemaining() {
    return this.counter.getDecksRemaining();
  }

  /**
   * Get the penetration percentage (percentage of cards dealt)
   * @returns {number} The penetration percentage (0-100)
   */
  getPenetration() {
    return this.counter.getPenetration();
  }

  /**
   * Calculate the risk of ruin with current bankroll and betting strategy
   * @returns {number} The probability of ruin (0-1)
   */
  getRiskOfRuin() {
    const playerAdvantage = this.counter.getEstimatedAdvantage() / 100;
    return this.bettingStrategy.calculateRiskOfRuin(playerAdvantage);
  }

  /**
   * Update the bankroll
   * @param {number} newBankroll - The new bankroll amount
   */
  updateBankroll(newBankroll) {
    return this.bettingStrategy.updateBankroll(newBankroll);
  }

  /**
   * Change the counting system
   * @param {string} system - The new counting system
   * @returns {boolean} True if the system was changed successfully
   */
  changeCountingSystem(system) {
    const counterChanged = this.counter.changeSystem(system);
    const deviationEngineChanged = this.deviationEngine.changeCountingSystem(system);

    return counterChanged && deviationEngineChanged;
  }
}

// Export all card counting related classes and the main wrapper
export { CardCounting, Counter, Strategy, DeviationEngine, BettingStrategy };
