/**
 * storage.js
 *
 * Persists settings, bankroll and session stats to localStorage so that
 * closing the tab mid-session doesn't wipe progress. Every access is guarded:
 * private browsing and storage-disabled modes throw on access rather than
 * returning null, and a trainer should never die because of that.
 */

const KEY = 'ccapp:v1';

export const DEFAULT_SETTINGS = {
  // Table rules
  numberOfDecks: 6,
  reshuffleThreshold: 0.25,
  hitSoft17: true,
  blackjackPayout: 1.5,
  allowSurrender: true,
  allowDoubleAfterSplit: true,
  maxSplits: 3,
  minBet: 5,
  maxBet: 500,

  // Training
  countingSystem: 'HI_LO',
  difficulty: 'easy',
  gradeDecisions: true,

  // Flags driven by the difficulty preset (see difficulty.js)
  showCount: true,
  allowCountPeek: true,
  showAdvice: true,
  showBetHint: true,
  postHandReview: false,
  showHandTotals: true,
  countAudits: false,
  gradeBets: false,
  decisionSeconds: 0,

  // Session
  startingBankroll: 1000,
  haptics: true
};

function readRaw() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeRaw(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    // Quota exceeded or storage blocked - the session still works in memory
    return false;
  }
}

/**
 * Load saved settings merged over the defaults.
 * @returns {Object} Settings
 */
export function loadSettings() {
  const saved = readRaw().settings || {};

  // Merge rather than replace, so a new setting added later still gets a default
  return { ...DEFAULT_SETTINGS, ...saved };
}

/**
 * Persist settings.
 * @param {Object} settings
 */
export function saveSettings(settings) {
  const data = readRaw();
  data.settings = settings;
  return writeRaw(data);
}

/**
 * Load the saved session (bankroll and running stats).
 * @returns {Object|null} Session, or null if none is stored
 */
export function loadSession() {
  return readRaw().session || null;
}

/**
 * Persist the session.
 * @param {Object} session
 */
export function saveSession(session) {
  const data = readRaw();
  data.session = session;
  return writeRaw(data);
}

/**
 * Wipe the stored session, keeping settings intact.
 */
export function clearSession() {
  const data = readRaw();
  delete data.session;
  return writeRaw(data);
}
