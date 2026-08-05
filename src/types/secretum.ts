// =============================================================================
// Secretum / Secretarium — a user's BYO gated-origin credential, sealed at rest.
// =============================================================================
//
// A private model import is ORIGIN-ONLY for its weights (docs/spec/model-import.md), so
// a GATED origin (many Civitai models; private/gated HF repos) needs the owner's own
// credential to download. `Secretum` is that credential, held in a SEPARATE store from
// `Anima` — a token is a different security class than the non-sensitive BYO *account
// names* (`civitaiAccount`, `huggingFaceAccount`) that live on `Anima.publicatio`.
//
// KEYING is generic (`ownerKey`, not `animaId`): a wallet identity and a Bursa purse are
// equally valid owners, so an anonymous purse user can bring a secret too (§ownerKeyOf).
//
// The store is deliberately ASYMMETRIC. `put`/`has`/`remove` are safe to hand around;
// `resolve` (the ONLY method returning plaintext) is given to exactly two server-side
// consumers — the import-time metadata fetcher and the pod-weight proxy — and NEVER to
// `CrystalApi` or the router. `getMe` gets a `has`-only `SecretPresence` view.
// =============================================================================

export type SecretProvider = 'civitai' | 'huggingface'

/** The set of providers a caller can connect — the canonical list (drives validation + getMe). */
export const SECRET_PROVIDERS: readonly SecretProvider[] = ['civitai', 'huggingface'] as const

export function isSecretProvider(x: unknown): x is SecretProvider {
  return typeof x === 'string' && (SECRET_PROVIDERS as readonly string[]).includes(x)
}

/**
 * One owner's sealed credential for one provider. The plaintext token NEVER lives here —
 * only its AES-256-GCM envelope. `expiresAt` drives idle-expiry (a TTL index removes the
 * doc once reached); a real use (`resolve`) pushes it forward by the owner's chosen window.
 */
export interface Secretum {
  ownerKey: string
  provider: SecretProvider
  /** AES-256-GCM envelope (see secretBox.ts). */
  ciphertext: string
  iv: string
  authTag: string
  keyId: string
  /** Idle window in days the owner chose at connect-time (default 90) — used to re-derive expiry. */
  idleDays: number
  natum: Date
  mutatum: Date
  /** Last real `resolve` (a gated fetch). Absent until first used. */
  lastUsedAt?: Date
  /** Idle-expiry deadline (TTL index target). Seeded at `put`, pushed forward on `resolve`. */
  expiresAt: Date
}

/**
 * Owner-keyed BYO secret store. ASYMMETRIC by design (see file header). Implemented by
 * `MongoSecretarium` (prod) + `MemorySecretarium` (tests/dev).
 */
export interface Secretarium {
  /** Seal `plaintext` and upsert it for `(ownerKey, provider)`. `idleDays` sets the expiry window. */
  put(ownerKey: string, provider: SecretProvider, plaintext: string, idleDays: number): Promise<{ expiresAt: Date }>
  /** Presence check — never touches plaintext (getMe → 'connected' | 'absent'). */
  has(ownerKey: string, provider: SecretProvider): Promise<boolean>
  /** Forget the secret. Idempotent. */
  remove(ownerKey: string, provider: SecretProvider): Promise<void>
  /**
   * INTERNAL ONLY — decrypt for a server-side origin fetch. Touches `lastUsedAt` and pushes
   * `expiresAt` forward. Returns null when absent/expired. NEVER expose to the API facade/router.
   */
  resolve(ownerKey: string, provider: SecretProvider): Promise<string | null>
}

/** The narrow `has`-only capability `getMe` is given — carries NO `resolve`. */
export type SecretPresence = Pick<Secretarium, 'has'>

/** The write slice the API facade may hold — carries NO `resolve`. */
export type SecretWriter = Pick<Secretarium, 'put' | 'remove'>

/**
 * The `resolve`-only slice handed to the two legitimate server-side plaintext consumers — the
 * import-time metadata scrape and the weight-download proxy. Constructed in `index.ts`, NEVER
 * passed through `CrystalApiDeps` or any HTTP handler that could echo it.
 */
export type SecretResolver = Pick<Secretarium, 'resolve'>

/** Default idle-expiry window (days) when the caller doesn't choose one. */
export const DEFAULT_SECRET_IDLE_DAYS = 90
