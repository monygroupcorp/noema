// =============================================================================
// intellaSourceRepair — pure decision logic for repairing HuggingFace download
// URIs on `Intella.sources[]` after the hub org rename.
// =============================================================================
//
// The HuggingFace org `ms2stationthis` was renamed to `noema-art`. Stored
// download URIs still name the old org, and they are dead on TWO independent
// axes:
//
//   1. the `/resolve/` download path does NOT follow an org rename (the API
//      path `/api/models/{org}/{repo}` does — the download path does not), and
//   2. filenames inside the renamed repos changed as well.
//
// So rewriting the org alone produces a set of differently-broken URLs while
// making the records look repaired. Every function here is pure — no Mongo, no
// network — so the decision rules are unit-testable, and the migration script
// that uses them (`scripts/migrations/2026_08_repair_intella_source_uri.ts`)
// stays a thin shell around proven-correct choices.
//
// Nothing imports this at runtime; it exists for the migration and its tests.

/** The org name that was renamed away. Stale URIs are exactly those under it. */
export const STALE_HF_ORG = 'ms2stationthis'

/** The org those repos live under now. Every rebuilt URI is emitted under this. */
export const CURRENT_HF_ORG = 'noema-art'

/** Extensions that denote model weights (the file a `/resolve/` URI must point at). */
export const WEIGHT_EXTENSIONS = ['.safetensors', '.ckpt', '.pt', '.bin', '.gguf'] as const

/** The parts of a HuggingFace `/resolve/` download URI. */
export interface HfResolveParts {
  org: string
  repo: string
  branch: string
  file: string
}

/** Outcome of picking a replacement filename: either a file, or a reported ambiguity. */
export type FileChoice = { file: string } | { ambiguous: string }

const HF_RESOLVE_RE =
  /^https:\/\/huggingface\.co\/([^/\s]+)\/([^/\s]+)\/resolve\/([^/\s]+)\/(\S+)$/

/**
 * Parse a HuggingFace `/resolve/` download URI into its parts.
 *
 * Matches ONLY `https://huggingface.co/{org}/{repo}/resolve/{branch}/{file}`
 * (the shape documented on `IntellaSource.uri`). Anything else — a
 * miladystation or civitai URI, or a HuggingFace URL that is not a `/resolve/`
 * download path — returns `null` and is left completely alone.
 */
export function parseHfResolveUri(uri: string): HfResolveParts | null {
  if (typeof uri !== 'string') return null
  const m = HF_RESOLVE_RE.exec(uri.trim())
  if (!m) return null
  const [, org, repo, branch, file] = m
  return { org, repo, branch, file }
}

/** True when an org is the renamed-away one. One constant, one place. */
export function isStaleOrg(org: string): boolean {
  return org === STALE_HF_ORG
}

/** True when a repo-relative path names a weights file. */
export function isWeightFile(file: string): boolean {
  const lower = file.toLowerCase()
  return WEIGHT_EXTENSIONS.some(ext => lower.endsWith(ext))
}

/**
 * Choose the filename the repaired URI should point at, given the repo's real
 * `siblings` listing (from the HF API) and, optionally, the source's declared
 * `format`.
 *
 * Priority order — the FIRST rule that hits wins:
 *   1. `siblings` contains `oldFile` verbatim → keep it (only the org moved).
 *   2. exactly one sibling is a weight file → take it.
 *   3. several weight files, exactly one of which matches `format`'s
 *      extension → take that one.
 *   4. otherwise → ambiguous, naming the candidates.
 *
 * An ambiguity is NEVER resolved by picking the closest-looking name. It is
 * reported so an operator decides.
 */
export function chooseReplacementFile(
  oldFile: string,
  siblings: readonly string[],
  format?: string,
): FileChoice {
  if (siblings.includes(oldFile)) return { file: oldFile }

  const weights = siblings.filter(isWeightFile)
  if (weights.length === 0) {
    return {
      ambiguous:
        `no weight file among siblings (${WEIGHT_EXTENSIONS.join(', ')}); ` +
        `siblings: ${describe(siblings)}`,
    }
  }
  if (weights.length === 1) return { file: weights[0] }

  if (format) {
    const ext = `.${format.toLowerCase()}`
    const matching = weights.filter(f => f.toLowerCase().endsWith(ext))
    if (matching.length === 1) return { file: matching[0] }
    return {
      ambiguous:
        `${weights.length} weight files and ${matching.length} match format '${format}'; ` +
        `candidates: ${describe(weights)}`,
    }
  }

  return {
    ambiguous:
      `${weights.length} weight files and the source declares no format; ` +
      `candidates: ${describe(weights)}`,
  }
}

/**
 * Build a `/resolve/` download URI under the CURRENT org. The `org` field of
 * the input is deliberately ignored: a rebuilt URI never carries the
 * renamed-away org, even when the parts it was derived from do.
 */
export function buildResolveUri(parts: HfResolveParts): string {
  return `https://huggingface.co/${CURRENT_HF_ORG}/${parts.repo}/resolve/${parts.branch}/${parts.file}`
}

function describe(files: readonly string[]): string {
  return files.length > 0 ? files.join(', ') : '(none)'
}
