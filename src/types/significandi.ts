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
  commitment?: string

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

  /**
   * Generic "context" identifier for hook-issued signa — what THING this signum
   * was emitted in the context of. Set by hostCutHook + hospitiumHook to the
   * `materiamId` of the run, so `/status` can sum per-studio earnings and the
   * bulletin earnings panel can render per-studio nets. NOT identity (it's a
   * Materia.id), so privacy invariants are untouched. Free-form by design —
   * future hooks may use it for other resource ids (modusId, intellaId, etc.).
   */
  contextId?: string
}

/** "Signa" — nominative/accusative plural. Your credits. */
export type Signa = Signum[]

/**
 * Reservatio — the outcome of an atomic `reserve`.
 * On success: the ids of the signa now locked against the actum, and their summed valor
 * (`locked >= amount`, greedy overshoot refunded at settle time).
 * On failure: `available` — the valor the identity could actually cover (< amount);
 * everything this call locked has been released. Every failure fails closed (deny, never overpay).
 */
export type Reservatio =
  | { ok: true; signaIds: string[]; locked: bigint }
  | { ok: false; available: bigint }

/**
 * Transferatio — the outcome of a `transfer`. `ok:false` carries the sender's coverable
 * `available` when it was short (no money moved — the transfer is all-or-nothing).
 */
export type Transferatio =
  | { ok: true }
  | { ok: false; available: bigint }

/**
 * One earning stream's lifetime total for an identity — the grouped result of a real
 * server-side aggregation, never a sum taken over a loaded history.
 */
export interface EarningTotal {
  /** The issuing hook's auctor (`nexus:spellRoyalty`, `nexus:hostCut`, ...). */
  auctor: string
  /** Everything this stream has ever paid the identity, in impetus points. */
  impetus: bigint
  /** How many times it paid — one row per run or deposit that earned. */
  count: number
}

/** A page of earning rows, newest first, with the cursor to resume from. */
export interface EarningsPage {
  entries: Signa
  /** Absent on the last page. */
  nextCursor?: string
}

/**
 * Signorum — genitive plural "of the signs."
 * The append-only ledger. No update() method — immutability is the contract.
 */
export interface Signorum {
  /**
   * Current spendable balance.
   * Query by animaId (identified side) or commitment (anonymous side).
   * Returns sum of all valid Signum.valor for the given identity.
   */
  balance(by: { animaId: string } | { commitment: string }): Promise<bigint>
  /**
   * The authorized budget for a Modo session — the sum of VALID `tessera` valor
   * scoped to `modoId` (0n if none). The tessera is the anonymous bearer budget a
   * studio opens with (no animaId/commitment, so it's invisible to `balance`);
   * `Census` reads it to drain-terminate a studio whose accrued spend has crossed
   * its cap. This is the `maxImpetus` watchdog at the session altitude.
   */
  sessionBudget(modoId: string): Promise<bigint>
  /** Issue a new signum — the only write operation besides spend */
  issue(signum: Omit<Signum, 'id' | 'natum' | 'status'>): Promise<Signum>
  /**
   * Reserve signa for a pending actum — status: valid → locked.
   * Prevents double-spend between balance check and completion.
   * Atomic — all or nothing.
   */
  lock(signaIds: string[], actumId: string): Promise<void>
  /**
   * Atomically reserve `amount` worth of an identity's valid signa against `actumId`.
   *
   * The single "debit-if-sufficient" primitive: selects valid signa (greedy, smallest
   * first), locks each with a guarded per-signum write (`status:'valid' → 'locked'` wins at
   * most once), re-reads which now carry this `actumId`, and if still short grabs more /
   * retries against a fresh read. If the identity's valid balance cannot cover `amount`,
   * it releases everything this call locked and returns `{ ok:false, available }`.
   *
   * Overdraw is structurally impossible (each signum locks once, one winner per race) and
   * every failure fails closed. This replaces the race-prone check-then-select-then-lock in
   * callers. `amount <= 0n` is a no-op success with no signa locked.
   */
  reserve(by: { animaId: string } | { commitment: string }, amount: bigint, actumId: string): Promise<Reservatio>
  /**
   * Release locked signa back to valid — called on actum failure.
   * No-op if any signum is already spent (prevents release after settlement).
   */
  release(signaIds: string[]): Promise<void>
  /** Full ledger history for an identity — all signa ever issued */
  history(by: { animaId: string } | { commitment: string }): Promise<Signa>
  /**
   * What this identity has EARNED, per stream, for its whole life on the platform — a
   * grouped sum over the earning auctors (`EARNING_AUCTOR_IDS`) and nothing else. A
   * deposit is not an earning, and the platform's own skim is not this identity's.
   *
   * Sums EVERY status: a royalty the earner has since spent was still earned. Streams
   * that never paid are absent rather than zero, so an empty array means "earned nothing".
   */
  earningTotals(by: { animaId: string } | { commitment: string }): Promise<EarningTotal[]>
  /**
   * The identity's earning rows, newest first, cursor-paginated — the statement behind
   * `earningTotals`. Same auctor allowlist, same all-status rule. Filtered and paged in
   * the store, never by loading `history()` and slicing it in app memory.
   */
  listEarnings(
    by: { animaId: string } | { commitment: string },
    opts: { limit: number; cursor?: string },
  ): Promise<EarningsPage>
  /**
   * Resolve the Stripe fiat-PURCHASE credit signum by its `testis` receipt (the
   * `stripe:<payment_intent>` key), scoped to auctor:'stripe:purchase' — the one auctor whose
   * testis is GLOBALLY unique (guarded by the unique partial index on
   * `testis` where auctor:'stripe:purchase'). Returns that credit Signum (which carries `animaId`)
   * or null when no such credit exists.
   *
   * This is the LEDGER-side anima resolver the refund/dispute webhook path depends on: a real Stripe
   * Charge/Dispute object carries neither `client_reference_id` nor a propagated `metadata.animaId`
   * (only the Checkout Session does), so the disputing/refunded anima is recovered from OUR OWN
   * credit row keyed by the payment_intent instead of from the event (noema-082 round-10).
   */
  findByTestis(testis: string): Promise<Signum | null>
  /**
   * Does this identity own ANY of the given signa? A targeted membership check
   * (`id ∈ signumIds AND owned-by`) — the cheap ownership oracle the API uses to
   * owner-scope a run without loading the identity's whole history. Empty ids → false.
   */
  ownsAny(by: { animaId: string } | { commitment: string }, signumIds: string[]): Promise<boolean>
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
   * First-class inter-account move — spend `amount` from `from` and reissue it to `to`.
   * Built on `reserve` + `settle` (so the sender is debited exactly `amount`, any greedy
   * overshoot refunded to the sender) followed by an `issue` to the recipient. All-or-nothing:
   * if the sender cannot cover `amount`, no money moves and `{ ok:false, available }` is returned.
   *
   * The recipient is always an identified Anima (a platform/treasury/agent account). The credit
   * forma/auctor/testis default to a plain minted transfer and can be overridden via `opts` —
   * this is the primitive that replaces the hand-rolled debit/credit pairs (TEE billing, grants).
   */
  transfer(
    from: { animaId: string } | { commitment: string },
    to: { animaId: string },
    amount: bigint,
    opts?: { auctor?: string; forma?: SignumForma; testis?: string; contextId?: string },
  ): Promise<Transferatio>
  /**
   * Bulk-insert signa produced by Nexus hooks.
   * Each entry gets a generated id, status: 'valid', and natum: new Date().
   * Returns the fully-hydrated Signum records in insertion order.
   */
  createMany(signa: Array<Omit<Signum, 'id' | 'natum' | 'status'>>): Promise<Signum[]>
}
