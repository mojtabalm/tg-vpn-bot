'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'bot.db'));
db.exec(`PRAGMA journal_mode = WAL`);
db.exec(`PRAGMA foreign_keys = ON`);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER UNIQUE NOT NULL,
    username TEXT,
    first_name TEXT,
    link_token TEXT UNIQUE NOT NULL,
    coins INTEGER DEFAULT 0,
    gender TEXT,
    referred_by INTEGER,
    referral_credited INTEGER DEFAULT 0,
    state TEXT DEFAULT 'idle',
    state_data TEXT,
    is_banned INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS blocked_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    blocker_telegram_id INTEGER NOT NULL,
    blocked_token TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(blocker_telegram_id, blocked_token)
  );

  CREATE TABLE IF NOT EXISTS random_chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user1_telegram_id INTEGER NOT NULL,
    user2_telegram_id INTEGER NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS waiting_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER UNIQUE NOT NULL,
    gender_pref TEXT DEFAULT 'any',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_telegram_id INTEGER NOT NULL,
    reported_token TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bot_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS forced_channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL,
    channel_name TEXT NOT NULL,
    channel_url TEXT NOT NULL
  );
`);

const defaults = { referral_coins: '20', gender_chat_cost: '2' };
const insSetting = db.prepare('INSERT OR IGNORE INTO bot_settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(defaults)) insSetting.run(k, v);

const defaultChannels = [
  { id: '@lnterFreedom', name: '🌐 lnterFreedom', url: 'https://t.me/lnterFreedom' },
  { id: '@lnterBots',    name: '🤖 lnterBots',    url: 'https://t.me/lnterBots'    },
];
for (const ch of defaultChannels) {
  const ex = db.prepare('SELECT id FROM forced_channels WHERE channel_id = ?').get(ch.id);
  if (!ex) db.prepare('INSERT INTO forced_channels (channel_id, channel_name, channel_url) VALUES (?, ?, ?)').run(ch.id, ch.name, ch.url);
}

function generateToken() { return crypto.randomBytes(8).toString('hex'); }

function getSetting(key) {
  const r = db.prepare('SELECT value FROM bot_settings WHERE key = ?').get(key);
  return r ? r.value : null;
}
function setSetting(key, val) {
  db.prepare('INSERT OR REPLACE INTO bot_settings (key, value) VALUES (?, ?)').run(key, String(val));
}

function getUser(telegramId) {
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
}
function getUserByToken(token) {
  return db.prepare('SELECT * FROM users WHERE link_token = ?').get(token);
}
function getOrCreateUser(telegramId, username, firstName) {
  const ex = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
  if (ex) return ex;
  const token = generateToken();
  db.prepare('INSERT INTO users (telegram_id, username, first_name, link_token) VALUES (?, ?, ?, ?)')
    .run(telegramId, username || null, firstName || 'کاربر', token);
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
}
function updateUser(telegramId, fields) {
  const keys = Object.keys(fields);
  const vals = Object.values(fields);
  const set = keys.map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE users SET ${set} WHERE telegram_id = ?`).run(...vals, telegramId);
}
function setState(telegramId, state, stateData = null) {
  db.prepare('UPDATE users SET state = ?, state_data = ? WHERE telegram_id = ?').run(state, stateData, telegramId);
}
function addCoins(telegramId, amount) {
  db.prepare('UPDATE users SET coins = coins + ? WHERE telegram_id = ?').run(amount, telegramId);
}
function deductCoins(telegramId, amount) {
  db.prepare('UPDATE users SET coins = coins - ? WHERE telegram_id = ?').run(amount, telegramId);
}
function getAllUsers() {
  return db.prepare('SELECT * FROM users').all();
}
function getTotalStats() {
  const total    = db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;
  const reports  = db.prepare('SELECT COUNT(*) as cnt FROM reports').get().cnt;
  const chats    = db.prepare('SELECT COUNT(*) as cnt FROM random_chats').get().cnt;
  const blocked  = db.prepare('SELECT COUNT(*) as cnt FROM blocked_users').get().cnt;
  return { total, reports, chats, blocked };
}

function isBlocked(blockerTelegramId, blockedToken) {
  return !!db.prepare('SELECT id FROM blocked_users WHERE blocker_telegram_id = ? AND blocked_token = ?')
    .get(blockerTelegramId, blockedToken);
}
function addBlock(blockerTelegramId, blockedToken) {
  db.prepare('INSERT OR IGNORE INTO blocked_users (blocker_telegram_id, blocked_token) VALUES (?, ?)').run(blockerTelegramId, blockedToken);
}

function getActiveRandomChat(userId) {
  const c1 = db.prepare('SELECT * FROM random_chats WHERE is_active = 1 AND user1_telegram_id = ?').get(userId);
  if (c1) return c1;
  return db.prepare('SELECT * FROM random_chats WHERE is_active = 1 AND user2_telegram_id = ?').get(userId) || null;
}
function createRandomChat(user1, user2) {
  db.prepare('INSERT INTO random_chats (user1_telegram_id, user2_telegram_id) VALUES (?, ?)').run(user1, user2);
}
function endRandomChat(id) {
  db.prepare('UPDATE random_chats SET is_active = 0 WHERE id = ?').run(id);
}

function getWaitingQueue(excludeUserId) {
  return db.prepare('SELECT * FROM waiting_queue WHERE telegram_id != ? ORDER BY created_at ASC').all(excludeUserId);
}
function addToQueue(telegramId, genderPref) {
  db.prepare('INSERT OR REPLACE INTO waiting_queue (telegram_id, gender_pref) VALUES (?, ?)').run(telegramId, genderPref || 'any');
}
function removeFromQueue(telegramId) {
  db.prepare('DELETE FROM waiting_queue WHERE telegram_id = ?').run(telegramId);
}

function addReport(reporter, reportedToken, reason) {
  db.prepare('INSERT INTO reports (reporter_telegram_id, reported_token, reason) VALUES (?, ?, ?)').run(reporter, reportedToken, reason);
}

function getForcedChannels() { return db.prepare('SELECT * FROM forced_channels').all(); }
function addForcedChannel(id, name, url) {
  db.prepare('INSERT INTO forced_channels (channel_id, channel_name, channel_url) VALUES (?, ?, ?)').run(id, name, url);
}
function removeForcedChannel(id) { db.prepare('DELETE FROM forced_channels WHERE id = ?').run(id); }

function searchUser(query) {
  if (/^\d+$/.test(String(query)))
    return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(parseInt(query));
  return db.prepare("SELECT * FROM users WHERE username LIKE ? OR first_name LIKE ? LIMIT 1")
    .get(`%${query}%`, `%${query}%`);
}

module.exports = {
  getSetting, setSetting,
  getUser, getUserByToken, getOrCreateUser, updateUser, setState,
  addCoins, deductCoins, getAllUsers, getTotalStats,
  isBlocked, addBlock,
  getActiveRandomChat, createRandomChat, endRandomChat,
  getWaitingQueue, addToQueue, removeFromQueue,
  addReport,
  getForcedChannels, addForcedChannel, removeForcedChannel,
  searchUser,
};
