// =============================================================================
// Credentum / CredentumStore — a fiat user's login credential (email + password).
// =============================================================================
//
// The IDENTITY is the `Anima`; the MASK is a `'password'` `Persona` (externusId =
// the lowercased email). A `Credentum` is neither — it is the *secret material*
// (password hash + single-use email-verify / password-reset tokens) that lets a
// no-wallet fiat user prove they are that persona and recover access. It lives in
// its OWN store so `Anima`/`Persona` stay non-sensitive (mirrors `Secretum`).
//
// SECURITY: the store never holds a plaintext password or a plaintext token.
//   • `passwordHash` is a self-describing scrypt envelope (see passwordHash.ts).
//   • `verifyTokenHash` / `resetTokenHash` are the SHA-256 of the random token that
//     was emailed — we look the row up by hashing the token the caller presents, so
//     a store dump never yields a usable link. Tokens are single-use + short-TTL.
//
// The store is ASYMMETRIC like `Secretarium`: the auth router gets the full store;
// nothing else should. There is no method that returns a password hash to a caller.
// =============================================================================

/**
 * One fiat account's credential, keyed by `email` (unique). `animaId` is the soul the
 * `'password'` persona resolved to — the join back into the rest of the crystal.
 */
export interface Credentum {
  id: string
  /** Unique, normalized (trimmed + lowercased) — the login handle and persona externusId. */
  email: string
  /** scrypt envelope `scrypt$N$r$p$saltB64$hashB64` (never a plaintext password). */
  passwordHash: string
  /** The resolved soul behind the `'password'` persona. */
  animaId: string
  emailVerified: boolean
  /** SHA-256 of the single-use email-verification token (plaintext only ever in the email). */
  verifyTokenHash?: string
  verifyTokenExp?: Date
  /** SHA-256 of the single-use password-reset token. */
  resetTokenHash?: string
  resetTokenExp?: Date
  natum: Date
  mutatum: Date
}

/**
 * Owner-scoped credential store. Implemented by `MongoCredentum` (prod) +
 * `MemoryCredentum` (tests/dev). All lookups are by a value the caller already
 * proved they know (email at login, a token hash at verify/reset) — never a scan.
 */
export interface CredentumStore {
  /**
   * Create a credential for a brand-new email. Throws `EmailTakenError` if the email
   * already exists (the router maps that to a generic 409 — no enumeration). The unique
   * index is the authority; this method races-safe against it.
   */
  create(input: {
    email: string
    passwordHash: string
    animaId: string
    verifyTokenHash: string
    verifyTokenExp: Date
  }): Promise<Credentum>

  findByEmail(email: string): Promise<Credentum | null>
  findByVerifyTokenHash(hash: string): Promise<Credentum | null>
  findByResetTokenHash(hash: string): Promise<Credentum | null>

  /** Mark verified + clear the verify token (single-use). Idempotent. */
  markVerified(id: string): Promise<void>
  /** Replace the verify token (resend). */
  setVerifyToken(id: string, hash: string, exp: Date): Promise<void>
  /** Issue a password-reset token. */
  setResetToken(id: string, hash: string, exp: Date): Promise<void>
  /** Set a new password hash + clear the reset token (single-use). */
  setPassword(id: string, passwordHash: string): Promise<void>
}

/** Thrown by `create` when the email already has a credential — mapped to a generic 409. */
export class EmailTakenError extends Error {
  constructor() {
    super('email already registered')
    this.name = 'EmailTakenError'
  }
}

/** Trim + lowercase — the single normalization applied everywhere email is a key. */
export function normalizeEmail(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase()
}

// A deliberately conservative single-line email check — good enough to reject
// obvious garbage without pretending to fully validate RFC 5322. Real validation
// is "an email we sent arrived," i.e. the verification step.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_RE.test(email)
}

export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 200

/** Returns a human-readable reason a password is unacceptable, or `null` if it's fine. */
export function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== 'string') return 'password is required'
  if (pw.length < MIN_PASSWORD_LENGTH) return `password must be at least ${MIN_PASSWORD_LENGTH} characters`
  if (pw.length > MAX_PASSWORD_LENGTH) return `password must be at most ${MAX_PASSWORD_LENGTH} characters`
  return null
}
