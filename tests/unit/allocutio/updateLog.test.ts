import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  describeUpdate,
  describeMyChatMember,
  describeChatMigration,
  type ChatMemberUpdated,
} from '../../../src/allocutio/telegram/updateLog.js'

const bot = { id: 7, is_bot: true }

function memberChange(oldStatus: string, newStatus: string): ChatMemberUpdated {
  return {
    chat: { id: -1001, type: 'supergroup', title: 'Night Shift' },
    from: { id: 42 },
    date: 1_700_000_000,
    old_chat_member: { status: oldStatus, user: bot },
    new_chat_member: { status: newStatus, user: bot },
  }
}

test('a message update carries chat id, chat type and the command word, never the text', () => {
  const f = describeUpdate({
    update_id: 9,
    message: {
      message_id: 3,
      from: { id: 42 },
      chat: { id: -1001, type: 'supergroup' },
      text: '/make@noemabot a very private prompt',
      message_thread_id: 5,
    },
  })
  assert.deepEqual(f, {
    updateId: 9, kind: 'message', chatId: -1001, chatType: 'supergroup',
    messageId: 3, userId: 42, threadId: 5, command: '/make',
  })
  assert.ok(!JSON.stringify(f).includes('private prompt'))
})

test('a plain-text message logs no command field', () => {
  const f = describeUpdate({ update_id: 1, message: { message_id: 1, chat: { id: 5, type: 'private' }, text: 'hello there' } })
  assert.equal(f.command, undefined)
  assert.equal(f.chatType, 'private')
})

test('a callback update carries chat id, chat type and only the action word of its payload', () => {
  const f = describeUpdate({
    update_id: 2,
    callback_query: { from: { id: 42 }, message: { message_id: 8, chat: { id: -1001, type: 'group' } }, data: 'sa:save:secret-arg' },
  })
  assert.deepEqual(f, {
    updateId: 2, kind: 'callback_query', userId: 42, chatId: -1001, chatType: 'group', messageId: 8, action: 'sa',
  })
})

test('bot membership changes are classified', () => {
  const cases: Array<[string, string, string]> = [
    ['left', 'member', 'added'],
    ['kicked', 'administrator', 'added'],
    ['member', 'left', 'removed'],
    ['administrator', 'kicked', 'removed'],
    ['member', 'administrator', 'promoted'],
    ['administrator', 'member', 'demoted'],
    ['member', 'restricted', 'restricted'],
    ['restricted', 'member', 'unrestricted'],
    ['administrator', 'administrator', 'changed'],
  ]
  for (const [from, to, event] of cases) {
    assert.equal(describeMyChatMember(memberChange(from, to)).event, event, `${from} → ${to}`)
  }
})

test('a membership record carries the chat, who did it, both statuses and Telegram\'s timestamp', () => {
  assert.deepEqual(describeMyChatMember(memberChange('left', 'member')), {
    event: 'added', chatId: -1001, chatType: 'supergroup', chatTitle: 'Night Shift', byUserId: 42,
    oldStatus: 'left', newStatus: 'member', at: '2023-11-14T22:13:20.000Z',
  })
})

test('a group-to-supergroup migration is recorded from both sides', () => {
  const date = 1_700_000_000
  assert.deepEqual(
    describeChatMigration({ message_id: 1, date, chat: { id: -55, type: 'group' }, migrate_to_chat_id: -100155 }),
    { event: 'migrated_to', chatId: -55, chatType: 'group', toChatId: -100155, at: '2023-11-14T22:13:20.000Z' },
  )
  assert.deepEqual(
    describeChatMigration({ message_id: 1, date, chat: { id: -100155, type: 'supergroup' }, migrate_from_chat_id: -55 }),
    { event: 'migrated_from', chatId: -100155, chatType: 'supergroup', fromChatId: -55, at: '2023-11-14T22:13:20.000Z' },
  )
  assert.equal(describeChatMigration({ message_id: 1, chat: { id: 1, type: 'private' }, text: 'hi' }), undefined)
})
