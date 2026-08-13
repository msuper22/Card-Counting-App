/**
 * deviations.test.js
 *
 * The Illustrious 18 table, the deviation drill, and the sound engine.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import {
  ILLUSTRIOUS_18, playFor, handLabel, upLabel, indexLabel, drillCountFor
} from '../src/deviations.js';
import Strategy from '../src/Strategy.js';
import Hand from '../src/Hand.js';
import Card from '../src/Card.js';

/* ===================== the table ===================== */

test('the table holds eighteen distinct index plays', () => {
  assert.equal(ILLUSTRIOUS_18.length, 18);

  const ids = ILLUSTRIOUS_18.map(entry => entry.id);
  assert.equal(new Set(ids).size, 18, 'duplicate entries in the table');
});

test('every entry is well formed', () => {
  ILLUSTRIOUS_18.forEach(entry => {
    assert.ok(['hard', 'pair', 'insurance'].includes(entry.kind), `${entry.id}: bad kind`);
    assert.equal(typeof entry.index, 'number', `${entry.id}: missing index`);
    assert.ok(entry.atOrAbove, `${entry.id}: missing at-or-above play`);
    assert.ok(entry.below, `${entry.id}: missing below play`);
    assert.notEqual(entry.atOrAbove, entry.below, `${entry.id}: index play does nothing`);
    assert.ok(entry.note && entry.note.length > 20, `${entry.id}: missing explanation`);
    assert.ok(entry.basicPlay, `${entry.id}: missing basic play`);
    assert.ok(entry.up >= 1 && entry.up <= 10, `${entry.id}: bad upcard`);
  });
});

test('the headline indices match the published figures', () => {
  const byId = Object.fromEntries(ILLUSTRIOUS_18.map(entry => [entry.id, entry]));

  assert.equal(byId.insurance.index, 3);
  assert.equal(byId['16v10'].index, 0);
  assert.equal(byId['15v10'].index, 4);
  assert.equal(byId['12v3'].index, 2);
  assert.equal(byId['12v2'].index, 3);
  assert.equal(byId['16v9'].index, 5);
  assert.equal(byId['10-10v5'].index, 5);
  assert.equal(byId['10-10v6'].index, 4);
});

test('the play flips at the index and not before', () => {
  const sixteenVsTen = ILLUSTRIOUS_18.find(entry => entry.id === '16v10');

  assert.equal(playFor(sixteenVsTen, -1), 'hit');
  assert.equal(playFor(sixteenVsTen, 0), 'stand', 'index play should apply at the index');
  assert.equal(playFor(sixteenVsTen, 5), 'stand');

  // A negative index behaves the same way
  const twelveVsFive = ILLUSTRIOUS_18.find(entry => entry.id === '12v5');
  assert.equal(twelveVsFive.index, -2);
  assert.equal(playFor(twelveVsFive, -1), 'stand');
  assert.equal(playFor(twelveVsFive, -2), 'stand');
  assert.equal(playFor(twelveVsFive, -3), 'hit');
});

test('below-index plays agree with basic strategy', () => {
  // Away from the count, each index play should collapse to the book play
  // Surrender off, since the index plays are stated against a no-surrender book
  const strategy = new Strategy({ hitSoft17: true, surrender: false });
  const card = rank => new Card(1, 'spades', rank);
  const CODE = { H: 'hit', S: 'stand', D: 'double', P: 'split' };

  const mismatches = [];

  ILLUSTRIOUS_18.forEach(entry => {
    if (entry.kind === 'insurance') return;

    const hand = new Hand();
    if (entry.kind === 'pair') {
      hand.addCard(card('10'));
      hand.addCard(card('10'));
    } else {
      // Build the total without making a pair or a soft hand
      const first = entry.total - 2 <= 10 && entry.total - 2 !== 2 ? 2 : 3;
      hand.addCard(card(String(first)));
      hand.addCard(card(String(entry.total - first)));
    }

    const upRank = entry.up === 1 ? 'ace' : String(entry.up);
    const basic = CODE[strategy.getBasicStrategyPlay(hand, card(upRank))];

    // The entry states which play is plain basic strategy; check it agrees
    // with the strategy engine, and that the index really does depart from it.
    if (basic && entry.basicPlay !== basic) {
      mismatches.push(`${entry.id}: table says basic is ${entry.basicPlay}, engine says ${basic}`);
    }
    if (![entry.atOrAbove, entry.below].includes(entry.basicPlay)) {
      mismatches.push(`${entry.id}: basic play ${entry.basicPlay} is on neither side of the index`);
    }
  });

  assert.deepEqual(mismatches, [], mismatches.join('\n'));
});

test('drill counts land near the index, on both sides', () => {
  const entry = ILLUSTRIOUS_18.find(e => e.id === '16v10');

  let above = 0;
  let below = 0;

  for (let i = 0; i < 400; i++) {
    const count = drillCountFor(entry);
    assert.ok(
      Math.abs(count - entry.index) <= 3,
      `count ${count} is too far from index ${entry.index} to teach anything`
    );
    if (count >= entry.index) above++; else below++;
  }

  assert.ok(above > 50 && below > 50, `lopsided sampling: ${above} above, ${below} below`);
});

test('labels read the way a chart would', () => {
  const byId = Object.fromEntries(ILLUSTRIOUS_18.map(entry => [entry.id, entry]));

  assert.equal(handLabel(byId['16v10']), '16');
  assert.equal(handLabel(byId['10-10v5']), '10,10');
  assert.equal(handLabel(byId.insurance), 'Insurance');
  assert.equal(upLabel(byId['11vA']), 'A');
  assert.equal(upLabel(byId['12v3']), '3');
  assert.equal(indexLabel(byId['12v3']), '≥ +2');
  assert.equal(indexLabel(byId['12v5']), '≥ -2');
});

/* ===================== sound ===================== */

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

test('sound degrades quietly when the browser has no audio', async () => {
  await withDom(async () => {
    const { default: Sound } = await import(`../src/sound.js?t=${Math.random()}`);

    // jsdom has no AudioContext, which is exactly the unsupported case
    const sound = new Sound({ enabled: true });

    assert.equal(sound.unlock(), false, 'should report audio unavailable');
    assert.doesNotThrow(() => sound.play('deal'), 'playing must never throw');
    assert.doesNotThrow(() => sound.play('nonexistent'));
    assert.equal(sound.failed, true, 'should stop retrying after the first failure');
  });
});

test('sound can be switched off and on', async () => {
  await withDom(async () => {
    const { default: Sound } = await import(`../src/sound.js?t=${Math.random()}`);

    const sound = new Sound({ enabled: false });
    assert.equal(sound.enabled, false);
    assert.equal(sound.unlock(), false, 'disabled audio should not open a context');

    sound.setEnabled(true);
    assert.equal(sound.enabled, true);
  });
});

test('every voice used by the app is defined', async () => {
  await withDom(async () => {
    const { VOICES } = await import(`../src/sound.js?t=${Math.random()}`);

    ['deal', 'chip', 'win', 'lose', 'push', 'blackjack', 'correct', 'wrong', 'prompt', 'shuffle']
      .forEach(name => {
        assert.ok(VOICES[name], `missing voice: ${name}`);
        assert.ok(VOICES[name].duration > 0 && VOICES[name].duration < 1);
        assert.ok(VOICES[name].gain > 0 && VOICES[name].gain <= 0.3, `${name} is too loud`);
      });
  });
});

/* ===================== the drill ===================== */

test('the deviation drill grades against the index', async () => {
  await withDom(async dom => {
    const { default: DeviationDrill } = await import(`../src/ui/DeviationDrill.js?t=${Math.random()}`);

    const graded = [];
    const drill = new DeviationDrill(dom.window.document.getElementById('app'), {
      haptics: false,
      onResult: event => graded.push(event)
    });

    // Force a known spot on the stand side of the index
    drill.entry = ILLUSTRIOUS_18.find(e => e.id === '16v10');
    drill.trueCount = 2;
    drill.render();

    drill.answer('stand');
    assert.equal(drill.feedback.correct, true, 'standing at +2 on 16 vs 10 is correct');
    assert.equal(drill.right, 1);
    assert.equal(drill.streak, 1);

    // Now the other side of the same index
    drill.next();
    drill.entry = ILLUSTRIOUS_18.find(e => e.id === '16v10');
    drill.trueCount = -3;
    drill.feedback = null;
    drill.render();

    drill.answer('stand');
    assert.equal(drill.feedback.correct, false, 'standing at -3 should be wrong');
    assert.equal(drill.feedback.expected, 'hit');
    assert.equal(drill.streak, 0, 'a mistake should break the streak');

    // Results are reported as deviation plays so they rate separately
    assert.equal(graded.length, 2);
    graded.forEach(event => {
      assert.equal(event.isDeviation, true);
      assert.equal(event.mode, 'deviations');
    });

    drill.destroy();
  });
});

test('the drill always offers the correct answer among its choices', async () => {
  await withDom(async dom => {
    const { default: DeviationDrill } = await import(`../src/ui/DeviationDrill.js?t=${Math.random()}`);
    const drill = new DeviationDrill(dom.window.document.getElementById('app'), { haptics: false });

    // Walk the whole table on both sides of every index
    ILLUSTRIOUS_18.forEach(entry => {
      [entry.index + 1, entry.index - 1].forEach(trueCount => {
        drill.entry = entry;
        drill.trueCount = trueCount;
        drill.feedback = null;
        drill.cards = entry.kind === 'insurance' ? [] : drill.cards;
        drill.render();

        const labels = [...dom.window.document.querySelectorAll('.controls button')]
          .map(node => node.textContent.trim().toLowerCase());
        const expected = playFor(entry, trueCount);
        const expectedLabel = {
          hit: 'hit', stand: 'stand', double: 'double', split: 'split',
          insure: 'take insurance', decline: 'no insurance'
        }[expected];

        assert.ok(
          labels.includes(expectedLabel),
          `${entry.id} at TC ${trueCount}: "${expectedLabel}" not offered (had ${labels.join(', ')})`
        );
      });
    });

    drill.destroy();
  });
});

test('insurance spots present as a yes or no question', async () => {
  await withDom(async dom => {
    const { default: DeviationDrill } = await import(`../src/ui/DeviationDrill.js?t=${Math.random()}`);
    const drill = new DeviationDrill(dom.window.document.getElementById('app'), { haptics: false });

    drill.entry = ILLUSTRIOUS_18.find(e => e.kind === 'insurance');
    drill.trueCount = 4;
    drill.cards = [];
    drill.feedback = null;
    drill.render();

    const labels = [...dom.window.document.querySelectorAll('.controls button')]
      .map(node => node.textContent.trim());
    assert.deepEqual(labels, ['Take insurance', 'No insurance']);

    drill.answer('insure');
    assert.equal(drill.feedback.correct, true, 'insurance is correct at +4');

    drill.destroy();
  });
});
