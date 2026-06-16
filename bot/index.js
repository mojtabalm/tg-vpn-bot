'use strict';

const TelegramBot = require('node-telegram-bot-api');
const db = require('./db');
const api = require('./api');
const { mainMenu, adminMenu } = require('./keyboards');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) { console.error('❌ BOT_TOKEN env var required'); process.exit(1); }
const ADMIN_IDS = [6622580245];

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ─── In-memory state ──────────────────────────────────────────────────────────
const userState = new Map();
function setState(uid, s) { userState.set(uid, s); }
function getState(uid)    { return userState.get(uid) || null; }
function clearState(uid)  { userState.delete(uid); }
function isAdmin(uid)     { return ADMIN_IDS.includes(uid); }

// ─── Send with reply keyboard ─────────────────────────────────────────────────
async function sendPKB(chatId, text, keyboard, extra = {}) {
  return api.call('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: { keyboard, resize_keyboard: true, one_time_keyboard: false },
    ...extra
  });
}

async function sendInline(chatId, text, inline_keyboard, extra = {}) {
  return api.call('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard },
    ...extra
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function sendMsg(chatId, text) {
  return api.call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
}

// ─── Main menu ────────────────────────────────────────────────────────────────
async function sendMainMenu(chatId, text = null) {
  const welcome = text || db.getSetting('welcome_text');
  await sendPKB(chatId, welcome, mainMenu());
}

// ─── Check forced channel membership ─────────────────────────────────────────
async function checkMembership(userId) {
  const channels = db.getForcedChannels();
  for (const ch of channels) {
    try {
      const res = await api.getChatMember(ch.channel_id, userId);
      if (!res.ok) return false;
      if (['left', 'kicked'].includes(res.result.status)) return false;
    } catch { return false; }
  }
  return true;
}

// ─── Force join message ───────────────────────────────────────────────────────
async function sendForceJoin(chatId, userId) {
  const channels = db.getForcedChannels();

  const text =
    `🔒 <b>برای استفاده از ربات ابتدا باید در کانال‌های زیر عضو شوید</b>\n\n` +
    `✅ پس از عضویت در کانال‌ها روی دکمه « <b>تایید عضویت</b> » کلیک کنید.`;

  const channelButtons = channels.map(ch => ([{
    text: ch.channel_name,
    url: ch.channel_url,
    icon_custom_emoji_id: '5424818078833715060',
    style: 'success'
  }]));

  channelButtons.push([{
    text: 'تایید عضویت ✅',
    callback_data: 'check_membership',
    icon_custom_emoji_id: '6300757202651055745',
    style: 'success'
  }]);

  const res = await api.call('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: channelButtons }
  });

  return res.result?.message_id;
}

// ─── Captcha ──────────────────────────────────────────────────────────────────
function generateCaptcha() {
  const a = Math.floor(Math.random() * 9) + 1;
  const b = Math.floor(Math.random() * 9) + 1;
  const useAdd = Math.random() > 0.5;
  if (useAdd) return { q: `${a} + ${b}`, ans: a + b };
  const big = Math.max(a, b), small = Math.min(a, b);
  return { q: `${big} - ${small}`, ans: big - small };
}

// ─── /start ───────────────────────────────────────────────────────────────────
bot.onText(/\/start(.*)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const param  = (match[1] || '').trim().replace(/^add_/, '');

  if (db.getSetting('maintenance_mode') === '1' && !isAdmin(userId)) {
    await sendMsg(chatId, '🔧 ربات در حال تعمیر است. لطفاً بعداً مراجعه کنید.');
    return;
  }

  try { await api.setReaction(chatId, msg.message_id, '⚡'); } catch {}

  const existing = db.getUser(userId);

  if (!existing) {
    let referrerId = null;
    if (param && param !== String(userId)) {
      const ref = db.getUser(parseInt(param));
      if (ref && !ref.is_banned) referrerId = ref.telegram_id;
    }

    if (referrerId) {
      const { q, ans } = generateCaptcha();
      db.setPendingCaptcha(userId, ans, referrerId);

      const captchaRes = await sendMsg(chatId,
        `🔒 <b>تأیید امنیتی</b>\n\n` +
        `⚠️ برای جلوگیری از رفرال فیک، جواب این سوال رو بنویس:\n\n` +
        `⚡ <b>${q} = ?</b>\n\n` +
        `⏱ ۵ دقیقه وقت داری`
      );
      setState(userId, {
        step: 'captcha',
        referrerId,
        captchaMsgId: captchaRes.result?.message_id
      });
      return;
    }

    db.createUser(userId, msg.from.username || null, msg.from.first_name || 'کاربر', null);
  }

  const isMember = await checkMembership(userId);
  if (!isMember) {
    const fjMsgId = await sendForceJoin(chatId, userId);
    setState(userId, { step: 'waiting_membership', forceJoinMsgId: fjMsgId, pendingReferrerId: null });
    return;
  }

  await sendMainMenu(chatId);
});

// ─── /admin ───────────────────────────────────────────────────────────────────
bot.onText(/\/admin/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  const user = db.getUser(msg.from.id);
  if (!user) db.createUser(msg.from.id, msg.from.username || null, msg.from.first_name || 'Admin', null);
  await sendPKB(msg.chat.id, '🏆 <b>پنل مدیریت ادمین</b>', adminMenu());
});

// ─── Callback queries ─────────────────────────────────────────────────────────
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const msgId  = query.message.message_id;
  const data   = query.data;

  await api.answerCallback(query.id);

  if (data === 'check_membership') {
    const isMember = await checkMembership(userId);

    if (!isMember) {
      await api.answerCallback(query.id, '❌ هنوز عضو همه کانال‌ها نشدی!', true);
      return;
    }

    try { await api.deleteMessage(chatId, msgId); } catch {}

    const state = getState(userId);
    const pendingReferrerId = state?.pendingReferrerId || null;
    clearState(userId);

    if (!db.getUser(userId)) {
      db.createUser(userId, query.from.username || null, query.from.first_name || 'کاربر', pendingReferrerId);
    }

    if (pendingReferrerId) {
      const coinsPerRef = parseInt(db.getSetting('coins_per_referral')) || 1;
      const added = db.addReferral(pendingReferrerId, userId);
      if (added) {
        const referrer = db.getUser(pendingReferrerId);
        db.addCoins(pendingReferrerId, coinsPerRef, 'referral', `رفرال از @${query.from.username || userId}`);
        const refCount = db.getReferralCount(pendingReferrerId);
        const newCoins = (referrer?.coins || 0) + coinsPerRef;
        try {
          await sendMsg(pendingReferrerId,
            `🎉 <b>زیرمجموعه جدید!</b>\n\n` +
            `👤 <a href="tg://user?id=${userId}">${query.from.first_name || 'کاربر'}</a> به ربات دعوت شد.\n\n` +
            `💎 <b>موجودی شما:</b>\n` +
            `قبل: ${referrer?.coins || 0} امتیاز\n` +
            `بعد: ${newCoins} امتیاز (+${coinsPerRef})\n\n` +
            `📊 تعداد کل زیرمجموعه‌های شما: ${refCount}`
          );
        } catch {}
      }
    }

    await sendMainMenu(chatId, `✅ عضویت تأیید شد!\n\n` + db.getSetting('welcome_text'));
    return;
  }

  if (data === 'invite') {
    const user = db.getUser(userId);
    if (user) await handleInvite(chatId, userId, user);
    return;
  }
});

// ─── Text messages ────────────────────────────────────────────────────────────
bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text   = msg.text.trim();

  if (db.getSetting('maintenance_mode') === '1' && !isAdmin(userId)) {
    await sendMsg(chatId, '🔧 ربات در حال تعمیر است.');
    return;
  }

  const state = getState(userId);

  // ── Captcha handler ──
  if (state?.step === 'captcha') {
    const pending = db.getPendingCaptcha(userId);
    if (!pending) { clearState(userId); return; }

    const answer = parseInt(text);
    const captchaMsgId = state.captchaMsgId;

    if (!isNaN(answer) && answer === pending.answer) {
      if (captchaMsgId) try { await api.deleteMessage(chatId, captchaMsgId); } catch {}
      db.clearPendingCaptcha(userId);

      db.createUser(userId, msg.from.username || null, msg.from.first_name || 'کاربر', pending.referrer_id);

      const isMember = await checkMembership(userId);
      if (isMember) {
        const coinsPerRef = parseInt(db.getSetting('coins_per_referral')) || 1;
        const added = db.addReferral(pending.referrer_id, userId);
        if (added) {
          const referrer = db.getUser(pending.referrer_id);
          db.addCoins(pending.referrer_id, coinsPerRef, 'referral', `رفرال از @${msg.from.username || userId}`);
          const refCount = db.getReferralCount(pending.referrer_id);
          const newCoins = (referrer?.coins || 0) + coinsPerRef;
          try {
            await sendMsg(pending.referrer_id,
              `🎉 <b>زیرمجموعه جدید!</b>\n\n` +
              `👤 <a href="tg://user?id=${userId}">${msg.from.first_name || 'کاربر'}</a> دعوت شد.\n\n` +
              `💎 <b>موجودی شما:</b>\n` +
              `قبل: ${referrer?.coins || 0} امتیاز\n` +
              `بعد: ${newCoins} امتیاز (+${coinsPerRef})\n\n` +
              `📊 تعداد زیرمجموعه‌های شما: ${refCount}`
            );
          } catch {}
        }
        clearState(userId);
        await sendMainMenu(chatId, `✅ تأیید شدی! خوش آمدی!\n\n` + db.getSetting('welcome_text'));
      } else {
        const fjMsgId = await sendForceJoin(chatId, userId);
        setState(userId, {
          step: 'waiting_membership',
          forceJoinMsgId: fjMsgId,
          pendingReferrerId: pending.referrer_id
        });
      }
    } else {
      await sendMsg(chatId, `❌ جواب اشتباه است! دوباره تلاش کن.`);
    }
    return;
  }

  // ── User must exist ──
  const user = db.getUser(userId);
  if (!user) {
    await sendMsg(chatId, `برای شروع دستور /start بزن.`);
    return;
  }
  if (user.is_banned) {
    await sendMsg(chatId, `🚫 حساب شما مسدود شده است.`);
    return;
  }

  // Check membership
  const isMember = await checkMembership(userId);
  if (!isMember) {
    const fjMsgId = await sendForceJoin(chatId, userId);
    setState(userId, { step: 'waiting_membership', forceJoinMsgId: fjMsgId, pendingReferrerId: null });
    return;
  }

  // Admin state machine
  if (isAdmin(userId) && state?.step?.startsWith('admin_')) {
    await handleAdminState(msg, state);
    return;
  }

  // Main menu
  switch (text) {
    case 'دریافت اشتراک':     await handleGetService(chatId, userId, user); break;
    case 'دعوت دوستان':       await handleInvite(chatId, userId, user); break;
    case 'پروفایل':            await handleProfile(chatId, userId, user); break;
    case 'پشتیبانی':          await sendMsg(chatId, '💬 برای پشتیبانی با ادمین در تماس باشید.'); break;
    case 'قوانین':             await sendMsg(chatId, db.getSetting('rules_text')); break;
    case 'راهنما':             await sendMsg(chatId, db.getSetting('guide_text')); break;
    case '🔙 بازگشت به منو':   clearState(userId); await sendMainMenu(chatId); break;
    default:
      if (isAdmin(userId)) await handleAdminText(msg, text);
  }
});

// ─── دریافت اشتراک ────────────────────────────────────────────────────────────
async function handleGetService(chatId, userId, user) {
  const cost = parseInt(db.getSetting('service_cost')) || 2;
  if (user.coins < cost) {
    const needed = cost - user.coins;
    await sendInline(chatId,
      `🚫 <b>امتیاز کافی نیست!</b>\n\n` +
      `⭐ هزینه اشتراک: ${cost} امتیاز\n` +
      `🪙 امتیاز فعلی شما: ${user.coins}\n` +
      `⚡ امتیاز کمبود: ${needed}\n\n` +
      `👥 با دعوت دوستان می‌توانید امتیاز کسب کنید!`,
      [[{ text: 'دعوت دوستان 👥', callback_data: 'invite', icon_custom_emoji_id: '5422439311196834318', style: 'success' }]]
    );
    return;
  }

  const config = db.getAvailableConfig();
  if (!config) {
    await sendMsg(chatId, `⚠️ در حال حاضر هیچ کانفیگی موجود نیست. لطفاً بعداً مراجعه کنید.`);
    return;
  }

  db.deductCoins(userId, cost, 'service', `دریافت اشتراک ${config.name}`);
  db.markConfigUsed(config.id);
  const remaining = user.coins - cost;

  await sendMsg(chatId,
    `✅ <b>اشتراک با موفقیت ایجاد شد!</b>\n\n` +
    `⭐ حجم: ${config.size}\n` +
    `📅 مدت اعتبار: ${config.duration}\n` +
    `🔗 لینک اشتراک:\n<code>${config.link}</code>\n\n` +
    `⚠️ این لینک را در برنامه V2ray خود وارد کنید.\n\n` +
    `🪙 امتیاز باقیمانده: ${remaining}`
  );
}

// ─── دعوت دوستان ─────────────────────────────────────────────────────────────
async function handleInvite(chatId, userId, user) {
  const refCount = db.getReferralCount(userId);
  const coinsPerRef = db.getSetting('coins_per_referral');
  const cost = db.getSetting('service_cost');
  const botInfo = await api.call('getMe', {});
  const botUsername = botInfo.result?.username || 'bot';
  const refLink = `https://t.me/${botUsername}?start=add_${userId}`;

  await sendInline(chatId,
    `🎉 <b>سیستم دعوت دوستان</b>\n\n` +
    `✅ امتیاز هر دعوت: ${coinsPerRef}\n` +
    `📊 تعداد دعوت‌های شما: ${refCount}\n` +
    `🪙 امتیاز فعلی: ${user.coins}\n\n` +
    `🔗 <b>لینک دعوت اختصاصی شما:</b>\n<code>${refLink}</code>\n\n` +
    `⚡ این لینک را با دوستان به اشتراک بگذارید و به ازای هر نفر <b>${coinsPerRef} امتیاز</b> دریافت کنید!\n\n` +
    `⭐ با <b>${cost} امتیاز</b> می‌توانید یک اشتراک دریافت کنید!`,
    [[{ text: '📤 اشتراک‌گذاری لینک', switch_inline_query: refLink }]]
  );
}

// ─── پروفایل ─────────────────────────────────────────────────────────────────
async function handleProfile(chatId, userId, user) {
  const refCount = db.getReferralCount(userId);
  const name = user.first_name || 'بدون نام';
  const username = user.username ? `@${user.username}` : 'ندارد';
  const joinDate = user.join_date ? user.join_date.split(' ')[0] : 'نامشخص';

  await sendMsg(chatId,
    `👤 <b>پروفایل شما</b>\n\n` +
    `🆔 شناسه: <code>${userId}</code>\n` +
    `👤 نام: ${name}\n` +
    `🔗 نام کاربری: ${username}\n` +
    `🪙 امتیاز فعلی: ${user.coins}\n` +
    `📊 تعداد دعوت: ${refCount}\n` +
    `📅 تاریخ عضویت: ${joinDate}`
  );
}

// ─── Admin text handlers ──────────────────────────────────────────────────────
async function handleAdminText(msg, text) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  switch (text) {
    case 'وضعیت ربات': {
      const stats = db.getTotalStats();
      const up = Math.floor(process.uptime());
      await sendMsg(chatId,
        `🤖 <b>وضعیت ربات</b>\n\n` +
        `👤 کل کاربران: ${stats.total}\n` +
        `🚫 مسدود: ${stats.banned}\n` +
        `📦 کانفیگ‌های فعال: ${stats.activeConfigs}/${stats.totalConfigs}\n` +
        `🔧 حالت تعمیر: ${db.getSetting('maintenance_mode') === '1' ? 'فعال' : 'غیرفعال'}\n` +
        `⚡ آپتایم: ${Math.floor(up/3600)}h ${Math.floor((up%3600)/60)}m`
      ); break;
    }
    case 'آمار کامل': {
      const s = db.getTotalStats();
      await sendMsg(chatId,
        `📊 <b>آمار کامل</b>\n\n` +
        `👤 کل کاربران: ${s.total}\n` +
        `🎉 کل دعوت‌ها: ${s.totalReferrals}\n` +
        `📦 کل کانفیگ‌ها: ${s.totalConfigs}\n` +
        `✅ کانفیگ‌های فعال: ${s.activeConfigs}\n` +
        `🪙 کل سکه‌های پرداختی: ${s.totalCoinsGiven}\n` +
        `⭐ کل سرویس‌های داده شده: ${s.totalServiceUsed}`
      ); break;
    }
    case 'آخرین کاربران': {
      const users = db.getLatestUsers(10);
      let t = `📅 <b>آخرین کاربران</b>\n\n`;
      users.forEach((u, i) => {
        t += `${i+1}. <a href="tg://user?id=${u.telegram_id}">${u.first_name||'بدون نام'}</a>`;
        if (u.username) t += ` (@${u.username})`;
        t += ` — ${u.coins} سکه\n`;
      });
      await sendMsg(chatId, t); break;
    }
    case 'برترین دعوت‌ها': {
      const users = db.getTopReferrers(10);
      let t = `🏆 <b>برترین دعوت‌ها</b>\n\n`;
      users.forEach((u, i) => { t += `${i+1}. <a href="tg://user?id=${u.telegram_id}">${u.first_name||'بدون نام'}</a> - ${u.ref_count} دعوت\n`; });
      await sendMsg(chatId, t); break;
    }
    case 'ثروتمندترین‌ها': {
      const users = db.getRichestUsers(10);
      let t = `💎 <b>ثروتمندترین‌ها</b>\n\n`;
      users.forEach((u, i) => { t += `${i+1}. <a href="tg://user?id=${u.telegram_id}">${u.first_name||'بدون نام'}</a> - ${u.coins} سکه\n`; });
      await sendMsg(chatId, t); break;
    }
    case 'بیشترین سرویس': {
      const rows = db.getMostServiceUsers(10);
      let t = `⭐ <b>بیشترین سرویس</b>\n\n`;
      rows.forEach((r, i) => {
        const u = db.getUser(r.user_id);
        t += `${i+1}. <a href="tg://user?id=${r.user_id}">${u?(u.first_name||'کاربر'):r.user_id}</a> - ${r.cnt} سرویس\n`;
      });
      await sendMsg(chatId, t); break;
    }
    case 'همه کاربران': {
      const users = db.getAllUsers();
      let t = `👥 <b>همه کاربران (${users.length} نفر)</b>\n\n`;
      users.slice(0,50).forEach((u,i) => {
        t += `${i+1}. <a href="tg://user?id=${u.telegram_id}">${u.first_name||'بدون نام'}</a>`;
        if (u.username) t += ` (@${u.username})`;
        t += ` — ${u.coins} سکه${u.is_banned?' 🚫':''}\n`;
      });
      if (users.length > 50) t += `\n... و ${users.length-50} نفر دیگر`;
      await sendMsg(chatId, t); break;
    }
    case 'آمار ماهانه': {
      const s = db.getMonthlyStats();
      const now = new Date();
      await sendMsg(chatId,
        `📅 <b>آمار ماهانه (${now.getFullYear()}/${now.getMonth()+1})</b>\n\n` +
        `👤 کاربران جدید: ${s.newUsers}\n` +
        `🎉 رفرال‌های جدید: ${s.newReferrals}\n` +
        `⭐ سرویس‌های داده شده: ${s.services}`
      ); break;
    }
    case 'گزارش کامل': {
      const s = db.getTotalStats(); const m = db.getMonthlyStats();
      await sendMsg(chatId,
        `📊 <b>گزارش کامل</b>\n\n` +
        `<b>کل:</b>\n👤 کاربران: ${s.total}\n🎉 دعوت‌ها: ${s.totalReferrals}\n` +
        `📦 کانفیگ‌ها: ${s.totalConfigs}\n🪙 سکه‌های پرداختی: ${s.totalCoinsGiven}\n⭐ سرویس‌ها: ${s.totalServiceUsed}\n\n` +
        `<b>این ماه:</b>\n👤 کاربران جدید: ${m.newUsers}\n🎉 دعوت‌ها: ${m.newReferrals}\n⭐ سرویس‌ها: ${m.services}`
      ); break;
    }
    case 'مدیریت کانفیگ': {
      const configs = db.getAllConfigs();
      let t = configs.length === 0
        ? `📦 هیچ کانفیگی وجود ندارد.\n\nبرای افزودن:\n<code>+config|نام|لینک|حجم|مدت|هزینه</code>`
        : `📦 <b>کانفیگ‌ها (${configs.length})</b>\n\n`;
      configs.forEach((c,i) => {
        t += `${i+1}. <b>${c.name}</b> | ${c.size} | ${c.duration} | ${c.cost_coins} سکه | ${c.used_count} بار | ${c.is_active?'🟢':'🔴'}\n<code>${c.link.substring(0,50)}...</code>\n/delconfig_${c.id} | /toggleconfig_${c.id}\n\n`;
      });
      if (configs.length > 0) t += `\nبرای افزودن:\n<code>+config|نام|لینک|حجم|مدت|هزینه</code>`;
      await sendMsg(chatId, t); break;
    }
    case 'کانال‌های اجباری': {
      const chs = db.getForcedChannels();
      let t = `📢 <b>کانال‌های اجباری</b>\n\n`;
      chs.forEach((ch,i) => { t += `${i+1}. ${ch.channel_name} (${ch.channel_id})\n🔗 ${ch.channel_url}\n/delchannel_${ch.id}\n\n`; });
      t += `\nبرای افزودن:\n<code>+channel|@channel_id|نام کانال|لینک</code>`;
      await sendMsg(chatId, t); break;
    }
    case 'تنظیمات سکه‌ها': {
      await sendMsg(chatId,
        `⚙️ <b>تنظیمات سکه‌ها</b>\n\n` +
        `🪙 سکه به ازای دعوت: ${db.getSetting('coins_per_referral')}\n` +
        `⭐ هزینه سرویس: ${db.getSetting('service_cost')}\n\n` +
        `<b>تغییر:</b>\n<code>setcoinsperref|عدد</code>\n<code>setservicecost|عدد</code>`
      ); break;
    }
    case 'متن خوش‌آمد': {
      setState(userId, { step: 'admin_edit_welcome' });
      await sendMsg(chatId, `✏️ متن خوش‌آمد جدید را بنویسید:\n\n${db.getSetting('welcome_text')}`); break;
    }
    case 'حالت تعمیر': {
      const cur = db.getSetting('maintenance_mode');
      const nv = cur === '1' ? '0' : '1';
      db.setSetting('maintenance_mode', nv);
      await sendMsg(chatId, `🔧 حالت تعمیر: ${nv==='1'?'✅ فعال':'❌ غیرفعال'}`); break;
    }
    case 'پیام به کاربر':    { setState(userId, { step: 'admin_msg_user_id' }); await sendMsg(chatId, `👤 آیدی یا یوزرنیم کاربر را وارد کنید:`); break; }
    case 'پیام همگانی':      { setState(userId, { step: 'admin_broadcast' }); await sendMsg(chatId, `📣 پیام همگانی را بنویسید:`); break; }
    case 'جستجوی کاربر':    { setState(userId, { step: 'admin_search_user' }); await sendMsg(chatId, `🔍 آیدی یا یوزرنیم کاربر را وارد کنید:`); break; }
    case 'اطلاعات کاربر':   { setState(userId, { step: 'admin_user_info' }); await sendMsg(chatId, `ℹ️ آیدی کاربر را وارد کنید:`); break; }
    case 'مسدود کردن':       { setState(userId, { step: 'admin_ban_user' }); await sendMsg(chatId, `🚫 آیدی کاربر برای مسدود کردن:`); break; }
    case 'رفع مسدودی':       { setState(userId, { step: 'admin_unban_user' }); await sendMsg(chatId, `✅ آیدی کاربر برای رفع مسدودی:`); break; }
    case 'افزودن سکه':       { setState(userId, { step: 'admin_add_coins_id' }); await sendMsg(chatId, `🪙 آیدی کاربر را وارد کنید:`); break; }
    case 'تنظیم سکه':        { setState(userId, { step: 'admin_set_coins_id' }); await sendMsg(chatId, `💰 آیدی کاربر را وارد کنید:`); break; }
    case 'ری‌ست سکه':        { setState(userId, { step: 'admin_reset_coins_id' }); await sendMsg(chatId, `🔄 آیدی کاربر را وارد کنید:`); break; }
    case 'سرویس دستی':       { setState(userId, { step: 'admin_manual_service_id' }); await sendMsg(chatId, `🎁 آیدی کاربر را وارد کنید:`); break; }
    case 'حذف کاربر':        { setState(userId, { step: 'admin_delete_user' }); await sendMsg(chatId, `🗑️ آیدی کاربر برای حذف:`); break; }
    case 'مدیریت دکمه‌ها': {
      await sendMsg(chatId,
        `⚙️ <b>مدیریت دکمه‌های شیشه‌ای</b>\n\nبرای افزودن کانفیگ جدید:\n<code>+config|نام|لینک|حجم|مدت|هزینه_سکه</code>\n\nرنگ دکمه‌ها: success (سبز) | primary (آبی) | danger (قرمز)`
      ); break;
    }
    default: await handleAdminCommand(msg, text);
  }
}

// ─── Admin commands (+config, +channel, etc.) ─────────────────────────────────
async function handleAdminCommand(msg, text) {
  const chatId = msg.chat.id;
  if (text.startsWith('+config|')) {
    const p = text.split('|');
    if (p.length < 3) { await sendMsg(chatId, '❌ فرمت اشتباه.'); return; }
    db.addConfig(p[1], p[2], p[3]||'1 گیگ', p[4]||'24 ساعت', parseInt(p[5])||2);
    await sendMsg(chatId, `✅ کانفیگ "${p[1]}" اضافه شد.`); return;
  }
  if (text.startsWith('+channel|')) {
    const p = text.split('|');
    if (p.length < 4) { await sendMsg(chatId, '❌ فرمت اشتباه.'); return; }
    db.addForcedChannel(p[1], p[2], p[3]);
    await sendMsg(chatId, `✅ کانال "${p[2]}" اضافه شد.`); return;
  }
  if (text.startsWith('setcoinsperref|')) {
    const v = parseInt(text.split('|')[1]);
    if (isNaN(v)) { await sendMsg(chatId, '❌ عدد معتبر وارد کنید.'); return; }
    db.setSetting('coins_per_referral', String(v));
    await sendMsg(chatId, `✅ سکه به ازای دعوت: ${v}`); return;
  }
  if (text.startsWith('setservicecost|')) {
    const v = parseInt(text.split('|')[1]);
    if (isNaN(v)) { await sendMsg(chatId, '❌ عدد معتبر وارد کنید.'); return; }
    db.setSetting('service_cost', String(v));
    await sendMsg(chatId, `✅ هزینه سرویس: ${v} سکه`); return;
  }
}

// ─── Admin state machine ──────────────────────────────────────────────────────
async function handleAdminState(msg, state) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text   = msg.text.trim();

  switch (state.step) {
    case 'admin_edit_welcome':
      db.setSetting('welcome_text', text); clearState(userId);
      await sendMsg(chatId, `✅ متن خوش‌آمد به‌روزرسانی شد.`); break;

    case 'admin_broadcast': {
      clearState(userId);
      const users = db.getAllUsers();
      let sent=0, failed=0;
      await sendMsg(chatId, `📣 در حال ارسال به ${users.length} نفر...`);
      for (const u of users) {
        try { await api.call('sendMessage', { chat_id: u.telegram_id, text, parse_mode: 'HTML' }); sent++; }
        catch { failed++; }
        await new Promise(r => setTimeout(r, 50));
      }
      await sendMsg(chatId, `✅ پیام همگانی ارسال شد:\n✔️ موفق: ${sent}\n❌ ناموفق: ${failed}`); break;
    }
    case 'admin_msg_user_id':
      setState(userId, { step: 'admin_msg_user_text', targetQuery: text });
      await sendMsg(chatId, `📣 پیام را بنویسید:`); break;

    case 'admin_msg_user_text': {
      const target = db.searchUser(state.targetQuery); clearState(userId);
      if (!target) { await sendMsg(chatId, '❌ کاربر یافت نشد.'); return; }
      try {
        await api.call('sendMessage', { chat_id: target.telegram_id, text: `📣 <b>پیام از ادمین:</b>\n\n${text}`, parse_mode: 'HTML' });
        await sendMsg(chatId, `✅ پیام ارسال شد.`);
      } catch { await sendMsg(chatId, '❌ ارسال ناموفق.'); } break;
    }
    case 'admin_search_user':
    case 'admin_user_info': {
      clearState(userId);
      const user = db.searchUser(text);
      if (!user) { await sendMsg(chatId, '❌ کاربر یافت نشد.'); return; }
      const refCount = db.getReferralCount(user.telegram_id);
      await sendMsg(chatId,
        `ℹ️ <b>اطلاعات کاربر</b>\n\n` +
        `🆔 آیدی: <code>${user.telegram_id}</code>\n` +
        `👤 نام: ${user.first_name||'-'}\n` +
        `🔗 یوزرنیم: ${user.username?'@'+user.username:'ندارد'}\n` +
        `🪙 سکه: ${user.coins}\n` +
        `🎉 دعوت‌ها: ${refCount}\n` +
        `📅 عضویت: ${user.join_date}\n` +
        `${user.is_banned?'🚫 مسدود':'✅ فعال'}`
      ); break;
    }
    case 'admin_ban_user': {
      clearState(userId);
      const user = db.searchUser(text);
      if (!user) { await sendMsg(chatId, '❌ کاربر یافت نشد.'); return; }
      db.updateUser(user.telegram_id, { is_banned: 1 });
      await sendMsg(chatId, `✅ کاربر ${user.first_name} مسدود شد.`);
      try { await sendMsg(user.telegram_id, `🚫 حساب شما توسط ادمین مسدود شده است.`); } catch {}
      break;
    }
    case 'admin_unban_user': {
      clearState(userId);
      const user = db.searchUser(text);
      if (!user) { await sendMsg(chatId, '❌ کاربر یافت نشد.'); return; }
      db.updateUser(user.telegram_id, { is_banned: 0 });
      await sendMsg(chatId, `✅ مسدودیت ${user.first_name} برداشته شد.`); break;
    }
    case 'admin_add_coins_id':
      setState(userId, { step: 'admin_add_coins_amount', targetId: text });
      await sendMsg(chatId, `🪙 مقدار سکه:`); break;

    case 'admin_add_coins_amount': {
      const amount = parseInt(text); clearState(userId);
      if (isNaN(amount)) { await sendMsg(chatId, '❌ عدد معتبر.'); return; }
      const user = db.searchUser(state.targetId);
      if (!user) { await sendMsg(chatId, '❌ کاربر یافت نشد.'); return; }
      db.addCoins(user.telegram_id, amount, 'admin', 'افزودن سکه ادمین');
      await sendMsg(chatId, `✅ ${amount} سکه به ${user.first_name} اضافه شد.`);
      try { await sendMsg(user.telegram_id, `🪙 ${amount} سکه توسط ادمین اضافه شد!`); } catch {}
      break;
    }
    case 'admin_set_coins_id':
      setState(userId, { step: 'admin_set_coins_amount', targetId: text });
      await sendMsg(chatId, `💰 مقدار سکه جدید:`); break;

    case 'admin_set_coins_amount': {
      const amount = parseInt(text); clearState(userId);
      if (isNaN(amount)) { await sendMsg(chatId, '❌ عدد معتبر.'); return; }
      const user = db.searchUser(state.targetId);
      if (!user) { await sendMsg(chatId, '❌ کاربر یافت نشد.'); return; }
      db.updateUser(user.telegram_id, { coins: amount });
      await sendMsg(chatId, `✅ سکه ${user.first_name} به ${amount} تنظیم شد.`); break;
    }
    case 'admin_reset_coins_id': {
      clearState(userId);
      const user = db.searchUser(text);
      if (!user) { await sendMsg(chatId, '❌ کاربر یافت نشد.'); return; }
      db.updateUser(user.telegram_id, { coins: 0 });
      await sendMsg(chatId, `✅ سکه‌های ${user.first_name} ری‌ست شد.`); break;
    }
    case 'admin_manual_service_id': {
      clearState(userId);
      const user = db.searchUser(text);
      if (!user) { await sendMsg(chatId, '❌ کاربر یافت نشد.'); return; }
      const config = db.getAvailableConfig();
      if (!config) { await sendMsg(chatId, `⚠️ کانفیگی موجود نیست.`); return; }
      db.markConfigUsed(config.id);
      try {
        await sendMsg(user.telegram_id,
          `🎁 <b>سرویس هدیه از ادمین!</b>\n\n` +
          `⭐ حجم: ${config.size}\n📅 مدت: ${config.duration}\n` +
          `🔗 لینک:\n<code>${config.link}</code>`
        );
      } catch {}
      await sendMsg(chatId, `✅ سرویس برای ${user.first_name} ارسال شد.`); break;
    }
    case 'admin_delete_user': {
      clearState(userId);
      const user = db.searchUser(text);
      if (!user) { await sendMsg(chatId, '❌ کاربر یافت نشد.'); return; }
      db.db.prepare('DELETE FROM users WHERE telegram_id = ?').run(user.telegram_id);
      await sendMsg(chatId, `✅ کاربر ${user.first_name} حذف شد.`); break;
    }
    default: clearState(userId);
  }
}

// ─── Slash commands for admin ─────────────────────────────────────────────────
bot.onText(/\/delconfig_(\d+)/, async (msg, m) => {
  if (!isAdmin(msg.from.id)) return;
  db.removeConfig(parseInt(m[1]));
  await sendMsg(msg.chat.id, `✅ کانفیگ #${m[1]} حذف شد.`);
});
bot.onText(/\/toggleconfig_(\d+)/, async (msg, m) => {
  if (!isAdmin(msg.from.id)) return;
  db.toggleConfig(parseInt(m[1]));
  await sendMsg(msg.chat.id, `✅ وضعیت کانفیگ #${m[1]} تغییر کرد.`);
});
bot.onText(/\/delchannel_(\d+)/, async (msg, m) => {
  if (!isAdmin(msg.from.id)) return;
  db.removeForcedChannel(parseInt(m[1]));
  await sendMsg(msg.chat.id, `✅ کانال #${m[1]} حذف شد.`);
});

// ─── Keep-alive HTTP server (for UptimeRobot pinging) ────────────────────────
const http = require('http');
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('OK');
}).listen(PORT, () => console.log(`🌐 Health server on port ${PORT}`));

// ─── Error handling ───────────────────────────────────────────────────────────
bot.on('polling_error', (err) => console.error('[Poll Error]', err.message));
process.on('uncaughtException',  (err) => console.error('[Uncaught]', err.message));
process.on('unhandledRejection', (r)   => console.error('[Rejection]', r));

console.log('🤖 ربات شروع به کار کرد...');
