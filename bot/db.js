'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

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
    coins INTEGER DEFAULT 0,
    referrer_id INTEGER,
    join_date TEXT DEFAULT (datetime('now')),
    is_banned INTEGER DEFAULT 0,
    captcha_done INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    link TEXT NOT NULL,
    size TEXT DEFAULT '1 گیگ',
    duration TEXT DEFAULT '24 ساعت',
    cost_coins INTEGER DEFAULT 2,
    is_active INTEGER DEFAULT 1,
    used_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS referrals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    referrer_id INTEGER NOT NULL,
    referred_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(referred_id)
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    type TEXT NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS captcha_pending (
    user_id INTEGER PRIMARY KEY,
    answer INTEGER NOT NULL,
    referrer_id INTEGER,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS forced_channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL,
    channel_name TEXT NOT NULL,
    channel_url TEXT NOT NULL
  );
`);

const defaultSettings = {
  coins_per_referral: '1',
  service_cost: '2',
  maintenance_mode: '0',
  welcome_text: '🔔 به ربات خوش آمدید!\n\nبا این ربات می‌تونی:\n✅ کانفیگ‌های پرسرعت دریافت کنی\n✅ با دعوت دوستان امتیاز جمع کنی\n✅ با امتیازها کانفیگ رایگان بگیری\n✅ همیشه از وضعیت سرویس‌ها با خبر باشی',
  rules_text: '📋 قوانین و شرایط استفاده\n\n🔒 حریم خصوصی\n• اطلاعات شما کاملاً محرمانه است.\n\n🎁 سیستم دعوت (رفرال)\n• دریافت اشتراک رایگان از طریق دعوت دوستان\n• هرگونه تقلب (اکانت فیک، ربات) منجر به مسدودسازی دائمی می‌شود.\n\n🚫 قوانین استفاده\n• اشتراک دریافتی صرفاً برای استفاده شخصی است.\n• استفاده از سرویس برای فعالیت‌های مخرب ممنوع است.\n\n‼️ مسئولیت\n• تمامی مسئولیت نحوه استفاده از سرویس بر عهده کاربر است.',
  guide_text: '❓ راهنمای دریافت اشتراک رایگان\n\n1️⃣ مرحله ۱: دریافت لینک اختصاصی\nوارد بخش «دعوت دوستان» شوید و لینک خود را بگیرید.\n\n2️⃣ مرحله ۲: دعوت از دوستان\nلینک را برای دوستان بفرستید. با عضویت هر کاربر، امتیاز دریافت کنید.\n\n3️⃣ مرحله ۳: دریافت اشتراک\nپس از رسیدن امتیاز به حد نصاب، از بخش «دریافت اشتراک» کانفیگ بگیرید.\n\n💡 سیستم آنتی‌تقلب فعال است. استفاده از اکانت فیک منجر به حذف امتیازات می‌شود.\n\n🔧 در صورت مشکل از «پشتیبانی» استفاده کنید.'
};

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(defaultSettings)) {
  insertSetting.run(key, value);
}

const defaultChannels = [
  { id: '@lnterFreedom', name: '🌐 InterFreedom', url: 'https://t.me/lnterFreedom' },
  { id: '@lnterBots',    name: '🤖 InterBots',    url: 'https://t.me/lnterBots'    },
];
for (const ch of defaultChannels) {
  const exists = db.prepare('SELECT id FROM forced_channels WHERE channel_id = ?').get(ch.id);
  if (!exists) {
    db.prepare('INSERT INTO forced_channels (channel_id, channel_name, channel_url) VALUES (?, ?, ?)').run(ch.id, ch.name, ch.url);
  }
}

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
}

function getUser(telegramId) {
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
}

function createUser(telegramId, username, firstName, referrerId = null) {
  return db.prepare('INSERT OR IGNORE INTO users (telegram_id, username, first_name, referrer_id) VALUES (?, ?, ?, ?)').run(telegramId, username, firstName, referrerId);
}

function updateUser(telegramId, fields) {
  const keys = Object.keys(fields);
  const values = Object.values(fields);
  const set = keys.map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE users SET ${set} WHERE telegram_id = ?`).run(...values, telegramId);
}

function addCoins(telegramId, amount, type, description) {
  db.prepare('UPDATE users SET coins = coins + ? WHERE telegram_id = ?').run(amount, telegramId);
  db.prepare('INSERT INTO transactions (user_id, amount, type, description) VALUES (?, ?, ?, ?)').run(telegramId, amount, type, description);
}

function deductCoins(telegramId, amount, type, description) {
  db.prepare('UPDATE users SET coins = coins - ? WHERE telegram_id = ?').run(amount, telegramId);
  db.prepare('INSERT INTO transactions (user_id, amount, type, description) VALUES (?, ?, ?, ?)').run(telegramId, -amount, type, description);
}

function getReferralCount(telegramId) {
  const row = db.prepare('SELECT COUNT(*) as cnt FROM referrals WHERE referrer_id = ?').get(telegramId);
  return row ? row.cnt : 0;
}

function addReferral(referrerId, referredId) {
  try {
    db.prepare('INSERT OR IGNORE INTO referrals (referrer_id, referred_id) VALUES (?, ?)').run(referrerId, referredId);
    return true;
  } catch { return false; }
}

function getTopReferrers(limit = 10) {
  return db.prepare(`SELECT u.telegram_id, u.username, u.first_name, COUNT(r.id) as ref_count 
    FROM users u LEFT JOIN referrals r ON r.referrer_id = u.telegram_id 
    GROUP BY u.telegram_id ORDER BY ref_count DESC LIMIT ?`).all(limit);
}

function getRichestUsers(limit = 10) {
  return db.prepare('SELECT * FROM users ORDER BY coins DESC LIMIT ?').all(limit);
}

function getAllUsers() {
  return db.prepare('SELECT * FROM users ORDER BY join_date DESC').all();
}

function getLatestUsers(limit = 10) {
  return db.prepare('SELECT * FROM users ORDER BY join_date DESC LIMIT ?').all(limit);
}

function getTotalStats() {
  const total = db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;
  const banned = db.prepare('SELECT COUNT(*) as cnt FROM users WHERE is_banned = 1').get().cnt;
  const totalReferrals = db.prepare('SELECT COUNT(*) as cnt FROM referrals').get().cnt;
  const totalConfigs = db.prepare('SELECT COUNT(*) as cnt FROM configs').get().cnt;
  const activeConfigs = db.prepare('SELECT COUNT(*) as cnt FROM configs WHERE is_active = 1').get().cnt;
  const totalCoinsGiven = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE type = 'referral'").get().total;
  const totalServiceUsed = db.prepare("SELECT COUNT(*) as cnt FROM transactions WHERE type = 'service'").get().cnt;
  return { total, banned, totalReferrals, totalConfigs, activeConfigs, totalCoinsGiven, totalServiceUsed };
}

function getMonthlyStats() {
  const thisMonth = new Date();
  thisMonth.setDate(1); thisMonth.setHours(0, 0, 0, 0);
  const since = thisMonth.toISOString().split('T')[0];
  const newUsers = db.prepare("SELECT COUNT(*) as cnt FROM users WHERE join_date >= ?").get(since).cnt;
  const newReferrals = db.prepare("SELECT COUNT(*) as cnt FROM referrals WHERE created_at >= ?").get(since).cnt;
  const services = db.prepare("SELECT COUNT(*) as cnt FROM transactions WHERE type = 'service' AND created_at >= ?").get(since).cnt;
  return { newUsers, newReferrals, services };
}

function getForcedChannels() { return db.prepare('SELECT * FROM forced_channels').all(); }
function addForcedChannel(channelId, channelName, channelUrl) {
  db.prepare('INSERT INTO forced_channels (channel_id, channel_name, channel_url) VALUES (?, ?, ?)').run(channelId, channelName, channelUrl);
}
function removeForcedChannel(id) { db.prepare('DELETE FROM forced_channels WHERE id = ?').run(id); }

function getAvailableConfig() {
  return db.prepare('SELECT * FROM configs WHERE is_active = 1 ORDER BY used_count ASC, ROWID ASC LIMIT 1').get();
}
function addConfig(name, link, size, duration, costCoins) {
  db.prepare('INSERT INTO configs (name, link, size, duration, cost_coins) VALUES (?, ?, ?, ?, ?)').run(name, link, size, duration, costCoins);
}
function getAllConfigs() { return db.prepare('SELECT * FROM configs ORDER BY created_at DESC').all(); }
function markConfigUsed(id) { db.prepare('UPDATE configs SET used_count = used_count + 1 WHERE id = ?').run(id); }
function removeConfig(id) { db.prepare('DELETE FROM configs WHERE id = ?').run(id); }
function toggleConfig(id) {
  const cfg = db.prepare('SELECT is_active FROM configs WHERE id = ?').get(id);
  if (cfg) db.prepare('UPDATE configs SET is_active = ? WHERE id = ?').run(cfg.is_active ? 0 : 1, id);
}

function searchUser(query) {
  if (/^\d+$/.test(String(query))) {
    return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(parseInt(query));
  }
  return db.prepare("SELECT * FROM users WHERE username LIKE ? OR first_name LIKE ? LIMIT 1").get(`%${query}%`, `%${query}%`);
}

function setPendingCaptcha(userId, answer, referrerId) {
  const expiresAt = Date.now() + 5 * 60 * 1000;
  db.prepare('INSERT OR REPLACE INTO captcha_pending (user_id, answer, referrer_id, expires_at) VALUES (?, ?, ?, ?)').run(userId, answer, referrerId, expiresAt);
}

function getPendingCaptcha(userId) {
  const row = db.prepare('SELECT * FROM captcha_pending WHERE user_id = ?').get(userId);
  if (!row) return null;
  if (Date.now() > row.expires_at) {
    db.prepare('DELETE FROM captcha_pending WHERE user_id = ?').run(userId);
    return null;
  }
  return row;
}

function clearPendingCaptcha(userId) {
  db.prepare('DELETE FROM captcha_pending WHERE user_id = ?').run(userId);
}

function getMostServiceUsers(limit = 10) {
  return db.prepare(`SELECT user_id, COUNT(*) as cnt FROM transactions WHERE type='service' GROUP BY user_id ORDER BY cnt DESC LIMIT ?`).all(limit);
}

module.exports = {
  db,
  getSetting, setSetting,
  getUser, createUser, updateUser,
  addCoins, deductCoins,
  getReferralCount, addReferral,
  getTopReferrers, getRichestUsers, getAllUsers, getLatestUsers,
  getTotalStats, getMonthlyStats,
  getForcedChannels, addForcedChannel, removeForcedChannel,
  getAvailableConfig, addConfig, getAllConfigs, markConfigUsed, removeConfig, toggleConfig,
  searchUser,
  setPendingCaptcha, getPendingCaptcha, clearPendingCaptcha,
  getMostServiceUsers
};
