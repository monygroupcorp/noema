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
import type { AuctorKey } from '../../flow/types.js'
import type { Actum, ComputeStrategy, GpuClass, ModelRef } from '../../types/actum.js'
import type { Inceptio } from '../../types/cursus.js'

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
  /** Optional per-AuctorKey aggregation index (passed through to dispatchInceptio). */
  actumIndex?: ActumIndexStore
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
