'use strict';

const BOT_TOKEN = process.env.BOT_TOKEN || '8869327039:AAHhE0fGBxVky3ET1WZXxWqesV0FDHjZkrg';
const BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function call(method, body) {
  const res = await fetch(`${BASE}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!data.ok) {
    console.error(`[API Error] ${method}:`, JSON.stringify(data));
  }
  return data;
}

async function sendMessage(chatId, text, extra = {}) {
  return call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });
}

async function sendMessageWithKeyboard(chatId, text, keyboard, extra = {}) {
  return call('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: { keyboard, resize_keyboard: true, is_persistent: false },
    ...extra
  });
}

async function sendMessageWithInline(chatId, text, inline_keyboard, extra = {}) {
  return call('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard },
    ...extra
  });
}

async function editMessage(chatId, messageId, text, inline_keyboard = null) {
  const body = { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML' };
  if (inline_keyboard) body.reply_markup = { inline_keyboard };
  return call('editMessageText', body);
}

async function answerCallback(callbackQueryId, text = '', showAlert = false) {
  return call('answerCallbackQuery', { callback_query_id: callbackQueryId, text, show_alert: showAlert });
}

async function setReaction(chatId, messageId, emoji = '⚡') {
  return call('setMessageReaction', {
    chat_id: chatId,
    message_id: messageId,
    reaction: [{ type: 'emoji', emoji }]
  });
}

async function getChatMember(chatId, userId) {
  return call('getChatMember', { chat_id: chatId, user_id: userId });
}

async function deleteMessage(chatId, messageId) {
  return call('deleteMessage', { chat_id: chatId, message_id: messageId });
}

async function sendReplyKeyboard(chatId, text, keyboard, extra = {}) {
  return call('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: { keyboard, resize_keyboard: true, one_time_keyboard: false },
    ...extra
  });
}

async function removeKeyboard(chatId, text) {
  return call('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: { remove_keyboard: true }
  });
}

async function copyMessage(fromChatId, toChatId, messageId) {
  return call('copyMessage', { from_chat_id: fromChatId, chat_id: toChatId, message_id: messageId });
}

module.exports = {
  call,
  sendMessage,
  sendMessageWithKeyboard,
  sendMessageWithInline,
  editMessage,
  answerCallback,
  setReaction,
  getChatMember,
  deleteMessage,
  sendReplyKeyboard,
  removeKeyboard,
  copyMessage
};
