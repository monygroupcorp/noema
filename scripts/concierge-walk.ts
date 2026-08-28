#!/usr/bin/env -S npx tsx
// =============================================================================
// concierge-walk — the concierge, walked (noema-356)
// =============================================================================
//
// The concierge has never been driven end-to-end in the product (Wave 0 truth
// table). This script is that walk, made machine-runnable: against a running
// deployment's four `/v1/colloquia` routes (colloquiaRouter.ts), over the
// anonymous bursa rail (a `bursaToken`, no animaId/commitment required) —
//
//   POST /v1/colloquia            create a thread
//   POST /v1/colloquia/:id/dicta  run one metered turn (x3, a fixed scripted brief)
//   GET  /v1/colloquia/:id        fetch the thread back, assert it round-trips
//
// It asserts the concierge converges on a `kind:'proposal'` dictum (a chosen
// flow/verb + non-empty pinnedModels) within the three scripted turns, and
// prints/records what each turn charged.
//
// IT NEVER DISPATCHES. This driver does not call, and must never call,
// `POST /v1/runs` (or any other run-creation/spend endpoint) — the proposal
// is asserted, not fired. `--smoke` additionally traps that route on its
// in-process fake server and asserts it was never hit.
//
// Two modes:
//   LIVE  (default): npx tsx scripts/concierge-walk.ts
//     Needs CONCIERGE_WALK_BASE_URL + CONCIERGE_WALK_BURSA_TOKEN (see
//     .env-example) — a real deployment and a funded bursa token, supplied by
//     the operator at run time. Never committed. This is the operator's gate;
//     building this script does not run it.
//   SMOKE: npx tsx scripts/concierge-walk.ts --smoke
//     Offline. Spins up an in-process Express app wired to REAL
//     `colloquiaRouter.ts` against in-memory fakes (colloquium/dictum stores,
//     Bursa purse, CrystalApi, OpenRouter tool-chat) — the same fixture
//     pattern as tests/unit/allocutio/api/colloquiaRouter.test.ts — and drives
//     it over real HTTP on an ephemeral loopback port. Never enters
//     `test:hermetic`; it is a separate, manual verify step.
//
// Exits non-zero on: an HTTP-transport failure, a 402 (insufficient balance),
// no proposal by turn 3, or an unresolvable proposal shape (kind is
// 'proposal' but neither modusId nor verb is set, or pinnedModels is empty).
// Each failure names WHICH assertion died, so this script's stdout is a
// quotable walk-board receipt on its own.
// =============================================================================

import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import express, { type Express } from 'express'

import {
  createColloquiaRouter,
  type ColloquiaRouterDeps,
} from '../src/allocutio/api/colloquiaRouter.js'
import type { AuctorKey } from '../src/flow/types.js'
import type { Colloquium, Dictum } from '../src/types/colloquium.js'
import type { CrystalApi } from '../src/allocutio/api/CrystalApi.js'
import type {
  OpenRouterChatResult,
  OpenRouterToolChatOpts,
  OpenRouterToolClientDeps,
} from '../src/allocutio/api/OpenRouterToolClient.js'

// -----------------------------------------------------------------------------
// The fixed scripted brief (deliberately unremarkable — this walk exercises the
// wiring, not creativity). Three turns: a plain creative ask, a follow-up
// constraint, then an explicit cost question.
// -----------------------------------------------------------------------------
const SCRIPTED_TURNS: readonly string[] = [
  'make me a picture of a fox in a forest',
  'make it look more like a watercolor painting',
  'what will that cost?',
]

// -----------------------------------------------------------------------------
// Failure classification — each carries the name of the assertion that died,
// so a failing run's stdout is self-explanatory without re-reading this file.
// -----------------------------------------------------------------------------
class WalkFailure extends Error {
  constructor(
    public readonly assertion: string,
    message: string,
  ) {
    super(message)
    this.name = 'WalkFailure'
  }
}

interface TurnReceipt {
  turnKey: string
  message: string
  status: number
  elapsedMs: number
  charged?: string
  dictumKind?: string
  idempotentReplay?: boolean
}

interface WalkReceipt {
  mode: 'live' | 'smoke'
  baseUrl: string
  colloquiumId: string
  turns: TurnReceipt[]
  totalChargedImpetus: string
  proposal: {
    modusId?: string
    verb?: string
    pinnedModels: string[]
  }
  roundTrip: { dictaCount: number; ok: boolean }
  startedAt: string
  finishedAtMs: number
}

// -----------------------------------------------------------------------------
// The HTTP driver — talks to a real `/v1/colloquia` surface (live or the smoke
// server), asserting as it goes. No knowledge of what's behind the base URL.
// -----------------------------------------------------------------------------
async function fetchJson(
  url: string,
  init: RequestInit,
): Promise<{ status: number; body: unknown }> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch (err) {
    throw new WalkFailure('http.transport', `request to ${url} failed: ${String(err)}`)
  }
  let body: unknown = undefined
  const text = await res.text()
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      throw new WalkFailure('http.transport', `${url} returned non-JSON body: ${text.slice(0, 200)}`)
    }
  }
  return { status: res.status, body }
}

async function runWalk(baseUrl: string, bursaToken: string, mode: 'live' | 'smoke'): Promise<WalkReceipt> {
  const startedAt = new Date().toISOString()
  const t0 = Date.now()
  const headers = {
    'content-type': 'application/json',
    'x-bursa-token': bursaToken,
  }

  // (1) Create the thread.
  const created = await fetchJson(`${baseUrl}/v1/colloquia`, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  })
  if (created.status !== 200) {
    throw new WalkFailure('thread.create', `POST /v1/colloquia -> ${created.status}: ${JSON.stringify(created.body)}`)
  }
  const colloquium = (created.body as { colloquium?: { id?: string } }).colloquium
  const colloquiumId = colloquium?.id
  if (!colloquiumId) {
    throw new WalkFailure('thread.create', `POST /v1/colloquia returned no colloquium.id: ${JSON.stringify(created.body)}`)
  }

  // (2) Three scripted turns, each with a fresh turnKey.
  const turns: TurnReceipt[] = []
  let totalCharged = 0n
  let lastDictumKind: string | undefined
  let lastModusId: string | undefined
  let lastVerb: string | undefined
  let lastPinnedModels: string[] = []

  for (const message of SCRIPTED_TURNS) {
    const turnKey = randomUUID()
    const t1 = Date.now()
    const res = await fetchJson(`${baseUrl}/v1/colloquia/${colloquiumId}/dicta`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ turnKey, message }),
    })
    const elapsedMs = Date.now() - t1

    if (res.status === 402) {
      throw new WalkFailure('turn.affordability', `turn "${message}" -> 402 insufficient balance: ${JSON.stringify(res.body)}`)
    }
    if (res.status !== 200) {
      throw new WalkFailure('turn.http', `POST .../dicta ("${message}") -> ${res.status}: ${JSON.stringify(res.body)}`)
    }

    const parsed = res.body as { dictum?: Dictum; charged?: string; idempotentReplay?: boolean }
    const dictum = parsed.dictum
    if (!dictum || typeof dictum.corpus !== 'string') {
      throw new WalkFailure('turn.shape', `turn "${message}" response carried no dictum.corpus: ${JSON.stringify(res.body)}`)
    }

    let corpus: unknown
    try {
      corpus = JSON.parse(dictum.corpus)
    } catch {
      // A plain reply's corpus is prose, not JSON — that's a valid interim turn.
      corpus = { kind: 'reply' }
    }
    const kind = typeof corpus === 'object' && corpus !== null ? (corpus as { kind?: unknown }).kind : undefined
    lastDictumKind = typeof kind === 'string' ? kind : undefined
    if (lastDictumKind === 'proposal') {
      const obj = corpus as { modusId?: unknown; verb?: unknown; pinnedModels?: unknown }
      lastModusId = typeof obj.modusId === 'string' ? obj.modusId : undefined
      lastVerb = typeof obj.verb === 'string' ? obj.verb : undefined
      lastPinnedModels = Array.isArray(obj.pinnedModels)
        ? obj.pinnedModels.filter((m): m is string => typeof m === 'string')
        : []
    }

    const charged = typeof parsed.charged === 'string' ? parsed.charged : '0'
    totalCharged += BigInt(charged)

    turns.push({
      turnKey,
      message,
      status: res.status,
      elapsedMs,
      charged,
      dictumKind: lastDictumKind,
      ...(parsed.idempotentReplay ? { idempotentReplay: true } : {}),
    })
  }

  // (3) Assert the final agent dictum is a resolvable proposal.
  if (lastDictumKind !== 'proposal') {
    throw new WalkFailure(
      'proposal.convergence',
      `no proposal by turn ${SCRIPTED_TURNS.length}; last dictum kind was "${lastDictumKind ?? 'unknown'}"`,
    )
  }
  if (!lastModusId && !lastVerb) {
    throw new WalkFailure('proposal.shape', 'proposal has neither modusId nor verb set')
  }
  if (lastPinnedModels.length === 0) {
    throw new WalkFailure('proposal.shape', 'proposal.pinnedModels is empty')
  }

  // (4) Fetch the thread back and assert it round-trips: one user + one agent
  // dictum per scripted turn, in a thread the caller can still read.
  const fetched = await fetchJson(`${baseUrl}/v1/colloquia/${colloquiumId}`, { method: 'GET', headers })
  if (fetched.status !== 200) {
    throw new WalkFailure('thread.roundtrip', `GET /v1/colloquia/:id -> ${fetched.status}: ${JSON.stringify(fetched.body)}`)
  }
  const dicta = (fetched.body as { dicta?: unknown[] }).dicta
  const dictaCount = Array.isArray(dicta) ? dicta.length : 0
  const expected = SCRIPTED_TURNS.length * 2
  if (dictaCount !== expected) {
    throw new WalkFailure(
      'thread.roundtrip',
      `GET /v1/colloquia/:id returned ${dictaCount} dicta, expected ${expected} (${SCRIPTED_TURNS.length} turns x user+agent)`,
    )
  }

  return {
    mode,
    baseUrl,
    colloquiumId,
    turns,
    totalChargedImpetus: totalCharged.toString(),
    proposal: { ...(lastModusId ? { modusId: lastModusId } : {}), ...(lastVerb ? { verb: lastVerb } : {}), pinnedModels: lastPinnedModels },
    roundTrip: { dictaCount, ok: true },
    startedAt,
    finishedAtMs: Date.now() - t0,
  }
}

// =============================================================================
// SMOKE fixture — an in-process Express app wired to the REAL colloquiaRouter,
// against in-memory fakes. Mirrors tests/unit/allocutio/api/colloquiaRouter.test.ts's
// harness (fakeColloquia/fakeDicta/fakeSignorum/fakeBursarium/fakeApi), scripted so
// turn 3 converges on a proposal. A trap route on POST /v1/runs records whether the
// walk ever dispatches — it must not.
// =============================================================================

function fakeColloquia() {
  const store = new Map<string, Colloquium>()
  let n = 0
  return {
    async create(input: Omit<Colloquium, 'id' | 'natum' | 'mutatum'>): Promise<Colloquium> {
      const now = new Date()
      const c: Colloquium = { ...input, id: `c-${++n}`, natum: now, mutatum: now }
      store.set(c.id, c)
      return c
    },
    async find(id: string): Promise<Colloquium | null> {
      return store.get(id) ?? null
    },
    async findByOwner(ownerKey: string): Promise<Colloquium[]> {
      return Array.from(store.values()).filter((c) => c.ownerKey === ownerKey)
    },
  }
}

class FakeDupKeyError extends Error {
  code = 11000
  constructor() {
    super('E11000 duplicate key error: turnkey_agent_charge_gate')
  }
}

function fakeDicta() {
  const store: Dictum[] = []
  let n = 0
  return {
    async create(input: Omit<Dictum, 'id' | 'natum'>): Promise<Dictum> {
      if (
        input.genus === 'agent' &&
        input.turnKey !== undefined &&
        store.some((d) => d.genus === 'agent' && d.colloquiumId === input.colloquiumId && d.turnKey === input.turnKey)
      ) {
        throw new FakeDupKeyError()
      }
      const d: Dictum = { ...input, id: `d-${++n}`, natum: new Date() }
      store.push(d)
      return d
    },
    async update(id: string, patch: Partial<Pick<Dictum, 'actumId' | 'signaIds'>>): Promise<Dictum> {
      const d = store.find((x) => x.id === id)
      if (!d) throw new Error(`Dictum not found: ${id}`)
      Object.assign(d, patch)
      return d
    },
    async listByColloquium(cid: string): Promise<Dictum[]> {
      return store.filter((d) => d.colloquiumId === cid)
    },
    async findByTurnKey(cid: string, turnKey: string): Promise<Dictum[]> {
      return store.filter((d) => d.colloquiumId === cid && d.turnKey === turnKey)
    },
  }
}

function fakeSignorum() {
  return {
    async balance(): Promise<bigint> {
      return 0n
    },
    async reserve() {
      // Not exercised on the bursaToken rail this walk drives, but must exist to
      // satisfy the router's deps shape.
      return { ok: false as const, available: 0n }
    },
    async settle(): Promise<void> {
      throw new Error('signorum.settle should not be reached on the bursa rail')
    },
    async release(): Promise<void> {},
  }
}

function fakeBursarium(credits: { v: bigint }, token: string) {
  return {
    async findByToken(t: string) {
      return t === token ? { id: token, credits: credits.v, createdAt: new Date() } : null
    },
    async debit(t: string, amount: bigint) {
      if (t !== token) throw new Error('unknown purse')
      if (credits.v < amount) throw new Error('insufficient purse')
      credits.v -= amount
      return { id: token, credits: credits.v, createdAt: new Date() }
    },
  }
}

// invokeFlow/createRun/collect/provisionStudio all throw — the smoke fixture must
// never let the concierge turn reach a spend method, matching ConciergeAgent's own
// invariant (a).
function fakeApi(): CrystalApi {
  const spend = (name: string) => {
    throw new Error(`concierge turn must never call ${name}`)
  }
  return {
    async getMe() {
      return { bindings: [], generatio: { spicyMode: false }, secrets: {}, secretsAvailable: false, admin: false }
    },
    async getRun() {
      throw new Error('getRun not stubbed for the smoke walk')
    },
    async listFlows() {
      return []
    },
    async describeFlow() {
      return {}
    },
    async listModels() {
      return []
    },
    async quote() {
      return { impetus: '10', recipient: 'platform' }
    },
    async resolvePinnedModels() {
      return []
    },
    async invokeFlow() {
      return spend('invokeFlow')
    },
    async createRun() {
      return spend('createRun')
    },
    async collect() {
      return spend('collect')
    },
    async provisionStudio() {
      return spend('provisionStudio')
    },
  } as unknown as CrystalApi
}

/** Scripted OpenRouter replies, one per turn: two plain conversational replies,
 *  then a resolvable proposal on turn 3. Exported so the non-vacuity check
 *  (see the PR body) can be reproduced by swapping the last entry for a reply. */
export function scriptedTurnResults(): OpenRouterChatResult[] {
  return [
    { content: JSON.stringify({ kind: 'reply', text: 'Got it — a fox in a forest. Any style in mind?' }), finishReason: 'stop', tokenUsage: { totalTokens: 40 } },
    { content: JSON.stringify({ kind: 'reply', text: 'Noted — watercolor. Want me to price that up?' }), finishReason: 'stop', tokenUsage: { totalTokens: 45 } },
    {
      content: JSON.stringify({
        kind: 'proposal',
        modusId: 'flux.txt2img',
        aditus: { prompt: 'a fox in a forest' },
        pinnedModels: ['lora_watercolor'],
        embellishedPrompt: 'a fox in a forest, watercolor painting, soft edges',
        rationale: 'flux for photoreal base, watercolor lora for the requested style',
      }),
      finishReason: 'stop',
      tokenUsage: { totalTokens: 60 },
    },
  ]
}

function fakeRunToolChat(script: OpenRouterChatResult[]) {
  let i = 0
  return async (_deps: OpenRouterToolClientDeps, _opts: OpenRouterToolChatOpts): Promise<OpenRouterChatResult> => {
    const r = script[Math.min(i, script.length - 1)]
    i++
    return r
  }
}

const SMOKE_BURSA_TOKEN = 'bt-smoke-walk'

function buildSmokeApp(script: OpenRouterChatResult[]): { app: Express; runsCalled: { v: boolean } } {
  const bursaCredits = { v: 100_000n }
  const auctor: AuctorKey = { bursaToken: SMOKE_BURSA_TOKEN }

  const deps: ColloquiaRouterDeps = {
    identity: { resolve: async () => auctor },
    colloquia: fakeColloquia() as unknown as ColloquiaRouterDeps['colloquia'],
    dicta: fakeDicta() as unknown as ColloquiaRouterDeps['dicta'],
    signorum: fakeSignorum() as unknown as ColloquiaRouterDeps['signorum'],
    bursarium: fakeBursarium(bursaCredits, SMOKE_BURSA_TOKEN) as unknown as ColloquiaRouterDeps['bursarium'],
    api: fakeApi(),
    agent: { runToolChat: fakeRunToolChat(script), toolClient: { http: {} as never, apiKey: 'k' } },
  }

  const app = express()
  app.use(express.json())
  app.use('/v1/colloquia', createColloquiaRouter(deps))

  // The never-dispatches trap. `/v1/runs` is the live app's real GO endpoint; this
  // smoke server only ever needs to prove the walk driver never calls it.
  const runsCalled = { v: false }
  app.post('/v1/runs', (_req, res) => {
    runsCalled.v = true
    res.status(500).json({ error: { code: 'walk.must_not_dispatch', message: 'concierge-walk must never call /v1/runs' } })
  })

  return { app, runsCalled }
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

// -----------------------------------------------------------------------------
// Receipts — printed to stdout always, and written to walk-runs/ (gitignored;
// this driver only ever writes there, never stages/commits anything).
// -----------------------------------------------------------------------------
function printReceipt(r: WalkReceipt): void {
  console.log(JSON.stringify(r, null, 2))
  console.log(
    `\nconcierge-walk (${r.mode}): ${r.turns.length} turns, ${r.finishedAtMs}ms, ` +
      `${r.totalChargedImpetus} impetus charged total, proposal ${r.proposal.modusId ?? r.proposal.verb ?? '?'} ` +
      `pinnedModels=[${r.proposal.pinnedModels.join(', ')}]`,
  )
}

async function writeReceipt(r: WalkReceipt): Promise<string> {
  const dir = new URL('../walk-runs/', import.meta.url)
  await mkdir(dir, { recursive: true })
  const path = new URL(`concierge-${Date.now()}.json`, dir)
  await writeFile(path, JSON.stringify(r, null, 2))
  return path.pathname
}

async function main(): Promise<void> {
  const smoke = process.argv.includes('--smoke')

  if (smoke) {
    const { app, runsCalled } = buildSmokeApp(scriptedTurnResults())
    const server = await listen(app)
    try {
      const receipt = await runWalk(server.baseUrl, SMOKE_BURSA_TOKEN, 'smoke')
      if (runsCalled.v) {
        throw new WalkFailure('never.dispatches', 'the walk called POST /v1/runs — it must never dispatch')
      }
      printReceipt(receipt)
      const path = await writeReceipt(receipt)
      console.log(`receipt written: ${path}`)
    } finally {
      await server.close()
    }
    return
  }

  const baseUrl = process.env.CONCIERGE_WALK_BASE_URL
  const bursaToken = process.env.CONCIERGE_WALK_BURSA_TOKEN
  if (!baseUrl || !bursaToken) {
    throw new WalkFailure(
      'config.missing',
      'CONCIERGE_WALK_BASE_URL and CONCIERGE_WALK_BURSA_TOKEN are both required for a live walk (see .env-example); use --smoke for the offline fixture',
    )
  }
  const receipt = await runWalk(baseUrl.replace(/\/$/, ''), bursaToken, 'live')
  printReceipt(receipt)
  const path = await writeReceipt(receipt)
  console.log(`receipt written: ${path}`)
}

main().catch((err: unknown) => {
  if (err instanceof WalkFailure) {
    console.error(`concierge-walk FAILED at assertion "${err.assertion}": ${err.message}`)
  } else {
    console.error('concierge-walk FAILED (unclassified):', err)
  }
  process.exitCode = 1
})
