import type { AuctorKey } from '../../../flow/types.js'
import { Errors, ApiError } from '../errors.js'
import { isPrivateMarker } from '../../../crystal/MediaFetcher.js'
import { v4 as uuidv4 } from 'uuid'
import { coverageOver } from '../../../types/dataset.js'
import type {
  Captionset, CreateDatasetInput, Dataset, DatasetMediaItem, DatasetSummary, Datasets,
  IngestMediaFromGeneration, IngestMediaFromUpload, IngestMediaInput,
} from '../../../types/dataset.js'
import { dedupeByUrl } from './support.js'
import { CrystalApiCollections } from './collections.js'

/** Datasets: media, captions, access and archival. */
export abstract class CrystalApiDatasets extends CrystalApiCollections {
  // ── Datasets (T4) ────────────────────────────────────────────────────────

  protected _datasetsStore(): Datasets {
    const store = this.deps.datasets
    if (!store) throw new ApiError('not_found.dataset', 'datasets unavailable', 404)
    return store
  }

  /** Datasets are animaId-keyed like Provincia — anonymous (commitment/bursa) callers
   *  cannot own one (mirrors `_projectAnimaId`). */
  protected _datasetOwner(auctor: AuctorKey): string {
    if ('animaId' in auctor) return auctor.animaId
    throw Errors.authForbidden('datasets require an identified account')
  }

  /** Pull every media REFERENCE out of an Actum's opaque `exitus` — the generic v1
   *  heuristic for "the media this run produced" (exitus has no fixed cross-modus
   *  schema; `additionalProperties: true` in apiContract.ts's RunSchema).
   *
   *  A reference is either an `http(s)` URL or a `noema-private://` marker. Both are how a
   *  completed run records its output: a public run stores the URL, and a run with private
   *  outputs stores the marker (`src/crystal/MediaFetcher.ts`), which names the same object in
   *  a bucket with no public binding. A scheme test that admitted only `http(s)` would read a
   *  private run as having produced nothing. */
  protected _mediaRefsFromExitus(exitus: Record<string, unknown> | undefined): string[] {
    const refs: string[] = []
    const visit = (v: unknown): void => {
      if (typeof v === 'string' && (/^https?:\/\//.test(v) || isPrivateMarker(v))) refs.push(v)
      else if (Array.isArray(v)) v.forEach(visit)
      else if (v && typeof v === 'object') Object.values(v).forEach(visit)
    }
    visit(exitus)
    return refs
  }

  /** List the full `Dataset[]` for the caller — the caller's own UNION the datasets shared with
   *  a team they are a member of, cursor-paginated (mirrors `GET /v1/me/runs`'s
   *  `?cursor=`/`?limit=` precedent). The access predicate goes INTO the store query, so one
   *  filtered result set is paginated rather than a page being post-filtered. */
  async listDatasets(auctor: AuctorKey, opts: { cursor?: string; limit?: number } = {}): Promise<{ datasets: Dataset[]; nextCursor?: string }> {
    const owner = this._datasetOwner(auctor)
    const sodalitasIds = await this._callerTeamIds(auctor)
    const { entries, nextCursor } = await this._datasetsStore().list({ owner, sodalitasIds, ...opts })
    const datasets = await Promise.all(entries.map((d) => this._resolveDatasetMedia(d)))
    return { datasets, ...(nextCursor ? { nextCursor } : {}) }
  }

  /** List the thin `DatasetSummary[]` projection for the caller — the training-run
   *  picker's consumer. Same store, same scoping (own + team-shared), projected down. */
  async listDatasetSummaries(auctor: AuctorKey, opts: { cursor?: string; limit?: number } = {}): Promise<{ datasets: DatasetSummary[]; nextCursor?: string }> {
    const owner = this._datasetOwner(auctor)
    const sodalitasIds = await this._callerTeamIds(auctor)
    const { entries, nextCursor } = await this._datasetsStore().listSummaries({ owner, sodalitasIds, ...opts })
    return { datasets: entries, ...(nextCursor ? { nextCursor } : {}) }
  }

  /**
   * The public dataset catalog — every dataset `access.kind === 'public'` names, scoped to
   * nobody in particular. Public, NO AUTH: mirrors `listModels`'s catalog precedent — browsing
   * what the platform publishes should not gate on having an account, even though USING one
   * still does (spawning a Muse session, appending media, everything else on the dataset
   * surface stays authenticated through `getDataset`/`_contributableDataset`).
   *
   * Falls back to an empty page when the wired store has not implemented `listPublic` — the
   * same fail-closed convention `findOwned`'s absence follows — rather than throwing, so a
   * deployment mid-upgrade shows an empty catalog instead of a 500.
   */
  async listPublicDatasets(opts: { cursor?: string; limit?: number } = {}): Promise<{ datasets: Dataset[]; nextCursor?: string }> {
    const store = this._datasetsStore()
    if (!store.listPublic) return { datasets: [] }
    const { entries, nextCursor } = await store.listPublic(opts)
    const datasets = await Promise.all(entries.map((d) => this._resolveDatasetMedia(d)))
    return { datasets, ...(nextCursor ? { nextCursor } : {}) }
  }

  /**
   * May this caller CONTRIBUTE to this Dataset — the owner, or a member of the team it is
   * shared with? Deliberately narrower than "may read": `access.kind === 'public'` is NOT an
   * arm here. Publishing a dataset makes it usable and viewable by anyone; it does not open it
   * to a stranger appending media or editing captions onto a set someone else curated. See
   * `getDataset`'s docstring for the read/contribute split this predicate is one half of.
   *
   * `Collectio`'s `_ownsCollection` verbatim in shape: the direct owner, then the `Sodalitas`
   * overlay resolved through the team store. Absent `sodalitasId`, absent team store, or an
   * anonymous caller all fall through to owner-only, so nothing a stranger could reach before
   * this existed becomes reachable now.
   */
  protected async _ownsDataset(auctor: AuctorKey, d: Dataset): Promise<boolean> {
    if (!('animaId' in auctor)) return false
    if (d.owner === auctor.animaId) return true
    if (d.sodalitasId === undefined) return false
    const team = await this.deps.sodalitatum?.find(d.sodalitasId)
    return team?.membra.includes(auctor.animaId) ?? false
  }

  /** Resolve a Dataset the caller may CONTRIBUTE to — `_ownsDataset` alone, never widened by
   *  `access: 'public'`. `addDatasetMedia`/`addCaptionset`/`setCaption` resolve through THIS,
   *  not `getDataset`, exactly because `getDataset` now also admits a public read: were they to
   *  share that gate, publishing a dataset would silently open it to anyone's writes. Returns
   *  the raw record (unresolved private-media markers) — every caller here reads only `.id`,
   *  `.media` (id membership) or `.captionsets`, never a URL, so no marker needs resolving. */
  protected async _contributableDataset(auctor: AuctorKey, id: string): Promise<Dataset> {
    this._datasetOwner(auctor)
    const d = await this._datasetsStore().find(id)
    if (!d || !(await this._ownsDataset(auctor, d))) {
      throw new ApiError('not_found.dataset', `Dataset '${id}' not found`, 404)
    }
    return d
  }

  /**
   * Project a Dataset for a reader: every `noema-private://` media reference resolved into a
   * short-lived presigned GET, everything else untouched.
   *
   * WHAT IS STORED IS THE MARKER. A presigned link lapses in minutes and a dataset is durable —
   * persisting one would write a media reference that stops resolving while the record it sits
   * on is still in use — so `_mintMedia` records the marker and resolution happens HERE, at read
   * time. This is `_presignPrivateExitus`'s rule applied to the second record that carries a
   * run's output: the marker is the durable reference, the link is the momentary view of it.
   *
   * CALLED ONLY behind the dataset access gate, and it never widens one. Every caller has
   * already resolved through `getDataset`/`_ownedDatasetByOwner` (or the owner-scoped list
   * query), which is where "may this caller reach this dataset" is decided; this method only
   * projects what that gate already returned.
   *
   * A marker that cannot be presigned (no private-outputs store configured, or the store
   * refuses) is left as the opaque marker it is — never degraded to a public URL, which would
   * name the object in a bucket that has no public binding anyway.
   */
  protected async _resolveDatasetMedia(d: Dataset): Promise<Dataset> {
    if (!d.media.some((m) => isPrivateMarker(m.url))) return d
    const media = await Promise.all(d.media.map(async (m) => {
      const signed = await this._presignPrivateRef(m.url)
      return signed ? { ...m, url: signed } : m
    }))
    return { ...d, media }
  }

  /** Resolve a Dataset the caller may READ — theirs, shared with a team they belong to, or
   *  `access.kind === 'public'` — or 404 (a caller with no claim on it gets not_found, not
   *  forbidden, so ids stay non-enumerable — mirrors `_ownedTabula`/`_ownedProject`/
   *  `_ownedCollection`).
   *
   *  NO IDENTITY REQUIREMENT UP FRONT, unlike every other dataset seam — deliberately, since
   *  2026-09-02: rth's ruling is that an anonymous visitor may sit at a public dataset's Muse
   *  session (see it, its captions, its decomposed fragments) and configure it, with no account
   *  at all. `_ownsDataset` already resolves `false` rather than throwing for a caller with no
   *  `animaId`, so the public arm below is the only way an anonymous caller ever succeeds here —
   *  a private dataset stays exactly as closed to them as it always was.
   *
   *  THIS IS THE READ GATE ONLY, no longer the contribute one: `spawnMuseSession`,
   *  `_motherPool` and `promoteMuseSession` resolve a mother dataset through here on purpose
   *  (starting a Muse session, or reading a mother's name, is a read), but the three additive
   *  writes — append media, attach or edit a captionset — resolve through
   *  `_contributableDataset` instead, which does NOT admit `public`. Splitting these was the
   *  point of adding `access`: without it, widening this gate for public reads would have
   *  silently opened every public dataset to a stranger's writes too. The DESTRUCTIVE verbs sit
   *  apart from both — archive/restore re-check `_ownedDatasetByOwner`, the same way
   *  `extendCollection` re-checks `_isFunder` on the one verb a team member must not perform on
   *  the principal's behalf.
   *
   *  Private media is resolved into short-lived links AFTER the gate above, exactly as
   *  `getRun` presigns a run's exitus after its ownership check. */
  async getDataset(auctor: AuctorKey, id: string): Promise<Dataset> {
    const d = await this._datasetsStore().find(id)
    const readable = d !== null && (d.access?.kind === 'public' || (await this._ownsDataset(auctor, d)))
    if (!d || !readable) {
      throw new ApiError('not_found.dataset', `Dataset '${id}' not found`, 404)
    }
    return this._resolveDatasetMedia(d)
  }

  /** Resolve a Dataset this caller OWNS OUTRIGHT — the narrow gate the destructive dataset
   *  verbs keep. A team member reads and contributes; retiring the dataset (or retiring one of
   *  its media items from the working set) stays with the single scalar `owner`, because the
   *  team overlay adds readers and contributors, not a second principal. A member gets the same
   *  `not_found` a stranger gets, so the refusal leaks nothing either. */
  protected async _ownedDatasetByOwner(auctor: AuctorKey, id: string): Promise<Dataset> {
    const owner = this._datasetOwner(auctor)
    const d = await this._datasetsStore().find(id)
    if (!d || d.owner !== owner) throw new ApiError('not_found.dataset', `Dataset '${id}' not found`, 404)
    return d
  }

  /** Create a Dataset, either seeded through one of the two v1 ingestion paths (Q2) or EMPTY.
   *
   *  `source: 'upload'` takes already-signed R2 media URLs from `POST /storage/uploads/sign`;
   *  `source: 'generation'` resolves media from the caller's own completed Acta. Omitting
   *  `source` opens the dataset with no media, to be filled afterwards through the append route
   *  `POST /v1/data/datasets/:id/media` — the same route a seeded dataset grows through. A
   *  `source` present but naming neither path is still a 400.
   *
   *  Omission rather than a sentinel value, because an empty create is the ABSENCE of ingestion
   *  rather than a third kind of it: `_mintMedia` keeps exactly two arms and stays the only
   *  place media is minted, and the empty create simply does not reach it. The validation that
   *  remains meaningful is unchanged — a caller that names a path and then supplies nothing
   *  (`'upload'` with an empty `mediaUrls`, `'generation'` with an empty `actumIds`) is refused
   *  by `_mintMedia` exactly as before, and media fields supplied with no `source` at all are
   *  refused here rather than silently dropped.
   *
   *  The dataset's version history is the same shape whether or not it was seeded: `1.0.0` at
   *  the media count it was created with, which for an empty dataset is `0`. The first append
   *  then records `1.1.0` through `nextDatasetVersion`, so an empty dataset reads as a dataset
   *  at version one holding nothing, never as a record missing its history.
   *
   *  An optional `teamId` shares the new dataset with a `Sodalitas`, stored as
   *  `Dataset.sodalitasId`. It is validated through `_memberTeam` — the SAME seam
   *  `createProject` and `collect` validate theirs through — so a caller can only share a
   *  dataset with a team they are themselves a member of, and a team id that does not exist or
   *  that they do not belong to 404s before anything is written. */
  async createDataset(auctor: AuctorKey, input: CreateDatasetInput): Promise<Dataset> {
    const owner = this._datasetOwner(auctor)
    const store = this._datasetsStore()
    const now = new Date()

    if (!input || (input.source !== undefined && input.source !== 'upload' && input.source !== 'generation')) {
      throw Errors.inputMalformed("source, when present, must be 'upload' or 'generation'")
    }
    if (input.source === undefined) {
      // No source means no ingestion. Media fields carried alongside are refused rather than
      // dropped: a body naming media the create would not mint is a body whose author expected
      // a different outcome than an empty dataset.
      const carried = input as {
        mediaUrls?: IngestMediaFromUpload['mediaUrls']
        actumIds?: IngestMediaFromGeneration['actumIds']
      }
      if (carried.mediaUrls !== undefined || carried.actumIds !== undefined) {
        throw Errors.inputMalformed('source is required when mediaUrls or actumIds are supplied')
      }
    }
    if (typeof input.name !== 'string' || !input.name.trim()) {
      throw Errors.inputMalformed('name is required')
    }
    const modality = input.modality
    if (!modality || !['image', 'video', 'audio', '3d'].includes(modality)) {
      throw Errors.inputMalformed("modality must be one of 'image' | 'video' | 'audio' | '3d'")
    }
    // Membership is affirmed BEFORE any media is minted, so a rejected share cannot leave a
    // half-created dataset behind.
    if (input.teamId !== undefined) await this._memberTeam(auctor, input.teamId)

    const media = input.source === undefined ? [] : await this._mintMedia(auctor, input, now)

    // The record keeps the durable references it was minted with; the RESPONSE is a read, and
    // reads resolve private markers into short-lived links.
    return this._resolveDatasetMedia(await store.create({
      owner,
      ...(input.teamId !== undefined ? { sodalitasId: input.teamId } : {}),
      name: input.name,
      modality,
      custody: input.custody ?? 'local',
      media,
      captionsets: [],
      versions: [{ v: '1.0.0', count: media.length, when: now }],
    }))
  }

  /** Mint `DatasetMediaItem`s from either v1 ingestion shape. The ONE minting path: dataset
   *  creation and a later media append both come through here, so the two cannot diverge on
   *  what a valid body is, on how an id is assigned, or on what a `generation` source is
   *  allowed to reach. A named Actum must be the caller's own and `completus` — resolved from
   *  the authenticated caller, never from anything else in the body.
   *
   *  THE ACTUM CHECK DOES NOT WIDEN WITH THE DATASET GATE. A team member may contribute to a
   *  shared dataset, and what they contribute is their OWN generations: `_owns(auctor, actum)`
   *  is still the caller's own run, never the owner's and never another member's. Sharing a
   *  dataset grants a place to put work, not a claim on anyone's runs.
   *
   *  Every item is stamped with `addedBy` — the animaId of the caller who added it, from the
   *  authenticated caller and nowhere else. On a shared dataset this is the whole of who
   *  contributed what; on a single-owner dataset it is redundant with `owner` and harmless. */
  protected async _mintMedia(auctor: AuctorKey, input: IngestMediaInput, now: Date): Promise<DatasetMediaItem[]> {
    // Both entry points (`createDataset`, `addDatasetMedia`) have already refused an anonymous
    // caller through `_datasetOwner`, so this is present in practice; it stays a conditional
    // spread rather than an assertion because the FIELD is optional and an absent attribution
    // is a truthful record, not a defaulted one.
    const addedBy = 'animaId' in auctor ? { addedBy: auctor.animaId } : {}

    if (input.source === 'upload') {
      if (!Array.isArray(input.mediaUrls) || input.mediaUrls.length === 0) {
        throw Errors.inputMalformed('mediaUrls is required and must be non-empty for an upload source')
      }
      return dedupeByUrl(
        input.mediaUrls.map((url) => ({ id: uuidv4(), url, source: 'upload' as const, addedAt: now, ...addedBy })),
      )
    }

    if (!Array.isArray(input.actumIds) || input.actumIds.length === 0) {
      throw Errors.inputMalformed('actumIds is required and must be non-empty for a generation source')
    }
    const acta = await Promise.all(input.actumIds.map((id) => this.deps.actorum.findById(id)))
    const media: DatasetMediaItem[] = []
    for (let i = 0; i < acta.length; i++) {
      const actum = acta[i]
      const actumId = input.actumIds[i]
      if (!actum || !(await this._owns(auctor, actum))) throw Errors.notFoundRun(actumId)
      if (actum.status !== 'completus') throw Errors.inputMalformed(`Actum '${actumId}' has not completed`)
      // The REFERENCE is what lands on the record, verbatim — an `http(s)` URL for a public run
      // and the `noema-private://` marker for a private one. A marker is durable and a presign
      // is not (it lapses in minutes), and a dataset outlives both; the marker is resolved to a
      // link on every owner-scoped read instead (`_resolveDatasetMedia`).
      const refs = this._mediaRefsFromExitus(actum.exitus)
      for (const url of refs) media.push({ id: uuidv4(), url, source: 'generation' as const, actumId, addedAt: now, ...addedBy })
    }
    if (media.length === 0) {
      throw Errors.inputMalformed(
        'none of the referenced Acta recorded a media reference in their exitus (no http(s) URL and no private-output marker)',
      )
    }
    return dedupeByUrl(media)
  }

  /**
   * Append media to a Dataset the caller owns.
   *
   * A dataset's media set grows: `DatasetVersion` is documented as a snapshot that grows as
   * media is added, and `Captionset.captions` is keyed by media id precisely so an append does
   * not re-bind captions. This is the writer under that contract.
   *
   * APPEND-ONLY, deliberately. Nothing here removes, replaces or reorders media — removal has
   * consequences for caption maps, for fragments already decomposed off an item, and for the
   * provenance of a model trained from the dataset, and it is a separate decision.
   *
   * Access resolves through `_contributableDataset` — the same seam `addCaptionset` uses, never
   * `getDataset` (which also admits a public read) — so the caller comes from the
   * authentication and never from a request parameter; a dataset the caller has no claim on
   * reports as not found, exactly as an id that never existed does. THIS IS THE CONTRIBUTION
   * SEAM: the dataset's owner, or a member of the `Sodalitas` it is shared with, may append. A
   * public reader may not — publishing a dataset does not open it to a stranger's uploads. What
   * a member appends is still their OWN work — `_mintMedia` keeps requiring
   * every named Actum to be the caller's own and `completus`, which the team overlay does not
   * touch. Each item is stamped with the contributor's animaId (`DatasetMediaItem.addedBy`).
   *
   * The body is the same discriminated ingestion shape `POST /v1/data/datasets` takes, minted
   * through the same path; a body matching neither shape is a 400.
   */
  async addDatasetMedia(auctor: AuctorKey, datasetId: string, input: unknown): Promise<Dataset> {
    const d = await this._contributableDataset(auctor, datasetId)

    const body = (input ?? {}) as Partial<IngestMediaInput>
    if (body.source !== 'upload' && body.source !== 'generation') {
      throw Errors.inputMalformed("source must be 'upload' or 'generation'")
    }

    const minted = await this._mintMedia(auctor, body as IngestMediaInput, new Date())
    // The same image added twice does not land twice. Identity is the stored `url` — the http(s)
    // reference or the durable `noema-private://` marker, never a presign, which lapses. Adding a
    // folder that overlaps one already added is the ordinary accident here, and before this it
    // silently doubled the dataset: every item minted a fresh uuid, so nothing collided.
    const held = new Set(d.media.map((m) => m.url))
    const items = minted.filter((m) => !held.has(m.url))
    // Everything was already here. Return the dataset untouched rather than calling the store:
    // `addMedia` stamps a new DatasetVersion unconditionally, so appending nothing would record
    // a version whose count never moved, and a version row is a snapshot somebody may train from.
    if (items.length === 0) return this._resolveDatasetMedia(d)
    const updated = await this._datasetsStore().addMedia(d.id, items)
    if (!updated) throw new ApiError('not_found.dataset', `Dataset '${datasetId}' not found`, 404)
    return this._resolveDatasetMedia(updated)
  }

  /** Attach (or replace) a captionset on a Dataset the caller may reach — its owner, or a
   *  member of the team it is shared with (captioning is additive work ON the set, which is
   *  what contributing to a shared training set means). The captionset id comes from the caller
   *  so a re-run of the same caption pass replaces its previous result instead of accumulating
   *  duplicates.
   *
   *  Access resolves through `_contributableDataset` — never `getDataset`, which also admits a
   *  public read now; a stranger gets `not_found`, never `forbidden`, same as before `access`
   *  existed. Caption keys must be media ids actually on the dataset: a key bound to nothing
   *  would still count toward coverage. `coverage` is derived here, never taken from the body. */
  async addCaptionset(auctor: AuctorKey, datasetId: string, input: unknown): Promise<Dataset> {
    const d = await this._contributableDataset(auctor, datasetId)
    const body = (input ?? {}) as Partial<Captionset>

    const id = typeof body.id === 'string' ? body.id.trim() : ''
    if (!id) throw Errors.inputMalformed('id is required')
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) throw Errors.inputMalformed('name is required')
    const method = typeof body.method === 'string' ? body.method.trim() : ''
    if (!method) throw Errors.inputMalformed('method is required')

    const captions = this._validCaptions(d, body.captions)
    const captionset: Captionset = {
      id,
      name,
      method,
      coverage: coverageOver(captions, d.media),
      ...(captions ? { captions } : {}),
    }

    const updated = await this._datasetsStore().addCaptionset(d.id, captionset)
    if (!updated) throw new ApiError('not_found.dataset', `Dataset '${datasetId}' not found`, 404)
    return this._resolveDatasetMedia(updated)
  }

  /** Edit one caption of one captionset on a Dataset the caller may CONTRIBUTE to (a captionset
   *  is editable after generation). Same access resolution as `addCaptionset` — owner or team
   *  member, never a public reader; the captionset must already exist and the media id must be
   *  on the dataset. */
  async setCaption(auctor: AuctorKey, datasetId: string, captionsetId: string, mediaId: string, caption: unknown): Promise<Dataset> {
    const d = await this._contributableDataset(auctor, datasetId)

    if (typeof caption !== 'string' || !caption.trim()) throw Errors.inputMalformed('caption must be a non-empty string')
    if (!d.media.some((m) => m.id === mediaId)) {
      throw Errors.inputMalformed(`mediaId '${mediaId}' is not a media item on this dataset`)
    }
    if (!d.captionsets.some((c) => c.id === captionsetId)) {
      throw new ApiError('not_found.dataset', `Captionset '${captionsetId}' not found`, 404)
    }

    const updated = await this._datasetsStore().setCaption(d.id, captionsetId, mediaId, caption)
    if (!updated) throw new ApiError('not_found.dataset', `Captionset '${captionsetId}' not found`, 404)
    return this._resolveDatasetMedia(updated)
  }

  /**
   * Archive a Dataset the caller owns — the delete that strands nothing.
   *
   * The dataset leaves both list routes and every picker built on them; it is not erased, and
   * `getDataset` still resolves it, so a Muse session's mother, a session dataset behind a
   * saved piece, and a past run's lineage all keep working. Reversible through
   * `restoreDataset`.
   *
   * OWNER-ONLY, and narrower than the read gate on purpose: it resolves through
   * `_ownedDatasetByOwner`, not `getDataset`. Retiring a dataset is the destructive verb, and
   * the team overlay adds readers and contributors, not a second principal who may retire the
   * owner's set — the same reason `extendCollection` re-checks `_isFunder` on a Collectio every
   * member otherwise reaches. The owner comes from the authenticated caller, never from a
   * request parameter, so a dataset the caller does not own reports as not found, exactly as an
   * id that never existed does. Nothing here spends.
   */
  async archiveDataset(auctor: AuctorKey, datasetId: string): Promise<Dataset> {
    const d = await this._ownedDatasetByOwner(auctor, datasetId)
    const updated = await this._datasetsStore().archiveDataset(d.id)
    if (!updated) throw new ApiError('not_found.dataset', `Dataset '${datasetId}' not found`, 404)
    return this._resolveDatasetMedia(updated)
  }

  /**
   * Publish (or unpublish) a Dataset — set `access.kind` to `'public'` or back to `'private'`.
   * OWNER-ONLY, same reasoning as `archiveDataset`: this is a decision about the set's whole
   * public face, not additive work a team member contributes, so it resolves through
   * `_ownedDatasetByOwner` rather than `getDataset`/`_contributableDataset`. Reversible in
   * either direction — `'private'` is a real write here, not an absence, so an owner can always
   * take a set back out of the catalog. Nothing here spends, and nothing here checks whether
   * the set has captions or fragments yet: an owner may publish an empty board, and the Muse
   * screen's own roll button (disabled at zero live fragments) is where that becomes visible,
   * not a refusal here.
   */
  async setDatasetAccess(auctor: AuctorKey, datasetId: string, kind: 'public' | 'private'): Promise<Dataset> {
    const d = await this._ownedDatasetByOwner(auctor, datasetId)
    const updated = await this._datasetsStore().setAccess(d.id, kind)
    if (!updated) throw new ApiError('not_found.dataset', `Dataset '${datasetId}' not found`, 404)
    return this._resolveDatasetMedia(updated)
  }

  /** Restore an archived Dataset the caller owns — it returns to both list routes. Same
   *  owner-only resolution as `archiveDataset` (a restore is the other half of the same
   *  lifecycle verb, so it cannot be looser than the archive it undoes); an archived dataset
   *  still resolves through `find`, which is what makes a restore reachable at all. */
  async restoreDataset(auctor: AuctorKey, datasetId: string): Promise<Dataset> {
    const d = await this._ownedDatasetByOwner(auctor, datasetId)
    const updated = await this._datasetsStore().restoreDataset(d.id)
    if (!updated) throw new ApiError('not_found.dataset', `Dataset '${datasetId}' not found`, 404)
    return this._resolveDatasetMedia(updated)
  }

  /** Archive ONE media item on a Dataset the caller owns. The item leaves the working set —
   *  the caption manifest, the decompose, the summary count, Muse's fragment pool — and every
   *  captionset's coverage is recomputed against the media that is left. The record itself
   *  stays, because caption maps and fragments are keyed on the media id. OWNER-ONLY, for the
   *  same reason `archiveDataset` is: retiring media from the working set is destructive, and a
   *  team member contributes to the set rather than deciding what leaves it. A media id naming
   *  no item on the dataset is a 400. */
  async archiveDatasetMedia(auctor: AuctorKey, datasetId: string, mediaId: string): Promise<Dataset> {
    const d = await this._ownedDatasetWithMedia(auctor, datasetId, mediaId)
    const updated = await this._datasetsStore().archiveMedia(d.id, mediaId)
    if (!updated) throw new ApiError('not_found.dataset', `Dataset '${datasetId}' not found`, 404)
    return this._resolveDatasetMedia(updated)
  }

  /** Restore ONE archived media item on a Dataset the caller owns — it rejoins the working set
   *  and every captionset's coverage is recomputed against it. */
  async restoreDatasetMedia(auctor: AuctorKey, datasetId: string, mediaId: string): Promise<Dataset> {
    const d = await this._ownedDatasetWithMedia(auctor, datasetId, mediaId)
    const updated = await this._datasetsStore().restoreMedia(d.id, mediaId)
    if (!updated) throw new ApiError('not_found.dataset', `Dataset '${datasetId}' not found`, 404)
    return this._resolveDatasetMedia(updated)
  }

  /** Resolve a Dataset the caller OWNS OUTRIGHT and assert the media id names an item on it —
   *  the media-scoped half of the destructive gate, in one place so the two media lifecycle
   *  writes cannot drift on what a valid target is. An ARCHIVED item is still a valid target:
   *  it is on the dataset, and it is exactly what a restore names. */
  protected async _ownedDatasetWithMedia(auctor: AuctorKey, datasetId: string, mediaId: string): Promise<Dataset> {
    const d = await this._ownedDatasetByOwner(auctor, datasetId)
    if (!d.media.some((m) => m.id === mediaId)) {
      throw Errors.inputMalformed(`mediaId '${mediaId}' is not a media item on this dataset`)
    }
    return d
  }

  /** Validate a caption map against the dataset's own media, or throw. Every key must be
   *  a media id on this dataset and every value a non-empty string. */
  protected _validCaptions(d: Dataset, raw: unknown): Record<string, string> | undefined {
    if (raw === undefined || raw === null) return undefined
    if (typeof raw !== 'object' || Array.isArray(raw)) throw Errors.inputMalformed('captions must be an object keyed by media id')
    const mediaIds = new Set(d.media.map((m) => m.id))
    const out: Record<string, string> = {}
    for (const [mediaId, caption] of Object.entries(raw as Record<string, unknown>)) {
      if (!mediaIds.has(mediaId)) throw Errors.inputMalformed(`mediaId '${mediaId}' is not a media item on this dataset`)
      if (typeof caption !== 'string' || !caption.trim()) throw Errors.inputMalformed(`caption for '${mediaId}' must be a non-empty string`)
      out[mediaId] = caption
    }
    return out
  }
}
