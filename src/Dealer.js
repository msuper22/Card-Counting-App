/**
 * Dealer.js
 * 
 * This class represents the dealer in a card game.
 * It extends the Player class with dealer-specific logic.
 */

import Player from './Player.js';

class Dealer extends Player {
  /**
   * Create a new dealer
   * @param {string} name - Dealer's name (default: 'Dealer')
   * @param {Object} options - Additional dealer options
   */
  constructor(name = 'Dealer', options = {}) {
    // Initialize dealer with infinite bankroll and dealer-specific options
    super(name, Infinity, {
      isDealer: true,
      autoPlay: true,
      ...options
    });

    this.holeCardPosition = 1; // Position of the hole card (second card)
    this.holeCardRevealed = false;
  }

  /**
   * Deal cards to a player
   * @param {Player} player - The player to deal to
   * @param {number} handIndex - The index of the hand to deal to
   * @param {number} cardCount - The number of cards to deal
   * @param {boolean} faceUp - Whether to deal cards face up
   */
  dealToPlayer(player, handIndex, cardCount, faceUp = true) {
    if (!this.deck) {
      throw new Error('Dealer has no deck to deal from');
    }

    const hand = player.hands[handIndex];
    if (!hand) {
      throw new Error(`Hand with index ${handIndex} not found`);
    }

    const cards = this.deck.dealCards(cardCount, faceUp);
    hand.addCards(cards);
  }

  /**
   * Set the deck for the dealer to use
   * @param {Deck} deck - The deck to use
   */
  setDeck(deck) {
    this.deck = deck;
  }

  /**
   * Deal initial blackjack hands
   * @param {Player[]} players - The players to deal to
   */
  dealInitialHands(players) {
    if (!this.deck) {
      throw new Error('Dealer has no deck to deal from');
    }

    // Deal first card to each player face up
    players.forEach(player => {
      this.dealToPlayer(player, 0, 1, true);
    });

    // Deal first card to dealer face up
    const dealerFirstCard = this.deck.dealCard(true);
    this.hands[0].addCard(dealerFirstCard);

    // Deal second card to each player face up
    players.forEach(player => {
      this.dealToPlayer(player, 0, 1, true);
    });

    // Deal hole card to dealer face down
    const dealerSecondCard = this.deck.dealCard(false);
    this.hands[0].addCard(dealerSecondCard);
    this.holeCardRevealed = false;
  }

  /**
   * Reveal the dealer's hole card
   * @returns {Card} The hole card
   */
  revealHoleCard() {
    if (this.hands[0].cards.length <= this.holeCardPosition) {
      return null;
    }

    const holeCard = this.hands[0].cards[this.holeCardPosition];
    holeCard.setFaceUp(true);
    this.holeCardRevealed = true;
    return holeCard;
  }

  /**
   * Check if the dealer has blackjack
   * @returns {boolean} True if the dealer has blackjack
   */
  hasBlackjack() {
    // Peeking must not flip the hole card face up - the dealer looks at it,
    // the table doesn't. Revealing is the caller's decision.
    return this.hands[0].hasBlackjack();
  }

  /**
   * Play the dealer's hand according to house rules
   * @param {Object} houseRules - The house rules to follow
   * @returns {number} The final value of the dealer's hand
   */
  playHand(houseRules = { hitSoft17: true }) {
    // First reveal the hole card if not already revealed
    if (!this.holeCardRevealed) {
      this.revealHoleCard();
    }

    const hand = this.hands[0];

    // Dealer plays according to fixed rules
    let keepPlaying = true;

    while (keepPlaying) {
      const value = hand.getValue();
      const isSoft = hand.isSoft();

      // Dealer stands on hard 17 or higher
      if (value >= 17 && (!isSoft || !houseRules.hitSoft17)) {
        keepPlaying = false;
      }
      // Dealer hits on soft 17 if house rules specify
      else if (value === 17 && isSoft && houseRules.hitSoft17) {
        const card = this.deck.dealCard(true);
        hand.addCard(card);
      }
      // Dealer hits on 16 or lower
      else if (value <= 16) {
        const card = this.deck.dealCard(true);
        hand.addCard(card);
      } else {
        keepPlaying = false;
      }
    }

    return hand.getValue();
  }

  /**
   * Get the dealer's face-up card
   * @returns {Card} The dealer's face-up card
   */
  getUpCard() {
    if (this.hands[0].cards.length === 0) {
      return null;
    }

    return this.hands[0].cards[0]; // First card is always face up
  }

  /**
   * Calculate the result of a player's hand versus the dealer's hand
   * @param {Hand} playerHand - The player's hand
   * @returns {string} The result ('win', 'lose', 'push', 'blackjack')
   */
  determineResult(playerHand) {
    const dealerHand = this.hands[0];
    const dealerValue = dealerHand.getValue();
    const playerValue = playerHand.getValue();

    const dealerHasBlackjack = dealerHand.hasBlackjack();
    const playerHasBlackjack = playerHand.hasBlackjack();

    // Both have blackjack
    if (dealerHasBlackjack && playerHasBlackjack) {
      return 'push';
    }

    // Player has blackjack, dealer doesn't
    if (playerHasBlackjack) {
      return 'blackjack';
    }

    // Dealer has blackjack, player doesn't
    if (dealerHasBlackjack) {
      return 'lose';
    }

    // Player busts
    if (playerValue > 21) {
      return 'lose';
    }

    // Dealer busts
    if (dealerValue > 21) {
      return 'win';
    }

    // Compare values
    if (playerValue > dealerValue) {
      return 'win';
    } else if (playerValue < dealerValue) {
      return 'lose';
    } else {
      return 'push';
    }
  }

  /**
   * Reset the dealer for a new round
   */
  resetForNewRound() {
    super.resetForNewRound();
    this.holeCardRevealed = false;
  }

  /**
   * Check if an insurance bet is appropriate based on the up card
   * @returns {boolean} True if insurance should be offered
   */
  shouldOfferInsurance() {
    const upCard = this.getUpCard();
    return upCard && upCard.rank === 'ace';
  }

  /**
   * Check if the dealer should peek for blackjack
   * @returns {boolean} True if the dealer should peek
   */
  shouldPeekForBlackjack() {
    const upCard = this.getUpCard();
    if (!upCard) {
      return false;
    }

    return upCard.rank === 'ace' ||
      upCard.rank === '10' ||
      upCard.rank === 'jack' ||
      upCard.rank === 'queen' ||
      upCard.rank === 'king';
  }

  /**
   * Process insurance bets after checking for dealer blackjack
   * @param {Player[]} players - The players who placed insurance bets
   */
  processInsurance(players) {
    const hasBlackjack = this.hasBlackjack();

    players.forEach(player => {
      if (player.insuranceBet > 0) {
        if (hasBlackjack) {
          player.winInsurance();
        } else {
          player.loseInsurance();
        }
      }
    });

    return hasBlackjack;
  }
}

export default Dealer;