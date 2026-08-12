/**
 * Player.js
 * 
 * This class represents a player in a card game.
 * It manages player properties, betting, and decision-making.
 */

import Hand from './Hand.js';

class Player {
  /**
   * Create a new player
   * @param {string} name - Player's name
   * @param {number} bankroll - Initial bankroll amount
   * @param {Object} options - Additional player options
   */
  constructor(name, bankroll = 1000, options = {}) {
    this.name = name;
    this.bankroll = bankroll;
    this.hands = [new Hand(name)];
    this.currentBet = 0;
    this.totalBet = 0;
    this.insuranceBet = 0;
    this.isActive = true;
    this.options = {
      isDealer: false,
      autoPlay: false,
      strategyLevel: 'basic', // 'basic', 'advanced', 'counting'
      ...options
    };
    this.countingSystem = options.countingSystem || 'HI_LO';
    this.runningCount = 0;
    this.roundsPlayed = 0;
    this.roundsWon = 0;
    this.roundsLost = 0;
    this.roundsPushed = 0;
    this.blackjacks = 0;
  }

  /**
   * Place a bet for the player
   * @param {number} amount - Amount to bet
   * @returns {boolean} True if the bet was placed successfully
   */
  placeBet(amount) {
    // Ensure bet is valid (positive and not more than bankroll)
    if (amount <= 0 || amount > this.bankroll) {
      return false;
    }

    this.currentBet = amount;
    this.totalBet = amount;
    this.bankroll -= amount;
    this.hands[0].bet = amount;
    return true;
  }

  /**
   * Place an insurance bet
   * @param {number} amount - Amount to bet for insurance
   * @returns {boolean} True if the insurance bet was placed successfully
   */
  placeInsurance(amount) {
    if (amount <= 0 || amount > this.bankroll || amount > this.currentBet / 2) {
      return false;
    }

    this.insuranceBet = amount;
    this.bankroll -= amount;
    return true;
  }

  /**
   * Double the player's bet
   * @returns {boolean} True if the bet was doubled successfully
   */
  doubleBet(handIndex = 0) {
    const hand = this.hands[handIndex];

    if (!hand || hand.bet > this.bankroll) {
      return false;
    }

    this.bankroll -= hand.bet;
    this.totalBet += hand.bet;
    hand.bet *= 2;
    hand.isDoubled = true;
    return true;
  }

  /**
   * Win a bet with the specified payout ratio
   * @param {number} ratio - Payout ratio (1 for even money, 1.5 for blackjack)
   */
  winBet(ratio = 1, handIndex = 0) {
    const hand = this.hands[handIndex];
    if (!hand) return 0;

    // Return the original stake plus the winnings
    const returned = hand.bet * (1 + ratio);
    this.bankroll += returned;
    this.roundsWon++;

    hand.result = ratio > 1 ? 'blackjack' : 'win';
    hand.payout = returned;
    return returned;
  }

  /**
   * Win an insurance bet
   */
  winInsurance() {
    this.bankroll += this.insuranceBet * 3; // 2:1 payout
    this.insuranceBet = 0;
  }

  /**
   * Lose the current bet
   */
  loseBet(handIndex = 0) {
    const hand = this.hands[handIndex];
    if (!hand) return 0;

    // The stake was already deducted when the bet was placed
    this.roundsLost++;
    hand.result = 'lose';
    hand.payout = 0;
    return 0;
  }

  /**
   * Lose the insurance bet
   */
  loseInsurance() {
    this.insuranceBet = 0;
  }

  /**
   * Push the current bet (get the bet amount back)
   */
  pushBet(handIndex = 0) {
    const hand = this.hands[handIndex];
    if (!hand) return 0;

    this.bankroll += hand.bet;
    this.roundsPushed++;
    hand.result = 'push';
    hand.payout = hand.bet;
    return hand.bet;
  }

  /**
   * Split the player's hand
   * @returns {boolean} True if the hand was split successfully
   */
  splitHand(handIndex = 0) {
    const originalHand = this.hands[handIndex];

    // Check if the hand can be split and the player has enough money
    if (!originalHand || !originalHand.canSplit() || originalHand.bet > this.bankroll) {
      return false;
    }

    // Create a new hand with the second card, matching the original hand's bet
    const newHand = new Hand(this.name);
    newHand.addCard(originalHand.removeCard(1));
    newHand.bet = originalHand.bet;
    newHand.isFromSplit = true;
    originalHand.isFromSplit = true;

    // Insert directly after the hand it came from so play order stays left-to-right
    this.hands.splice(handIndex + 1, 0, newHand);

    // Place a matching bet on the new hand
    this.bankroll -= newHand.bet;
    this.totalBet += newHand.bet;

    return true;
  }

  /**
   * Track a card for card counting
   * @param {Card} card - The card to track
   */
  trackCard(card) {
    if (!card.faceUp) {
      return; // Only count face-up cards
    }

    // Update running count based on the selected counting system
    if (this.options.strategyLevel === 'counting') {
      this.runningCount += card.getCountValue(this.countingSystem);
    }
  }

  /**
   * Calculate the true count (running count divided by decks remaining)
   * @param {number} decksRemaining - The number of decks remaining
   * @returns {number} The true count
   */
  getTrueCount(decksRemaining) {
    if (decksRemaining <= 0) {
      return 0;
    }
    return this.runningCount / decksRemaining;
  }

  /**
   * Calculate the optimal bet based on the true count
   * @param {number} trueCount - The true count
   * @param {number} minBet - The minimum bet allowed
   * @param {number} maxBet - The maximum bet allowed
   * @returns {number} The optimal bet amount
   */
  getOptimalBet(trueCount, minBet, maxBet) {
    if (this.options.strategyLevel !== 'counting') {
      return minBet; // Default to minimum bet if not counting
    }

    if (trueCount <= 1) {
      return minBet;
    }

    // Calculate bet based on true count
    const betMultiplier = Math.max(0, trueCount - 1);
    const betAmount = Math.min(
      maxBet,
      Math.max(minBet, minBet * betMultiplier)
    );

    // Ensure we don't bet more than we have
    return Math.min(betAmount, this.bankroll);
  }

  /**
   * Make a decision for the current hand based on strategy
   * @param {Card} dealerUpCard - The dealer's face-up card
   * @param {number} handIndex - The index of the hand to make a decision for
   * @returns {string} The decision ('hit', 'stand', 'double', 'split', 'surrender')
   */
  makeDecision(dealerUpCard, handIndex = 0) {
    const hand = this.hands[handIndex];

    if (!hand) {
      return null;
    }

    // If autoPlay is off, this would be decided by the user interface
    if (!this.options.autoPlay) {
      return null;
    }

    // Basic strategy decision
    return hand.getBlackjackPlay(dealerUpCard);
  }

  /**
   * Reset the player for a new round
   */
  resetForNewRound() {
    this.hands = [new Hand(this.name)];
    this.currentBet = 0;
    this.totalBet = 0;
    this.insuranceBet = 0;
  }

  /**
   * Record a blackjack
   */
  recordBlackjack() {
    this.blackjacks++;
  }

  /**
   * Get player statistics
   * @returns {Object} The player's statistics
   */
  getStats() {
    return {
      name: this.name,
      bankroll: this.bankroll,
      roundsPlayed: this.roundsPlayed,
      roundsWon: this.roundsWon,
      roundsLost: this.roundsLost,
      roundsPushed: this.roundsPushed,
      winRate: this.roundsPlayed > 0 ? (this.roundsWon / this.roundsPlayed) : 0,
      blackjacks: this.blackjacks,
      blackjackRate: this.roundsPlayed > 0 ? (this.blackjacks / this.roundsPlayed) : 0
    };
  }

  /**
   * Check if player can afford to take an action
   * @param {string} action - The action to check ('double', 'split', 'insurance')
   * @returns {boolean} True if the player can afford the action
   */
  canAfford(action) {
    if (action === 'double') {
      return this.bankroll >= this.currentBet;
    } else if (action === 'split') {
      return this.bankroll >= this.currentBet;
    } else if (action === 'insurance') {
      return this.bankroll >= (this.currentBet / 2);
    }
    return true;
  }
}

export default Player;