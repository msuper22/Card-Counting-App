/**
 * sound.js
 *
 * Synthesised audio. Every sound is generated with the Web Audio API rather
 * than loaded from a file, which keeps the app a single small bundle and means
 * sound still works offline with nothing extra to cache.
 *
 * Mobile browsers refuse to start an AudioContext outside a user gesture, so
 * the context is created lazily on the first tap and unlocked from there.
 */

const VOICES = {
  // A short, dry click for a card landing
  deal: { type: 'triangle', from: 320, to: 180, duration: 0.07, gain: 0.16 },
  // A chip being set down
  chip: { type: 'square', from: 900, to: 620, duration: 0.05, gain: 0.07 },
  // Rising major third for a win
  win: { type: 'sine', from: 523, to: 784, duration: 0.24, gain: 0.16 },
  // Falling for a loss
  lose: { type: 'sine', from: 392, to: 233, duration: 0.28, gain: 0.14 },
  // Flat, neutral for a push
  push: { type: 'sine', from: 392, to: 392, duration: 0.16, gain: 0.11 },
  // Bright arpeggio for a blackjack
  blackjack: { type: 'sine', from: 523, to: 1046, duration: 0.36, gain: 0.18 },
  // Crisp ping for a right answer
  correct: { type: 'sine', from: 880, to: 1174, duration: 0.13, gain: 0.14 },
  // Low buzz for a wrong one
  wrong: { type: 'sawtooth', from: 220, to: 148, duration: 0.26, gain: 0.11 },
  // Attention tone for a count check
  prompt: { type: 'triangle', from: 660, to: 660, duration: 0.12, gain: 0.13 },
  // Riffle for a shuffle
  shuffle: { type: 'triangle', from: 240, to: 400, duration: 0.3, gain: 0.09 }
};

class Sound {
  /**
   * @param {Object} options - { enabled }
   */
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.context = null;
    this.failed = false;
  }

  /**
   * Create or resume the audio context. Safe to call on every gesture.
   * @returns {boolean} Whether audio is usable
   */
  unlock() {
    if (this.failed || !this.enabled) return false;

    try {
      if (!this.context) {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) {
          this.failed = true;
          return false;
        }
        this.context = new Ctor();
      }

      // Safari suspends the context whenever the page loses focus
      if (this.context.state === 'suspended') {
        this.context.resume();
      }

      return true;
    } catch {
      // Audio is a nicety - never let it break a hand
      this.failed = true;
      return false;
    }
  }

  /**
   * Turn sound on or off.
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    if (enabled) this.unlock();
  }

  /**
   * Play a named sound.
   * @param {string} name - Key from VOICES
   */
  play(name) {
    const voice = VOICES[name];
    if (!voice || !this.enabled || !this.unlock()) return;

    try {
      const ctx = this.context;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = voice.type;
      osc.frequency.setValueAtTime(voice.from, now);

      if (voice.to !== voice.from) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, voice.to), now + voice.duration);
      }

      // Quick attack, smooth decay so nothing clicks or clips
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(voice.gain, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + voice.duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + voice.duration + 0.02);
    } catch {
      // Ignore; a missed sound is never worth an error
    }
  }

  /**
   * Play a sound for a settled hand.
   * @param {string} outcome - win | lose | push | blackjack
   */
  playResult(outcome) {
    this.play(VOICES[outcome] ? outcome : 'push');
  }
}

export default Sound;
export { VOICES };
