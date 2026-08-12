/**
 * engine.test.js
 *
 * Regression tests for the blackjack engine. These cover the rules that were
 * silently wrong before: card values, ace handling, shoe recycling, per-hand
 * bets on splits, surrender, and the dealer's hole card staying hidden.
 *
 * Run with: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import Game from '../src/Game.js';
import Hand from '../src/Hand.js';
import Card from '../src/Card.js';

const card = (rank, suit = 'spades') => new Card(1, suit, rank);
const handOf = (...ranks) => {
  const hand = new Hand();
  ranks.forEach(rank => hand.addCard(card(rank)));
  return hand;
};

/** Play a round to completion, always standing. */
function playRoundStanding(game, bet = 10) {
  if (game.gamePhase !== 'betting') game.startNewRound();
  game.placeBet(0, bet);

  let guard = 0;
  while (game.gamePhase === 'insurance' && guard++ < 5) {
    game.placeInsurance(0, false);
  }
  guard = 0;
  while (game.gamePhase === 'playerTurn' && guard++ < 30) {
    game.playerAction('stand');
  }
  return game.gamePhase;
}

test('face cards are worth ten, not their index', () => {
  assert.equal(handOf('king', '7').getValue(), 17);
  assert.equal(handOf('king', 'queen').getValue(), 20);
  assert.equal(handOf('jack', '5').getValue(), 15);
  assert.equal(card('king').value, 10);
  assert.equal(card('queen').value, 10);
  assert.equal(card('jack').value, 10);
});

test('aces count as 11 until that would bust', () => {
  assert.equal(handOf('ace', 'king').getValue(), 21);
  assert.equal(handOf('ace', '6').getValue(), 17);
  assert.equal(handOf('ace', '6', '10').getValue(), 17);
  assert.equal(handOf('ace', 'ace').getValue(), 12);
  assert.equal(handOf('ace', 'ace', 'ace').getValue(), 13);
  assert.equal(handOf('ace', '9', '5').getValue(), 15);
});

test('isSoft is false once every ace has been demoted', () => {
  assert.equal(handOf('ace', '6').isSoft(), true);
  assert.equal(handOf('ace', 'ace').isSoft(), true);
  // A,A,10 is a hard 12 - the old implementation called this soft
  assert.equal(handOf('ace', 'ace', '10').isSoft(), false);
  assert.equal(handOf('ace', '6', '10').isSoft(), false);
  assert.equal(handOf('10', '7').isSoft(), false);
});

test('a natural is exactly an ace plus a ten on the opening two cards', () => {
  assert.equal(handOf('ace', 'king').hasBlackjack(), true);
  assert.equal(handOf('ace', '10').hasBlackjack(), true);
  assert.equal(handOf('ace', '5', '5').hasBlackjack(), false);
  assert.equal(handOf('king', 'queen').hasBlackjack(), false);

  // 21 on a split hand is not a natural
  const split = handOf('ace', 'king');
  split.isFromSplit = true;
  assert.equal(split.hasBlackjack(), false);
});

test('the shoe recycles and never runs dry', () => {
  const game = new Game({ numberOfDecks: 6, reshuffleThreshold: 0.25 });
  game.addPlayer('P', 1_000_000, { strategyLevel: 'counting' });

  let reshuffles = 0;
  game.addEventListener('deckReshuffled', () => { reshuffles++; });
  game.startGame();

  let lowestDeckCount = Infinity;
  for (let i = 0; i < 400; i++) {
    const phase = playRoundStanding(game);
    assert.equal(phase, 'payout', `round ${i} ended in phase ${phase}`);
    lowestDeckCount = Math.min(lowestDeckCount, game.deck.getCount());
    game.startNewRound();
  }

  assert.ok(reshuffles >= 5, `expected repeated reshuffles, saw ${reshuffles}`);
  assert.ok(lowestDeckCount > 0, 'shoe was dealt down to zero cards');
});

test('no card is ever lost or duplicated', () => {
  const game = new Game({ numberOfDecks: 6 });
  game.addPlayer('P', 1_000_000);
  game.startGame();

  for (let i = 0; i < 100; i++) {
    playRoundStanding(game);
    game.startNewRound();
  }

  const onTable = game.players.reduce(
    (n, player) => n + player.hands.reduce((m, hand) => m + hand.cards.length, 0),
    0
  ) + game.dealer.hands[0].cards.length;

  assert.equal(game.deck.getCount() + game.deck.getDiscardCount() + onTable, 6 * 52);
});

test('the running count resets when the shoe is reshuffled', () => {
  const game = new Game({ numberOfDecks: 1, reshuffleThreshold: 0.4 });
  const player = game.addPlayer('P', 1_000_000, { strategyLevel: 'counting' });
  game.startGame();

  let sawReset = false;
  game.addEventListener('deckReshuffled', () => {
    // The reset happens as part of handling the reshuffle
    queueMicrotask(() => {});
    sawReset = true;
  });

  for (let i = 0; i < 40; i++) {
    playRoundStanding(game);
    player.trackCard(card('5'));  // push the count away from zero
    game.startNewRound();
    if (sawReset) {
      assert.equal(player.runningCount, 0, 'count survived a shuffle');
      break;
    }
  }

  assert.ok(sawReset, 'expected at least one reshuffle');
});

test('splitting stakes each hand separately', () => {
  const game = new Game({ numberOfDecks: 6 });
  const player = game.addPlayer('P', 1000);
  game.startGame();
  game.startNewRound();
  game.placeBet(0, 50);

  // Force a splittable pair against a weak upcard
  player.hands[0].cards = [card('8', 'spades'), card('8', 'hearts')];
  game.dealer.hands[0].cards = [card('6'), card('10')];
  game.gamePhase = 'playerTurn';
  game.currentPlayerIndex = 0;
  game.currentHandIndex = 0;

  const bankrollBefore = player.bankroll;
  assert.equal(game.getAvailableActions().canSplit, true);

  game.playerAction('split');

  assert.equal(player.hands.length, 2);
  assert.deepEqual(player.hands.map(hand => hand.bet), [50, 50]);
  assert.equal(bankrollBefore - player.bankroll, 50, 'second hand was not staked');
  assert.equal(player.hands[0].cards.length, 2, 'split hand did not draw');
  assert.equal(player.hands[1].cards.length, 2, 'split hand did not draw');
});

test('both halves of a split are paid out', () => {
  const game = new Game({ numberOfDecks: 6 });
  const player = game.addPlayer('P', 1000);
  game.startGame();
  game.startNewRound();
  game.placeBet(0, 50);

  // Two standing hands against a dealer stiff that will bust
  player.hands = [
    Object.assign(new Hand('P'), { bet: 50, isFromSplit: true, isComplete: true }),
    Object.assign(new Hand('P'), { bet: 50, isFromSplit: true, isComplete: true })
  ];
  player.hands[0].cards = [card('10'), card('9')];
  player.hands[1].cards = [card('10'), card('9')];
  game.dealer.hands[0].cards = [card('10'), card('6'), card('king')];
  game.dealer.holeCardRevealed = true;

  const bankrollBefore = player.bankroll;
  game.processEndOfRound();

  // Dealer busted on 26, so each 19 wins 50 and returns its 50 stake
  assert.equal(player.bankroll - bankrollBefore, 200);
  assert.deepEqual(player.hands.map(hand => hand.result), ['win', 'win']);
});

test('doubling stakes only the hand being doubled', () => {
  const game = new Game({ numberOfDecks: 6, allowDoubleAfterSplit: true });
  const player = game.addPlayer('P', 1000);
  game.startGame();
  game.startNewRound();
  game.placeBet(0, 25);

  player.hands[0].cards = [card('6'), card('5')];
  game.dealer.hands[0].cards = [card('6'), card('10')];
  game.gamePhase = 'playerTurn';
  game.currentPlayerIndex = 0;
  game.currentHandIndex = 0;

  assert.equal(game.getAvailableActions().canDouble, true);
  assert.equal(player.totalBet, 25);

  game.playerAction('double');

  // The round settles immediately after a double, so check the staked amount
  // rather than the bankroll (which already includes the payout).
  assert.equal(player.totalBet, 50, 'doubling staked the wrong amount');
  assert.equal(player.hands[0].bet, 50);
  assert.equal(player.hands[0].isDoubled, true);
  assert.equal(player.hands[0].cards.length, 3, 'double must draw exactly one card');
});

test('surrender returns half of that hand only', () => {
  const game = new Game({ numberOfDecks: 6, allowSurrender: true });
  const player = game.addPlayer('P', 1000);
  game.startGame();
  game.startNewRound();
  game.placeBet(0, 100);

  player.hands[0].cards = [card('10'), card('6')];
  game.dealer.hands[0].cards = [card('10'), card('7')];
  game.gamePhase = 'playerTurn';
  game.currentPlayerIndex = 0;
  game.currentHandIndex = 0;

  const bankrollBefore = player.bankroll;
  assert.equal(game.getAvailableActions().canSurrender, true);

  game.playerAction('surrender');

  assert.equal(player.bankroll - bankrollBefore, 50);
  assert.equal(player.hands[0].isSurrendered, true);
});

test('the dealer peeks without exposing the hole card', () => {
  for (let i = 0; i < 200; i++) {
    const game = new Game({ numberOfDecks: 6 });
    game.addPlayer('P', 1000);
    game.startGame();
    game.placeBet(0, 10);

    if (game.gamePhase !== 'playerTurn') continue;

    const state = game.getGameState();
    assert.equal(
      state.dealer.hand[1].faceUp,
      false,
      'hole card was face up during the player turn'
    );
    assert.equal(state.dealer.holeCardRevealed, false);
  }
});

test('an ace upcard offers insurance instead of deadlocking', () => {
  const game = new Game({ numberOfDecks: 6 });
  game.addPlayer('P', 1000);
  game.startGame();
  game.startNewRound();
  game.placeBet(0, 40);

  // Force an ace upcard and re-run the deal logic
  game.dealer.hands[0].cards = [card('ace'), card('9')];
  game.dealer.hands[0].cards[1].setFaceUp(false);
  game.gamePhase = 'dealing';
  game.players[0].hands[0].cards = [card('10'), card('7')];

  if (game.dealer.shouldOfferInsurance()) {
    game.gamePhase = 'insurance';
  }

  assert.equal(game.gamePhase, 'insurance');
  assert.equal(game.getAvailableActions().canInsure, true);

  // Declining must advance the game rather than hang
  game.placeInsurance(0, false);
  assert.notEqual(game.gamePhase, 'insurance', 'game deadlocked on insurance');
});

test('blackjack pays 3:2 and a push returns the stake', () => {
  const game = new Game({ numberOfDecks: 6, blackjackPayout: 1.5 });
  const player = game.addPlayer('P', 1000);
  game.startGame();
  game.startNewRound();
  game.placeBet(0, 100);

  player.hands[0].cards = [card('ace'), card('king')];
  game.dealer.hands[0].cards = [card('10'), card('8')];
  game.dealer.holeCardRevealed = true;

  const before = player.bankroll;
  game.processEndOfRound();

  // 100 stake returned plus 150 winnings
  assert.equal(player.bankroll - before, 250);
  assert.equal(player.hands[0].result, 'blackjack');
});

test('available actions reflect the real rules', () => {
  const game = new Game({ numberOfDecks: 6, allowSurrender: true });
  const player = game.addPlayer('P', 1000);
  game.startGame();
  game.startNewRound();
  game.placeBet(0, 10);

  player.hands[0].cards = [card('10'), card('9'), card('2')];
  game.dealer.hands[0].cards = [card('6'), card('10')];
  game.gamePhase = 'playerTurn';
  game.currentPlayerIndex = 0;
  game.currentHandIndex = 0;

  const actions = game.getAvailableActions();
  assert.equal(actions.canHit, false, 'cannot hit a 21');
  assert.equal(actions.canStand, true);
  assert.equal(actions.canDouble, false, 'cannot double on three cards');
  assert.equal(actions.canSurrender, false, 'cannot surrender after hitting');
});
