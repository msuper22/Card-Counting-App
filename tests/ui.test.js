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
async function mountApp() {
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
