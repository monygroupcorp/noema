// =============================================================================
// FLOW ENGINE — shared types
// =============================================================================
//
// The flow engine is the stateful interaction layer between platform adapters
// (Telegram, Discord, REST, canvas) and the crystal ring. It transforms raw
// user input into ring calls and translates ring results into platform-agnostic
// UI primitives.
//
// Three-layer model:
//   Platform adapter (Telegram, etc.)
//          ↕ Primitives / PrimitiveEvents
//     Flow Engine  ← this layer
//          ↕ ring calls (in-process)
//     Crystal Ring (already complete)
// =============================================================================

// ---------------------------------------------------------------------------
// Intent — the user's declared goal
// ---------------------------------------------------------------------------

export type Intent =
  | 'execute'
  | 'train'
  | 'explore'
  | 'review'
  | 'manage'
  | 'delegate'
  | 'status'

// ---------------------------------------------------------------------------
// Primitives — UI atoms emitted by flows, rendered by adapters
// ---------------------------------------------------------------------------

export type Primitive =
  | { kind: 'Select';      label: string; options: Array<{ id: string; label: string; description?: string }> }
  | { kind: 'MultiSelect'; label: string; options: Array<{ id: string; label: string }> }
  | { kind: 'Paginate';    label: string; items: Array<{ id: string; label: string; description?: string }>; page: number; totalPages: number }
  | { kind: 'Confirm';     label: string; question: string }
  | {
      kind: 'Form'
      label: string
      fields: Array<{ key: string; label: string; type: string; required: boolean; default?: unknown }>
      /**
       * The current aditus (the values collected so far). When present, the adapter
       * renders the flow card: each field shows its current-or-default value, required
       * ones are marked, and an Execute affordance appears only once every required
       * field has a value. A field on an existing primitive — not a new primitive (ADR-0001).
       */
      values?: Record<string, unknown>
    }
  | { kind: 'Detail';      label: string; content: string; actions: Array<{ id: string; label: string }> }
  | { kind: 'Stream';      label: string; actumId: string; status: 'running' | 'complete' | 'failed'; content?: string }
  | { kind: 'Prompt';      label: string; placeholder?: string }
  | {
      kind: 'Result'
      actumId: string
      /** Tool name for display */
      label: string
      /** Output media files, if any */
      media?: Array<{
        url: string
        type: 'image' | 'video' | 'audio' | 'document'
        /** User's original prompt — raw, unescaped. Adapter escapes at render time. */
        caption?: string
      }>
      /** Text output (chatgpt, caption, etc.) — raw, unescaped */
      textContent?: string
      /** Action buttons. Standard set: rate_beautiful, rate_funny, rate_negative,
       *  info, tweak, rerun. Adapter renders these as the delivery keyboard. */
      actions: Array<{ id: string; label: string }>
    }

// ---------------------------------------------------------------------------
// PrimitiveEvent — user interaction result sent back to flow engine
// ---------------------------------------------------------------------------

export type PrimitiveEvent =
  | { kind: 'select';      selectedId: string }
  | { kind: 'multiselect'; selectedIds: string[] }
  | { kind: 'paginate';    action: 'next' | 'prev' | 'select'; selectedId?: string }
  | { kind: 'confirm';     confirmed: boolean }
  | { kind: 'form';        values: Record<string, unknown> }
  | { kind: 'action';      actionId: string }
  | { kind: 'result_action'; actumId: string; actionId: string }
  | { kind: 'prompt';      text: string }

// ---------------------------------------------------------------------------
// Step and Resolution
// ---------------------------------------------------------------------------

export type Step = { primitives: Primitive[] }

export type Resolution =
  | { kind: 'complete';  output?: unknown }
  | { kind: 'abandon' }
  | { kind: 'handoff';   toIntent: Intent; withContext: unknown }

// ---------------------------------------------------------------------------
// AuctorKey — identity union (matches the crystal's `by` field on Inceptio)
// ---------------------------------------------------------------------------

export type AuctorKey =
  | { animaId: string }
  | { commitment: string }
  | { bursaToken: string }

// ---------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------

export type Platform = 'telegram' | 'discord' | 'web' | 'rest' | 'mcp'

// ---------------------------------------------------------------------------
// FlowContext — in-flight state for one user's active flow
// ---------------------------------------------------------------------------

export interface FlowContext {
  intent: Intent
  /** The flow-specific step state — each Flow defines its own state shape */
  state: unknown
  /** Identity — animaId for identified users, commitment for anonymous */
  identity: AuctorKey
  /** Active session (Modo) if one exists */
  modoId?: string
  platform: Platform
  /** Platform-native user identifier (Telegram user_id, Discord user_id, etc.) */
  platformUserId: string
  /** Platform-native message/interaction ID — used for message editing on Telegram/Discord */
  messageId?: string
  /**
   * FK → Actum. Set when this context is waiting for an async execution to complete.
   * The FlowRouter uses this to resume the flow when the actum's webhook arrives.
   */
  pendingActumId?: string
}

// ---------------------------------------------------------------------------
// Flow interface
// ---------------------------------------------------------------------------

export interface Flow {
  readonly intent: Intent

  /**
   * Called when a user enters this flow.
   * Returns the first Step the adapter should render.
   */
  enter(ctx: FlowContext): Promise<Step>

  /**
   * Called when a user event arrives for an active flow.
   * Returns either the next Step or a Resolution (terminal state).
   */
  handle(ctx: FlowContext, event: PrimitiveEvent): Promise<Step | Resolution>
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isStep(value: Step | Resolution): value is Step {
  return 'primitives' in value
}

export function isResolution(value: Step | Resolution): value is Resolution {
  return 'kind' in value
}
