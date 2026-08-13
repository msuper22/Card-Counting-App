/**
 * EV.js
 *
 * Expected-value calculator for blackjack decisions.
 *
 * This computes the actual expectation of every legal action rather than
 * reading a strategy chart, which means the drill can report *how much* a
 * mistake cost, and The Book can be generated from the rules in force instead
 * of hard-coded.
 *
 * Model: infinite deck (composition-independent). Each rank is drawn with
 * probability 1/13, except ten-value cards at 4/13. This is the standard basis
 * for basic strategy charts and is accurate to a fraction of a percent at six
 * to eight decks. Card counting deviations are handled separately by
 * DeviationEngine, which works off the true count.
 *
 * All values are in units of the initial bet: +1 means winning one bet.
 */

/** Probability of drawing a card of the given value (1 = ace, 10 = any ten) */
function cardProb(value) {
  return value === 10 ? 4 / 13 : 1 / 13;
}

const CARD_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/**
 * Add a card to a hand described by its total and softness.
 * @param {number} total - Current total
 * @param {boolean} soft - Whether an ace is currently counted as 11
 * @param {number} value - Card value (1 = ace)
 * @returns {{total: number, soft: boolean}}
 */
export function addCard(total, soft, value) {
  let newTotal = total;
  let newSoft = soft;

  if (value === 1) {
    // Take the ace as 11 when it fits, otherwise as 1
    if (newTotal + 11 <= 21) {
      newTotal += 11;
      newSoft = true;
    } else {
      newTotal += 1;
    }
  } else {
    newTotal += value;
  }

  // Demote a previously-soft ace rather than busting
  if (newTotal > 21 && newSoft) {
    newTotal -= 10;
    newSoft = false;
  }

  return { total: newTotal, soft: newSoft };
}

/**
 * Convert a rank name to its EV card value.
 * @param {string} rank
 * @returns {number} 1 for an ace, 10 for any ten-value card, else the pip value
 */
export function rankValue(rank) {
  if (rank === 'ace') return 1;
  if (rank === 'jack' || rank === 'queen' || rank === 'king' || rank === '10') return 10;
  return parseInt(rank, 10);
}

/* ===================== dealer ===================== */

/**
 * Probability distribution of the dealer's final total, playing out from a
 * known hand.
 * @private
 */
function playDealer(total, soft, hitSoft17, memo) {
  const key = `${total}|${soft ? 1 : 0}`;
  if (memo.has(key)) return memo.get(key);

  let result;

  if (total > 21) {
    result = { 17: 0, 18: 0, 19: 0, 20: 0, 21: 0, bust: 1 };
  } else if (total > 17 || (total === 17 && !(soft && hitSoft17))) {
    result = { 17: 0, 18: 0, 19: 0, 20: 0, 21: 0, bust: 0 };
    result[total] = 1;
  } else {
    // Dealer must draw (16 or less, or a soft 17 under H17)
    result = { 17: 0, 18: 0, 19: 0, 20: 0, 21: 0, bust: 0 };

    for (const value of CARD_VALUES) {
      const next = addCard(total, soft, value);
      const sub = playDealer(next.total, next.soft, hitSoft17, memo);
      const p = cardProb(value);

      for (const outcome of Object.keys(result)) {
        result[outcome] += p * sub[outcome];
      }
    }
  }

  memo.set(key, result);
  return result;
}

/**
 * Distribution of the dealer's final total given only the upcard.
 * @param {number} up - Upcard value (1 = ace)
 * @param {Object} rules - { hitSoft17, peek }
 * @returns {Object} Probabilities keyed 17..21 and 'bust'
 */
export function dealerOutcomes(up, rules = {}) {
  const hitSoft17 = rules.hitSoft17 !== false;
  // In a peek game the dealer has already checked for blackjack, so the hands
  // we're playing against are conditioned on the dealer not having one.
  const peek = rules.peek !== false;

  const memo = new Map();
  const start = up === 1 ? { total: 11, soft: true } : { total: up, soft: false };

  const dist = { 17: 0, 18: 0, 19: 0, 20: 0, 21: 0, bust: 0 };
  let excluded = 0;

  for (const value of CARD_VALUES) {
    const p = cardProb(value);

    if (peek && ((up === 1 && value === 10) || (up === 10 && value === 1))) {
      excluded += p;
      continue;
    }

    const hand = addCard(start.total, start.soft, value);
    const sub = playDealer(hand.total, hand.soft, hitSoft17, memo);

    for (const outcome of Object.keys(dist)) {
      dist[outcome] += p * sub[outcome];
    }
  }

  // Renormalise after removing the blackjack branch
  if (excluded > 0) {
    const scale = 1 / (1 - excluded);
    for (const outcome of Object.keys(dist)) {
      dist[outcome] *= scale;
    }
  }

  return dist;
}

/**
 * How often the dealer busts showing this upcard.
 * @param {number} up - Upcard value (1 = ace)
 * @param {Object} rules
 * @returns {number} Bust probability, 0-1
 */
export function dealerBustChance(up, rules = {}) {
  return dealerOutcomes(up, rules).bust;
}

/* ===================== player ===================== */

/**
 * Build a reusable context for one dealer upcard and rule set.
 * @param {number} up - Dealer upcard value (1 = ace)
 * @param {Object} rules
 * @returns {Object} Context carrying the dealer distribution and memo tables
 */
export function context(up, rules = {}) {
  return {
    up,
    rules: {
      hitSoft17: rules.hitSoft17 !== false,
      peek: rules.peek !== false,
      doubleAfterSplit: rules.doubleAfterSplit !== false,
      surrender: rules.surrender !== false,
      blackjackPayout: rules.blackjackPayout || 1.5
    },
    dealer: dealerOutcomes(up, rules),
    hitMemo: new Map()
  };
}

/**
 * EV of standing on a total.
 * @param {number} total
 * @param {Object} ctx - From context()
 * @returns {number}
 */
export function evStand(total, ctx) {
  if (total > 21) return -1;

  const dealer = ctx.dealer;
  let ev = dealer.bust;

  for (let dealerTotal = 17; dealerTotal <= 21; dealerTotal++) {
    const p = dealer[dealerTotal];
    if (!p) continue;

    if (total > dealerTotal) ev += p;
    else if (total < dealerTotal) ev -= p;
    // equal totals push, contributing nothing
  }

  return ev;
}

/**
 * EV of hitting and then continuing optimally (hit or stand).
 * @param {number} total
 * @param {boolean} soft
 * @param {Object} ctx
 * @returns {number}
 */
export function evHit(total, soft, ctx) {
  const key = `${total}|${soft ? 1 : 0}`;
  if (ctx.hitMemo.has(key)) return ctx.hitMemo.get(key);

  let ev = 0;

  for (const value of CARD_VALUES) {
    const next = addCard(total, soft, value);
    const p = cardProb(value);

    if (next.total > 21) {
      ev -= p;
    } else {
      // After drawing, take whichever of standing or drawing again is better
      ev += p * Math.max(evStand(next.total, ctx), evHit(next.total, next.soft, ctx));
    }
  }

  ctx.hitMemo.set(key, ev);
  return ev;
}

/**
 * EV of doubling: exactly one more card at twice the stake.
 * @param {number} total
 * @param {boolean} soft
 * @param {Object} ctx
 * @returns {number}
 */
export function evDouble(total, soft, ctx) {
  let ev = 0;

  for (const value of CARD_VALUES) {
    const next = addCard(total, soft, value);
    ev += cardProb(value) * (next.total > 21 ? -1 : evStand(next.total, ctx));
  }

  return 2 * ev;
}

/**
 * EV of splitting a pair.
 * Resplitting is not modelled, which slightly understates the value of
 * splitting; the ordering against other actions is unaffected in practice.
 * @param {number} cardValue - Value of each card in the pair (1 = ace)
 * @param {Object} ctx
 * @returns {number}
 */
export function evSplit(cardValue, ctx) {
  let perHand = 0;

  for (const value of CARD_VALUES) {
    const base = addCard(0, false, cardValue);
    const hand = addCard(base.total, base.soft, value);
    const p = cardProb(value);

    let best;

    if (cardValue === 1) {
      // Split aces get exactly one card each and stand
      best = evStand(hand.total, ctx);
    } else {
      best = Math.max(evStand(hand.total, ctx), evHit(hand.total, hand.soft, ctx));

      if (ctx.rules.doubleAfterSplit) {
        best = Math.max(best, evDouble(hand.total, hand.soft, ctx));
      }
    }

    perHand += p * best;
  }

  // Two hands, each at the original stake
  return 2 * perHand;
}

/* ===================== analysis ===================== */

const ACTION_ORDER = ['stand', 'hit', 'double', 'split', 'surrender'];

/**
 * How close to optimal still counts as correct.
 *
 * A handful of cells (A,2 vs 5 is the classic) are near coin-flips where the
 * two best actions differ by well under one percent of a bet, and published
 * charts disagree with each other on them. Marking a player wrong for
 * following the chart they learned from would be bad training, so anything
 * within this margin of the best action is accepted.
 */
export const TIE_EPSILON = 0.01;

/**
 * Whether an action is good enough to count as correct.
 * @param {string} action
 * @param {Object} analysis - Result of analyze()
 * @param {number} [epsilon]
 * @returns {boolean}
 */
export function isAcceptable(action, analysis, epsilon = TIE_EPSILON) {
  if (!(action in analysis.evs)) return false;
  return analysis.bestEv - analysis.evs[action] <= epsilon;
}

/**
 * Evaluate every legal action for a hand.
 *
 * @param {Object} hand - { total, soft, pairValue|null, cardCount }
 * @param {number} up - Dealer upcard value (1 = ace)
 * @param {Object} options - Rules and which actions are permitted
 * @returns {Object} { evs, best, bestEv, ranked }
 */
export function analyze(hand, up, options = {}) {
  const ctx = context(up, options);
  const isFresh = (hand.cardCount || 2) === 2;

  const allow = {
    hit: options.canHit !== false && hand.total < 21,
    stand: options.canStand !== false,
    double: options.canDouble !== false && isFresh,
    split: options.canSplit !== false && hand.pairValue != null && isFresh,
    surrender: options.canSurrender !== false && ctx.rules.surrender && isFresh,
    ...(options.allow || {})
  };

  const evs = {};

  if (allow.stand) evs.stand = evStand(hand.total, ctx);
  if (allow.hit) evs.hit = evHit(hand.total, hand.soft, ctx);
  if (allow.double) evs.double = evDouble(hand.total, hand.soft, ctx);
  if (allow.split && hand.pairValue != null) evs.split = evSplit(hand.pairValue, ctx);
  if (allow.surrender) evs.surrender = -0.5;

  const ranked = ACTION_ORDER
    .filter(action => action in evs)
    .map(action => ({ action, ev: evs[action] }))
    .sort((a, b) => b.ev - a.ev);

  return {
    evs,
    ranked,
    best: ranked.length ? ranked[0].action : 'stand',
    bestEv: ranked.length ? ranked[0].ev : 0,
    dealerBust: ctx.dealer.bust,
    dealer: ctx.dealer
  };
}

/**
 * Describe a hand of cards in the shape analyze() expects.
 * @param {Array} cards - Cards with a `rank` property
 * @returns {Object} { total, soft, pairValue, cardCount }
 */
export function describe(cards) {
  let total = 0;
  let soft = false;

  cards.forEach(card => {
    const next = addCard(total, soft, rankValue(card.rank));
    total = next.total;
    soft = next.soft;
  });

  // A pair for splitting purposes means two cards of equal rank
  const pairValue = cards.length === 2 && cards[0].rank === cards[1].rank
    ? rankValue(cards[0].rank)
    : null;

  return { total, soft, pairValue, cardCount: cards.length };
}
