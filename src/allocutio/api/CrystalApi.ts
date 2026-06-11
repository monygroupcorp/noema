// =============================================================================
// CrystalApi — the agent-shaped facade over the crystal ring
// =============================================================================
//
// One small class that an agent (or REST/MCP adapter) talks to. It does NOT
// re-implement execution: it composes the already-built foundation —
// `dispatchInceptio` (the verbatim initiate→dispatch core), `toRun` (the public
// Actum→Run projection), `describeFlow` (the JSON-Schema flow description), and
// the `Errors.*` request-error taxonomy. Verb resolution layers the owner-keyed
// Consuetudinum rebinds over the platform's CANON_VERBS table — the SAME
// precedence the Telegram CommandRouter uses, sharing the same constant.
//
// Construction takes the ring slices it needs (the "deps ring"); methods return
// the public projection types, never the internal Latin primitives.
// =============================================================================

import type { Modorum, Modus } from '../../types/modus.js'
import type { Cursorum, ActumCompletor, Actorum } from '../../types/cursus.js'
import type { ActumInceptor } from '../../execution/ActumInceptor.js'
import type { ActumIndexStore } from '../../types/actumIndex.js'
import type { Consuetudinum } from '../../types/consuetudo.js'
import type { Signorum } from '../../types/significandi.js'
import type { Fundamentorum } from '../../types/fundamentum.js'
import type { Intelligens, IntelligentiumStore, IntelligensGenus } from '../../types/intelligendi.js'
import type { HospitiumStore } from '../../types/hospitium.js'
import type { MateriaStore } from '../../types/materia.js'
import type { Conductor, StudioHandle } from '../../crystal/Conductor.js'
import type { AuctorKey } from '../../flow/types.js'
import type { Actum, ComputeStrategy, GpuClass, ModelRef } from '../../types/actum.js'
import type { Inceptio } from '../../types/cursus.js'

import { aggregateStatus, materiaStudioStatus } from '../lexicon/status/aggregate.js'
import type { ModoStore } from '../../types/modo.js'
import { deriveSavedModus, type PromptMode } from '../../crystal/deriveSavedModus.js'
import { dispatchInceptio } from '../../execution/dispatchInceptio.js'
import { toRun } from './runProjection.js'
import { describeFlow, type FlowDescription, type DescribableModus } from './aditusToJsonSchema.js'
import { Errors } from './errors.js'
import { CANON_VERBS } from '../../crystal/canonVerbs.js'
import type { Run } from './types.js'

/** The ring slices CrystalApi composes. */
export interface CrystalApiDeps {
  inceptor: { initiate: ActumInceptor['initiate'] }
  modorum: Modorum
  cursorum: Cursorum
  completor: ActumCompletor
  actorum: Actorum
  /** The ledger — used to owner-scope `getRun` (a run is yours iff you own one of the
   *  signa it consumed) and to quote a run's cost. Identity-blind Actum → ownership lives here. */
  signorum: Signorum
  /** Compute-substrate registry — backs `listFundamenta` discovery. */
  fundamentorum: Fundamentorum
  /** Weight catalog — backs `listModels` discovery. */
  intelligendi: IntelligentiumStore
  /** Hosting + live-pod registries — back the `status` aggregation. */
  hospitia: HospitiumStore
  materiae: MateriaStore
  /** Studio-lifecycle anchor (ADR-0006) — backs `provisionStudio`/`listStudios`. Absent
   *  when no Procurator (provision-capable pod client) is wired → studio ops are unavailable. */
  conductor?: Conductor
  /** Optional per-AuctorKey aggregation index (passed through to dispatchInceptio). */
  actumIndex?: ActumIndexStore
  /** Session store — keys studios by their bound Modo id (the canonical studio handle)
   *  in `status`, so `/v1/me/status` and `/v1/studios` agree on `studioId` (ADR-0006). */
  modos?: ModoStore
  /** Optional owner-keyed verb→flow rebinds; falls through to CANON_VERBS when absent. */
  consuetudinum?: Consuetudinum
}

/** Where to send a run: an explicit modusId OR a canon verb to resolve. */
export interface InvokeTarget {
  modusId?: string
  verb?: string
}

/** Per-run execution overrides. */
export interface InvokeOpts {
  pinnedModels?: ModelRef[]
  computeStrategy?: ComputeStrategy
  gpuClass?: GpuClass
  /** Hard spend cap (impetus). Admission refuses if the estimated reservation exceeds it. */
  maxImpetus?: bigint | string
  /** Target an existing warm studio (a Modo session) instead of cold-provisioning a pod. */
  studioId?: string
}

/** A compact catalog summary of one runnable flow. */
export interface FlowSummary {
  id: string
  nomen: string
  versio: string
  categoria?: unknown
}

export class CrystalApi {
  constructor(private readonly deps: CrystalApiDeps) {}

  /**
   * Invoke a flow for an auctor and return its public Run projection.
   *
   * Target resolution: an explicit `modusId` wins; otherwise the `verb` is
   * resolved through the owner's Consuetudinum rebinds, falling back to the
   * platform CANON_VERBS table. Nothing resolved → `not_found.flow`.
   */
  async invokeFlow(
    auctor: AuctorKey,
    target: InvokeTarget,
    aditus: Record<string, unknown>,
    opts: InvokeOpts = {},
  ): Promise<Run> {
    const { inceptor, modorum, cursorum, completor, actumIndex, consuetudinum } = this.deps

    let modusId: string | undefined
    if (target.modusId) {
      modusId = target.modusId
    } else if (target.verb) {
      modusId = (await consuetudinum?.resolve(auctor, target.verb)) ?? CANON_VERBS[target.verb]
    }
    if (!modusId) throw Errors.notFoundFlow(target.verb ?? '?')

    // Admission spend cap — refuse before dispatch if the upper-bound estimate exceeds
    // maxImpetus. (Mid-run enforcement — the watchdog — is a Phase-4b follow-up.)
    if (opts.maxImpetus !== undefined) {
      const est = await this._estimate(modusId, aditus)
      if (est > BigInt(opts.maxImpetus)) {
        throw Errors.capTooLow({ estimated: est.toString(), maxImpetus: String(opts.maxImpetus) })
      }
    }

    const inceptio: Inceptio = {
      modusId,
      aditus,
      by: auctor,
      ...(opts.studioId ? { modoId: opts.studioId } : {}),
      ...(opts.pinnedModels?.length ? { pinnedModels: opts.pinnedModels } : {}),
      ...(opts.computeStrategy ? { computeStrategy: opts.computeStrategy } : {}),
      ...(opts.gpuClass ? { gpuClass: opts.gpuClass } : {}),
    }

    const { actum } = await dispatchInceptio(
      { inceptor, modorum, cursorum, completor, actumIndex },
      inceptio,
    )
    return toRun(actum)
  }

  /**
   * Fetch a run by id and project it — OWNER-SCOPED. A caller may read a run only
   * if they own it (else `not_found.run`, never revealing that it exists). The Actum
   * is deliberately identity-blind, so ownership is checked against the ledger: the
   * run is yours iff you own one of the signa it consumed. Works for both `animaId`
   * and anon `commitment` (the arcanum signum the spend nullified is in your history),
   * preserving anonymity. Unknown id → `not_found.run`.
   */
  async getRun(auctor: AuctorKey, id: string): Promise<Run> {
    const a = await this.deps.actorum.findById(id)
    if (!a || !(await this._owns(auctor, a))) throw Errors.notFoundRun(id)
    return toRun(a)
  }

  /** A run is owned by an auctor iff a signum it consumed belongs to that auctor.
   *  A targeted membership check (not a full-history scan); spent signa still match,
   *  so it holds post-completion. */
  private _owns(auctor: AuctorKey, a: Actum): Promise<boolean> {
    return this.deps.signorum.ownsAny(auctor, a.signaConsumed ?? [])
  }

  /** List the canonical atomic flows as compact summaries. */
  async listFlows(): Promise<FlowSummary[]> {
    const modi = await this.deps.modorum.list({ genus: 'atomicus', canonica: true })
    return modi.map((m) => {
      // `categoria` is an optional catalog tag not on the core Modus type — read it
      // off whatever the registry carries without widening the primitive.
      const categoria = (m as { categoria?: unknown }).categoria
      return {
        id: m.id,
        nomen: m.nomen,
        versio: m.versio,
        ...(categoria !== undefined ? { categoria } : {}),
      }
    })
  }

  /** Describe one flow's JSON-Schema input/output. Unknown id → `not_found.flow`. */
  async describeFlow(id: string): Promise<FlowDescription> {
    const m = await this.deps.modorum.find(id)
    if (!m) throw Errors.notFoundFlow(id)
    // Modus carries every field describeFlow reads; the cast supplies the
    // index-signature DescribableModus declares for its passthrough meta.
    return describeFlow(m as unknown as DescribableModus)
  }

  /**
   * Quote a run's cost WITHOUT dispatching — the upper-bound reservation the cursor
   * declares for this modus + aditus (side-effect-free; `run().impetus ≤ reserve()`).
   * Exact for fixed-cost flows, an upper bound for duration-based pod flows.
   */
  async quote(auctor: AuctorKey, target: InvokeTarget, aditus: Record<string, unknown>): Promise<{ impetus: string }> {
    let modusId: string | undefined = target.modusId
    if (!modusId && target.verb) {
      modusId = (await this.deps.consuetudinum?.resolve(auctor, target.verb)) ?? CANON_VERBS[target.verb]
    }
    if (!modusId) throw Errors.notFoundFlow(target.verb ?? '?')
    return { impetus: (await this._estimate(modusId, aditus)).toString() }
  }

  /** The cursor's read-only upper-bound reservation for a modus + aditus. */
  private async _estimate(modusId: string, aditus: Record<string, unknown>): Promise<bigint> {
    const modus = await this.deps.modorum.find(modusId)
    if (!modus) throw Errors.notFoundFlow(modusId)
    return this.deps.cursorum.resolve(modus).reserve(modus, aditus)
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
   * (resolved to the substrate's base family), `trigger` (a LoRA trigger word, matched
   * against `verba`), and `q` (free text via the store's search). Each result is a
   * card so the agent can decide, not just enumerate.
   */
  async listModels(filter: { genus?: IntelligensGenus; basis?: string; fundamentumId?: string; trigger?: string; q?: string; limit?: number } = {}): Promise<ModelCard[]> {
    let basis = filter.basis
    if (!basis && filter.fundamentumId) {
      const f = await this.deps.fundamentorum.find(filter.fundamentumId).catch(() => null)
      if (f) {
        for (const w of f.intellae ?? []) {
          const wi = await this.deps.intelligendi.find(w.id).catch(() => null)
          if (wi?.basis) { basis = wi.basis; break }
        }
      }
    }
    const q = filter.q?.trim()
    // Free-text → the store's search; otherwise the structured filter. Apply the
    // remaining constraints in-memory (search isn't field-filtered).
    const base = q
      ? await this.deps.intelligendi.search(q)
      : await this.deps.intelligendi.list({ canonica: true, ...(filter.genus ? { genus: filter.genus } : {}), ...(basis ? { basis } : {}) })
    const trig = filter.trigger?.trim().toLowerCase()
    const hits = base.filter((i) => {
      if (filter.genus && i.genus !== filter.genus) return false
      if (basis && i.basis !== basis) return false
      if (trig && !(i.verba ?? []).some((v) => v.toLowerCase() === trig)) return false
      return true
    })
    const limited = filter.limit ? hits.slice(0, filter.limit) : hits
    return limited.map(toModelCard)
  }

  /**
   * Save a reusable, owner-keyed flow — the agent twin of the bot's Save-as. Derive a
   * new Modus from a base (an owned run via `fromRun`, or an explicit `modusId`), baking
   * the captured `aditus` as input defaults + folding pinned LoRAs + prompt affixes. The
   * chosen name yields a global-unique slug (collision → `conflict.slug_taken`).
   */
  async saveFlow(auctor: AuctorKey, opts: SaveFlowOpts): Promise<{ id: string }> {
    let baseModusId = opts.modusId
    let aditus = opts.aditus ?? {}
    let pinned = opts.pinnedModels
    if (opts.fromRun) {
      const a = await this.deps.actorum.findById(opts.fromRun)
      if (!a || !(await this._owns(auctor, a))) throw Errors.notFoundRun(opts.fromRun)
      baseModusId = a.modusId
      if (opts.aditus === undefined) aditus = a.aditus ?? {}
      if (pinned === undefined && a.pinnedModels) pinned = a.pinnedModels.map((m) => ({ id: m.id }))
    }
    if (!baseModusId) throw Errors.inputMalformed('saveFlow needs fromRun or modusId')
    const base = await this.deps.modorum.find(baseModusId)
    if (!base) throw Errors.notFoundFlow(baseModusId)

    const slug = slugify(opts.name)
    if (!slug) throw Errors.inputMalformed('name produces an empty slug')
    if (await this.deps.modorum.find(slug)) throw Errors.conflictSlug(slug)

    const derived = deriveSavedModus(base, {
      slug, name: opts.name, owner: auctor, aditus,
      promptMode: opts.promptMode ?? 'open',
      ...(opts.affix?.prefix ? { promptPraefixum: opts.affix.prefix } : {}),
      ...(opts.affix?.suffix ? { promptSuffixum: opts.affix.suffix } : {}),
      ...(pinned ? { pinned } : {}),
    })
    await this.deps.modorum.register(derived)
    return { id: derived.id }
  }

  /** Rebind one of the caller's canon verbs to a flow (owner-keyed Consuetudinum). */
  async bind(auctor: AuctorKey, verb: string, modusId: string): Promise<{ verb: string; modusId: string }> {
    if (!this.deps.consuetudinum) throw Errors.internal('verb binding not configured')
    if (!(verb in CANON_VERBS)) throw Errors.inputMalformed(`'${verb}' is not a rebindable verb`)
    if (!(await this.deps.modorum.find(modusId))) throw Errors.notFoundFlow(modusId)
    await this.deps.consuetudinum.bind(auctor, verb, modusId)
    return { verb, modusId }
  }

  /** The caller's account snapshot — balance, in-flight gens, studios (JSON-projected). */
  async status(auctor: AuctorKey): Promise<StatusView> {
    const snap = await aggregateStatus(
      {
        signorum: this.deps.signorum, hospitia: this.deps.hospitia, materiae: this.deps.materiae,
        actorum: this.deps.actorum, modorum: this.deps.modorum,
        ...(this.deps.actumIndex ? { actumIndex: this.deps.actumIndex } : {}),
        ...(this.deps.modos ? { modos: this.deps.modos } : {}),
      },
      { auctorKey: auctor, inFlightActumIds: [] },
    )
    return {
      balanceImpetus: snap.balanceImpetus.toString(),
      balanceUsd: snap.balanceUsd,
      gens: snap.gens,
      // StudioEntry carries a bigint (`netImpetus`) — stringify it so the whole view
      // is JSON-safe (res.json/JSON.stringify throw on a raw bigint).
      studios: snap.studios.map((s) => ({ ...s, netImpetus: s.netImpetus.toString() })),
      joinable: snap.joinable,
      takenAt: snap.takenAt.toISOString(),
    }
  }

  /**
   * Lease a hosted studio for the caller (the agent twin of the bot's `/arm` Start) —
   * the `Conductor` provisions a warm pod, binds it to the caller (Hospitium), installs
   * the loadout, and opens a budgeted `Modo` session. Returns the studio handle; its
   * `studioId` is what `POST /v1/runs { studioId }` targets.
   *
   * The `maxImpetus` cap IS the session budget (the tessera): `Census` drain-terminates
   * the studio once accrued spend crosses it (the watchdog). Absent → the caller's full
   * balance is the budget. A zero budget is refused (`economy.insufficient_signa`).
   */
  async provisionStudio(auctor: AuctorKey, opts: ProvisionStudioOpts = {}): Promise<StudioView> {
    if (!this.deps.conductor) throw Errors.studioUnavailable()

    // A fundamentum (when given) supplies the runtime + must resolve (no opaque ids).
    let runtime = opts.runtime
    if (opts.fundamentumId) {
      const f = await this.deps.fundamentorum.find(opts.fundamentumId).catch(() => null)
      if (!f) throw Errors.notFoundFundamentum(opts.fundamentumId)
      runtime = runtime ?? f.runtime
    }

    const balance = await this.deps.signorum.balance(auctor)
    const budget = opts.maxImpetus !== undefined ? BigInt(opts.maxImpetus) : balance
    if (budget <= 0n) throw Errors.insufficientSigna({ available: balance.toString() })

    const handle = await this.deps.conductor.conducere(auctor, {
      budget,
      ...(opts.models?.length ? { models: opts.models } : {}),
      ...(opts.warmMs !== undefined ? { warmMs: opts.warmMs } : {}),
      ...(runtime ? { runtime } : {}),
    })
    if (!handle) throw Errors.capacityNoPods()
    return toStudioView(handle, budget)
  }

  /** The caller's live studios (the agent twin of the bulletin's studio list). Empty when
   *  no provisioning rail is wired. */
  async listStudios(auctor: AuctorKey): Promise<StudioView[]> {
    if (!this.deps.conductor) return []
    const handles = await this.deps.conductor.find(auctor)
    return Promise.all(handles.map(async (h) =>
      toStudioView(h, await this.deps.signorum.sessionBudget(h.studioId).catch(() => 0n))))
  }
}

/** Inputs for `saveFlow`. Source the base from an owned run OR an explicit flow id. */
export interface SaveFlowOpts {
  fromRun?: string
  modusId?: string
  name: string
  aditus?: Record<string, unknown>
  promptMode?: PromptMode
  affix?: { prefix?: string; suffix?: string }
  pinnedModels?: Array<{ id: string }>
}

/** JSON-safe projection of a StatusSnapshot (bigint→string, Date→ISO). */
export interface StatusView {
  balanceImpetus: string
  balanceUsd: number
  gens: unknown[]
  studios: unknown[]
  joinable: unknown[]
  takenAt: string
}

/** Inputs for `provisionStudio`. Everything optional — the simplest call leases a default
 *  studio capped at the caller's balance; each knob is opt-in (north-star). */
export interface ProvisionStudioOpts {
  /** Compute substrate to arm on — resolved to its runtime (enumerable via `listFundamenta`). */
  fundamentumId?: string
  /** Models (intellaId) to install live onto the studio (enumerable via `listModels`). */
  models?: string[]
  /** How long to hold the studio warm (ms). */
  warmMs?: number
  /** Hard spend cap = the session budget (the tessera). Census drains the studio at the cap.
   *  Omitted → the caller's full balance. */
  maxImpetus?: bigint | string | number
  /** Override the on-pod runtime explicitly (else inherited from the fundamentum). */
  runtime?: string
}

/** JSON-safe projection of a leased/live studio (bigint→string, Date→ISO). */
export interface StudioView {
  /** The studio's id — what `POST /v1/runs { studioId }` targets (a Modo id). */
  studioId: string
  podId?: string
  /** Pod-derived liveness: idle | running | provisioning | draining | terminated. */
  status: string
  gpu?: string
  runtime?: string
  imageRef?: string
  warmUntil?: string
  /** The authorized session budget (impetus) — the `maxImpetus` cap. */
  budgetImpetus: string
  /** The pod's real hourly USD cost — the source of truth for warm-time billing. */
  costPerHr?: number
  /** Coarse burn-rate hint (impetus/sec). Billing is per-window from `costPerHr`;
   *  this rounds up, so prefer `costPerHr` for an accurate rate. */
  impetusPerSecond?: string
}

function toStudioView(h: StudioHandle, budget: bigint): StudioView {
  const m = h.materia
  // No pod yet (async provisioning): status comes from the session (Modo) — `claiming`/
  // `warming` → `provisioning`; the pod fields are absent until it binds.
  if (!m) {
    return { studioId: h.studioId, status: modoStudioStatus(h.modo), budgetImpetus: budget.toString() }
  }
  return {
    studioId: h.studioId,
    ...(m.externusId ? { podId: m.externusId } : {}),
    // Once bound, liveness is the pod's (Materia) truth, not the Modo's — a reaped pod
    // leaves a stale-`idle` Modo. Shared mapping with /v1/me/status so both agree.
    status: materiaStudioStatus(m),
    ...(m.gpu ? { gpu: m.gpu } : {}),
    ...(m.runtime ? { runtime: m.runtime } : {}),
    ...(m.imageRef ? { imageRef: m.imageRef } : {}),
    ...(m.warmUntil ? { warmUntil: new Date(m.warmUntil).toISOString() } : {}),
    budgetImpetus: budget.toString(),
    ...(m.costPerHr !== undefined ? { costPerHr: m.costPerHr } : {}),
    ...(m.impetusPerSecond !== undefined ? { impetusPerSecond: m.impetusPerSecond.toString() } : {}),
  }
}

/** Map a Modo's session status to the studio-facing vocabulary (the pre-pod, async case). */
function modoStudioStatus(modo: { status: string }): string {
  return modo.status === 'terminated' ? 'terminated'
    : (modo.status === 'claiming' || modo.status === 'warming') ? 'provisioning'
    : 'idle'
}

/** name → global-unique slug candidate (lowercase, dash-joined alnum). */
function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** A model catalog card — enough for an agent to decide, not just enumerate. */
export interface ModelCard {
  intellaId: string
  nomen: string
  genus: string
  basis?: string
  trigger?: string
  description?: string
}

function toModelCard(i: Intelligens): ModelCard {
  const trigger = i.verba && i.verba.length ? i.verba.join(', ') : undefined
  return {
    intellaId: i.id,
    nomen: i.nomen || i.id,
    genus: i.genus,
    ...(i.basis ? { basis: i.basis } : {}),
    ...(trigger ? { trigger } : {}),
    ...(i.descriptio ? { description: i.descriptio } : {}),
  }
}
