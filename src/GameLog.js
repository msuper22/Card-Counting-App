/**
 * GameLog.js
 *
 * A structured journal of everything that happens in a session: bets, cards,
 * decisions and how they were graded, count audits, shuffles, settlements and
 * errors.
 *
 * The point is diagnosis. If a hand looks wrong, the log should contain enough
 * to reconstruct exactly what the engine did and why, without needing to
 * reproduce it. It survives reloads and can be copied out as JSON.
 */

const STORAGE_KEY = 'ccapp:log:v1';
const MAX_ENTRIES = 600;

class GameLog {
  constructor() {
    this.entries = [];
    this.sessionId = this._makeSessionId();
    this._restore();

    this.append('sessionStarted', {
      sessionId: this.sessionId,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'
    });
  }

  /** @private */
  _makeSessionId() {
    return `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  }

  /** @private */
  _restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) this.entries = parsed.slice(-MAX_ENTRIES);
      }
    } catch {
      // A corrupt log must never stop the app from starting
      this.entries = [];
    }
  }

  /** @private */
  _persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries));
    } catch {
      // Out of quota - drop the oldest half and try once more
      this.entries = this.entries.slice(-Math.floor(MAX_ENTRIES / 2));
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries));
      } catch {
        // Give up quietly; the in-memory log still works for this session
      }
    }
  }

  /**
   * Record an event.
   * @param {string} type - Event name
   * @param {Object} [data] - Structured payload
   */
  append(type, data = {}) {
    this.entries.push({
      t: new Date().toISOString(),
      s: this.sessionId,
      type,
      ...data
    });

    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-MAX_ENTRIES);
    }

    this._persist();
  }

  /**
   * Compact description of a hand, for embedding in log entries.
   * @param {Object} hand - Serialized hand from getGameState()
   * @returns {string} e.g. "K♠ 7♥ (17)"
   */
  static describeHand(hand) {
    const cards = hand.cards
      .map(card => (card.faceUp ? `${card.rank}${card.suit[0]}` : '??'))
      .join(' ');
    return `${cards} (${hand.value}${hand.soft ? ' soft' : ''})`;
  }

  /** All entries for the current session only */
  currentSession() {
    return this.entries.filter(entry => entry.s === this.sessionId);
  }

  /**
   * The log as pretty JSON, ready to paste somewhere.
   * @param {boolean} [sessionOnly] - Limit to the current session
   * @returns {string}
   */
  toJSON(sessionOnly = false) {
    const entries = sessionOnly ? this.currentSession() : this.entries;
    return JSON.stringify({ sessionId: this.sessionId, entries }, null, 2);
  }

  /**
   * A human-readable rendering, which is usually what you want when scanning
   * for the moment something went wrong.
   * @param {boolean} [sessionOnly]
   * @returns {string}
   */
  toText(sessionOnly = false) {
    const entries = sessionOnly ? this.currentSession() : this.entries;

    return entries.map(entry => {
      const time = entry.t.slice(11, 19);
      const { t, s, type, ...rest } = entry;
      const detail = Object.entries(rest)
        .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : value}`)
        .join(' ');
      return `${time} ${type}${detail ? ' ' + detail : ''}`;
    }).join('\n');
  }

  /** Number of stored entries */
  size() {
    return this.entries.length;
  }

  /** Wipe the log */
  clear() {
    this.entries = [];
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to do
    }
    this.append('logCleared', {});
  }
}

export default GameLog;
