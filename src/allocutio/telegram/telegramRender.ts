// =============================================================================
// telegramRender — pure flow ↔ Telegram translation
// =============================================================================
// Stateless helpers that turn FlowEngine primitives into Telegram messages and
// compact callback_data strings back into PrimitiveEvents. No I/O, no class state —
// kept out of the adapter so TelegramAllocutio is just orchestration.

import type { Primitive, PrimitiveEvent } from '../../flow/types.js'
import { isMediaRef } from '../../crystal/MediaFetcher.js'

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

// ── field value display ──────────────────────────────────────────────────────

/**
 * How a filled Porta value is shown on a Form card.
 *
 * A media reference is never printed. A resolved image input is a Telegram file link —
 * `https://api.telegram.org/file/bot<TOKEN>/…` — so echoing the raw value publishes
 * the bot token to the chat; and a private output chained in as an input is a
 * `noema-private://` marker, which belongs in a chat even less. Nobody reading a card wants
 * either anyway; they want to know the field is filled. (`redactSecrets` at the sender is the
 * backstop; this is the surface deciding not to print references in the first place.)
 */
function displayValue(value: unknown): string {
  if (value === undefined || value === null) return '—'
  const str = typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (isMediaRef(str.trim())) return '(image)'
  return str
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
      const values = primitive.values
      const isFilled = (key: string) => values !== undefined && values[key] !== undefined && values[key] !== null

      // Card mode: the flow carries `values` (the current aditus). Render the full
      // surface — every Porta with its current/default value — plus per-field edit
      // buttons and an Execute button that appears only when every required Porta
      // has a value. (Save-as buttons are TASK-005 — the keyboard leaves room.)
      if (values !== undefined) {
        // Degenerate case: exactly one required field, nothing yet filled, nothing else
        // worth showing → keep the single-field prompt (don't regress /make's one-field path).
        const requiredFields = primitive.fields.filter(f => f.required)
        const onlyOneRequiredEmpty =
          requiredFields.length === 1 &&
          primitive.fields.length === 1 &&
          !isFilled(requiredFields[0].key)
        if (onlyOneRequiredEmpty) {
          return { text: `${primitive.label}\n\nPlease enter ${requiredFields[0].label}:` }
        }

        const lines = primitive.fields.map(f => {
          const current = isFilled(f.key) ? values[f.key] : f.default
          const shown = displayValue(current)
          const mark = f.required ? ' [required]' : ''
          return `• ${f.label}: ${shown}${mark}`
        })
        const text = `${primitive.label}\n\n${lines.join('\n')}`

        const rows: InlineButton[][] = primitive.fields.map(f => [btn(`✎ ${f.label}`, `a:edit_${f.key}`)])
        const allRequiredFilled = requiredFields.every(f => isFilled(f.key) || f.default !== undefined)
        if (allRequiredFilled) {
          rows.push([btn('▶ Execute', 'a:execute'), btn('💾 Save as…', 'a:saveas')])
        }
        return { text, extra: { reply_markup: inlineKeyboard(rows) } }
      }

      // Legacy single-field prompt (no `values` carried).
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
