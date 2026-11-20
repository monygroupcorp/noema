// =============================================================================
// defaultDataset — the account's default Dataset pointer
// =============================================================================
//
// noema/telegram-photos-into-a-dataset clause 1: "an account has a default dataset it can
// see and change." No `Dataset` carries a "default"/"active"/"current" flag on itself — the
// pointer lives on the owner's `Consuetudinum.Generatio.defaultDatasetId` (ADR-0003's one
// owner-keyed account-state home), the same shape `defaultProjectId` already uses for the
// analogous "land in project" choice. Platform-neutral: Telegram's `/dataset` + `/collect`
// are the only callers today, but nothing here is Telegram-specific.
// =============================================================================

import type { AuctorKey } from '../flow/types.js'
import type { Consuetudinum } from '../types/consuetudo.js'
import type { Dataset, Datasets } from '../types/dataset.js'

export interface DefaultDatasetDeps {
  datasets: Datasets
  consuetudinum: Consuetudinum
}

/** The name a first-ever default dataset is minted with. Renamed any time from the web — this
 *  is only ever the seed. */
export const DEFAULT_DATASET_NAME = 'Telegram collection'

/** `Dataset.owner` is animaId-scoped (mirrors `Provincia.owner`) — the same restriction
 *  `CrystalApi._datasetOwner` enforces for every other dataset entry point. Telegram always
 *  resolves an identified `{animaId}` (`TelegramIdentityResolver`), so this holds in practice
 *  for every caller collecting mode has today. */
function ownerAnimaId(owner: AuctorKey): string {
  if ('animaId' in owner) return owner.animaId
  throw new Error('a default dataset requires an identified account')
}

/** The account's default dataset, or null when none is set, or the pointer no longer
 *  resolves to a live dataset this account still owns (archived, deleted, or — defensively —
 *  reassigned). Never mints one; see `ensureDefaultDataset` for that. */
export async function getDefaultDataset(owner: AuctorKey, deps: DefaultDatasetDeps): Promise<Dataset | null> {
  const generatio = await deps.consuetudinum.resolveGeneratio(owner)
  if (!generatio?.defaultDatasetId) return null
  const found = await deps.datasets.find(generatio.defaultDatasetId)
  if (!found || found.archivum || found.owner !== ownerAnimaId(owner)) return null
  return found
}

/** The account's default dataset, minting one (named `DEFAULT_DATASET_NAME`) the first time
 *  there is none to point at. The one path collecting mode always lands on. */
export async function ensureDefaultDataset(owner: AuctorKey, deps: DefaultDatasetDeps): Promise<Dataset> {
  return (await getDefaultDataset(owner, deps)) ?? createDefaultDataset(owner, DEFAULT_DATASET_NAME, deps)
}

/** Create a fresh, empty dataset and point the default at it (`/dataset new <name>`). */
export async function createDefaultDataset(owner: AuctorKey, name: string, deps: DefaultDatasetDeps): Promise<Dataset> {
  const now = new Date()
  const created = await deps.datasets.create({
    owner: ownerAnimaId(owner),
    name,
    modality: 'image',
    custody: 'remote',
    media: [],
    captionsets: [],
    versions: [{ v: '1.0.0', count: 0, when: now }],
  })
  await _pointDefaultAt(owner, created.id, deps)
  return created
}

/** Point the default at an existing dataset this caller owns (`/dataset use <name-or-id>`).
 *  Matches by id first, then by a case-insensitive exact name among the caller's OWN live
 *  datasets — team-shared datasets are not offered as a default, since the pointer is a
 *  personal setting, not a shared one. Returns null when nothing matches. */
export async function setDefaultDataset(owner: AuctorKey, nameOrId: string, deps: DefaultDatasetDeps): Promise<Dataset | null> {
  const ownerId = ownerAnimaId(owner)
  const byId = await deps.datasets.find(nameOrId)
  let target: Dataset | null = byId && byId.owner === ownerId && !byId.archivum ? byId : null
  if (!target) {
    const own = await listOwnDatasets(owner, deps)
    target = own.find((d) => d.name.toLowerCase() === nameOrId.toLowerCase()) ?? null
  }
  if (!target) return null
  await _pointDefaultAt(owner, target.id, deps)
  return target
}

/** The caller's own live datasets — `/dataset list`'s read. */
export async function listOwnDatasets(owner: AuctorKey, deps: DefaultDatasetDeps): Promise<Dataset[]> {
  const { entries } = await deps.datasets.list({ owner: ownerAnimaId(owner), limit: 50 })
  return entries.filter((d) => !d.archivum)
}

async function _pointDefaultAt(owner: AuctorKey, datasetId: string, deps: DefaultDatasetDeps): Promise<void> {
  const generatio = await deps.consuetudinum.resolveGeneratio(owner)
  await deps.consuetudinum.setGeneratio(owner, { ...(generatio ?? {}), defaultDatasetId: datasetId })
}
