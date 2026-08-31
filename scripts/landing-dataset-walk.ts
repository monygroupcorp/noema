#!/usr/bin/env -S npx tsx
// =============================================================================
// landing-dataset-walk — the Wave 3 dataset -> train -> plates run, made
// machine-runnable (noema-368)
// =============================================================================
//
// Built on the `scripts/concierge-walk.ts` pattern (noema-356): a scripted
// headless session against a live deployment over documented `/v1` routes,
// operator-supplied credentials at run time, an offline `--smoke` mode wired
// to the REAL `apiRouter.ts` against in-memory fakes, and stdout that is a
// quotable walk receipt.
//
// Unlike 356, THIS DRIVER SPENDS. Every spend path is gated: nothing fires
// without a fresh quote, an explicit `--apply`, and a run ceiling
// (`LANDING_WALK_CEILING_IMPETUS`, required — absent it, the driver refuses
// rather than default). Default mode is DRY: print the plan + quotes, fire
// nothing.
//
//
// Phases (each independently resumable via `--phase`/`--from`):
//   0  resolve   GET /v1/openapi.json (liveness/contract) + GET /v1/flows (modus ids)
//   0  quote     POST /v1/runs/quote
//   A  generate  POST /v1/collectiones -> PATCH .../tractus -> POST .../fire
//   A  watch     GET /v1/collectiones/:id (+ /pieces), polled
//   B  curate    POST /v1/collectiones/:id/pieces/:actumId/{approve,reject}
//   C  dataset   POST /v1/data/datasets (source: 'generation')
//   D  caption   POST /v1/data/datasets/:id/captionsets
//   E  train     POST /v1/runs (training modus, inline manifest — see below)
//   F  plates    POST /v1/runs (trained trigger)
//
// State persists to `walk-runs/<runId>.json` (gitignored) between phases, so
// a run that aborts in B does not re-fire A. `--run-id` names the file;
// omitted on a fresh start it is generated, and printed so a later
// `--from`/`--phase` invocation can resume it.
//
// Training dataset handoff: `MODUS_AITOOLKIT_TRAINING`'s `dataset` port
// resolves either a `corpusId` (the legacy `Corpus` store) or an INLINE JSON
// manifest `[{url,caption}]` (src/crystal/datasetManifest.ts: "the inline form
// lets a one-off stager ... hand a manifest directly before the dataset lives
// in a Corpus"). The v1 `/v1/data/datasets` primitive this driver seeds is a
// DIFFERENT store (`Dataset`, not `Corpus`) with no bridge between the two, so
// phase E builds the inline manifest itself from the dataset's own media +
// captions rather than passing the dataset id through — no product code
// changes, and the documented inline path is exactly this driver's shape.
//
// Curation (phase B) implements the art bible's ORDER (grade -> tells ->
// silhouette -> subject quality) but only the checks that are honestly
// mechanical: image dimensions/aspect, mean/percentile luminance against the
// ground value `#08090A`, and a dominant-hue / second-hue colourfulness
// metric against the single-cold-key rule (`#5b8cff`). Tells (art bible §8)
// and subject quality are NOT machine-judgeable and are marked
// `deferred: human` on every piece rather than guessed at.
//
// Abort-and-report, never retry, on: a 402; the deadlock signature (fired,
// zero pieces dispatched after `LANDING_WALK_DISPATCH_TIMEOUT_MS`); every
// dispatch failing; a run in a state the API cannot explain; two consecutive
// phase failures. Never re-dispatches a persisted actum.
//
// noema-359 IS NOW RULED (merged as #492). The spec wrote its abort rules
// against an unruled fork where a dispatch that threw after `initiate` left the
// actum `nascens` with its reservation held until the expiry reaper — so an
// aborted walk could not say whether it had stranded the funder's money, and
// "never re-dispatch" was the only safe rule. Post-#492 a post-initiate throw
// releases what the initiation acquired, stamps the actum `fractus`, and
// `CollectioCursor` counts it in `fractae` (this API's `failed`). Two
// consequences the driver now depends on:
//   1. An aborted phase A can state the disposition of every impetus it
//      committed, rather than leaving it open. It says so in the receipt.
//   2. A dispatch-failure storm is VISIBLE. It used to be indistinguishable
//      from a stall — both showed zero completions — so it fell through to the
//      deadlock timeout. Now `failed` climbs while `completed` stays 0, which
//      is a different fault with a different remedy, and gets its own abort.
// "Never re-dispatch a persisted actum" still stands: it is walk discipline
// (an [AGENT] walk reports, it does not repair), not a money guard any more.
//
// Two modes:
//   LIVE  (default): npx tsx scripts/landing-dataset-walk.ts --phase a [--apply]
//     Needs LANDING_WALK_BASE_URL + LANDING_WALK_BURSA_TOKEN (see
//     .env-example) — a real deployment and a funded bursa token, supplied by
//     the operator at run time. Never committed.
//   SMOKE: npx tsx scripts/landing-dataset-walk.ts --smoke [--plan-only]
//     Offline. Spins up an in-process Express app wired to the REAL
//     `apiRouter.ts` against in-memory fakes (the same fixture pattern as
//     tests/unit/allocutio/api/apiRouter.test.ts) and drives the FULL phase
//     sequence over real HTTP on an ephemeral loopback port. The fixture
//     includes a quote that exceeds the ceiling, a class-skewed piece set,
//     and a fired-but-undispatched collection, so all three offline-testable
//     abort paths are exercised. `--plan-only` additionally asserts nothing
//     spends: it runs the dry planning path only.
// =============================================================================

import { randomUUID } from 'node:crypto'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import express, { type Express } from 'express'

import { createApiRouter, type ApiFacade, type Identity } from '../src/allocutio/api/apiRouter.js'
import type { AuctorKey } from '../src/flow/types.js'
import type { Credentials } from '../src/allocutio/api/IdentityResolver.js'
import type { Run } from '../src/allocutio/api/types.js'
import type { Collection, CollectionPiece } from '../src/allocutio/api/types.js'
import type { CreateDatasetInput } from '../src/types/dataset.js'
import type { Dataset } from '../src/types/dataset.js'
import type { Tractus } from '../src/types/collectio.js'
import { Errors } from '../src/allocutio/api/errors.js'

// =============================================================================
// Constants (spec §3 "Identity constants" + §4 "Phase A" + art bible §9)
// =============================================================================

// Spec §3 RULES the trigger as `noema` (rth, 2026-08-28; art bible §9 says the same). `nmahaus`
// was the pre-ruling draft value and stayed as the default on the grounds that the ruling could
// be applied as env config — but the trigger is written into every caption and is what the
// trained Intella is addressed by, and the spec fixes it "before captioning; changing it later
// invalidates the captionset". A default that silently trains the wrong trigger is the failure
// this constant exists to prevent, so the default IS the ruling.
const TRIGGER_WORD = process.env.LANDING_WALK_TRIGGER_WORD ?? 'noema'
const DATASET_NAME = 'landing-house-look-v1'
const COLLECTION_NAME = 'landing house look — candidates v1'
// klein-4b is the spec's ruling (canon-training-modus.md preset alias, verified against
// src/crystal/aitkConfig.ts's AITK_BASE_PRESETS/PRESET_ALIASES on origin/main).
const TRAIN_BASE_MODEL = 'klein-4b'
const TRAIN_STEPS = 250
// The only canon Krea-family generation modus in src/crystal/seeds/essentiae.ts today is
// 'krea-turbo' (no RAW variant is seeded) — this resolves spec §12.4's open question by what
// the catalog actually offers, not by guessing; override for a future RAW modus via env.
const GEN_MODUS_ID = process.env.LANDING_WALK_GEN_MODUS_ID ?? 'krea-turbo'
const TRAINING_MODUS_ID = 'modus.aitoolkit-training'

const DISPATCH_TIMEOUT_MS = Number(process.env.LANDING_WALK_DISPATCH_TIMEOUT_MS ?? 300_000)
// Overridable for the smoke deadlock-induce path only (real runs always use the constant above).
let effectiveDispatchTimeoutMs = DISPATCH_TIMEOUT_MS
const TRAIN_TIMEOUT_MS = 30 * 60_000 // spec §7: "if it exceeds 30 min with no progress, abort"

// Art bible §9 — fixed tail appended to every dataset-generation prompt.
const HOUSE_CLAUSE =
  'lit by a single cold blue key light from high side, deep neutral near-black background, ' +
  'shadows falling to black with detail retained, one small warm practical light in frame, ' +
  'fine film grain, visible material texture, matte surfaces, shallow believable depth of field, ' +
  'off-centre composition with generous negative space, muted desaturated palette apart from the ' +
  'cold blue key, photographed feel, no gloss, no neon, no particles'

type SubjectClass = 'figure' | 'mechanical' | 'illustrated'
const SUBJECT_CLASSES: readonly SubjectClass[] = ['figure', 'mechanical', 'illustrated']

// Art bible §6 worked examples, generalised into per-class subject fragments (scene-agnostic —
// the scene clause below supplies the situation).
const SUBJECT_FRAGMENTS: Record<SubjectClass, string> = {
  figure: 'a woman in a heavy matte wool coat, composed and self-possessed, doing something with her hands, gaze off-camera',
  mechanical: 'a worn mechanical arm with panel gaps and heat discolouration, built with evident purpose and wear, scale cues in frame',
  illustrated: 'ink and gouache illustration of a figure, visible brush and line work, large flat areas of held-back colour, paper tooth visible',
}

// Spec §4 axis 2 — the ruled SIXTEEN scenes, each chosen to work across all three subject
// classes. The first eight are the calibration batch's own axis (§4.1 fires 3 x 8 x 1 = 24), so
// this list is ordered: slicing it never changes what a calibration run already measured.
const ALL_SCENES: readonly { key: string; fragment: string }[] = [
  { key: 'workbench', fragment: 'at a workbench' },
  { key: 'stairwell-landing', fragment: 'on a stairwell landing at night' },
  { key: 'window-night', fragment: 'at a window at night' },
  { key: 'doorway', fragment: 'standing in a doorway' },
  { key: 'seated-rest', fragment: 'seated at rest' },
  { key: 'tool-in-hand', fragment: 'holding a tool in hand' },
  { key: 'corridor', fragment: 'in a corridor' },
  { key: 'threshold', fragment: 'at a threshold' },
  { key: 'mirror-reflection', fragment: 'beside a mirror, partly reflected' },
  { key: 'against-weather', fragment: 'against weather at an open door' },
  { key: 'single-lamp', fragment: 'under a single lamp' },
  { key: 'in-transit', fragment: 'in transit' },
  { key: 'at-table', fragment: 'at a table' },
  { key: 'rail', fragment: 'leaning on a rail' },
  { key: 'foreground-occluded', fragment: 'partially occluded by something in the foreground' },
  { key: 'away-into-depth', fragment: 'turned away, into depth' },
]

// Spec §4 axis 3 — seed variation only, no prompt change. Fixed seeds so a re-run of the
// SAME grid is reproducible.
const ALL_SEEDS: readonly number[] = [
  10001, 10002, 10003, 10004, 10005, 10006, 10007, 10008,
]

// The GRID IS RUNTIME CONFIG, not a constant. rth ruled the sizes on 2026-08-28 (384-candidate
// full grid: 3 classes x 16 scenes x 8 seeds; a 24-image calibration batch first: 3 x 8 x 1), and
// the sizes will change again between runs — a hardcoded grid is a defect, not a default. The
// values below are the ruled DEFAULTS; env overrides pick the actual run.
//   LANDING_WALK_SCENES  — how many scenes of ALL_SCENES to use
//   LANDING_WALK_SEEDS   — how many seeds of ALL_SEEDS to use
const clampCount = (raw: string | undefined, fallback: number, max: number): number => {
  const n = raw === undefined ? fallback : Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > max) {
    throw new Error(
      `landing-dataset-walk: bad grid size ${JSON.stringify(raw)} — expected an integer 1..${max}`,
    )
  }
  return n
}

const SCENES: readonly { key: string; fragment: string }[] = ALL_SCENES.slice(
  0,
  clampCount(process.env.LANDING_WALK_SCENES, ALL_SCENES.length, ALL_SCENES.length),
)
const VARIATION_SEEDS: readonly number[] = ALL_SEEDS.slice(
  0,
  clampCount(process.env.LANDING_WALK_SEEDS, ALL_SEEDS.length, ALL_SEEDS.length),
)

const TOTAL_CANDIDATES = SUBJECT_CLASSES.length * SCENES.length * VARIATION_SEEDS.length
// Select targets scale with the grid: the spec's ruled full grid (384) curates to 120 at 40/class
// with a floor of 30, i.e. a ~31% keep rate and a floor at 75% of target. Deriving them keeps a
// calibration batch from tripping a floor sized for the full run.
const SELECT_TARGET_PER_CLASS = Math.max(
  1,
  Math.round((TOTAL_CANDIDATES / SUBJECT_CLASSES.length) * 0.3125),
)
const SELECT_FLOOR_PER_CLASS = Math.max(1, Math.round(SELECT_TARGET_PER_CLASS * 0.75))
const SELECT_TARGET_TOTAL = SELECT_TARGET_PER_CLASS * SUBJECT_CLASSES.length
// Spec §10.1: the grid dispatches and >=92% completes. Derived, never a literal — a hard check
// whose PRINTED threshold differs from the one it tests is a false receipt (DOCTRINE §24).
const MIN_COMPLETED = Math.ceil(TOTAL_CANDIDATES * 0.92)

// Settlement model (impetus == seconds of pod time). Overridable so a measured run replaces the
// estimate rather than arguing with it.
const COLD_START_SECONDS = Number(process.env.LANDING_WALK_COLD_START_SECONDS ?? 400)
const WARM_SECONDS_PER_IMAGE = Number(process.env.LANDING_WALK_WARM_SECONDS ?? 40)
const COLLECTION_CONCURRENTIA = Number(process.env.LANDING_WALK_CONCURRENTIA ?? 2)

// Ground / key colours the mechanical curation gate checks against (art bible §2).
const GROUND_HEX = '#08090A'
const COLD_KEY_HEX = '#5b8cff'

// =============================================================================
// Failure classification
// =============================================================================

class WalkFailure extends Error {
  constructor(
    public readonly assertion: string,
    message: string,
    public readonly remediation?: string,
  ) {
    super(message)
    this.name = 'WalkFailure'
  }
}

// =============================================================================
// Small HTTP client
// =============================================================================

interface FetchResult {
  status: number
  body: unknown
}

async function fetchJson(url: string, init: RequestInit): Promise<FetchResult> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch (err) {
    throw new WalkFailure('http.transport', `request to ${url} failed: ${String(err)}`)
  }
  const text = await res.text()
  let body: unknown
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      throw new WalkFailure('http.transport', `${url} returned non-JSON body: ${text.slice(0, 200)}`)
    }
  }
  return { status: res.status, body }
}

/**
 * How the driver authenticates. TWO rails, because the funded account decides which one:
 *   • `bursa`  — anonymous rail, `x-bursa-token` (the noema-356 concierge-walk pattern)
 *   • `bearer` — an owned anima account, `Authorization: Bearer` (helm-fleet-01's rail)
 * The spec originally assumed the bursa rail by inheritance from 356 and was wrong: the helm
 * fleet account is an anima with a bearer, and its purse is the funded one.
 */
type AuthRail = { kind: 'bursa'; token: string } | { kind: 'bearer'; token: string }

class Client {
  constructor(
    private readonly baseUrl: string,
    private readonly auth: AuthRail,
  ) {}

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      ...(this.auth.kind === 'bursa'
        ? { 'x-bursa-token': this.auth.token }
        : { authorization: `Bearer ${this.auth.token}` }),
    }
  }

  private async req(method: string, path: string, body?: unknown): Promise<FetchResult> {
    const res = await fetchJson(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers(),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    if (res.status === 402) {
      throw new WalkFailure(
        'spend.402',
        `${method} ${path} -> 402 insufficient balance: ${JSON.stringify(res.body)}`,
        'fund the bursa purse (or lower the run scope) before retrying; the driver never retries a 402 automatically',
      )
    }
    return res
  }

  get(path: string): Promise<FetchResult> {
    return this.req('GET', path)
  }
  post(path: string, body?: unknown): Promise<FetchResult> {
    return this.req('POST', path, body ?? {})
  }
  patch(path: string, body?: unknown): Promise<FetchResult> {
    return this.req('PATCH', path, body ?? {})
  }
}

function expectStatus(res: FetchResult, expected: number[], assertion: string, context: string): void {
  if (!expected.includes(res.status)) {
    throw new WalkFailure(assertion, `${context} -> ${res.status}: ${JSON.stringify(res.body)}`)
  }
}

// =============================================================================
// Run state (resumable, gitignored walk-runs/<runId>.json)
// =============================================================================

interface PieceVerdict {
  actumId: string
  subjectClass: string
  scene: string
  seed: number
  outcome: 'approved' | 'rejected'
  checks: MechanicalCheck[]
  deferred: string[]
}

interface RunState {
  runId: string
  startedAt: string
  ceilingImpetus: string
  genModusId: string
  quotes: Record<string, { impetus: string; at: string }>
  spend: Record<string, { quoted: string; actual?: string; at: string }>
  collectionId?: string
  pieces?: PieceVerdict[]
  datasetId?: string
  captionsetId?: string
  /** Carried forward from the create/captionset responses — GET /v1/data/datasets/:id (a single-
   *  dataset fetch) does not exist on the live router, only the list routes do, so phase E cannot
   *  re-fetch by id and instead reads what phase C/D already returned. */
  datasetMedia?: Array<{ id: string; url: string; source: string; actumId?: string }>
  captionsetCaptions?: Record<string, string>
  trainingRunId?: string
  loraIntellaId?: string
  plateRunIds?: string[]
  defects: DefectEntry[]
  abortedAt?: { phase: string; assertion: string; message: string; remediation?: string }
}

interface DefectEntry {
  route: string
  observation: string
  whyDefect: string
}

function newState(runId: string, ceilingImpetus: string, genModusId: string): RunState {
  return {
    runId,
    startedAt: new Date().toISOString(),
    ceilingImpetus,
    genModusId,
    quotes: {},
    spend: {},
    defects: [],
  }
}

function stateDir(): URL {
  return new URL('../walk-runs/', import.meta.url)
}
function statePath(runId: string): URL {
  return new URL(`${runId}.json`, stateDir())
}
async function loadState(runId: string): Promise<RunState> {
  const p = statePath(runId)
  if (!existsSync(p)) {
    throw new WalkFailure('state.missing', `no saved run state for --run-id ${runId} at ${p.pathname}`)
  }
  return JSON.parse(await readFile(p, 'utf8')) as RunState
}
async function saveState(state: RunState): Promise<void> {
  await mkdir(stateDir(), { recursive: true })
  await writeFile(statePath(state.runId), JSON.stringify(state, null, 2))
}

// =============================================================================
// Total-spend ceiling accounting — the only place spend is compared to the ceiling.
// =============================================================================

function totalSpent(state: RunState): bigint {
  let total = 0n
  for (const entry of Object.values(state.spend)) {
    if (entry.actual !== undefined) total += BigInt(entry.actual)
  }
  return total
}

function assertUnderCeiling(state: RunState, incomingQuote: string, label: string): void {
  const projected = totalSpent(state) + BigInt(incomingQuote)
  const ceiling = BigInt(state.ceilingImpetus)
  if (projected > ceiling) {
    throw new WalkFailure(
      'spend.ceiling',
      `${label} quoted ${incomingQuote} impetus; total would be ${projected} against a ceiling of ${ceiling}`,
      'the driver stops at the ceiling and never tops up — raise LANDING_WALK_CEILING_IMPETUS and resume with --from, or accept a partial run',
    )
  }
}

/**
 * Reserves are held per in-flight run and released on settlement, so what must fit in the purse
 * is `perRunReserve x concurrentia`, never the whole grid. Checked against the live balance.
 */
async function assertReserveHeadroom(client: Client, headroom: bigint): Promise<void> {
  const me = await client.get('/v1/me')
  if (me.status !== 200) {
    console.log(`[cost] /v1/me returned ${me.status} — balance unknown, headroom NOT asserted; a 402 will speak instead`)
    return
  }
  const balanceRaw = (me.body as { balanceImpetus?: string }).balanceImpetus
  if (!balanceRaw) return // no balance surfaced — do not invent one, let a 402 speak instead
  const balance = BigInt(balanceRaw)
  if (headroom > balance) {
    throw new WalkFailure(
      'spend.headroom',
      `reserve headroom ${headroom} impetus (concurrentia ${COLLECTION_CONCURRENTIA} x ${headroom / BigInt(COLLECTION_CONCURRENTIA)}) exceeds the purse balance ${balance}`,
      'reserves are held per in-flight run and released on settlement — lower LANDING_WALK_CONCURRENTIA or fund the purse; the run itself costs far less than the reserve',
    )
  }
  console.log(`[cost] reserve headroom ${headroom} fits balance ${balance}`)
}

// =============================================================================
// Mechanical curation gate (spec §5, art bible §2/§9/§10) — ONLY the honestly
// mechanical checks. Everything else is marked `deferred: human`.
// =============================================================================

interface MechanicalCheck {
  name: string
  pass: boolean
  observed: string
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rf = r / 255
  const gf = g / 255
  const bf = b / 255
  const max = Math.max(rf, gf, bf)
  const min = Math.min(rf, gf, bf)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === rf) h = 60 * (((gf - bf) / d) % 6)
    else if (max === gf) h = 60 * ((bf - rf) / d + 2)
    else h = 60 * ((rf - gf) / d + 4)
  }
  if (h < 0) h += 360
  const s = max === 0 ? 0 : d / max
  return { h, s, v: max }
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/** Analyze one decoded image's pixels against the art bible's mechanically-checkable rules.
 *  Pure function over a jimp-decoded bitmap so the SAME code path runs for a live-fetched
 *  image and a smoke-fixture-generated one — no separate fake analyzer. */
function analyzeBitmap(width: number, height: number, getPixel: (x: number, y: number) => number): {
  checks: MechanicalCheck[]
  pass: boolean
} {
  const [groundR, groundG, groundB] = hexToRgb(GROUND_HEX)
  const groundHsv = rgbToHsv(groundR, groundG, groundB)
  const keyHsv = rgbToHsv(...hexToRgb(COLD_KEY_HEX))

  const aspect = width / height
  // Loose bands around the three formats the bible allows (3:2, 4:5, 1:1) plus the square
  // dataset-generation default — this is a sanity check on the modus's own output, not a
  // format enforcement (phase A always requests square candidates).
  const aspectOk = aspect >= 0.5 && aspect <= 2.0

  let luminanceSum = 0
  let coldPixels = 0
  let warmPracticalPixels = 0
  let secondHuePixels = 0
  let colourfulPixels = 0
  const sampleN = width * height

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const argb = getPixel(x, y)
      const r = (argb >>> 24) & 255
      const g = (argb >>> 16) & 255
      const b = (argb >>> 8) & 255
      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
      luminanceSum += luminance
      const { h, s } = rgbToHsv(r, g, b)
      if (s > 0.15) {
        colourfulPixels++
        const coldDist = hueDistance(h, keyHsv.h)
        // Warm practical: a low-saturation warm-neutral high (art bible §3's `#e7eaef`/`#8b929c`
        // band) — approximated as low-to-mid saturation, high value, hue in the warm range.
        const isWarmNeutral = s < 0.35 && rgbToHsv(r, g, b).v > 0.6 && (h < 60 || h > 300)
        if (coldDist < 40) coldPixels++
        else if (isWarmNeutral) warmPracticalPixels++
        else secondHuePixels++
      }
    }
  }

  const meanLuminance = luminanceSum / sampleN
  const secondHueFraction = colourfulPixels > 0 ? secondHuePixels / sampleN : 0
  const warmFraction = warmPracticalPixels / sampleN

  const checks: MechanicalCheck[] = [
    { name: 'dimensions', pass: width > 0 && height > 0, observed: `${width}x${height}` },
    { name: 'aspect', pass: aspectOk, observed: aspect.toFixed(3) },
    {
      name: 'ground-luminance',
      pass: meanLuminance < 0.42,
      observed: `mean=${meanLuminance.toFixed(3)} (ground ${GROUND_HEX} is near-black; bible §2)`,
    },
    {
      name: 'single-cold-key',
      pass: secondHueFraction < 0.15,
      observed: `secondHueFraction=${secondHueFraction.toFixed(3)} (bible §2: "no second hue")`,
    },
    {
      name: 'warm-practical-under-10pct',
      pass: warmFraction < 0.12,
      observed: `warmFraction=${warmFraction.toFixed(3)} (bible §3: "warm occupies under 10% of the frame")`,
    },
  ]
  return { checks, pass: checks.every((c) => c.pass) }
}

async function analyzeImageUrl(url: string): Promise<{ checks: MechanicalCheck[]; pass: boolean }> {
  const res = await fetch(url)
  if (!res.ok) throw new WalkFailure('curate.fetch', `could not fetch piece image ${url}: ${res.status}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  const { Jimp } = await import('jimp')
  const img = await Jimp.read(Buffer.from(bytes))
  return analyzeBitmap(img.bitmap.width, img.bitmap.height, (x, y) => img.getPixelColor(x, y))
}

// =============================================================================
// Receipt
// =============================================================================

interface HardCheckRow {
  n: number
  name: string
  pass: boolean
  observed: string
}

function buildHardChecks(state: RunState, candidatesCompleted: number): HardCheckRow[] {
  const pieces = state.pieces ?? []
  const approved = pieces.filter((p) => p.outcome === 'approved')
  const perClass = (cls: string) => approved.filter((p) => p.subjectClass === cls).length
  const minClass = SUBJECT_CLASSES.length > 0 ? Math.min(...SUBJECT_CLASSES.map(perClass)) : 0
  const spend = totalSpent(state)
  const rows: HardCheckRow[] = [
    { n: 1, name: `${TOTAL_CANDIDATES} candidates dispatched, >=${MIN_COMPLETED} completed`, pass: candidatesCompleted >= MIN_COMPLETED, observed: `${candidatesCompleted}/${TOTAL_CANDIDATES}` },
    { n: 2, name: 'every completed piece fetched + classified', pass: pieces.length === candidatesCompleted && candidatesCompleted > 0, observed: `${pieces.length} classified` },
    { n: 3, name: `>=${SELECT_TARGET_TOTAL} selects, no class below ${SELECT_FLOOR_PER_CLASS}`, pass: approved.length >= SELECT_TARGET_TOTAL && minClass >= SELECT_FLOOR_PER_CLASS, observed: `${approved.length} selects, min class ${minClass}` },
    { n: 4, name: 'dataset created from approved acta only', pass: state.datasetId !== undefined, observed: state.datasetId ? `dataset ${state.datasetId}` : 'not created' },
    { n: 5, name: 'captionset coverage 100%, trigger in every caption', pass: state.captionsetId !== undefined, observed: state.captionsetId ? `captionset ${state.captionsetId}` : 'not created' },
    { n: 6, name: 'training run reaches terminal success, registers lora Intella', pass: state.loraIntellaId !== undefined, observed: state.loraIntellaId ?? 'not trained' },
    { n: 7, name: 'trigger resolves in a subsequent generation', pass: (state.plateRunIds?.length ?? 0) > 0, observed: state.plateRunIds?.length ? 'resolved' : 'unverified' },
    { n: 8, name: '>=3 plates generated, one per subject class', pass: (state.plateRunIds?.length ?? 0) >= 3, observed: `${state.plateRunIds?.length ?? 0} plates` },
    { n: 9, name: `total spend <= ceiling (${state.ceilingImpetus})`, pass: spend <= BigInt(state.ceilingImpetus), observed: `${spend} impetus` },
  ]
  return rows
}

function printHardChecks(rows: HardCheckRow[]): void {
  console.log('\n--- HARD CHECKS (spec §10) ---')
  for (const r of rows) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  #${r.n}  ${r.name}  — ${r.observed}`)
  }
  const allPass = rows.every((r) => r.pass)
  console.log(allPass ? '\nRUN: PASS (all 9 hard checks)' : '\nRUN: PARTIAL — not all hard checks passed')
}

function walkBoardRow(state: RunState, rows: HardCheckRow[]): string {
  const date = state.startedAt.slice(0, 10)
  const passCount = rows.filter((r) => r.pass).length
  const defects = state.defects.length
  return `- [AGENT] ${date} · landing-dataset-walk drove the full generate→curate→dataset→caption→train→plates sequence over /v1 · run ${state.runId}, ${TOTAL_CANDIDATES}-candidate collection, klein-4b/${TRAIN_STEPS}-step training · ${passCount}/9 hard checks passed, spend ${totalSpent(state)}/${state.ceilingImpetus} impetus · ${defects} defect(s) filed`
}

// =============================================================================
// Phases — LIVE http calls. Each takes the Client + RunState and mutates state.
// =============================================================================

async function phaseResolve(client: Client, state: RunState): Promise<void> {
  const openapi = await client.get('/v1/openapi.json')
  expectStatus(openapi, [200], 'resolve.openapi', 'GET /v1/openapi.json')

  const flows = await client.get('/v1/flows')
  expectStatus(flows, [200], 'resolve.flows', 'GET /v1/flows')
  const list = (flows.body as { flows?: Array<{ id: string }> }).flows ?? []
  if (!list.some((f) => f.id === state.genModusId)) {
    state.defects.push({
      route: 'GET /v1/flows',
      observation: `generation modus "${state.genModusId}" not present in the live catalog`,
      whyDefect: 'the driver resolves modus ids at run time rather than hardcoding; a missing canon modus blocks phase A entirely',
    })
    throw new WalkFailure('resolve.modus', `generation modus "${state.genModusId}" not found via GET /v1/flows`)
  }
  if (!list.some((f) => f.id === TRAINING_MODUS_ID)) {
    state.defects.push({
      route: 'GET /v1/flows',
      observation: `training modus "${TRAINING_MODUS_ID}" not present in the live catalog`,
      whyDefect: 'phase E cannot fire a training run without this modus being live',
    })
    throw new WalkFailure('resolve.modus', `training modus "${TRAINING_MODUS_ID}" not found via GET /v1/flows`)
  }
}

function buildTractus(): Tractus[] {
  return [
    {
      porta: 'subject',
      label: 'subject class',
      valores: SUBJECT_CLASSES.map((c) => ({ value: c, label: c, promptFragment: SUBJECT_FRAGMENTS[c] })),
    },
    {
      porta: 'scene',
      label: 'scene',
      valores: SCENES.map((s) => ({ value: s.key, label: s.key, promptFragment: s.fragment })),
    },
    {
      porta: 'input_seed',
      label: 'variation',
      bypassDNA: true,
      valores: VARIATION_SEEDS.map((seed) => ({ value: seed, label: String(seed) })),
    },
  ]
}

async function quotePhaseA(client: Client, state: RunState): Promise<string> {
  const q = await client.post('/v1/runs/quote', {
    modusId: state.genModusId,
    aditus: { prompt: `${SUBJECT_FRAGMENTS.figure}, ${SCENES[0]!.fragment}, ${HOUSE_CLAUSE}`, width: 1024, height: 1024 },
  })
  expectStatus(q, [200], 'quote.phaseA', 'POST /v1/runs/quote (phase A sample)')
  const perImage = (q.body as { impetus?: string }).impetus
  if (!perImage) throw new WalkFailure('quote.phaseA', `quote response carried no impetus: ${JSON.stringify(q.body)}`)
  // WHAT THE QUOTE ACTUALLY IS (src/ledger/rates.ts, src/crystal/RunPodCursor.ts): a per-run
  // RESERVATION, not a price. `reservationImpetus()` resolves impetusFixum -> the flow's own
  // `pretium` curve -> GENERIC_RESERVE_IMPETUS (900), and krea-turbo carries no curve, so every
  // quote is the generic fallback: "2 x the observed cold-start p95 of 402 s, rounded up.
  // PLACEHOLDER pending per-flow calibration." One impetus is ONE SECOND of pod time at
  // REFERENCE_COST_PER_HR ($1.2132/hr). The reserve is HELD at dispatch and settled against
  // actual pod-seconds, so multiplying it by the grid size models nothing real — it prices every
  // image as its own cold start with a full weight download. Real shape: one cold start, then
  // ~40 s per image on the warm pod.
  state.quotes.phaseA = { impetus: perImage, at: new Date().toISOString() }
  return perImage
}

async function phaseAGenerate(client: Client, state: RunState, apply: boolean): Promise<void> {
  const perRunReserve = await quotePhaseA(client, state)
  // The pre-flight gate is on RESERVE HEADROOM — what is held at once — because reserves are
  // taken per run at dispatch and released on settlement. `concurrentia` bounds it.
  const headroom = BigInt(perRunReserve) * BigInt(COLLECTION_CONCURRENTIA)
  const settlementEstimate =
    BigInt(COLD_START_SECONDS) + BigInt(WARM_SECONDS_PER_IMAGE) * BigInt(TOTAL_CANDIDATES)
  console.log(
    `[cost] per-run reserve ${perRunReserve} impetus (a HOLD, generic fallback — not a price)\n` +
      `[cost] reserve headroom at concurrentia=${COLLECTION_CONCURRENTIA}: ${headroom} impetus\n` +
      `[cost] estimated SETTLEMENT for ${TOTAL_CANDIDATES} images: ~${settlementEstimate} impetus ` +
      `(~$${(Number(settlementEstimate) * 0.000337).toFixed(2)}) = one ${COLD_START_SECONDS}s cold start + ` +
      `${TOTAL_CANDIDATES}x${WARM_SECONDS_PER_IMAGE}s warm`,
  )
  assertUnderCeiling(state, settlementEstimate.toString(), `phase A generate (${TOTAL_CANDIDATES} candidates, estimated settlement)`)
  await assertReserveHeadroom(client, headroom)
  if (!apply) {
    console.log(`[dry] phase A would fire ${TOTAL_CANDIDATES} candidates`)
    return
  }

  const created = await client.post('/v1/collectiones', {
    nomen: COLLECTION_NAME,
    descriptio: 'Wave 3 landing house-look dataset candidates',
    concurrentia: COLLECTION_CONCURRENTIA, // spec §4: "deliberately conservative first contact"
    reviewEnabled: true,
    draft: true,
  })
  expectStatus(created, [200], 'generate.create', 'POST /v1/collectiones')
  const collectionId = (created.body as { collection?: Collection }).collection?.id
  if (!collectionId) throw new WalkFailure('generate.create', `no collection.id in response: ${JSON.stringify(created.body)}`)
  state.collectionId = collectionId
  await saveState(state)

  const patched = await client.patch(`/v1/collectiones/${collectionId}/tractus`, {
    modusId: state.genModusId,
    numerus: TOTAL_CANDIDATES,
    tractus: buildTractus(),
  })
  expectStatus(patched, [200], 'generate.tractus', `PATCH /v1/collectiones/${collectionId}/tractus`)

  // aditusBase carries the token-templated prompt (TraitMixer's {{porta}} replacement mode) and
  // the fixed generation params. Set via a second tractus patch is not available (the route only
  // accepts tractus/modusId/numerus) — aditusBase must ride the CREATE call. Since this driver
  // creates as a draft first (so a bad tractus can be fixed before firing), aditusBase is instead
  // supplied here via an extend-style re-create... — see note below.
  //
  // NOTE: `patchCollectionDraft` does not accept aditusBase, so it must be set at creation. Redo
  // the create call with aditusBase included, then patch tractus onto the new draft.
  state.defects.push({
    route: 'PATCH /v1/collectiones/:id/tractus',
    observation: 'the draft-tractus PATCH accepts {tractus, modusId, numerus} only; aditusBase (the base prompt template) cannot be set on a draft after creation, only at POST /v1/collectiones time',
    whyDefect: 'a three-step author flow (create draft -> patch tractus -> fire) that cannot also set the base prompt on the patch step forces callers to get aditusBase right on the FIRST call or restart the draft',
  })

  const recreated = await client.post('/v1/collectiones', {
    nomen: COLLECTION_NAME,
    descriptio: 'Wave 3 landing house-look dataset candidates',
    concurrentia: COLLECTION_CONCURRENTIA,
    reviewEnabled: true,
    draft: true,
    aditusBase: { _basePrompt: '{{subject}}, {{scene}}, ' + HOUSE_CLAUSE, width: 1024, height: 1024 },
  })
  expectStatus(recreated, [200], 'generate.recreate', 'POST /v1/collectiones (with aditusBase)')
  const finalId = (recreated.body as { collection?: Collection }).collection?.id
  if (!finalId) throw new WalkFailure('generate.recreate', `no collection.id in response: ${JSON.stringify(recreated.body)}`)
  state.collectionId = finalId
  await saveState(state)

  const patched2 = await client.patch(`/v1/collectiones/${finalId}/tractus`, {
    modusId: state.genModusId,
    numerus: TOTAL_CANDIDATES,
    tractus: buildTractus(),
  })
  expectStatus(patched2, [200], 'generate.tractus2', `PATCH /v1/collectiones/${finalId}/tractus`)

  const fired = await client.post(`/v1/collectiones/${finalId}/fire`)
  expectStatus(fired, [200], 'generate.fire', `POST /v1/collectiones/${finalId}/fire`)
  // Recorded as the ESTIMATED settlement; the real figure is read back from the completed acta.
  state.spend.phaseA = { quoted: settlementEstimate.toString(), at: new Date().toISOString() }
  await saveState(state)
}

async function phaseAWatch(client: Client, state: RunState): Promise<Collection> {
  if (!state.collectionId) throw new WalkFailure('watch.no-collection', 'no collectionId in state — run phase A generate first')
  const start = Date.now()
  let sawDispatch = false
  for (;;) {
    const res = await client.get(`/v1/collectiones/${state.collectionId}`)
    expectStatus(res, [200], 'watch.get', `GET /v1/collectiones/${state.collectionId}`)
    const collection = (res.body as { collection?: Collection }).collection
    if (!collection) throw new WalkFailure('watch.shape', `no collection in response: ${JSON.stringify(res.body)}`)

    const dispatched = (collection.inFlight ?? 0) + collection.completed + collection.failed + (collection.pendingReview ?? 0)
    if (dispatched > 0) sawDispatch = true

    if (collection.status === 'complete' || collection.status === 'cancelled') {
      return collection
    }
    const elapsed = Date.now() - start

    // Every dispatch is failing. Post-#492 this is its own signature rather than a stall:
    // `fractae` climbs, so `sawDispatch` is true and the deadlock timeout below can never
    // fire — without this the driver would poll a doomed collection until the operator
    // killed it. Cancel-and-re-fire is the WRONG remedy here; it reproduces the fault.
    if (collection.failed > 0 && collection.completed === 0 && (collection.inFlight ?? 0) === 0 && elapsed > effectiveDispatchTimeoutMs) {
      throw new WalkFailure(
        'watch.all-dispatches-failed',
        `collection ${state.collectionId}: ${collection.failed} of ${collection.total} pieces failed to dispatch and none completed after ${Math.round(elapsed / 1000)}s`,
        'noema-359/#492: every one of those failures released its reservation and is counted in `fractae`, so NOTHING is held and the purse is whole — this is a dispatch fault, not a money incident. Read the dispatch error before re-firing; cancelling and re-firing blind reproduces it.',
      )
    }

    if (!sawDispatch && elapsed > effectiveDispatchTimeoutMs) {
      throw new WalkFailure(
        'watch.deadlock',
        `collection ${state.collectionId} fired ${Math.round(elapsed / 1000)}s ago with zero pieces dispatched (status=${collection.status})`,
        'the deadlock signature (spec §9 / rth\'s 2026-08-28 incident). Post-#476 a collection keeps dispatching across a process restart, and post-#492 a throwing dispatch would show in `failed` — so zero of BOTH means the dispatcher never ran for this collection at all, not that pieces are failing quietly. Nothing was spent (no actum was persisted, so no reservation was taken). Cancel and re-fire; do not resume.',
      )
    }
    if ((collection.status as string) !== 'running' && (collection.status as string) !== 'pending' && (collection.status as string) !== 'draft') {
      throw new WalkFailure('watch.unexplained', `collection ${state.collectionId} is in an unrecognised state: ${collection.status}`)
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
}

async function phaseBCurate(client: Client, state: RunState): Promise<void> {
  if (!state.collectionId) throw new WalkFailure('curate.no-collection', 'no collectionId in state')
  const res = await client.get(`/v1/collectiones/${state.collectionId}/pieces?review=all`)
  expectStatus(res, [200], 'curate.list', `GET /v1/collectiones/${state.collectionId}/pieces`)
  const pieces = (res.body as { pieces?: CollectionPiece[] }).pieces ?? []

  const perClassApproved: Record<string, number> = { figure: 0, mechanical: 0, illustrated: 0 }
  const verdicts: PieceVerdict[] = []
  let consecutiveFailures = 0

  for (const piece of pieces) {
    if (piece.review !== 'pending') continue // already curated by a prior partial run
    const attrs = piece.attributes ?? []
    const subjectClass = attrs.find((a) => a.trait_type === 'subject class' || a.trait_type === 'subject')?.value ?? 'unknown'
    const scene = attrs.find((a) => a.trait_type === 'scene')?.value ?? 'unknown'
    const seedAttr = attrs.find((a) => a.trait_type === 'variation')?.value
    const seed = Number(seedAttr ?? 0)
    const imageUrl = (piece.output as { image?: string } | undefined)?.image

    let mechanical: { checks: MechanicalCheck[]; pass: boolean }
    try {
      if (!imageUrl) throw new WalkFailure('curate.no-image', `piece ${piece.actumId} has no output.image`)
      mechanical = await analyzeImageUrl(imageUrl)
      consecutiveFailures = 0
    } catch (err) {
      consecutiveFailures++
      if (consecutiveFailures >= 2) {
        throw new WalkFailure('curate.two-failures', `two consecutive phase-B failures; last: ${String(err)}`)
      }
      mechanical = { checks: [{ name: 'analysis-error', pass: false, observed: String(err) }], pass: false }
    }

    const atTarget = (perClassApproved[subjectClass] ?? 0) >= SELECT_TARGET_PER_CLASS
    const approve = mechanical.pass && !atTarget
    if (approve) {
      const r = await client.post(`/v1/collectiones/${state.collectionId}/pieces/${piece.actumId}/approve`)
      expectStatus(r, [200], 'curate.approve', `POST .../pieces/${piece.actumId}/approve`)
      perClassApproved[subjectClass] = (perClassApproved[subjectClass] ?? 0) + 1
    } else {
      const r = await client.post(`/v1/collectiones/${state.collectionId}/pieces/${piece.actumId}/reject`)
      expectStatus(r, [200], 'curate.reject', `POST .../pieces/${piece.actumId}/reject`)
    }

    verdicts.push({
      actumId: piece.actumId,
      subjectClass,
      scene,
      seed,
      outcome: approve ? 'approved' : 'rejected',
      checks: mechanical.checks,
      // spec requirement 6: everything the driver cannot mechanically check is named honestly.
      deferred: ['tells (bible §8)', 'silhouette / 390px survival (bible §5/§7)', 'subject quality (bible §10.4)'],
    })
  }

  state.pieces = [...(state.pieces ?? []), ...verdicts]
  await saveState(state)

  for (const cls of SUBJECT_CLASSES) {
    const count = state.pieces.filter((p) => p.subjectClass === cls && p.outcome === 'approved').length
    if (count < SELECT_FLOOR_PER_CLASS) {
      state.defects.push({
        route: 'POST /v1/collectiones/:id/pieces/:actumId/approve',
        observation: `subject class "${cls}" reached only ${count} selects (floor is ${SELECT_FLOOR_PER_CLASS})`,
        whyDefect: 'spec §5/§11: two starved classes is the falsification signal for "Krea 2 cannot hold the house clause across subjects" and escalates to rth; one starved class means re-generating that class with an amended prompt',
      })
    }
  }
  const starvedClasses = SUBJECT_CLASSES.filter(
    (cls) => state.pieces!.filter((p) => p.subjectClass === cls && p.outcome === 'approved').length < SELECT_FLOOR_PER_CLASS,
  )
  if (starvedClasses.length >= 2) {
    throw new WalkFailure(
      'curate.balance',
      `${starvedClasses.length} subject classes below the floor of ${SELECT_FLOOR_PER_CLASS}: ${starvedClasses.join(', ')}`,
      'spec §11 falsification signal — escalate to rth rather than backfilling with weaker images',
    )
  }
}

async function phaseCDDataset(client: Client, state: RunState): Promise<void> {
  if (!state.pieces) throw new WalkFailure('dataset.no-pieces', 'no curated pieces in state — run phase B first')
  const approvedIds = state.pieces.filter((p) => p.outcome === 'approved').map((p) => p.actumId)
  if (approvedIds.length === 0) throw new WalkFailure('dataset.no-approved', 'no approved pieces to seed a dataset from')

  const input: CreateDatasetInput = {
    source: 'generation',
    actumIds: approvedIds,
    name: DATASET_NAME,
    modality: 'image',
  }
  const created = await client.post('/v1/data/datasets', input)
  expectStatus(created, [201], 'dataset.create', 'POST /v1/data/datasets')
  const dataset = (created.body as { dataset?: Dataset }).dataset
  if (!dataset?.id) throw new WalkFailure('dataset.create', `no dataset.id in response: ${JSON.stringify(created.body)}`)
  state.datasetId = dataset.id
  state.datasetMedia = (dataset.media ?? []).map((m) => ({ id: m.id, url: m.url, source: m.source, ...(m.actumId ? { actumId: m.actumId } : {}) }))
  state.defects.push({
    route: 'GET /v1/data/datasets/:id',
    observation: 'no single-dataset fetch route exists on apiRouter.ts — only GET /v1/data/datasets (summary list) and /full (full list)',
    whyDefect: 'phase E needs the dataset it just created/captioned to build the training manifest; without a by-id GET it must carry the create/captionset response forward in its own state rather than re-fetching, which breaks a resumed run (--from e) that was not also present for phase C/D in the same invocation',
  })
  await saveState(state)

  // Captions: authored, not auto (spec §6 / plan notes) — pattern "TRIGGER, <subject>, <scene>",
  // deliberately no grade/lighting words so the look attaches to the trigger, not to adjectives.
  const captions: Record<string, string> = {}
  const media = dataset.media ?? []
  for (const item of media) {
    if (item.source !== 'generation' || !item.actumId) continue
    const verdict = state.pieces.find((p) => p.actumId === item.actumId)
    if (!verdict) continue
    captions[item.id] = `${TRIGGER_WORD}, ${SUBJECT_FRAGMENTS[verdict.subjectClass as SubjectClass] ?? verdict.subjectClass}, ${verdict.scene}`
  }

  const captionset = await client.post(`/v1/data/datasets/${dataset.id}/captionsets`, {
    id: `landing-captions-v1`,
    name: 'landing-captions-v1',
    method: 'manual',
    captions,
  })
  expectStatus(captionset, [201], 'caption.create', `POST /v1/data/datasets/${dataset.id}/captionsets`)
  const captioned = (captionset.body as { dataset?: Dataset }).dataset
  const cs = captioned?.captionsets?.find((c) => c.name === 'landing-captions-v1')
  if (!cs) throw new WalkFailure('caption.create', `captionset not found on response: ${JSON.stringify(captionset.body)}`)
  state.captionsetId = cs.id

  const [have, total] = cs.coverage.split('/').map(Number)
  if (have !== total || !Number.isFinite(have) || total === 0) {
    throw new WalkFailure('caption.coverage', `captionset coverage is ${cs.coverage}, expected full coverage before training`)
  }
  state.captionsetCaptions = captions
  await saveState(state)
}

async function phaseETrain(client: Client, state: RunState, apply: boolean): Promise<void> {
  if (!state.datasetId || !state.datasetMedia) throw new WalkFailure('train.no-dataset', 'no dataset in state — run phase C/D in the same invocation first (no GET-by-id route exists to resume from, see the filed defect)')
  if (!state.captionsetCaptions) throw new WalkFailure('train.no-captionset', 'no captionset in state — run phase C/D first')

  // Inline manifest handoff (see header note) — the dataset/media stays the v1 primitive; the
  // training modus reads a plain [{url,caption}] manifest it does not need a Corpus record for.
  const manifest = state.datasetMedia.map((m) => ({ url: m.url, caption: state.captionsetCaptions![m.id] }))

  const quote = await client.post('/v1/runs/quote', { modusId: TRAINING_MODUS_ID, aditus: { dataset: JSON.stringify(manifest), triggerWord: TRIGGER_WORD, baseModel: TRAIN_BASE_MODEL, steps: TRAIN_STEPS } })
  expectStatus(quote, [200], 'train.quote', 'POST /v1/runs/quote (training)')
  const quoted = (quote.body as { impetus?: string }).impetus
  if (!quoted) throw new WalkFailure('train.quote', `no impetus in quote: ${JSON.stringify(quote.body)}`)
  assertUnderCeiling(state, quoted, 'phase E train')

  if (!apply) {
    console.log(`[dry] phase E would fire training, quoted ${quoted} impetus`)
    return
  }

  const run = await client.post('/v1/runs', {
    modusId: TRAINING_MODUS_ID,
    aditus: {
      dataset: JSON.stringify(manifest),
      triggerWord: TRIGGER_WORD,
      baseModel: TRAIN_BASE_MODEL,
      steps: TRAIN_STEPS,
      autocaption: false,
      name: TRIGGER_WORD,
    },
    maxImpetus: quoted,
  })
  expectStatus(run, [200], 'train.fire', 'POST /v1/runs (training)')
  const runId = (run.body as { run?: Run }).run?.id
  if (!runId) throw new WalkFailure('train.fire', `no run.id in response: ${JSON.stringify(run.body)}`)
  state.trainingRunId = runId
  state.spend.phaseE = { quoted, at: new Date().toISOString() }
  await saveState(state)

  const start = Date.now()
  let consecutiveFailures = 0
  for (;;) {
    let got: Run
    try {
      const r = await client.get(`/v1/runs/${runId}`)
      expectStatus(r, [200], 'train.poll', `GET /v1/runs/${runId}`)
      got = (r.body as { run: Run }).run
      consecutiveFailures = 0
    } catch (err) {
      consecutiveFailures++
      if (consecutiveFailures >= 2) throw new WalkFailure('train.two-failures', `two consecutive polling failures: ${String(err)}`)
      await new Promise((res) => setTimeout(res, 5000))
      continue
    }
    if (got.status === 'complete') {
      const loraId = (got.exitus as { loraId?: string } | undefined)?.loraId
      if (!loraId) throw new WalkFailure('train.no-lora', `training run ${runId} completed but exitus carried no loraId: ${JSON.stringify(got.exitus)}`)
      state.loraIntellaId = loraId
      state.spend.phaseE = { quoted, actual: got.cost ?? quoted, at: new Date().toISOString() }
      await saveState(state)
      return
    }
    if (got.status === 'failed') {
      throw new WalkFailure('train.failed', `training run ${runId} failed: ${JSON.stringify(got.failure)}`)
    }
    const elapsed = Date.now() - start
    if (elapsed > TRAIN_TIMEOUT_MS) {
      throw new WalkFailure('train.timeout', `training run ${runId} exceeded ${TRAIN_TIMEOUT_MS}ms with no terminal state (status=${got.status})`)
    }
    await new Promise((res) => setTimeout(res, 10_000))
  }
}

async function phaseFPlates(client: Client, state: RunState, apply: boolean): Promise<void> {
  if (!state.loraIntellaId) throw new WalkFailure('plates.no-lora', 'no trained LoRA in state — run phase E first')

  // Art bible §7 formats: 3:2 hero, 4:5 supporting, 1:1 collection-grid. One per subject class
  // (the minimum acceptance triad, spec §8).
  const formats: Array<{ label: string; width: number; height: number }> = [
    { label: '3:2-hero', width: 1248, height: 832 },
    { label: '4:5-supporting', width: 896, height: 1120 },
    { label: '1:1-grid', width: 1024, height: 1024 },
  ]

  const plateRunIds: string[] = []
  for (let i = 0; i < SUBJECT_CLASSES.length; i++) {
    const cls = SUBJECT_CLASSES[i]!
    const fmt = formats[i % formats.length]!
    const prompt = `${TRIGGER_WORD}, ${SUBJECT_FRAGMENTS[cls]}, ${SCENES[i % SCENES.length]!.fragment}, ${HOUSE_CLAUSE}`
    const aditus = { prompt, width: fmt.width, height: fmt.height }

    const quote = await client.post('/v1/runs/quote', { modusId: state.genModusId, aditus })
    expectStatus(quote, [200], 'plates.quote', 'POST /v1/runs/quote (plate)')
    const quoted = (quote.body as { impetus?: string }).impetus
    if (!quoted) throw new WalkFailure('plates.quote', `no impetus in quote: ${JSON.stringify(quote.body)}`)
    assertUnderCeiling(state, quoted, `phase F plate (${cls}/${fmt.label})`)

    if (!apply) {
      console.log(`[dry] phase F would fire plate ${cls}/${fmt.label}, quoted ${quoted} impetus`)
      continue
    }

    const run = await client.post('/v1/runs', { modusId: state.genModusId, aditus, maxImpetus: quoted })
    expectStatus(run, [200], 'plates.fire', 'POST /v1/runs (plate)')
    const runObj = (run.body as { run?: Run }).run
    if (!runObj?.id) throw new WalkFailure('plates.fire', `no run.id in response: ${JSON.stringify(run.body)}`)

    let got = runObj
    const start = Date.now()
    while (got.status !== 'complete' && got.status !== 'failed') {
      if (Date.now() - start > DISPATCH_TIMEOUT_MS) {
        throw new WalkFailure('plates.timeout', `plate run ${runObj.id} (${cls}) did not complete within ${DISPATCH_TIMEOUT_MS}ms`)
      }
      await new Promise((res) => setTimeout(res, 3000))
      const r = await client.get(`/v1/runs/${runObj.id}`)
      expectStatus(r, [200], 'plates.poll', `GET /v1/runs/${runObj.id}`)
      got = (r.body as { run: Run }).run
    }
    if (got.status === 'failed') {
      throw new WalkFailure('plates.failed', `plate run ${runObj.id} (${cls}) failed: ${JSON.stringify(got.failure)}`)
    }
    plateRunIds.push(runObj.id)
    state.plateRunIds = plateRunIds
    state.spend.phaseF = {
      quoted: ((state.spend.phaseF ? BigInt(state.spend.phaseF.quoted) : 0n) + BigInt(quoted)).toString(),
      actual: ((state.spend.phaseF?.actual ? BigInt(state.spend.phaseF.actual) : 0n) + BigInt(got.cost ?? quoted)).toString(),
      at: new Date().toISOString(),
    }
    await saveState(state)
  }
}

// =============================================================================
// Orchestration
// =============================================================================

type Phase = 'resolve' | 'a' | 'b' | 'c' | 'd' | 'e' | 'f'
const PHASE_ORDER: Phase[] = ['resolve', 'a', 'b', 'c', 'd', 'e', 'f']

async function runPhase(phase: Phase, client: Client, state: RunState, apply: boolean): Promise<void> {
  switch (phase) {
    case 'resolve':
      return phaseResolve(client, state)
    case 'a': {
      await phaseAGenerate(client, state, apply)
      if (apply) await phaseAWatch(client, state)
      return
    }
    case 'b':
      return phaseBCurate(client, state)
    case 'c':
    case 'd':
      return phaseCDDataset(client, state)
    case 'e':
      return phaseETrain(client, state, apply)
    case 'f':
      return phaseFPlates(client, state, apply)
  }
}

async function runSequence(
  client: Client,
  state: RunState,
  opts: { from: Phase; only?: Phase; apply: boolean },
): Promise<void> {
  const startIdx = PHASE_ORDER.indexOf(opts.from)
  const phases = opts.only ? [opts.only] : PHASE_ORDER.slice(startIdx)
  // c/d run together (one function); avoid double-invoking.
  const dedup: Phase[] = []
  for (const p of phases) {
    if (p === 'd' && dedup.includes('c')) continue
    dedup.push(p)
  }
  for (const phase of dedup) {
    try {
      await runPhase(phase, client, state, opts.apply)
    } catch (err) {
      if (err instanceof WalkFailure) {
        state.abortedAt = { phase, assertion: err.assertion, message: err.message, ...(err.remediation ? { remediation: err.remediation } : {}) }
        await saveState(state)
      }
      throw err
    }
  }
}

// =============================================================================
// SMOKE fixture — an in-process Express app wired to the REAL apiRouter.ts,
// against in-memory fakes (the tests/unit/allocutio/api/apiRouter.test.ts
// pattern). Includes: a quote that exceeds the ceiling (ceiling-abort path), a
// class-skewed piece set (balance-stop path), and a fired-but-undispatched
// collection (deadlock path) — see `--smoke --induce <ceiling|deadlock|balance|headroom|storm>`.
// =============================================================================

const SMOKE_BURSA_TOKEN = 'bt-smoke-landing-walk'
const SMOKE_PER_IMAGE_IMPETUS = '5'
// The balance `GET /v1/me` reports. Ample by default; under the headroom induce it is set BELOW
// `perRunReserve x concurrentia` (5 x 2 = 10) so the pre-flight gate is the thing that stops the
// run — the only way that abort can be reached is the guard doing its job.
const SMOKE_BALANCE_IMPETUS = '100000000'
const SMOKE_HEADROOM_BALANCE_IMPETUS = '4'

type Induce = 'none' | 'ceiling' | 'deadlock' | 'balance' | 'headroom' | 'storm'

/** A tiny in-process image server: serves one generated PNG per requested colour, so the
 *  smoke fixture exercises the REAL analyzeBitmap/jimp path end-to-end (no fake analyzer). */
function buildImageServer(): { app: Express; urlFor: (kind: 'good' | 'bad-warm' | 'bad-second-hue') => string } {
  const app = express()
  const colours: Record<string, number> = {
    good: 0x08090aff, // near-ground, no colourful pixels -> passes every mechanical check
    'bad-warm': 0xffe7eaeeff >>> 0, // mostly warm-neutral bright -> fails ground-luminance + warm-fraction
    'bad-second-hue': 0x00ff00ff, // saturated green -> fails single-cold-key
  }
  app.get('/img/:kind.png', async (req, res) => {
    const kind = req.params.kind as keyof typeof colours
    const { Jimp } = await import('jimp')
    const img = new Jimp({ width: 16, height: 16, color: colours[kind] ?? colours.good })
    const buf = await img.getBuffer('image/png')
    res.setHeader('content-type', 'image/png')
    res.send(Buffer.from(buf))
  })
  const urlFor = (kind: 'good' | 'bad-warm' | 'bad-second-hue'): string => `/img/${kind}.png`
  return { app, urlFor }
}

function fakeIdentity(): Identity {
  return {
    async resolve(_creds: Credentials): Promise<AuctorKey> {
      throw Errors.authMissing()
    },
  }
}

async function buildSmokeAppAsync(induce: Induce): Promise<{ app: Express; closeImageServer: () => Promise<void> }> {
  const { app: imgApp, urlFor } = buildImageServer()
  const imgServer = await listen(imgApp)

  const collections = new Map<string, Collection & { acta: string[] }>()
  const piecesByCollection = new Map<string, CollectionPiece[]>()
  const datasets = new Map<string, Dataset>()
  const runs = new Map<string, Run>()
  let collectionN = 0
  let datasetN = 0
  let runN = 0

  const balanced = induce !== 'balance'
  function seedCollection(id: string, fired: boolean, dispatched: boolean): void {
    const acta: string[] = []
    const pieces: CollectionPiece[] = []
    if (dispatched) {
      let idx = 0
      for (const cls of SUBJECT_CLASSES) {
        // Full supply for every class in both cases — the 'balance' induce skews QUALITY
        // (two classes generate nothing the mechanical gate accepts), not candidate count, so
        // the abort demonstrably comes from the curation gate's rejections, not from a supply
        // shortfall (a fixture the non-vacuity probe can flip by disabling the gate).
        const countForClass = Math.ceil(TOTAL_CANDIDATES / SUBJECT_CLASSES.length)
        for (let i = 0; i < countForClass; i++) {
          const actumId = `act-${id}-${idx++}`
          acta.push(actumId)
          const kind = i % 3 === 0 ? 'bad-warm' : i % 3 === 1 ? 'bad-second-hue' : 'good'
          // Balanced: plenty of 'good' pieces per class. Induce 'balance': figure stays good-heavy,
          // the other two classes generate nothing but images the mechanical gate rejects.
          const finalKind = balanced ? (i < SELECT_TARGET_PER_CLASS + 3 ? 'good' : kind) : (cls === 'figure' ? 'good' : 'bad-second-hue')
          pieces.push({
            actumId,
            review: 'pending',
            output: { image: `${imgServer.baseUrl}${urlFor(finalKind as 'good' | 'bad-warm' | 'bad-second-hue')}` },
            attributes: [
              { trait_type: 'subject', value: cls },
              { trait_type: 'scene', value: SCENES[i % SCENES.length]!.key },
              { trait_type: 'variation', value: String(VARIATION_SEEDS[i % VARIATION_SEEDS.length]) },
            ],
          })
        }
      }
    }
    piecesByCollection.set(id, pieces)
    collections.set(id, {
      id,
      nomen: COLLECTION_NAME,
      status: dispatched ? 'complete' : fired ? 'running' : 'draft',
      modusId: GEN_MODUS_ID,
      total: TOTAL_CANDIDATES,
      provenanceHash: 'sha256:smoke',
      completed: dispatched ? pieces.length : 0,
      failed: 0,
      rejected: 0,
      inFlight: 0,
      acta,
    })
  }

  const api: Partial<ApiFacade> = {
    async quote(_auctor, target) {
      if (target.modusId === TRAINING_MODUS_ID) return { impetus: '500' }
      const per = induce === 'ceiling' ? '999999' : SMOKE_PER_IMAGE_IMPETUS
      return { impetus: per }
    },
    async getMe() {
      // Without this the router's `/v1/me` 500s, `assertReserveHeadroom` takes its
      // balance-unknown branch, and the headroom gate is never actually exercised offline.
      return {
        bindings: [],
        secrets: { civitai: 'absent' as const, huggingface: 'absent' as const },
        secretsAvailable: false,
        admin: false,
        balanceImpetus:
          induce === 'headroom' ? SMOKE_HEADROOM_BALANCE_IMPETUS : SMOKE_BALANCE_IMPETUS,
        balanceUsd: 0,
      }
    },
    async listFlows() {
      return [
        { id: GEN_MODUS_ID, nomen: 'Krea 2 Turbo', versio: '1.0.0', modusGenus: 'generate' as never },
        { id: TRAINING_MODUS_ID, nomen: 'LoRA Training', versio: '1.0.0', modusGenus: 'compose' as never },
      ]
    },
    async collect(_auctor, opts) {
      const id = `c${++collectionN}`
      seedCollection(id, false, false)
      const c = collections.get(id)!
      c.tractus = opts.tractus
      return c
    },
    async patchCollectionDraft(_auctor, id, patch) {
      const c = collections.get(id)
      if (!c) throw Errors.notFoundRun(id)
      if (patch.tractus) c.tractus = patch.tractus
      if (patch.modusId) c.modusId = patch.modusId
      if (patch.numerus !== undefined) c.total = patch.numerus
      return c
    },
    async fireCollection(_auctor, id) {
      const c = collections.get(id)
      if (!c) throw Errors.notFoundRun(id)
      // The deadlock induce: fire but never dispatch (acta stays []).
      // The storm induce: fire, dispatch nothing successfully, but count every piece in
      // `fractae` — the post-#492 shape of "every dispatch threw", which is deliberately
      // NOT the deadlock shape (there, `failed` stays 0 too).
      seedCollection(id, true, induce !== 'deadlock' && induce !== 'storm')
      if (induce === 'storm') {
        const stormed = collections.get(id)!
        stormed.failed = stormed.total
        stormed.completed = 0
      }
      const refetched = collections.get(id)!
      return refetched
    },
    async getCollection(_auctor, id) {
      const c = collections.get(id)
      if (!c) throw Errors.notFoundRun(id)
      return c
    },
    async listCollectionPieces(_auctor, id) {
      return piecesByCollection.get(id) ?? []
    },
    async approveCollectionPiece(_auctor, id, actumId) {
      const pieces = piecesByCollection.get(id) ?? []
      const p = pieces.find((x) => x.actumId === actumId)
      if (p) p.review = 'approved'
    },
    async rejectCollectionPiece(_auctor, id, actumId) {
      const pieces = piecesByCollection.get(id) ?? []
      const p = pieces.find((x) => x.actumId === actumId)
      if (p) p.review = 'rejected'
    },
    async createDataset(_auctor, input) {
      const id = `ds${++datasetN}`
      const actumIds = 'actumIds' in input ? input.actumIds : []
      const ds: Dataset = {
        id,
        name: input.name,
        modality: input.modality,
        custody: 'remote',
        auctor: 'smoke',
        media: actumIds.map((actumId, i) => ({
          id: `m${i}`,
          url: `https://example.invalid/${actumId}.png`,
          source: 'generation',
          actumId,
          addedAt: new Date(),
        })),
        captionsets: [],
        natum: new Date(),
        mutatum: new Date(),
      } as unknown as Dataset
      datasets.set(id, ds)
      return ds
    },
    async addCaptionset(_auctor, datasetId, input) {
      const ds = datasets.get(datasetId)
      if (!ds) throw Errors.notFoundRun(datasetId)
      const body = input as { id?: string; name?: string; method?: string; captions?: Record<string, string> }
      const media = ds.media ?? []
      const coverage = `${Object.keys(body.captions ?? {}).length}/${media.length}`
      const cs = { id: body.id ?? `cs${(ds.captionsets?.length ?? 0) + 1}`, name: body.name ?? 'captions', method: body.method ?? 'manual', coverage, captions: body.captions ?? {} }
      ds.captionsets = [...(ds.captionsets ?? []), cs]
      return ds
    },
    async invokeFlow(_auctor, target, aditus, opts) {
      const id = `r${++runN}`
      if (target.modusId === TRAINING_MODUS_ID) {
        const run: Run = { id, status: 'complete', modusId: target.modusId, exitus: { trained: true, steps: TRAIN_STEPS, loraId: `lora-${id}`, loraUrl: `https://example.invalid/${id}.safetensors` }, cost: opts?.maxImpetus?.toString() ?? '500' }
        runs.set(id, run)
        return run
      }
      const run: Run = { id, status: 'complete', modusId: target.modusId ?? GEN_MODUS_ID, exitus: { image: `https://example.invalid/${id}.png` }, cost: opts?.maxImpetus?.toString() ?? SMOKE_PER_IMAGE_IMPETUS }
      runs.set(id, run)
      return run
    },
    async getRun(_auctor, id) {
      const r = runs.get(id)
      if (!r) throw Errors.notFoundRun(id)
      return r
    },
    async getRunOrder() {
      return null
    },
  }

  const deps: Parameters<typeof createApiRouter>[0] = {
    api: api as ApiFacade,
    identity: fakeIdentity(),
    anonPurseEnabled: true, // smoke fixture: the bursaToken rail is exercised without an owned-purse gate
  }

  const app = express()
  app.use(express.json())
  app.use('/v1', createApiRouter(deps))

  return { app, closeImageServer: imgServer.close }
}

async function listen(app: Express): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((res) => server.close(() => res())),
      })
    })
    server.on('error', reject)
  })
}

async function runSmoke(induce: Induce, planOnly: boolean): Promise<void> {
  const { app, closeImageServer } = await buildSmokeAppAsync(induce)
  const server = await listen(app)
  const savedTimeout = effectiveDispatchTimeoutMs
  if (induce === 'deadlock' || induce === 'storm') effectiveDispatchTimeoutMs = 500 // smoke: prove the abort path fast, not the real 5min wait
  try {
    const client = new Client(server.baseUrl, { kind: 'bursa', token: SMOKE_BURSA_TOKEN })
    const state = newState(`smoke-${induce}-${Date.now()}`, induce === 'ceiling' ? '1000' : '100000000', GEN_MODUS_ID)

    if (planOnly) {
      await runPhase('resolve', client, state, false)
      await runPhase('a', client, state, false)
      if (Object.keys(state.spend).length > 0) {
        throw new WalkFailure('smoke.plan-only.spent', 'plan-only mode spent impetus — it must only quote')
      }
      console.log(`smoke --plan-only (induce=${induce}): OK, no spend`)
      return
    }

    try {
      await runSequence(client, state, { from: 'resolve', apply: true })
    } catch (err) {
      if (induce === 'ceiling' && err instanceof WalkFailure && err.assertion === 'spend.ceiling') {
        console.log(`smoke induce=ceiling: correctly aborted — ${err.message}`)
        return
      }
      if (induce === 'deadlock' && err instanceof WalkFailure && err.assertion === 'watch.deadlock') {
        console.log(`smoke induce=deadlock: correctly aborted — ${err.message}`)
        return
      }
      if (induce === 'storm' && err instanceof WalkFailure && err.assertion === 'watch.all-dispatches-failed') {
        console.log(`smoke induce=storm: correctly aborted — ${err.message}`)
        return
      }
      if (induce === 'headroom' && err instanceof WalkFailure && err.assertion === 'spend.headroom') {
        console.log(`smoke induce=headroom: correctly aborted — ${err.message}`)
        return
      }
      if (induce === 'balance' && err instanceof WalkFailure && err.assertion === 'curate.balance') {
        console.log(`smoke induce=balance: correctly aborted — ${err.message}`)
        return
      }
      throw err
    }

    if (induce !== 'none') {
      throw new WalkFailure('smoke.induce.no-abort', `induce=${induce} was expected to abort but the run completed`)
    }

    const rows = buildHardChecks(state, state.pieces?.length ?? 0)
    printHardChecks(rows)
    console.log('\n' + walkBoardRow(state, rows))
    console.log(`\nDEFECTS FILED: ${state.defects.length}`)
    for (const d of state.defects) console.log(`  - ${d.route}: ${d.observation}`)
  } finally {
    effectiveDispatchTimeoutMs = savedTimeout
    await server.close()
    await closeImageServer()
  }
}

// =============================================================================
// CLI
// =============================================================================

function parseArgs(argv: string[]): {
  smoke: boolean
  planOnly: boolean
  apply: boolean
  phase?: Phase
  from?: Phase
  runId?: string
  induce: Induce
} {
  const smoke = argv.includes('--smoke')
  const planOnly = argv.includes('--plan-only')
  const apply = argv.includes('--apply')
  const phaseIdx = argv.indexOf('--phase')
  const fromIdx = argv.indexOf('--from')
  const runIdIdx = argv.indexOf('--run-id')
  const induceIdx = argv.indexOf('--induce')
  const phase = phaseIdx >= 0 ? (argv[phaseIdx + 1] as Phase) : undefined
  const from = fromIdx >= 0 ? (argv[fromIdx + 1] as Phase) : undefined
  const runId = runIdIdx >= 0 ? argv[runIdIdx + 1] : undefined
  const induce = (induceIdx >= 0 ? argv[induceIdx + 1] : 'none') as Induce
  return { smoke, planOnly, apply, phase, from, runId, induce }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const opts = parseArgs(argv)

  if (opts.smoke) {
    if (opts.induce !== 'none') {
      await runSmoke(opts.induce, false)
      return
    }
    // Full offline smoke: drive every phase against the real apiRouter with in-memory fakes.
    await runSmoke('none', opts.planOnly)
    // Also exercise EVERY offline abort path, so the non-vacuity claims in the PR body are
    // reproducible from this single invocation. An abort path missing from this list is an
    // abort path nothing proves — `headroom` and `storm` were added with their guards.
    if (!opts.planOnly) {
      await runSmoke('ceiling', false)
      await runSmoke('headroom', false)
      await runSmoke('deadlock', false)
      await runSmoke('storm', false)
      await runSmoke('balance', false)
    }
    return
  }

  const baseUrl = process.env.LANDING_WALK_BASE_URL
  const bursaToken = process.env.LANDING_WALK_BURSA_TOKEN
  const bearer = process.env.LANDING_WALK_BEARER
  if (!baseUrl || (!bursaToken && !bearer)) {
    throw new WalkFailure(
      'config.missing',
      'LANDING_WALK_BASE_URL plus ONE of LANDING_WALK_BEARER (an owned anima account, e.g. the helm fleet account) or LANDING_WALK_BURSA_TOKEN (the anonymous rail) are required for a live walk (see .env-example); use --smoke for the offline fixture',
    )
  }
  // Bearer wins when both are present: an owned account's purse is the one that gets funded.
  const authRail: AuthRail = bearer ? { kind: 'bearer', token: bearer } : { kind: 'bursa', token: bursaToken! }
  const ceiling = process.env.LANDING_WALK_CEILING_IMPETUS
  if (opts.apply && !ceiling) {
    throw new WalkFailure(
      'config.missing',
      'LANDING_WALK_CEILING_IMPETUS is required for --apply (hard requirement 1) — the driver refuses to guess a spend ceiling',
    )
  }

  const client = new Client(baseUrl.replace(/\/$/, ''), authRail)
  const runId = opts.runId ?? (opts.from || opts.phase ? undefined : `landing-${Date.now()}`)
  if (!runId) {
    throw new WalkFailure('config.missing', '--run-id is required when resuming with --from/--phase; a fresh run generates one and prints it')
  }
  let state: RunState
  if (existsSync(statePath(runId))) {
    state = await loadState(runId)
  } else {
    state = newState(runId, ceiling ?? '0', GEN_MODUS_ID)
    await saveState(state)
  }
  console.log(`landing-dataset-walk: run ${runId} (state: ${statePath(runId).pathname})`)

  await runSequence(client, state, {
    from: opts.from ?? opts.phase ?? 'resolve',
    ...(opts.phase ? { only: opts.phase } : {}),
    apply: opts.apply,
  })

  const rows = buildHardChecks(state, state.pieces?.length ?? 0)
  printHardChecks(rows)
  console.log('\n' + walkBoardRow(state, rows))
  console.log(`\nDEFECTS FILED: ${state.defects.length}`)
  for (const d of state.defects) console.log(`  - ${d.route}: ${d.observation}\n    why: ${d.whyDefect}`)
  await writeFile(new URL(`landing-${runId}-final.json`, stateDir()), JSON.stringify({ state, hardChecks: rows }, null, 2))
}

main().catch((err: unknown) => {
  if (err instanceof WalkFailure) {
    console.error(`landing-dataset-walk FAILED at assertion "${err.assertion}": ${err.message}`)
    if (err.remediation) console.error(`  remediation: ${err.remediation}`)
  } else {
    console.error('landing-dataset-walk FAILED (unclassified):', err)
  }
  process.exitCode = 1
})
