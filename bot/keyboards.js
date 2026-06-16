'use strict';

// Premium emoji IDs assigned to buttons
const E = {
  download:   '5206607081334906820',
  invite:     '5422439311196834318',
  profile:    '5213383002129702114',
  support:    '5255883984151276991',
  rules:      '5436113877181941026',
  guide:      '5924664865208671041',
  // Admin panel emojis
  botStatus:  '5400250414929041085',
  stats:      '5472308992514464048',
  latestUsers:'5190806721286657692',
  topRef:     '5413704112220949842',
  richest:    '5271604874419647061',
  mostService:'5447644880824181073',
  msgUser:    '5472363448404809929',
  broadcast:  '5436040291507247633',
  searchUser: '6037618875846102911',
  userInfo:   '5375296873982604963',
  unban:      '5231200819986047254',
  ban:        '5395444784611480792',
  setCoins:   '5461117441612462242',
  addCoins:   '5391112412445288650',
  manualSvc:  '5334544901428229844',
  resetCoins: '5264713049637409446',
  editWelcome:'5453957997418004470',
  deleteUser: '5246989476248429334',
  channels:   '5440660757194744323',
  coinConfig: '5240241223632954241',
  allUsers:   '5472308992514464048',
  monthStats: '5400250414929041085',
  fullReport: '5994495364084796671',
  manageConf: '5436113877181941026',
  maintenance:'5465665476971471368',
  channel1:   '5424818078833715060',
  channel2:   '5472027899789843495',
  check:      '6300757202651055745',
  link:       '4981404027402061416',
  coin:       '5785193735075663481',
  trophy:     '5785219784052314091',
  calendar:   '5785033300867288899',
  person:     '5215392879320505675',
  confetti:   '5427009714745517609',
  manageBtn:  '6032751234790726550',
};

// Helper to build a button with premium emoji
function btn(text, emojiId, style = null) {
  const b = { text };
  if (emojiId) b.icon_custom_emoji_id = emojiId;
  if (style) b.style = style;
  return b;
}

// Main menu keyboard
function mainMenu() {
  return [
    [btn('دریافت اشتراک', E.download, 'success')],
    [btn('دعوت دوستان', E.invite, 'primary'), btn('پروفایل', E.profile, 'primary')],
    [btn('پشتیبانی', E.support, 'primary'), btn('قوانین', E.rules, 'primary')],
    [btn('راهنما', E.guide, 'danger')]
  ];
}

// Admin panel keyboard
function adminMenu() {
  return [
    [btn('وضعیت ربات', E.botStatus, 'primary'), btn('آمار کامل', E.stats, 'primary')],
    [btn('آخرین کاربران', E.latestUsers, 'primary'), btn('برترین دعوت‌ها', E.topRef, 'primary')],
    [btn('ثروتمندترین‌ها', E.richest, 'primary'), btn('بیشترین سرویس', E.mostService, 'primary')],
    [btn('پیام به کاربر', E.msgUser, 'primary'), btn('پیام همگانی', E.broadcast, 'primary')],
    [btn('اطلاعات کاربر', E.userInfo, 'primary'), btn('جستجوی کاربر', E.searchUser, 'primary')],
    [btn('رفع مسدودی', E.unban, 'success'), btn('مسدود کردن', E.ban, 'danger')],
    [btn('افزودن سکه', E.addCoins, 'primary'), btn('تنظیم سکه', E.setCoins, 'primary')],
    [btn('ری‌ست سکه', E.resetCoins, 'primary'), btn('سرویس دستی', E.manualSvc, 'primary')],
    [btn('حذف کاربر', E.deleteUser, 'danger'), btn('متن خوش‌آمد', E.editWelcome, 'primary')],
    [btn('تنظیمات سکه‌ها', E.coinConfig, 'primary'), btn('کانال‌های اجباری', E.channels, 'primary')],
    [btn('آمار ماهانه', E.monthStats, 'primary'), btn('همه کاربران', E.allUsers, 'primary')],
    [btn('مدیریت کانفیگ', E.manageConf, 'primary'), btn('گزارش کامل', E.fullReport, 'primary')],
    [btn('مدیریت دکمه‌ها', E.manageBtn, 'primary'), btn('حالت تعمیر', E.maintenance, 'danger')],
    [btn('🔙 بازگشت به منو', null, null)]
  ];
}

// Force join inline keyboard
function forceJoinKeyboard(channels) {
  const rows = channels.map(ch => ([{
    text: `${ch.channel_name}`,
    url: ch.channel_url,
    icon_custom_emoji_id: E.channel1
  }]));
  rows.push([{
    text: 'تایید عضویت',
    callback_data: 'check_membership',
    icon_custom_emoji_id: E.check,
    style: 'success'
  }]);
  return rows;
}

// Back button
function backBtn() {
  return [[{ text: '🔙 بازگشت', callback_data: 'back_to_menu' }]];
}

module.exports = { mainMenu, adminMenu, forceJoinKeyboard, backBtn, btn, E };
