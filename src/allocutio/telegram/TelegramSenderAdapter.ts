import type { Telegram } from 'telegraf'
import type { TelegramSender } from './TelegramAllocutio.js'

export function makeTelegramSender(tg: Telegram): TelegramSender {
  return {
    sendMessage: (chatId, text, extra) =>
      tg.sendMessage(chatId, text, extra as never),

    editMessageText: (chatId, messageId, text, extra) =>
      tg.editMessageText(chatId, messageId, undefined, text, extra as never).then(() => {}),

    editMessageCaption: (chatId, messageId, caption, extra) =>
      tg.editMessageCaption(chatId, messageId, undefined, caption, extra as never).then(() => {}),

    editMessageReplyMarkup: (chatId, messageId, reply_markup) =>
      tg.editMessageReplyMarkup(chatId, messageId, undefined, reply_markup as never).then(() => {}),

    deleteMessage: (chatId, messageId) =>
      tg.deleteMessage(chatId, messageId).then(() => {}),

    answerCallbackQuery: (id) =>
      tg.answerCbQuery(id).then(() => {}),

    sendPhoto: (chatId, url, extra) =>
      tg.sendPhoto(chatId, url, extra as never),

    sendVideo: (chatId, url, extra) =>
      tg.sendVideo(chatId, url, extra as never),

    sendDocument: (chatId, url, extra) =>
      tg.sendDocument(chatId, url, extra as never),

    sendMediaGroup: (chatId, media) =>
      tg.sendMediaGroup(chatId, media as never).then(() => {}),

    setMessageReaction: (chatId, messageId, reaction) =>
      tg.setMessageReaction(chatId, messageId, reaction as never).then(() => {}),

    getFileLink: (fileId) =>
      tg.getFileLink(fileId).then(u => u.toString()),

    getChatAdministrators: (chatId) =>
      tg.getChatAdministrators(chatId).then(arr => arr.map(a => ({ user: { id: a.user.id } }))),
  }
}
