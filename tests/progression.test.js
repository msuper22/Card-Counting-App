/**
 * progression.test.js
 *
 * Player profiles, per-mode ratings, readiness assessment, the coaching
 * feedback, and the multi-seat table.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import {
  applyResult, emptyMode, tierFor, accuracies, overallRating, assessReadiness, MAX_RATING
} from '../src/rating.js';
import { explain, bustChanceOnHit, formatEv } from '../src/coach.js';
import { describe as describeHand } from '../src/EV.js';

const H17 = { hitSoft17: true, surrender: true, doubleAfterSplit: true };

/* ===================== rating ===================== */

test('correct plays raise the rating and mistakes lower it', () => {
  let record = emptyMode();

  for (let i = 0; i < 20; i++) {
    record = applyResult(record, { correct: true, mode: 'normal', kind: 'play' });
  }
  const climbed = record.rating;
  assert.ok(climbed > 0, 'rating did not climb');

  for (let i = 0; i < 5; i++) {
    record = applyResult(record, { correct: false, mode: 'normal', kind: 'play' });
  }
  assert.ok(record.rating < climbed, 'mistakes did not cost anything');
});

test('mistakes cost more than correct plays earn', () => {
  let record = emptyMode();
  record = applyResult(record, { correct: true, mode: 'normal', kind: 'play' });
  const gain = record.rating;

  let other = applyResult(emptyMode(), { correct: true, mode: 'normal', kind: 'play' });
  other = applyResult(other, { correct: true, mode: 'normal', kind: 'play' });
  other = applyResult(other, { correct: false, mode: 'normal', kind: 'play' });

  assert.ok(other.rating < gain * 2, 'a mistake should outweigh a single correct play');
});

test('harder modes are worth more per correct play', () => {
  const easy = applyResult(emptyMode(), { correct: true, mode: 'easy', kind: 'play' });
  const hard = applyResult(emptyMode(), { correct: true, mode: 'hard', kind: 'play' });

  assert.ok(hard.rating > easy.rating, 'hard mode should award more than easy');
});

test('rating is clamped to the 0-1000 range', () => {
  let record = emptyMode();
  for (let i = 0; i < 2000; i++) {
    record = applyResult(record, { correct: true, mode: 'hard', kind: 'play' });
  }
  assert.equal(record.rating, MAX_RATING);
  assert.equal(record.bestRating, MAX_RATING);

  for (let i = 0; i < 2000; i++) {
    record = applyResult(record, { correct: false, mode: 'hard', kind: 'play' });
  }
  assert.equal(record.rating, 0);
  assert.equal(record.bestRating, MAX_RATING, 'best rating should be remembered');
});

test('count checks move the rating hardest', () => {
  const play = applyResult(emptyMode(), { correct: true, mode: 'normal', kind: 'play' });
  const check = applyResult(emptyMode(), { correct: true, mode: 'normal', kind: 'count' });

  assert.ok(check.rating > play.rating, 'a held count should be worth more than one play');
});

test('tiers rise with rating and expose progress', () => {
  assert.equal(tierFor(0).name, 'Novice');
  assert.equal(tierFor(1000).name, 'Card Counter');
  assert.ok(tierFor(500).index > tierFor(100).index);

  const mid = tierFor(500);
  assert.ok(mid.progress >= 0 && mid.progress <= 1);
  assert.ok(mid.next, 'a mid tier should have a next tier');
  assert.equal(tierFor(1000).next, null);
});

test('accuracies are reported per category', () => {
  let record = emptyMode();
  record = applyResult(record, { correct: true, mode: 'normal', kind: 'play' });
  record = applyResult(record, { correct: false, mode: 'normal', kind: 'play' });
  record = applyResult(record, { correct: true, mode: 'normal', kind: 'play', isDeviation: true });

  const acc = accuracies(record);
  assert.equal(acc.accuracy, 67);
  assert.equal(acc.deviationAccuracy, 100);
  assert.equal(acc.countAccuracy, null);
});

test('overall rating weights modes by how much they were played', () => {
  const modes = {
    easy: { ...emptyMode(), rating: 900, decisions: 2 },
    hard: { ...emptyMode(), rating: 100, decisions: 200 }
  };

  // The heavily-played weak mode should dominate
  assert.ok(overallRating(modes) < 300, 'a two-hand sample should not carry the rating');
  assert.equal(overallRating({}), 0);
});

test('exam results never contribute to the overall rating', () => {
  const modes = { exam: { ...emptyMode(), rating: 1000, decisions: 500 } };
  assert.equal(overallRating(modes), 0, 'test mode leaked into lifetime rating');
});

/* ===================== readiness ===================== */

test('readiness needs a real sample before judging', () => {
  const verdict = assessReadiness({ accuracy: 100, decisions: 5, countAccuracy: 100 });
  assert.equal(verdict.ready, false);
  assert.equal(verdict.grade, '—');
});

test('near-perfect play across the board is judged casino-ready', () => {
  const verdict = assessReadiness({
    accuracy: 99, deviationAccuracy: 95, countAccuracy: 100, decisions: 60, countChecks: 4
  });

  assert.equal(verdict.ready, true);
  assert.equal(verdict.grade, 'A');
});

test('a dropped count sinks the grade even with perfect strategy', () => {
  const verdict = assessReadiness({
    accuracy: 100, deviationAccuracy: 100, countAccuracy: 40, decisions: 60, countChecks: 4
  });

  assert.equal(verdict.ready, false);
  assert.ok(
    verdict.notes.some(note => /count/i.test(note)),
    'the count problem should be called out'
  );
});

test('weak basic strategy is judged on its weakest link, not an average', () => {
  const verdict = assessReadiness({
    accuracy: 70, deviationAccuracy: 100, countAccuracy: 100, decisions: 60, countChecks: 4
  });

  assert.equal(verdict.ready, false);
  assert.ok(['C', 'D', 'F'].includes(verdict.grade), `unexpected grade ${verdict.grade}`);
});

/* ===================== coaching ===================== */

test('doubling 9 against a 7 is marked wrong with the expected coaching', () => {
  const cards = [{ rank: '4' }, { rank: '5' }];
  const result = explain({
    hand: describeHand(cards), cards, up: 7, chosen: 'double', rules: H17
  });

  assert.equal(result.correct, false);
  assert.equal(result.best, 'hit');
  assert.ok(result.cost > 0, 'the mistake should have a cost');
  assert.match(result.reason, /dealer strength/i);
  // The tip should quote the dealer's actual bust rate for a 7
  assert.match(result.tip, /busts only 2\d%/);
});

test('a correct play is confirmed and costs nothing', () => {
  const cards = [{ rank: '10' }, { rank: '10' }];
  const result = explain({
    hand: describeHand(cards), cards, up: 6, chosen: 'stand', rules: H17
  });

  assert.equal(result.correct, true);
  assert.equal(result.best, 'stand');
  assert.ok(Math.abs(result.cost) < 1e-9);
});

test('a near-tie is accepted but flagged as marginal', () => {
  // A,2 vs 5 is the classic coin-flip cell
  const cards = [{ rank: 'ace' }, { rank: '2' }];
  const result = explain({
    hand: describeHand(cards), cards, up: 5, chosen: 'double', rules: H17
  });

  assert.equal(result.correct, true, 'the chart play should not be marked wrong');
  assert.equal(result.marginal, true, 'a close call should be flagged as such');
});

test('splitting a made 20 is called out specifically', () => {
  const cards = [{ rank: 'king' }, { rank: 'king' }];
  const result = explain({
    hand: describeHand(cards), cards, up: 6, chosen: 'split', rules: H17
  });

  assert.equal(result.correct, false);
  assert.match(result.reason, /never split a made 20/i);
});

test('failing to split 8s is coached as the always-split rule', () => {
  const cards = [{ rank: '8' }, { rank: '8' }];
  const result = explain({
    hand: describeHand(cards), cards, up: 6, chosen: 'hit', rules: H17
  });

  assert.equal(result.correct, false);
  assert.equal(result.best, 'split');
  assert.match(result.reason, /always split 8s/i);
});

test('bust chance on hit is right at the extremes', () => {
  assert.equal(bustChanceOnHit(11, false), 0, 'you cannot bust drawing to 11');
  assert.ok(Math.abs(bustChanceOnHit(21, false) - 1) < 1e-9, 'drawing to 21 always busts');
  // Hard 16 busts on 6 through 10 plus face cards
  assert.ok(bustChanceOnHit(16, false) > 0.6 && bustChanceOnHit(16, false) < 0.65);
  // A soft hand cannot bust on one card
  assert.equal(bustChanceOnHit(17, true), 0);
});

test('EV formatting is signed and readable', () => {
  assert.equal(formatEv(0.235), '+23.5%');
  assert.equal(formatEv(-0.5), '-50.0%');
  assert.equal(formatEv(null), '—');
});

/* ===================== profiles and seats ===================== */

async function withDom(run) {
  const dom = new JSDOM('<!DOCTYPE html><div id="app"></div>', {
    url: 'https://example.test/', pretendToBeVisual: true
  });
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.Node = dom.window.Node;
  global.localStorage = dom.window.localStorage;
  Object.defineProperty(global, 'navigator', {
    value: dom.window.navigator, configurable: true, writable: true
  });
  dom.window.localStorage.clear();

  return run(dom);
}

test('profiles are created, switched and deleted', async () => {
  await withDom(async () => {
    const profiles = await import(`../src/profiles.js?t=${Math.random()}`);

    const first = profiles.activePlayer();
    assert.ok(first.id, 'no default player was created');
    assert.equal(profiles.listPlayers().length, 1);

    const second = profiles.addPlayer('Friend');
    assert.equal(second.name, 'Friend');
    assert.equal(profiles.activePlayer().id, second.id, 'new player should become active');

    profiles.selectPlayer(first.id);
    assert.equal(profiles.activePlayer().id, first.id);

    assert.equal(profiles.removePlayer(second.id), true);
    assert.equal(profiles.listPlayers().length, 1);

    // The last player cannot be removed
    assert.equal(profiles.removePlayer(first.id), false);
  });
});

test('each profile keeps its own bankroll and progression', async () => {
  await withDom(async () => {
    const profiles = await import(`../src/profiles.js?t=${Math.random()}`);
    const { applyResult: apply } = await import(`../src/rating.js?t=${Math.random()}`);

    const a = profiles.activePlayer();
    a.bankroll = 4321;
    a.modes.normal = apply(a.modes.normal, { correct: true, mode: 'normal', kind: 'play' });
    profiles.savePlayer(a);

    const b = profiles.addPlayer('Second');
    assert.notEqual(b.bankroll, 4321, 'bankroll leaked between players');
    assert.equal(b.modes.normal.rating, 0, 'progression leaked between players');

    profiles.selectPlayer(a.id);
    const revived = profiles.activePlayer();
    assert.equal(revived.bankroll, 4321);
    assert.ok(revived.modes.normal.rating > 0);
  });
});

test('resetting progress keeps the player but clears their record', async () => {
  await withDom(async () => {
    const profiles = await import(`../src/profiles.js?t=${Math.random()}`);
    const { applyResult: apply } = await import(`../src/rating.js?t=${Math.random()}`);

    const player = profiles.activePlayer();
    player.modes.hard = apply(player.modes.hard, { correct: true, mode: 'hard', kind: 'play' });
    player.exams = [{ grade: 'B' }];
    profiles.savePlayer(player);

    profiles.resetProgress(player.id);

    const after = profiles.activePlayer();
    assert.equal(after.id, player.id, 'the player should survive a reset');
    assert.equal(after.modes.hard.rating, 0);
    assert.deepEqual(after.exams, []);
  });
});

test('a corrupt profile store falls back to a fresh player', async () => {
  await withDom(async dom => {
    dom.window.localStorage.setItem('ccapp:players:v1', 'not json');
    const profiles = await import(`../src/profiles.js?t=${Math.random()}`);

    const player = profiles.activePlayer();
    assert.ok(player && player.id, 'corrupt store should not block startup');
  });
});

test('other players are seated around the human and act on their own', async () => {
  await withDom(async dom => {
    const { applyDifficulty } = await import(`../src/difficulty.js?t=${Math.random()}`);
    const { DEFAULT_SETTINGS } = await import(`../src/storage.js?t=${Math.random()}`);

    const settings = {
      ...applyDifficulty(DEFAULT_SETTINGS, 'easy'),
      otherPlayers: 3,
      seatIndex: 2,
      seatDelayMs: 5   // keep the test quick
    };
    dom.window.localStorage.setItem('ccapp:v1', JSON.stringify({ settings }));

    const { default: App } = await import(`../src/ui/App.js?t=${Math.random()}`);
    const app = new App(dom.window.document.getElementById('app'));

    assert.equal(app.game.players.length, 4, 'wrong number of seats');
    assert.equal(app.seatIndex, 2);
    assert.equal(app.game.players[2].name, 'You');
    assert.equal(app.game.players[0].isBot, true);
    assert.equal(app.game.players[3].isBot, true);

    // Dealing should stake every seat, not just the human
    const deal = [...dom.window.document.querySelectorAll('button')]
      .find(b => /^Deal /i.test(b.textContent.trim()));
    deal.click();

    app.game.players.forEach((player, index) => {
      assert.ok(
        player.hands[0].cards.length === 2,
        `seat ${index} was not dealt in`
      );
    });

    // Bots ahead of the human must act before the turn reaches them
    await new Promise(resolve => setTimeout(resolve, 300));

    if (app.game.gamePhase === 'playerTurn') {
      assert.ok(
        app.game.currentPlayerIndex >= 2,
        `turn stalled on bot seat ${app.game.currentPlayerIndex}`
      );
    }

    clearTimeout(app.botTimer);
    app._stopTimer();
  });
});

test('the human keeps their own seat position after a reshuffle of settings', async () => {
  await withDom(async dom => {
    const { applyDifficulty } = await import(`../src/difficulty.js?t=${Math.random()}`);
    const { DEFAULT_SETTINGS } = await import(`../src/storage.js?t=${Math.random()}`);

    const settings = {
      ...applyDifficulty(DEFAULT_SETTINGS, 'easy'),
      otherPlayers: 2,
      seatIndex: 5,      // deliberately out of range
      seatDelayMs: 5
    };
    dom.window.localStorage.setItem('ccapp:v1', JSON.stringify({ settings }));

    const { default: App } = await import(`../src/ui/App.js?t=${Math.random()}`);
    const app = new App(dom.window.document.getElementById('app'));

    // An out-of-range seat should clamp to the last seat, not crash
    assert.equal(app.seatIndex, 2);
    assert.equal(app.game.players[2].name, 'You');

    clearTimeout(app.botTimer);
    app._stopTimer();
  });
});
