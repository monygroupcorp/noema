// =============================================================================
// CATENA — the onchain secondary crystal
// =============================================================================
//
// "Catena" = chain, series, sequence (Latin, 1st declension feminine).
// In classical Latin, a catena was both a literal chain (binding) and a logical
// chain of reasoning. Here: the blockchain network and its interactions.
//
// The onchain crystal describes what happens BEFORE a Signum is issued.
// It is the detection and receipt layer between on-chain events and the
// Signorum ledger. Once processed, these records produce Signa.
//
// LAYER BOUNDARIES:
//   Blockchain event
//     → Depositum (detect + confirm ETH transfer to CreditVault)
//     → Signorum.issue({ forma: 'eth', ... })   ← crystal boundary
//
//   HTTP 402 payment header
//     → Solutio (validate x402 receipt)
//     → Signorum.issue({ forma: 'x402', ... })  ← crystal boundary
//
//   Wallet link request
//     → Petitio (track magic-amount expectation)
//     → Depositum matched on valor + confirmata
//
// PRIVACY: Petitio carries animaId (the identified side initiates the link).
// Depositum carries optional animaId only after a confirmed link. The vault
// address and transaction hash are public but not identity-linked at rest.
//
// Latin declensions used:
//   Catena     (1st decl. f.)   — catenae, cataenarum
//   Depositum  (2nd decl. n.)   — deposita, depositorum
//   Solutio    (3rd decl. f.)   — solutiones, solutionum
//   Petitio    (3rd decl. f.)   — petitiones, petitionum
// =============================================================================

// ---------------------------------------------------------------------------
// Catena — chain/network descriptor
// ---------------------------------------------------------------------------

export type CatenaGenus =
  | 'evm'       // Ethereum-compatible chain
  | 'solana'    // Solana
  | 'cosmos'    // Cosmos SDK chain

/**
 * Catena — a blockchain network descriptor.
 *
 * The registry of chains the platform supports for onchain interactions.
 * All addresses, RPCs, and explorer URLs are keyed here — not hardcoded.
 */
export interface Catena {
  /** EVM chainId (number) or chain identifier string for non-EVM */
  chainId: number | string
  /** Human name — 'ethereum', 'base', 'base-sepolia' */
  nomen: string
  genus: CatenaGenus
  /** RPC endpoint for this chain */
  rpc?: string
  /** Block explorer base URL — e.g. 'https://etherscan.io' */
  explorator?: string
  /**
   * The CreditVault address on this chain.
   * FK conceptually — the address is the key, not a stored record id.
   * Mainnet + Base: 0x00000001152D633eb2AC3Cf91eac9994aEEFc021
   */
  creditVaultAddress?: string
}

/** "Catenarum" — genitive plural. The chain registry. */
export interface Catenarum {
  find(chainId: number | string): Promise<Catena | null>
  list(): Promise<Catena[]>
}

// ---------------------------------------------------------------------------
// Depositum — a detected CreditVault deposit
// ---------------------------------------------------------------------------

export type DepositumStatus =
  | 'detectum'      // transaction seen in mempool or block, not yet confirmed
  | 'confirmatum'   // sufficient block confirmations
  | 'processatum'   // converted to a Signum in the ledger
  | 'praesolutum'   // settled on the pre-cutover plane — recorded here, never credited here
  | 'fractum'       // processing failed — no Signum issued

/**
 * Praesolutio — the record of a deposit that was priced and credited on the PRE-CUTOVER plane.
 * "praesolutio" = a discharge made beforehand (Latin, 3rd decl. f., from praesolvere).
 *
 * A `praesolutum` Depositum is a HISTORICAL RECORD, not a claim. The funder was credited by the
 * earlier stack at receipt; the fields below are that stack's own numbers, carried across so this
 * plane can see what happened without reaching into the earlier ledger. Nothing here is a balance
 * and nothing here is spendable — writing it moves no points and issues no Signum.
 *
 * The money-bearing values are decimal STRINGS, not bigints: they are provenance, never an input
 * to this plane's credit math, and `MongoDepositum.toDoc` serializes only the top-level bigints
 * (`valor`, `usdFmv`) — a nested bigint would not survive the driver. Every numeric field is
 * optional and is stored ABSENT when the source record does not carry it; none is ever invented.
 */
export interface Praesolutio {
  /** Identifier of the pre-cutover credit-ledger row that settled this deposit. */
  ledgerRef: string
  /** Points credited on the pre-cutover plane at the time, as that ledger recorded them. */
  punctaCredita?: string
  /** Gross USD basis given at the time, in MICRO-USD, as a decimal string. */
  grossUsdFmv?: string
  /** Gross USD after the deposit-side adjustment, in MICRO-USD, as a decimal string. */
  adjustedGrossUsdFmv?: string
  /** USD credited to the funder at the time, in MICRO-USD, as a decimal string. */
  creditedUsd?: string
  /** The funding rate applied at the time, as the pre-cutover ledger recorded it. */
  fundingRate?: number
  /** When this record was completed onto the Depositum. */
  recordatum: Date
}

/**
 * Depositum — a detected on-chain deposit to CreditVault.
 * "depositum" = a trust, a thing deposited for safekeeping (Latin, 2nd decl. n.)
 *
 * Represents one ETH (or token) transfer to the platform vault address.
 * Created when the chain watcher sees a qualifying transaction.
 * Lives between detection and Signum issuance — once processatum, signumId is set.
 */
export interface Depositum {
  id: string
  chainId: number | string
  /** On-chain transaction hash */
  transactioHash: string
  /** The sending wallet address — "ab" = from in Latin */
  ab: string
  /** The receiving vault address */
  ad: string
  /** Amount in base units (wei for ETH, token decimals for ERC-20) */
  valor: bigint
  /**
   * The deposited asset's token address as the webhook decoded it — the ERC-20 contract, with
   * ETH carried as the webhook's existing sentinel. Persisted at receipt so a later retry sweep
   * can re-derive the per-asset funding-rate haircut WITHOUT re-decoding the on-chain log.
   * Absent on legacy rows that predate this field (their heal path is a fresh webhook re-delivery,
   * whose payload carries the token). Money-record field — see noema-027.
   */
  token?: string
  /**
   * Receipt-time gross USD fair-market value in MICRO-USD (bigint; $1 = 1_000_000n) — the SAME
   * number booked to the peer `Reditus` at receipt (ADR-0013 §2). Persisted so the retry sweep
   * credits from this frozen basis and NEVER re-prices (credit basis therefore always equals the
   * already-booked revenue). Absent on OFAC-quarantined (`fractum`) rows — no FMV is stamped on
   * funds we refuse — and on legacy rows predating this field. Money-record field — see noema-027.
   */
  usdFmv?: bigint
  /** Number of block confirmations at last check */
  confirmationes: number

  /**
   * FK → Anima. Set if the sending wallet is linked to a known anima.
   * Absent until wallet link is resolved.
   */
  animaId?: string
  /**
   * FK → Signum. Set when this deposit is converted to a ledger entry.
   * Presence indicates status === 'processatum'.
   */
  signumId?: string
  /**
   * FK → Petitio. Set if this deposit fulfilled a magic-amount link request.
   */
  petitioId?: string

  /**
   * Present ONLY on a `praesolutum` row: the pre-cutover settlement that already discharged this
   * deposit. Its presence is the evidence that this plane owes nothing on the row — see
   * `isSettledDepositum` in `src/api/webhooks/alchemyWebhook.ts`, which is what keeps every
   * processing path off it.
   */
  praesolutio?: Praesolutio

  status: DepositumStatus
  /** "natum" = detected/born */
  natum: Date
  /** "processatum" = when this became a Signum */
  processatum?: Date
}

/** "Depositorum" — genitive plural. The deposit store. */
export interface Depositorum {
  find(id: string): Promise<Depositum | null>
  findByHash(transactioHash: string, chainId: number | string): Promise<Depositum | null>
  list(filter?: Partial<Pick<Depositum, 'status' | 'animaId'>>): Promise<Depositum[]>
  create(depositum: Omit<Depositum, 'id' | 'natum'>): Promise<Depositum>
  update(
    id: string,
    // `usdFmv`/`token` are patchable so the webhook can FREEZE the receipt-time basis onto a row that
    // was first parked UNpriceable and prices on a later re-delivery (noema-027 v5) — every subsequent
    // delivery then reads one persisted basis instead of re-pricing at fresh spot.
    patch: Partial<Pick<Depositum, 'status' | 'confirmationes' | 'animaId' | 'signumId' | 'petitioId' | 'processatum' | 'usdFmv' | 'token'>>
  ): Promise<Depositum>
}

// ---------------------------------------------------------------------------
// Solutio — x402 payment receipt
// ---------------------------------------------------------------------------

export type SolutioStatus =
  | 'recepta'       // received, not yet validated on-chain
  | 'validata'      // payment confirmed valid
  | 'processata'    // converted to a Signum
  | 'invallida'     // validation failed — rejected

/**
 * Solutio — an x402 payment receipt.
 * "solutio" = solution, discharge of debt, payment (Latin, 3rd decl. f.)
 *
 * x402 is the HTTP payment protocol. The client pays via an L2 transaction
 * and includes a signed receipt in the X-Payment header. The platform
 * validates the receipt and issues a Signum for the credited amount.
 *
 * Network: Base (L2 — fast finality, low fees, suited to micropayments)
 */
export interface Solutio {
  id: string
  /** x402 scheme identifier — typically 'exact' */
  schema: string
  /** Chain identifier — e.g. 'base', 'base-sepolia' */
  network: string
  /** Raw receipt payload from X-Payment header (hex or base64) */
  payload: string
  /**
   * The address that authorized/signed this payment.
   * "authoritas" = authority, power of authorization in Latin.
   */
  authoritas: string
  /** Amount authorized, in base units (USDC: 6 decimals) */
  valor: bigint

  /** FK → Signum. Set when processed. */
  signumId?: string
  /** FK → Anima. The identity that submitted this payment. */
  animaId?: string

  status: SolutioStatus
  natum: Date
  processata?: Date
}

/** "Solutionum" — genitive plural. The x402 receipt store. */
export interface Solutionum {
  find(id: string): Promise<Solutio | null>
  create(solutio: Omit<Solutio, 'id' | 'natum'>): Promise<Solutio>
  update(
    id: string,
    patch: Partial<Pick<Solutio, 'status' | 'signumId' | 'processata'>>
  ): Promise<Solutio>
}

// ---------------------------------------------------------------------------
// Petitio — wallet link request (magic-amount flow)
// ---------------------------------------------------------------------------

export type PetitioStatus =
  | 'expectans'     // waiting — user has not yet sent the magic amount
  | 'detecta'       // matching deposit detected, awaiting confirmations
  | 'confirmata'    // confirmed — wallet is now linked to anima
  | 'expirata'      // window expired — no matching deposit found in time

/**
 * Petitio — a wallet link request via the magic-amount flow.
 * "petitio" = application, request, seeking (Latin, 3rd decl. f.)
 *
 * The magic-amount flow: the platform assigns a unique micro-amount (valuta)
 * to the user. The user sends exactly that amount to the CreditVault address.
 * The platform detects the exact amount, proving wallet ownership without
 * requiring a signature — works with any wallet that can send a transfer.
 *
 * PRIVACY NOTE: Petitio is on the identified side. animaId is required —
 * the user is explicitly linking a public wallet to their identity.
 */
export interface Petitio {
  id: string
  /** FK → Anima. Who is requesting the wallet link. */
  animaId: string
  /** The chain on which the user should send */
  chainId: number | string
  /**
   * The exact micro-amount to send (in wei).
   * "valuta" = value/worth (from valere, to be strong/worth).
   * Unique per request — the uniqueness is the proof.
   */
  valuta: bigint
  /**
   * The CreditVault address to send to.
   * "ad" = to/toward in Latin.
   */
  ad: string

  status: PetitioStatus

  /** FK → Depositum. Set when matching deposit is detected. */
  depositumId?: string
  /** The linked wallet address. Set when status reaches 'confirmata'. */
  walletAddress?: string

  natum: Date
  /** When this request expires — unmatched deposits after this are ignored */
  expirat: Date
  confirmata?: Date
}

/** "Petitionum" — genitive plural. The wallet link request store. */
export interface Petitionum {
  find(id: string): Promise<Petitio | null>
  findExpectans(animaId: string): Promise<Petitio | null>
  create(petitio: Omit<Petitio, 'id' | 'natum'>): Promise<Petitio>
  update(
    id: string,
    patch: Partial<Pick<Petitio, 'status' | 'depositumId' | 'walletAddress' | 'confirmata'>>
  ): Promise<Petitio>
  /** Expire all petitiones whose expirat has passed and status is still 'expectans' */
  expireStale(at: Date): Promise<number>
}

// ---------------------------------------------------------------------------
// Testimonium — NFT ownership attestation
// ---------------------------------------------------------------------------
//
// Proves that a wallet address owns a specific NFT token, and binds that
// proof to an Anima. Used for agent registration in NFT-gated fleets.
//
// Flow:
//   1. Agent submits ownership proof (signature or balanceOf check)
//   2. Testimonium created with status 'pendente'
//   3. Chain watcher confirms token ownership on-chain → status 'confirmatum'
//   4. Ring issues a tessera Signum scoped to the agent's session — the
//      tessera IS the access credential for the duration of the session
//
// Unlike Petitio (one-time wallet link), a Testimonium can be re-verified:
// NFT ownership may change hands. Re-verification resets session access.
// ---------------------------------------------------------------------------

export type TestimoniumGenus =
  | 'signature'   // agent signed a challenge with the holding wallet
  | 'balanceOf'   // platform queried ERC-721/1155 balanceOf on-chain

export type TestimoniumStatus =
  | 'pendente'      // submitted, awaiting on-chain confirmation
  | 'confirmatum'   // ownership confirmed — tessera may be issued
  | 'invalidatum'   // ownership check failed or token transferred away

/**
 * Testimonium — an NFT ownership attestation.
 * "testimonium" = evidence, proof, witness (Latin, 2nd decl. n.)
 *
 * The agent proves ownership of a specific token on a specific contract.
 * Once confirmed, the holding anima gains session-scoped access credentials
 * (a tessera Signum) proportional to whatever the fleet admin has granted.
 */
export interface Testimonium {
  id: string
  chainId: number | string
  /**
   * The NFT contract address.
   * "contractus" = agreement, contract (Latin, 4th decl. m.)
   * Supports ERC-721 and ERC-1155.
   */
  contractus: string
  /**
   * The specific token ID — stored as string to support uint256 range.
   */
  tokenId: string
  /**
   * The wallet address asserting ownership.
   * "possessor" = owner, holder (Latin agent noun from possidere).
   */
  possessor: string
  /** FK → Anima. The anima bound to this ownership proof. */
  animaId: string

  genus: TestimoniumGenus
  /**
   * The on-chain proof.
   * For 'signature': the hex signature of the challenge message.
   * For 'balanceOf': the transaction hash of the confirming query block.
   */
  testis: string

  status: TestimoniumStatus
  natum: Date
  confirmatum?: Date
}

/** "Testimonia" — nominative/accusative plural of testimonium */
export type Testimonia = Testimonium[]

/**
 * Testimoniorum — genitive plural "of the attestations."
 * The NFT ownership proof store.
 */
export interface Testimoniorum {
  find(id: string): Promise<Testimonium | null>
  /** Look up current attestation for a wallet × contract combination */
  findByPossessor(possessor: string, contractus: string): Promise<Testimonium | null>
  /** All confirmed attestations for an anima — their full NFT access set */
  listByAnima(animaId: string): Promise<Testimonia>
  create(testimonium: Omit<Testimonium, 'id' | 'natum'>): Promise<Testimonium>
  update(
    id: string,
    patch: Partial<Pick<Testimonium, 'status' | 'confirmatum'>>
  ): Promise<Testimonium>
}
