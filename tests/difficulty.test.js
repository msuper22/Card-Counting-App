/**
 * difficulty.test.js
 *
 * Difficulty presets, the count drill, and the diagnostic log.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { DIFFICULTIES, applyDifficulty, detectDifficulty } from '../src/difficulty.js';
import { DEFAULT_SETTINGS } from '../src/storage.js';

/* ===================== presets ===================== */

test('each preset sets a coherent bundle of flags', () => {
  const easy = applyDifficulty(DEFAULT_SETTINGS, 'easy');
  assert.equal(easy.showCount, true);
  assert.equal(easy.showAdvice, true);
  assert.equal(easy.postHandReview, false, 'easy already advises live');

  const normal = applyDifficulty(DEFAULT_SETTINGS, 'normal');
  assert.equal(normal.showCount, true, 'normal keeps the count on screen');
  assert.equal(normal.showAdvice, false, 'normal must not pre-announce the play');
  assert.equal(normal.postHandReview, true, 'normal explains misplays afterwards');

  const hard = applyDifficulty(DEFAULT_SETTINGS, 'hard');
  assert.equal(hard.showCount, false);
  assert.equal(hard.allowCountPeek, false, 'hard must not allow peeking');
  assert.equal(hard.showAdvice, false);
  assert.equal(hard.showHandTotals, false);
  assert.equal(hard.countAudits, true);
  assert.equal(hard.gradeBets, true);
  assert.ok(hard.decisionSeconds > 0);
  assert.equal(hard.postHandReview, false, 'hard reports at session end only');
});

test('difficulty round-trips through detection', () => {
  ['easy', 'normal', 'hard'].forEach(key => {
    const settings = applyDifficulty(DEFAULT_SETTINGS, key);
    assert.equal(detectDifficulty(settings), key);
  });
});

test('hand-tuning a flag drops you to custom', () => {
  const settings = applyDifficulty(DEFAULT_SETTINGS, 'hard');
  assert.equal(detectDifficulty({ ...settings, showHandTotals: true }), 'custom');
});

/* ===================== count drill ===================== */

/** Deal the whole shoe synchronously, answering every check with `answerWith`. */
function runDrill(drill, answerWith = () => 0) {
  drill.running = false;  // drive it by hand instead of on a timer

  let guard = 0;
  while (!drill.finished && guard++ < 5000) {
    if (drill.awaitingAnswer) {
      drill.answer(answerWith(drill));
      drill.lastResult = null;
      continue;
    }
    if (drill.deck.isEmpty()) {
      drill._finish();
      break;
    }
    drill._dealNext();
  }

  return drill;
}

async function makeDrill(options = {}) {
  const dom = new JSDOM('<!DOCTYPE html><div id="app"></div>', { url: 'https://example.test/' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  global.HTMLElement = dom.window.HTMLElement;
  global.Node = dom.window.Node;
  Object.defineProperty(global, 'navigator', {
    value: dom.window.navigator, configurable: true, writable: true
  });
  dom.window.localStorage.clear();

  const { default: CountDrill } = await import(`../src/ui/CountDrill.js?t=${Math.random()}`);
  const container = dom.window.document.getElementById('app');

  return {
    dom,
    drill: new CountDrill(container, { decks: 1, checksPerShoe: 3, ...options })
  };
}

test('the drill deals the whole shoe exactly once', async () => {
  const { drill } = await makeDrill({ decks: 1 });
  runDrill(drill);

  assert.equal(drill.dealt, 52, 'did not deal every card');
  assert.equal(drill.deck.getCount(), 0);
  assert.equal(drill.finished, true);
  drill.destroy();
});

test('a fully dealt Hi-Lo shoe ends on a running count of zero', async () => {
  const { drill } = await makeDrill({ decks: 2, countingSystem: 'HI_LO' });
  runDrill(drill);

  // Every deck is count-neutral, so a complete shoe must balance to zero.
  assert.equal(drill.counter.getRunningCount(), 0);
  drill.destroy();
});

test('the drill pauses for count checks and grades them', async () => {
  const { drill } = await makeDrill({ decks: 1, checksPerShoe: 3 });

  let pauses = 0;
  drill.running = false;

  let guard = 0;
  while (!drill.finished && guard++ < 5000) {
    if (drill.awaitingAnswer) {
      pauses++;
      // Answer correctly every other time so both paths are exercised
      const answer = pauses % 2 === 0
        ? drill.counter.getRunningCount()
        : drill.counter.getRunningCount() + 3;
      drill.answer(answer);
      drill.lastResult = null;
      continue;
    }
    if (drill.deck.isEmpty()) { drill._finish(); break; }
    drill._dealNext();
  }

  assert.ok(pauses >= 2, `expected several count checks, saw ${pauses}`);
  assert.equal(drill.checks.length, pauses);

  const correct = drill.checks.filter(check => check.correct).length;
  assert.ok(correct > 0, 'correct answers were not credited');
  assert.ok(correct < drill.checks.length, 'wrong answers were not caught');

  // A wrong answer records how far off it was
  const wrong = drill.checks.find(check => !check.correct);
  assert.equal(wrong.off, 3);
  drill.destroy();
});

test('checks never land in the opening cards', async () => {
  const { drill } = await makeDrill({ decks: 6, checksPerShoe: 6 });
  [...drill.checkpoints].forEach(point => {
    assert.ok(point >= 12, `check at card ${point} is too early to be meaningful`);
  });
  drill.destroy();
});

test('drill speed can be changed mid-shoe', async () => {
  const { drill } = await makeDrill({ decks: 1, speed: 'slow' });

  const slow = drill._speedMs();
  drill.setSpeed('blitz');
  const fast = drill._speedMs();

  assert.ok(fast < slow, 'blitz should deal faster than slow');
  assert.equal(drill.options.speed, 'blitz');
  drill.destroy();
});

test('drill start and pause control the timer', async () => {
  const { drill } = await makeDrill({ decks: 1 });

  drill.start();
  assert.equal(drill.running, true);
  assert.ok(drill.timer, 'no timer armed after start');

  drill.pause();
  assert.equal(drill.running, false);
  assert.equal(drill.timer, null, 'timer still armed after pause');

  drill.destroy();
});

/* ===================== game log ===================== */

test('the log records events and survives a reload', async () => {
  const dom = new JSDOM('<!DOCTYPE html>', { url: 'https://example.test/' });
  global.window = dom.window;
  global.localStorage = dom.window.localStorage;
  Object.defineProperty(global, 'navigator', {
    value: dom.window.navigator, configurable: true, writable: true
  });
  dom.window.localStorage.clear();

  const { default: GameLog } = await import(`../src/GameLog.js?t=${Math.random()}`);

  const log = new GameLog();
  log.append('bet', { amount: 25, tc: 2 });
  log.append('decision', { played: 'hit', correct: false, expected: 'stand' });

  assert.ok(log.size() >= 3, 'entries were not recorded');
  assert.match(log.toText(true), /decision/);
  assert.match(log.toText(true), /expected=stand/);

  const parsed = JSON.parse(log.toJSON(true));
  assert.ok(Array.isArray(parsed.entries));
  assert.ok(parsed.entries.some(entry => entry.type === 'bet' && entry.amount === 25));

  // A second instance picks up the persisted history
  const revived = new GameLog();
  assert.ok(
    revived.entries.some(entry => entry.type === 'decision'),
    'log did not survive a reload'
  );
});

test('a corrupt log does not stop the app starting', async () => {
  const dom = new JSDOM('<!DOCTYPE html>', { url: 'https://example.test/' });
  global.window = dom.window;
  global.localStorage = dom.window.localStorage;
  Object.defineProperty(global, 'navigator', {
    value: dom.window.navigator, configurable: true, writable: true
  });

  dom.window.localStorage.setItem('ccapp:log:v1', '{not json at all');

  const { default: GameLog } = await import(`../src/GameLog.js?t=${Math.random()}`);
  const log = new GameLog();

  assert.ok(log.size() >= 1, 'log should recover and start fresh');
});
