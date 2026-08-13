/**
 * coach.js
 *
 * Turns an EV analysis into feedback a person can act on: what the right play
 * was, what the mistake cost, why it was wrong, and one concrete number worth
 * remembering.
 *
 * Every figure quoted here is computed from the EV engine rather than looked
 * up, so the tips stay true if the table rules change.
 */

import { analyze, addCard, dealerBustChance, isAcceptable } from './EV.js';

const ACTION_WORDS = {
  hit: 'Hit',
  stand: 'Stand',
  double: 'Double',
  split: 'Split',
  surrender: 'Surrender'
};

/** Upcards where the dealer is strong */
const STRONG_UPCARDS = [7, 8, 9, 10, 1];

/** Display label for an EV card value */
function upLabel(up) {
  return up === 1 ? 'A' : String(up);
}

/**
 * Chance of busting by taking exactly one more card.
 * @param {number} total
 * @param {boolean} soft
 * @returns {number} 0-1
 */
export function bustChanceOnHit(total, soft) {
  let bust = 0;

  for (let value = 1; value <= 10; value++) {
    const next = addCard(total, soft, value);
    if (next.total > 21) bust += value === 10 ? 4 / 13 : 1 / 13;
  }

  return bust;
}

/**
 * Describe a hand the way a player would say it out loud.
 * @param {Object} hand - From EV.describe()
 * @param {Array} cards - Original cards, for pair naming
 * @returns {string}
 */
export function handLabel(hand, cards) {
  if (hand.pairValue != null && cards && cards.length === 2) {
    const rank = cards[0].rank;
    const short = rank === 'ace' ? 'A'
      : ['jack', 'queen', 'king'].includes(rank) ? '10'
      : rank;
    return `${short},${short}`;
  }

  if (hand.soft) {
    return `soft ${hand.total}`;
  }

  return String(hand.total);
}

/**
 * Explain a decision.
 *
 * @param {Object} options
 * @param {Object} options.hand - From EV.describe()
 * @param {Array} options.cards - The player's cards
 * @param {number} options.up - Dealer upcard value (1 = ace)
 * @param {string} options.chosen - The action the player took
 * @param {Object} options.rules - Table rules for the EV engine
 * @returns {Object} Structured feedback
 */
export function explain({ hand, cards, up, chosen, rules = {} }) {
  const analysis = analyze(hand, up, rules);
  const best = analysis.best;
  const correct = isAcceptable(chosen, analysis);

  const evChosen = analysis.evs[chosen];
  const cost = evChosen === undefined ? null : analysis.bestEv - evChosen;

  return {
    correct,
    chosen,
    best,
    bestWord: ACTION_WORDS[best] || best,
    chosenWord: ACTION_WORDS[chosen] || chosen,
    evChosen,
    evBest: analysis.bestEv,
    cost,
    // A tie is worth flagging so the player isn't told they got lucky
    marginal: correct && chosen !== best,
    ranked: analysis.ranked,
    dealerBust: analysis.dealerBust,
    reason: reasonFor({ hand, cards, up, chosen, best, analysis }),
    tip: tipFor({ hand, up, chosen, best, analysis }),
    handLabel: handLabel(hand, cards),
    upLabel: upLabel(up)
  };
}

/**
 * A short sentence naming the mistake.
 * @private
 */
function reasonFor({ hand, cards, up, chosen, best, analysis }) {
  const strong = STRONG_UPCARDS.includes(up);
  const label = upLabel(up);

  if (chosen === best) {
    // Reinforce why the right play was right
    if (best === 'stand' && !strong) return `Let the dealer break — that's the plan against a ${label}.`;
    if (best === 'double') return 'Right spot to get more money in.';
    if (best === 'split') return 'Two live hands beat one bad one.';
    if (best === 'surrender') return 'Cutting the loss is the best available outcome here.';
    if (best === 'hit' && strong) return `You have to improve against a ${label}.`;
    return 'Correct.';
  }

  // Doubling errors
  if (chosen === 'double') {
    if (strong) return "Don't double into dealer strength here.";
    if (hand.soft) return 'Doubling a soft hand only pays when the dealer is weak.';
    return 'Doubling locks you into exactly one more card.';
  }

  // Splitting errors
  if (chosen === 'split') {
    if (hand.pairValue === 10) return 'Never split a made 20.';
    if (hand.pairValue === 5) return '5,5 is a 10 — play it as one hand.';
    return `Splitting into a ${label} turns one bad hand into two.`;
  }

  if (best === 'split') {
    if (hand.pairValue === 1) return 'Always split aces — two live hands starting at 11.';
    if (hand.pairValue === 8) return 'Always split 8s — 16 is the worst hand in the game.';
    return `A pair against a ${label} plays better as two hands.`;
  }

  // Standing / hitting errors
  if (chosen === 'stand' && best === 'hit') {
    return `Standing on ${hand.total} against a ${label} just concedes the hand.`;
  }

  if (chosen === 'hit' && best === 'stand') {
    return `Against a ${label} the dealer does the busting — don't do it for them.`;
  }

  if (chosen === 'surrender') {
    return 'This hand is not bad enough to pay half a bet to escape.';
  }

  if (best === 'surrender') {
    return 'This one loses often enough that taking half back is the best result.';
  }

  if (best === 'double') {
    return `${hand.total} against a ${label} is a spot to press, not to play it safe.`;
  }

  return `${ACTION_WORDS[best]} is the higher-value play here.`;
}

/**
 * One concrete, memorable number.
 * @private
 */
function tipFor({ hand, up, chosen, best, analysis }) {
  const label = upLabel(up);
  const bustPct = Math.round(analysis.dealerBust * 100);
  const strong = STRONG_UPCARDS.includes(up);

  // Doubling into strength: quote how rarely the dealer obliges
  if (chosen === 'double' && strong && best !== 'double') {
    return `Dealer ${label} busts only ${bustPct}%; preserve flexibility.`;
  }

  // Standing on a stiff against a strong card
  if (chosen === 'stand' && best === 'hit') {
    const ownBust = Math.round(bustChanceOnHit(hand.total, hand.soft) * 100);
    return `You bust ${ownBust}% drawing here, but the dealer only breaks ${bustPct}%.`;
  }

  // Hitting a stiff against a weak card
  if (chosen === 'hit' && best === 'stand') {
    return `Dealer ${label} breaks ${bustPct}% of the time — that's your equity.`;
  }

  if (best === 'split' && hand.pairValue === 1) {
    return 'A split ace that catches a ten is 21, but it is not a blackjack.';
  }

  if (best === 'split' && hand.pairValue === 8) {
    return `Two hands starting at 8 beat one 16 against anything.`;
  }

  if (chosen === 'split' && hand.pairValue === 10) {
    return '20 wins about 70% of hands outright. Don\'t break it up.';
  }

  if (best === 'double') {
    const gain = analysis.evs.double - (analysis.evs.hit ?? 0);
    return `Doubling is worth ${(gain * 100).toFixed(0)}% of a bet more than just hitting.`;
  }

  if (best === 'surrender') {
    const standEv = analysis.evs.stand ?? -1;
    return `Best play otherwise loses ${Math.round(Math.abs(standEv) * 100)}% of a bet on average.`;
  }

  if (hand.soft) {
    return 'Soft hands can\'t bust with one card — that\'s what makes them worth pressing.';
  }

  return `Dealer ${label} busts ${bustPct}% of the time.`;
}

/**
 * Format an EV as a percentage of a bet, with a sign.
 * @param {number} ev
 * @returns {string}
 */
export function formatEv(ev) {
  if (ev === null || ev === undefined || Number.isNaN(ev)) return '—';
  const pct = ev * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}
