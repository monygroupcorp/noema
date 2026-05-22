// =============================================================================
// telegramRender — pure flow ↔ Telegram translation
// =============================================================================
// Stateless helpers that turn FlowEngine primitives into Telegram messages and
// compact callback_data strings back into PrimitiveEvents. No I/O, no class state —
// kept out of the adapter so TelegramAllocutio is just orchestration.

import type { Primitive, PrimitiveEvent } from '../../flow/types.js'

// ── inline keyboard helpers ──────────────────────────────────────────────────

export type InlineButton = { text: string; callback_data: string }
export type InlineKeyboard = { inline_keyboard: InlineButton[][] }

export function inlineKeyboard(rows: InlineButton[][]): InlineKeyboard {
  return { inline_keyboard: rows }
}

export function btn(text: string, data: string): InlineButton {
  return { text, callback_data: data }
}

// ── renderPrimitive — Telegram rendering for each primitive kind ─────────────

export interface RenderResult {
  text: string
  extra?: { reply_markup?: InlineKeyboard }
}

export function renderPrimitive(primitive: Primitive): RenderResult {
  switch (primitive.kind) {
    case 'Select': {
      const rows = primitive.options.map(opt => [btn(opt.label, `s:${opt.id}`)])
      return {
        text: primitive.label,
        extra: { reply_markup: inlineKeyboard(rows) },
      }
    }

    case 'MultiSelect': {
      const rows = primitive.options.map(opt => [btn(opt.label, `ms:${opt.id}`)])
      rows.push([btn('Done', 'ms:done')])
      return {
        text: primitive.label,
        extra: { reply_markup: inlineKeyboard(rows) },
      }
    }

    case 'Paginate': {
      const text = `${primitive.label}  (page ${primitive.page + 1}/${primitive.totalPages})`
      const itemRows: InlineButton[][] = primitive.items.map(item => [btn(item.label, `ps:${item.id}`)])
      const navRow: InlineButton[] = []
      if (primitive.page > 0) navRow.push(btn('◀ Prev', 'pp'))
      if (primitive.page < primitive.totalPages - 1) navRow.push(btn('▶ Next', 'pn'))
      const rows = navRow.length > 0 ? [...itemRows, navRow] : itemRows
      return {
        text,
        extra: { reply_markup: inlineKeyboard(rows) },
      }
    }

    case 'Confirm': {
      const text = `${primitive.label}\n\n${primitive.question}`
      const row: InlineButton[] = [btn('Yes', 'cy'), btn('No', 'cn')]
      return {
        text,
        extra: { reply_markup: inlineKeyboard([row]) },
      }
    }

    case 'Form': {
      const firstUnfilled = primitive.fields.find(f => f.required)
      const text = firstUnfilled
        ? `${primitive.label}\n\nPlease enter ${firstUnfilled.label}:`
        : primitive.label
      return { text }
    }

    case 'Detail': {
      const rows = primitive.actions.map(action => [btn(action.label, `a:${action.id}`)])
      return {
        text: `${primitive.label}\n\n${primitive.content}`,
        extra: { reply_markup: inlineKeyboard(rows) },
      }
    }

    case 'Stream': {
      let text: string
      switch (primitive.status) {
        case 'running':
          text = `⏳ Running...`
          break
        case 'complete':
          text = primitive.content
            ? `✅ Complete\n\n${primitive.content}`
            : `✅ Complete`
          break
        case 'failed':
          text = `❌ Failed`
          break
        default:
          text = primitive.label
      }
      return { text }
    }

    case 'Prompt': {
      const text = primitive.placeholder
        ? `${primitive.label}\n\n${primitive.placeholder}`
        : primitive.label
      return { text }
    }

    case 'Result': {
      // The delivery menu's morphing row is attached by _sendResult; here just text.
      const text = primitive.textContent
        ? primitive.textContent
        : primitive.media?.length
          ? primitive.label
          : 'Done.'
      return { text }
    }
  }
}

// ── decodeCallbackData — compact callback_data string → PrimitiveEvent ────────

export function decodeCallbackData(data: string): PrimitiveEvent | null {
  if (data.startsWith('s:')) {
    return { kind: 'select', selectedId: data.slice(2) }
  }
  if (data === 'cy') {
    return { kind: 'confirm', confirmed: true }
  }
  if (data === 'cn') {
    return { kind: 'confirm', confirmed: false }
  }
  if (data === 'pn') {
    return { kind: 'paginate', action: 'next' }
  }
  if (data === 'pp') {
    return { kind: 'paginate', action: 'prev' }
  }
  if (data.startsWith('ps:')) {
    return { kind: 'paginate', action: 'select', selectedId: data.slice(3) }
  }
  if (data.startsWith('a:')) {
    const parts = data.split(':')
    const actionId = parts[1]
    const actumId = parts[2]
    if (actumId) return { kind: 'result_action', actumId, actionId }
    return { kind: 'action', actionId }
  }
  if (data.startsWith('ms:')) {
    const id = data.slice(3)
    if (id === 'done') return null  // Done button — treat as no-op for now
    return { kind: 'multiselect', selectedIds: [id] }
  }
  return null
}
