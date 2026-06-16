'use strict';

const TelegramBot = require('node-telegram-bot-api');
const db          = require('./db');
const api         = require('./api');
const kb          = require('./keyboards');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) { console.error('BOT_TOKEN required'); process.exit(1); }

const ADMIN_IDS      = [6622580245];
const ADMIN_USERNAME = 'Mojeao';
const REFERRAL_COINS = 20;
const GENDER_COST    = 2;

const bot = new TelegramBot(BOT_TOKEN);

function isAdmin(id, username) {
  return ADMIN_IDS.includes(id) ||
    (username && username.toLowerCase() === ADMIN_USERNAME.toLowerCase());
}

// ─── API helpers ──────────────────────────────────────────────────────────────
async function send(chatId, text, extra = {}) {
  return api.call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });
}
async function sendKb(chatId, text, replyMarkup) {
  return send(chatId, text, { reply_markup: replyMarkup });
}
async function sendInline(chatId, text, inline_keyboard, extra = {}) {
  return send(chatId, text, { reply_markup: { inline_keyboard }, ...extra });
}
async function answerCb(id, text = '', alert = false) {
  return api.answerCallback(id, text, alert);
}

// ─── Forced join helpers ──────────────────────────────────────────────────────
async function checkMembership(userId) {
  const channels = db.getForcedChannels();
  for (const ch of channels) {
    try {
      const r = await api.getChatMember(ch.channel_id, userId);
      if (!r.ok || ['left', 'kicked'].includes(r.result?.status)) return false;
    } catch { return false; }
  }
  return true;
}

async function sendForceJoin(chatId) {
  const channels = db.getForcedChannels();
  const list = channels.map(c => `🔷 @${c.channel_id.replace('@','')}`).join('\n');
  return sendInline(
    chatId,
    `ربات « ناشناس » کاملاً انحصاری فقط برای اعضای کانال‌های زیر طراحی شده.\nبرای استفاده از ربات ابتدا عضو شوید 👇\n\n${list}\n\nبعد از عضویت روی ✅ تایید عضویت کلیک کنید.`,
    kb.forceJoinKeyboard(channels)
  );
}

// ─── Credit referral (FIX: called in check_join too) ─────────────────────────
async function creditReferralIfNeeded(user) {
  if (!user.referred_by || user.referral_credited) return;
  const referrer = db.getUser(user.referred_by);
  if (!referrer) return;
  db.updateUser(user.telegram_id, { referral_credited: 1 });
  db.addCoins(user.referred_by, REFERRAL_COINS);
  try {
    await send(referrer.telegram_id,
      `🎉 <b>زیرمجموعه جدید!</b>\n\n` +
      `👤 یه نفر از طریق لینک دعوت تو وارد ربات شد!\n` +
      `🪙 <b>${REFERRAL_COINS} سکه</b> به حسابت اضافه شد!\n\n` +
      `💎 سکه‌های فعلی: ${referrer.coins + REFERRAL_COINS}`
    );
  } catch {}
}

// ─── After join + gender → what to do next ───────────────────────────────────
async function afterJoin(chatId, user) {
  const fresh = db.getUser(user.telegram_id);
  if (!fresh) return;
  if (!fresh.gender) {
    return sendInline(chatId, 'جنسیت خود را انتخاب کنید 👇', kb.genderKeyboard());
  }
  // if there's a pending anonymous message target
  if (fresh.state === 'pending_anon_msg' && fresh.state_data) {
    const targetId = parseInt(fresh.state_data);
    const target = db.getUser(targetId);
    if (target) {
      return send(chatId,
        `✉️ لینک از طرف یه نفر برات فرستاده شده!\nیه پیام ناشناس برای او بنویس و ارسال کن 👇\n\n(پیامت بدون اینکه اسمت لو بره ارسال میشه 😉)`
      );
    }
  }
  await sendKb(chatId, 'ربات برای شما فعال شد.\n\nچه کاری برات انجام بدم؟', kb.mainMenu());
}

// ─── Send banner ──────────────────────────────────────────────────────────────
async function sendBanner(chatId, user) {
  const me = await api.call('getMe', {});
  const botUsername = me.result?.username || 'bot';
  const link = `https://t.me/${botUsername}?start=${user.link_token}`;
  await send(chatId,
    `سلام 👋\n\nلینک زیر رو لمس کن و هر حرفی که نسبت به من داری یا با خیال راحت بنویس و بفرست. بدون اینکه باخبر بشم از اسمت باخبر بهم پیام به من میرسه. خودم میتونی امتحان کنی و از بقیه بخوای راحت و ناشناس پیام بهت بفرستن 😉\n\n👇👇\n${link}`
  );
  await send(chatId,
    `👌 پیام بالا رو به دوستات و گروه‌هایی که می‌شناسی فوروارد کن، یا با لینک داخلش به توئیت کن، تا بقیه بتونن بصورت ناشناس پیام بهت بفرستن.`
  );
  await sendKb(chatId,
    `اعتبار مکالمه شما : ${user.coins} سکه\n\nبرای افزایش اعتبار، بنر بالا رو به دوستات فوروارد کن.\nبه ازای هر کاربری که از طرف تو وارد برنامه بشه\n👈 ${REFERRAL_COINS} سکه جدید میگیری! 😁`,
    kb.mainMenu()
  );
}

// ─── Random chat helpers ──────────────────────────────────────────────────────
function findPartner(userId, pref, userGender) {
  const queue = db.getWaitingQueue(userId);
  if (pref === 'any') return queue[0] || null;
  for (const qi of queue) {
    const qu = db.getUser(qi.telegram_id);
    if (qu && qu.gender === pref && (qi.gender_pref === 'any' || qi.gender_pref === userGender))
      return qi;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// /start
// ═══════════════════════════════════════════════════════════════════════════════
bot.onText(/\/start(.*)/, async (msg, match) => {
  if (!msg.from) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const param  = (match[1] || '').trim();

  // ⚡ reaction
  try { await api.setReaction(chatId, msg.message_id, '⚡'); } catch {}

  const user = db.getOrCreateUser(userId, msg.from.username, msg.from.first_name);

  // Referral / anonymous link detection
  if (param.length > 0) {
    const tokenOwner = db.getUserByToken(param);
    if (tokenOwner && tokenOwner.telegram_id !== userId) {
      // Anonymous message: set pending state
      if (user.state !== 'pending_anon_msg') {
        db.setState(userId, 'pending_anon_msg', String(tokenOwner.telegram_id));
      }
      // Referral (only once)
      if (!user.referred_by && !user.referral_credited) {
        db.updateUser(userId, { referred_by: tokenOwner.telegram_id });
        // If already a member, credit immediately
        const isMem = await checkMembership(userId);
        if (isMem) {
          const fresh = db.getUser(userId);
          await creditReferralIfNeeded(fresh);
        }
      }
    }
  }

  const isMember = await checkMembership(userId);
  if (!isMember) { await sendForceJoin(chatId); return; }

  const fresh = db.getUser(userId);
  await afterJoin(chatId, fresh);
});

// ─── /link and /banner ────────────────────────────────────────────────────────
bot.onText(/\/link/, async (msg) => {
  if (!msg.from) return;
  const user = db.getOrCreateUser(msg.from.id, msg.from.username, msg.from.first_name);
  const isMem = await checkMembership(msg.from.id);
  if (!isMem) { await sendForceJoin(msg.chat.id); return; }
  if (!user.gender) return sendInline(msg.chat.id, 'جنسیت خود را انتخاب کنید 👇', kb.genderKeyboard());
  await sendBanner(msg.chat.id, db.getUser(msg.from.id));
});
bot.onText(/\/banner/, async (msg) => {
  if (!msg.from) return;
  const user = db.getOrCreateUser(msg.from.id, msg.from.username, msg.from.first_name);
  const isMem = await checkMembership(msg.from.id);
  if (!isMem) { await sendForceJoin(msg.chat.id); return; }
  if (!user.gender) return sendInline(msg.chat.id, 'جنسیت خود را انتخاب کنید 👇', kb.genderKeyboard());
  await sendBanner(msg.chat.id, db.getUser(msg.from.id));
});

// ─── /admin ───────────────────────────────────────────────────────────────────
bot.onText(/\/admin/, async (msg) => {
  if (!msg.from || !isAdmin(msg.from.id, msg.from.username)) {
    await send(msg.chat.id, '❌ دسترسی ندارید.'); return;
  }
  db.getOrCreateUser(msg.from.id, msg.from.username, msg.from.first_name);
  const stats    = db.getTotalStats();
  const channels = db.getForcedChannels();
  await sendInline(msg.chat.id,
    `⚙️ <b>پنل ادمین</b>\n\n👥 کاربران: <b>${stats.total}</b>\n💬 چت‌های تصادفی: <b>${stats.chats}</b>\n🚨 گزارش‌ها: <b>${stats.reports}</b>\n🚫 بلاک‌ها: <b>${stats.blocked}</b>\n\n📢 کانال‌های جوین اجباری:\n${channels.map(c => `• ${c.channel_id}`).join('\n')}`,
    kb.adminKeyboard(channels)
  );
});

// ─── /broadcast ───────────────────────────────────────────────────────────────
bot.onText(/\/broadcast (.+)/, async (msg, match) => {
  if (!msg.from || !isAdmin(msg.from.id, msg.from.username)) return;
  const text = match[1];
  const all = db.getAllUsers();
  let sent = 0, failed = 0;
  await send(msg.chat.id, `⏳ در حال ارسال به ${all.length} کاربر...`);
  for (const u of all) {
    try { await send(u.telegram_id, `📢 <b>پیام از ادمین:</b>\n\n${text}`); sent++; }
    catch { failed++; }
    await new Promise(r => setTimeout(r, 50));
  }
  await send(msg.chat.id, `✅ ارسال تمام شد!\n✔️ موفق: ${sent}\n❌ ناموفق: ${failed}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Callback queries
// ═══════════════════════════════════════════════════════════════════════════════
bot.on('callback_query', async (query) => {
  if (!query.from || !query.data) return;
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const msgId  = query.message.message_id;
  const data   = query.data;

  await answerCb(query.id);

  // ═════ تایید عضویت — FIX: referral credited here too ═════
  if (data === 'check_join') {
    const isMember = await checkMembership(userId);
    if (!isMember) {
      await answerCb(query.id, '❌ هنوز عضو همه کانال‌ها نشدی!', true);
      return;
    }
    try { await api.deleteMessage(chatId, msgId); } catch {}

    let user = db.getUser(userId);
    if (!user) { user = db.getOrCreateUser(userId, query.from.username, query.from.first_name); }

    // ★ FIX: credit referral on membership confirm
    await creditReferralIfNeeded(user);

    await afterJoin(chatId, user);
    return;
  }

  // ═════ انتخاب جنسیت ═════
  if (data.startsWith('set_gender:')) {
    const gender = data.split(':')[1];
    db.updateUser(userId, { gender });
    const label = gender === 'female' ? '👧 دختر' : '👦 پسر';
    await send(chatId, `✅ جنسیت شما ${label} ثبت شد!`);
    const user = db.getUser(userId);
    await afterJoin(chatId, user);
    return;
  }

  // ═════ پایان چت تصادفی ═════
  if (data === 'end_chat_yes') {
    const active = db.getActiveRandomChat(userId);
    if (active) {
      const partnerId = active.user1_telegram_id === userId ? active.user2_telegram_id : active.user1_telegram_id;
      const partnerUser = db.getUser(partnerId);
      db.endRandomChat(active.id);
      db.setState(userId, 'ask_block', `${partnerUser?.link_token || ''}:${partnerId}`);
      db.setState(partnerId, 'idle');
      await sendKb(chatId,
        'پیام سیستم:\nاین گپ بسته شد! نیاز داری این مخاطب رو بلاک کنم که دیگه بهت متصل نشه؟',
        kb.blockMenu()
      );
      try {
        const myToken = db.getUser(userId)?.link_token || '';
        await sendInline(partnerId,
          '🔴 طرف مقابل گفتگو را قطع کرد.',
          [[{ text: '🚨 گزارش', callback_data: `report_ask:${myToken}:${userId}`, style: 'primary' }]]
        );
      } catch {}
    }
    return;
  }

  if (data === 'end_chat_no') {
    db.setState(userId, 'in_random_chat');
    await sendKb(chatId, '✅ گفتگو ادامه دارد.', kb.inChatMenu());
    return;
  }

  // ═════ گزارش از قطع گفتگو ═════
  if (data.startsWith('report_ask:')) {
    const parts = data.split(':');
    const blockToken = parts[1];
    const reportedId = parts[2];
    db.setState(userId, 'report_reason', `${blockToken}:${reportedId}`);
    await sendKb(chatId, '🚨 دلیل گزارش را انتخاب کنید:', kb.reportReasonMenu());
    return;
  }

  // ═════ پاسخ ناشناس ═════
  if (data.startsWith('reply:')) {
    const targetId = parseInt(data.split(':')[1]);
    db.setState(userId, 'pending_anon_msg', String(targetId));
    await send(chatId, '✉️ پیام پاسخ ناشناس خود را بنویسید:');
    return;
  }

  // ═════ بلاک ═════
  if (data.startsWith('block:')) {
    const blockToken = data.split(':')[1];
    db.addBlock(userId, blockToken);
    await send(chatId, '🚫 این کاربر مسدود شد.');
    return;
  }

  // ═════ پنل ادمین ═════
  if (data === 'admin_broadcast' && isAdmin(userId, query.from.username)) {
    db.setState(userId, 'admin_broadcast');
    await send(chatId, '📢 پیام همگانی خود را بنویسید:');
    return;
  }
  if (data === 'admin_add_channel' && isAdmin(userId, query.from.username)) {
    db.setState(userId, 'admin_add_channel');
    await send(chatId, '📢 آیدی کانال جدید را بنویسید (مثلاً @mychannel):');
    return;
  }
  if (data === 'admin_remove_channel' && isAdmin(userId, query.from.username)) {
    const channels = db.getForcedChannels();
    db.setState(userId, 'admin_remove_channel');
    await send(chatId, `کانال‌های فعال:\n${channels.map(c => `• ${c.channel_id}`).join('\n')}\n\nآیدی کانالی که میخوای حذف بشه رو بنویس:`);
    return;
  }
  if (data === 'admin_stats' && isAdmin(userId, query.from.username)) {
    const stats    = db.getTotalStats();
    const channels = db.getForcedChannels();
    await send(chatId,
      `📊 <b>آمار ربات</b>\n\n👥 کل کاربران: <b>${stats.total}</b>\n💬 چت‌های تصادفی: <b>${stats.chats}</b>\n🚨 گزارش‌ها: <b>${stats.reports}</b>\n🚫 بلاک‌ها: <b>${stats.blocked}</b>\n\n📢 کانال‌ها:\n${channels.map(c => `• ${c.channel_id}`).join('\n')}`
    );
    return;
  }

  // ═════ راهنما ═════
  const helpBack = [[{ text: '🔙 بازگشت به راهنما', callback_data: 'help_back', style: 'primary' }]];
  if (data === 'help_back') {
    await sendInline(chatId, 'راهنما 🔍\n\nبرای دریافت راهنمایی روی دکمه مورد نظر کلیک کنید 👇', kb.helpKeyboard());
    return;
  }
  if (data === 'help_about') {
    await sendInline(chatId,
      '👉 این ربات چیه؟\n\n🔹 هر وقت حوصلت سر رفت بصورت تصادفی به یک نفر وصل بشی و باهاش ناشناس گپ بزنی!\n🔹 میتونی به دوستات اجازه بدی هر حرفی رو بصورت ناشناس بهت بگن!\n🔹 میتونی به مخاطب خاصت بصورت ناشناس پیام بفرستی 👌',
      helpBack
    );
    return;
  }
  if (data === 'help_receive') {
    await sendInline(chatId,
      '👉 چطوری پیام ناشناس دریافت کنم؟\n\nروی «لینک ناشناس من 🖼» کلیک کن تا لینک اختصاصیت بهت داده بشه. با فرستادن این لینک به دوستات میتونن ناشناس پیام بهت بفرستن!',
      helpBack
    );
    return;
  }
  if (data === 'help_specific') {
    await sendInline(chatId,
      '👉 چطوری به مخاطب خاصم وصل بشم؟\n\nروی «❤️ مخاطب خاص» کلیک کن:\nراه اول 👉 @Username مخاطب را بنویس\nراه دوم 👉 یه پیام از اون شخص فوروارد کن!',
      helpBack
    );
    return;
  }
  if (data === 'help_random') {
    await sendInline(chatId,
      '👉 چطوری چت تصادفی؟\n\nروی «🪝 به یه ناشناس وصلم کن» کلیک کن. میتونی جنسیت مخاطب رو انتخاب کنی (هزینه ۲ سکه). چت شانسی رایگانه!',
      helpBack
    );
    return;
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Messages
// ═══════════════════════════════════════════════════════════════════════════════
bot.on('message', async (msg) => {
  if (!msg.from) return;
  if (msg.text?.startsWith('/')) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text   = msg.text || '';

  const user = db.getOrCreateUser(userId, msg.from.username, msg.from.first_name);
  if (user.is_banned) { await send(chatId, '🚫 حساب شما مسدود شده است.'); return; }

  const isMember = await checkMembership(userId);
  if (!isMember) { await sendForceJoin(chatId); return; }

  // ─── Admin state machine ───
  if (isAdmin(userId, msg.from.username) && user.state?.startsWith('admin_')) {
    await handleAdminState(chatId, userId, user, text);
    return;
  }

  // ─── انتخاب ترجیح جنسیت برای چت تصادفی ───
  if (['👦 پسر باشه', '👧 دختر باشه', 'مهم نیست'].includes(text) && user.state === 'waiting_gender_pref') {
    let pref = 'any';
    if (text === '👦 پسر باشه') pref = 'male';
    else if (text === '👧 دختر باشه') pref = 'female';

    const active = db.getActiveRandomChat(userId);
    if (active) { await send(chatId, '⚠️ الان در یه گفتگو هستی!'); return; }

    // هزینه برای انتخاب جنسیت خاص
    if (pref !== 'any') {
      const fresh = db.getUser(userId);
      if ((fresh?.coins || 0) < GENDER_COST) {
        db.setState(userId, 'idle');
        await sendKb(chatId,
          `❌ سکه کافی نداری!\n\nبرای انتخاب جنسیت مخاطب نیاز به ${GENDER_COST} سکه داری.\nسکه فعلی تو: ${fresh?.coins || 0} سکه\n\nبرای گرفتن سکه رایگان، بنرت رو به دوستات فوروارد کن 👇`,
          kb.mainMenu()
        );
        return;
      }
      db.deductCoins(userId, GENDER_COST);
    }

    const partner = findPartner(userId, pref, user.gender || 'any');
    if (partner) {
      db.removeFromQueue(partner.telegram_id);
      db.createRandomChat(userId, partner.telegram_id);
      db.setState(userId, 'in_random_chat');
      db.setState(partner.telegram_id, 'in_random_chat');
      const connMsg = 'یافتم و وصلتون کردم 🤜 با مخاطبت ناشناسانه حرف بزن!';
      await sendKb(chatId, connMsg, kb.inChatMenu());
      await sendKb(partner.telegram_id, connMsg, kb.inChatMenu());
    } else {
      db.addToQueue(userId, pref);
      db.setState(userId, 'waiting_random');
      await sendKb(chatId,
        'در حال اتصال...\nاگر تا یک دقیقه آینده پیامی ارسال نشد دوباره تلاش کنید',
        kb.cancelMenu()
      );
    }
    return;
  }

  // ─── انصراف از صف ───
  if ((text === 'بیخیال، انصراف میدم' || text === 'انصراف') &&
      (user.state === 'waiting_random' || user.state === 'waiting_gender_pref')) {
    db.removeFromQueue(userId);
    db.setState(userId, 'idle');
    await sendKb(chatId, 'باشه! انصراف دادی. 👌', kb.mainMenu());
    return;
  }

  // ─── درخواست بلاک ───
  if (text === 'آره بلاکش کن' && user.state === 'ask_block') {
    db.setState(userId, 'ask_block_reason', user.state_data || '');
    await sendKb(chatId, 'پیام سیستم:\nچرا میخوای بلاکش کنی؟', kb.blockReasonMenu());
    return;
  }
  if (text === 'بیخیال، بعدا هم وصل شم' &&
      (user.state === 'ask_block' || user.state === 'ask_block_reason')) {
    db.setState(userId, 'idle');
    await sendKb(chatId, 'حله! 👌\nچه کاری برات انجام بدم؟', kb.mainMenu());
    return;
  }

  // ─── دلیل بلاک ───
  if (['بی ادب بود','جنسیتش اشتباه بود','باهاش حال نکردم','تبلیغ فرستاد'].includes(text) &&
      user.state === 'ask_block_reason') {
    const [blockToken, partnerIdStr] = (user.state_data || '').split(':');
    const reportedId = parseInt(partnerIdStr || '0');
    if (blockToken) db.addBlock(userId, blockToken);
    if (reportedId) {
      db.addReport(userId, blockToken, text);
      try {
        await send(reportedId,
          `⚠️ <b>اطلاعیه سیستم:</b>\nشما توسط یکی از کاربران گزارش شدید.\n📌 دلیل: <b>${text}</b>\n\nلطفاً رعایت قوانین را بکنید.`
        );
      } catch {}
    }
    db.setState(userId, 'idle');
    await sendKb(chatId, 'حله!\nچه کاری برات انجام بدم؟', kb.mainMenu());
    return;
  }

  // ─── دلیل گزارش ───
  if (['بی ادب بود','تبلیغ فرستاد','انصراف'].includes(text) && user.state === 'report_reason') {
    const [reportedToken, reportedIdStr] = (user.state_data || '').split(':');
    db.setState(userId, 'idle');
    if (text === 'انصراف') { await sendKb(chatId, 'باشه! 👌', kb.mainMenu()); return; }
    db.addReport(userId, reportedToken, text);
    const reportedUser = db.getUserByToken(reportedToken);
    if (reportedUser) {
      try { await send(reportedUser.telegram_id, `⚠️ <b>اطلاعیه سیستم:</b>\nشما گزارش شدید.\n📌 دلیل: <b>${text}</b>`); } catch {}
    }
    await sendKb(chatId, '✅ گزارش ثبت شد.', kb.mainMenu());
    return;
  }

  // ─── در چت تصادفی: فوروارد پیام ───
  const active = db.getActiveRandomChat(userId);
  if (active && user.state === 'in_random_chat') {
    const partnerId = active.user1_telegram_id === userId ? active.user2_telegram_id : active.user1_telegram_id;
    try {
      if (msg.sticker)   await api.call('sendSticker',   { chat_id: partnerId, sticker: msg.sticker.file_id });
      else if (msg.photo) await api.call('sendPhoto',    { chat_id: partnerId, photo: msg.photo[msg.photo.length-1].file_id, caption: msg.caption || '' });
      else if (msg.voice) await api.call('sendVoice',    { chat_id: partnerId, voice: msg.voice.file_id });
      else if (msg.video) await api.call('sendVideo',    { chat_id: partnerId, video: msg.video.file_id, caption: msg.caption || '' });
      else if (msg.animation) await api.call('sendAnimation', { chat_id: partnerId, animation: msg.animation.file_id });
      else if (msg.document)  await api.call('sendDocument',  { chat_id: partnerId, document: msg.document.file_id });
      else if (text)     await send(partnerId, text);
    } catch {}
    return;
  }

  // ─── pending_anon_msg: ارسال پیام ناشناس ───
  if (user.state === 'pending_anon_msg' && user.state_data && text) {
    const recipientId = parseInt(user.state_data);
    const recipient   = db.getUser(recipientId);
    if (!recipient) {
      db.setState(userId, 'idle');
      await sendKb(chatId, '❌ مخاطب یافت نشد.', kb.mainMenu());
      return;
    }
    if (db.isBlocked(recipientId, user.link_token)) {
      db.setState(userId, 'idle');
      await sendKb(chatId, '❌ این کاربر شما را مسدود کرده است.', kb.mainMenu());
      return;
    }
    await sendInline(recipientId,
      `📩 <b>پیام ناشناس جدید:</b>\n\n${text}`,
      [[
        { text: '↩️ پاسخ ناشناس', callback_data: `reply:${userId}`,         style: 'primary' },
        { text: '🚫 بلاک',        callback_data: `block:${user.link_token}`, style: 'primary' },
      ]]
    );
    db.setState(userId, 'idle');
    await sendKb(chatId, '✅ پیام ناشناس شما ارسال شد!', kb.mainMenu());
    return;
  }

  // ─── waiting_specific: پیدا کردن مخاطب خاص ───
  if (user.state === 'waiting_specific') {
    if (msg.forward_from) {
      const target = db.getUser(msg.forward_from.id);
      if (target) {
        db.setState(userId, 'pending_anon_msg', String(target.telegram_id));
        await send(chatId, '✅ مخاطب پیدا شد! پیام ناشناس خود را بنویسید:');
      } else {
        await send(chatId, '❌ این کاربر هنوز عضو ربات نیست.');
        db.setState(userId, 'idle');
      }
      return;
    }
    if (text) {
      const mention = text.match(/^@(\w+)$/);
      if (mention) {
        const target = db.searchUser(mention[1]);
        if (target) {
          db.setState(userId, 'pending_anon_msg', String(target.telegram_id));
          await send(chatId, '✅ مخاطب پیدا شد! پیام ناشناس خود را بنویسید:');
        } else {
          await send(chatId, '❌ این کاربر هنوز عضو ربات نیست.');
          db.setState(userId, 'idle');
        }
        return;
      }
      await send(chatId, 'لطفاً @Username مخاطب را بنویسید یا یه پیام از ایشون فوروارد کنید.');
    }
    return;
  }

  // ─── منوی اصلی ───
  switch (text) {
    // ════ وصل تصادفی ════
    case '🪝 به یه ناشناس وصلم کن!': {
      if (!user.gender) {
        return sendInline(chatId, 'جنسیت خود را انتخاب کنید 👇', kb.genderKeyboard());
      }
      const act = db.getActiveRandomChat(userId);
      if (act) { await send(chatId, '⚠️ الان در یه گفتگو هستی!\nبرای قطع کردن بنویس: قطع مکالمه'); return; }
      db.setState(userId, 'waiting_gender_pref');
      await sendKb(chatId,
        'برات مهمه مخاطبیت پسر باشه یا دختر؟\nچت شانسی رایگان میباشد.',
        kb.genderPrefMenu()
      );
      break;
    }

    // ════ مخاطب خاص ════
    case '❤️ به مخاطب خاصم وصلم کن!': {
      if (!user.gender) {
        return sendInline(chatId, 'جنسیت خود را انتخاب کنید 👇', kb.genderKeyboard());
      }
      db.setState(userId, 'waiting_specific');
      await send(chatId,
        'برای اینکه بتونم به مخاطب خاصت بطور ناشناس وصلت کنم:\n\nراه اول 👉 @Username یا آیدی تلگرام اون شخص رو وارد کن!\nراه دوم 👉 یه پیام متنی از اون شخص فوروارد کن!'
      );
      break;
    }

    // ════ لینک ناشناس ════
    case 'لینک ناشناس من 🖼': {
      if (!user.gender) {
        return sendInline(chatId, 'جنسیت خود را انتخاب کنید 👇', kb.genderKeyboard());
      }
      await sendBanner(chatId, db.getUser(userId));
      break;
    }

    // ════ پیام به گروه ════
    case 'پیام ناشناس به گروه 👥':
      await sendKb(chatId, 'بزودی... 🔜', kb.mainMenu());
      break;

    // ════ افزایش امتیاز ════
    case '🏆 افزایش امتیاز': {
      const fresh = db.getUser(userId);
      const me = await api.call('getMe', {});
      const botUsername = me.result?.username || 'bot';
      const link = `https://t.me/${botUsername}?start=${fresh?.link_token}`;
      await sendInline(chatId,
        `اعتبار فعلی مکالمه شما: ${fresh?.coins || 0} سکه\n\n❓ چطور اعتبار خودمو افزایش بدم؟\n_____________________\n\n1️⃣ روش اول (رایگان):\nبنر مخصوص خودت رو به دوستات فوروارد کن.\nبه ازای هر کاربری که از طرف تو وارد شه ${REFERRAL_COINS} سکه میگیری! 😁\n\nبرای دریافت بنر 👈 /banner را لمس کن\n\n🔗 لینک دعوت مستقیم:\n${link}`,
        [[{ text: '📤 اشتراک‌گذاری لینک', url: `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('با این ربات ناشناس باهام چت کن! 🎭')}`, style: 'primary' }]]
      );
      break;
    }

    // ════ راهنما ════
    case 'راهنما':
      await sendInline(chatId,
        'راهنما 🔍\n\nبرای دریافت راهنمایی روی دکمه مورد نظر کلیک کنید 👇',
        kb.helpKeyboard()
      );
      break;

    // ════ قطع مکالمه ════
    case 'قطع مکالمه': {
      const act = db.getActiveRandomChat(userId);
      if (act) {
        db.setState(userId, 'confirm_end_chat', String(act.id));
        await sendInline(chatId,
          'پیام سیستم:\nمطمئنی میخوای این گپ رو ببندی؟',
          [[
            { text: 'آره گپ رو قطع کن', callback_data: 'end_chat_yes', style: 'primary' },
            { text: 'نه',                callback_data: 'end_chat_no',  style: 'primary' },
          ]]
        );
      } else {
        db.removeFromQueue(userId);
        db.setState(userId, 'idle');
        await sendKb(chatId, 'در گفتگویی نیستی.', kb.mainMenu());
      }
      break;
    }

    default:
      if (isAdmin(userId, msg.from.username)) {
        await handleAdminText(chatId, userId, user, text);
      } else {
        await sendKb(chatId, 'چه کاری برات انجام بدم؟', kb.mainMenu());
      }
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Admin state machine
// ═══════════════════════════════════════════════════════════════════════════════
async function handleAdminState(chatId, userId, user, text) {
  switch (user.state) {
    case 'admin_broadcast': {
      db.setState(userId, 'idle');
      const all = db.getAllUsers();
      let sent = 0, failed = 0;
      await send(chatId, `⏳ در حال ارسال به ${all.length} کاربر...`);
      for (const u of all) {
        try { await send(u.telegram_id, `📢 <b>پیام از ادمین:</b>\n\n${text}`); sent++; }
        catch { failed++; }
        await new Promise(r => setTimeout(r, 50));
      }
      await send(chatId, `✅ ارسال تمام شد!\n✔️ موفق: ${sent}\n❌ ناموفق: ${failed}`);
      break;
    }
    case 'admin_add_channel': {
      db.setState(userId, 'idle');
      const raw = text.replace('@','').trim();
      db.addForcedChannel(`@${raw}`, `@${raw}`, `https://t.me/${raw}`);
      await send(chatId, `✅ کانال @${raw} اضافه شد.`);
      break;
    }
    case 'admin_remove_channel': {
      db.setState(userId, 'idle');
      const raw = text.replace('@','').trim();
      const channels = db.getForcedChannels();
      const ch = channels.find(c => c.channel_id.replace('@','') === raw);
      if (ch) { db.removeForcedChannel(ch.id); await send(chatId, `✅ کانال @${raw} حذف شد.`); }
      else     { await send(chatId, `❌ کانال @${raw} یافت نشد.`); }
      break;
    }
    default: db.setState(userId, 'idle');
  }
}

async function handleAdminText(chatId, userId, user, text) {
  // Admin commands when not in state
  if (text === '/admin' || text === 'پنل ادمین') {
    const stats    = db.getTotalStats();
    const channels = db.getForcedChannels();
    await sendInline(chatId,
      `⚙️ <b>پنل ادمین</b>\n\n👥 کاربران: <b>${stats.total}</b>\n💬 چت‌ها: <b>${stats.chats}</b>\n🚨 گزارش‌ها: <b>${stats.reports}</b>`,
      kb.adminKeyboard(channels)
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Webhook server
// ═══════════════════════════════════════════════════════════════════════════════
const http = require('http');
const PORT           = parseInt(process.env.PORT) || 8080;
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN || 'lnterbot-production.up.railway.app';
const WEBHOOK_PATH   = '/update';

const server = http.createServer((req, res) => {
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK - lnterBot ناشناس running');
    return;
  }
  if (req.method === 'POST' && req.url === WEBHOOK_PATH) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { bot.processUpdate(JSON.parse(body)); } catch (e) { console.error('[Webhook parse error]', e.message); }
      res.writeHead(200); res.end('OK');
    });
    return;
  }
  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, async () => {
  console.log(`🤖 [WEBHOOK MODE] ربات ناشناس شروع به کار کرد...`);
  console.log(`🌐 Server on port ${PORT}`);
  try {
    await bot.deleteWebHook();
    await bot.setWebHook(`https://${WEBHOOK_DOMAIN}${WEBHOOK_PATH}`);
    console.log(`✅ Webhook: https://${WEBHOOK_DOMAIN}${WEBHOOK_PATH}`);
  } catch (e) {
    console.error('[Webhook setup error]', e.message);
  }
});

process.on('uncaughtException',  err => console.error('[Uncaught]', err.message));
process.on('unhandledRejection', r   => console.error('[Rejection]', r));
