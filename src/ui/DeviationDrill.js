/**
 * DeviationDrill.js
 *
 * Drills the Illustrious 18 in isolation. Each spot shows a hand, an upcard
 * and a true count, and asks for the play. The count is deliberately set close
 * to the index — a spot at +9 answers itself and teaches nothing.
 *
 * Unlike the strategy drill, the right answer here depends on the count, so
 * getting it right means knowing both the index and which side of it you're on.
 */

import { ILLUSTRIOUS_18, playFor, handLabel, upLabel, indexLabel, drillCountFor }
  from '../deviations.js';
import { el, replace, signed, buzz } from './dom.js';
import { renderCard } from './CardView.js';

const ACTION_LABELS = {
  hit: 'Hit',
  stand: 'Stand',
  double: 'Double',
  split: 'Split',
  insure: 'Take insurance',
  decline: 'No insurance'
};

/** Build a display card for a rank value */
function card(value, suit) {
  const rank = value === 1 ? 'ace' : value === 10 ? '10' : String(value);
  return { id: Math.floor(Math.random() * 1e6), suit, rank, faceUp: true };
}

/** Two cards that add to a hard total without making a pair or a soft hand */
function cardsForTotal(total) {
  // Keep both cards between 2 and 10 and avoid an accidental pair
  for (let first = 2; first <= 10; first++) {
    const second = total - first;
    if (second >= 2 && second <= 10 && second !== first) {
      return [card(first, 'spades'), card(second, 'hearts')];
    }
  }
  // Totals like 4 can only be made as a pair; fall back to one
  const half = Math.floor(total / 2);
  return [card(half, 'spades'), card(total - half, 'hearts')];
}

class DeviationDrill {
  /**
   * @param {HTMLElement} container
   * @param {Object} options - haptics, sound, log, onResult, onExit
   */
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      haptics: true,
      sound: null,
      log: null,
      onResult: () => {},
      onExit: () => {},
      ...options
    };

    this.asked = 0;
    this.right = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.feedback = null;
    this.recent = [];

    this._build();
    this.next();
  }

  /**
   * Pick the next index play, avoiding immediate repeats.
   * @private
   */
  _pickEntry() {
    for (let attempt = 0; attempt < 20; attempt++) {
      const entry = ILLUSTRIOUS_18[Math.floor(Math.random() * ILLUSTRIOUS_18.length)];
      if (!this.recent.includes(entry.id)) {
        this.recent = [entry.id, ...this.recent].slice(0, 5);
        return entry;
      }
    }
    return ILLUSTRIOUS_18[0];
  }

  /** Deal the next spot */
  next() {
    this.feedback = null;
    this.entry = this._pickEntry();
    this.trueCount = drillCountFor(this.entry);

    if (this.entry.kind === 'insurance') {
      this.cards = [];
    } else if (this.entry.kind === 'pair') {
      this.cards = [card(this.entry.pairValue, 'spades'), card(this.entry.pairValue, 'hearts')];
    } else {
      this.cards = cardsForTotal(this.entry.total);
    }

    this.upCard = card(this.entry.up, 'clubs');
    this.render();
  }

  /**
   * Submit an answer.
   * @param {string} action
   */
  answer(action) {
    if (this.feedback) return;

    const expected = playFor(this.entry, this.trueCount);
    const correct = action === expected;

    this.asked++;
    if (correct) {
      this.right++;
      this.streak++;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
    } else {
      this.streak = 0;
    }

    this.feedback = { correct, expected, played: action };

    if (this.options.haptics) buzz(correct ? 8 : 25);
    if (this.options.sound) this.options.sound.play(correct ? 'correct' : 'wrong');

    if (this.options.log) {
      this.options.log.append('deviationDrill', {
        spot: this.entry.id,
        trueCount: this.trueCount,
        index: this.entry.index,
        played: action,
        expected,
        correct
      });
    }

    // Deviations are their own skill, so they are graded as such
    this.options.onResult({
      correct,
      isDeviation: true,
      kind: 'play',
      mode: 'deviations'
    });

    this.render();
  }

  /* ===================== structure ===================== */

  /** @private */
  _build() {
    this.nodes = {};

    this.nodes.score = el('span.status__value', { text: '0/0' });
    this.nodes.streak = el('span.status__value', { text: '0' });
    this.nodes.count = el('div.devcount');
    this.nodes.dealerCard = el('div.hand__cards');
    this.nodes.playerCards = el('div.hand__cards');
    this.nodes.prompt = el('div.drill__feedback');
    this.nodes.controls = el('footer.controls');

    replace(this.container, [
      el('header.status', {}, [
        el('div.status__stat', {}, [
          el('span.status__label', { text: 'Correct' }),
          this.nodes.score
        ]),
        el('button.btn', { type: 'button', text: 'Exit', onclick: () => this.destroy(true) }),
        el('div.status__stat.status__stat--right', {}, [
          el('span.status__label', { text: 'Streak' }),
          this.nodes.streak
        ])
      ]),
      el('main.felt.strategy', {}, [
        this.nodes.count,
        el('section.seat', {}, [
          el('div.seat__label', {}, el('span', { text: 'Dealer shows' })),
          this.nodes.dealerCard
        ]),
        el('section.seat', {}, [
          this.nodes.playerCards,
          el('div.seat__label', {}, el('span', { text: 'Your hand' }))
        ]),
        this.nodes.prompt
      ]),
      this.nodes.controls
    ]);
  }

  /* ===================== rendering ===================== */

  render() {
    this.nodes.score.textContent = `${this.right}/${this.asked}`;
    this.nodes.streak.textContent = String(this.streak);

    // The true count is the whole point here, so it is shown prominently
    replace(this.nodes.count, el('div.devcount__box', {}, [
      el('span.devcount__label', { text: 'TRUE COUNT' }),
      el('span.devcount__value' + (this.trueCount >= 0 ? '.is-pos' : '.is-neg'), {
        text: signed(this.trueCount)
      })
    ]));

    replace(this.nodes.dealerCard, renderCard(this.upCard, 0));
    replace(
      this.nodes.playerCards,
      this.cards.length
        ? this.cards.map((c, i) => renderCard(c, i))
        : el('p.strategy__ask', { text: 'Dealer is showing an ace and offers insurance.' })
    );

    this._renderPrompt();
    this._renderControls();
  }

  /** @private */
  _renderPrompt() {
    if (!this.feedback) {
      replace(this.nodes.prompt, el('p.strategy__ask', {
        text: this.entry.kind === 'insurance'
          ? 'Do you take insurance?'
          : `${handLabel(this.entry)} against ${upLabel(this.entry)} at a true count of ` +
            `${signed(this.trueCount)} — what's the play?`
      }));
      return;
    }

    const { correct, expected, played } = this.feedback;
    const side = this.trueCount >= this.entry.index ? 'at or above' : 'below';

    replace(this.nodes.prompt, el('div.verdict' + (correct ? '.is-right' : '.is-wrong'), {}, [
      el('div.verdict__head', {}, [
        el('span.verdict__word', { text: correct ? 'CORRECT' : 'WRONG' }),
        el('span.advice__tag', { text: indexLabel(this.entry) })
      ]),

      correct
        ? el('p.verdict__line', { text: `${ACTION_LABELS[expected]} is right here.` })
        : el('p.verdict__line', {}, [
            el('span', { text: 'Correct play: ' }),
            el('strong.verdict__best', { text: ACTION_LABELS[expected] }),
            el('span.verdict__ev', { text: ` (you played ${ACTION_LABELS[played]})` })
          ]),

      el('p.verdict__reason', {
        text: `The index is ${indexLabel(this.entry)}, and ${signed(this.trueCount)} is ` +
              `${side} it — so ${ACTION_LABELS[expected].toLowerCase()}.`
      }),

      el('p.verdict__tip', {}, [
        el('span.verdict__tipLabel', { text: 'WHY ' }),
        el('span', { text: this.entry.note })
      ])
    ]));
  }

  /** @private */
  _renderControls() {
    if (this.feedback) {
      replace(this.nodes.controls, el('div.actions', {}, [
        el('button.btn.btn--primary.btn--wide', {
          type: 'button', text: 'Next spot', onclick: () => this.next()
        })
      ]));
      return;
    }

    // Offer only the two plays this index actually chooses between, plus a
    // plausible distractor so the answer isn't given away by the buttons.
    const choices = this.entry.kind === 'insurance'
      ? ['insure', 'decline']
      : [...new Set([this.entry.atOrAbove, this.entry.below, 'hit', 'stand'])].slice(0, 4);

    replace(this.nodes.controls, el('div.actions', {}, choices.map(action => el('button.btn', {
      type: 'button',
      text: ACTION_LABELS[action],
      onclick: () => this.answer(action)
    }))));
  }

  /** Tear down and optionally notify the caller */
  destroy(notify = false) {
    if (notify) this.options.onExit();
  }
}

export default DeviationDrill;
