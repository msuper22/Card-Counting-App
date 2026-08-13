/**
 * CountDrill.js
 *
 * A pure counting drill: burn through a shoe one card at a time at a speed you
 * control, with the app stopping at random to ask what the running count is.
 *
 * This deliberately bypasses the blackjack game. There are no hands, bets or
 * decisions - just cards and the count, which is the skill being drilled.
 */

import Deck from '../Deck.js';
import Counter from '../Counter.js';
import { el, replace, signed, buzz } from './dom.js';
import { renderCard } from './CardView.js';

// Milliseconds per card. Slower is easier; blitz is faster than most dealers.
export const SPEEDS = [
  { key: 'slow', label: 'Slow', ms: 1600 },
  { key: 'steady', label: 'Steady', ms: 1000 },
  { key: 'brisk', label: 'Brisk', ms: 650 },
  { key: 'fast', label: 'Fast', ms: 400 },
  { key: 'blitz', label: 'Blitz', ms: 220 }
];

class CountDrill {
  /**
   * @param {HTMLElement} container - Element to render the drill into
   * @param {Object} options - decks, countingSystem, speed, haptics, log, onExit
   */
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      decks: 6,
      countingSystem: 'HI_LO',
      speed: 'steady',
      haptics: true,
      checksPerShoe: 4,
      log: null,
      onExit: () => {},
      ...options
    };

    this.deck = new Deck(this.options.decks);
    this.deck.shuffle();
    this.counter = new Counter(this.options.countingSystem, this.options.decks);

    this.totalCards = this.deck.getCount();
    this.dealt = 0;
    this.current = null;
    this.running = false;
    this.finished = false;
    this.timer = null;

    this.checks = [];        // graded answers
    this.awaitingAnswer = false;
    this.checkpoints = this._planCheckpoints();

    this._build();
    this.render();
  }

  /**
   * Decide, up front, which card indices will trigger a count check.
   * Planned in advance so the pauses can't correlate with anything on screen.
   * @private
   */
  _planCheckpoints() {
    const count = this.options.checksPerShoe;
    const points = new Set();

    // Spread them over the shoe, jittered inside each band, never in the first
    // handful of cards where the answer is trivially small.
    const band = Math.floor(this.totalCards / (count + 1));

    for (let i = 1; i <= count; i++) {
      const centre = band * i;
      const jitter = Math.floor((Math.random() - 0.5) * band * 0.6);
      points.add(Math.max(12, Math.min(this.totalCards - 1, centre + jitter)));
    }

    return points;
  }

  /** @private */
  _speedMs() {
    const found = SPEEDS.find(speed => speed.key === this.options.speed);
    return (found || SPEEDS[1]).ms;
  }

  /* ===================== structure ===================== */

  /** @private */
  _build() {
    this.nodes = {};

    this.nodes.progressFill = el('div.shoe__fill', { style: 'width:100%' });
    this.nodes.progressText = el('span', { text: '0 / 0' });

    this.nodes.cardSlot = el('div.drill__card');
    this.nodes.tally = el('div.drill__tally');
    this.nodes.controls = el('div.drill__controls');
    this.nodes.prompt = el('div.drill__prompt');

    replace(this.container, [
      el('header.status', {}, [
        el('div.status__stat', {}, [
          el('span.status__label', { text: 'Drill' }),
          el('span.status__value', { text: `${this.options.decks}-deck shoe` })
        ]),
        el('button.btn', {
          type: 'button',
          text: 'Exit',
          onclick: () => this.destroy(true)
        })
      ]),
      el('div.shoe', {}, [
        el('span', { text: 'SHOE' }),
        el('div.shoe__track', {}, this.nodes.progressFill),
        this.nodes.progressText
      ]),
      el('main.felt.drill', {}, [
        this.nodes.cardSlot,
        this.nodes.tally,
        this.nodes.prompt
      ]),
      el('footer.controls', {}, this.nodes.controls)
    ]);
  }

  /* ===================== running ===================== */

  /** Begin or resume dealing */
  start() {
    if (this.finished || this.awaitingAnswer || this.running) return;

    this.running = true;
    this._schedule();
    this.render();
  }

  /** Pause dealing */
  pause() {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = null;
    this.render();
  }

  /** @private */
  _schedule() {
    clearTimeout(this.timer);
    if (!this.running) return;

    this.timer = setTimeout(() => this._dealNext(), this._speedMs());
  }

  /** @private */
  _dealNext() {
    if (this.deck.isEmpty()) {
      this._finish();
      return;
    }

    const card = this.deck.dealCard(true);
    this.counter.trackCard(card);
    this.current = card;
    this.dealt++;

    // Keep decks-remaining honest against the real shoe
    this.counter.setDecksRemaining(Math.max(0.25, this.deck.getCount() / 52));

    this.render();

    if (this.checkpoints.has(this.dealt)) {
      this._askCount();
      return;
    }

    this._schedule();
  }

  /** @private */
  _askCount() {
    this.running = false;
    clearTimeout(this.timer);
    this.awaitingAnswer = true;

    if (this.options.haptics) buzz([12, 60, 12]);

    this.render();
  }

  /**
   * Grade an answer and resume.
   * @param {number} entered - The player's running count
   */
  answer(entered) {
    if (!this.awaitingAnswer) return;

    const actual = this.counter.getRunningCount();
    const result = {
      atCard: this.dealt,
      entered,
      actual,
      off: entered - actual,
      correct: entered === actual
    };

    this.checks.push(result);
    this.awaitingAnswer = false;
    this.lastResult = result;

    if (this.options.log) {
      this.options.log.append('drillCheck', {
        atCard: result.atCard,
        entered: result.entered,
        actual: result.actual,
        off: result.off,
        correct: result.correct,
        speed: this.options.speed
      });
    }

    if (this.options.haptics) buzz(result.correct ? [10, 40, 10] : 25);

    this.render();
  }

  /** Dismiss the result of the last check and carry on dealing */
  resumeAfterResult() {
    this.lastResult = null;

    if (this.deck.isEmpty()) {
      this._finish();
      return;
    }

    this.running = true;
    this._schedule();
    this.render();
  }

  /** @private */
  _finish() {
    this.finished = true;
    this.running = false;
    clearTimeout(this.timer);

    if (this.options.log) {
      this.options.log.append('drillFinished', {
        decks: this.options.decks,
        speed: this.options.speed,
        checks: this.checks.length,
        correct: this.checks.filter(check => check.correct).length,
        finalCount: this.counter.getRunningCount()
      });
    }

    this.render();
  }

  /** Change dealing speed mid-drill */
  setSpeed(key) {
    this.options.speed = key;

    // Re-arm the pending timer so a speed change takes effect immediately
    if (this.running) this._schedule();

    this.render();
  }

  /** Tear down timers, optionally notifying the caller */
  destroy(notify = false) {
    clearTimeout(this.timer);
    this.timer = null;
    this.running = false;

    if (notify) this.options.onExit();
  }

  /* ===================== rendering ===================== */

  render() {
    const remaining = this.deck.getCount();
    const pct = (remaining / this.totalCards) * 100;

    this.nodes.progressFill.style.width = `${pct}%`;
    this.nodes.progressText.textContent = `${this.dealt} / ${this.totalCards}`;

    // Current card
    replace(
      this.nodes.cardSlot,
      this.current ? renderCard({ ...this.current, faceUp: true }, 0) : el('div.card.card--back')
    );

    this._renderTally();
    this._renderPrompt();
    this._renderControls();
  }

  /** @private */
  _renderTally() {
    const correct = this.checks.filter(check => check.correct).length;

    replace(this.nodes.tally, [
      el('div.drill__stat', {}, [
        el('span.stat__label', { text: 'Checks' }),
        el('span.stat__value', { text: `${correct}/${this.checks.length}` })
      ]),
      el('div.drill__stat', {}, [
        el('span.stat__label', { text: 'Cards left' }),
        el('span.stat__value', { text: String(this.deck.getCount()) })
      ])
    ]);
  }

  /** @private */
  _renderPrompt() {
    // Finished the shoe
    if (this.finished) {
      const correct = this.checks.filter(check => check.correct).length;
      const worst = this.checks.reduce(
        (max, check) => Math.max(max, Math.abs(check.off)), 0
      );

      replace(this.nodes.prompt, el('div.drill__panel', {}, [
        el('h3.drill__title', { text: 'Shoe complete' }),
        el('div.stats-grid', {}, [
          el('div.stat', {}, [
            el('div.stat__value' + (correct === this.checks.length ? '.stat__value--good' : ''), {
              text: `${correct}/${this.checks.length}`
            }),
            el('div.stat__label', { text: 'Checks right' })
          ]),
          el('div.stat', {}, [
            el('div.stat__value', { text: signed(this.counter.getRunningCount()) }),
            el('div.stat__label', { text: 'Final count' })
          ]),
          el('div.stat', {}, [
            el('div.stat__value' + (worst === 0 ? '.stat__value--good' : '.stat__value--bad'), {
              text: String(worst)
            }),
            el('div.stat__label', { text: 'Worst miss' })
          ])
        ]),
        // A full shoe of Hi-Lo must end on zero; anything else means a slip
        el('p.field__hint', {
          text: this.counter.getRunningCount() === 0
            ? 'A full shoe always ends at zero — the deck balances out.'
            : 'Note: a fully dealt Hi-Lo shoe should end at 0.'
        })
      ]));
      return;
    }

    // Just answered a check
    if (this.lastResult) {
      const { correct, entered, actual, off } = this.lastResult;

      replace(this.nodes.prompt, el('div.drill__panel', {}, [
        el('h3.drill__title' + (correct ? '.is-good' : '.is-bad'), {
          text: correct ? 'Correct' : `Off by ${Math.abs(off)}`
        }),
        el('p.drill__answer', {
          text: `You said ${signed(entered)} · actual ${signed(actual)}`
        })
      ]));
      return;
    }

    // Being asked
    if (this.awaitingAnswer) {
      const input = el('input.audit__input', {
        type: 'number',
        inputmode: 'numeric',
        placeholder: '0',
        'aria-label': 'Running count'
      });

      const submit = () => {
        const value = Number.parseInt(input.value, 10);
        if (Number.isNaN(value)) {
          input.focus();
          return;
        }
        this.answer(value);
      };

      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') submit();
      });

      replace(this.nodes.prompt, el('div.drill__panel', {}, [
        el('h3.drill__title', { text: 'Running count?' }),
        input,
        el('button.btn.btn--primary.btn--wide', {
          type: 'button',
          text: 'Check',
          style: 'margin-top:0.5rem',
          onclick: submit
        })
      ]));
      return;
    }

    replace(this.nodes.prompt, []);
  }

  /** @private */
  _renderControls() {
    const speedButtons = el('div.actions', {}, SPEEDS.map(speed => el('button.btn', {
      type: 'button',
      text: speed.label,
      class: this.options.speed === speed.key ? 'is-hinted' : null,
      onclick: () => this.setSpeed(speed.key)
    })));

    let primary;

    if (this.finished) {
      primary = el('button.btn.btn--primary.btn--wide', {
        type: 'button',
        text: 'Done',
        onclick: () => this.destroy(true)
      });
    } else if (this.lastResult) {
      primary = el('button.btn.btn--primary.btn--wide', {
        type: 'button',
        text: 'Keep dealing',
        onclick: () => this.resumeAfterResult()
      });
    } else if (this.awaitingAnswer) {
      primary = null;
    } else if (this.running) {
      primary = el('button.btn.btn--wide', {
        type: 'button',
        text: 'Pause',
        onclick: () => this.pause()
      });
    } else {
      primary = el('button.btn.btn--primary.btn--wide', {
        type: 'button',
        text: this.dealt === 0 ? 'Start dealing' : 'Resume',
        onclick: () => this.start()
      });
    }

    replace(this.nodes.controls, [
      el('div.status__label', { text: 'Speed', style: 'margin-bottom:0.35rem' }),
      speedButtons,
      primary ? el('div.actions', { style: 'margin-top:0.5rem' }, primary) : null
    ]);
  }
}

export default CountDrill;
