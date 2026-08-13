/**
 * difficulty.js
 *
 * Difficulty presets. Each mode is just a bundle of training flags, so the
 * individual switches stay available and selecting one of them moves you to
 * 'custom' rather than fighting the preset.
 */

export const DIFFICULTY_FLAGS = [
  'showCount',
  'allowCountPeek',
  'showAdvice',
  'showBetHint',
  'postHandReview',
  'showHandTotals',
  'countAudits',
  'gradeBets',
  'decisionSeconds'
];

export const DIFFICULTIES = {
  easy: {
    label: 'Easy',
    blurb: 'Count on screen, correct play shown before you act.',
    flags: {
      showCount: true,
      allowCountPeek: true,
      showAdvice: true,
      showBetHint: true,
      postHandReview: false,   // advice was already given, so a review would just repeat it
      showHandTotals: true,
      countAudits: false,
      gradeBets: false,
      decisionSeconds: 0
    }
  },

  normal: {
    label: 'Normal',
    blurb: 'Count on screen, no advice. Misplays are explained after the hand.',
    flags: {
      showCount: true,
      allowCountPeek: true,
      showAdvice: false,
      showBetHint: false,
      postHandReview: true,
      showHandTotals: true,
      countAudits: false,
      gradeBets: false,
      decisionSeconds: 0
    }
  },

  hard: {
    label: 'Hard',
    blurb: 'No count, no totals, timed decisions, bets graded. Results at session end.',
    flags: {
      showCount: false,
      // No tap-to-reveal in hard mode - the count has to live in your head
      allowCountPeek: false,
      showAdvice: false,
      showBetHint: false,
      postHandReview: false,   // session-end review only
      showHandTotals: false,
      countAudits: true,
      gradeBets: true,
      decisionSeconds: 12
    }
  },

  custom: {
    label: 'Custom',
    blurb: 'Your own mix of the options below.',
    flags: null
  }
};

/**
 * Apply a difficulty preset over a settings object.
 * @param {Object} settings - Current settings
 * @param {string} difficulty - Preset key
 * @returns {Object} New settings
 */
export function applyDifficulty(settings, difficulty) {
  const preset = DIFFICULTIES[difficulty];

  if (!preset || !preset.flags) {
    return { ...settings, difficulty };
  }

  return { ...settings, ...preset.flags, difficulty };
}

/**
 * Work out which preset a settings object currently matches.
 * @param {Object} settings
 * @returns {string} Preset key, or 'custom' if it matches none
 */
export function detectDifficulty(settings) {
  const match = Object.keys(DIFFICULTIES).find(key => {
    const { flags } = DIFFICULTIES[key];
    if (!flags) return false;
    return DIFFICULTY_FLAGS.every(flag => settings[flag] === flags[flag]);
  });

  return match || 'custom';
}
