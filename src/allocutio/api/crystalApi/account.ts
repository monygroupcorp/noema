import type { Appearance, Generatio } from '../../../types/consuetudo.js'
import { MEMORY_NOTE_MAX_CHARS, MEMORY_NOTES_MAX } from '../../../types/consuetudo.js'
import type { IntelligensGenus } from '../../../types/intelligendi.js'
import type { AuctorKey } from '../../../flow/types.js'
import type { ErasureReceipt } from '../../../types/erasure.js'
import { aggregateStatus } from '../../lexicon/status/aggregate.js'
import { Errors, ApiError } from '../errors.js'
import { usdMicroToImpetus } from '../../../ledger/rates.js'
import { fundingBps, applyFundingBps, DEFAULT_FUNDING_BPS } from '../../../ledger/depositFunding.js'
import { ModelImportError, SecretRequiredError } from '../../../crystal/modelImportResolver.js'
import type { SecretProvider } from '../../../types/secretum.js'
import { isSecretProvider, SECRET_PROVIDERS, DEFAULT_SECRET_IDLE_DAYS } from '../../../types/secretum.js'
import { ownerKeyOf } from '../../../crystal/ownerKey.js'
import { classifyModelLicense, activeConditionalLicenses, bindingCapUsd } from '../../../crystal/modelLicense.js'
import { band, bindingCapMicroUsd } from '../../../crystal/licenseTripwire.js'
import { handleStripeCheckout, handleInvoiceCheckout, handleStripeWebhook, type StripeGateway, type StripeWebhookResult } from '../../../api/webhooks/stripeWebhook.js'
import type { PartnerInvoice } from '../../../types/partnerInvoice.js'
import {
  handleProMonthlyCheckout,
  handleProMonthlyWebhook,
  type ProMonthlyGateway,
  type ProMonthlyWebhookResult,
} from '../../../api/webhooks/stripeProMonthlyWebhook.js'
import { stripeConfigFromEnv, makeStripeGateway, makeProMonthlyGateway } from '../../../api/webhooks/stripeGateway.js'
import { packViews, proMonthlyView, type PackView, type ProMonthlyView } from '../../../ledger/stripePacks.js'
import { lookupUseTerms, acceptUseTerms as recordUseTermsAcceptance } from '../../../crystal/useTerms.js'
import { normalizeAddress } from '../../../crystal/walletAuth.js'
import type {
  ImportModelOpts, SetModelLicenseOpts, StatusView, DepositConfig, DepositQuote, MyDeposit,
  RevenueReport, CogsReport, MeView, SecretView, ModelCard,
} from '../CrystalApi.js'
import {
  PLATFORM_ANIMA_ID, ADULT_CONTENT_RATINGS, normalizeCatalogSort, readPublicCatalog, sortCatalog,
  DEANON_WARNING, microUsdToStr, toModelCardFromIntella,
} from './support.js'
import { CrystalApiEditions } from './editions.js'

/** The caller's account: deposits, fiat checkout, secrets, preferences, status, the model catalog and platform reports. */
export abstract class CrystalApiAccount extends CrystalApiEditions {
  /**
   * GDPR Art. 17 right-to-erasure (noema-025) — pseudonymize-and-tombstone the CALLER'S OWN
   * account. Self-only by construction: erases exactly the authenticated `auctor`'s animaId, so a
   * caller can never erase another owner (admin-erase is out of scope). Only an IDENTIFIED soul
   * can be erased — anon (`commitment`/`bursaToken`) callers hold no identified PII, so this is a
   * 403 for them. Delegates the irreversible act to the dedicated, reviewable `MeEraser`; the
   * financial ledger + ZK set are untouched (see MeEraser). Wired only when erasure is enabled.
   */
  async eraseMe(auctor: AuctorKey): Promise<ErasureReceipt> {
    if (!this.deps.eraser) throw Errors.internal('account erasure unavailable')
    if (!('animaId' in auctor)) {
      throw Errors.authForbidden('Only a signed-in account can be erased.')
    }
    return this.deps.eraser.erase(auctor.animaId)
  }

  /**
   * Static config for the buy-points/deposit UI: where to send, the canonical points/USD rate,
   * the default funding rate, and the supported chains. No auth, no oracle call.
   */
  depositConfig(): DepositConfig {
    return {
      depositAddress: this.deps.depositAddress ?? '',
      pointsPerUsd: Number(usdMicroToImpetus(1_000_000n)),        // 1 USD (1e6 µUSD) → impetus ≈ 2967
      defaultFundingRatePct: Number(DEFAULT_FUNDING_BPS) / 100,   // 70
      chains: [{ chainId: 1, name: 'ethereum' }, { chainId: 8453, name: 'base' }],
    }
  }

  /**
   * The PUBLIC credit-pack catalog for DISPLAY (pricing page + Funding). Sourced from the single
   * server-authoritative `stripePacks.PACKS` constant — the one source of truth so a pack-number
   * change there updates every surface. Read-only, no auth, no money mutation: `credits = impetus/10`
   * is a display figure; the CHARGED/credited amount stays keyed by `packId` on the server (webhook
   * credits `PACKS[packId].impetus`), never anything derived from this view.
   */
  listPacks(): PackView[] {
    return packViews()
  }

  /**
   * Quote a deposit: how many impetus points `amount` base units of `token` would buy, right now.
   * INFORMATIONAL — the webhook re-prices and credits authoritatively at deposit time. It reuses the
   * exact same pricer + funding + rate as `alchemyWebhook.creditImpetus`, so `pointsQuoted` equals
   * what the webhook credits for the same input (asserted in tests). Gas is NOT deducted (the webhook
   * doesn't either — see creditImpetus doc); a UI may show network fee as a separate informational line.
   */
  async depositQuote(input: { chainId: number | string; token: string; amount: string }): Promise<DepositQuote> {
    const pricer = this.deps.pricer
    if (!pricer) throw Errors.depositUnavailable()

    const token = String(input.token ?? '')
    if (!/^0x[0-9a-fA-F]{40}$/.test(token)) throw Errors.inputMalformed('token must be a 20-byte hex address (0x000…000 for native ETH)')
    let amountRaw: bigint
    try { amountRaw = BigInt(input.amount) } catch { throw Errors.inputMalformed('amount must be an integer string of base units (wei for ETH, token-decimals for ERC-20)') }
    if (amountRaw <= 0n) throw Errors.inputMalformed('amount must be a positive integer of base units')

    const grossMicroUsd = await pricer.usdFmv(input.chainId, token, amountRaw)
    if (grossMicroUsd === null || grossMicroUsd <= 0n) throw Errors.priceUnavailable()

    const bps = fundingBps(token)
    const points = usdMicroToImpetus(applyFundingBps(grossMicroUsd, bps))
    return {
      chainId: input.chainId,
      token,
      amountRaw: amountRaw.toString(),
      grossUsd: microUsdToStr(grossMicroUsd),
      grossUsdMicro: grossMicroUsd.toString(),
      fundingRatePct: Number(bps) / 100,
      pointsQuoted: points.toString(),
      depositAddress: this.deps.depositAddress ?? '',
    }
  }

  /**
   * The caller's OWN on-chain deposits — scoped to their linked (`'web'`-genus, active) wallet
   * addresses. Powers the settle-watch UI (real depositum status instead of hoping the balance
   * moves). Owner-scoped by construction: a stranger's `animaId` resolves a disjoint wallet set,
   * so this NEVER returns another account's rows (the deposit-attribution fix
   * §Fix 4). An anon/purse `AuctorKey` ({commitment}/{bursaToken}) has no personae → always [].
   *
   * `Depositorum.list()` has no payer/wallet filter (its interface is out of this item's scope) —
   * so we filter in-process by `ab` (the sending address, lowercased) against the caller's linked
   * set. This ALSO surfaces deposits that predate the wallet link (parked `confirmatum`, never
   * animaId-attributed at receipt time), which a filter on `Depositum.animaId` alone would miss.
   */
  async myDeposits(auctor: AuctorKey): Promise<MyDeposit[]> {
    if (!('animaId' in auctor)) return []
    if (!this.deps.deposita || !this.deps.personae) return []

    const personae = await this.deps.personae.findByAnimaId(auctor.animaId)
    const wallets = new Set(
      personae
        .filter(p => p.genus === 'web' && p.activeAnimaId === auctor.animaId)
        .map(p => normalizeAddress(p.externusId))
        .filter((a): a is string => a !== null),
    )
    if (wallets.size === 0) return []

    const all = await this.deps.deposita.list()
    return all
      .filter(d => wallets.has(d.ab.toLowerCase()))
      .sort((a, b) => b.natum.getTime() - a.natum.getTime())
      .map(d => ({
        id: d.id,
        chainId: d.chainId,
        txHash: d.transactioHash,
        valor: d.valor.toString(),
        status: d.status,
        natum: d.natum.toISOString(),
      }))
  }

  // ── Fiat funding rail (Stripe) ──────────────────────────────────────────────

  protected _stripeGateway: StripeGateway | null | undefined

  /** The live Stripe gateway: the injected dep, else built from env, else `null` (unconfigured). */
  protected resolveStripeGateway(): StripeGateway | null {
    if (this._stripeGateway === undefined) {
      if (this.deps.stripe) {
        this._stripeGateway = this.deps.stripe
      } else {
        const config = stripeConfigFromEnv()
        this._stripeGateway = config ? makeStripeGateway(config) : null
      }
    }
    return this._stripeGateway
  }

  /**
   * Create a Stripe Checkout Session for a credit pack. IDENTIFIED-ONLY — a fiat pack cannot
   * fund an anonymous purse (a card de-anonymizes by construction). Returns the hosted-checkout
   * URL. The pack's USD price + packId are server-set, so crediting is server-authoritative
   * regardless of anything the client sends (the webhook credits `PACKS[packId].impetus`).
   */
  async createCheckout(
    auctor: AuctorKey,
    opts: { packId: string; successUrl?: string; cancelUrl?: string; allocutio?: string },
  ): Promise<{ url: string; sessionId: string }> {
    const gateway = this.resolveStripeGateway()
    if (!gateway) throw Errors.paymentsUnavailable()
    const animaId = 'animaId' in auctor ? auctor.animaId : undefined
    const result = await handleStripeCheckout(
      {
        packId: opts.packId,
        animaId,
        ...(opts.successUrl ? { successUrl: opts.successUrl } : {}),
        ...(opts.cancelUrl ? { cancelUrl: opts.cancelUrl } : {}),
        ...(opts.allocutio ? { allocutio: opts.allocutio } : {}),
      },
      { gateway },
    )
    if (!result.ok) throw new ApiError(result.code, result.message, result.status)
    return { url: result.url, sessionId: result.sessionId }
  }

  /**
   * Create a Stripe Checkout Session that SETTLES A B2B INVOICE. The amount is the invoice's own,
   * frozen at issue from the meter; the client sends nothing but the redirect URLs.
   *
   * The caller (`apiRouter`) has already established that this invoice belongs to this partner —
   * this facade takes the invoice itself rather than an id precisely so there is no second,
   * unscoped lookup here that could be reached with somebody else's id.
   */
  async createInvoiceCheckout(
    invoice: PartnerInvoice,
    opts: { successUrl?: string; cancelUrl?: string } = {},
  ): Promise<{ url: string; sessionId: string }> {
    const gateway = this.resolveStripeGateway()
    if (!gateway) throw Errors.paymentsUnavailable()
    const result = await handleInvoiceCheckout(invoice, {
      gateway,
      ...(opts.successUrl ? { successUrl: opts.successUrl } : {}),
      ...(opts.cancelUrl ? { cancelUrl: opts.cancelUrl } : {}),
    })
    if (!result.ok) throw new ApiError(result.code, result.message, result.status)
    return { url: result.url, sessionId: result.sessionId }
  }

  /**
   * Handle a Stripe webhook delivery — signature-gated + idempotent per payment. Returns the
   * HTTP status + body for the router. A bad signature or a non-completed/malformed event is a
   * 400 (never a credit); a redelivery of an already-credited payment is a no-op that replays
   * the original outcome. Throws only for a deployment that has no fiat rail configured (503).
   */
  async handleStripeWebhook(input: { rawBody: string; signature?: string }): Promise<StripeWebhookResult> {
    const gateway = this.resolveStripeGateway()
    if (!gateway || !this.deps.redituum || !this.deps.animae) throw Errors.paymentsUnavailable()
    return handleStripeWebhook(
      { rawBody: input.rawBody, ...(input.signature ? { signature: input.signature } : {}) },
      {
        signorum: this.deps.signorum,
        redituum: this.deps.redituum,
        animae: this.deps.animae,
        gateway,
        ...(this.deps.partnerInvoices ? { partnerInvoices: this.deps.partnerInvoices } : {}),
      },
    )
  }

  // ── Pro Monthly subscription rail (Option B, card fkhqv3) ──────────────────

  protected _proMonthlyGateway: ProMonthlyGateway | null | undefined

  /** The live Pro Monthly gateway: the injected dep, else built from the SAME env config the
   *  pack rail reads, else `null` (unconfigured). */
  protected resolveProMonthlyGateway(): ProMonthlyGateway | null {
    if (this._proMonthlyGateway === undefined) {
      if (this.deps.stripeProMonthly) {
        this._proMonthlyGateway = this.deps.stripeProMonthly
      } else {
        const config = stripeConfigFromEnv()
        this._proMonthlyGateway = config ? makeProMonthlyGateway(config) : null
      }
    }
    return this._proMonthlyGateway
  }

  /** The PUBLIC Pro Monthly plan for DISPLAY (pricing page). Read-only, no auth. */
  listProMonthlyPlan(): ProMonthlyView {
    return proMonthlyView()
  }

  /**
   * Open a Checkout Session (mode: subscription) for the Pro Monthly plan. Identified-only —
   * a fiat subscription cannot fund an anonymous purse, same invariant as a credit pack.
   */
  async createProMonthlyCheckout(
    auctor: AuctorKey,
    opts: { successUrl?: string; cancelUrl?: string },
  ): Promise<{ url: string; sessionId: string }> {
    const gateway = this.resolveProMonthlyGateway()
    if (!gateway) throw Errors.paymentsUnavailable()
    const animaId = 'animaId' in auctor ? auctor.animaId : undefined
    const result = await handleProMonthlyCheckout(
      {
        animaId,
        ...(opts.successUrl ? { successUrl: opts.successUrl } : {}),
        ...(opts.cancelUrl ? { cancelUrl: opts.cancelUrl } : {}),
      },
      { gateway },
    )
    if (!result.ok) throw new ApiError(result.code, result.message, result.status)
    return { url: result.url, sessionId: result.sessionId }
  }

  /**
   * Handle a Pro Monthly webhook delivery — signature-gated; grants are idempotent per invoice
   * and throttle at the fair-use rollover cap. Throws only for a deployment that has no
   * subscription rail configured (503).
   */
  async handleProMonthlyWebhook(input: { rawBody: string; signature?: string }): Promise<ProMonthlyWebhookResult> {
    const gateway = this.resolveProMonthlyGateway()
    if (!gateway || !this.deps.proMonthlySubscriptions) throw Errors.paymentsUnavailable()
    return handleProMonthlyWebhook(
      { rawBody: input.rawBody, ...(input.signature ? { signature: input.signature } : {}) },
      {
        signorum: this.deps.signorum,
        subscriptions: this.deps.proMonthlySubscriptions,
        gateway,
      },
    )
  }

  /** List the canonical compute substrates (fundamenta) an agent can arm a studio on. */
  async listFundamenta(): Promise<Array<{ id: string; nomen?: string; versio: string; runtime?: string; imageId: string; imageVersion: string; vramGb?: number }>> {
    const funds = await this.deps.fundamentorum.list({ canonica: true })
    return funds.map((f) => ({
      id: f.id, versio: f.versio, imageId: f.imageId, imageVersion: f.imageVersion,
      ...(f.nomen ? { nomen: f.nomen } : {}),
      ...(f.runtime ? { runtime: f.runtime } : {}),
      ...(f.vramGb !== undefined ? { vramGb: f.vramGb } : {}),
    }))
  }

  /**
   * The filterable model catalog (the agent twin of the bot's picker): by `genus`
   * (lora/checkpoint/…), `basis` (the base family a weight is for), `fundamentumId`
   * (resolved to the substrate's base family), `trigger` (a LoRA trigger word), and
   * `q` (free text, matched in-memory against nomen/description). Sourced from the
   * populated `intellarum` registry's PUBLIC CATALOG — platform-canonical intellae plus
   * models users have published (`access: 'public'`) — under the public projection (no
   * `access`/`license`/`commercialUse`). Registries without a `publicCatalog` read fall
   * back to `canonical()`. Each result is a card so the agent can decide, not just enumerate.
   *
   * `sort` ('newest' | 'name' | 'genus', default 'newest') orders the result BEFORE the
   * `limit` slice. An unrecognised value falls back to the default rather than erroring.
   *
   * `auctor` (optional): when passed, the search base is the UNION of the public
   * `canonical()` set and that caller's own privately-held models (the same owner
   * scoping `listMyModels` uses), deduped by intella id, then filtered by the
   * q/genus/basis/trigger predicate below — so canonical and owned results are matched
   * identically on every search axis. The one exception is the adult-content gate, which
   * governs listing rather than personal use and so does not apply to records the caller
   * owns; it applies unchanged to everything else. Omitting `auctor` preserves today's
   * public-only behavior for every existing caller (noema-116).
   */
  async listModels(filter: { genus?: IntelligensGenus; basis?: string; fundamentumId?: string; trigger?: string; q?: string; limit?: number; includeAdult?: boolean; sort?: string; auctor?: AuctorKey } = {}): Promise<ModelCard[]> {
    if (!this.deps.intellarum) return []
    const registry = this.deps.intellarum
    let basis = filter.basis
    if (!basis && filter.fundamentumId) {
      const f = await this.deps.fundamentorum.find(filter.fundamentumId).catch(() => null)
      if (f) {
        for (const w of f.intellae ?? []) {
          const wi = await registry.find(w.id).catch(() => null)
          if (wi?.familia) { basis = wi.familia; break }
        }
      }
    }
    let pool = await readPublicCatalog(registry, this._grantSafeguards())
    // Ids the caller owns, captured where the union happens. Empty without `auctor`, so every
    // existing caller's result set is unchanged.
    const ownedIds = new Set<string>()
    if (filter.auctor) {
      const ownerKey = ownerKeyOf(filter.auctor)
      const owned = registry.listByOwner
        ? await registry.listByOwner(ownerKey)
        : (await registry.list()).filter((i) => i.ownerKey === ownerKey || `anima:${i.ownerAnimaId}` === ownerKey)
      for (const i of owned) ownedIds.add(i.id)
      const seen = new Set(pool.map((i) => i.id))
      pool = [...pool, ...owned.filter((i) => !seen.has(i.id))]
    }
    const q = filter.q?.trim()
    // `Intellarum` has no free-text search — filter the pool in-memory for `q`
    // (nomen/description/tags/sample-prompt substring match), same as the old intelligendi
    // store's search() did, widened to also reach style signal carried in tags and samples.
    const base = q
      ? pool.filter((i) =>
          i.nomen.toLowerCase().includes(q.toLowerCase()) ||
          (i.description ?? '').toLowerCase().includes(q.toLowerCase()) ||
          (i.tags ?? []).some((t) => t.tag.toLowerCase().includes(q.toLowerCase())) ||
          (i.samples ?? []).some((s) => (s.prompt ?? '').toLowerCase().includes(q.toLowerCase())),
        )
      : pool
    const trig = filter.trigger?.trim().toLowerCase()
    const hits = base.filter((i) => {
      if (filter.genus && i.genus !== filter.genus) return false
      if (basis && i.familia !== basis) return false
      if (trig) {
        const aliases = (i.trigger ?? '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
        if (!aliases.includes(trig)) return false
      }
      // Adult-content partition (noema-091, on noema-090's `contentRating`). The gated adult set is
      // {suggestive, explicit} (R-and-above, Civitai-analogous) — hidden from the catalog UNLESS the
      // caller has spicyMode on (`includeAdult`, which itself required a recorded 18+ attestation).
      // {untriaged, sfw} (and unrated) are ALWAYS visible, to everyone incl. anon. OFF (the default,
      // `includeAdult` falsy) EXCLUDES the adult set everywhere `listModels` feeds selection — the safe
      // default.
      //
      // The gate governs LISTING, not personal use (`docs/spec/model-import.md` §"Two tiers"): a record the
      // caller owns is on their own shelf and is exempt — an owner reaches their own privately-held
      // models with spicy mode off. The exemption is owner-scoped by construction: `ownedIds` is
      // populated only from the `auctor` union above, so it is empty on the public/anon path and the
      // gate keeps applying, unchanged, to every record the caller does not own. Every other clause
      // (genus/basis/trigger/q) still applies to owned records exactly as before.
      if (
        !filter.includeAdult &&
        !ownedIds.has(i.id) &&
        i.contentRating !== undefined &&
        ADULT_CONTENT_RATINGS.has(i.contentRating)
      ) return false
      return true
    })
    // Order BEFORE the slice — sorting a limited page would page the wrong records.
    const ordered = sortCatalog(hits, normalizeCatalogSort(filter.sort))
    const limited = filter.limit ? ordered.slice(0, filter.limit) : ordered
    return limited.map((i) => {
      const { access: _access, license: _license, commercialUse: _commercialUse, ...card } = toModelCardFromIntella(i)
      return card
    })
  }

  /**
   * Import a model/LoRA by URL (Civitai page/`?modelVersionId`, HuggingFace repo, or a
   * direct `.safetensors`/`.ckpt` link) as a PRIVATE, owner-scoped Intella — usable in
   * the importer's flows at once (`docs/spec/model-import.md` Tier 1). The importer scrapes the
   * origin metadata, CSAM-scans any preview media (non-fatal — a non-pass leaves previews
   * origin-referenced instead of refusing the import, noema-192), and registers the Intella
   * ORIGIN-ONLY for its weights (`sources[0]` points at Civitai/HF/direct, never a copy in our
   * R2 — CUSTODY DECISION 2026-07-02, `ModelImporter.ts`) with `access:'private'`,
   * `canonica:false`, `ownerAnimaId` — so `buildAccessOrClauses` resolves it ONLY for the
   * owner and it never appears on the public catalogue. Appearing publicly is a separate,
   * user-invoked `publish` (an `intella`-kind Editio through `ModerationGate`), which is also
   * where a civitai-origin weight actually gets mirrored into our R2 (`BucketAdapter`).
   *
   * Identified callers only — a private model needs a durable owner (`animaId`).
   */
  async importModel(auctor: AuctorKey, opts: ImportModelOpts): Promise<ModelCard> {
    const importer = this.deps.modelImporter
    if (!importer) throw Errors.notFoundModel('import')
    if (typeof opts.url !== 'string' || !opts.url.trim()) throw Errors.inputMalformed('a model URL is required')
    // Anon-capable: a Bursa purse is a valid owner (imports must be Bursa-possible). The generic
    // ownerKey scopes ownership; ownerAnimaId is populated only when the caller is an anima.
    try {
      const intella = await importer.import({
        url: opts.url.trim(),
        ownerKey: ownerKeyOf(auctor),
        ...('animaId' in auctor ? { ownerAnimaId: auctor.animaId } : {}),
        ...(opts.genus ? { genus: opts.genus } : {}),
      })
      return {
        intellaId: intella.id,
        nomen: intella.nomen,
        genus: intella.genus,
        ...(intella.familia ? { basis: intella.familia } : {}),
        ...(intella.trigger ? { trigger: intella.trigger } : {}),
        ...(intella.description ? { description: intella.description } : {}),
      }
    } catch (err) {
      // A gated origin with no connected secret → typed `secret.required` (frontend deep-links to
      // connect it). Checked before the generic branch — SecretRequiredError extends ModelImportError.
      if (err instanceof SecretRequiredError) throw Errors.secretRequired(err.provider, err.message)
      if (err instanceof ModelImportError) throw Errors.inputMalformed(err.message)
      throw err
    }
  }

  /**
   * List the caller's OWN privately-held models — imports + trained LoRAs — newest first. The
   * public `listModels` catalog is `canonica:true` only, so a private import (owner-scoped in the
   * `Intellarum` registry) is otherwise invisible; this is where an importer sees + manages what
   * they brought in. Anon-capable: a Bursa purse owns its imports (keyed by ownerKey).
   */
  async listMyModels(auctor: AuctorKey): Promise<ModelCard[]> {
    if (!this.deps.intellarum) return []
    const registry = this.deps.intellarum
    const ownerKey = ownerKeyOf(auctor)
    const models = registry.listByOwner
      ? await registry.listByOwner(ownerKey)
      : (await registry.list()).filter((i) => i.ownerKey === ownerKey || `anima:${i.ownerAnimaId}` === ownerKey)
    return models.map(toModelCardFromIntella)
  }

  /**
   * ADMIN license backfill/clearance (going-public review). Sets a model's `license` +
   * `commercialUse` so the public-catalog gate treats it correctly — for a legacy/unclassified
   * import, a misclassification, or a model we've cleared by taking out a commercial license.
   * Two modes: an explicit clearance ({ license, commercialUse }) — the operator's decision, e.g.
   * marking an SD3 model `'yes'` once we hold the Stability license — or `reclassify:true`, which
   * re-derives the verdict from the model's recorded base string (`baseModel` > `provenance.base` >
   * `nomen` > `familia`) via the same classifier (bulk-fix models imported before license
   * classification existed). Platform-admin only.
   *
   * `reclassify` never downgrades: if the freshly computed verdict is `'unknown'` but the record
   * already carries a real (non-'unknown') `license` — from a prior correct classification, or a
   * manual clearance applied through a different route — the stored value is left alone and the
   * unchanged record is returned, rather than silently overwritten back to `'unknown'`.
   */
  async setModelLicense(auctor: AuctorKey, id: string, opts: SetModelLicenseOpts): Promise<ModelCard> {
    this._assertPlatformAdmin(auctor)
    const registry = this.deps.intellarum
    if (!registry?.setLicense) throw Errors.notFoundModel(id)
    let { license, commercialUse } = opts
    if (opts.reclassify) {
      const m = await registry.find(id)
      if (!m) throw Errors.notFoundModel(id)
      // Re-derive from the model's recorded base via the shared classifier (baseModel >
      // provenance.base > nomen > familia) — the SAME path the backfill sweep runs, so admin +
      // sweep never disagree.
      ;({ license, commercialUse } = classifyModelLicense(m))
      // Guard: reclassify must never DOWNGRADE an already-classified record. If the classifier
      // still can't place the base (fresh verdict 'unknown') but the record already carries a real
      // license — whether from a prior correct classification, or a manual admin override applied
      // through a different route (e.g. a direct clearance the classifier itself couldn't derive) —
      // there was never a better answer to fall back to, so leave the stored value untouched rather
      // than silently overwrite it with 'unknown'. (Observed in production: a manually-cleared
      // model's correct license was wiped back to 'unknown' by a reclassify click.)
      if (license === 'unknown' && m.license !== undefined && m.license !== 'unknown') {
        return toModelCardFromIntella(m)
      }
    }
    if (license === undefined && commercialUse === undefined) {
      throw Errors.inputMalformed('provide license and/or commercialUse, or reclassify:true')
    }
    const updated = await registry.setLicense(id, {
      ...(license !== undefined ? { license } : {}),
      ...(commercialUse !== undefined ? { commercialUse } : {}),
    })
    if (!updated) throw Errors.notFoundModel(id)
    return toModelCardFromIntella(updated)
  }

  /**
   * ADMIN revenue report (platform-admin only) — the conditional-license tripwire, surfaced for the
   * accounting view (ADR-0013 §5, spec step 3). Reads the company-wide trailing-12-month USD revenue
   * rollup `R`, finds the conditional licenses currently reachable in the public catalog + their
   * tightest binding cap (ADR-0012), classifies the LIVE band, and echoes the last edge-triggered
   * band the scheduled evaluator persisted. READ-ONLY: it neither persists a new band nor fires the
   * alert seam — that is `evaluateTripwire`'s job on its cadence. This is the "what's our number"
   * report a human reads, not the safety valve.
   */
  async revenueReport(auctor: AuctorKey, now: Date = new Date()): Promise<RevenueReport> {
    this._assertPlatformAdmin(auctor)
    const redituum = this.deps.redituum
    if (!redituum) throw Errors.reportUnavailable()
    const R = await redituum.trailingUsdRevenue(now)
    const models = this.deps.intellarum ? await this.deps.intellarum.list() : []
    const licenses = activeConditionalLicenses(models)
    const capUsd = bindingCapUsd(licenses)
    const liveBand = band(R, bindingCapMicroUsd(licenses))
    const last = await this.deps.tripwireBand?.last()
    return {
      asOf: now.toISOString(),
      trailingUsdRevenueMicro: R.toString(),
      trailingUsdRevenue: microUsdToStr(R),
      band: liveBand,
      bindingCapUsd: capUsd,
      activeConditionalLicenses: licenses,
      lastAlertedBand: last?.band ?? null,
    }
  }

  /**
   * ADMIN COGS report (platform-admin only) — the read-only pair to `revenueReport`: a
   * trailing-window rollup of per-job `costUsd` off `wide_events` (admin workspace, credits-only
   * scope — no payout/disbursement/tax). Uses the SAME trailing-12mo window as `revenueReport`
   * for a like-for-like pairing. A single scalar + count in v1 — no per-gpuType/per-model split.
   */
  async cogsReport(auctor: AuctorKey, now: Date = new Date()): Promise<CogsReport> {
    this._assertPlatformAdmin(auctor)
    const costReport = this.deps.costReport
    if (!costReport) throw Errors.reportUnavailable()
    const since = new Date(now)
    since.setFullYear(since.getFullYear() - 1)
    const { costUsd, count } = await costReport.sumCostUsd(since)
    return {
      asOf: now.toISOString(),
      sinceIso: since.toISOString(),
      costUsd,
      count,
    }
  }

  // ── Account settings (Consuetudinum, owner-keyed / anon-capable) ─────────────

  /** The caller's owner-keyed account settings — identity (animaId/username) + balance +
   *  appearance (Profile) + generation defaults (Preferences) + verb→flow bindings. Settings
   *  fields stay optional (unset → undefined); identity is optional too (anon/purse callers). */
  async getMe(auctor: AuctorKey): Promise<MeView> {
    const c = this.deps.consuetudinum
    const secrets = await this.secretPresenceView(auctor)
    // Availability tracks the WRITE seam, not presence — an unconfigured store 500s on connect, so the
    // panel can hide/disable proactively instead of waiting for the first failed PUT (F3).
    const secretsAvailable = !!this.deps.secretWriter
    // Platform-admin flag — the SAME identity check that gates the moderation review actions
    // (`_assertPlatformAdmin`). Surfaced so the web app can reveal the feed-review surface + its
    // approve/reject controls only to the reviewer; it is `true` only on the platform's own session.
    const admin = 'animaId' in auctor && auctor.animaId === PLATFORM_ANIMA_ID
    const identity = await this.meIdentity(auctor)
    // Same aggregator `/v1/me/status` calls — the two endpoints are structurally unable to disagree.
    const { balanceImpetus, balanceUsd } = await this.meBalance(auctor)
    if (!c) return { ...identity, bindings: [], secrets, secretsAvailable, admin, balanceImpetus, balanceUsd }
    const [appearance, generatio, bindings] = await Promise.all([
      c.resolveAppearance(auctor), c.resolveGeneratio(auctor), c.listBindings(auctor),
    ])
    return {
      ...identity,
      ...(appearance !== undefined ? { appearance } : {}),
      ...(generatio !== undefined ? { generatio } : {}),
      bindings,
      secrets,
      secretsAvailable,
      admin,
      balanceImpetus,
      balanceUsd,
    }
  }

  /** `animaId` + `username` for `getMe`. `username` resolves through the same `'password'`
   *  persona lookup `POST /v1/auth/register` writes it to (`resolveOrCreateAnima`'s `personae`
   *  store) — never a second path that could disagree. Anonymous/purse callers (no `animaId`)
   *  and identified callers with no password persona (wallet-only, telegram-only) both resolve
   *  to `{}`/`{ animaId }` respectively; neither is an error. */
  protected async meIdentity(auctor: AuctorKey): Promise<Pick<MeView, 'animaId' | 'username'>> {
    if (!('animaId' in auctor)) return {}
    const animaId = auctor.animaId
    if (!this.deps.personae) return { animaId }
    const personae = await this.deps.personae.findByAnimaId(animaId)
    const passwordPersona = personae.find(p => p.genus === 'password' && p.activeAnimaId === animaId)
    return passwordPersona ? { animaId, username: passwordPersona.externusId } : { animaId }
  }

  /** `balanceImpetus`/`balanceUsd` for `getMe`, via the same aggregator `status()` uses — the two
   *  endpoints read the same numbers and cannot disagree. `status()` requires the full ledger/session
   *  dep set (signorum/hospitia/materiae/actorum/modorum); a facade missing any of them propagates
   *  that failure rather than reporting a fabricated zero balance. */
  protected async meBalance(auctor: AuctorKey): Promise<Pick<MeView, 'balanceImpetus' | 'balanceUsd'>> {
    const { balanceImpetus, balanceUsd } = await this.status(auctor)
    return { balanceImpetus, balanceUsd }
  }

  /** Public appearance-by-owner projection — the visual branding (avatar/banner/accent/
   *  look) any embedder may read to theme a widget. Unlike `getMe` this is NOT self-
   *  scoped: it exposes ONLY the `Appearance` (all visual, no secrets/prefs/bindings),
   *  keyed by any owner. Backs the per-agent widget skin (an agent's own `{animaId}`). */
  async publicAppearance(owner: AuctorKey): Promise<Appearance | undefined> {
    return this.deps.consuetudinum?.resolveAppearance(owner)
  }

  /** Per-provider connect state for `getMe`. Uses the `has`-only presence view (no plaintext).
   *  Absent store → every provider 'absent'. */
  protected async secretPresenceView(auctor: AuctorKey): Promise<Record<SecretProvider, 'connected' | 'absent'>> {
    const p = this.deps.secretPresence
    const ownerKey = ownerKeyOf(auctor)
    const entries = await Promise.all(
      SECRET_PROVIDERS.map(async provider =>
        [provider, p && (await p.has(ownerKey, provider)) ? 'connected' : 'absent'] as const),
    )
    return Object.fromEntries(entries) as Record<SecretProvider, 'connected' | 'absent'>
  }

  // ── BYO secrets (Secretarium, owner-keyed / anon-capable) ────────────────────

  /**
   * Connect the caller's BYO gated-origin credential for `provider`. The token is sealed at
   * rest at once and NEVER echoed back. `idleDays` (default 90) sets the idle-expiry window.
   * Anon-capable: a Bursa purse is a valid owner (§ownerKeyOf) — but a BYO token is bound to a
   * NAMED third-party account, so a purse caller gets a deanonymization `warning` to render.
   */
  async putSecret(auctor: AuctorKey, provider: string, token: string, idleDays?: number): Promise<SecretView> {
    const w = this.deps.secretWriter
    if (!w) throw Errors.internal('BYO secrets are not available on this deployment')
    if (!isSecretProvider(provider)) throw Errors.inputMalformed(`unknown secret provider '${provider}'`)
    if (typeof token !== 'string' || !token.trim()) throw Errors.inputMalformed('a token is required')
    const days = Number.isFinite(idleDays) && (idleDays as number) > 0 ? Math.floor(idleDays as number) : DEFAULT_SECRET_IDLE_DAYS
    const { expiresAt } = await w.put(ownerKeyOf(auctor), provider, token.trim(), days)
    return {
      provider,
      status: 'connected',
      expiresAt: expiresAt.toISOString(),
      ...('bursaToken' in auctor || 'commitment' in auctor ? { warning: DEANON_WARNING } : {}),
    }
  }

  /** Disconnect the caller's BYO credential for `provider`. Idempotent (absent → still 'absent'). */
  async removeSecret(auctor: AuctorKey, provider: string): Promise<SecretView> {
    const w = this.deps.secretWriter
    if (!w) throw Errors.internal('BYO secrets are not available on this deployment')
    if (!isSecretProvider(provider)) throw Errors.inputMalformed(`unknown secret provider '${provider}'`)
    await w.remove(ownerKeyOf(auctor), provider)
    return { provider, status: 'absent' }
  }

  /** Replace the caller's presentation skin (Profile). */
  async setAppearance(auctor: AuctorKey, appearance: Appearance): Promise<Appearance> {
    if (!this.deps.consuetudinum) throw Errors.internal('account settings not configured')
    await this.deps.consuetudinum.setAppearance(auctor, appearance)
    return appearance
  }

  /** Replace the caller's cross-cutting generation defaults (Preferences).
   *
   *  Spicy gate (noema-091): enabling `spicyMode` requires a one-time 18+ attestation ON FILE for this
   *  identity (anon or named alike) — no attestation ⇒ `spicyMode: true` cannot be persisted. The
   *  attestation is a durable, write-once fact recorded via `recordAttestation` (POST /v1/me/attestation);
   *  because this PUT replaces the whole Generatio, a recorded attestation is PRESERVED across a
   *  Preferences save that omits it, so the gate reads the persisted attestation and a later save can't
   *  silently erase it. */
  async setGeneratio(auctor: AuctorKey, generatio: Generatio): Promise<Generatio> {
    if (!this.deps.consuetudinum) throw Errors.internal('account settings not configured')
    const existing = await this.deps.consuetudinum.resolveGeneratio(auctor)
    const merged: Generatio = { ...generatio }
    // Preserve a durable, previously-recorded 18+ attestation across a wholesale Preferences replace.
    if (merged.ageAttestation === undefined && existing?.ageAttestation) {
      merged.ageAttestation = existing.ageAttestation
    }
    // Licence-terms acceptance is written only by `acceptUseTerms`. Whatever this replace carries
    // is discarded and the stored record kept, so a Preferences save can neither forge an
    // acceptance nor erase one.
    delete merged.termsAccepted
    if (existing?.termsAccepted) merged.termsAccepted = existing.termsAccepted
    // Telegram's `/dataset` + `/collect` are the only writers/readers of these two fields today —
    // the web Preferences screen doesn't surface either, so a wholesale replace from THAT screen
    // must not erase what Telegram set, the same reason ageAttestation is preserved above.
    if (merged.defaultDatasetId === undefined && existing?.defaultDatasetId !== undefined) {
      merged.defaultDatasetId = existing.defaultDatasetId
    }
    if (merged.collecting === undefined && existing?.collecting !== undefined) {
      merged.collecting = existing.collecting
    }
    // No attestation on file ⇒ spicyMode cannot be enabled (for anon or named callers alike).
    if (merged.spicyMode === true && !merged.ageAttestation) {
      throw Errors.authForbidden('Enabling spicy mode requires a recorded 18+ age attestation.')
    }
    // Private generation (noema-347) is only settable where the deployment has a private-outputs
    // bucket. Refusing here is the point: the alternative — accepting the preference and writing
    // to the public bucket anyway — would record a promise the deployment cannot keep.
    if (merged.privateOutputs === true && !this.deps.privateOutputs) {
      throw new ApiError(
        'internal.unavailable',
        'Private generation is not available on this deployment.',
        503,
        { retryable: false },
      )
    }
    // Memory notes (the author ladder) are proposed by the concierge and written by the CLIENT
    // through this same PUT, so the ceiling is enforced HERE and not only where they are composed:
    // an over-long list is truncated to the newest MEMORY_NOTES_MAX and each line to
    // MEMORY_NOTE_MAX_CHARS rather than rejected, because a rejected Preferences save would lose the
    // user's OTHER edits to make a point about a note the agent wrote.
    if (merged.memoryNotes !== undefined) {
      const notes = (Array.isArray(merged.memoryNotes) ? merged.memoryNotes : [])
        .filter((n): n is string => typeof n === 'string')
        .map((n) => n.trim().slice(0, MEMORY_NOTE_MAX_CHARS))
        .filter((n) => n !== '')
        .slice(-MEMORY_NOTES_MAX)
      merged.memoryNotes = notes
    }
    await this.deps.consuetudinum.setGeneratio(auctor, merged)
    return merged
  }

  /** Record the caller's one-time 18+ self-attestation (noema-091) — a self-declared click-through
   *  fact, NOT KYC/ID verification. Written onto the anon-capable Generatio record keyed by the caller's
   *  AuctorKey (so it works for anon Bursa/commitment and named Anima callers alike), preserving every
   *  other Generatio field. Required on file before `spicyMode` may be enabled (see `setGeneratio`).
   *  Re-attesting simply refreshes the timestamp. */
  async recordAttestation(auctor: AuctorKey): Promise<{ attestedAt: number }> {
    if (!this.deps.consuetudinum) throw Errors.internal('account settings not configured')
    const existing = (await this.deps.consuetudinum.resolveGeneratio(auctor)) ?? {}
    const ageAttestation = { attestedAt: Date.now() }
    await this.deps.consuetudinum.setGeneratio(auctor, { ...existing, ageAttestation })
    return ageAttestation
  }

  /** Record that the caller accepts the CURRENT version of licence terms `termsId`
   *  (`crystal/useTerms.ts`) — the click-through a flow declaring those terms requires before it
   *  runs. Keyed like the 18+ attestation (anon-capable), preserving every other Generatio
   *  field. Accepting again refreshes the timestamp; accepting a newer version replaces the old.
   *  An unknown terms id is refused: there is no published text it could stand for. */
  async acceptUseTerms(auctor: AuctorKey, termsId: string): Promise<{ terms: string; versio: string; acceptedAt: number }> {
    if (!this.deps.consuetudinum) throw Errors.internal('account settings not configured')
    if (!lookupUseTerms(termsId)) throw new ApiError('not_found.terms', `No terms '${termsId}'`, 404)
    return recordUseTermsAcceptance(this.deps.consuetudinum, auctor, termsId)
  }

  /** The caller's per-modus input defaults (affines) for one flow. */
  async getAffines(auctor: AuctorKey, modusId: string): Promise<Record<string, unknown>> {
    return (await this.deps.consuetudinum?.resolveAffines(auctor, modusId)) ?? {}
  }

  /** Replace the caller's per-modus input defaults (affines) for one flow. */
  async setAffines(auctor: AuctorKey, modusId: string, affines: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.deps.consuetudinum) throw Errors.internal('account settings not configured')
    if (!(await this.deps.modorum.find(modusId))) throw Errors.notFoundFlow(modusId)
    await this.deps.consuetudinum.setAffines(auctor, modusId, affines)
    return affines
  }

  /** The caller's account snapshot — balance, in-flight gens, studios (JSON-projected). */
  async status(auctor: AuctorKey): Promise<StatusView> {
    const snap = await aggregateStatus(
      {
        signorum: this.deps.signorum, hospitia: this.deps.hospitia, materiae: this.deps.materiae,
        actorum: this.deps.actorum, modorum: this.deps.modorum,
        ...(this.deps.actumIndex ? { actumIndex: this.deps.actumIndex } : {}),
        ...(this.deps.modos ? { modos: this.deps.modos } : {}),
        ...(this.deps.vocator ? { vocator: this.deps.vocator } : {}),
      },
      { auctorKey: auctor, inFlightActumIds: [] },
    )
    return {
      balanceImpetus: snap.balanceImpetus.toString(),
      balanceUsd: snap.balanceUsd,
      heldImpetus: snap.heldImpetus.toString(),
      heldUsd: snap.heldUsd,
      // GenEntry carries a bigint (`heldImpetus`) — stringify it, same reason as netImpetus
      // below (res.json/JSON.stringify throw on a raw bigint).
      gens: snap.gens.map((g) => ({ ...g, heldImpetus: g.heldImpetus.toString() })),
      // StudioEntry carries a bigint (`netImpetus`) — stringify it so the whole view
      // is JSON-safe (res.json/JSON.stringify throw on a raw bigint).
      studios: snap.studios.map((s) => ({ ...s, netImpetus: s.netImpetus.toString() })),
      joinable: snap.joinable,
      takenAt: snap.takenAt.toISOString(),
    }
  }
}
