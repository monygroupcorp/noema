// =============================================================================
// Credentum / CredentumStore — a fiat user's login credential (username + password).
// =============================================================================
//
// The IDENTITY is the `Anima`; the MASK is a `'password'` `Persona` (externusId =
// the normalized username). A `Credentum` is neither — it is the *secret material*
// (the password hash) that lets a no-wallet fiat user prove they are that persona.
// It lives in its OWN store so `Anima`/`Persona` stay non-sensitive (mirrors `Secretum`).
//
// NO EMAIL. Accounts are anonymous username+password — there is no verification step
// and no email-based password reset. Account RECOVERY is done by binding backup
// channels (a Telegram persona, a wallet `web` persona) to the same `animaId`; proving
// one of those channels reaches the soul and mints a session. Those channels are
// separate `Persona` rows, not fields here (see docs/spec/fiat-auth.md).
//
// SECURITY: the store never holds a plaintext password.
//   • `passwordHash` is a self-describing scrypt envelope (see passwordHash.ts).
//
// The store is ASYMMETRIC like `Secretarium`: the auth router gets the full store;
// nothing else should. There is no method that returns a password hash to a caller.
// =============================================================================

/**
 * One fiat account's credential, keyed by `username` (unique). `animaId` is the soul the
 * `'password'` persona resolved to — the join back into the rest of the crystal.
 */
export interface Credentum {
  id: string
  /** Unique, normalized (trimmed + lowercased) — the login handle and persona externusId. */
  username: string
  /** scrypt envelope `scrypt$N$r$p$saltB64$hashB64` (never a plaintext password). */
  passwordHash: string
  /** The resolved soul behind the `'password'` persona. */
  animaId: string
  natum: Date
  mutatum: Date
}

/**
 * Owner-scoped credential store. Implemented by `MongoCredentum` (prod) +
 * `MemoryCredentum` (tests/dev). Lookups are by a value the caller already
 * proved they know (username at login) — never a scan.
 */
export interface CredentumStore {
  /**
   * Create a credential for a brand-new username. Throws `UsernameTakenError` if the
   * username already exists (the router maps that to a generic 409 — no enumeration).
   * The unique index is the authority; this method races-safe against it.
   */
  create(input: {
    username: string
    passwordHash: string
    animaId: string
  }): Promise<Credentum>

  findByUsername(username: string): Promise<Credentum | null>

  /** Set a new password hash (used by in-app change-password + channel recovery). */
  setPassword(id: string, passwordHash: string): Promise<void>
}

/** Thrown by `create` when the username already has a credential — mapped to a generic 409. */
export class UsernameTakenError extends Error {
  constructor() {
    super('username already registered')
    this.name = 'UsernameTakenError'
  }
}

/** Trim + lowercase — the single normalization applied everywhere username is a key. */
export function normalizeUsername(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase()
}

export const MIN_USERNAME_LENGTH = 3
export const MAX_USERNAME_LENGTH = 32

// Normalized (already trimmed + lowercased): starts + ends with alphanumeric, inner
// chars may include `_ . -`. No `@` (keeps usernames disjoint from any legacy email
// `'password'` externusId) and no whitespace.
const USERNAME_RE = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/

/** Returns a human-readable reason a username is unacceptable, or `null` if it's fine. */
export function usernameProblem(raw: string): string | null {
  if (raw.length < MIN_USERNAME_LENGTH) return `username must be at least ${MIN_USERNAME_LENGTH} characters`
  if (raw.length > MAX_USERNAME_LENGTH) return `username must be at most ${MAX_USERNAME_LENGTH} characters`
  if (!USERNAME_RE.test(raw)) return 'username may use letters, numbers, and . _ - (not at the ends)'
  return null
}

export function isValidUsername(username: string): boolean {
  return usernameProblem(username) === null
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
