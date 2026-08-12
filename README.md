# Blackjack Card Counting Trainer

A browser-based blackjack trainer for practising card counting. Built to be
played one-handed on a phone: install it to the home screen and it works
offline.

## What it does

- **Full blackjack engine** — splits, resplits, double after split, late
  surrender, insurance, configurable H17/S17, 3:2 or 6:5, 1–8 decks and
  adjustable deck penetration.
- **Three counting systems** — Hi-Lo, Knock-Out and Omega II, with running
  count, true count and shoe penetration shown live.
- **Hide the count** — tap the count in the status bar to blur it, keep the
  count yourself, then tap again to check. This is the main training loop.
- **Basic strategy and deviations** — every decision is graded against basic
  strategy plus the Illustrious 18 index plays, with deviations scored
  separately since they're the harder skill.
- **Bet sizing guidance** — a suggested wager based on the true count and the
  table limits, which can be turned off to practise the ramp yourself.
- **Session tracking** — hands played, strategy accuracy, deviation accuracy,
  net result and a log of recent mistakes with the correct play.

Bankroll, settings and stats persist across reloads.

## Running locally

```bash
npm install
npm run build
npm start          # dev server on http://localhost:8080
```

Other scripts:

```bash
npm test           # engine, trainer and DOM tests
npm run dev        # rebuild on change
npm run icons      # regenerate the PWA icon set
```

## Layout

```
src/
  Card.js Deck.js Hand.js Player.js Dealer.js Game.js   # game engine
  Counter.js Strategy.js DeviationEngine.js
  BettingStrategy.js CardCounting.js                    # counting engine
  Trainer.js                                            # binds counting to a game
  storage.js                                            # localStorage persistence
  ui/App.js ui/CardView.js ui/dom.js                    # interface
tests/                                                  # node:test suites
scripts/make-icons.mjs                                  # PWA icon generator
```

`Game` is the single source of truth. It emits events, exposes legal moves via
`getAvailableActions()`, and the UI re-renders from `getGameState()` — the UI
never duplicates a rule.

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which runs the tests,
builds the bundle and publishes to GitHub Pages.

## Notes on the rules implemented

- Aces count as 11 and demote to 1 only as needed; a hand is "soft" only while
  an ace is actually being counted as 11.
- The dealer peeks for blackjack without exposing the hole card.
- Insurance is offered against an ace *before* the dealer peeks.
- 21 on a split hand pays even money, not 3:2.
- Split aces receive one card each and stand.
- Each hand carries its own bet, so splits and doubles settle independently.
- Cards move to a discard tray and return to the shoe only on a reshuffle, and
  the running count resets when that happens.
