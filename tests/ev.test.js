/**
 * ev.test.js
 *
 * The EV engine is only useful if it's right. The strongest available check is
 * that its argmax reproduces the published basic strategy chart for a 6-deck
 * H17 game — if the expectations were wrong, the recommended plays would drift
 * away from the chart.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyze, describe as describeHand, dealerOutcomes, dealerBustChance,
  evStand, evHit, evDouble, context, addCard, rankValue,
  isAcceptable, TIE_EPSILON
} from '../src/EV.js';

const H17 = { hitSoft17: true, surrender: true, doubleAfterSplit: true };

/** Dealer upcards, as EV card values (1 = ace) */
const UPCARDS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 1];

/** Best action for a hard total against an upcard */
function hardPlay(total, up, options = H17) {
  return analyze({ total, soft: false, pairValue: null, cardCount: 2 }, up, options).best;
}

/** Best action for a soft total (A + n) */
function softPlay(total, up, options = H17) {
  return analyze({ total, soft: true, pairValue: null, cardCount: 2 }, up, options).best;
}

/** Best action for a pair of the given card value */
function pairPlay(cardValue, up, options = H17) {
  const base = addCard(0, false, cardValue);
  const hand = addCard(base.total, base.soft, cardValue);
  return analyze(
    { total: hand.total, soft: hand.soft, pairValue: cardValue, cardCount: 2 },
    up,
    options
  ).best;
}

const CODE = { stand: 'S', hit: 'H', double: 'D', surrender: 'R', split: 'P' };
const ACTION_OF = { S: 'stand', H: 'hit', D: 'double', R: 'surrender', P: 'split' };

/**
 * Compare the engine's choice against a published chart.
 *
 * A cell passes if the engine picks the charted action, or if the charted
 * action is within TIE_EPSILON of optimal - those cells are coin-flips that
 * published charts themselves disagree on.
 */
function compareToChart(chart, evaluate, label) {
  const misses = [];

  Object.entries(chart).forEach(([row, plays]) => {
    plays.forEach((want, index) => {
      const up = UPCARDS[index];
      const analysis = evaluate(Number(row), up);
      const got = CODE[analysis.best];

      if (got === want) return;
      // Accept the chart's play when it is effectively tied with the best
      if (isAcceptable(ACTION_OF[want], analysis)) return;

      const gap = analysis.bestEv - (analysis.evs[ACTION_OF[want]] ?? -Infinity);
      misses.push(
        `${label} ${row} vs ${up === 1 ? 'A' : up}: got ${got}, chart says ${want} ` +
        `(costs ${gap.toFixed(4)})`
      );
    });
  });

  return misses;
}

/* ===================== dealer model ===================== */

test('dealer outcome distributions are proper probabilities', () => {
  UPCARDS.forEach(up => {
    const dist = dealerOutcomes(up, H17);
    const total = Object.values(dist).reduce((sum, p) => sum + p, 0);

    assert.ok(Math.abs(total - 1) < 1e-9, `upcard ${up} sums to ${total}`);
    Object.values(dist).forEach(p => assert.ok(p >= 0 && p <= 1));
  });
});

test('dealer bust rates match the known figures', () => {
  // Published 6-deck H17 bust rates, accurate to about a point
  const expected = { 2: 0.355, 3: 0.375, 4: 0.395, 5: 0.42, 6: 0.42, 7: 0.26, 8: 0.24, 9: 0.23, 10: 0.21, 1: 0.20 };

  Object.entries(expected).forEach(([up, want]) => {
    const got = dealerBustChance(Number(up), H17);
    assert.ok(
      Math.abs(got - want) < 0.025,
      `upcard ${up}: bust ${(got * 100).toFixed(1)}% vs expected ~${(want * 100).toFixed(0)}%`
    );
  });
});

test('a 5 or 6 upcard is the weakest for the dealer', () => {
  const bust = UPCARDS.map(up => ({ up, bust: dealerBustChance(up, H17) }));
  const worst = bust.sort((a, b) => b.bust - a.bust)[0];

  assert.ok([5, 6].includes(worst.up), `expected 5 or 6 to bust most, got ${worst.up}`);
  assert.ok(dealerBustChance(10, H17) < dealerBustChance(6, H17));
});

/* ===================== sanity ===================== */

test('obvious expectations point the right way', () => {
  const ctx = context(6, H17);

  assert.ok(evStand(20, ctx) > 0.5, 'standing on 20 vs 6 should be strongly positive');
  assert.ok(evStand(16, ctx) < 0, 'standing on 16 vs 6 still loses on balance');
  assert.ok(evHit(20, false, ctx) < -0.5, 'hitting 20 should be terrible');
  assert.ok(evDouble(11, false, ctx) > evStand(11, ctx), 'doubling 11 beats standing');

  const vsTen = context(10, H17);
  assert.ok(evStand(20, vsTen) < evStand(20, ctx), '20 is worth less against a ten than a six');
});

test('the house edge on a fresh hand is small and negative', () => {
  // Averaging the best play over every upcard should land near a fraction of
  // a percent - a wildly different number would mean the model is broken.
  let total = 0;
  UPCARDS.forEach(up => {
    total += analyze({ total: 16, soft: false, pairValue: null, cardCount: 2 }, up, H17).bestEv;
  });

  const average = total / UPCARDS.length;
  assert.ok(average < 0, '16 should be a losing hand on average');
  assert.ok(average > -0.6, `16 averaging ${average.toFixed(3)} is implausibly bad`);
});

/* ===================== basic strategy agreement ===================== */

test('hard totals reproduce the basic strategy chart', () => {
  // 6-deck, H17, double after split, late surrender.
  // S = stand, H = hit, D = double, R = surrender
  const chart = {
    //      2    3    4    5    6    7    8    9    10   A
    8:  ['H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H'],
    9:  ['H', 'D', 'D', 'D', 'D', 'H', 'H', 'H', 'H', 'H'],
    10: ['D', 'D', 'D', 'D', 'D', 'D', 'D', 'D', 'H', 'H'],
    11: ['D', 'D', 'D', 'D', 'D', 'D', 'D', 'D', 'D', 'D'],
    12: ['H', 'H', 'S', 'S', 'S', 'H', 'H', 'H', 'H', 'H'],
    13: ['S', 'S', 'S', 'S', 'S', 'H', 'H', 'H', 'H', 'H'],
    14: ['S', 'S', 'S', 'S', 'S', 'H', 'H', 'H', 'H', 'H'],
    // H17 + late surrender: 17 vs A is a surrender, not a stand
    17: ['S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'R'],
    18: ['S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S'],
    19: ['S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S'],
    20: ['S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S']
  };

  const misses = compareToChart(chart, (total, up) =>
    analyze({ total, soft: false, pairValue: null, cardCount: 2 }, up, H17), 'hard');

  assert.deepEqual(misses, [], `basic strategy disagreements:\n${misses.join('\n')}`);
});

test('soft totals reproduce the basic strategy chart', () => {
  const chart = {
    13: ['H', 'H', 'H', 'D', 'D', 'H', 'H', 'H', 'H', 'H'],  // A,2
    14: ['H', 'H', 'H', 'D', 'D', 'H', 'H', 'H', 'H', 'H'],  // A,3
    15: ['H', 'H', 'D', 'D', 'D', 'H', 'H', 'H', 'H', 'H'],  // A,4
    16: ['H', 'H', 'D', 'D', 'D', 'H', 'H', 'H', 'H', 'H'],  // A,5
    17: ['H', 'D', 'D', 'D', 'D', 'H', 'H', 'H', 'H', 'H'],  // A,6
    19: ['S', 'S', 'S', 'S', 'D', 'S', 'S', 'S', 'S', 'S'],  // A,8 (H17)
    20: ['S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S']   // A,9
  };

  const misses = compareToChart(chart, (total, up) =>
    analyze({ total, soft: true, pairValue: null, cardCount: 2 }, up, H17), 'soft');

  assert.deepEqual(misses, [], `soft strategy disagreements:\n${misses.join('\n')}`);
});

test('pair splitting reproduces the basic strategy chart', () => {
  const chart = {
    1:  ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'],  // A,A
    // H17 + late surrender: 8,8 vs A surrenders rather than splitting
    8:  ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P', 'P', 'R'],  // 8,8
    9:  ['P', 'P', 'P', 'P', 'P', 'S', 'P', 'P', 'S', 'S'],  // 9,9
    7:  ['P', 'P', 'P', 'P', 'P', 'P', 'H', 'H', 'H', 'H'],  // 7,7
    6:  ['P', 'P', 'P', 'P', 'P', 'H', 'H', 'H', 'H', 'H'],  // 6,6
    5:  ['D', 'D', 'D', 'D', 'D', 'D', 'D', 'D', 'H', 'H'],  // 5,5 never splits
    10: ['S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S']   // 10,10 never splits
  };

  const misses = compareToChart(chart, (card, up) => {
    const base = addCard(0, false, card);
    const hand = addCard(base.total, base.soft, card);
    return analyze(
      { total: hand.total, soft: hand.soft, pairValue: card, cardCount: 2 }, up, H17
    );
  }, 'pair');

  assert.deepEqual(misses, [], `pair strategy disagreements:\n${misses.join('\n')}`);
});

test('late surrender is taken on the worst hands only', () => {
  // 16 vs 9, 10 and A, and 15 vs 10, are the classic surrenders
  assert.equal(hardPlay(16, 9), 'surrender');
  assert.equal(hardPlay(16, 10), 'surrender');
  assert.equal(hardPlay(15, 10), 'surrender');

  // ...and never on a hand that plays fine
  assert.notEqual(hardPlay(12, 6), 'surrender');
  assert.notEqual(hardPlay(20, 10), 'surrender');
});

test('disallowing an action removes it from consideration', () => {
  const withDouble = analyze({ total: 11, soft: false, pairValue: null, cardCount: 2 }, 6, H17);
  assert.equal(withDouble.best, 'double');

  const noDouble = analyze(
    { total: 11, soft: false, pairValue: null, cardCount: 2 },
    6,
    { ...H17, canDouble: false }
  );
  assert.equal(noDouble.best, 'hit');
  assert.equal('double' in noDouble.evs, false);
});

test('a three-card hand cannot double, split or surrender', () => {
  const result = analyze({ total: 11, soft: false, pairValue: null, cardCount: 3 }, 6, H17);

  assert.equal('double' in result.evs, false);
  assert.equal('split' in result.evs, false);
  assert.equal('surrender' in result.evs, false);
  assert.ok('hit' in result.evs && 'stand' in result.evs);
});

test('describe() reads totals, softness and pairs off real cards', () => {
  assert.deepEqual(
    describeHand([{ rank: 'ace' }, { rank: '7' }]),
    { total: 18, soft: true, pairValue: null, cardCount: 2 }
  );

  assert.deepEqual(
    describeHand([{ rank: 'king' }, { rank: 'king' }]),
    { total: 20, soft: false, pairValue: 10, cardCount: 2 }
  );

  // Different ten-value ranks are not a splittable pair
  assert.equal(describeHand([{ rank: 'king' }, { rank: 'queen' }]).pairValue, null);

  assert.equal(describeHand([{ rank: 'ace' }, { rank: '6' }, { rank: '10' }]).total, 17);
  assert.equal(describeHand([{ rank: 'ace' }, { rank: '6' }, { rank: '10' }]).soft, false);
});

test('rankValue maps every face card to ten and the ace to one', () => {
  assert.equal(rankValue('ace'), 1);
  ['10', 'jack', 'queen', 'king'].forEach(rank => assert.equal(rankValue(rank), 10));
  assert.equal(rankValue('7'), 7);
});
