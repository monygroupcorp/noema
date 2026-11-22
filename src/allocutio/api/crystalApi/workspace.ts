import type { Modus } from '../../../types/modus.js'
import type { AuctorKey } from '../../../flow/types.js'
import { toTeam, toProject } from '../runProjection.js'
import { Errors } from '../errors.js'
import type { Team, Project } from '../types.js'
import type { Provincia, Provinciarum } from '../../../types/provincia.js'
import { ownerKeyOf } from '../../../crystal/ownerKey.js'
import type { Tabula, Tabulae, Tabularum } from '../../../types/tabula.js'
import { compileTabula, TabulaCompileError } from '../../../crystal/compileTabula.js'
import { hashModus } from '../../../crystal/hashModus.js'
import { ornatusOf, HOLDING_FIELD, resKind } from './support.js'
import { CrystalApiRuns } from './runs.js'

/** Teams, projects and tabulae. */
export abstract class CrystalApiWorkspace extends CrystalApiRuns {
  // ── Teams (Sodalitas) ───────────────────────────────────────────────────────

  /**
   * Create a team — a Sodalitas the caller founds and is the first member of.
   * `members` are additional Anima ids to seed (the caller is always included).
   * Teams require an identified (animaId) caller.
   */
  async createTeam(auctor: AuctorKey, opts: { nomen: string; members?: string[] }): Promise<Team> {
    const animaId = this._teamAnimaId(auctor)
    const store = this._teamStore()
    const membra = [...new Set([animaId, ...(opts.members ?? [])])]
    return toTeam(await store.create({ nomen: opts.nomen, auctor: animaId, membra }))
  }

  /** Fetch a team — members-only. */
  async getTeam(auctor: AuctorKey, id: string): Promise<Team> {
    return toTeam(await this._memberTeam(auctor, id))
  }

  /** List the caller's teams (every Sodalitas they are a member of). */
  async listTeams(auctor: AuctorKey): Promise<Team[]> {
    const animaId = this._teamAnimaId(auctor)
    return (await this._teamStore().listByMember(animaId)).map(toTeam)
  }

  /** Add a member to a team — members-only. Idempotent. */
  async addTeamMember(auctor: AuctorKey, id: string, animaId: string): Promise<Team> {
    const team = await this._memberTeam(auctor, id)
    if (team.membra.includes(animaId)) return toTeam(team)
    return toTeam(await this._teamStore().update(id, { membra: [...team.membra, animaId] }))
  }

  /** Remove a member from a team — members-only. The `auctor` (founder) cannot be removed. */
  async removeTeamMember(auctor: AuctorKey, id: string, animaId: string): Promise<Team> {
    const team = await this._memberTeam(auctor, id)
    if (animaId === team.auctor) throw Errors.authForbidden('the team founder cannot be removed')
    return toTeam(await this._teamStore().update(id, { membra: team.membra.filter((m) => m !== animaId) }))
  }

  // ── Projects (Provincia) — an account-owned workspace lens ────────────────────

  /**
   * Create a project the caller owns. Projects require an identified (animaId)
   * caller — the account IS the ownership boundary (there is no anon project).
   * If `teamId` is given the caller must be a member of that team, validated through the same
   * `_memberTeam` seam `collect` and `createDataset` validate theirs through — so a caller can
   * only share with a team they themselves belong to, and it is stored as
   * `Provincia.sodalitasId`: every member of it may then read the project and file assets into
   * it (ADR-0015). Absent → owner-only.
   */
  async createProject(
    auctor: AuctorKey,
    opts: { name: string; desc?: string; glyph?: string; color?: string; teamId?: string },
  ): Promise<Project> {
    const animaId = this._projectAnimaId(auctor)
    if (opts.teamId !== undefined) await this._memberTeam(auctor, opts.teamId)
    const ornatus = ornatusOf(opts)
    const created = await this._projectStore().create({
      animaId,
      nomen: opts.name,
      ...(opts.desc !== undefined ? { descriptio: opts.desc } : {}),
      ...(ornatus !== undefined ? { ornatus } : {}),
      datasetIds: [], modelIds: [], collectionIds: [],
      ...(opts.teamId !== undefined ? { sodalitasId: opts.teamId } : {}),
    })
    return toProject(created)
  }

  /** List the projects the caller may read — their own UNION the projects shared with a team
   *  they are a member of (`Provincia.sodalitasId`). The access predicate goes INTO the store
   *  query, so one filtered result set is ordered rather than a page being post-filtered, and
   *  the caller's team ids are resolved ONCE here rather than once per row. */
  async listProjects(auctor: AuctorKey): Promise<Project[]> {
    const animaId = this._projectAnimaId(auctor)
    const sodalitasIds = await this._callerTeamIds(auctor)
    return (await this._projectStore().list({ animaId, sodalitasIds })).map(toProject)
  }

  /** Fetch one project the caller may read — theirs, or shared with a team they belong to — or
   *  404. */
  async getProject(auctor: AuctorKey, id: string): Promise<Project> {
    return toProject(await this._readableProject(auctor, id))
  }

  /**
   * Patch a project's metadata (name/desc/glyph/color/teamId). OWNER-ONLY, and narrower than the
   * read gate on purpose.
   *
   * A metadata patch neither adds to the project nor is confined to it: `teamId` IS the sharing
   * decision, so a member reaching this verb could re-point the project at a team of their own or
   * clear the reference and lock every other member out. The overlay adds readers and
   * contributors, not a principal who may re-draw the boundary that admitted them. A member gets
   * the same `not_found` a stranger gets, so the narrower refusal leaks nothing either.
   */
  async updateProject(
    auctor: AuctorKey,
    id: string,
    patch: { name?: string; desc?: string; glyph?: string; color?: string; teamId?: string | null },
  ): Promise<Project> {
    const project = await this._ownedProject(auctor, id)
    if (patch.teamId != null) await this._memberTeam(auctor, patch.teamId)
    const ornatus = ornatusOf(patch, project.ornatus)
    const next = await this._projectStore().update(id, {
      ...(patch.name !== undefined ? { nomen: patch.name } : {}),
      ...(patch.desc !== undefined ? { descriptio: patch.desc } : {}),
      ...(ornatus !== undefined ? { ornatus } : {}),
      // teamId: null clears the reference; a string sets it; undefined leaves it.
      ...(patch.teamId === null ? { sodalitasId: undefined } : patch.teamId !== undefined ? { sodalitasId: patch.teamId } : {}),
    })
    return toProject(next)
  }

  /** Delete a project. OWNER-ONLY — the destructive verb, on the owner's side of the same line
   *  `archiveDataset` sits on. Filed assets are untouched (holdings are references). */
  async deleteProject(auctor: AuctorKey, id: string): Promise<void> {
    await this._ownedProject(auctor, id)
    await this._projectStore().remove(id)
  }

  /**
   * File an asset reference into a project's holdings (idempotent). Owner OR a member of the
   * team the project is shared with — this is the CONTRIBUTION verb, the additive half of the
   * line `addDatasetMedia` draws: a member adds to the shared workspace lens.
   *
   * FILING IS A REFERENCE, NOT A GRANT, in both directions. It does not widen what the filed id
   * resolves to for anyone — each asset store keeps its own gate, so a dataset shared with
   * nobody stays unreadable to every member who can see the project that names it — and for the
   * same reason it is not a place to leak one: an id filed here is a name, and a name the caller
   * may not resolve is still a name they may not resolve.
   */
  async fileAsset(auctor: AuctorKey, id: string, kind: string, assetId: string): Promise<Project> {
    if (!assetId) throw Errors.inputMalformed('assetId is required')
    const field = HOLDING_FIELD[resKind(kind)]
    const project = await this._readableProject(auctor, id)
    if (project[field].includes(assetId)) return toProject(project)
    return toProject(await this._projectStore().update(id, { [field]: [...project[field], assetId] }))
  }

  /** Remove an asset reference from a project's holdings (idempotent). OWNER-ONLY: the line is
   *  adds-to vs. removes-from, and unfiling is the removal. A member files work into the shared
   *  lens; deciding what leaves it stays with the owner. */
  async unfileAsset(auctor: AuctorKey, id: string, kind: string, assetId: string): Promise<Project> {
    const field = HOLDING_FIELD[resKind(kind)]
    const project = await this._ownedProject(auctor, id)
    if (!project[field].includes(assetId)) return toProject(project)
    return toProject(await this._projectStore().update(id, { [field]: project[field].filter((x) => x !== assetId) }))
  }

  // ── Tabulae (canvas workspaces, ADR-0008 follow-up) ──────────────────────────

  /** List the caller's own Tabulae (drafts + published), newest-saved first. */
  async listTabulae(auctor: AuctorKey): Promise<Tabulae> {
    const all = await this._tabulaeStore().list({ auctor })
    return all.slice().sort((a, b) => b.mutatum.getTime() - a.mutatum.getTime())
  }

  /** Create a new draft Tabula owned by the caller. */
  async createTabula(auctor: AuctorKey, opts: { nomen: string; descriptio?: string; visibilitas?: Tabula['visibilitas'] }): Promise<Tabula> {
    if (!opts.nomen?.trim()) throw Errors.inputMalformed('nomen is required')
    return this._tabulaeStore().create({
      nomen: opts.nomen,
      ...(opts.descriptio !== undefined ? { descriptio: opts.descriptio } : {}),
      auctor,
      status: 'draft',
      visibilitas: opts.visibilitas ?? 'privata',
    })
  }

  /** Fetch one owned Tabula, or 404 (a stranger gets the same 404 as a nonexistent id). */
  async getTabula(auctor: AuctorKey, id: string): Promise<Tabula> {
    return this._ownedTabula(auctor, id)
  }

  /** Patch a Tabula's graph/metadata. Owner-only. */
  async updateTabula(
    auctor: AuctorKey,
    id: string,
    patch: { nomen?: string; descriptio?: string; nodi?: Tabula['nodi']; vincula?: Tabula['vincula']; visibilitas?: Tabula['visibilitas'] },
  ): Promise<Tabula> {
    await this._ownedTabula(auctor, id)
    return this._tabulaeStore().update(id, patch)
  }

  /** Delete a Tabula outright. Owner-only. */
  async deleteTabula(auctor: AuctorKey, id: string): Promise<void> {
    await this._ownedTabula(auctor, id)
    await this._tabulaeStore().remove(id)
  }

  /**
   * Publish a Tabula: compile its canvas graph into a compositus Modus and register it
   * (Modorum), owner-keyed, `canonica: false`. Republishing the same Tabula bumps `versio`
   * on the SAME modus id (the Tabula's published identity is stable across edits).
   */
  async publishTabula(auctor: AuctorKey, id: string): Promise<{ modusId: string }> {
    const tabula = await this._ownedTabula(auctor, id)
    let compiled
    try {
      compiled = await compileTabula(tabula, (modusId) => this.deps.modorum.find(modusId))
    } catch (err) {
      if (err instanceof TabulaCompileError) {
        throw Errors.tabulaGraphInvalid(err.message, { code: err.code, ...(err.vinculumId ? { vinculumId: err.vinculumId } : {}) })
      }
      throw err
    }

    const modusId = tabula.modusId ?? tabula.id
    const previous = await this.deps.modorum.find(modusId)
    const versio = previous ? this._bumpVersio(previous.versio) : '1.0.0'
    const now = new Date()
    const modus: Modus = {
      id: modusId,
      nomen: tabula.nomen,
      genus: 'compositus',
      versio,
      contentHash: '',
      aditus: compiled.aditus,
      exitus: compiled.exitus,
      gradus: compiled.gradus,
      auctor,
      canonica: false,
      natum: previous?.natum ?? now,
      mutatum: now,
    }
    modus.contentHash = hashModus(modus)
    await this.deps.modorum.register(modus)
    await this._tabulaeStore().update(id, { modusId, status: 'published' })
    return { modusId }
  }

  protected _tabulaeStore(): Tabularum {
    const store = this.deps.tabulae
    if (!store) throw Errors.notFoundTabula('tabulae')
    return store
  }

  /** Resolve a Tabula the caller owns, or 404 (stranger gets not_found, not forbidden). */
  protected async _ownedTabula(auctor: AuctorKey, id: string): Promise<Tabula> {
    const tabula = await this._tabulaeStore().find(id)
    if (!tabula || ownerKeyOf(tabula.auctor) !== ownerKeyOf(auctor)) throw Errors.notFoundTabula(id)
    return tabula
  }

  /** Bump the patch component of a semver-ish `x.y.z` string. Falls back to '1.0.0' if unparseable. */
  protected _bumpVersio(v: string): string {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v)
    if (!m) return '1.0.0'
    return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`
  }

  protected _projectStore(): Provinciarum {
    const store = this.deps.provinciarum
    if (!store) throw Errors.notFoundProject('projects')
    return store
  }

  /** Projects are animaId-keyed — anonymous (commitment/bursa) callers cannot own one. */
  protected _projectAnimaId(auctor: AuctorKey): string {
    if ('animaId' in auctor) return auctor.animaId
    throw Errors.authForbidden('projects require an identified account')
  }

  /** Resolve a project the caller OWNS OUTRIGHT, or 404 — the narrow gate the destructive
   *  project verbs keep (`updateProject`, `deleteProject`, `unfileAsset`). */
  protected async _ownedProject(auctor: AuctorKey, id: string): Promise<Provincia> {
    const animaId = this._projectAnimaId(auctor)
    const project = await this._projectStore().find(id)
    if (!project || project.animaId !== animaId) throw Errors.notFoundProject(id)
    return project
  }

  /**
   * May this caller reach this project — the owner, or a member of the team it is shared with?
   *
   * `_ownsCollection`/`_ownsDataset` verbatim in shape: the direct owner, then the `Sodalitas`
   * overlay resolved through the team store. Absent `sodalitasId`, absent team store, or an
   * anonymous caller all fall through to owner-only, so nothing a stranger could reach before
   * this field was consulted becomes reachable now.
   */
  protected async _ownsProject(auctor: AuctorKey, p: Provincia): Promise<boolean> {
    if (!('animaId' in auctor)) return false
    if (p.animaId === auctor.animaId) return true
    if (p.sodalitasId === undefined) return false
    const team = await this.deps.sodalitatum?.find(p.sodalitasId)
    return team?.membra.includes(auctor.animaId) ?? false
  }

  /** Resolve a project the caller may reach — theirs, or shared with a team they belong to — or
   *  404 (a caller with no claim on it gets not_found, not forbidden, so ids stay
   *  non-enumerable). This is the READ gate and the CONTRIBUTE gate; `_ownedProject` above stays
   *  the gate for the verbs that remove. */
  protected async _readableProject(auctor: AuctorKey, id: string): Promise<Provincia> {
    // Anonymous (commitment/bursa) callers are refused here exactly as they always were —
    // projects are animaId-keyed and the overlay does not change that.
    this._projectAnimaId(auctor)
    const project = await this._projectStore().find(id)
    if (!project || !(await this._ownsProject(auctor, project))) throw Errors.notFoundProject(id)
    return project
  }
}
