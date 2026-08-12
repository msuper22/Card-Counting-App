/**
 * Card.js
 * 
 * This class represents a playing card in a standard deck.
 * It provides methods for managing card properties and comparing cards.
 */

import { SUITS, RANKS, SUIT_TO_COLOR, RANK_TO_VALUE, COUNTING_SYSTEMS } from './constants.js';

class Card {
  /**
   * Create a new card
   * @param {number} id - Unique identifier for the card (1-52)
   * @param {string} suit - The card suit (hearts, diamonds, clubs, spades)
   * @param {string} rank - The card rank (ace, 2, 3, ..., queen, king)
   */
  constructor(id, suit, rank) {
    this.id = id;
    this.suit = suit;
    this.rank = rank;
    this.value = RANK_TO_VALUE[rank];
    this.color = SUIT_TO_COLOR[suit];
    this.faceUp = true;
    this.selected = false;
  }

  /**
   * Get the full name of the card
   * @returns {string} The card name (e.g., "Ace of Hearts")
   */
  getName() {
    // Capitalize the first letter of rank and suit for display
    const rankDisplay = this.rank.charAt(0).toUpperCase() + this.rank.slice(1);
    const suitDisplay = this.suit.charAt(0).toUpperCase() + this.suit.slice(1);
    return `${rankDisplay} of ${suitDisplay}`;
  }

  /**
   * Get the count value of this card in the specified counting system
   * @param {string} system - The name of the counting system (HI_LO, KO, OMEGA_II)
   * @returns {number} The count value of this card
   */
  getCountValue(system) {
    if (!COUNTING_SYSTEMS[system]) {
      throw new Error(`Unknown counting system: ${system}`);
    }
    return COUNTING_SYSTEMS[system][this.rank];
  }

  /**
   * Flip the card (face up becomes face down and vice versa)
   */
  flip() {
    this.faceUp = !this.faceUp;
  }

  /**
   * Set the face up state of the card
   * @param {boolean} isFaceUp - Whether the card should be face up
   */
  setFaceUp(isFaceUp) {
    this.faceUp = isFaceUp;
  }

  /**
   * Toggle the selected state of the card
   */
  toggleSelect() {
    this.selected = !this.selected;
  }

  /**
   * Set the selected state of the card
   * @param {boolean} isSelected - Whether the card should be selected
   */
  setSelected(isSelected) {
    this.selected = isSelected;
  }

  /**
   * Compare this card to another card by value
   * @param {Card} otherCard - The card to compare to
   * @returns {number} -1 if this card has lower value, 0 if equal, 1 if higher value
   */
  compareByValue(otherCard) {
    if (this.value < otherCard.value) return -1;
    if (this.value > otherCard.value) return 1;
    return 0;
  }

  /**
   * Check if this card is the same suit as another card
   * @param {Card} otherCard - The card to compare to
   * @returns {boolean} True if the cards are the same suit
   */
  isSameSuit(otherCard) {
    return this.suit === otherCard.suit;
  }

  /**
   * Check if this card is the same color as another card
   * @param {Card} otherCard - The card to compare to
   * @returns {boolean} True if the cards are the same color
   */
  isSameColor(otherCard) {
    return this.color === otherCard.color;
  }

  /**
   * Create a clone of this card
   * @returns {Card} A new card with the same properties
   */
  clone() {
    const newCard = new Card(this.id, this.suit, this.rank);
    newCard.faceUp = this.faceUp;
    newCard.selected = this.selected;
    return newCard;
  }

  /**
   * Create a card from a plain object
   * @param {Object} obj - Object with card properties
   * @returns {Card} A new card instance
   */
  static fromObject(obj) {
    return new Card(obj.id, obj.suit, obj.rank);
  }
}

export default Card;