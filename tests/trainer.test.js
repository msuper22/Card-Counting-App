/**
 * trainer.test.js
 *
 * Tests for the Trainer layer that wires the counting engine to the game.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import Game from '../src/Game.js';
import Hand from '../src/Hand.js';
import Card from '../src/Card.js';
import Trainer from '../src/Trainer.js';
import Strategy from '../src/Strategy.js';

const card = (rank, suit = 'spades') => new Card(1, suit, rank);
const handOf = (...ranks) => {
  const hand = new Hand();
  ranks.forEach(rank => hand.addCard(card(rank)));
  return hand;
};

function freshGame(options = {}) {
  const game = new Game({ numberOfDecks: 6, ...options });
  game.addPlayer('P', 1000, { strategyLevel: 'counting' });
  game.startGame();
  return game;
}

test('Hi-Lo counts low cards +1, tens and aces -1, sevens to nines zero', () => {
  const game = freshGame();
  const trainer = new Trainer(game, { countingSystem: 'HI_LO' });
  const player = game.players[0];

  // Replace the table with a known set of face-up cards
  player.hands[0].cards = [card('2'), card('5'), card('king'), card('ace'), card('8')];
  game.dealer.hands[0].cards = [];

  trainer.syncCount();

  // +1 +1 -1 -1 0 = 0
  assert.equal(trainer.getCount().running, 0);

  player.hands[0].addCard(card('3'));
  player.hands[0].addCard(card('4'));
  trainer.syncCount();

  assert.equal(trainer.getCount().running, 2);
});

test('the count ignores the hole card until it is turned over', () => {
  const game = freshGame();
  const trainer = new Trainer(game, { countingSystem: 'HI_LO' });

  const holeCard = card('5');
  holeCard.setFaceUp(false);
  game.dealer.hands[0].cards = [card('king'), holeCard];
  game.players[0].hands[0].cards = [];

  trainer.syncCount();
  assert.equal(trainer.getCount().running, -1, 'hole card leaked into the count');

  holeCard.setFaceUp(true);
  trainer.syncCount();
  assert.equal(trainer.getCount().running, 0, 'revealed hole card was not counted');
});

test('syncing repeatedly never double-counts a card', () => {
  const game = freshGame();
  const trainer = new Trainer(game, { countingSystem: 'HI_LO' });

  game.players[0].hands[0].cards = [card('2'), card('3'), card('4')];
  game.dealer.hands[0].cards = [];

  trainer.syncCount();
  trainer.syncCount();
  trainer.syncCount();

  assert.equal(trainer.getCount().running, 3);
});

test('true count divides the running count by decks remaining', () => {
  const game = freshGame({ numberOfDecks: 6 });
  const trainer = new Trainer(game, { countingSystem: 'HI_LO' });

  game.players[0].hands[0].cards = [];
  game.dealer.hands[0].cards = [];

  // Running count of +6 with roughly 3 decks left is a true count of +2
  game.deck.cards.length = 156;
  trainer.engine.counter.runningCount = 6;
  trainer.engine.deviationEngine.counter.runningCount = 6;
  trainer.syncCount();

  assert.equal(trainer.getCount().true, 2);
});

test('a reshuffle resets the count', () => {
  const game = freshGame({ numberOfDecks: 1, reshuffleThreshold: 0.4 });
  const trainer = new Trainer(game, { countingSystem: 'HI_LO' });

  let sawReset = false;
  trainer.on('countReset', () => { sawReset = true; });

  for (let i = 0; i < 40 && !sawReset; i++) {
    if (game.gamePhase !== 'betting') game.startNewRound();
    game.placeBet(0, 10);
    let guard = 0;
    while (game.gamePhase === 'insurance' && guard++ < 5) game.placeInsurance(0, false);
    guard = 0;
    while (game.gamePhase === 'playerTurn' && guard++ < 30) game.playerAction('stand');
    game.startNewRound();
  }

  assert.ok(sawReset, 'expected a reshuffle within 40 single-deck rounds');
  assert.equal(trainer.getCount().running, 0);
});

test('basic strategy handles named pair ranks', () => {
  const strategy = new Strategy({ hitSoft17: true, surrender: true });

  // These lookups silently missed while the table was keyed by raw rank
  assert.equal(strategy.getBasicStrategyPlay(handOf('ace', 'ace'), card('6')), 'P');
  assert.equal(strategy.getBasicStrategyPlay(handOf('8', '8'), card('10')), 'P');
  assert.equal(strategy.getBasicStrategyPlay(handOf('king', 'queen'), card('6')), 'S');
  assert.equal(strategy.getBasicStrategyPlay(handOf('9', '9'), card('7')), 'S');
});

test('advice never recommends an action the rules forbid', () => {
  const game = freshGame({ allowSurrender: false });
  const trainer = new Trainer(game, {});
  const player = game.players[0];

  game.startNewRound();
  game.placeBet(0, 10);

  // A three-card 11 cannot be doubled
  player.hands[0].cards = [card('4'), card('3'), card('4')];
  game.dealer.hands[0].cards = [card('6'), card('10')];
  game.gamePhase = 'playerTurn';
  game.currentPlayerIndex = 0;
  game.currentHandIndex = 0;

  const advice = trainer.getAdvice();
  const actions = game.getAvailableActions();

  assert.ok(advice, 'expected advice for a live hand');
  assert.notEqual(advice.optimalPlay, 'double');
  assert.equal(actions.canDouble, false);
  assert.ok(['hit', 'stand'].includes(advice.optimalPlay));
});

test('16 vs 10 flips to stand once the true count reaches zero', () => {
  // Surrender is off so that basic strategy here is a plain hit; with
  // surrender available the correct basic play is to surrender instead.
  const game = freshGame({ numberOfDecks: 6, allowSurrender: false });
  const trainer = new Trainer(game, {});
  const player = game.players[0];

  game.startNewRound();
  game.placeBet(0, 10);
  player.hands[0].cards = [card('10'), card('6')];
  game.dealer.hands[0].cards = [card('10'), card('4')];
  game.dealer.hands[0].cards[1].setFaceUp(false);
  game.gamePhase = 'playerTurn';
  game.currentPlayerIndex = 0;
  game.currentHandIndex = 0;

  // Drive the count negative: basic strategy says hit
  trainer.engine.counter.runningCount = -20;
  trainer.engine.deviationEngine.counter.runningCount = -20;
  assert.equal(trainer.getAdvice().optimalPlay, 'hit');

  // Drive it positive: the Illustrious 18 deviation says stand
  trainer.engine.counter.runningCount = 20;
  trainer.engine.deviationEngine.counter.runningCount = 20;
  const positive = trainer.getAdvice();
  assert.equal(positive.optimalPlay, 'stand');
  assert.equal(positive.isDeviation, true);
});

test('insurance is advised only at a true count of +3 or better', () => {
  const game = freshGame({ numberOfDecks: 6 });
  const trainer = new Trainer(game, {});

  game.deck.cards.length = 312;
  trainer.engine.deviationEngine.counter.runningCount = 0;
  trainer.syncCount();
  assert.equal(trainer.shouldTakeInsurance(), false);

  trainer.engine.deviationEngine.counter.runningCount = 24;  // TC +4 over 6 decks
  trainer.syncCount();
  assert.equal(trainer.shouldTakeInsurance(), true);
});

test('decisions are graded and accuracy is reported', () => {
  const game = freshGame();
  const trainer = new Trainer(game, {});

  const advice = { optimalPlay: 'stand', isDeviation: false, hand: 16, dealerUpCard: '10', trueCount: 1 };

  trainer.recordDecision('stand', advice);
  trainer.recordDecision('hit', advice);

  const stats = trainer.getStats();
  assert.equal(stats.decisions, 2);
  assert.equal(stats.correctDecisions, 1);
  assert.equal(stats.accuracy, 50);
  assert.equal(stats.mistakes.length, 1);
  assert.equal(stats.mistakes[0].played, 'hit');
  assert.equal(stats.mistakes[0].expected, 'stand');
});

test('deviation accuracy is tracked separately from overall accuracy', () => {
  const game = freshGame();
  const trainer = new Trainer(game, {});

  trainer.recordDecision('stand', { optimalPlay: 'stand', isDeviation: true });
  trainer.recordDecision('hit', { optimalPlay: 'stand', isDeviation: true });
  trainer.recordDecision('stand', { optimalPlay: 'stand', isDeviation: false });

  const stats = trainer.getStats();
  assert.equal(stats.deviationsSeen, 2);
  assert.equal(stats.deviationsHit, 1);
  assert.equal(stats.deviationAccuracy, 50);
  assert.equal(stats.accuracy, 67);
});

test('bet recommendation rises with the count and respects table limits', () => {
  const game = freshGame({ numberOfDecks: 6 });
  const trainer = new Trainer(game, { minBet: 10, maxBet: 200 });

  game.deck.cards.length = 312;
  trainer.engine.counter.runningCount = 0;
  trainer.syncCount();
  const flat = trainer.getBetRecommendation(1000);

  trainer.engine.counter.runningCount = 30;  // TC +5
  trainer.syncCount();
  const pressed = trainer.getBetRecommendation(1000);

  assert.ok(pressed.amount >= flat.amount, 'bet did not rise with the count');
  assert.ok(pressed.amount <= 200, 'bet exceeded the table maximum');
  assert.ok(flat.amount >= 10, 'bet fell below the table minimum');
  assert.ok(pressed.reason.length > 0);
});
