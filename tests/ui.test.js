/**
 * ui.test.js
 *
 * Mounts the real UI in jsdom and drives a hand end to end. The previous UI
 * shipped broken because nothing ever exercised it outside a browser; these
 * tests fail loudly if the app can't boot, deal, or act.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

/**
 * Stand up a DOM, mount the app, and hand back helpers for driving it.
 * The app module is imported fresh each time so module state can't leak.
 */
async function mountApp(settings = null) {
  const dom = new JSDOM('<!DOCTYPE html><div id="app"></div>', {
    url: 'https://example.test/',
    pretendToBeVisual: true
  });

  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.Node = dom.window.Node;
  global.localStorage = dom.window.localStorage;

  // Node 24 exposes `navigator` as a getter-only global, so plain assignment throws
  Object.defineProperty(global, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
    writable: true
  });

  dom.window.localStorage.clear();

  // Seed settings before mounting so the app boots into the mode under test
  if (settings) {
    dom.window.localStorage.setItem('ccapp:v1', JSON.stringify({ settings }));
  }

  // Cache-bust so each test gets a clean module instance
  const { default: App } = await import(`../src/ui/App.js?t=${Math.random()}`);
  const app = new App(dom.window.document.getElementById('app'));

  const $ = selector => dom.window.document.querySelector(selector);
  const $$ = selector => [...dom.window.document.querySelectorAll(selector)];

  /** Find a button by its visible text */
  const button = label => $$('button').find(
    node => node.textContent.trim().toLowerCase().includes(label.toLowerCase())
  );

  return { dom, app, $, $$, button };
}

test('the app boots and renders a table', async () => {
  const { app, $, $$ } = await mountApp();

  assert.ok($('.status'), 'status bar missing');
  assert.ok($('.felt'), 'felt missing');
  assert.ok($('.controls'), 'controls missing');

  // A fresh game opens in the betting phase
  assert.equal(app.game.gamePhase, 'betting');
  assert.ok($$('.chip').length > 0, 'no betting chips rendered');
});

test('placing a bet deals a hand', async () => {
  const { app, $, $$, button } = await mountApp();

  const deal = button('deal');
  assert.ok(deal, 'no deal button');
  deal.click();

  assert.notEqual(app.game.gamePhase, 'betting', 'still in betting after dealing');

  // Two player cards and two dealer cards should now be on the felt
  assert.equal($$('.hand__cards')[0].children.length, 2, 'dealer did not get two cards');
  assert.ok($$('.card').length >= 4, 'fewer than four cards dealt');

  // The hole card stays face down for as long as the player is still acting.
  // If the hand resolved instantly (a natural, or dealer blackjack) it is
  // correct for the card to already be exposed.
  if (app.game.gamePhase === 'playerTurn') {
    assert.ok($('.card--back'), 'dealer hole card is not face down');
  }
});

test('action buttons refresh after every hit', async () => {
  const { app, $$, button } = await mountApp();

  button('deal').click();

  // Skip hands that resolve immediately (naturals, or an insurance offer)
  if (app.game.gamePhase !== 'playerTurn') return;

  const doubleBefore = $$('button').find(b => b.textContent.trim() === 'Double');
  assert.ok(doubleBefore && !doubleBefore.disabled, 'double should be legal on two cards');

  const hit = $$('button').find(b => b.textContent.trim() === 'Hit');
  if (hit && !hit.disabled) {
    hit.click();

    if (app.game.gamePhase === 'playerTurn') {
      // This is the bug that made the old UI unplayable: the buttons never
      // re-rendered, so Double stayed clickable on a three-card hand.
      const doubleAfter = $$('button').find(b => b.textContent.trim() === 'Double');
      assert.ok(doubleAfter.disabled, 'Double still enabled after hitting');
    }
  }
});

test('a full hand can be played to settlement', async () => {
  const { app, $, button } = await mountApp();

  button('deal').click();

  let guard = 0;
  while (app.game.gamePhase === 'insurance' && guard++ < 5) {
    button('no thanks').click();
  }

  guard = 0;
  while (app.game.gamePhase === 'playerTurn' && guard++ < 25) {
    const stand = [...$('.controls').querySelectorAll('button')]
      .find(b => b.textContent.trim() === 'Stand' && !b.disabled);
    if (!stand) break;
    stand.click();
  }

  assert.equal(app.game.gamePhase, 'payout', 'hand did not reach settlement');

  // A result banner and a way to continue should both be present
  assert.ok($('.banner'), 'no result banner shown');
  assert.ok(button('next hand'), 'no next-hand button');
});

test('consecutive hands can be played without error', async () => {
  const { app, $, button } = await mountApp();

  for (let round = 0; round < 12; round++) {
    const deal = button('deal');
    if (deal) deal.click();

    let guard = 0;
    while (app.game.gamePhase === 'insurance' && guard++ < 5) {
      button('no thanks').click();
    }

    guard = 0;
    while (app.game.gamePhase === 'playerTurn' && guard++ < 25) {
      const stand = [...$('.controls').querySelectorAll('button')]
        .find(b => b.textContent.trim() === 'Stand' && !b.disabled);
      if (!stand) break;
      stand.click();
    }

    assert.equal(app.game.gamePhase, 'payout', `round ${round} stalled`);

    const next = button('next hand') || button('rebuy');
    assert.ok(next, `round ${round} had no way to continue`);
    next.click();
  }

  assert.ok(app.game.roundNumber >= 12);
});

test('the count can be hidden and revealed', async () => {
  const { app, $ } = await mountApp();

  const count = $('.count');
  assert.ok(count);

  const initiallyHidden = count.classList.contains('is-hidden');
  count.click();
  assert.notEqual(
    count.classList.contains('is-hidden'),
    initiallyHidden,
    'tapping the count did not toggle it'
  );
});

test('bankroll and settings survive a reload', async () => {
  const { app, button, dom } = await mountApp();

  button('deal').click();
  const bankrollAfterBet = app.game.players[0].bankroll;

  const stored = JSON.parse(dom.window.localStorage.getItem('ccapp:v1'));
  assert.ok(stored.session, 'session was not persisted');
  assert.equal(stored.session.bankroll, bankrollAfterBet);

  // Remount against the same storage and confirm the bankroll carries over
  const { default: App } = await import(`../src/ui/App.js?t=${Math.random()}`);
  const revived = new App(dom.window.document.getElementById('app'));
  assert.equal(revived.game.players[0].bankroll, bankrollAfterBet);
});

test('the menu opens the stats and settings sheets', async () => {
  const { $, button } = await mountApp();

  button('menu').click();
  assert.equal($('.sheet').hidden, false, 'menu sheet did not open');

  button('session stats').click();
  assert.ok($('.stats-grid'), 'stats sheet did not render');

  button('menu') || $('.sheet__close').click();
});

test('an empty bankroll offers a rebuy instead of locking up', async () => {
  const { app, button, $ } = await mountApp();

  // Bet everything, then drive the bankroll to zero
  app.game.players[0].bankroll = 5;
  app.pendingBet = 5;
  app.render();

  const deal = button('deal');
  assert.ok(deal && !deal.disabled, 'could not bet the last chips');
  deal.click();

  let guard = 0;
  while (app.game.gamePhase === 'insurance' && guard++ < 5) button('no thanks').click();
  guard = 0;
  while (app.game.gamePhase === 'playerTurn' && guard++ < 25) {
    const stand = [...$('.controls').querySelectorAll('button')]
      .find(b => b.textContent.trim() === 'Stand' && !b.disabled);
    if (!stand) break;
    stand.click();
  }

  if (app.game.players[0].bankroll < 5) {
    assert.ok(button('rebuy'), 'no rebuy offered when out of chips');
  }
});

/* ===================== difficulty modes ===================== */

import { applyDifficulty } from '../src/difficulty.js';
import { DEFAULT_SETTINGS } from '../src/storage.js';

const modeSettings = mode => applyDifficulty(DEFAULT_SETTINGS, mode);

/** Force a specific player hand against a specific dealer upcard */
function stageHand(app, playerRanks, dealerRanks) {
  const player = app.game.players[0];
  const Card = player.hands[0].cards[0].constructor;

  player.hands[0].cards = playerRanks.map(rank => new Card(1, 'spades', rank));
  app.game.dealer.hands[0].cards = dealerRanks.map(rank => new Card(2, 'hearts', rank));
  app.game.dealer.hands[0].cards[1].setFaceUp(false);
  app.game.dealer.holeCardRevealed = false;
  app.game.gamePhase = 'playerTurn';
  app.game.currentPlayerIndex = 0;
  app.game.currentHandIndex = 0;
  app.render();
}

test('easy mode names the correct play before you act', async () => {
  const { app, $, button } = await mountApp(modeSettings('easy'));
  button('deal').click();

  if (app.game.gamePhase !== 'playerTurn') return;

  assert.ok($('.advice__play'), 'easy mode did not show a recommended play');
  app._stopTimer();
});

test('normal mode shows the count but never the play', async () => {
  const { app, $, button } = await mountApp(modeSettings('normal'));
  button('deal').click();

  if (app.game.gamePhase !== 'playerTurn') return;

  assert.equal($('.advice__play'), null, 'normal mode pre-announced the play');
  assert.equal($('.count').classList.contains('is-hidden'), false, 'normal mode hid the count');
  assert.notEqual($('.count__value').textContent, '?', 'normal mode should show real numbers');
  app._stopTimer();
});

test('normal mode explains a misplay after the hand', async () => {
  const { app, $, $$, button } = await mountApp(modeSettings('normal'));
  button('deal').click();

  // Hitting a hard 20 against a 6 is unambiguously wrong
  stageHand(app, ['king', 'queen'], ['6', '10']);

  const hit = $$('button').find(b => b.textContent.trim() === 'Hit' && !b.disabled);
  assert.ok(hit, 'no hit button available');
  hit.click();

  assert.ok(
    app.trainer.getRoundMistakes().length >= 1,
    'the misplay was not recorded for review'
  );

  // Finish the hand, then let the deferred review fire
  let guard = 0;
  while (app.game.gamePhase === 'playerTurn' && guard++ < 20) {
    const stand = [...$('.controls').querySelectorAll('button')]
      .find(b => b.textContent.trim() === 'Stand' && !b.disabled);
    if (!stand) break;
    stand.click();
  }

  await new Promise(resolve => setTimeout(resolve, 1100));

  assert.equal($('.sheet').hidden, false, 'no post-hand review appeared');
  assert.ok($('.review__item'), 'review sheet had no content');
  assert.ok($('.review__why').textContent.length > 10, 'review gave no explanation');

  clearTimeout(app.reviewTimer);
  app._stopTimer();
});

test('hard mode hides the count and refuses to reveal it', async () => {
  const { app, $ } = await mountApp(modeSettings('hard'));

  assert.equal($('.count__value').textContent, '?', 'hard mode leaked the count');

  // The real value must not be reachable by tapping
  $('.count').click();
  assert.equal($('.count__value').textContent, '?', 'hard mode allowed a peek');

  app._stopTimer();
});

test('hard mode hides hand totals', async () => {
  const { app, $, button } = await mountApp(modeSettings('hard'));
  button('deal').click();

  const totals = [...$('.felt').querySelectorAll('.seat__total')];
  totals.forEach(node => {
    assert.equal(node.textContent.trim(), '', 'hard mode showed a hand total');
  });

  app._stopTimer();
});

test('hard mode runs a decision timer', async () => {
  const { app, $, button } = await mountApp(modeSettings('hard'));
  button('deal').click();

  if (app.game.gamePhase !== 'playerTurn') { app._stopTimer(); return; }

  assert.ok(app.timerDeadline, 'no decision deadline was set');
  assert.ok($('.timer__fill'), 'timer bar was not rendered');

  app._stopTimer();
  assert.equal(app.timerDeadline, null);
});

test('hard mode grades the bet', async () => {
  const { app, button } = await mountApp(modeSettings('hard'));

  app.pendingBet = 500;   // a wild overbet off the top of a neutral shoe
  app.render();
  button('deal').click();

  const stats = app.trainer.getStats();
  assert.equal(stats.betsGraded, 1, 'the wager was not graded');
  assert.equal(stats.betsCorrect, 0, 'a 100x overbet was accepted as correct');
  assert.ok(
    app.trainer.getRoundMistakes().some(m => m.kind === 'bet'),
    'bet mistake was not recorded'
  );

  app._stopTimer();
});

test('hard mode asks for the count before the shoe is reshuffled', async () => {
  const { app, $ } = await mountApp(modeSettings('hard'));

  // Push the shoe past the cut card so an audit is owed
  app.game.deck.cards.length = 10;
  app.game.gamePhase = 'payout';

  assert.equal(app._auditDue(), true, 'no count check owed at the cut card');

  app._nextHand();
  assert.equal($('.sheet').hidden, false, 'count check did not appear');
  assert.ok($('.audit__input'), 'count check had no input');

  // The prompt must not be dismissable by tapping the backdrop
  $('.sheet').click();
  assert.equal($('.sheet').hidden, false, 'count check was dismissed by a backdrop tap');

  // Answering grades and moves on
  $('.audit__input').value = '3';
  [...$('.sheet').querySelectorAll('button')].find(b => /check/i.test(b.textContent)).click();
  assert.equal(app.trainer.getStats().auditsTaken, 1, 'the answer was not graded');

  app._stopTimer();
});

test('the game log captures a played hand', async () => {
  const { app, $, button } = await mountApp(modeSettings('normal'));

  button('deal').click();
  let guard = 0;
  while (app.game.gamePhase === 'playerTurn' && guard++ < 20) {
    const stand = [...$('.controls').querySelectorAll('button')]
      .find(b => b.textContent.trim() === 'Stand' && !b.disabled);
    if (!stand) break;
    stand.click();
  }

  const text = app.log.toText(true);
  assert.match(text, /bet /, 'bet was not logged');
  assert.match(text, /dealt /, 'deal was not logged');
  assert.match(text, /settled /, 'settlement was not logged');

  clearTimeout(app.reviewTimer);
  app._stopTimer();
});

test('switching difficulty from the menu takes effect', async () => {
  const { app, $, button } = await mountApp(modeSettings('easy'));

  button('menu').click();
  const hard = [...$('.sheet').querySelectorAll('button')]
    .find(b => b.textContent.trim() === 'Hard');
  assert.ok(hard, 'no hard button in the menu');
  hard.click();

  assert.equal(app.settings.difficulty, 'hard');
  assert.equal(app.settings.showHandTotals, false);
  assert.equal(app.settings.allowCountPeek, false);

  app._stopTimer();
});

test('the count drill can be entered and exited cleanly', async () => {
  const { app, $, button } = await mountApp(modeSettings('easy'));

  button('menu').click();
  button('count drill').click();
  assert.ok($('.field__label'), 'drill setup did not render');

  button('start drill').click();
  assert.ok(app.drill, 'drill was not created');
  assert.ok($('.drill__card'), 'drill view did not render');

  // Deal a few cards by hand, then leave
  app.drill.running = false;
  app.drill._dealNext();
  app.drill._dealNext();
  assert.equal(app.drill.dealt, 2);

  app.drill.destroy(true);

  // Exiting must rebuild the table, not leave the drill on screen
  assert.equal(app.drill, null, 'drill reference was not cleared');
  assert.equal($('.drill__card'), null, 'drill view was left on screen');
  assert.ok($('.felt'), 'table was not restored');
  assert.ok($('.status'), 'status bar was not restored');

  app._stopTimer();
});

/* ===================== strategy drill, book, exam ===================== */

test('the strategy drill deals a spot and grades the answer', async () => {
  const { app, $, $$, button } = await mountApp(modeSettings('easy'));

  button('menu').click();
  button('strategy drill').click();

  assert.ok(app.strategyDrill, 'drill was not created');
  assert.ok($('.strategy__ask'), 'no question was posed');
  assert.ok($$('.card').length >= 3, 'spot was not dealt');

  // Answer with a deliberately terrible play and check the coaching appears
  app.strategyDrill.hand = { total: 20, soft: false, pairValue: null, cardCount: 2 };
  app.strategyDrill.up = 6;
  app.strategyDrill.answer('hit');

  assert.ok($('.verdict.is-wrong'), 'a bad play was not marked wrong');
  assert.equal($('.verdict__word').textContent, 'WRONG');
  assert.ok($('.verdict__best').textContent.length > 0, 'no optimal play shown');
  assert.ok($('.verdict__cost').textContent.includes('%'), 'no EV cost shown');
  assert.ok($('.verdict__reason').textContent.length > 10, 'no reason given');
  assert.ok($('.verdict__tip').textContent.length > 10, 'no tip given');

  app.strategyDrill.destroy(true);
  assert.equal(app.strategyDrill, null);
  assert.ok($('.felt'), 'table was not restored on exit');
  app._stopTimer();
});

test('the strategy drill confirms a correct answer', async () => {
  const { app, $, button } = await mountApp(modeSettings('easy'));

  button('menu').click();
  button('strategy drill').click();

  app.strategyDrill.hand = { total: 20, soft: false, pairValue: null, cardCount: 2 };
  app.strategyDrill.up = 6;
  app.strategyDrill.answer('stand');

  assert.ok($('.verdict.is-right'), 'a correct play was not confirmed');
  assert.equal($('.verdict__word').textContent, 'CORRECT');
  assert.equal(app.strategyDrill.streak, 1);

  app.strategyDrill.destroy(true);
  app._stopTimer();
});

test('drill results feed the strategy rating', async () => {
  const { app, button } = await mountApp(modeSettings('easy'));

  button('menu').click();
  button('strategy drill').click();

  app.strategyDrill.hand = { total: 20, soft: false, pairValue: null, cardCount: 2 };
  app.strategyDrill.up = 6;
  app.strategyDrill.answer('stand');

  assert.ok(app.profile.modes.strategy.rating > 0, 'strategy rating did not move');
  assert.equal(app.profile.modes.strategy.correct, 1);

  app.strategyDrill.destroy(true);
  app._stopTimer();
});

test('The Book renders a full chart matching the rules', async () => {
  const { app, $, $$, button } = await mountApp(modeSettings('easy'));

  button('menu').click();
  button('the book').click();

  assert.ok($('.book__table'), 'no chart rendered');
  assert.equal($$('.book__section').length, 3, 'expected hard, soft and pair sections');
  assert.ok($$('.book__cell--P').length > 0, 'chart has no split cells');
  assert.ok($$('.book__cell--D').length > 0, 'chart has no double cells');

  // With surrender off, neither the chart nor the legend should mention it
  app.settings.allowSurrender = false;
  app._openBook();
  assert.equal(
    $$('.book__table .book__cell--R').length, 0,
    'chart still recommends surrender when the rules forbid it'
  );
  assert.equal($$('.book__legend .book__cell--R').length, 0, 'legend still lists surrender');

  app._stopTimer();
});

test('the casino test runs on hard settings and banks nothing', async () => {
  const { app, $, button } = await mountApp(modeSettings('easy'));

  const easyRatingBefore = app.profile.modes.easy.rating;

  button('menu').click();
  button('casino test').click();
  button('begin test').click();

  assert.ok(app.exam, 'exam did not start');
  assert.equal(app.settings.showCount, false, 'exam should run with the count hidden');
  assert.equal(app.settings.showHandTotals, false);
  assert.equal(app.settings.numberOfDecks, 6);

  // Grade some decisions; none should reach the player's lifetime record
  app._recordRating({ correct: true, kind: 'play' });
  app._recordRating({ correct: false, kind: 'play' });

  assert.equal(app.exam.events.length, 2);
  assert.equal(app.profile.modes.easy.rating, easyRatingBefore, 'exam leaked into easy rating');
  assert.equal(app.profile.modes.hard.decisions, 0, 'exam leaked into hard rating');

  app._stopTimer();
});

test('finishing the test reports a grade and restores settings', async () => {
  const { app, $, button } = await mountApp(modeSettings('easy'));

  button('menu').click();
  button('casino test').click();
  button('begin test').click();

  // A clean sheet of 25 decisions
  for (let i = 0; i < 25; i++) app._recordRating({ correct: true, kind: 'play' });
  app._recordRating({ correct: true, kind: 'count' });

  app._finishExam();

  assert.equal(app.exam, null, 'exam did not end');
  assert.equal(app.settings.difficulty, 'easy', 'settings were not restored');
  assert.equal(app.settings.showCount, true);

  assert.ok($('.exam__grade'), 'no grade shown');
  assert.equal($('.exam__grade').textContent, 'A');
  assert.ok($('.exam__verdict').textContent.length > 10);
  assert.equal(app.profile.exams.length, 1, 'result was not recorded');
  assert.equal(app.profile.exams[0].grade, 'A');

  app._stopTimer();
});

test('a sloppy test does not come back casino-ready', async () => {
  const { app, $, button } = await mountApp(modeSettings('easy'));

  button('menu').click();
  button('casino test').click();
  button('begin test').click();

  for (let i = 0; i < 15; i++) app._recordRating({ correct: true, kind: 'play' });
  for (let i = 0; i < 10; i++) app._recordRating({ correct: false, kind: 'play' });

  app._finishExam();

  assert.equal(app.profile.exams[0].ready, false);
  assert.ok(['C', 'D', 'F'].includes($('.exam__grade').textContent));

  app._stopTimer();
});

test('players can be added and switched from the menu', async () => {
  const { app, $, $$, button } = await mountApp(modeSettings('easy'));

  const firstId = app.profile.id;

  button('menu').click();
  button('players').click();
  assert.ok($('.player'), 'player list did not render');

  $('.sheet input[type="text"]').value = 'Marcus';
  button('add').click();

  assert.notEqual(app.profile.id, firstId, 'did not switch to the new player');
  assert.equal(app.profile.name, 'Marcus');

  app._stopTimer();
});

test('ratings are shown per mode', async () => {
  const { app, $, $$, button } = await mountApp(modeSettings('easy'));

  app.profile.modes.normal.rating = 400;

  button('menu').click();
  button('ratings').click();

  assert.ok($('.rating'), 'ratings did not render');
  assert.ok($$('.rating').length >= 6, 'expected an overall plus per-mode ratings');
  assert.ok($('.rating__tier').textContent.length > 0, 'no tier name shown');

  app._stopTimer();
});

test('a player can be renamed without losing progress', async () => {
  const { app, $, button } = await mountApp(modeSettings('easy'));

  // Give the player something to lose
  app.profile.modes.normal.rating = 350;
  app.profile.bankroll = 777;

  button('menu').click();
  button('players').click();

  const rename = [...$('.sheet').querySelectorAll('button')].find(b => b.textContent.trim() === '✎');
  assert.ok(rename, 'no rename control');
  rename.click();

  const input = $('.sheet input[type="text"]');
  assert.equal(input.value, app.profile.name, 'rename field not prefilled');
  input.value = 'Renamed';
  button('save').click();

  assert.equal(app.profile.name, 'Renamed');
  assert.equal(app.profile.modes.normal.rating, 350, 'rating lost on rename');
  assert.equal(app.profile.bankroll, 777, 'bankroll lost on rename');

  app._stopTimer();
});
