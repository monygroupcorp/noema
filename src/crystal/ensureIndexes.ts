import type { Db } from 'mongodb'

/**
 * Creates all indexes for noemaplane.* collections.
 * Idempotent — safe to call on every boot. MongoDB skips existing indexes.
 */
export async function ensureIndexes(db: Db): Promise<void> {
  await Promise.all([
    // acta — execution ledger
    db.collection('acta').createIndex({ id: 1 }, { unique: true }),
    db.collection('acta').createIndex({ externusJobId: 1 }, { sparse: true }),
    db.collection('acta').createIndex({ status: 1, expirat: 1 }),

    // modi — modus/spell registry
    db.collection('modi').createIndex({ id: 1, versio: 1 }, { unique: true }),

    // signa — credit ledger
    db.collection('signa').createIndex({ id: 1 }, { unique: true }),
    db.collection('signa').createIndex({ animaId: 1, status: 1 }),
    db.collection('signa').createIndex({ testis: 1, forma: 1 }, { sparse: true }),
    // reserve selection (ledger-hardening Debt #1): index-backed smallest-first `sort({ valorNum:1 })`
    // over an identity's valid pool, so `reserve` pulls ~O(k) coins instead of loading the whole pool.
    // The identified path keys on animaId; the anonymous (arcanum) path keys on (testis,forma).
    db.collection('signa').createIndex({ animaId: 1, status: 1, valorNum: 1 }),
    db.collection('signa').createIndex({ testis: 1, forma: 1, status: 1, valorNum: 1 }, { sparse: true }),
    // Fiat funding rail (Stripe) idempotency: UNIQUE + PARTIAL on `testis` over stripe-purchase
    // signa ONLY. `testis` = the Stripe payment_intent id shared by a purchase's two webhook events
    // (checkout.session.completed + payment_intent.succeeded). This is the DURABLE cross-instance
    // guard that a redelivered/concurrent Stripe payment mints impetus exactly once: the second
    // issue() throws a dup-key error → the credit helper catches it → replays the original credit.
    // Scoped to auctor:'stripe:purchase' so no other signa (whose testis is a tx hash / commitment /
    // empty, not globally unique) are constrained.
    db.collection('signa').createIndex({ testis: 1 }, { unique: true, partialFilterExpression: { auctor: 'stripe:purchase' } }),
    // On-chain deposit rail (noema-027) idempotency: UNIQUE + PARTIAL on `testis` over
    // alchemy-webhook signa ONLY. `testis` = the deposit tx hash. This is the DURABLE cross-instance
    // guard that a retry sweep tick racing an Alchemy webhook re-delivery credits the same deposit
    // EXACTLY ONCE: the second issue() throws a dup-key → creditConfirmedDeposit catches it → replays
    // the winner's credit instead of double-minting. Scoped to auctor:'alchemy-webhook' (peer of the
    // stripe-purchase guard above) so no other signa are constrained.
    // Explicit name: a second unique-partial index on the SAME key { testis:1 } as the
    // stripe-purchase guard above would otherwise auto-name to the same `testis_1` and collide.
    db.collection('signa').createIndex(
      { testis: 1 },
      { name: 'testis_alchemy_deposit', unique: true, partialFilterExpression: { auctor: 'alchemy-webhook' } },
    ),
    // Stripe refund clawback (noema-082) idempotency: UNIQUE + PARTIAL on `testis` over
    // stripe-REFUND debit signa ONLY. `testis` = the Stripe refund event id. This is the DURABLE
    // cross-instance guard that a redelivered `charge.refunded` claws back (mints ONE negative-valor
    // debit signum) EXACTLY ONCE: the second issue() throws a dup-key → the refund helper catches it
    // → replays the winner's debit instead of double-clawing. Scoped to auctor:'stripe:refund' (peer
    // of the stripe-purchase + alchemy-deposit guards above). Explicit name: a THIRD unique-partial
    // index on the SAME key { testis:1 } would otherwise auto-name to `testis_1` and collide.
    db.collection('signa').createIndex(
      { testis: 1 },
      { name: 'testis_stripe_refund', unique: true, partialFilterExpression: { auctor: 'stripe:refund' } },
    ),
    // Legacy account migration (noema-130) idempotency: UNIQUE + PARTIAL on `testis` over the
    // migration's consolidated balance signa ONLY. `testis` = 'migration:<masterAccountId>' — one
    // per migrated legacy account. This is the DURABLE cross-instance guard that a re-run of
    // migrate-accounts-chunk.ts NEVER double-mints a user's balance: the second issue() for an
    // already-migrated account throws a dup-key → the script catches E11000 and skips it. Scoped to
    // auctor:'migration:legacy' (peer of the stripe-purchase / alchemy-deposit / stripe-refund guards
    // above). Explicit name: a fourth unique-partial index on the SAME key { testis:1 } would
    // otherwise auto-name to `testis_1` and collide.
    db.collection('signa').createIndex(
      { testis: 1 },
      { name: 'testis_migration_legacy', unique: true, partialFilterExpression: { auctor: 'migration:legacy' } },
    ),

    // animae — soul / identity
    db.collection('animae').createIndex({ id: 1 }, { unique: true }),
    db.collection('animae').createIndex({ custos: 1 }, { sparse: true }),
    // Legacy account migration (noema-130): UNIQUE + PARTIAL on `legacyMasterAccountId` over migrated
    // animae ONLY, so the anima upsert keyed on the legacy masterAccountId is idempotent — a re-run
    // of migrate-accounts-chunk.ts resolves the existing anima instead of forking a second soul for
    // the same legacy user. Partial (only rows that carry the provenance field) so native crystal
    // animae are unconstrained.
    db.collection('animae').createIndex(
      { legacyMasterAccountId: 1 },
      { unique: true, partialFilterExpression: { legacyMasterAccountId: { $exists: true } } },
    ),

    // migration_ledger_claims — legacy account migration (noema-130) GLOBAL ledger-row de-dup.
    // One doc per legacy `credit_ledger` row that has been attributed to a migrated account:
    // `_id` = the legacy ledger row's `_id` (string), plus the claiming masterAccountId/animaId. The
    // UNIQUE `_id` is the DURABLE cross-chunk guard that the SAME confirmed deposit is never minted
    // into two consolidated Signa: legacy does not enforce a 1:1 wallet→account, so a wallet listed on
    // two accounts would otherwise let both accounts' transforms sum that wallet's deposits. Before
    // minting, migrate-accounts-chunk.ts claims each attributed row here; a row already owned by a
    // DIFFERENT account is a collision → that account is NOT committed (routed to the review report).
    // (`_id` is unique by nature; this explicit no-op index line documents the collection's contract.)
    db.collection('migration_ledger_claims').createIndex({ masterAccountId: 1 }),

    // personae — platform mask (hot path: every inbound message)
    db.collection('personae').createIndex({ genus: 1, externusId: 1 }, { unique: true }),
    db.collection('personae').createIndex({ animaIds: 1 }),

    // vestigia — RAG traces (Atlas Vector Search index managed separately in Atlas UI)
    db.collection('vestigia').createIndex({ 'auctorKey.animaId': 1 }, { sparse: true }),

    // modos — GPU sessions
    db.collection('modos').createIndex({ id: 1 }, { unique: true }),
    db.collection('modos').createIndex({ status: 1 }),

    // mandatores — standing agent instructions
    db.collection('mandatores').createIndex({ id: 1 }, { unique: true }),
    db.collection('mandatores').createIndex({ status: 1, _nextFire: 1 }, { sparse: true }),

    // corpora — training datasets
    db.collection('corpora').createIndex({ id: 1 }, { unique: true }),

    // collectiones — batch containers
    db.collection('collectiones').createIndex({ id: 1 }, { unique: true }),
    // The owner-scoped listing (`MongoCollectio.listOwned`, behind `GET /v1/collectiones`) is a
    // per-caller read, so its access predicate is in the query and these back it: one index per
    // arm of that predicate, each carrying the (natum, id) page sort so a page is a bounded
    // index walk rather than a scan of every tenant's collections.
    db.collection('collectiones').createIndex({ 'by.animaId': 1, natum: -1, id: -1 }, { sparse: true }),
    db.collection('collectiones').createIndex({ 'by.commitment': 1, natum: -1, id: -1 }, { sparse: true }),
    db.collection('collectiones').createIndex({ sodalitasId: 1, natum: -1, id: -1 }, { sparse: true }),
    // The CollectioCursor's dispatch scan (`listByStatus('agens')`).
    db.collection('collectiones').createIndex({ status: 1 }),

    // tabulae — canvas workspaces
    db.collection('tabulae').createIndex({ id: 1 }, { unique: true }),
    db.collection('tabulae').createIndex({ templateId: 1 }, { sparse: true }),

    // testimonia — NFT attestations
    db.collection('testimonia').createIndex({ id: 1 }, { unique: true }),
    db.collection('testimonia').createIndex({ possessor: 1, contractus: 1 }),
    db.collection('testimonia').createIndex({ animaId: 1, status: 1 }),

    // deposita — onchain deposits
    db.collection('deposita').createIndex({ id: 1 }, { unique: true }),
    db.collection('deposita').createIndex({ transactioHash: 1, chainId: 1 }, { sparse: true }),
    // The retry sweep (noema-027) scans parked deposits by status every DEPOSIT_SWEEP_INTERVAL_MS.
    db.collection('deposita').createIndex({ status: 1 }),

    // reditus — USD revenue book (ADR-0013). The UNIQUE PARTIAL index on depositumId is the
    // deposit-booking idempotency guard (only over rows that have one; fiat rows omit it). The
    // natum index bounds the trailing-12mo revenue range-scan. Mirrors MongoRedituum.ensureIndexes().
    db.collection('reditus').createIndex({ id: 1 }, { unique: true }),
    db.collection('reditus').createIndex({ depositumId: 1 }, { unique: true, partialFilterExpression: { depositumId: { $exists: true } } }),
    // Fiat idempotency (peer of the signa stripe-purchase guard): UNIQUE PARTIAL on chargeRef over
    // FIAT rows so a redelivered/concurrent Stripe payment books revenue exactly once. Mirrors
    // MongoRedituum.ensureIndexes().
    db.collection('reditus').createIndex({ chargeRef: 1 }, { unique: true, partialFilterExpression: { origo: 'fiat', chargeRef: { $exists: true } } }),
    // Refund clawback (noema-082): UNIQUE PARTIAL on `reversalOf` over contra-rows so a redelivered
    // charge.refunded un-recognizes revenue exactly once (one contra-row per original reditus).
    // Mirrors MongoRedituum.ensureIndexes().
    db.collection('reditus').createIndex({ reversalOf: 1 }, { unique: true, partialFilterExpression: { reversalOf: { $exists: true } } }),
    db.collection('reditus').createIndex({ natum: 1 }),

    // solutiones — payment settlements
    db.collection('solutiones').createIndex({ id: 1 }, { unique: true }),

    // petitiones — payment requests
    db.collection('petitiones').createIndex({ id: 1 }, { unique: true }),
    db.collection('petitiones').createIndex({ animaId: 1, status: 1 }),

    // scholia — community annotations
    db.collection('scholia').createIndex({ id: 1 }, { unique: true }),
    db.collection('scholia').createIndex({ targetType: 1, targetId: 1 }),

    // colloquia — conversation threads
    db.collection('colloquia').createIndex({ id: 1 }, { unique: true }),
    db.collection('colloquia').createIndex({ animaId: 1, status: 1 }),

    // dicta — conversation turns
    db.collection('dicta').createIndex({ id: 1 }, { unique: true }),
    db.collection('dicta').createIndex({ colloquiumId: 1, natum: 1 }),

    // querelae — bug/feature/feedback reports
    db.collection('querelae').createIndex({ id: 1 }, { unique: true }),
    db.collection('querelae').createIndex({ ownerKey: 1, natum: -1 }),
    db.collection('querelae').createIndex({ ownerKey: 1, contentHash: 1 }),
    // Per-turn idempotency (noema-095, MONEY CODE): the AGENT Dictum is the atomic per-turn CHARGE
    // GATE. UNIQUE PARTIAL on (colloquiumId, turnKey) over AGENT dicta ONLY — the settle/debit runs
    // only AFTER this insert succeeds, so two concurrent `POST /dicta` sharing a caller-supplied
    // turnKey (e.g. a client-timeout retry racing the still-in-flight original) may BOTH run the
    // read-only agent but only ONE can persist the agent Dictum and therefore only ONE can charge:
    // the loser's insert throws a dup-key error → the router releases its reservation and returns the
    // winner's turn instead of a SECOND reserve→settle (Signorum rail) / Bursa debit. The `turnKey`
    // is shared by the turn's USER Dictum too, so the guard MUST be genus-scoped to 'agent' (else a
    // normal turn's agent-Dictum insert would collide with its own user Dictum). This is the DURABLE
    // cross-instance guard mirroring the mercedes `sourceRef` / reditus `depositumId` discipline —
    // MongoDictum.ensureIndexes() declares the same index for parity.
    db.collection('dicta').createIndex(
      { colloquiumId: 1, turnKey: 1 },
      { name: 'turnkey_agent_charge_gate', unique: true, partialFilterExpression: { genus: 'agent', turnKey: { $exists: true } } },
    ),

    // memoriae — distilled agent memory (one per anima)
    db.collection('memoriae').createIndex({ animaId: 1 }, { unique: true }),

    // partnerRequests — B2B partner program intake queue
    db.collection('partnerRequests').createIndex({ id: 1 }, { unique: true }),
    db.collection('partnerRequests').createIndex({ status: 1, natum: -1 }),
    db.collection('partnerRequests').createIndex({ emailKey: 1, natum: -1 }),
    db.collection('partnerRequests').createIndex({ animaId: 1, natum: -1 }),

    // partners — approved B2B partner accounts (one per animaId)
    db.collection('partners').createIndex({ animaId: 1 }, { unique: true }),

    // materiae — GPU pod records
    db.collection('materiae').createIndex({ id: 1 }, { unique: true }),
    db.collection('materiae').createIndex({ status: 1, imageRef: 1 }),
    // The idle reaper's drain-deadline arm, swept every 30s and status-blind, so the
    // status index above cannot serve it.
    db.collection('materiae').createIndex({ drainOnly: 1, drainUntil: 1 }),

    // deployments — content-addressed compiled specs
    db.collection('deployments').createIndex({ hash: 1 }, { unique: true }),

    // intellae — deploy-time model registry
    db.collection('intellae').createIndex({ id: 1 }, { unique: true }),
    db.collection('intellae').createIndex({ canonica: 1 }),
    db.collection('intellae').createIndex({ genus: 1 }),
    db.collection('intellae').createIndex({ genus: 1, familia: 1 }),  // triggerMap/findByTrigger key on (genus,familia)

    // fundamenta — compute-substrate registry (ADR-0005), resolved by (id, versio)
    db.collection('fundamenta').createIndex({ id: 1, versio: 1 }, { unique: true }),
    db.collection('fundamenta').createIndex({ canonica: 1 }),

    // arcanum_leaves — ZK Merkle tree leaf records
    db.collection('arcanum_leaves').createIndex({ leafIndex: 1 }, { unique: true }),
    db.collection('arcanum_leaves').createIndex({ commitment: 1 }, { unique: true }),

    // arcanum_nullifiers — spent note registry (double-spend prevention)
    db.collection('arcanum_nullifiers').createIndex({ nullifierHash: 1 }, { unique: true }),

    // caeremonia_slots — ceremony contributor-slot requests (deduped by contact)
    db.collection('caeremonia_slots').createIndex({ contact: 1 }, { unique: true }),

    // trusted_issuers — federated JWKS SSO allow-list (ADR-0011 §4), iss lookup is hot
    db.collection('trusted_issuers').createIndex({ issuerId: 1 }, { unique: true }),

    // legati — agent sidecars (ADR-0011 §5); agentId is the provisioning idempotency key
    db.collection('legati').createIndex({ agentId: 1 }, { unique: true }),
    db.collection('legati').createIndex({ id: 1 }, { unique: true }),
    // adapter = the ERC-8004 collection contract — the collection gallery scans by it (§7)
    db.collection('legati').createIndex({ adapter: 1 }, { sparse: true }),

    // mercedes — payee-payout book (ADR-0013 §4c). Unique sourceRef = per-event accrual
    // idempotency; (payeeAnimaId, taxYear) bounds the $600 annual-rollup scan.
    db.collection('mercedes').createIndex({ id: 1 }, { unique: true }),
    db.collection('mercedes').createIndex({ sourceRef: 1 }, { unique: true }),
    db.collection('mercedes').createIndex({ payeeAnimaId: 1, taxYear: 1 }),

    // x402_payment_log — the unique signatureHash IS the replay guard (ADR-0011 §5)
    db.collection('x402_payment_log').createIndex({ signatureHash: 1 }, { unique: true }),
    db.collection('x402_payment_log').createIndex({ payer: 1 }),
    db.collection('x402_payment_log').createIndex({ status: 1, verifiedAt: -1 }),

    // sponsiones — sponsorship pledges (ADR-0011 §2); the sweeper scans by status
    db.collection('sponsiones').createIndex({ id: 1 }, { unique: true }),
    db.collection('sponsiones').createIndex({ status: 1 }),
    db.collection('sponsiones').createIndex({ 'sponsor.animaId': 1 }),

    // bursarium — owned purses carry an ownerAnimaId for the creator dashboard (§7 delegation-via-Bursa)
    db.collection('bursarium').createIndex({ ownerAnimaId: 1 }, { sparse: true }),
  ])
}
