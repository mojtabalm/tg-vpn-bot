'use strict';

function mainMenu() {
  return {
    keyboard: [
      [{ text: '🪝 به یه ناشناس وصلم کن!' }],
      [{ text: '❤️ به مخاطب خاصم وصلم کن!' }],
      [{ text: 'لینک ناشناس من 🖼' }, { text: 'پیام ناشناس به گروه 👥' }],
      [{ text: '🏆 افزایش امتیاز' }, { text: 'راهنما' }],
    ],
    resize_keyboard: true,
  };
}

function genderPrefMenu() {
  return {
    keyboard: [
      [{ text: '👦 پسر باشه' }, { text: '👧 دختر باشه' }],
      [{ text: 'مهم نیست' }],
    ],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

function inChatMenu() {
  return {
    keyboard: [[{ text: 'قطع مکالمه' }]],
    resize_keyboard: true,
  };
}

function cancelMenu() {
  return {
    keyboard: [[{ text: 'بیخیال، انصراف میدم' }]],
    resize_keyboard: true,
  };
}

function blockMenu() {
  return {
    keyboard: [
      [{ text: 'آره بلاکش کن' }, { text: 'بیخیال، بعدا هم وصل شم' }],
    ],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

function blockReasonMenu() {
  return {
    keyboard: [
      [{ text: 'بی ادب بود' }, { text: 'جنسیتش اشتباه بود' }],
      [{ text: 'باهاش حال نکردم' }, { text: 'تبلیغ فرستاد' }],
      [{ text: 'بیخیال، بعدا هم وصل شم' }],
    ],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

function reportReasonMenu() {
  return {
    keyboard: [
      [{ text: 'بی ادب بود' }, { text: 'تبلیغ فرستاد' }],
      [{ text: 'انصراف' }],
    ],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

// blue glass inline button
function btn(text, callbackData, style = 'primary') {
  const b = { text, callback_data: callbackData };
  if (style) b.style = style;
  return b;
}

function forceJoinKeyboard(channels) {
  const rows = channels.map(ch => ([{
    text: ch.channel_name,
    url: ch.channel_url,
    style: 'primary',
  }]));
  rows.push([{
    text: '✅ تایید عضویت',
    callback_data: 'check_join',
    style: 'primary',
  }]);
  return rows;
}

function genderKeyboard() {
  return [[
    { text: '👧 دختر', callback_data: 'set_gender:female', style: 'primary' },
    { text: '👦 پسر',  callback_data: 'set_gender:male',   style: 'primary' },
  ]];
}

function adminKeyboard(channels) {
  const chList = channels.map(c => `• @${c.channel_id}`).join('\n');
  return [
    [btn('📢 پیام همگانی', 'admin_broadcast'), btn('📊 آمار', 'admin_stats')],
    [btn('➕ کانال جوین اجباری', 'admin_add_channel')],
    [btn('➖ حذف کانال', 'admin_remove_channel')],
  ];
}

function helpKeyboard() {
  return [
    [{ text: '👉 این ربات چیه؟',          callback_data: 'help_about',    style: 'primary' }],
    [{ text: '👉 چطوری پیام دریافت کنم؟', callback_data: 'help_receive',  style: 'primary' }],
    [{ text: '👉 چطوری مخاطب خاص؟',       callback_data: 'help_specific', style: 'primary' }],
    [{ text: '👉 چطوری چت تصادفی؟',        callback_data: 'help_random',   style: 'primary' }],
  ];
}

function helpBackKeyboard() {
  return [[{ text: '🔙 بازگشت به راهنما', callback_data: 'help_back', style: 'primary' }]];
}

module.exports = {
  mainMenu, genderPrefMenu, inChatMenu, cancelMenu,
  blockMenu, blockReasonMenu, reportReasonMenu,
  btn, forceJoinKeyboard, genderKeyboard,
  adminKeyboard, helpKeyboard, helpBackKeyboard,
};
