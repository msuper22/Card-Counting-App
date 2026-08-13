/**
 * deviations.js
 *
 * The Illustrious 18 — the index plays that earn most of what counting is
 * worth. Each entry says what to do at or above a true count, and what to do
 * below it.
 *
 * Structured rather than the loose arrays used inside Strategy.js, because
 * both the drill and the reference chart read from this table, and they need
 * to agree with each other exactly.
 *
 * Each entry names its plain basic-strategy play explicitly. Which side of the
 * index that falls on cannot be inferred from the index alone - 16 vs 10 and
 * 12 vs 4 both have an index of 0 but depart in opposite directions.
 *
 * Indices are the standard 6-deck H17 figures. They shift by a fraction under
 * different rules, but not enough to change how they're played.
 */

/** Illustrious 18, roughly in order of how much each is worth */
export const ILLUSTRIOUS_18 = [
  {
    id: 'insurance', basicPlay: 'decline',
    kind: 'insurance',
    label: 'Insurance',
    up: 1,
    index: 3,
    atOrAbove: 'insure',
    below: 'decline',
    note: 'The single most valuable index play. Insurance is a side bet on tens, ' +
          'and at +3 the shoe is rich enough to make it pay.'
  },
  {
    id: '16v10', basicPlay: 'hit',
    kind: 'hard', total: 16, up: 10, index: 0,
    atOrAbove: 'stand', below: 'hit',
    note: 'The most common index play you will actually face. At a neutral or ' +
          'positive count the extra tens make drawing too dangerous.'
  },
  {
    id: '15v10', basicPlay: 'hit',
    kind: 'hard', total: 15, up: 10, index: 4,
    atOrAbove: 'stand', below: 'hit',
    note: 'Needs a stronger count than 16 vs 10, because 15 has more room to improve.'
  },
  {
    id: '10-10v5', basicPlay: 'stand',
    kind: 'pair', pairValue: 10, total: 20, up: 5, index: 5,
    atOrAbove: 'split', below: 'stand',
    note: 'Breaking up a 20 feels wrong, and normally is. At +5 against a 5 the ' +
          'dealer is weak enough that two hands beat one.'
  },
  {
    id: '10-10v6', basicPlay: 'stand',
    kind: 'pair', pairValue: 10, total: 20, up: 6, index: 4,
    atOrAbove: 'split', below: 'stand',
    note: 'Same idea as against a 5, at a slightly lower count since a 6 is weaker.'
  },
  {
    id: '10v10', basicPlay: 'hit',
    kind: 'hard', total: 10, up: 10, index: 4,
    atOrAbove: 'double', below: 'hit',
    note: 'A ten-rich shoe makes you more likely to catch a ten and land on 20.'
  },
  {
    id: '12v3', basicPlay: 'hit',
    kind: 'hard', total: 12, up: 3, index: 2,
    atOrAbove: 'stand', below: 'hit',
    note: 'Basic strategy hits 12 vs 3. With extra tens about, standing wins out.'
  },
  {
    id: '12v2', basicPlay: 'hit',
    kind: 'hard', total: 12, up: 2, index: 3,
    atOrAbove: 'stand', below: 'hit',
    note: 'Needs a higher count than 12 vs 3, because a 2 is the strongest of the stiffs.'
  },
  {
    id: '11vA', basicPlay: 'double',
    kind: 'hard', total: 11, up: 1, index: -1,
    atOrAbove: 'double', below: 'hit',
    note: 'Under H17 basic strategy already doubles 11 against an ace. This one departs ' +
          'downward: at a clearly negative count, just hit.'
  },
  {
    id: '9v2', basicPlay: 'hit',
    kind: 'hard', total: 9, up: 2, index: 1,
    atOrAbove: 'double', below: 'hit',
    note: 'A marginal double that becomes correct as soon as the shoe turns positive.'
  },
  {
    id: '10vA', basicPlay: 'hit',
    kind: 'hard', total: 10, up: 1, index: 4,
    atOrAbove: 'double', below: 'hit',
    note: 'Doubling into an ace needs a genuinely strong count.'
  },
  {
    id: '9v7', basicPlay: 'hit',
    kind: 'hard', total: 9, up: 7, index: 3,
    atOrAbove: 'double', below: 'hit',
    note: 'A 7 is strong, so this one waits for a high count before pressing.'
  },
  {
    id: '16v9', basicPlay: 'hit',
    kind: 'hard', total: 16, up: 9, index: 5,
    atOrAbove: 'stand', below: 'hit',
    note: 'A 9 busts less than a ten does, so standing on 16 needs a higher count.'
  },
  {
    id: '13v2', basicPlay: 'stand',
    kind: 'hard', total: 13, up: 2, index: -1,
    atOrAbove: 'stand', below: 'hit',
    note: 'A negative-count play: with the shoe small-card rich, 13 is worth drawing to.'
  },
  {
    id: '12v4', basicPlay: 'stand',
    kind: 'hard', total: 12, up: 4, index: 0,
    atOrAbove: 'stand', below: 'hit',
    note: 'Stand at zero or better; below that the shoe favours drawing.'
  },
  {
    id: '12v5', basicPlay: 'stand',
    kind: 'hard', total: 12, up: 5, index: -2,
    atOrAbove: 'stand', below: 'hit',
    note: 'Takes a distinctly negative shoe before hitting 12 against a 5 is right.'
  },
  {
    id: '12v6', basicPlay: 'stand',
    kind: 'hard', total: 12, up: 6, index: -1,
    atOrAbove: 'stand', below: 'hit',
    note: 'The dealer 6 is weak, so you stand unless the count says otherwise.'
  },
  {
    id: '13v3', basicPlay: 'stand',
    kind: 'hard', total: 13, up: 3, index: -2,
    atOrAbove: 'stand', below: 'hit',
    note: 'Another negative index; at a low count drawing to 13 becomes correct.'
  }
];

/**
 * The correct play for an index entry at a given true count.
 * @param {Object} entry
 * @param {number} trueCount
 * @returns {string}
 */
export function playFor(entry, trueCount) {
  return trueCount >= entry.index ? entry.atOrAbove : entry.below;
}

/**
 * Human-readable name for the hand in an entry.
 * @param {Object} entry
 * @returns {string}
 */
export function handLabel(entry) {
  if (entry.kind === 'insurance') return 'Insurance';
  if (entry.kind === 'pair') return entry.pairValue === 10 ? '10,10' : `${entry.pairValue},${entry.pairValue}`;
  return String(entry.total);
}

/**
 * Display label for the dealer upcard.
 * @param {Object} entry
 * @returns {string}
 */
export function upLabel(entry) {
  return entry.up === 1 ? 'A' : String(entry.up);
}

/**
 * How the index reads on a chart, e.g. "≥ +2" or "≤ -3".
 * @param {Object} entry
 * @returns {string}
 */
export function indexLabel(entry) {
  const sign = entry.index > 0 ? `+${entry.index}` : String(entry.index);
  return `≥ ${sign}`;
}

/**
 * Pick a true count for drilling this entry.
 *
 * Half the time it lands at or above the index and half below, and it stays
 * close to the boundary — a count of +9 makes every index play obvious and
 * teaches nothing.
 *
 * @param {Object} entry
 * @param {Function} [random] - Injectable for deterministic tests
 * @returns {number}
 */
export function drillCountFor(entry, random = Math.random) {
  const above = random() < 0.5;
  const distance = 1 + Math.floor(random() * 3);   // 1-3 either side

  return above ? entry.index + (distance - 1) : entry.index - distance;
}
