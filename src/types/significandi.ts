// =============================================================================
// SIGNIFICANDI — modi significandi — modes of signifying
// =============================================================================
//
// From the Modistae framework (see essendi.ts for overview).
// "significandi" = of signifying — the mode through which value is expressed.
//
// A Signum (Latin: sign, seal, proof, military standard — literally "struck mark")
// is a proof of credit with the platform, abstracted from its underlying form.
// A signum is STRUCK or MINTED — not counted. The form varies; the proof is first-class.
//
// ECONOMIC UNIT: 1 impetus point = $0.000337 USD = 1 second of RunPod SECURE pod-time.
// All Signum valor values are in this base unit (impetus points as bigint).
//
// PRIVACY PARTITION — signum bridges the two halves of the system:
//
//   Identified forma (animaId present):
//     integer   — legacy discrete point balance
//     eth       — ETH deposit via CreditVault (0x00000001152D633eb2AC3Cf91eac9994aEEFc021)
//     x402      — x402 micropayment receipt
//     minted    — platform-issued credit
//     mined     — earned through contribution or work
//     reward    — creator royalty, referral share, host cut
//
//   Anonymous forma (animaId NEVER set — enforced by invariant):
//     arcanum   — ZK commitment: H(secret) stored in testis, balance in valor
//                 "arcanum" = the secret/hidden thing in Latin
//     tessera   — bearer capability token, session-scoped, budget in valor
//                 "tessera" = a small token of access/friendship in Roman use
//
// The ledger is append-only by design: Signorum exposes no update() method.
// Each Signum record is an immutable ledger entry. Balance = sum of valid signa.
// =============================================================================

/**
 * The form a signum takes — determines whether animaId is present (identified)
 * or absent (anonymous). See privacy partition above.
 */
export type SignumForma =
  | 'integer'     // discrete point balance — the current legacy system
  | 'eth'         // ETH deposit via CreditVault smart contract
  | 'x402'        // x402 HTTP micropayment receipt (Base network)
  | 'minted'      // platform-issued credit (promotional, grant, etc.)
  | 'mined'       // earned through contribution: publishing a modus, hosting a session
  | 'reward'      // creator royalty split, referral share, or session host cut
  | 'arcanum'     // ZK commitment — H(secret) in testis, no animaId, anonymous balance
  | 'tessera'     // bearer capability — signed, session-scoped, budget in valor

export type SignumStatus = 'valid' | 'spent' | 'locked' | 'expired'

/**
 * Signum — a proof of credit with the platform, regardless of form.
 *
 * INVARIANT: animaId MUST be absent when forma is 'arcanum' or 'tessera'.
 * This is enforced at the schema level and must be enforced in all write paths.
 */
export interface Signum {
  id: string

  /**
   * FK → Anima. Present for identified forma only.
   * NEVER set for arcanum or tessera forma — this is the privacy partition cut.
   */
  animaId?: string

  forma: SignumForma
  /**
   * Value in base units (impetus points as bigint).
   * 1 point = $0.000337 = 1 second of RunPod SECURE pod-time.
   * For tessera: this is the total capability budget (decremented on each use).
   */
  valor: bigint

  /** "auctor" = author/issuer in Latin — who created/issued this signum */
  auctor: string

  /**
   * Cryptographic receipt — content depends on forma:
   *   arcanum  → H(secret): the commitment hash, 32 bytes hex
   *   tessera  → signed bearer token (signed by session master key)
   *   eth      → Ethereum transaction hash
   *   x402     → x402 payment receipt JSON
   *   others   → internal reference or empty
   */
  testis?: string

  /**
   * One-way forward link from identified deposit → anonymous commitment.
   * Present on identified forma signa that funded an arcanum commitment.
   * Direction: deposit → arcanum ONLY. arcanum has no back-pointer.
   * This asymmetry is the schema-level privacy guarantee.
   */
  arcanumHash?: string

  /**
   * FK → Modo. Present on tessera forma only.
   * Scopes the bearer capability to a specific session.
   */
  modoId?: string

  status: SignumStatus

  /** "natum" = born — when this signum was issued */
  natum: Date
  /** "expensum" = paid out (past participle of expendere) — when this signum was spent */
  expensum?: Date
  /** FK → Actum. The execution that consumed this signum. */
  actumId?: string
}

/** "Signa" — nominative/accusative plural. Your credits. */
export type Signa = Signum[]

/**
 * Signorum — genitive plural "of the signs."
 * The append-only ledger. No update() method — immutability is the contract.
 */
export interface Signorum {
  /**
   * Current spendable balance.
   * Query by animaId (identified side) or arcanumHash (anonymous side).
   * Returns sum of all valid Signum.valor for the given identity.
   */
  balance(by: { animaId: string } | { arcanumHash: string }): Promise<bigint>
  /** Issue a new signum — the only write operation besides spend */
  issue(signum: Omit<Signum, 'id' | 'natum' | 'status'>): Promise<Signum>
  /**
   * Reserve signa for a pending actum — status: valid → locked.
   * Prevents double-spend between balance check and completion.
   * Atomic — all or nothing.
   */
  lock(signaIds: string[], actumId: string): Promise<void>
  /**
   * Release locked signa back to valid — called on actum failure.
   * No-op if any signum is already spent (prevents release after settlement).
   */
  release(signaIds: string[]): Promise<void>
  /** Full ledger history for an identity — all signa ever issued */
  history(by: { animaId: string } | { arcanumHash: string }): Promise<Signa>
  /**
   * Settle a completed actum's locked signa against the actual impetus consumed.
   * Spends all provided signa and issues a refund signum for any delta
   * (totalLocked − actualImpetus) back to the same identity.
   *
   * Treasury invariant: the user is charged exactly actualImpetus, never more.
   * This replaces the naive spend(all) + lose(delta) pattern.
   */
  settle(signaIds: string[], actualImpetus: bigint, actumId: string): Promise<void>
  /**
   * Bulk-insert signa produced by Nexus hooks.
   * Each entry gets a generated id, status: 'valid', and natum: new Date().
   * Returns the fully-hydrated Signum records in insertion order.
   */
  createMany(signa: Array<Omit<Signum, 'id' | 'natum' | 'status'>>): Promise<Signum[]>
}
