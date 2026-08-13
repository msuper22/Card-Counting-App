/**
 * rating.js
 *
 * Per-mode progression rating.
 *
 * Each mode carries its own 0-1000 rating so being sharp on basic strategy
 * doesn't flatter a weak count, and vice versa. Points are loss-averse - a
 * mistake costs more than a correct play earns - because a counter who is
 * right 90% of the time is not 90% of a counter. Harder modes are worth more,
 * so a rating earned in hard mode means more than the same number in easy.
 */

export const MODES = {
  easy: { label: 'Easy', weight: 0.6 },
  normal: { label: 'Normal', weight: 1.0 },
  hard: { label: 'Hard', weight: 1.5 },
  strategy: { label: 'Strategy drill', weight: 1.0 },
  count: { label: 'Count drill', weight: 1.2 },
  exam: { label: 'Casino test', weight: 0 }   // scored, but never banked
};

export const MAX_RATING = 1000;

export const TIERS = [
  { min: 0, name: 'Novice', blurb: 'Just getting the rules down.' },
  { min: 120, name: 'Beginner', blurb: 'The basics are landing.' },
  { min: 250, name: 'Apprentice', blurb: 'Solid on the common spots.' },
  { min: 380, name: 'Competent', blurb: 'Rarely caught out by basic strategy.' },
  { min: 510, name: 'Sharp', blurb: 'Consistent, and starting to count well.' },
  { min: 640, name: 'Advanced', blurb: 'Strong play under pressure.' },
  { min: 760, name: 'Expert', blurb: 'Deviations are becoming automatic.' },
  { min: 870, name: 'Master', blurb: 'Near-flawless across the board.' },
  { min: 960, name: 'Card Counter', blurb: 'Casino-ready.' }
];

/** Points awarded or deducted for a single graded event */
const POINTS = {
  correct: 3,
  correctDeviation: 6,   // the hard part, so it pays more
  wrong: -5,
  wrongDeviation: -6,
  countCorrect: 12,      // count checks are infrequent but decisive
  countWrong: -18
};

/**
 * A fresh, empty record for one mode.
 * @returns {Object}
 */
export function emptyMode() {
  return {
    rating: 0,
    bestRating: 0,
    hands: 0,
    decisions: 0,
    correct: 0,
    deviations: 0,
    deviationsCorrect: 0,
    countChecks: 0,
    countChecksCorrect: 0,
    sessions: 0,
    lastPlayed: null
  };
}

/**
 * Find the tier for a rating.
 * @param {number} rating
 * @returns {Object} { name, blurb, min, next, progress }
 */
export function tierFor(rating) {
  const clamped = Math.max(0, Math.min(MAX_RATING, rating || 0));

  let index = 0;
  for (let i = 0; i < TIERS.length; i++) {
    if (clamped >= TIERS[i].min) index = i;
  }

  const tier = TIERS[index];
  const next = TIERS[index + 1] || null;

  // How far through the current tier, for a progress bar
  const span = (next ? next.min : MAX_RATING) - tier.min;
  const progress = span > 0 ? Math.min(1, (clamped - tier.min) / span) : 1;

  return { ...tier, index, next, progress, rating: clamped };
}

/**
 * Apply one graded event to a mode record, returning a new record.
 *
 * @param {Object} record - Existing mode stats
 * @param {Object} event - { correct, isDeviation, kind, mode }
 * @returns {Object} Updated record
 */
export function applyResult(record, event) {
  const stats = { ...(record || emptyMode()) };
  const weight = (MODES[event.mode] && MODES[event.mode].weight) || 1;

  let points;

  if (event.kind === 'count') {
    stats.countChecks++;
    if (event.correct) stats.countChecksCorrect++;
    points = event.correct ? POINTS.countCorrect : POINTS.countWrong;
  } else {
    stats.decisions++;
    if (event.correct) stats.correct++;

    if (event.isDeviation) {
      stats.deviations++;
      if (event.correct) stats.deviationsCorrect++;
      points = event.correct ? POINTS.correctDeviation : POINTS.wrongDeviation;
    } else {
      points = event.correct ? POINTS.correct : POINTS.wrong;
    }
  }

  // Gains scale with mode difficulty; losses do not, so you can't farm an
  // easy mode for rating and you can't hide from mistakes in a hard one.
  const delta = points > 0 ? points * weight : points;

  stats.rating = Math.max(0, Math.min(MAX_RATING, Math.round(stats.rating + delta)));
  stats.bestRating = Math.max(stats.bestRating || 0, stats.rating);

  return stats;
}

/**
 * Accuracy percentages for a mode record.
 * @param {Object} record
 * @returns {Object} { accuracy, deviationAccuracy, countAccuracy }
 */
export function accuracies(record) {
  const stats = record || emptyMode();
  const pct = (hit, total) => (total > 0 ? Math.round((hit / total) * 100) : null);

  return {
    accuracy: pct(stats.correct, stats.decisions),
    deviationAccuracy: pct(stats.deviationsCorrect, stats.deviations),
    countAccuracy: pct(stats.countChecksCorrect, stats.countChecks)
  };
}

/**
 * Overall rating across every banked mode, weighted by how much was played.
 * @param {Object} modes - Map of mode key to record
 * @returns {number} 0-1000
 */
export function overallRating(modes = {}) {
  let weighted = 0;
  let total = 0;

  Object.entries(modes).forEach(([key, record]) => {
    if (!MODES[key] || MODES[key].weight === 0) return;

    // Weight by volume so one lucky hand in a mode can't dominate
    const volume = (record.decisions || 0) + (record.countChecks || 0) * 5;
    if (volume === 0) return;

    weighted += (record.rating || 0) * volume;
    total += volume;
  });

  return total > 0 ? Math.round(weighted / total) : 0;
}

/**
 * Judge whether a test result says the player is ready for a real table.
 *
 * Deliberately strict: basic strategy has to be near-automatic and the count
 * has to survive a full shoe, because at a real table a dropped count is
 * worse than no count at all.
 *
 * @param {Object} result - { accuracy, deviationAccuracy, countAccuracy, decisions, countChecks }
 * @returns {Object} { ready, grade, verdict, notes }
 */
export function assessReadiness(result) {
  const notes = [];
  const accuracy = result.accuracy ?? 0;
  const deviation = result.deviationAccuracy;
  const count = result.countAccuracy;

  if (result.decisions < 20) {
    return {
      ready: false,
      grade: '—',
      verdict: 'Not enough hands to judge.',
      notes: ['Play at least 20 decisions for a meaningful assessment.']
    };
  }

  if (accuracy < 95) {
    notes.push(`Basic strategy at ${accuracy}%. It needs to be 95%+ before the count matters.`);
  } else {
    notes.push(`Basic strategy at ${accuracy}% — solid.`);
  }

  if (count === null) {
    notes.push('No count checks were taken.');
  } else if (count < 80) {
    notes.push(`Count held ${count}% of the time. A dropped count costs more than not counting.`);
  } else {
    notes.push(`Count held ${count}% of the time — dependable.`);
  }

  if (deviation !== null && deviation < 70) {
    notes.push(`Deviations at ${deviation}%. Worth drilling the Illustrious 18.`);
  }

  // Grade on the weakest link rather than the average
  const floor = Math.min(
    accuracy,
    count === null ? 100 : count,
    deviation === null ? 100 : deviation + 10
  );

  let grade, verdict, ready;

  if (floor >= 95 && accuracy >= 97) {
    grade = 'A';
    verdict = 'Casino-ready. Your play holds up under realistic conditions.';
    ready = true;
  } else if (floor >= 88) {
    grade = 'B';
    verdict = 'Close. Tighten the weakest area and re-test.';
    ready = false;
  } else if (floor >= 75) {
    grade = 'C';
    verdict = 'Playable, but not yet worth betting real money on.';
    ready = false;
  } else if (floor >= 60) {
    grade = 'D';
    verdict = 'More practice needed before a real table.';
    ready = false;
  } else {
    grade = 'F';
    verdict = 'Not ready. Work through the strategy drill first.';
    ready = false;
  }

  return { ready, grade, verdict, notes, floor };
}
