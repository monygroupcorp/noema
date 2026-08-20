import type { Telegram } from 'telegraf'
import type { TelegramSender } from './TelegramAllocutio.js'
import { redactSecrets, redactExtra } from './redact.js'

export function makeTelegramSender(tg: Telegram): TelegramSender {
  return {
    sendMessage: (chatId, text, extra) =>
      tg.sendMessage(chatId, redactSecrets(text), redactExtra(extra) as never),

    editMessageText: (chatId, messageId, text, extra) =>
      tg.editMessageText(chatId, messageId, undefined, redactSecrets(text), redactExtra(extra) as never).then(() => {}),

    editMessageCaption: (chatId, messageId, caption, extra) =>
      tg.editMessageCaption(chatId, messageId, undefined, redactSecrets(caption), redactExtra(extra) as never).then(() => {}),

    editMessageReplyMarkup: (chatId, messageId, reply_markup) =>
      tg.editMessageReplyMarkup(chatId, messageId, undefined, reply_markup as never).then(() => {}),

    deleteMessage: (chatId, messageId) =>
      tg.deleteMessage(chatId, messageId).then(() => {}),

    answerCallbackQuery: (id) =>
      tg.answerCbQuery(id).then(() => {}),

    // The media URL itself is not scrubbed — Telegram fetches it server-side and it
    // never appears in the chat. Only the caption, which viewers read, is scrubbed.
    sendPhoto: (chatId, url, extra) =>
      tg.sendPhoto(chatId, url, redactExtra(extra) as never),

    sendVideo: (chatId, url, extra) =>
      tg.sendVideo(chatId, url, redactExtra(extra) as never),

    sendDocument: (chatId, url, extra) =>
      tg.sendDocument(chatId, url, redactExtra(extra) as never),

    sendMediaGroup: (chatId, media) =>
      tg.sendMediaGroup(chatId, media.map(m => redactExtra(m)) as never).then(() => {}),

    setMessageReaction: (chatId, messageId, reaction) =>
      tg.setMessageReaction(chatId, messageId, reaction as never).then(() => {}),

    getFileLink: (fileId) =>
      tg.getFileLink(fileId).then(u => u.toString()),

    getChatAdministrators: (chatId) =>
      tg.getChatAdministrators(chatId).then(arr => arr.map(a => ({ user: { id: a.user.id } }))),
  }
}
