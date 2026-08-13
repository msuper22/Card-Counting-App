/**
 * profiles.js
 *
 * Multiple named players, each with their own bankroll, settings and per-mode
 * progression. Everything is local to the device for now, but the shape is
 * deliberately serialisable so it can be moved behind an account later.
 */

import { emptyMode, MODES } from './rating.js';
import { DEFAULT_SETTINGS, loadSettings } from './storage.js';

const KEY = 'ccapp:players:v1';
const MAX_PLAYERS = 8;

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && Array.isArray(parsed.players)) return parsed;
  } catch {
    // Fall through to a fresh store rather than blocking startup
  }
  return { players: [], activeId: null };
}

function write(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

function makeId() {
  return `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

/**
 * Build a new player record.
 *
 * A new player inherits whatever settings the device is currently using, so
 * creating a profile never silently resets the table rules out from under you.
 *
 * @param {string} name
 * @param {Object} [settings] - Defaults to the device's saved settings
 * @returns {Object}
 */
export function createPlayerRecord(name, settings = null) {
  const modes = {};
  Object.keys(MODES).forEach(key => { modes[key] = emptyMode(); });

  return {
    id: makeId(),
    name: (name || 'Player').slice(0, 20),
    created: new Date().toISOString(),
    bankroll: DEFAULT_SETTINGS.startingBankroll,
    lastBet: DEFAULT_SETTINGS.minBet,
    settings: { ...DEFAULT_SETTINGS, ...(settings || loadSettings()) },
    modes,
    exams: []      // history of test-mode results
  };
}

/** Every stored player */
export function listPlayers() {
  return read().players;
}

/**
 * The player currently in play, creating a default one on first run.
 * @returns {Object}
 */
export function activePlayer() {
  const store = read();

  let player = store.players.find(p => p.id === store.activeId);

  if (!player) {
    player = store.players[0];
  }

  if (!player) {
    player = createPlayerRecord('Player 1');
    store.players.push(player);
    store.activeId = player.id;
    write(store);
  } else if (store.activeId !== player.id) {
    store.activeId = player.id;
    write(store);
  }

  // Backfill any mode added since this player was created
  let changed = false;
  Object.keys(MODES).forEach(key => {
    if (!player.modes[key]) {
      player.modes[key] = emptyMode();
      changed = true;
    }
  });
  if (changed) savePlayer(player);

  return player;
}

/**
 * Persist changes to a player.
 * @param {Object} player
 */
export function savePlayer(player) {
  const store = read();
  const index = store.players.findIndex(p => p.id === player.id);

  if (index === -1) {
    store.players.push(player);
  } else {
    store.players[index] = player;
  }

  return write(store);
}

/**
 * Add a player and make them active.
 * @param {string} name
 * @returns {Object|null} The new player, or null if the roster is full
 */
export function addPlayer(name) {
  const store = read();

  if (store.players.length >= MAX_PLAYERS) {
    return null;
  }

  const player = createPlayerRecord(name);
  store.players.push(player);
  store.activeId = player.id;
  write(store);

  return player;
}

/**
 * Switch the active player.
 * @param {string} id
 * @returns {Object|null} The newly active player
 */
export function selectPlayer(id) {
  const store = read();
  const player = store.players.find(p => p.id === id);

  if (!player) return null;

  store.activeId = id;
  write(store);
  return player;
}

/**
 * Remove a player. The last remaining player cannot be deleted, since the app
 * always needs someone to be playing.
 * @param {string} id
 * @returns {boolean} Whether the player was removed
 */
export function removePlayer(id) {
  const store = read();

  if (store.players.length <= 1) return false;

  const index = store.players.findIndex(p => p.id === id);
  if (index === -1) return false;

  store.players.splice(index, 1);

  if (store.activeId === id) {
    store.activeId = store.players[0].id;
  }

  return write(store);
}

/**
 * Rename a player.
 * @param {string} id
 * @param {string} name
 */
export function renamePlayer(id, name) {
  const store = read();
  const player = store.players.find(p => p.id === id);
  if (!player) return false;

  player.name = (name || player.name).slice(0, 20);
  return write(store);
}

/**
 * Reset one player's progression without deleting them.
 * @param {string} id
 */
export function resetProgress(id) {
  const store = read();
  const player = store.players.find(p => p.id === id);
  if (!player) return false;

  const modes = {};
  Object.keys(MODES).forEach(key => { modes[key] = emptyMode(); });

  player.modes = modes;
  player.exams = [];
  player.bankroll = player.settings.startingBankroll || DEFAULT_SETTINGS.startingBankroll;

  return write(store);
}
