/**
 * Counter.js
 * 
 * This class implements different card counting systems for blackjack.
 * It tracks running counts, calculates true counts, and provides methods
 * for making count-based decisions.
 */

import { COUNTING_SYSTEMS } from './constants.js';

class Counter {
  /**
   * Create a new counter
   * @param {string} system - The counting system to use (HI_LO, KO, OMEGA_II)
   * @param {number} numberOfDecks - Number of decks in play
   */
  constructor(system = 'HI_LO', numberOfDecks = 6) {
    if (!COUNTING_SYSTEMS[system]) {
      throw new Error(`Unknown counting system: ${system}`);
    }
    
    this.system = system;
    this.countingValues = COUNTING_SYSTEMS[system];
    this.initialNumberOfDecks = numberOfDecks;
    this.reset();
  }

  /**
   * Reset the counter to initial state
   */
  reset() {
    this.runningCount = 0;
    this.cardsDealt = 0;
    this.decksRemaining = this.initialNumberOfDecks;
  }
  
  /**
   * Track a card and update the running count
   * @param {Card} card - The card to track
   * @returns {number} The new running count
   */
  trackCard(card) {
    if (!card.faceUp) {
      return this.runningCount; // Only count face-up cards
    }
    
    const countValue = this.countingValues[card.rank];
    this.runningCount += countValue;
    this.cardsDealt++;
    
    // Update decks remaining
    this.decksRemaining = this.initialNumberOfDecks - (this.cardsDealt / 52);
    
    return this.runningCount;
  }
  
  /**
   * Track multiple cards at once
   * @param {Card[]} cards - Array of cards to track
   * @returns {number} The new running count
   */
  trackCards(cards) {
    cards.forEach(card => this.trackCard(card));
    return this.runningCount;
  }
  
  /**
   * Get the current running count
   * @returns {number} The running count
   */
  getRunningCount() {
    return this.runningCount;
  }

  /**
   * Sync decks-remaining to the real shoe rather than inferring it from the
   * cards this counter happened to see (the hole card is dealt face down and
   * never tracked, so the inferred figure drifts).
   * @param {number} decks - Actual decks left in the shoe
   */
  setDecksRemaining(decks) {
    this.decksRemaining = decks;
    this.cardsDealt = Math.max(0, Math.round((this.initialNumberOfDecks - decks) * 52));
  }
  
  /**
   * Get the true count (running count divided by decks remaining)
   * @returns {number} The true count
   */
  getTrueCount() {
    if (this.decksRemaining <= 0.5) {
      return this.runningCount; // Avoid division by very small numbers
    }
    
    // Round to 1 decimal place for practical use
    return Math.round((this.runningCount / this.decksRemaining) * 10) / 10;
  }
  
  /**
   * Change the counting system
   * @param {string} system - The new counting system to use
   * @returns {boolean} True if the system was changed successfully
   */
  changeSystem(system) {
    if (!COUNTING_SYSTEMS[system]) {
      return false;
    }
    
    this.system = system;
    this.countingValues = COUNTING_SYSTEMS[system];
    this.reset();
    return true;
  }
  
  /**
   * Get the estimated player advantage based on the true count
   * @returns {number} The estimated advantage percentage
   */
  getEstimatedAdvantage() {
    // A common rule of thumb is that each true count point is worth about 0.5% advantage
    const trueCount = this.getTrueCount();
    
    // Base house edge is approximately -0.5% with perfect basic strategy
    const baseHouseEdge = -0.5;
    
    // Calculate player advantage
    return baseHouseEdge + (trueCount * 0.5);
  }
  
  /**
   * Get the number of decks remaining
   * @returns {number} The estimated number of decks remaining
   */
  getDecksRemaining() {
    return Math.max(0, this.decksRemaining);
  }
  
  /**
   * Get the penetration percentage (percentage of cards dealt)
   * @returns {number} The penetration percentage (0-100)
   */
  getPenetration() {
    return (this.cardsDealt / (this.initialNumberOfDecks * 52)) * 100;
  }
}

export default Counter;