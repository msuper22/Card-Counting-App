/**
 * App.js
 *
 * The whole user interface. This replaces the previous six-file UI layer,
 * which rendered a fixed-size desktop table with imperative animation and had
 * no way to refresh the action buttons mid-hand.
 *
 * The model here is deliberately simple: the game engine is the single source
 * of truth, and any state change triggers a render from getGameState(). Cards
 * animate on first appearance only, tracked by card id.
 */

import Game from '../Game.js';
import Trainer from '../Trainer.js';
import { el, replace, money, signed, buzz } from './dom.js';
import { renderCard } from './CardView.js';
import {
  loadSettings, saveSettings, loadSession, saveSession, clearSession, DEFAULT_SETTINGS
} from '../storage.js';

const CHIP_VALUES = [5, 25, 100, 500];
const CHIP_COLORS = {
  5: '#e8e3d3',
  25: '#5fbf7f',
  100: '#6ba7de',
  500: '#c07fd4'
};

const ACTION_LABELS = {
  hit: 'Hit',
  stand: 'Stand',
  double: 'Double',
  split: 'Split',
  surrender: 'Surr'
};

class App {
  /**
   * @param {HTMLElement} container - Root element to render into
   */
  constructor(container) {
    this.container = container;
    this.settings = loadSettings();

    // Cards already shown, so re-renders don't replay the deal animation
    this.seenCards = new Set();
    this.pendingBet = 0;
    this.bannerTimer = null;
    this.lastAdvice = null;
    this.lastGrade = null;

    this._buildFrame();
    this._startSession();
  }

  /* ===================== setup ===================== */

  /**
   * Build the static frame once; only its contents are re-rendered.
   * @private
   */
  _buildFrame() {
    this.nodes = {};

    this.nodes.bankroll = el('span.status__value.status__value--money', { text: '$0' });
    this.nodes.runningCount = el('span.count__value', { text: '0' });
    this.nodes.trueCount = el('span.count__value', { text: '0' });

    this.nodes.count = el(
      'button.count',
      {
        type: 'button',
        'aria-label': 'Toggle count visibility',
        onclick: () => this._toggleCount()
      },
      [
        el('span.count__group', {}, [
          this.nodes.runningCount,
          el('span.status__label', { text: 'RC' })
        ]),
        el('span.count__group', {}, [
          this.nodes.trueCount,
          el('span.status__label', { text: 'TC' })
        ])
      ]
    );

    this.nodes.roundLabel = el('span.status__value', { text: '#0' });

    const status = el('header.status', {}, [
      el('div.status__stat', {}, [
        el('span.status__label', { text: 'Bankroll' }),
        this.nodes.bankroll
      ]),
      this.nodes.count,
      el('div.status__stat.status__stat--right', {}, [
        el('span.status__label', { text: 'Hand' }),
        this.nodes.roundLabel
      ])
    ]);

    this.nodes.shoeFill = el('div.shoe__fill', { style: 'width:100%' });
    this.nodes.shoeText = el('span', { text: '0%' });

    const shoe = el('div.shoe', {}, [
      el('span', { text: 'SHOE' }),
      el('div.shoe__track', {}, this.nodes.shoeFill),
      this.nodes.shoeText
    ]);

    this.nodes.dealerTotal = el('span.seat__total', { text: '–' });
    this.nodes.dealerHands = el('div.hands');
    this.nodes.playerTotal = el('span.seat__total', { text: '–' });
    this.nodes.playerHands = el('div.hands');

    this.nodes.felt = el('main.felt', {}, [
      el('section.seat', {}, [
        el('div.seat__label', {}, [
          el('span', { text: 'Dealer' }),
          this.nodes.dealerTotal
        ]),
        this.nodes.dealerHands
      ]),
      el('section.seat', {}, [
        this.nodes.playerHands,
        el('div.seat__label', {}, [
          el('span', { text: 'You' }),
          this.nodes.playerTotal
        ])
      ])
    ]);

    this.nodes.advice = el('div.advice');
    this.nodes.controls = el('footer.controls');
    this.nodes.sheet = el('div.sheet', { hidden: true });

    this.nodes.sheet.addEventListener('click', event => {
      // Tapping the dimmed backdrop closes the sheet
      if (event.target === this.nodes.sheet) this._closeSheet();
    });

    replace(this.container, [
      status, shoe, this.nodes.felt, this.nodes.advice, this.nodes.controls, this.nodes.sheet
    ]);

    this.container.className = 'app';
  }

  /**
   * Create the game and trainer from current settings, restoring any saved session.
   * @private
   */
  _startSession(freshBankroll = null) {
    const saved = freshBankroll === null ? loadSession() : null;
    const bankroll = freshBankroll !== null
      ? freshBankroll
      : (saved && typeof saved.bankroll === 'number' ? saved.bankroll : this.settings.startingBankroll);

    this.game = new Game({
      numberOfDecks: this.settings.numberOfDecks,
      reshuffleThreshold: this.settings.reshuffleThreshold,
      maxPlayers: 1,
      tableMinimum: this.settings.minBet,
      tableMaximum: this.settings.maxBet,
      blackjackPayout: this.settings.blackjackPayout,
      allowSurrender: this.settings.allowSurrender,
      allowDoubleAfterSplit: this.settings.allowDoubleAfterSplit,
      maxSplits: this.settings.maxSplits,
      hitSoft17: this.settings.hitSoft17
    });

    this.game.addPlayer('You', bankroll, {
      autoPlay: false,
      strategyLevel: 'counting',
      countingSystem: this.settings.countingSystem
    });

    this.trainer = new Trainer(this.game, {
      countingSystem: this.settings.countingSystem,
      minBet: this.settings.minBet,
      maxBet: this.settings.maxBet,
      bankroll
    });

    if (saved && saved.stats) {
      this.trainer.stats = { ...this.trainer.stats, ...saved.stats };
    }

    this.pendingBet = Math.min(
      Math.max(saved && saved.lastBet ? saved.lastBet : this.settings.minBet, this.settings.minBet),
      this.settings.maxBet
    );

    this.seenCards = new Set();
    this._connectEvents();
    this.game.startGame();
  }

  /**
   * Subscribe to the engine. Every listener funnels into a single render.
   * @private
   */
  _connectEvents() {
    const rerender = () => this.render();

    [
      'bettingPhaseStarted', 'dealingPhaseStarted', 'initialCardsDealt',
      'playerTurnPhaseStarted', 'turnChanged', 'nextHand', 'nextPlayer',
      'playerHit', 'playerDouble', 'playerSplit', 'playerBust', 'playerStand',
      'playerSurrender', 'dealerTurnPhaseStarted', 'dealerBust',
      'insuranceOffered', 'insuranceResolved', 'deckReshuffled'
    ].forEach(event => this.game.addEventListener(event, rerender));

    this.game.addEventListener('payoutPhaseStarted', data => {
      this._showResults(data.results);
      this.render();
      this._persist();
    });

    this.game.addEventListener('dealerBlackjack', () => {
      this._banner('lose', 'Dealer blackjack');
    });
  }

  /* ===================== rendering ===================== */

  /** Re-render everything from current game state */
  render() {
    const state = this.game.getGameState();
    const player = state.players[0];

    this.nodes.bankroll.textContent = money(player.bankroll);
    this.nodes.roundLabel.textContent = `#${state.roundNumber}`;

    this._renderCount(state);
    this._renderShoe(state);
    this._renderDealer(state);
    this._renderPlayer(state, player);
    this._renderAdvice(state);
    this._renderControls(state, player);
  }

  /** @private */
  _renderCount(state) {
    const count = this.trainer.getCount();

    const paint = (node, value) => {
      node.textContent = signed(value);
      node.className = 'count__value ' + (
        value > 0 ? 'count__value--pos' : value < 0 ? 'count__value--neg' : 'count__value--zero'
      );
    };

    paint(this.nodes.runningCount, count.running);
    paint(this.nodes.trueCount, count.true);

    this.nodes.count.classList.toggle('is-hidden', !this.settings.showCount);
  }

  /** @private */
  _renderShoe(state) {
    const total = this.settings.numberOfDecks * 52;
    const remaining = Math.max(0, Math.min(100, (state.deckCount / total) * 100));
    const dealt = Math.round(100 - remaining);

    this.nodes.shoeFill.style.width = `${remaining}%`;
    // Past the cut card the shoe is about to be reshuffled - flag it
    this.nodes.shoeFill.classList.toggle(
      'shoe__fill--deep',
      remaining < this.settings.reshuffleThreshold * 100 + 10
    );
    this.nodes.shoeText.textContent = `${dealt}% dealt · ${state.decksRemaining.toFixed(1)}d left`;
  }

  /** @private */
  _renderDealer(state) {
    const cards = state.dealer.hand;

    if (!cards.length) {
      replace(this.nodes.dealerHands, []);
      this.nodes.dealerTotal.textContent = '–';
      this.nodes.dealerTotal.className = 'seat__total';
      return;
    }

    replace(this.nodes.dealerHands, el('div.hand', {}, el(
      'div.hand__cards', {},
      cards.map((card, index) => this._card(card, index))
    )));

    // While the hole card is down, only show what's actually visible
    const showFull = state.dealer.holeCardRevealed;
    const value = showFull ? state.dealer.fullValue : state.dealer.value;

    this.nodes.dealerTotal.textContent = showFull ? String(value) : `${value}+`;
    this.nodes.dealerTotal.className = 'seat__total' +
      (showFull && state.dealer.busted ? ' seat__total--bust' : '');
  }

  /** @private */
  _renderPlayer(state, player) {
    const isPlayerTurn = state.gamePhase === 'playerTurn';

    const handNodes = player.hands.map((hand, index) => {
      const active = isPlayerTurn && index === state.currentHandIndex && hand.active;
      const settled = hand.busted || hand.surrendered || (hand.result !== null);

      const classes = ['hand'];
      if (active) classes.push('is-active');
      if (settled) classes.push('is-settled');

      const total = hand.busted
        ? `${hand.value} bust`
        : hand.blackjack
          ? 'BJ'
          : hand.soft && hand.value < 21
            ? `${hand.hardValue}/${hand.value}`
            : String(hand.value);

      return el(`div.${classes.join('.')}`, {}, [
        el('div.hand__cards', {}, hand.cards.map((card, i) => this._card(card, i))),
        el('div.hand__bet', {}, [
          el('span', { text: hand.bet > 0 ? money(hand.bet) : '' }),
          player.hands.length > 1 ? el('span.seat__total', { text: total }) : null
        ])
      ]);
    });

    replace(this.nodes.playerHands, handNodes);

    // The headline total only makes sense for a single hand
    if (player.hands.length === 1) {
      const hand = player.hands[0];
      if (!hand.cards.length) {
        this.nodes.playerTotal.textContent = '–';
        this.nodes.playerTotal.className = 'seat__total';
      } else {
        this.nodes.playerTotal.textContent = hand.blackjack
          ? 'Blackjack'
          : hand.soft && hand.value < 21
            ? `soft ${hand.value}`
            : String(hand.value);
        this.nodes.playerTotal.className = 'seat__total' +
          (hand.busted ? ' seat__total--bust' : hand.soft ? ' seat__total--soft' : '');
      }
    } else {
      this.nodes.playerTotal.textContent = `${player.hands.length} hands`;
      this.nodes.playerTotal.className = 'seat__total';
    }
  }

  /**
   * Render a card, animating it only the first time it is seen.
   * @private
   */
  _card(card, index) {
    const key = `${card.id}:${card.faceUp}`;
    const isNew = !this.seenCards.has(key);

    if (isNew) this.seenCards.add(key);

    const node = renderCard(card, isNew ? index : 0);
    if (!isNew) node.style.animation = 'none';

    return node;
  }

  /** @private */
  _renderAdvice(state) {
    // Feedback on the last decision outranks advice for the next one
    if (this.lastGrade) {
      const { correct, expected, played, wasDeviation } = this.lastGrade;
      replace(this.nodes.advice, correct
        ? el('span.advice--correct', { text: `✓ ${ACTION_LABELS[played] || played} was right` })
        : el('span.advice--wrong', {}, [
            el('span', { text: `✗ ${ACTION_LABELS[played] || played} — correct was ` }),
            el('span.advice__play', { text: ACTION_LABELS[expected] || expected }),
            wasDeviation ? el('span.advice__tag', { text: 'deviation' }) : null
          ]));
      return;
    }

    if (state.gamePhase !== 'playerTurn' || !this.settings.showAdvice) {
      replace(this.nodes.advice, []);
      return;
    }

    const advice = this.trainer.getAdvice();
    if (!advice) {
      replace(this.nodes.advice, []);
      return;
    }

    replace(this.nodes.advice, [
      el('span', { text: 'Play:' }),
      el('span.advice__play', { text: ACTION_LABELS[advice.optimalPlay] || advice.optimalPlay }),
      advice.isDeviation ? el('span.advice__tag', { text: 'deviation' }) : null
    ]);
  }

  /** @private */
  _renderControls(state, player) {
    switch (state.gamePhase) {
      case 'betting':
        replace(this.nodes.controls, this._bettingControls(player));
        break;
      case 'insurance':
        replace(this.nodes.controls, this._insuranceControls(player));
        break;
      case 'playerTurn':
        replace(this.nodes.controls, this._actionControls(state));
        break;
      case 'payout':
        replace(this.nodes.controls, this._payoutControls(player));
        break;
      default:
        replace(this.nodes.controls, el('div.actions', {}, this._menuButton()));
    }
  }

  /** @private */
  _bettingControls(player) {
    const recommendation = this.settings.showBetHint
      ? this.trainer.getBetRecommendation(player.bankroll)
      : null;

    const bet = Math.min(this.pendingBet, player.bankroll);
    const canDeal = bet >= this.settings.minBet && bet <= player.bankroll;

    const chips = CHIP_VALUES.map(value => el('button.chip', {
      type: 'button',
      disabled: value > player.bankroll,
      style: `background:${CHIP_COLORS[value]}`,
      'aria-label': `Bet ${value}`,
      text: value >= 1000 ? `${value / 1000}k` : String(value),
      onclick: () => this._addChip(value, player.bankroll)
    }));

    return el('div.betting', {}, [
      el('div.betting__row', {}, [
        el('div', {}, [
          el('div.status__label', { text: 'Your bet' }),
          el('div.betting__amount', { text: money(bet) })
        ]),
        recommendation
          ? el('div.betting__hint', {
              text: `Suggested ${money(recommendation.amount)} · ${recommendation.reason}`,
              style: 'text-align:right;max-width:60%'
            })
          : null
      ]),
      el('div.chips', {}, chips),
      el('div.actions', {}, [
        el('button.btn', {
          type: 'button',
          text: 'Clear',
          disabled: bet === 0,
          onclick: () => { this.pendingBet = 0; this.render(); }
        }),
        recommendation
          ? el('button.btn', {
              type: 'button',
              text: 'Use hint',
              onclick: () => { this.pendingBet = recommendation.amount; this.render(); }
            })
          : null,
        this._menuButton(),
        el('button.btn.btn--primary.btn--wide', {
          type: 'button',
          text: canDeal ? `Deal ${money(bet)}` : `Minimum ${money(this.settings.minBet)}`,
          disabled: !canDeal,
          onclick: () => this._deal(bet)
        })
      ])
    ]);
  }

  /** @private */
  _insuranceControls(player) {
    const cost = player.currentBet / 2;
    const advised = this.trainer.shouldTakeInsurance();

    return el('div.betting', {}, [
      el('div.betting__row', {}, [
        el('div.betting__hint', {
          text: `Dealer shows an ace. Insurance costs ${money(cost)} and pays 2:1.`
        })
      ]),
      this.settings.showAdvice
        ? el('div.betting__hint', {
            text: advised
              ? '✓ True count is +3 or better — insurance is profitable here.'
              : '✗ Count is too low — decline.',
            style: `color:var(--${advised ? 'win' : 'lose'})`
          })
        : null,
      el('div.actions', {}, [
        el('button.btn', {
          type: 'button',
          text: 'Take it',
          disabled: player.bankroll < cost,
          onclick: () => this._insure(true, advised)
        }),
        el('button.btn.btn--primary', {
          type: 'button',
          text: 'No thanks',
          onclick: () => this._insure(false, advised)
        })
      ])
    ]);
  }

  /** @private */
  _actionControls(state) {
    const actions = state.availableActions;
    const advice = this.settings.showAdvice ? this.trainer.getAdvice() : null;
    const hinted = advice ? advice.optimalPlay : null;

    const make = (action, enabled) => el('button.btn', {
      type: 'button',
      text: ACTION_LABELS[action],
      disabled: !enabled,
      class: hinted === action && enabled ? 'is-hinted' : null,
      onclick: () => this._act(action)
    });

    return el('div.actions', {}, [
      make('hit', actions.canHit),
      make('stand', actions.canStand),
      make('double', actions.canDouble),
      make('split', actions.canSplit),
      actions.canSurrender ? make('surrender', true) : null,
      this._menuButton()
    ]);
  }

  /** @private */
  _payoutControls(player) {
    const broke = player.bankroll < this.settings.minBet;

    return el('div.actions', {}, [
      this._menuButton(),
      broke
        ? el('button.btn.btn--primary.btn--wide', {
            type: 'button',
            text: 'Out of chips — rebuy',
            onclick: () => this._rebuy()
          })
        : el('button.btn.btn--primary.btn--wide', {
            type: 'button',
            text: 'Next hand',
            onclick: () => this._nextHand()
          })
    ]);
  }

  /** @private */
  _menuButton() {
    return el('button.btn', {
      type: 'button',
      text: 'Menu',
      onclick: () => this._openMenu()
    });
  }

  /* ===================== actions ===================== */

  /**
   * Blur or reveal the count. This is the core training loop: hide it, keep
   * the count yourself, then tap to check.
   * @private
   */
  _toggleCount() {
    this.settings.showCount = !this.settings.showCount;
    saveSettings(this.settings);
    if (this.settings.haptics) buzz();
    this.render();
  }

  /** @private */
  _addChip(value, bankroll) {
    const next = this.pendingBet + value;
    this.pendingBet = Math.min(next, bankroll, this.settings.maxBet);
    if (this.settings.haptics) buzz();
    this.render();
  }

  /** @private */
  _deal(bet) {
    this._clearBanner();
    this.lastGrade = null;
    this.pendingBet = bet;
    if (this.settings.haptics) buzz();
    this.game.placeBet(0, bet);
    this._persist();
  }

  /** @private */
  _act(action) {
    // Capture the advice for this decision *before* the action changes the hand
    const advice = this.settings.gradeDecisions ? this.trainer.getAdvice() : null;
    if (this.settings.haptics) buzz();

    const ok = this.game.playerAction(action);
    if (!ok) return;

    this.lastGrade = advice ? this.trainer.recordDecision(action, advice) : null;
    this.render();

    // Feedback is transient; clear it so the next decision gets fresh advice
    if (this.lastGrade) {
      clearTimeout(this.gradeTimer);
      this.gradeTimer = setTimeout(() => {
        this.lastGrade = null;
        this.render();
      }, this.lastGrade.correct ? 1200 : 2600);
    }
  }

  /** @private */
  _insure(take, advised) {
    if (this.settings.gradeDecisions) {
      this.trainer.recordDecision(
        take ? 'insure' : 'decline',
        { optimalPlay: advised ? 'insure' : 'decline', isDeviation: advised, hand: 'insurance' }
      );
    }
    if (this.settings.haptics) buzz();
    this.game.placeInsurance(0, take);
  }

  /** @private */
  _nextHand() {
    this._clearBanner();
    this.lastGrade = null;
    this.game.startNewRound();
  }

  /** @private */
  _rebuy() {
    this.settings.startingBankroll = this.settings.startingBankroll || 1000;
    this.game.players[0].bankroll = this.settings.startingBankroll;
    this._persist();
    this._nextHand();
  }

  /* ===================== results ===================== */

  /** @private */
  _showResults(results) {
    if (!results || !results.length) return;

    const hands = results[0].hands.filter(hand => hand.bet > 0);
    if (!hands.length) return;

    const net = hands.reduce((sum, hand) => sum + hand.net, 0);

    // With one hand, name the outcome; with several, report the net swing
    if (hands.length === 1) {
      const hand = hands[0];
      const kind = hand.surrendered ? 'push'
        : hand.result === 'blackjack' ? 'blackjack'
        : hand.result === 'win' ? 'win'
        : hand.result === 'push' ? 'push'
        : 'lose';

      const title = hand.surrendered ? 'Surrendered'
        : hand.result === 'blackjack' ? 'Blackjack!'
        : hand.result === 'win' ? 'You win'
        : hand.result === 'push' ? 'Push'
        : hand.busted ? 'Bust' : 'Dealer wins';

      this._banner(kind, title, net);
    } else {
      const kind = net > 0 ? 'win' : net < 0 ? 'lose' : 'push';
      this._banner(kind, `${hands.length} hands`, net);
    }

    if (this.settings.haptics) buzz(net > 0 ? [10, 40, 10] : 12);
  }

  /** @private */
  _banner(kind, title, net = null) {
    this._clearBanner();

    const node = el(`div.banner.banner--${kind}`, {}, [
      el('span', { text: title }),
      net !== null && net !== 0
        ? el('span.banner__amount', { text: `${net > 0 ? '+' : ''}${money(net)}` })
        : null
    ]);

    this.container.append(node);
    this.bannerNode = node;
    this.bannerTimer = setTimeout(() => this._clearBanner(), 2200);
  }

  /** @private */
  _clearBanner() {
    clearTimeout(this.bannerTimer);
    if (this.bannerNode) {
      this.bannerNode.remove();
      this.bannerNode = null;
    }
  }

  /* ===================== persistence ===================== */

  /** @private */
  _persist() {
    saveSession({
      bankroll: this.game.players[0].bankroll,
      lastBet: this.pendingBet,
      stats: this.trainer.stats
    });
  }

  /* ===================== sheets ===================== */

  /** @private */
  _openSheet(title, body) {
    replace(this.nodes.sheet, el('div.sheet__panel', {}, [
      el('div.sheet__header', {}, [
        el('h2.sheet__title', { text: title }),
        el('button.sheet__close', {
          type: 'button',
          text: '✕',
          'aria-label': 'Close',
          onclick: () => this._closeSheet()
        })
      ]),
      body
    ]));

    this.nodes.sheet.hidden = false;
  }

  /** @private */
  _closeSheet() {
    this.nodes.sheet.hidden = true;
    replace(this.nodes.sheet, []);
    this.render();
  }

  /** @private */
  _openMenu() {
    this._openSheet('Menu', el('div', {}, [
      el('div.actions', { style: 'margin-bottom:0.75rem' }, [
        el('button.btn.btn--wide', {
          type: 'button', text: 'Session stats', onclick: () => this._openStats()
        }),
        el('button.btn.btn--wide', {
          type: 'button', text: 'Settings', onclick: () => this._openSettings()
        }),
        el('button.btn.btn--wide', {
          type: 'button', text: 'How counting works', onclick: () => this._openHelp()
        })
      ])
    ]));
  }

  /** @private */
  _openStats() {
    const stats = this.trainer.getStats();
    const player = this.game.players[0];
    const net = player.bankroll - this.settings.startingBankroll;

    const stat = (value, label, tone = null) => el('div.stat', {}, [
      el('div.stat__value' + (tone ? `.stat__value--${tone}` : ''), { text: value }),
      el('div.stat__label', { text: label })
    ]);

    const mistakes = stats.mistakes.slice(-8).reverse();

    this._openSheet('Session stats', el('div', {}, [
      el('div.stats-grid', {}, [
        stat(String(player.roundsPlayed), 'Hands'),
        stat(
          stats.accuracy === null ? '–' : `${stats.accuracy}%`,
          'Strategy',
          stats.accuracy === null ? null : stats.accuracy >= 90 ? 'good' : 'bad'
        ),
        stat(
          stats.deviationAccuracy === null ? '–' : `${stats.deviationAccuracy}%`,
          'Deviations',
          stats.deviationAccuracy === null ? null : stats.deviationAccuracy >= 80 ? 'good' : 'bad'
        ),
        stat(
          `${net >= 0 ? '+' : ''}${money(net)}`,
          'Net',
          net > 0 ? 'good' : net < 0 ? 'bad' : null
        ),
        stat(String(player.roundsWon), 'Won'),
        stat(String(player.blackjacks), 'Blackjacks')
      ]),

      el('h3.status__label', { text: 'Recent mistakes', style: 'margin:0.75rem 0 0.35rem' }),
      mistakes.length
        ? el('div.mistakes', {}, mistakes.map(mistake => el('div.mistake', {}, [
            el('span', {
              text: `${mistake.hand} vs ${mistake.dealerUpCard} @ TC ${signed(mistake.trueCount || 0)}`
            }),
            el('span', {}, [
              el('span', { text: `${mistake.played} → ` }),
              el('span.mistake__fix', { text: mistake.expected })
            ])
          ])))
        : el('p.empty', { text: 'No mistakes yet. Keep going.' }),

      el('div.actions', { style: 'margin-top:1rem' }, [
        el('button.btn.btn--danger.btn--wide', {
          type: 'button',
          text: 'Reset session',
          onclick: () => this._resetSession()
        })
      ])
    ]));
  }

  /** @private */
  _openSettings() {
    const toggle = (key, label, hint = null) => el('div.field', {}, [
      el('div', {}, [
        el('div.field__label', { text: label }),
        hint ? el('span.field__hint', { text: hint }) : null
      ]),
      el('label.toggle', {}, [
        el('input', {
          type: 'checkbox',
          checked: Boolean(this.settings[key]),
          onchange: event => this._updateSetting(key, event.target.checked)
        }),
        el('span.toggle__track')
      ])
    ]);

    const select = (key, label, options, hint = null, parse = Number) => el('div.field', {}, [
      el('div', {}, [
        el('div.field__label', { text: label }),
        hint ? el('span.field__hint', { text: hint }) : null
      ]),
      el('select', {
        onchange: event => this._updateSetting(key, parse(event.target.value), true)
      }, options.map(([value, text]) => el('option', {
        value: String(value),
        text,
        selected: String(this.settings[key]) === String(value)
      })))
    ]);

    this._openSheet('Settings', el('div', {}, [
      el('h3.status__label', { text: 'Training', style: 'margin:0.25rem 0' }),
      toggle('showCount', 'Show the count', 'Turn off to practise counting yourself'),
      toggle('showAdvice', 'Show recommended play'),
      toggle('gradeDecisions', 'Grade my decisions'),
      toggle('showBetHint', 'Suggest bet size'),
      toggle('haptics', 'Vibration feedback'),
      select('countingSystem', 'Counting system', [
        ['HI_LO', 'Hi-Lo'], ['KO', 'Knock-Out'], ['OMEGA_II', 'Omega II']
      ], 'Changing this restarts the count', String),

      el('h3.status__label', { text: 'Table rules', style: 'margin:1rem 0 0.25rem' }),
      select('numberOfDecks', 'Decks', [[1, '1'], [2, '2'], [4, '4'], [6, '6'], [8, '8']],
        'Changing this starts a new shoe'),
      select('reshuffleThreshold', 'Penetration', [
        [0.5, '50% (shallow)'], [0.35, '65%'], [0.25, '75% (typical)'], [0.15, '85% (deep)']
      ]),
      select('blackjackPayout', 'Blackjack pays', [[1.5, '3:2'], [1.2, '6:5']]),
      select('minBet', 'Table minimum', [[5, '$5'], [10, '$10'], [25, '$25'], [100, '$100']]),
      select('maxBet', 'Table maximum', [[100, '$100'], [500, '$500'], [1000, '$1,000'], [5000, '$5,000']]),
      toggle('hitSoft17', 'Dealer hits soft 17'),
      toggle('allowSurrender', 'Late surrender allowed'),
      toggle('allowDoubleAfterSplit', 'Double after split'),

      el('div.actions', { style: 'margin-top:1rem' }, [
        el('button.btn.btn--wide', {
          type: 'button',
          text: 'Restore defaults',
          onclick: () => {
            this.settings = { ...DEFAULT_SETTINGS };
            saveSettings(this.settings);
            this._restart();
          }
        })
      ])
    ]));
  }

  /** @private */
  _openHelp() {
    const section = (title, lines) => el('div', { style: 'margin-bottom:1rem' }, [
      el('h3.status__label', { text: title, style: 'margin-bottom:0.35rem' }),
      ...lines.map(line => el('p', {
        text: line,
        style: 'font-size:0.8125rem;color:var(--text-dim);margin-bottom:0.35rem;line-height:1.45'
      }))
    ]);

    this._openSheet('How counting works', el('div', {}, [
      section('Running count', [
        'Every card you see adjusts the count. In Hi-Lo, 2–6 are +1, 7–9 are 0, and 10s through aces are −1.',
        'A high running count means the remaining shoe is rich in tens and aces, which favours you.'
      ]),
      section('True count', [
        'Divide the running count by the decks still left in the shoe. A +6 running count with 3 decks left is a true count of +2.',
        'The true count is what actually drives bet sizing and deviations.'
      ]),
      section('Betting', [
        'Bet the table minimum at true counts of +1 or below, then raise roughly one unit per point above that.',
        'Turn off "Suggest bet size" once you want to practise the ramp yourself.'
      ]),
      section('Deviations', [
        'At certain true counts the correct play departs from basic strategy — the Illustrious 18.',
        'The classic example is 16 vs 10: hit at a negative count, stand once the true count reaches 0.',
        'Plays marked "deviation" in the advice line are these count-driven departures.'
      ]),
      section('Practising', [
        'Tap the count in the status bar to blur it, then keep the count in your head and tap again to check.',
        'Session stats track how often you match the correct play, with deviations scored separately.'
      ])
    ]));
  }

  /* ===================== settings changes ===================== */

  /** @private */
  _updateSetting(key, value, needsRestart = false) {
    this.settings[key] = value;
    saveSettings(this.settings);

    // Rule changes can't be applied mid-shoe without corrupting the count
    if (needsRestart || ['numberOfDecks', 'reshuffleThreshold', 'countingSystem', 'minBet', 'maxBet'].includes(key)) {
      this._restart();
      return;
    }

    this.game.updateOptions({
      hitSoft17: this.settings.hitSoft17,
      blackjackPayout: this.settings.blackjackPayout,
      allowSurrender: this.settings.allowSurrender,
      allowDoubleAfterSplit: this.settings.allowDoubleAfterSplit,
      maxSplits: this.settings.maxSplits
    });

    this.render();
  }

  /**
   * Rebuild the game with current settings, keeping the bankroll.
   * @private
   */
  _restart() {
    const bankroll = this.game ? this.game.players[0].bankroll : this.settings.startingBankroll;
    this._closeSheet();
    this._startSession(bankroll);
  }

  /** @private */
  _resetSession() {
    clearSession();
    this._closeSheet();
    this._startSession(this.settings.startingBankroll);
  }
}

export default App;
