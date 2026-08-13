/**
 * Trainer.js
 *
 * Binds the card-counting modules to a running Game. Nothing connected them
 * before, so the counting engine sat unused while the UI did its own ad-hoc
 * arithmetic.
 *
 * The Trainer owns three jobs:
 *   1. Keep the running/true count in sync with every card the table can see.
 *   2. Answer "what should I do here?" using basic strategy plus deviations.
 *   3. Score the player against those answers so accuracy can be reported.
 */

import { CardCounting } from './CardCounting.js';

/** Format a count with an explicit sign, so +2 and -2 can't be confused */
function signedCount(value) {
  const rounded = Math.round((value || 0) * 10) / 10;
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

class Trainer {
  /**
   * @param {Game} game - The game to observe
   * @param {Object} options - Trainer configuration
   */
  constructor(game, options = {}) {
    this.game = game;
    this.options = {
      countingSystem: 'HI_LO',
      minBet: 5,
      maxBet: 500,
      betSpread: 12,
      ...options
    };

    this.engine = new CardCounting({
      countingSystem: this.options.countingSystem,
      numberOfDecks: game.options.numberOfDecks,
      hitSoft17: game.options.hitSoft17,
      surrender: game.options.allowSurrender,
      doubleAfterSplit: game.options.allowDoubleAfterSplit,
      bankroll: options.bankroll || 1000,
      minBet: this.options.minBet,
      maxBet: this.options.maxBet,
      betSpread: this.options.betSpread
    });

    // Cards already folded into the count, tracked by identity so that
    // re-scanning the table is idempotent.
    this.countedCards = new WeakSet();

    this.stats = this._emptyStats();

    // Mistakes made during the hand in progress, for the post-hand review
    this.roundMistakes = [];

    this.listeners = {};

    this._attachToGame();
  }

  _emptyStats() {
    return {
      decisions: 0,
      correctDecisions: 0,
      deviationsSeen: 0,
      deviationsHit: 0,
      handsPlayed: 0,
      betsGraded: 0,
      betsCorrect: 0,
      auditsTaken: 0,
      auditsCorrect: 0,
      mistakes: []
    };
  }

  /**
   * Subscribe to game events that can change what the table can see.
   * @private
   */
  _attachToGame() {
    const resync = () => this.syncCount();

    [
      'initialCardsDealt', 'playerHit', 'playerDouble', 'playerSplit',
      'dealerTurnPhaseStarted', 'dealerBlackjack', 'payoutPhaseStarted',
      'bettingPhaseStarted', 'playerTurnPhaseStarted', 'turnChanged',
      'nextHand', 'insuranceOffered'
    ].forEach(event => this.game.addEventListener(event, resync));

    // A fresh shoe means a fresh count and a fresh set of seen cards
    this.game.addEventListener('deckReshuffled', () => {
      this.engine.resetCount();
      this.countedCards = new WeakSet();
      this._emit('countReset', {});
    });

    this.game.addEventListener('roundCompleted', () => {
      this.stats.handsPlayed++;
    });

    // A new betting phase means a new hand, so the review buffer starts empty
    this.game.addEventListener('bettingPhaseStarted', () => {
      this.roundMistakes = [];
    });
  }

  /**
   * Mistakes made during the hand just played.
   * @returns {Array} Mistake records, oldest first
   */
  getRoundMistakes() {
    return this.roundMistakes;
  }

  /**
   * Fold every face-up card now on the table into the count.
   * Safe to call repeatedly - each card is only ever counted once.
   */
  syncCount() {
    const hands = [
      ...this.game.players.flatMap(player => player.hands),
      ...this.game.dealer.hands
    ];

    let changed = false;

    hands.forEach(hand => {
      hand.cards.forEach(card => {
        // The hole card must not be counted until it is actually turned over
        if (!card.faceUp || this.countedCards.has(card)) {
          return;
        }

        this.countedCards.add(card);
        this.engine.trackCard(card);
        changed = true;
      });
    });

    // Anchor decks-remaining to the real shoe instead of inferring it
    const decksRemaining = Math.max(0.25, this.game.deck.getCount() / 52);
    this.engine.counter.setDecksRemaining(decksRemaining);
    this.engine.deviationEngine.counter.setDecksRemaining(decksRemaining);

    if (changed) {
      this._emit('countChanged', this.getCount());
    }

    return this.getCount();
  }

  /**
   * Current count information
   * @returns {Object} Running count, true count, decks left and penetration
   */
  getCount() {
    const decksRemaining = this.game.deck.getCount() / 52;
    const totalDecks = this.game.options.numberOfDecks;

    return {
      running: this.engine.getRunningCount(),
      true: this.engine.getTrueCount(),
      decksRemaining: Math.round(decksRemaining * 100) / 100,
      penetration: Math.round((1 - decksRemaining / totalDecks) * 100),
      advantage: Math.round(this.engine.getEstimatedAdvantage() * 100) / 100,
      system: this.options.countingSystem
    };
  }

  /**
   * What the player should do with the hand currently in play.
   * @returns {Object|null} Advice, or null when no hand is awaiting a decision
   */
  getAdvice() {
    const hand = this.game.currentHand();
    const upCard = this.game.dealer.getUpCard();

    if (!hand || !upCard || this.game.gamePhase !== 'playerTurn') {
      return null;
    }

    const actions = this.game.getAvailableActions();

    const advice = this.engine.getOptimalPlay(hand, upCard, {
      allowSurrender: actions.canSurrender,
      allowDouble: actions.canDouble,
      allowSplit: actions.canSplit
    });

    // The engine can recommend a play the table rules don't currently permit
    advice.optimalPlay = this._legalise(advice.optimalPlay, actions);
    advice.basicStrategy = this._legalise(advice.basicStrategy, actions);

    // Keep a readable form of the hand for the post-hand review
    advice.handText = hand.cards.map(card => card.rank).join('+');

    return advice;
  }

  /**
   * Fall back to the best legal alternative when the ideal play isn't available.
   * @private
   */
  _legalise(play, actions) {
    const permitted = {
      hit: actions.canHit,
      stand: actions.canStand,
      double: actions.canDouble,
      split: actions.canSplit,
      surrender: actions.canSurrender
    };

    if (permitted[play]) {
      return play;
    }

    // Doubling and surrendering both degrade to hitting; splitting degrades
    // to playing the hand straight.
    if (play === 'double') return actions.canHit ? 'hit' : 'stand';
    if (play === 'surrender') return actions.canHit ? 'hit' : 'stand';
    if (play === 'split') return actions.canHit ? 'hit' : 'stand';

    return actions.canStand ? 'stand' : 'hit';
  }

  /**
   * Whether insurance is mathematically worth taking right now
   * @returns {boolean} True at a true count of +3 or better
   */
  shouldTakeInsurance() {
    return this.engine.shouldTakeInsurance();
  }

  /**
   * Recommended wager for the next hand, given the count
   * @param {number} bankroll - The player's current bankroll
   * @returns {Object} Recommended bet plus the reasoning behind it
   */
  getBetRecommendation(bankroll) {
    if (typeof bankroll === 'number') {
      this.engine.updateBankroll(bankroll);
    }

    const count = this.getCount();
    const raw = this.engine.getOptimalBet();

    // Clamp to the table limits and to what the player can actually cover
    const bet = Math.max(
      this.options.minBet,
      Math.min(this.options.maxBet, Math.floor(raw / this.options.minBet) * this.options.minBet || this.options.minBet)
    );

    return {
      amount: Math.min(bet, bankroll || bet),
      units: Math.round((bet / this.options.minBet) * 10) / 10,
      trueCount: count.true,
      advantage: count.advantage,
      reason: count.true >= 2
        ? `True count +${count.true} - press the bet`
        : count.true <= -1
          ? `True count ${count.true} - sit at the minimum`
          : 'Neutral count - flat bet'
    };
  }

  /**
   * Grade the action the player just chose against the recommended play.
   * @param {string} action - What the player did
   * @param {Object} advice - The advice captured *before* the action
   * @returns {Object} Whether it was correct, and what was better if not
   */
  recordDecision(action, advice) {
    if (!advice) {
      return { correct: true, expected: null };
    }

    const expected = advice.optimalPlay;
    const correct = action === expected;

    this.stats.decisions++;
    if (correct) {
      this.stats.correctDecisions++;
    } else {
      const mistake = {
        kind: 'play',
        hand: advice.hand,
        handText: advice.handText || null,
        dealerUpCard: advice.dealerUpCard,
        played: action,
        expected,
        trueCount: advice.trueCount,
        wasDeviation: advice.isDeviation,
        explanation: this._explain(advice, action, expected)
      };

      this.stats.mistakes.push(mistake);
      this.roundMistakes.push(mistake);

      // Keep the mistake log bounded
      if (this.stats.mistakes.length > 50) {
        this.stats.mistakes.shift();
      }
    }

    // Track deviation plays separately - they're the hard part
    if (advice.isDeviation) {
      this.stats.deviationsSeen++;
      if (correct) {
        this.stats.deviationsHit++;
      }
    }

    const result = {
      correct,
      expected,
      played: action,
      wasDeviation: advice.isDeviation,
      description: advice.deviationDescription
    };

    this._emit('decisionGraded', result);
    return result;
  }

  /**
   * Explain in one sentence why the recommended play was right.
   * @private
   */
  _explain(advice, played, expected) {
    if (advice.isDeviation && advice.deviationDescription) {
      return `At true count ${signedCount(advice.trueCount)} this is an index play: ` +
        `${advice.deviationDescription}. Basic strategy alone would say ${advice.basicStrategy}.`;
    }

    const hand = advice.hand;
    const up = advice.dealerUpCard;

    if (expected === 'split') {
      return `A pair against ${up} plays better as two hands than one.`;
    }
    if (expected === 'double') {
      return `${hand} against ${up} is a favourable spot, so get more money in while you can.`;
    }
    if (expected === 'surrender') {
      return `${hand} against ${up} loses often enough that reclaiming half the bet beats playing it out.`;
    }
    if (expected === 'stand' && played === 'hit') {
      return `${hand} against ${up} busts too often — let the dealer take the risk.`;
    }
    if (expected === 'hit' && played === 'stand') {
      return `${hand} against ${up} loses more by standing than the bust risk costs you.`;
    }

    return `Basic strategy for ${hand} against ${up} is ${expected}.`;
  }

  /**
   * Grade the wager against the count-derived ramp.
   * @param {number} amount - What the player bet
   * @param {number} bankroll - Bankroll at the time of the bet
   * @returns {Object} Grade, including the recommended amount
   */
  recordBet(amount, bankroll) {
    const recommended = this.getBetRecommendation(bankroll);

    // One betting unit of slack - the ramp is a guide, not a lookup table
    const tolerance = Math.max(this.options.minBet, recommended.amount * 0.25);
    const correct = Math.abs(amount - recommended.amount) <= tolerance;

    this.stats.betsGraded++;
    if (correct) {
      this.stats.betsCorrect++;
    } else {
      const mistake = {
        kind: 'bet',
        played: amount,
        expected: recommended.amount,
        trueCount: recommended.trueCount,
        wasDeviation: false,
        explanation: amount > recommended.amount
          ? `Overbet at true count ${signedCount(recommended.trueCount)} — the edge isn't there yet.`
          : `Underbet at true count ${signedCount(recommended.trueCount)} — this is where the money is made.`
      };

      this.stats.mistakes.push(mistake);
      this.roundMistakes.push(mistake);
      if (this.stats.mistakes.length > 50) this.stats.mistakes.shift();
    }

    const result = { correct, expected: recommended.amount, played: amount, ...recommended };
    this._emit('betGraded', result);
    return result;
  }

  /**
   * Grade a count audit - the player typing what they think the running count is.
   * @param {number} entered - The player's answer
   * @returns {Object} Whether it matched, and by how much it was off
   */
  recordCountAudit(entered) {
    const actual = this.engine.getRunningCount();
    const off = entered - actual;
    const correct = off === 0;

    this.stats.auditsTaken++;
    if (correct) this.stats.auditsCorrect++;

    const result = { correct, entered, actual, off };
    this._emit('auditGraded', result);
    return result;
  }

  /**
   * Accuracy figures for the session
   * @returns {Object} Decision, deviation, bet and audit accuracy
   */
  getStats() {
    const {
      decisions, correctDecisions, deviationsSeen, deviationsHit,
      betsGraded, betsCorrect, auditsTaken, auditsCorrect
    } = this.stats;

    const pct = (hit, total) => (total > 0 ? Math.round((hit / total) * 100) : null);

    return {
      ...this.stats,
      accuracy: pct(correctDecisions, decisions),
      deviationAccuracy: pct(deviationsHit, deviationsSeen),
      betAccuracy: pct(betsCorrect, betsGraded),
      auditAccuracy: pct(auditsCorrect, auditsTaken)
    };
  }

  /**
   * Clear session accuracy figures without touching the count
   */
  resetStats() {
    this.stats = this._emptyStats();
  }

  /**
   * Switch counting system mid-session; this necessarily restarts the count.
   * @param {string} system - HI_LO, KO or OMEGA_II
   * @returns {boolean} True if the system was recognised
   */
  setCountingSystem(system) {
    if (!this.engine.changeCountingSystem(system)) {
      return false;
    }

    this.options.countingSystem = system;
    this.countedCards = new WeakSet();
    this.syncCount();
    this._emit('countReset', {});
    return true;
  }

  /** Subscribe to a trainer event */
  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  }

  /** @private */
  _emit(event, data) {
    (this.listeners[event] || []).forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`Trainer listener failed for ${event}:`, error);
      }
    });
  }
}

export default Trainer;
