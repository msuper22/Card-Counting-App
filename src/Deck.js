/**
 * Deck.js
 * 
 * This class represents a deck of playing cards.
 * It provides methods for creating, shuffling, and dealing cards.
 */

import Card from './Card.js';
import { SUITS, RANKS, CARDS } from './constants.js';

class Deck {
  /**
   * Create a new deck of cards
   * @param {number} numberOfDecks - Number of standard decks to include (default: 1)
   * @param {boolean} includeJokers - Whether to include jokers in the deck (default: false)
   */
  constructor(numberOfDecks = 1, includeJokers = false) {
    this.cards = [];
    this.discardPile = [];
    this.numberOfDecks = numberOfDecks;
    this.includeJokers = includeJokers;
    this.initialize();
  }

  /**
   * Initialize the deck with cards
   * @private
   */
  initialize() {
    this.cards = [];
    
    // Add cards for each deck
    for (let deckIndex = 0; deckIndex < this.numberOfDecks; deckIndex++) {
      const offset = deckIndex * 52;
      
      // Create Card instances from the CARDS array in constants.js
      CARDS.forEach(cardData => {
        const newCard = new Card(
          cardData.id + offset,
          cardData.suit,
          cardData.rank
        );
        this.cards.push(newCard);
      });
    }
    
    // Add jokers if requested
    if (this.includeJokers) {
      const jokerId = this.cards.length + 1;
      this.cards.push(new Card(jokerId, 'joker', 'red'));
      this.cards.push(new Card(jokerId + 1, 'joker', 'black'));
    }
  }

  /**
   * Shuffle the deck using the Fisher-Yates algorithm
   */
  shuffle() {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  /**
   * Deal a card from the top of the deck
   * @param {boolean} faceUp - Whether the card should be dealt face up (default: true)
   * @returns {Card|null} The card that was dealt, or null if the deck is empty
   */
  dealCard(faceUp = true) {
    if (this.isEmpty()) {
      return null;
    }
    
    const card = this.cards.pop();
    card.setFaceUp(faceUp);
    return card;
  }

  /**
   * Deal multiple cards from the deck
   * @param {number} count - Number of cards to deal
   * @param {boolean} faceUp - Whether the cards should be dealt face up
   * @returns {Card[]} An array of the cards that were dealt
   */
  dealCards(count, faceUp = true) {
    const cards = [];
    for (let i = 0; i < count; i++) {
      const card = this.dealCard(faceUp);
      if (card) {
        cards.push(card);
      } else {
        break;
      }
    }
    return cards;
  }

  /**
   * Add a card to the discard pile
   * @param {Card} card - The card to discard
   */
  discard(card) {
    this.discardPile.push(card);
  }

  /**
   * Add multiple cards to the discard pile
   * @param {Card[]} cards - The cards to discard
   */
  discardMultiple(cards) {
    this.discardPile.push(...cards);
  }

  /**
   * Shuffle the discard pile back into the deck
   */
  reshuffleDiscards() {
    this.cards.push(...this.discardPile);
    this.discardPile = [];
    this.shuffle();
  }

  /**
   * Check if the deck is empty
   * @returns {boolean} True if there are no cards left in the deck
   */
  isEmpty() {
    return this.cards.length === 0;
  }

  /**
   * Get the number of cards remaining in the deck
   * @returns {number} The number of cards in the deck
   */
  getCount() {
    return this.cards.length;
  }

  /**
   * Get the number of cards in the discard pile
   * @returns {number} The number of cards in the discard pile
   */
  getDiscardCount() {
    return this.discardPile.length;
  }

  /**
   * Reset the deck to its initial state
   */
  reset() {
    this.discardPile = [];
    this.initialize();
    this.shuffle();
  }

  /**
   * Draw a specific card from the deck by ID
   * @param {number} id - The ID of the card to draw
   * @returns {Card|null} The card with the specified ID, or null if not found
   */
  drawCardById(id) {
    const index = this.cards.findIndex(card => card.id === id);
    if (index === -1) {
      return null;
    }
    
    return this.cards.splice(index, 1)[0];
  }
}

export default Deck;