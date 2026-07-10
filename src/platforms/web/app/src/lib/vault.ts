// The Vault store — the ONLY place a user's anonymous credit lives.
//
// localStorage key `noema-vault`, a single versioned JSON blob holding every note
// (with its private nullifier/secret) and every minted purse token. THIS IS THE
// DANGEROUS STATE: losing it = losing the credit, with no recovery, ever. That is why
// export/import exists — a raw versioned JSON download the user can stash offline
// (decision 2: BIP39 recovery phrase is a display-only follow-up, not this).
//
// bigints (valor, credits) are stored as decimal strings — JSON can't hold bigint and
// these values are money, so we never round-trip them through Number.

const VAULT_KEY = 'noema-vault'
const VAULT_VERSION = 1 as const

/** A held note. nullifier + secret are the bearer secret — they never leave the browser. */
export interface VaultNote {
  /** 64-char hex — the bearer secret. */
  nullifier: string
  /** 64-char hex — the bearer secret. */
  secret: string
  /** poseidon(nullifier, secret) — the public commitment stored in the Merkle tree. */
  commitment: string
  /** poseidon(nullifier) — revealed on spend. */
  nullifierHash: string
  /** Credit value, decimal-string bigint. */
  valor: string
  /** Position in the Merkle tree (-1 until issuance lands). */
  leafIndex: number
  /** true once this note has been consumed to mint a purse. */
  spent: boolean
  /** ms epoch of local creation. */
  createdAt: number
}

/** A minted anonymous purse — a bearer token that funds runs via x-bursa-token. */
export interface VaultPurse {
  /** UUID bearer token — not recoverable if lost. */
  token: string
  /** Last-known balance, decimal-string bigint. Refreshed from GET /arcanum/purse/:token. */
  credits: string
  /** ms epoch of local mint. */
  createdAt: number
  /** Optional user label. */
  label?: string
}

export interface VaultState {
  version: typeof VAULT_VERSION
  notes: VaultNote[]
  purses: VaultPurse[]
}

const EMPTY: VaultState = { version: VAULT_VERSION, notes: [], purses: [] }

function isState(v: unknown): v is VaultState {
  if (!v || typeof v !== 'object') return false
  const s = v as Partial<VaultState>
  return Array.isArray(s.notes) && Array.isArray(s.purses)
}

export function readVault(): VaultState {
  try {
    const raw = localStorage.getItem(VAULT_KEY)
    if (!raw) return { ...EMPTY, notes: [], purses: [] }
    const parsed = JSON.parse(raw) as unknown
    if (isState(parsed)) return { version: VAULT_VERSION, notes: parsed.notes, purses: parsed.purses }
  } catch {
    /* corrupt store — fall through to empty rather than throwing on read */
  }
  return { ...EMPTY, notes: [], purses: [] }
}

function writeVault(s: VaultState): VaultState {
  localStorage.setItem(VAULT_KEY, JSON.stringify(s))
  return s
}

/** Persist a freshly funded note (idempotent on nullifier). */
export function addNote(note: VaultNote): VaultState {
  const s = readVault()
  const notes = [note, ...s.notes.filter((n) => n.nullifier !== note.nullifier)]
  return writeVault({ ...s, notes })
}

/** Mark a note spent once its purse is minted (so it can never be double-spent from the UI). */
export function markNoteSpent(nullifier: string): VaultState {
  const s = readVault()
  const notes = s.notes.map((n) => (n.nullifier === nullifier ? { ...n, spent: true } : n))
  return writeVault({ ...s, notes })
}

/** Persist a minted purse (idempotent on token). */
export function addPurse(purse: VaultPurse): VaultState {
  const s = readVault()
  const purses = [purse, ...s.purses.filter((p) => p.token !== purse.token)]
  return writeVault({ ...s, purses })
}

/** Update a purse's cached balance from a live GET /arcanum/purse/:token read. */
export function setPurseCredits(token: string, credits: string): VaultState {
  const s = readVault()
  const purses = s.purses.map((p) => (p.token === token ? { ...p, credits } : p))
  return writeVault({ ...s, purses })
}

/** Serialize the whole store for offline backup (the export download). */
export function exportVault(): string {
  return JSON.stringify(readVault(), null, 2)
}

/**
 * Restore from an exported blob. Rejects anything that isn't a well-formed vault so a
 * bad paste can't wipe live credit. Merges by unique nullifier/token (import never drops
 * notes/purses already present), then returns the restored state.
 */
export function importVault(json: string): VaultState {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('Not valid JSON — paste the exact file you exported.')
  }
  if (!isState(parsed)) throw new Error('This is not a Noema vault backup.')
  const incoming = parsed as VaultState
  const cur = readVault()
  const noteKeys = new Set(cur.notes.map((n) => n.nullifier))
  const purseKeys = new Set(cur.purses.map((p) => p.token))
  const notes = [...cur.notes, ...incoming.notes.filter((n) => n && n.nullifier && !noteKeys.has(n.nullifier))]
  const purses = [...cur.purses, ...incoming.purses.filter((p) => p && p.token && !purseKeys.has(p.token))]
  return writeVault({ version: VAULT_VERSION, notes, purses })
}
