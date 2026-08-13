/**
 * StrategyDrill.js
 *
 * Pure basic-strategy practice: one spot at a time, no betting, no shoe to
 * track. Answer, get told immediately whether it was right, and if not, what
 * the correct play was, what the mistake cost in EV, why, and one number worth
 * remembering.
 */

import Deck from '../Deck.js';
import { describe as describeHand, rankValue } from '../EV.js';
import { explain, formatEv } from '../coach.js';
import { el, replace, buzz } from './dom.js';
import { renderCard } from './CardView.js';

const ACTIONS = [
  { key: 'hit', label: 'Hit' },
  { key: 'stand', label: 'Stand' },
  { key: 'double', label: 'Double' },
  { key: 'split', label: 'Split' },
  { key: 'surrender', label: 'Surrender' }
];

/** Spot categories, so practice covers the whole chart rather than the common cases */
const CATEGORIES = ['hard', 'soft', 'pair'];

class StrategyDrill {
  /**
   * @param {HTMLElement} container
   * @param {Object} options - rules, haptics, log, onResult, onExit
   */
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      hitSoft17: true,
      surrender: true,
      doubleAfterSplit: true,
      haptics: true,
      focus: 'all',          // 'all' | 'hard' | 'soft' | 'pair'
      log: null,
      onResult: () => {},
      onExit: () => {},
      ...options
    };

    this.deck = new Deck(8);
    this.streak = 0;
    this.bestStreak = 0;
    this.asked = 0;
    this.right = 0;
    this.feedback = null;

    this._build();
    this.next();
  }

  /* ===================== spot generation ===================== */

  /**
   * Deal a fresh spot. Categories are chosen deliberately rather than dealt at
   * random, because random dealing buries pairs and soft hands under a pile of
   * ordinary hard totals.
   * @private
   */
  _makeSpot() {
    const focus = this.options.focus;
    const category = focus !== 'all'
      ? focus
      : CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];

    this.deck.initialize();
    this.deck.shuffle();

    const draw = () => this.deck.dealCard(true);
    const pick = predicate => {
      // Bounded search so a rare shape can't spin forever
      for (let i = 0; i < 400; i++) {
        const card = draw();
        if (!card) { this.deck.initialize(); this.deck.shuffle(); continue; }
        if (predicate(card)) return card;
      }
      return draw();
    };

    let cards;

    if (category === 'pair') {
      const first = draw();
      const second = pick(card => card.rank === first.rank);
      cards = [first, second];
    } else if (category === 'soft') {
      const ace = pick(card => card.rank === 'ace');
      const other = pick(card => card.rank !== 'ace');
      cards = [ace, other];
    } else {
      // Hard hand: no ace, and not a pair
      const first = pick(card => card.rank !== 'ace');
      const second = pick(card => card.rank !== 'ace' && card.rank !== first.rank);
      cards = [first, second];
    }

    const upCard = draw();

    return { cards, upCard };
  }

  /** Deal the next spot */
  next() {
    this.feedback = null;
    this.spot = this._makeSpot();
    this.hand = describeHand(this.spot.cards);
    this.up = rankValue(this.spot.upCard.rank);
    this.render();
  }

  /* ===================== answering ===================== */

  /**
   * Submit an answer.
   * @param {string} action
   */
  answer(action) {
    if (this.feedback) return;

    const rules = {
      hitSoft17: this.options.hitSoft17,
      surrender: this.options.surrender,
      doubleAfterSplit: this.options.doubleAfterSplit
    };

    const result = explain({
      hand: this.hand,
      cards: this.spot.cards,
      up: this.up,
      chosen: action,
      rules
    });

    this.feedback = result;
    this.asked++;

    if (result.correct) {
      this.right++;
      this.streak++;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
    } else {
      this.streak = 0;
    }

    if (this.options.haptics) buzz(result.correct ? 8 : 25);

    if (this.options.log) {
      this.options.log.append('strategyDrill', {
        hand: result.handLabel,
        up: result.upLabel,
        played: action,
        best: result.best,
        correct: result.correct,
        cost: result.cost === null ? null : Math.round(result.cost * 1000) / 1000
      });
    }

    this.options.onResult({
      correct: result.correct,
      isDeviation: false,
      kind: 'play',
      mode: 'strategy'
    });

    this.render();
  }

  /* ===================== structure ===================== */

  /** @private */
  _build() {
    this.nodes = {};

    this.nodes.score = el('span.status__value', { text: '0/0' });
    this.nodes.streak = el('span.status__value', { text: '0' });
    this.nodes.dealerCard = el('div.hand__cards');
    this.nodes.playerCards = el('div.hand__cards');
    this.nodes.feedback = el('div.drill__feedback');
    this.nodes.controls = el('footer.controls');

    replace(this.container, [
      el('header.status', {}, [
        el('div.status__stat', {}, [
          el('span.status__label', { text: 'Correct' }),
          this.nodes.score
        ]),
        el('button.btn', {
          type: 'button',
          text: 'Exit',
          onclick: () => this.destroy(true)
        }),
        el('div.status__stat.status__stat--right', {}, [
          el('span.status__label', { text: 'Streak' }),
          this.nodes.streak
        ])
      ]),
      el('main.felt.strategy', {}, [
        el('section.seat', {}, [
          el('div.seat__label', {}, el('span', { text: 'Dealer shows' })),
          this.nodes.dealerCard
        ]),
        el('section.seat', {}, [
          this.nodes.playerCards,
          el('div.seat__label', {}, el('span', { text: 'Your hand' }))
        ]),
        this.nodes.feedback
      ]),
      this.nodes.controls
    ]);
  }

  /* ===================== rendering ===================== */

  render() {
    this.nodes.score.textContent = `${this.right}/${this.asked}`;
    this.nodes.streak.textContent = String(this.streak);

    replace(this.nodes.dealerCard, renderCard({ ...this.spot.upCard, faceUp: true }, 0));
    replace(
      this.nodes.playerCards,
      this.spot.cards.map((card, index) => renderCard({ ...card, faceUp: true }, index))
    );

    this._renderFeedback();
    this._renderControls();
  }

  /** @private */
  _renderFeedback() {
    if (!this.feedback) {
      replace(this.nodes.feedback, el('p.strategy__ask', {
        text: `${this.handLabelText()} against ${this.feedbackUpLabel()} — what's the play?`
      }));
      return;
    }

    const f = this.feedback;

    replace(this.nodes.feedback, el('div.verdict' + (f.correct ? '.is-right' : '.is-wrong'), {}, [
      el('div.verdict__head', {}, [
        el('span.verdict__word', { text: f.correct ? 'CORRECT' : 'WRONG' }),
        f.marginal
          ? el('span.advice__tag', { text: 'close call' })
          : null
      ]),

      // What should have happened
      f.correct
        ? el('p.verdict__line', { text: `${f.chosenWord} · ${formatEv(f.evChosen)}` })
        : el('p.verdict__line', {}, [
            el('span', { text: 'Best play: ' }),
            el('strong.verdict__best', { text: f.bestWord }),
            el('span.verdict__ev', { text: ` ${formatEv(f.evBest)}` })
          ]),

      // What the mistake cost
      !f.correct && f.cost !== null
        ? el('p.verdict__cost', {
            text: `${f.chosenWord} ${formatEv(f.evChosen)} — costs ${(f.cost * 100).toFixed(1)}% of a bet`
          })
        : null,

      el('p.verdict__reason', { text: f.reason }),
      el('p.verdict__tip', {}, [
        el('span.verdict__tipLabel', { text: 'TIP ' }),
        el('span', { text: f.tip })
      ])
    ]));
  }

  /** @private */
  handLabelText() {
    if (this.hand.pairValue != null) return handPairText(this.spot.cards);
    return this.hand.soft ? `Soft ${this.hand.total}` : `Hard ${this.hand.total}`;
  }

  /** @private */
  feedbackUpLabel() {
    const rank = this.spot.upCard.rank;
    if (rank === 'ace') return 'an ace';
    if (['jack', 'queen', 'king'].includes(rank)) return `a ${rank}`;
    return `a ${rank}`;
  }

  /** @private */
  _renderControls() {
    if (this.feedback) {
      replace(this.nodes.controls, el('div.actions', {}, [
        el('button.btn.btn--primary.btn--wide', {
          type: 'button',
          text: 'Next hand',
          onclick: () => this.next()
        })
      ]));
      return;
    }

    // Only offer actions that are legal for this spot
    const available = ACTIONS.filter(action => {
      if (action.key === 'split') return this.hand.pairValue != null;
      if (action.key === 'surrender') return this.options.surrender;
      return true;
    });

    replace(this.nodes.controls, el('div.actions', {}, available.map(action => el('button.btn', {
      type: 'button',
      text: action.label,
      onclick: () => this.answer(action.key)
    }))));
  }

  /** Tear down and optionally notify the caller */
  destroy(notify = false) {
    if (notify) this.options.onExit();
  }
}

/** "8,8" style label for a pair */
function handPairText(cards) {
  const rank = cards[0].rank;
  const short = rank === 'ace' ? 'A'
    : ['jack', 'queen', 'king'].includes(rank) ? '10'
    : rank;
  return `${short},${short}`;
}

export default StrategyDrill;
