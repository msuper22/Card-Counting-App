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
import GameLog from '../GameLog.js';
import { el, replace, money, signed, buzz } from './dom.js';
import { renderCard } from './CardView.js';
import CountDrill from './CountDrill.js';
import StrategyDrill from './StrategyDrill.js';
import { renderBook } from './Book.js';
import { DIFFICULTIES, applyDifficulty, detectDifficulty } from '../difficulty.js';
import {
  MODES, tierFor, applyResult, accuracies, overallRating, assessReadiness
} from '../rating.js';
import * as profiles from '../profiles.js';
import { analyze, describe as describeHand, rankValue } from '../EV.js';
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

    // Settings and progression belong to a player, not the device
    this.profile = profiles.activePlayer();
    // The profile owns its settings; loadSettings() is only the first-run seed
    this.settings = { ...DEFAULT_SETTINGS, ...(this.profile.settings || loadSettings()) };
    this.log = new GameLog();

    // Exam runs use real hard-mode conditions but bank nothing
    this.exam = null;

    // Cards already shown, so re-renders don't replay the deal animation
    this.seenCards = new Set();
    this.pendingBet = 0;
    this.bannerTimer = null;
    this.lastAdvice = null;
    this.lastGrade = null;

    // Hard-mode count audits: how many hands since the last one
    this.handsSinceAudit = 0;
    this.nextAuditAt = this._scheduleAudit();
    this.pendingAudit = false;

    this.log.append('appStarted', {
      difficulty: this.settings.difficulty,
      decks: this.settings.numberOfDecks,
      system: this.settings.countingSystem
    });

    this._buildFrame();
    this._startSession();
  }

  /**
   * Pick how many hands until the next count check. Randomised so you can't
   * simply start counting again two hands beforehand.
   * @private
   */
  _scheduleAudit() {
    return 8 + Math.floor(Math.random() * 10);
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
    this.nodes.otherSeats = el('div.seats.seats--others');

    this.nodes.felt = el('main.felt', {}, [
      el('section.seat', {}, [
        el('div.seat__label', {}, [
          el('span', { text: 'Dealer' }),
          this.nodes.dealerTotal
        ]),
        this.nodes.dealerHands
      ]),
      this.nodes.otherSeats,
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
      // Tapping the dimmed backdrop closes the sheet, unless it's a prompt
      // that has to be answered (a count check).
      if (event.target === this.nodes.sheet && this.sheetDismissible !== false) {
        this._closeSheet();
      }
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

    const others = Math.max(0, Math.min(5, this.settings.otherPlayers || 0));
    this.seatIndex = Math.min(this.settings.seatIndex || 0, others);

    this.game = new Game({
      numberOfDecks: this.settings.numberOfDecks,
      reshuffleThreshold: this.settings.reshuffleThreshold,
      maxPlayers: others + 1,
      tableMinimum: this.settings.minBet,
      tableMaximum: this.settings.maxBet,
      blackjackPayout: this.settings.blackjackPayout,
      allowSurrender: this.settings.allowSurrender,
      allowDoubleAfterSplit: this.settings.allowDoubleAfterSplit,
      maxSplits: this.settings.maxSplits,
      hitSoft17: this.settings.hitSoft17
    });

    // Seat everyone in order, with the human at their chosen position
    const BOT_NAMES = ['Ann', 'Ben', 'Cy', 'Dee', 'Eli'];
    let botNumber = 0;

    for (let seat = 0; seat <= others; seat++) {
      if (seat === this.seatIndex) {
        this.game.addPlayer('You', bankroll, {
          autoPlay: false,
          strategyLevel: 'counting',
          countingSystem: this.settings.countingSystem
        });
      } else {
        const bot = this.game.addPlayer(BOT_NAMES[botNumber++], 100000, {
          autoPlay: true,
          strategyLevel: 'basic'
        });
        bot.isBot = true;
      }
    }

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
      this._logRoundEnd(data.results);
      this._showResults(data.results);
      this.render();
      this._persist();

      // The test scores itself once the hand in progress completes
      if (this.exam && this.exam.done) {
        setTimeout(() => this._finishExam(), 1200);
        return;
      }

      // Normal mode explains misplays once the hand is over
      if (this.settings.postHandReview) {
        const mistakes = this.trainer.getRoundMistakes();
        if (mistakes.length) {
          // Let the result banner land before interrupting
          this.reviewTimer = setTimeout(() => this._openReview(mistakes), 900);
        }
      }
    });

    this.game.addEventListener('dealerBlackjack', () => {
      this._banner('lose', 'Dealer blackjack');
    });

    // Diagnostics: record the shape of every hand as it happens
    this.game.addEventListener('initialCardsDealt', data => {
      const state = data.state;
      this.log.append('dealt', {
        round: state.roundNumber,
        player: GameLog.describeHand(state.players[this.seatIndex].hands[0]),
        dealerUp: state.dealer.upCard ? `${state.dealer.upCard.rank}${state.dealer.upCard.suit[0]}` : null,
        rc: this.trainer.getCount().running,
        tc: this.trainer.getCount().true,
        decksLeft: Math.round(state.decksRemaining * 100) / 100
      });
    });

    this.game.addEventListener('deckReshuffled', () => {
      this.log.append('shuffled', { round: this.game.roundNumber });
    });

    this.game.addEventListener('insuranceOffered', () => {
      this.log.append('insuranceOffered', {
        round: this.game.roundNumber,
        tc: this.trainer.getCount().true,
        advised: this.trainer.shouldTakeInsurance()
      });
    });
  }

  /**
   * Write the settled hand to the diagnostic log.
   * @private
   */
  _logRoundEnd(results) {
    if (!results || !results.length) return;

    const state = this.game.getGameState();

    this.log.append('settled', {
      round: state.roundNumber,
      dealer: `${state.dealer.hand.map(c => `${c.rank}${c.suit[0]}`).join(' ')} (${state.dealer.fullValue})`,
      hands: results[this.seatIndex].hands
        .filter(hand => hand.bet > 0)
        .map(hand => ({
          bet: hand.bet,
          value: hand.value,
          result: hand.result,
          net: hand.net
        })),
      bankroll: results[this.seatIndex].bankroll,
      mistakes: this.trainer.getRoundMistakes().length
    });
  }

  /* ===================== rendering ===================== */

  /** Re-render everything from current game state */
  render() {
    const state = this.game.getGameState();
    this._driveBots();
    const player = state.players[this.seatIndex];

    this.nodes.bankroll.textContent = money(player.bankroll);
    this.nodes.roundLabel.textContent = `#${state.roundNumber}`;

    this._renderCount(state);
    this._renderShoe(state);
    this._renderDealer(state);
    this._renderOtherSeats(state);
    this._renderPlayer(state, player);
    this._renderAdvice(state);
    this._renderControls(state, player);
  }

  /**
   * Render the other people at the table. Their cards count too, which is the
   * whole reason for having them.
   * @private
   */
  _renderOtherSeats(state) {
    if (state.players.length <= 1) {
      replace(this.nodes.otherSeats, []);
      return;
    }

    const seats = state.players
      .map((player, index) => ({ player, index }))
      .filter(entry => entry.index !== this.seatIndex)
      .map(({ player, index }) => {
        const acting = state.gamePhase === 'playerTurn' && state.currentPlayerIndex === index;
        const hand = player.hands[0];
        const busted = player.hands.some(h => h.busted);

        return el(`div.otherseat${acting ? '.is-acting' : ''}`, {}, [
          el('div.otherseat__name', { text: player.name }),
          el('div.hand__cards', {},
            (hand ? hand.cards : []).map((card, i) => this._card(card, i))),
          this.settings.showHandTotals && hand && hand.cards.length
            ? el(`div.otherseat__total${busted ? '.otherseat__total--bust' : ''}`, {
                text: busted ? 'bust' : String(hand.value)
              })
            : null
        ]);
      });

    replace(this.nodes.otherSeats, seats);
  }

  /** @private */
  _renderCount(state) {
    const count = this.trainer.getCount();

    // With peeking disabled the numbers never reach the DOM at all, so they
    // can't be recovered by inspecting the page.
    if (!this.settings.allowCountPeek) {
      this.nodes.runningCount.textContent = '?';
      this.nodes.trueCount.textContent = '?';
      this.nodes.runningCount.className = 'count__value count__value--zero';
      this.nodes.trueCount.className = 'count__value count__value--zero';
      this.nodes.count.classList.remove('is-hidden');
      return;
    }

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

    if (!this.settings.showHandTotals) {
      // Hard mode: read the cards, do your own arithmetic
      this.nodes.dealerTotal.textContent = '';
      this.nodes.dealerTotal.className = 'seat__total is-blank';
      return;
    }

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
          player.hands.length > 1 && this.settings.showHandTotals
            ? el('span.seat__total', { text: total })
            : null
        ])
      ]);
    });

    replace(this.nodes.playerHands, handNodes);

    if (!this.settings.showHandTotals) {
      this.nodes.playerTotal.textContent = '';
      this.nodes.playerTotal.className = 'seat__total is-blank';
      return;
    }

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
    // A decision timer, when running, owns this line
    if (this.timerDeadline && state.gamePhase === 'playerTurn') {
      this._renderTimer();
      return;
    }

    // Instant feedback belongs to easy mode only. Normal defers it to the
    // post-hand review, hard defers it to the end of the session.
    if (this.lastGrade && this.settings.showAdvice) {
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
        }),
        // The menu has to stay reachable in every phase, including this one
        this._menuButton()
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
    // Hard mode gives no peeking - that's the whole point of it
    if (!this.settings.allowCountPeek) {
      this._flashAdvice('Count is hidden in hard mode');
      return;
    }

    this.settings.showCount = !this.settings.showCount;
    this.settings.difficulty = detectDifficulty(this.settings);
    saveSettings(this.settings);
    if (this.settings.haptics) buzz();
    this.render();
  }

  /**
   * Briefly show a message in the advice line.
   * @private
   */
  _flashAdvice(message) {
    replace(this.nodes.advice, el('span', { text: message, style: 'color:var(--text-dim)' }));
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => this.render(), 1600);
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

    const bankroll = this.game.players[this.seatIndex].bankroll;
    const count = this.trainer.getCount();

    // Hard mode grades the wager too - the ramp is where counting pays
    let betGrade = null;
    if (this.settings.gradeBets) {
      betGrade = this.trainer.recordBet(bet, bankroll);
    }

    this.log.append('bet', {
      round: this.game.roundNumber,
      amount: bet,
      bankroll,
      rc: count.running,
      tc: count.true,
      graded: betGrade ? betGrade.correct : null,
      suggested: betGrade ? betGrade.expected : null
    });

    // Seat the bots' wagers first; the deal triggers once everyone has bet,
    // so the human's bet must be the one that closes it.
    this.game.players.forEach((player, index) => {
      if (index !== this.seatIndex && player.currentBet === 0) {
        this.game.placeBet(index, this.settings.minBet);
      }
    });

    this.game.placeBet(this.seatIndex, bet);
    this._startTimer();
    this._persist();
  }

  /** @private */
  _act(action, viaTimeout = false) {
    // Confirm the move is legal before recording anything against it
    const actions = this.game.getAvailableActions();
    const permitted = {
      hit: actions.canHit,
      stand: actions.canStand,
      double: actions.canDouble,
      split: actions.canSplit,
      surrender: actions.canSurrender
    };

    if (!permitted[action]) {
      return;
    }

    // Capture the advice for this decision *before* the action changes the hand
    const advice = this.settings.gradeDecisions ? this.trainer.getAdvice() : null;
    if (this.settings.haptics) buzz();

    this._stopTimer();

    const before = this.game.getGameState();
    const handBefore = before.players[this.seatIndex].hands[before.currentHandIndex];

    // Grade before acting. A bust or a final stand settles the whole round
    // synchronously inside playerAction, and the post-hand review reads the
    // round's mistakes at that moment - grading afterwards would arrive too
    // late and the review would come up empty.
    this.lastGrade = advice ? this.trainer.recordDecision(action, advice) : null;

    if (this.lastGrade) {
      this._recordRating({
        correct: this.lastGrade.correct,
        isDeviation: this.lastGrade.wasDeviation,
        kind: 'play'
      });
    }

    const ok = this.game.playerAction(action);
    if (!ok) {
      this._startTimer();
      return;
    }

    this.log.append('decision', {
      round: before.roundNumber,
      hand: handBefore ? GameLog.describeHand(handBefore) : null,
      dealerUp: before.dealer.upCard ? before.dealer.upCard.rank : null,
      played: action,
      timedOut: viaTimeout || undefined,
      correct: this.lastGrade ? this.lastGrade.correct : null,
      expected: this.lastGrade && !this.lastGrade.correct ? this.lastGrade.expected : undefined,
      deviation: advice && advice.isDeviation ? true : undefined,
      tc: advice ? advice.trueCount : this.trainer.getCount().true
    });

    this.render();

    // Still the player's turn? Restart the clock for the next decision.
    if (this.game.gamePhase === 'playerTurn') {
      this._startTimer();
    }

    // Feedback is transient; clear it so the next decision gets fresh advice
    if (this.lastGrade && this.settings.showAdvice) {
      clearTimeout(this.gradeTimer);
      this.gradeTimer = setTimeout(() => {
        this.lastGrade = null;
        this.render();
      }, this.lastGrade.correct ? 1200 : 2600);
    }
  }

  /* ===================== decision timer ===================== */

  /**
   * Start the per-decision countdown, if the mode uses one.
   * @private
   */
  _startTimer() {
    this._stopTimer();

    const seconds = Number(this.settings.decisionSeconds) || 0;
    if (seconds <= 0 || this.game.gamePhase !== 'playerTurn') {
      return;
    }

    this.timerDeadline = Date.now() + seconds * 1000;

    // Paint the bar straight away rather than waiting for the first tick
    this._renderTimer();

    this.timerTick = setInterval(() => {
      if (!this.timerDeadline) return;

      if (Date.now() >= this.timerDeadline) {
        this._stopTimer();
        this.log.append('decisionTimeout', { round: this.game.roundNumber });
        // Out of time plays as a stand, and counts against you
        this._act('stand', true);
        return;
      }

      this._renderTimer();
    }, 100);
  }

  /** @private */
  _stopTimer() {
    clearInterval(this.timerTick);
    this.timerTick = null;
    this.timerDeadline = null;
  }

  /** @private */
  _renderTimer() {
    if (!this.timerDeadline) return;

    const total = (Number(this.settings.decisionSeconds) || 1) * 1000;
    const left = Math.max(0, this.timerDeadline - Date.now());
    const pct = (left / total) * 100;

    replace(this.nodes.advice, el('div.timer', {}, [
      el('span.timer__label', { text: `${Math.ceil(left / 1000)}s` }),
      el('div.timer__track', {}, el('div.timer__fill', {
        style: `width:${pct}%${pct < 30 ? ';background:var(--lose)' : ''}`
      }))
    ]));
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
    this.game.placeInsurance(this.seatIndex, take);
  }

  /** @private */
  _nextHand() {
    this._clearBanner();
    clearTimeout(this.reviewTimer);
    this.lastGrade = null;

    // Check the count *before* starting the next round, because starting it
    // may trigger a reshuffle that resets the number we're asking about.
    if (this._auditDue()) {
      this._openAudit();
      return;
    }

    this.handsSinceAudit++;
    this.game.startNewRound();
  }

  /**
   * Whether a count check is owed. Fires on the randomised interval, and
   * always just before the shoe is about to be reshuffled - counting a shoe
   * all the way to the cut card is the thing worth testing.
   * @private
   */
  _auditDue() {
    if (!this.settings.countAudits || this.pendingAudit) {
      return false;
    }

    const cutCard = this.settings.numberOfDecks * 52 * this.settings.reshuffleThreshold;
    const aboutToShuffle = this.game.deck.getCount() < cutCard;

    return aboutToShuffle || this.handsSinceAudit >= this.nextAuditAt;
  }

  /**
   * Ask the player what the running count is, and grade the answer.
   * @private
   */
  _openAudit() {
    this.pendingAudit = true;

    const input = el('input.audit__input', {
      type: 'number',
      inputmode: 'numeric',
      // Never autofocus: on a phone that yanks the keyboard up over the table
      placeholder: '0',
      'aria-label': 'Running count'
    });

    const submit = () => {
      const entered = Number.parseInt(input.value, 10);
      if (Number.isNaN(entered)) {
        input.focus();
        return;
      }
      this._gradeAudit(entered);
    };

    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') submit();
    });

    this._openSheet('Count check', el('div.audit', {}, [
      el('p.audit__prompt', {
        text: 'What is the running count right now?'
      }),
      el('p.field__hint', {
        text: `${this.game.deck.getCount()} cards left in the shoe.`,
        style: 'margin-bottom:0.75rem'
      }),
      input,
      el('div.actions', { style: 'margin-top:0.75rem' }, [
        el('button.btn', {
          type: 'button',
          text: 'Skip',
          onclick: () => this._finishAudit()
        }),
        el('button.btn.btn--primary', {
          type: 'button',
          text: 'Check',
          onclick: submit
        })
      ])
    ]), { dismissible: false });
  }

  /** @private */
  _gradeAudit(entered) {
    const result = this.trainer.recordCountAudit(entered);
    this._recordRating({ correct: result.correct, kind: 'count' });

    this.log.append('countAudit', {
      round: this.game.roundNumber,
      entered: result.entered,
      actual: result.actual,
      off: result.off,
      correct: result.correct,
      decksLeft: Math.round((this.game.deck.getCount() / 52) * 100) / 100
    });

    if (this.settings.haptics) buzz(result.correct ? [10, 40, 10] : 20);

    const stats = this.trainer.getStats();

    this._openSheet(result.correct ? 'Correct' : 'Off by ' + Math.abs(result.off),
      el('div.audit', {}, [
        el('div.stats-grid', {}, [
          el('div.stat', {}, [
            el('div.stat__value' + (result.correct ? '.stat__value--good' : '.stat__value--bad'), {
              text: signed(result.entered)
            }),
            el('div.stat__label', { text: 'You said' })
          ]),
          el('div.stat', {}, [
            el('div.stat__value', { text: signed(result.actual) }),
            el('div.stat__label', { text: 'Actual' })
          ]),
          el('div.stat', {}, [
            el('div.stat__value', { text: `${stats.auditAccuracy}%` }),
            el('div.stat__label', { text: 'Checks right' })
          ])
        ]),
        result.correct
          ? el('p.field__hint', { text: 'Count is on. Keep going.' })
          : el('p.field__hint', {
              text: result.off > 0
                ? 'You counted high — likely missed some tens or aces.'
                : 'You counted low — likely missed some low cards.'
            }),
        el('div.actions', { style: 'margin-top:1rem' }, [
          el('button.btn.btn--primary.btn--wide', {
            type: 'button',
            text: 'Continue',
            onclick: () => this._finishAudit()
          })
        ])
      ]), { dismissible: false });
  }

  /** @private */
  _finishAudit() {
    this.pendingAudit = false;
    this.handsSinceAudit = 0;
    this.nextAuditAt = this._scheduleAudit();
    this._closeSheet();
    this.game.startNewRound();
  }

  /**
   * Explain every misplay from the hand just finished (normal mode).
   * @private
   */
  _openReview(mistakes) {
    const rows = mistakes.map(mistake => el('div.review__item', {}, [
      el('div.review__head', {}, [
        el('span.review__played', {
          text: mistake.kind === 'bet'
            ? `You bet ${money(mistake.played)}`
            : `You played ${ACTION_LABELS[mistake.played] || mistake.played}`
        }),
        el('span.review__arrow', { text: '→' }),
        el('span.review__fix', {
          text: mistake.kind === 'bet'
            ? money(mistake.expected)
            : ACTION_LABELS[mistake.expected] || mistake.expected
        }),
        mistake.wasDeviation ? el('span.advice__tag', { text: 'deviation' }) : null
      ]),
      mistake.kind === 'play' && mistake.hand !== undefined
        ? el('div.review__hand', {
            text: `${mistake.hand} vs dealer ${mistake.dealerUpCard} · true count ${signed(mistake.trueCount || 0)}`
          })
        : null,
      el('p.review__why', { text: mistake.explanation })
    ]));

    this._openSheet(
      mistakes.length === 1 ? 'One to look at' : `${mistakes.length} to look at`,
      el('div', {}, [
        el('div.review', {}, rows),
        el('div.actions', { style: 'margin-top:1rem' }, [
          el('button.btn.btn--primary.btn--wide', {
            type: 'button',
            text: 'Got it',
            onclick: () => this._closeSheet()
          })
        ])
      ])
    );
  }

  /** @private */
  _rebuy() {
    this.settings.startingBankroll = this.settings.startingBankroll || 1000;
    this.game.players[this.seatIndex].bankroll = this.settings.startingBankroll;
    this._persist();
    this._nextHand();
  }

  /* ===================== results ===================== */

  /** @private */
  _showResults(results) {
    if (!results || !results.length) return;

    const hands = results[this.seatIndex].hands.filter(hand => hand.bet > 0);
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
    const bankroll = this.game.players[this.seatIndex || 0].bankroll;

    saveSession({ bankroll, lastBet: this.pendingBet, stats: this.trainer.stats });

    // The profile is the durable record; the session blob is just fast state
    this.profile.bankroll = bankroll;
    this.profile.lastBet = this.pendingBet;
    this.profile.settings = this.settings;
    profiles.savePlayer(this.profile);
  }

  /* ===================== progression ===================== */

  /**
   * Which rating bucket the current activity belongs to.
   * @private
   */
  _currentMode() {
    if (this.exam) return 'exam';
    const difficulty = this.settings.difficulty;
    return ['easy', 'normal', 'hard'].includes(difficulty) ? difficulty : 'normal';
  }

  /**
   * Bank a graded event against the active player's progression.
   * Exam runs are scored for the report but never affect lifetime stats.
   * @private
   */
  _recordRating(event) {
    const mode = event.mode || this._currentMode();

    if (this.exam) {
      this.exam.events.push({ ...event, mode: 'exam' });

      // Let the hand in progress finish before scoring
      const plays = this.exam.events.filter(e => e.kind === 'play').length;
      if (plays >= this.exam.target) {
        this.exam.done = true;
      }
      return;
    }

    this.profile.modes[mode] = applyResult(this.profile.modes[mode], { ...event, mode });
    this.profile.modes[mode].lastPlayed = new Date().toISOString();
    profiles.savePlayer(this.profile);
  }

  /* ===================== sheets ===================== */

  /**
   * Show a bottom sheet.
   * @param {string} title
   * @param {Node} body
   * @param {Object} [options] - `dismissible: false` for prompts that must be answered
   * @private
   */
  _openSheet(title, body, options = {}) {
    const dismissible = options.dismissible !== false;
    this.sheetDismissible = dismissible;

    replace(this.nodes.sheet, el('div.sheet__panel', {}, [
      el('div.sheet__header', {}, [
        el('h2.sheet__title', { text: title }),
        dismissible
          ? el('button.sheet__close', {
              type: 'button',
              text: '✕',
              'aria-label': 'Close',
              onclick: () => this._closeSheet()
            })
          : null
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
    const current = DIFFICULTIES[this.settings.difficulty] || DIFFICULTIES.custom;

    this._openSheet('Menu', el('div', {}, [
      el('div.field', {}, [
        el('div', {}, [
          el('div.field__label', { text: 'Difficulty' }),
          el('span.field__hint', { text: current.blurb })
        ])
      ]),
      el('div.actions', { style: 'margin-bottom:1rem' },
        ['easy', 'normal', 'hard'].map(key => el('button.btn', {
          type: 'button',
          text: DIFFICULTIES[key].label,
          class: this.settings.difficulty === key ? 'btn--primary' : null,
          onclick: () => this._setDifficulty(key)
        }))
      ),

      el('div.actions', { style: 'margin-bottom:0.75rem' }, [
        el('button.btn.btn--primary.btn--wide', {
          type: 'button', text: 'Strategy drill', onclick: () => this._startStrategyDrill()
        }),
        el('button.btn.btn--wide', {
          type: 'button', text: 'Count drill', onclick: () => this._openDrillSetup()
        }),
        el('button.btn.btn--wide', {
          type: 'button', text: 'The Book', onclick: () => this._openBook()
        }),
        el('button.btn.btn--wide', {
          type: 'button',
          text: this.exam ? 'End casino test' : 'Casino test',
          onclick: () => (this.exam ? this._finishExam() : this._openExamSetup())
        }),
        el('button.btn.btn--wide', {
          type: 'button', text: 'Ratings', onclick: () => this._openRatings()
        }),
        el('button.btn.btn--wide', {
          type: 'button',
          text: `Players (${this.profile.name})`,
          onclick: () => this._openPlayers()
        }),
        el('button.btn.btn--wide', {
          type: 'button', text: 'Table seats', onclick: () => this._openSeats()
        }),
        el('button.btn.btn--wide', {
          type: 'button', text: 'Session stats', onclick: () => this._openStats()
        }),
        el('button.btn.btn--wide', {
          type: 'button', text: 'Settings', onclick: () => this._openSettings()
        }),
        el('button.btn.btn--wide', {
          type: 'button', text: 'How counting works', onclick: () => this._openHelp()
        }),
        el('button.btn.btn--wide', {
          type: 'button', text: `Game log (${this.log.size()})`, onclick: () => this._openLog()
        })
      ])
    ]));
  }

  /* ===================== the book ===================== */

  /** @private */
  _openBook() {
    this._openSheet('The Book', renderBook(this.settings));
  }

  /* ===================== strategy drill ===================== */

  /** @private */
  _startStrategyDrill() {
    this._closeSheet();
    this._stopTimer();

    this.log.append('strategyDrillStarted', {});

    this.strategyDrill = new StrategyDrill(this.container, {
      hitSoft17: this.settings.hitSoft17,
      surrender: this.settings.allowSurrender,
      doubleAfterSplit: this.settings.allowDoubleAfterSplit,
      haptics: this.settings.haptics,
      log: this.log,
      onResult: event => this._recordRating(event),
      onExit: () => {
        const drill = this.strategyDrill;
        this.strategyDrill = null;
        this.log.append('strategyDrillFinished', {
          asked: drill.asked, right: drill.right, bestStreak: drill.bestStreak
        });
        this._buildFrame();
        this.render();
      }
    });
  }

  /* ===================== ratings ===================== */

  /** @private */
  _openRatings() {
    const modes = this.profile.modes || {};
    const overall = overallRating(modes);
    const overallTier = tierFor(overall);

    const card = key => {
      const record = modes[key] || {};
      const tier = tierFor(record.rating || 0);
      const acc = accuracies(record);

      return el('div.rating', {}, [
        el('div.rating__head', {}, [
          el('span.rating__mode', { text: MODES[key].label }),
          el('span.rating__tier', { text: tier.name })
        ]),
        el('div.rating__bar', {}, el('div.rating__fill', {
          style: `width:${Math.round((record.rating || 0) / 10)}%`
        })),
        el('div.rating__meta', {}, [
          el('span', { text: `${record.rating || 0} / 1000` }),
          el('span', {
            text: acc.accuracy === null
              ? 'not played'
              : `${acc.accuracy}% over ${record.decisions} decisions`
          })
        ])
      ]);
    };

    this._openSheet('Ratings', el('div', {}, [
      el('div.rating', { style: 'margin-bottom:0.85rem' }, [
        el('div.rating__head', {}, [
          el('span.rating__mode', { text: `${this.profile.name} — overall` }),
          el('span.rating__tier', { text: overallTier.name })
        ]),
        el('div.rating__bar', {}, el('div.rating__fill', {
          style: `width:${Math.round(overall / 10)}%`
        })),
        el('div.rating__meta', {}, [
          el('span', { text: `${overall} / 1000` }),
          el('span', { text: overallTier.blurb })
        ])
      ]),

      el('h3.status__label', { text: 'By mode', style: 'margin:0.5rem 0 0.4rem' }),
      el('div', { style: 'display:flex;flex-direction:column;gap:0.5rem' },
        ['easy', 'normal', 'hard', 'strategy', 'count'].map(card)),

      this.profile.exams && this.profile.exams.length
        ? el('div', {}, [
            el('h3.status__label', { text: 'Casino tests', style: 'margin:1rem 0 0.4rem' }),
            el('div.mistakes', {}, this.profile.exams.slice(-5).reverse().map(exam =>
              el('div.mistake', {}, [
                el('span', { text: new Date(exam.at).toLocaleDateString() }),
                el('span', {}, [
                  el('span.mistake__fix', { text: `Grade ${exam.grade}` }),
                  el('span', { text: ` · ${exam.accuracy}%` })
                ])
              ])
            ))
          ])
        : null
    ]));
  }

  /* ===================== players ===================== */

  /** @private */
  _openPlayers() {
    const all = profiles.listPlayers();

    const rows = all.map(player => {
      const overall = overallRating(player.modes || {});
      const tier = tierFor(overall);
      const isActive = player.id === this.profile.id;

      return el('div', { style: 'display:flex;gap:0.4rem;align-items:stretch' }, [
        el(`button.player${isActive ? '.is-active' : ''}`, {
          type: 'button',
          onclick: () => this._switchPlayer(player.id)
        }, [
          el('div.player__avatar', { text: player.name.charAt(0).toUpperCase() }),
          el('div.player__body', {}, [
            el('div.player__name', { text: player.name }),
            el('div.player__meta', { text: `${tier.name} · ${overall} · ${money(player.bankroll)}` })
          ]),
          isActive ? el('span.rating__tier', { text: 'PLAYING' }) : null
        ]),
        all.length > 1
          ? el('button.btn.btn--danger', {
              type: 'button',
              text: '✕',
              'aria-label': `Delete ${player.name}`,
              style: 'flex:0 0 auto;min-width:2.75rem',
              onclick: () => this._deletePlayer(player.id)
            })
          : null
      ]);
    });

    const nameInput = el('input', {
      type: 'text',
      placeholder: 'New player name',
      maxlength: '20',
      style: 'flex:1;min-height:2.875rem;padding:0.35rem 0.6rem;background:var(--surface-raised);' +
             'color:var(--text);border:1px solid var(--border);border-radius:0.5rem;font-size:1rem'
    });

    this._openSheet('Players', el('div', {}, [
      el('p.field__hint', {
        text: 'Each player keeps their own bankroll, settings and ratings.',
        style: 'margin-bottom:0.75rem'
      }),
      el('div.player-list', {}, rows),

      el('div', { style: 'display:flex;gap:0.5rem;margin-top:1rem' }, [
        nameInput,
        el('button.btn.btn--primary', {
          type: 'button',
          text: 'Add',
          onclick: () => {
            const created = profiles.addPlayer(nameInput.value.trim() || `Player ${all.length + 1}`);
            if (!created) {
              this._flashAdvice('Maximum of 8 players');
              return;
            }
            this._switchPlayer(created.id);
          }
        })
      ]),

      el('div.actions', { style: 'margin-top:1rem' }, [
        el('button.btn.btn--danger.btn--wide', {
          type: 'button',
          text: `Reset ${this.profile.name}'s progress`,
          onclick: () => {
            profiles.resetProgress(this.profile.id);
            this.profile = profiles.activePlayer();
            this._restart();
          }
        })
      ])
    ]));
  }

  /** @private */
  _switchPlayer(id) {
    const player = profiles.selectPlayer(id);
    if (!player) return;

    this.profile = player;
    this.settings = { ...DEFAULT_SETTINGS, ...(player.settings || {}) };
    saveSettings(this.settings);

    this.log.append('playerSwitched', { name: player.name, id });
    this._closeSheet();
    this._startSession(player.bankroll);
    this._flashAdvice(`Playing as ${player.name}`);
  }

  /** @private */
  _deletePlayer(id) {
    if (!profiles.removePlayer(id)) {
      this._flashAdvice('Cannot remove the last player');
      return;
    }

    if (id === this.profile.id) {
      this.profile = profiles.activePlayer();
      this.settings = { ...DEFAULT_SETTINGS, ...(this.profile.settings || {}) };
      this._startSession(this.profile.bankroll);
    }

    this._openPlayers();
  }

  /** @private */
  _setDifficulty(key) {
    this.settings = applyDifficulty(this.settings, key);
    saveSettings(this.settings);
    this.log.append('difficultyChanged', { difficulty: key });

    // Timer settings only take effect from the next decision
    this._stopTimer();
    this._closeSheet();
    this._flashAdvice(`${DIFFICULTIES[key].label} mode`);
  }

  /* ===================== casino test ===================== */

  /** @private */
  _openExamSetup() {
    this._openSheet('Casino test', el('div', {}, [
      el('p.field__hint', {
        text: 'A realistic assessment under full casino conditions: six decks, no count on ' +
              'screen, no hand totals, timed decisions and your bet sizing graded. ' +
              'Nothing here touches your ratings — it exists to tell you where you actually stand.',
        style: 'margin-bottom:0.75rem;line-height:1.45'
      }),
      el('div.field', {}, [
        el('div', {}, [
          el('div.field__label', { text: 'Length' }),
          el('span.field__hint', { text: 'Decisions before the assessment is scored' })
        ]),
        el('select', {
          onchange: event => { this.examTarget = Number(event.target.value); }
        }, [30, 50, 100].map(n => el('option', {
          value: String(n), text: `${n} decisions`, selected: n === (this.examTarget || 50)
        })))
      ]),
      el('div.actions', { style: 'margin-top:1rem' }, [
        el('button.btn.btn--primary.btn--wide', {
          type: 'button',
          text: 'Begin test',
          onclick: () => this._startExam()
        })
      ])
    ]));
  }

  /** @private */
  _startExam() {
    this._closeSheet();

    this.examPreviousSettings = { ...this.settings };
    this.exam = {
      events: [],
      target: this.examTarget || 50,
      startedAt: new Date().toISOString(),
      startingBankroll: this.game ? this.game.players[this.seatIndex].bankroll : 1000
    };

    // Full casino conditions, regardless of what the player normally uses
    this.settings = applyDifficulty(
      { ...this.settings, numberOfDecks: 6, reshuffleThreshold: 0.25 },
      'hard'
    );

    this.log.append('examStarted', { target: this.exam.target });
    this._restart();
    this._flashAdvice(`Casino test — ${this.exam.target} decisions`);
  }

  /**
   * Score the test, report, and restore the player's normal settings.
   * @private
   */
  _finishExam() {
    if (!this.exam) return;

    const events = this.exam.events;
    const plays = events.filter(event => event.kind === 'play');
    const checks = events.filter(event => event.kind === 'count');
    const deviations = plays.filter(event => event.isDeviation);

    const pct = (hit, total) => (total > 0 ? Math.round((hit / total) * 100) : null);

    const result = {
      decisions: plays.length,
      accuracy: pct(plays.filter(e => e.correct).length, plays.length),
      deviationAccuracy: pct(deviations.filter(e => e.correct).length, deviations.length),
      countAccuracy: pct(checks.filter(e => e.correct).length, checks.length),
      countChecks: checks.length
    };

    const assessment = assessReadiness(result);
    const bankroll = this.game.players[this.seatIndex].bankroll;

    const record = {
      at: this.exam.startedAt,
      grade: assessment.grade,
      ready: assessment.ready,
      accuracy: result.accuracy ?? 0,
      countAccuracy: result.countAccuracy,
      decisions: result.decisions,
      net: bankroll - this.exam.startingBankroll
    };

    this.profile.exams = [...(this.profile.exams || []), record].slice(-20);
    profiles.savePlayer(this.profile);

    this.log.append('examFinished', record);

    // Restore whatever the player was using before
    this.exam = null;
    if (this.examPreviousSettings) {
      this.settings = this.examPreviousSettings;
      this.examPreviousSettings = null;
      saveSettings(this.settings);
    }

    this._restart();
    this._showExamReport(assessment, result, record);
  }

  /** @private */
  _showExamReport(assessment, result, record) {
    const gradeClass = assessment.ready ? 'exam__grade--pass'
      : ['D', 'F'].includes(assessment.grade) ? 'exam__grade--fail' : '';

    this._openSheet('Test result', el('div', {}, [
      el(`div.exam__grade${gradeClass ? '.' + gradeClass : ''}`, { text: assessment.grade }),
      el('p.exam__verdict', { text: assessment.verdict }),

      el('div.stats-grid', {}, [
        el('div.stat', {}, [
          el('div.stat__value', { text: `${result.accuracy ?? 0}%` }),
          el('div.stat__label', { text: 'Strategy' })
        ]),
        el('div.stat', {}, [
          el('div.stat__value', {
            text: result.countAccuracy === null ? '—' : `${result.countAccuracy}%`
          }),
          el('div.stat__label', { text: 'Count held' })
        ]),
        el('div.stat', {}, [
          el('div.stat__value', { text: String(result.decisions) }),
          el('div.stat__label', { text: 'Decisions' })
        ]),
        el('div.stat', {}, [
          el('div.stat__value', {
            text: `${record.net >= 0 ? '+' : ''}${money(record.net)}`
          }),
          el('div.stat__label', { text: 'Result' })
        ])
      ]),

      el('h3.status__label', { text: 'Notes', style: 'margin:0.85rem 0 0.4rem' }),
      el('div.exam__notes', {}, assessment.notes.map(note =>
        el('div.exam__note', { text: note })
      )),

      el('div.actions', { style: 'margin-top:1rem' }, [
        el('button.btn.btn--primary.btn--wide', {
          type: 'button', text: 'Done', onclick: () => this._closeSheet()
        })
      ])
    ]));
  }

  /* ===================== table seats ===================== */

  /** @private */
  _openSeats() {
    const others = this.settings.otherPlayers || 0;

    this._openSheet('Table seats', el('div', {}, [
      el('p.field__hint', {
        text: 'Adding players means more cards to count between your turns, which is how a ' +
              'real table plays. Each one takes a moment to act before the action reaches you.',
        style: 'margin-bottom:0.75rem;line-height:1.45'
      }),

      el('div.field', {}, [
        el('div', {}, [
          el('div.field__label', { text: 'Other players' }),
          el('span.field__hint', { text: 'Bots playing basic strategy' })
        ]),
        el('select', {
          onchange: event => this._updateSetting('otherPlayers', Number(event.target.value), true)
        }, [0, 1, 2, 3, 4, 5].map(n => el('option', {
          value: String(n), text: n === 0 ? 'None' : String(n), selected: n === others
        })))
      ]),

      el('div.field', {}, [
        el('div', {}, [
          el('div.field__label', { text: 'Your seat' }),
          el('span.field__hint', { text: 'Third base acts last, first base acts first' })
        ]),
        el('select', {
          onchange: event => this._updateSetting('seatIndex', Number(event.target.value), true)
        }, Array.from({ length: others + 1 }, (unused, index) => el('option', {
          value: String(index),
          text: index === 0 ? 'First base'
            : index === others ? 'Third base'
            : `Seat ${index + 1}`,
          selected: index === Math.min(this.settings.seatIndex || 0, others)
        })))
      ]),

      el('div.field', {}, [
        el('div', {}, [
          el('div.field__label', { text: 'Pace' }),
          el('span.field__hint', { text: 'How long each other player takes' })
        ]),
        el('select', {
          onchange: event => this._updateSetting('seatDelayMs', Number(event.target.value))
        }, [[1000, 'Fast (1s)'], [2000, 'Normal (2s)'], [3500, 'Slow (3.5s)']].map(([ms, label]) =>
          el('option', {
            value: String(ms), text: label, selected: ms === (this.settings.seatDelayMs || 2000)
          })
        ))
      ])
    ]));
  }

  /**
   * Play the current bot's hand after a pause, so the table has a real rhythm
   * and you have to track their cards.
   * @private
   */
  _driveBots() {
    clearTimeout(this.botTimer);

    if (this.game.gamePhase !== 'playerTurn') return;

    const index = this.game.currentPlayerIndex;
    if (index === this.seatIndex || index >= this.game.players.length) return;

    const delay = this.settings.seatDelayMs || 2000;

    this.botTimer = setTimeout(() => {
      // The turn may have moved on while we waited
      if (this.game.gamePhase !== 'playerTurn') return;
      if (this.game.currentPlayerIndex === this.seatIndex) return;

      const hand = this.game.currentHand();
      const upCard = this.game.dealer.getUpCard();
      if (!hand || !upCard) return;

      const actions = this.game.getAvailableActions();
      const analysis = analyze(describeHand(hand.cards), rankValue(upCard.rank), {
        hitSoft17: this.settings.hitSoft17,
        surrender: this.settings.allowSurrender,
        doubleAfterSplit: this.settings.allowDoubleAfterSplit,
        canHit: actions.canHit,
        canStand: actions.canStand,
        canDouble: actions.canDouble,
        canSplit: actions.canSplit,
        canSurrender: actions.canSurrender
      });

      this.game.playerAction(analysis.best);
      this.render();
      this._driveBots();
    }, delay);
  }

  /* ===================== count drill ===================== */

  /** @private */
  _openDrillSetup() {
    this._openSheet('Count drill', el('div', {}, [
      el('p.field__hint', {
        text: 'Deals a shoe one card at a time and stops at random to ask for the running count. ' +
              'Speed is adjustable mid-drill.',
        style: 'margin-bottom:0.75rem;line-height:1.45'
      }),
      el('div.field', {}, [
        el('div.field__label', { text: 'Shoe size' }),
        el('select', {
          onchange: event => { this.drillDecks = Number(event.target.value); }
        }, [1, 2, 4, 6, 8].map(decks => el('option', {
          value: String(decks),
          text: `${decks} deck${decks > 1 ? 's' : ''}`,
          selected: decks === (this.drillDecks || this.settings.numberOfDecks)
        })))
      ]),
      el('div.field', {}, [
        el('div.field__label', { text: 'Count checks' }),
        el('select', {
          onchange: event => { this.drillChecks = Number(event.target.value); }
        }, [2, 4, 6, 10].map(n => el('option', {
          value: String(n),
          text: `${n} per shoe`,
          selected: n === (this.drillChecks || 4)
        })))
      ]),
      el('div.actions', { style: 'margin-top:1rem' }, [
        el('button.btn.btn--primary.btn--wide', {
          type: 'button',
          text: 'Start drill',
          onclick: () => this._startDrill()
        })
      ])
    ]));
  }

  /** @private */
  _startDrill() {
    this._closeSheet();
    this._stopTimer();

    const decks = this.drillDecks || this.settings.numberOfDecks;
    const checks = this.drillChecks || 4;

    this.log.append('drillStarted', {
      decks,
      checks,
      system: this.settings.countingSystem,
      speed: this.settings.drillSpeed || 'steady'
    });

    this.drill = new CountDrill(this.container, {
      decks,
      checksPerShoe: checks,
      countingSystem: this.settings.countingSystem,
      speed: this.settings.drillSpeed || 'steady',
      haptics: this.settings.haptics,
      log: this.log,
      onExit: () => this._exitDrill()
    });
  }

  /** @private */
  _exitDrill() {
    // Remember the speed that was last used
    if (this.drill) {
      this.settings.drillSpeed = this.drill.options.speed;
      saveSettings(this.settings);
      this.drill.destroy();
      this.drill = null;
    }

    // Rebuild the table; the drill replaced the container's contents
    this._buildFrame();
    this.render();
  }

  /* ===================== diagnostics ===================== */

  /** @private */
  _openLog() {
    const text = this.log.toText(true);
    const lines = text ? text.split('\n').slice(-80).reverse() : [];

    const copy = async () => {
      const payload = this.log.toJSON(false);
      try {
        await navigator.clipboard.writeText(payload);
        this._flashAdvice('Log copied');
        this._closeSheet();
      } catch {
        // Clipboard needs a secure context and permission; fall back to a
        // selectable textarea the user can copy from by hand.
        this._openSheet('Copy log', el('div', {}, [
          el('p.field__hint', {
            text: 'Select all and copy.',
            style: 'margin-bottom:0.5rem'
          }),
          el('textarea.log__raw', { value: payload, readonly: true, rows: 14 })
        ]));
      }
    };

    this._openSheet('Game log', el('div', {}, [
      el('p.field__hint', {
        text: `${this.log.size()} entries stored. Copy this and send it over if something looks wrong.`,
        style: 'margin-bottom:0.75rem'
      }),
      el('div.actions', { style: 'margin-bottom:0.75rem' }, [
        el('button.btn.btn--primary', { type: 'button', text: 'Copy log', onclick: copy }),
        el('button.btn.btn--danger', {
          type: 'button',
          text: 'Clear',
          onclick: () => { this.log.clear(); this._openLog(); }
        })
      ]),
      lines.length
        ? el('div.log', {}, lines.map(line => el('div.log__line', { text: line })))
        : el('p.empty', { text: 'Nothing logged yet.' })
    ]));
  }

  /** @private */
  _openStats() {
    const stats = this.trainer.getStats();
    const player = this.game.players[this.seatIndex];
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
        stats.betsGraded > 0
          ? stat(`${stats.betAccuracy}%`, 'Bet sizing', stats.betAccuracy >= 80 ? 'good' : 'bad')
          : null,
        stats.auditsTaken > 0
          ? stat(
              `${stats.auditsCorrect}/${stats.auditsTaken}`,
              'Count checks',
              stats.auditAccuracy >= 80 ? 'good' : 'bad'
            )
          : null,
        stat(
          `${net >= 0 ? '+' : ''}${money(net)}`,
          'Net',
          net > 0 ? 'good' : net < 0 ? 'bad' : null
        ),
        stat(String(player.roundsWon), 'Won'),
        stat(String(player.blackjacks), 'Blackjacks')
      ].filter(Boolean)),

      el('h3.status__label', { text: 'Recent mistakes', style: 'margin:0.75rem 0 0.35rem' }),
      mistakes.length
        ? el('div.mistakes', {}, mistakes.map(mistake => el('div.mistake', {}, [
            el('span', {
              text: mistake.kind === 'bet'
                ? `Bet size @ TC ${signed(mistake.trueCount || 0)}`
                : `${mistake.hand} vs ${mistake.dealerUpCard} @ TC ${signed(mistake.trueCount || 0)}`
            }),
            el('span', {}, [
              el('span', {
                text: mistake.kind === 'bet'
                  ? `${money(mistake.played)} → `
                  : `${mistake.played} → `
              }),
              el('span.mistake__fix', {
                text: mistake.kind === 'bet' ? money(mistake.expected) : mistake.expected
              })
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

    const current = DIFFICULTIES[this.settings.difficulty] || DIFFICULTIES.custom;

    this._openSheet('Settings', el('div', {}, [
      el('h3.status__label', { text: 'Difficulty', style: 'margin:0.25rem 0' }),
      el('div.actions', {}, ['easy', 'normal', 'hard'].map(key => el('button.btn', {
        type: 'button',
        text: DIFFICULTIES[key].label,
        class: this.settings.difficulty === key ? 'btn--primary' : null,
        onclick: () => {
          this.settings = applyDifficulty(this.settings, key);
          saveSettings(this.settings);
          this._openSettings();
        }
      }))),
      el('p.field__hint', { text: current.blurb, style: 'margin:0.4rem 0 0.75rem' }),

      el('h3.status__label', { text: 'Training', style: 'margin:0.25rem 0' }),
      toggle('showCount', 'Show the count', 'Turn off to practise counting yourself'),
      toggle('allowCountPeek', 'Allow tapping to peek at the count'),
      toggle('showAdvice', 'Show recommended play'),
      toggle('postHandReview', 'Explain misplays after each hand'),
      toggle('showHandTotals', 'Show hand totals'),
      toggle('countAudits', 'Ask me for the count periodically'),
      toggle('gradeBets', 'Grade my bet sizing'),
      select('decisionSeconds', 'Decision timer', [
        [0, 'Off'], [20, '20 seconds'], [12, '12 seconds'], [8, '8 seconds'], [5, '5 seconds']
      ], 'Running out of time stands the hand'),
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
      section('Game modes', [
        'Strategy drill — pure basic strategy, one spot at a time. Wrong answers show the correct play, what the mistake costs in EV, why, and a number worth remembering.',
        'Count drill — deals a shoe a card at a time and stops at random to ask for the running count.',
        'Casino test — realistic six-deck conditions that score you and say whether you are ready for a real table. Nothing in it touches your ratings.',
        'The Book — the basic strategy chart, generated from the rules you have set rather than printed, so it always matches your table.'
      ]),
      section('Ratings and players', [
        'Each mode carries its own 0-1000 rating, so sharp basic strategy does not flatter a weak count.',
        'Mistakes cost more than correct plays earn, and harder modes are worth more per hand.',
        'Multiple players can share the app, each with their own bankroll, settings and progression.'
      ]),
      section('Difficulty modes', [
        'Easy — the count is on screen and the correct play is named before you act.',
        'Normal — the count stays on screen but you decide alone. Anything you misplay is explained once the hand is over.',
        'Hard — no count, no hand totals, a timer on each decision and your bet size graded. You find out how you did at the end of the session.'
      ]),
      section('Count drill', [
        'A pure counting exercise: it deals a shoe one card at a time and stops at random to ask for the running count.',
        'Speed runs from Slow to Blitz and can be changed mid-drill, so you can push the pace as you get comfortable.',
        'A complete Hi-Lo shoe always ends on zero — if your final count is not zero, you dropped one somewhere.'
      ]),
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

    // Hand-tuning any training flag moves you off the preset
    this.settings.difficulty = detectDifficulty(this.settings);
    saveSettings(this.settings);

    if (key === 'decisionSeconds') {
      this._stopTimer();
      if (this.game.gamePhase === 'playerTurn') this._startTimer();
    }

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
    const bankroll = this.game ? this.game.players[this.seatIndex].bankroll : this.settings.startingBankroll;
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
