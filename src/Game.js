/**
 * Game.js
 * 
 * This class serves as the main game controller for a blackjack game.
 * It orchestrates the interactions between players, dealer, deck, and game rules.
 */

import Deck from './Deck.js';
import Player from './Player.js';
import Dealer from './Dealer.js';
import { GAME } from './constants.js';

class Game {
  /**
   * Create a new game
   * @param {Object} options - Game configuration options
   */
  constructor(options = {}) {
    // Default game configuration
    this.options = {
      numberOfDecks: 6,
      reshuffleThreshold: 0.25, // Reshuffle when 25% of cards remain
      maxPlayers: GAME.MAX_PLAYERS,
      tableMinimum: 5,
      tableMaximum: 500,
      blackjackPayout: 1.5, // 3:2 payout for blackjack
      allowSurrender: true,
      allowDoubleAfterSplit: true,
      allowResplitAces: false,
      hitSoft17: true, // Dealer hits on soft 17
      ...options
    };
    
    // Initialize game state
    this.players = [];
    this.dealer = new Dealer('Dealer', { hitSoft17: this.options.hitSoft17 });
    this.deck = new Deck(this.options.numberOfDecks);
    this.dealer.setDeck(this.deck);
    this.currentPlayerIndex = 0;
    this.currentHandIndex = 0;
    this.gamePhase = 'betting'; // betting, dealing, playerTurn, dealerTurn, payout
    this.roundNumber = 0;
    this.eventListeners = {};
  }

  /**
   * Start a new game
   */
  startGame() {
    this.deck.shuffle();
    this.roundNumber = 0;
    this.resetPlayersForNewGame();
    this.startNewRound();
  }

  /**
   * Add a player to the game
   * @param {string} name - The player's name
   * @param {number} bankroll - The player's starting bankroll
   * @param {Object} options - Additional player options
   * @returns {Player} The newly added player
   */
  addPlayer(name, bankroll = 1000, options = {}) {
    if (this.players.length >= this.options.maxPlayers) {
      throw new Error(`Maximum number of players (${this.options.maxPlayers}) reached`);
    }
    
    const player = new Player(name, bankroll, options);
    this.players.push(player);
    return player;
  }

  /**
   * Remove a player from the game
   * @param {number} playerIndex - The index of the player to remove
   * @returns {Player|null} The removed player, or null if not found
   */
  removePlayer(playerIndex) {
    if (playerIndex < 0 || playerIndex >= this.players.length) {
      return null;
    }
    
    const removedPlayer = this.players.splice(playerIndex, 1)[0];
    
    // Adjust current player index if necessary
    if (this.currentPlayerIndex >= this.players.length) {
      this.currentPlayerIndex = Math.max(0, this.players.length - 1);
    }
    
    return removedPlayer;
  }

  /**
   * Start a new round of the game
   */
  startNewRound() {
    // Send the previous round's cards to the discard tray before anything else,
    // otherwise the shoe just drains and never comes back.
    this.collectCardsToDiscard();

    // Check if we've dealt past the cut card
    const deckSizeThreshold = this.options.numberOfDecks * 52 * this.options.reshuffleThreshold;
    if (this.deck.getCount() < deckSizeThreshold) {
      this.deck.reshuffleDiscards();
      // A fresh shoe means a fresh count - a trainer that doesn't reset here
      // teaches the wrong habit.
      this.players.forEach(player => { player.runningCount = 0; });
      this.triggerEvent('deckReshuffled');
    }

    // Reset all players and dealer for new round
    this.resetForNewRound();

    // Increment round counter
    this.roundNumber++;

    // Move to betting phase
    this.gamePhase = 'betting';
    this.triggerEvent('bettingPhaseStarted');
  }

  /**
   * Move every card currently on the table into the deck's discard pile.
   */
  collectCardsToDiscard() {
    const hands = [
      ...this.players.flatMap(player => player.hands),
      ...this.dealer.hands
    ];

    hands.forEach(hand => {
      this.deck.discardMultiple(hand.removeAllCards());
    });
  }

  /**
   * Place a bet for a player
   * @param {number} playerIndex - The index of the player
   * @param {number} amount - The bet amount
   * @returns {boolean} True if the bet was placed successfully
   */
  placeBet(playerIndex, amount) {
    if (this.gamePhase !== 'betting') {
      return false;
    }
    
    const player = this.players[playerIndex];
    if (!player) {
      return false;
    }
    
    // Ensure bet is within table limits
    if (amount < this.options.tableMinimum || amount > this.options.tableMaximum) {
      return false;
    }
    
    const success = player.placeBet(amount);
    
    // Check if all players have bet
    if (success && this.allPlayersBetted()) {
      this.dealInitialCards();
    }
    
    return success;
  }

  /**
   * Check if all players have placed bets
   * @returns {boolean} True if all players have placed bets
   */
  allPlayersBetted() {
    return this.players.every(player => player.currentBet > 0 || !player.isActive);
  }

  /**
   * Deal initial cards to all players and dealer
   */
  dealInitialCards() {
    this.gamePhase = 'dealing';
    this.triggerEvent('dealingPhaseStarted');
    
    // Deal cards to all players and dealer
    this.dealer.dealInitialHands(this.players);
    this.triggerEvent('initialCardsDealt', { state: this.getGameState() });

    // Insurance is offered against an ace *before* the dealer peeks
    if (this.dealer.shouldOfferInsurance()) {
      this.gamePhase = 'insurance';
      this.triggerEvent('insuranceOffered', {
        player: this.players[0],
        cost: this.players[0] ? this.players[0].currentBet / 2 : 0
      });
      return; // Wait for the insurance decision
    }

    // Against a ten the dealer peeks silently; no insurance is on offer
    if (this.dealer.shouldPeekForBlackjack() && this.dealer.hasBlackjack()) {
      this.dealer.revealHoleCard();
      this.triggerEvent('dealerBlackjack');
      this.processEndOfRound();
      return;
    }

    // Start player turns
    this.startPlayerTurns();
  }

  /**
   * Start the player turn phase
   */
  startPlayerTurns() {
    this.gamePhase = 'playerTurn';
    this.currentPlayerIndex = 0;
    this.currentHandIndex = 0;

    // Skip inactive players before announcing whose turn it is
    this.moveToNextActivePlayer();

    if (this.allPlayerTurnsCompleted()) {
      this.startDealerTurn();
      return;
    }

    // A player dealt a natural has nothing to decide
    const hand = this.currentHand();
    if (hand && hand.hasBlackjack()) {
      hand.isComplete = true;
      this.triggerEvent('playerTurnPhaseStarted', {
        player: this.currentPlayer(),
        handIndex: this.currentHandIndex,
        actions: this.getAvailableActions()
      });
      this.moveToNextHand();

      if (this.allPlayerTurnsCompleted()) {
        this.startDealerTurn();
      }
      return;
    }

    this.triggerEvent('playerTurnPhaseStarted', {
      player: this.currentPlayer(),
      handIndex: this.currentHandIndex,
      actions: this.getAvailableActions()
    });
  }

  /**
   * Place an insurance bet for a player
   * @param {number} playerIndex - The index of the player
   * @param {boolean} takesInsurance - Whether the player takes insurance
   * @returns {boolean} True if the insurance was processed successfully
   */
  placeInsurance(playerIndex, takesInsurance) {
    if (this.gamePhase !== 'insurance') {
      return false;
    }
    
    const player = this.players[playerIndex];
    if (!player) {
      return false;
    }
    
    let success = true;
    
    if (takesInsurance) {
      const insuranceAmount = player.currentBet / 2;
      success = player.placeInsurance(insuranceAmount);
    }
    
    // Check if all insurance decisions have been made
    if (this.allInsuranceDecisionsMade()) {
      const dealerHasBlackjack = this.dealer.processInsurance(this.players);

      this.triggerEvent('insuranceResolved', {
        tookInsurance: takesInsurance,
        dealerHasBlackjack,
        player
      });

      if (dealerHasBlackjack) {
        // Dealer has blackjack, round ends
        this.dealer.revealHoleCard();
        this.triggerEvent('dealerBlackjack');
        this.processEndOfRound();
      } else {
        // Continue with player turns
        this.startPlayerTurns();
      }
    }

    return success;
  }

  /**
   * Check if all players have made insurance decisions
   * @returns {boolean} True if all players have made insurance decisions
   */
  allInsuranceDecisionsMade() {
    // In a real implementation, track which players have decided
    // For simplicity, we'll assume all decisions are made
    return true;
  }

  /**
   * Process a player action during their turn
   * @param {string} action - The action to take ('hit', 'stand', 'double', 'split', 'surrender')
   * @returns {boolean} True if the action was processed successfully
   */
  playerAction(action) {
    if (this.gamePhase !== 'playerTurn') {
      return false;
    }
    
    const player = this.currentPlayer();
    const hand = this.currentHand();
    
    if (!player || !hand) {
      return false;
    }
    
    const handIndex = this.currentHandIndex;
    const actions = this.getAvailableActions();
    let success = true;

    switch (action) {
      case 'hit':
        if (!actions.canHit) return false;
        this.dealCardToCurrentHand();
        this.triggerEvent('playerHit', { player, handIndex });

        if (hand.isBust()) {
          this.triggerEvent('playerBust', { player, handIndex });
          this.moveToNextHand();
        } else if (hand.getValue() === 21) {
          // Nothing left to decide on 21
          this.moveToNextHand();
        }
        break;

      case 'stand':
        if (!actions.canStand) return false;
        this.triggerEvent('playerStand', { player, handIndex });
        this.moveToNextHand();
        break;

      case 'double':
        if (!actions.canDouble) return false;
        success = player.doubleBet(handIndex);

        if (success) {
          this.dealCardToCurrentHand();
          this.triggerEvent('playerDouble', { player, handIndex });

          if (hand.isBust()) {
            this.triggerEvent('playerBust', { player, handIndex });
          }
          // A doubled hand always ends after exactly one card
          this.moveToNextHand();
        }
        break;

      case 'split': {
        if (!actions.canSplit) return false;
        const wasAces = hand.cards[0].rank === 'ace';
        success = player.splitHand(handIndex);

        if (success) {
          // Draw one card onto each of the two resulting hands
          this.dealCardToHand(player, handIndex);
          this.dealCardToHand(player, handIndex + 1);
          this.triggerEvent('playerSplit', { player, handIndex });

          // Split aces receive a single card each and are done
          if (wasAces && !this.options.allowResplitAces) {
            this.moveToNextHand();
            this.moveToNextHand();
          }
        }
        break;
      }

      case 'surrender':
        if (!actions.canSurrender) return false;

        // Surrender forfeits half of this hand's bet, not the player's whole round
        player.bankroll += hand.bet / 2;
        hand.isSurrendered = true;
        hand.result = 'surrender';
        hand.payout = hand.bet / 2;

        this.triggerEvent('playerSurrender', { player, handIndex });
        this.moveToNextHand();
        break;

      default:
        success = false;
    }

    // Check if all players have completed their turns
    if (this.gamePhase === 'playerTurn' && this.allPlayerTurnsCompleted()) {
      this.startDealerTurn();
    } else if (this.gamePhase === 'playerTurn') {
      // Let the UI re-read which actions are legal now
      this.triggerEvent('turnChanged', {
        player: this.currentPlayer(),
        handIndex: this.currentHandIndex,
        actions: this.getAvailableActions()
      });
    }

    return success;
  }

  /**
   * Work out which actions are legal for the hand currently in play.
   * This is the single source of truth - the UI must not duplicate these rules.
   * @returns {Object} Flags for each possible action
   */
  getAvailableActions() {
    const player = this.currentPlayer();
    const hand = this.currentHand();

    const actions = {
      canHit: false,
      canStand: false,
      canDouble: false,
      canSplit: false,
      canSurrender: false,
      canInsure: false
    };

    if (this.gamePhase === 'insurance') {
      const insurer = this.players[this.currentPlayerIndex] || this.players[0];
      actions.canInsure = Boolean(insurer) && insurer.canAfford('insurance');
      return actions;
    }

    if (this.gamePhase !== 'playerTurn' || !player || !hand || hand.isSurrendered) {
      return actions;
    }

    const isFreshHand = hand.cards.length === 2;
    const value = hand.getValue();

    actions.canHit = value < 21;
    actions.canStand = true;

    // Double only on the opening two cards, funds permitting
    actions.canDouble = isFreshHand &&
      player.bankroll >= hand.bet &&
      (!hand.isFromSplit || this.options.allowDoubleAfterSplit);

    // Split a pair if we're under the resplit cap and can cover another bet
    const maxHands = (this.options.maxSplits || 3) + 1;
    actions.canSplit = isFreshHand &&
      hand.canSplit() &&
      player.hands.length < maxHands &&
      player.bankroll >= hand.bet &&
      (hand.cards[0].rank !== 'ace' || this.options.allowResplitAces || !hand.isFromSplit);

    // Late surrender: opening two cards of an unsplit hand only
    actions.canSurrender = this.options.allowSurrender &&
      isFreshHand &&
      !hand.isFromSplit &&
      player.hands.length === 1;

    return actions;
  }
  
  /**
   * Deal a card to the current hand
   */
  dealCardToCurrentHand() {
    const player = this.currentPlayer();
    const hand = this.currentHand();
    
    if (player && hand) {
      this.dealer.dealToPlayer(player, this.currentHandIndex, 1, true);
    }
  }

  /**
   * Deal a card to a specific hand
   * @param {Player} player - The player to deal to
   * @param {number} handIndex - The index of the hand to deal to
   */
  dealCardToHand(player, handIndex) {
    if (player && player.hands[handIndex]) {
      this.dealer.dealToPlayer(player, handIndex, 1, true);
    }
  }

  /**
   * Get the current player
   * @returns {Player|null} The current player
   */
  currentPlayer() {
    return this.players[this.currentPlayerIndex] || null;
  }

  /**
   * Get the current hand
   * @returns {Hand|null} The current hand
   */
  currentHand() {
    const player = this.currentPlayer();
    return player ? player.hands[this.currentHandIndex] || null : null;
  }

  /**
   * Move to the next hand or player
   */
  moveToNextHand() {
    const player = this.currentPlayer();

    if (!player) {
      return;
    }

    // The hand we're leaving is done being acted on
    const finishedHand = player.hands[this.currentHandIndex];
    if (finishedHand) {
      finishedHand.isComplete = true;
    }

    // Find the next hand that still needs a decision. Split hands can be
    // inserted mid-list, so scan rather than just incrementing.
    const nextIndex = player.hands.findIndex(
      (hand, index) => index > this.currentHandIndex && !hand.isComplete && !hand.isBust()
    );

    if (nextIndex !== -1) {
      this.currentHandIndex = nextIndex;
      this.triggerEvent('nextHand', { player, handIndex: this.currentHandIndex });
    } else {
      this.moveToNextPlayer();
    }
  }

  /**
   * Move to the next active player
   */
  moveToNextPlayer() {
    this.currentPlayerIndex++;
    this.currentHandIndex = 0;
    
    // Skip inactive players
    this.moveToNextActivePlayer();
    
    const player = this.currentPlayer();
    if (player) {
      this.triggerEvent('nextPlayer', { player });
    } else {
      // No more active players, move to dealer turn
      this.startDealerTurn();
    }
  }

  /**
   * Move to the next active player, skipping inactive ones
   */
  moveToNextActivePlayer() {
    while (
      this.currentPlayerIndex < this.players.length && 
      (!this.players[this.currentPlayerIndex].isActive || 
       this.players[this.currentPlayerIndex].currentBet === 0)
    ) {
      this.currentPlayerIndex++;
    }
  }

  /**
   * Check if all player turns are completed
   * @returns {boolean} True if all player turns are completed
   */
  allPlayerTurnsCompleted() {
    return this.currentPlayerIndex >= this.players.length;
  }

  /**
   * Start the dealer's turn
   */
  startDealerTurn() {
    this.gamePhase = 'dealerTurn';
    this.triggerEvent('dealerTurnPhaseStarted');
    
    // Reveal the dealer's hole card
    this.dealer.revealHoleCard();
    
    // The dealer only draws if a hand is still live enough to beat.
    // Busted, surrendered and natural-blackjack hands are already settled.
    const activePlayersRemain = this.players.some(player =>
      player.hands.some(hand =>
        hand.bet > 0 && !hand.isBust() && !hand.isSurrendered && !hand.hasBlackjack()
      )
    );
    
    if (activePlayersRemain) {
      // Dealer plays their hand
      const finalValue = this.dealer.playHand({ 
        hitSoft17: this.options.hitSoft17 
      });
      
      if (finalValue > 21) {
        this.triggerEvent('dealerBust');
      }
    }
    
    // Process the results
    this.processEndOfRound();
  }

  /**
   * Process the end of the round, determining winners and losers
   */
  processEndOfRound() {
    this.gamePhase = 'payout';

    // Settle every hand before announcing the phase, so listeners can read
    // the finished results straight off the game state.
    this.players.forEach((player) => {
      if (player.hands.every(hand => hand.bet === 0)) {
        return; // Player sat this round out
      }

      player.hands.forEach((hand, handIndex) => {
        // Surrendered hands were already paid out at half stake
        if (hand.isSurrendered) {
          return;
        }

        const result = this.dealer.determineResult(hand);

        switch (result) {
          case 'blackjack':
            player.winBet(this.options.blackjackPayout, handIndex);
            player.recordBlackjack();
            this.triggerEvent('playerWonBlackjack', { player, handIndex, hand });
            break;

          case 'win':
            player.winBet(1, handIndex);
            this.triggerEvent('playerWon', { player, handIndex, hand });
            break;

          case 'lose':
            player.loseBet(handIndex);
            this.triggerEvent('playerLost', { player, handIndex, hand });
            break;

          case 'push':
            player.pushBet(handIndex);
            this.triggerEvent('playerPush', { player, handIndex, hand });
            break;
        }
      });

      player.currentBet = 0;
      player.roundsPlayed++;
    });

    this.triggerEvent('payoutPhaseStarted', { results: this.getRoundResults() });

    // Start a new round or end the game
    this.triggerEvent('roundCompleted', {
      roundNumber: this.roundNumber,
      results: this.getRoundResults()
    });
  }

  /**
   * Summarise how every hand in the just-finished round settled
   * @returns {Array} One entry per player, each listing that player's hands
   */
  getRoundResults() {
    return this.players.map((player, playerIndex) => ({
      playerIndex,
      name: player.name,
      bankroll: player.bankroll,
      hands: player.hands.map((hand, handIndex) => ({
        handIndex,
        bet: hand.bet,
        result: hand.result,
        payout: hand.payout,
        net: hand.payout - hand.bet,
        value: hand.getValue(),
        blackjack: hand.hasBlackjack(),
        busted: hand.isBust(),
        surrendered: hand.isSurrendered
      }))
    }));
  }

  /**
   * Reset all players and dealer for a new round
   */
  resetForNewRound() {
    // Reset dealer
    this.dealer.resetForNewRound();
    
    // Reset all players
    this.players.forEach(player => {
      player.resetForNewRound();
      
      // Remove players who are out of money
      if (player.bankroll < this.options.tableMinimum) {
        player.isActive = false;
      } else {
        player.isActive = true;
      }
    });
  }

  /**
   * Reset all players for a new game
   */
  resetPlayersForNewGame() {
    this.players.forEach(player => {
      player.runningCount = 0;
      player.roundsPlayed = 0;
      player.roundsWon = 0;
      player.roundsLost = 0;
      player.roundsPushed = 0;
      player.blackjacks = 0;
      player.isActive = true;
    });
  }

  /**
   * Add an event listener
   * @param {string} event - The event name
   * @param {Function} callback - The callback function
   */
  addEventListener(event, callback) {
    if (!this.eventListeners[event]) {
      this.eventListeners[event] = [];
    }
    
    this.eventListeners[event].push(callback);
  }

  /**
   * Remove an event listener
   * @param {string} event - The event name
   * @param {Function} callback - The callback function to remove
   */
  removeEventListener(event, callback) {
    if (!this.eventListeners[event]) {
      return;
    }
    
    this.eventListeners[event] = this.eventListeners[event]
      .filter(cb => cb !== callback);
  }

  /**
   * Trigger an event
   * @param {string} event - The event name
   * @param {Object} data - Data to pass to the event listeners
   */
  triggerEvent(event, data = {}) {
    if (!this.eventListeners[event]) {
      return;
    }
    
    this.eventListeners[event].forEach(callback => {
      if (typeof callback === 'function') {
        try {
          callback({ ...data, event });
        } catch (error) {
          console.error(`Error in event listener for ${event}:`, error);
        }
      }
    });
  }

  /**
   * Get the current game state
   * @returns {Object} The current game state
   */
  getGameState() {
    const serializeCard = card => ({
      id: card.id,
      suit: card.suit,
      rank: card.rank,
      value: card.value,
      color: card.color,
      faceUp: card.faceUp
    });

    const dealerHand = this.dealer.hands[0];
    const upCard = this.dealer.getUpCard();

    return {
      players: this.players.map(player => ({
        name: player.name,
        bankroll: player.bankroll,
        currentBet: player.currentBet,
        insuranceBet: player.insuranceBet,
        runningCount: player.runningCount,
        hands: player.hands.map(hand => ({
          cards: hand.cards.map(serializeCard),
          value: hand.getValue(),
          hardValue: hand.getHardValue(),
          soft: hand.isSoft(),
          bet: hand.bet,
          blackjack: hand.hasBlackjack(),
          busted: hand.isBust(),
          doubled: hand.isDoubled,
          surrendered: hand.isSurrendered,
          fromSplit: hand.isFromSplit,
          complete: hand.isComplete,
          active: !hand.isComplete && !hand.isBust() && !hand.isSurrendered,
          result: hand.result,
          payout: hand.payout
        })),
        isActive: player.isActive
      })),
      dealer: {
        hand: dealerHand.cards.map(serializeCard),
        // Only score what the table can actually see while the hole card is down
        value: this.dealer.holeCardRevealed
          ? dealerHand.getValue()
          : dealerHand.cards.filter(card => card.faceUp)
              .reduce((sum, card) => sum + (card.rank === 'ace' ? 11 : card.value), 0),
        fullValue: dealerHand.getValue(),
        blackjack: dealerHand.hasBlackjack(),
        busted: dealerHand.isBust(),
        holeCardRevealed: this.dealer.holeCardRevealed,
        upCard: upCard ? serializeCard(upCard) : null
      },
      gamePhase: this.gamePhase,
      roundNumber: this.roundNumber,
      currentPlayerIndex: this.currentPlayerIndex,
      currentHandIndex: this.currentHandIndex,
      availableActions: this.getAvailableActions(),
      deckCount: this.deck.getCount(),
      discardCount: this.deck.getDiscardCount(),
      decksRemaining: this.deck.getCount() / 52,
      deckPercentRemaining: (this.deck.getCount() / (this.options.numberOfDecks * 52)) * 100
    };
  }
  
  /**
   * Update game options
   * @param {Object} options - New option values
   */
  updateOptions(options) {
    this.options = {
      ...this.options,
      ...options
    };
    
    // Update dealer options if hitSoft17 changed
    if (options.hitSoft17 !== undefined) {
      this.dealer.options.hitSoft17 = options.hitSoft17;
    }
  }
}

export default Game;