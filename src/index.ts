import { MongoClient } from 'mongodb'
import { Telegraf } from 'telegraf'
import express from 'express'
import OpenAI from 'openai'

import { createContainer } from './container.js'
import type { Ring, ContainerConfig } from './container.js'
import { Nexus } from './ledger/Nexus.js'
import { MongoFlowContextStore } from './flow/MongoFlowContextStore.js'
import { FlowRouter } from './flow/FlowRouter.js'
import type { StepCallback, ResolutionCallback } from './flow/FlowRouter.js'
import { ExecuteFlow } from './flow/flows/ExecuteFlow.js'
import { TelegramAllocutio } from './allocutio/telegram/TelegramAllocutio.js'
import type { RouterDeps, IdentityResolver } from './allocutio/telegram/TelegramAllocutio.js'
import { makeTelegramSender } from './allocutio/telegram/TelegramSenderAdapter.js'
import type { AuctorKey } from './flow/types.js'
import { createWebhookRouter } from './api/webhooks/webhookRouter.js'
import { handleAlchemyWebhook } from './api/webhooks/alchemyWebhook.js'
import { createVestigiaRouter } from './api/vestigia/vestigiaRouter.js'
import { createArcanumRouter } from './api/arcanum/arcanumRouter.js'
import { CrystalApi } from './allocutio/api/CrystalApi.js'
import { IdentityResolver as ApiIdentityResolver, credentialsFromHeaders } from './allocutio/api/IdentityResolver.js'
import { createApiRouter } from './allocutio/api/apiRouter.js'
import { makeCredentialAcceptors } from './allocutio/api/apiAcceptors.js'
import { RunEventHub } from './allocutio/api/RunEventHub.js'
import { isSafeWebhookUrl } from './allocutio/api/webhookGuard.js'
import { createMcpRouter } from './allocutio/api/mcp/mcpRouter.js'
import { bus } from './lib/bus.js'
import { createHash } from 'node:crypto'
import { createLiveRouter } from './api/internal/liveRouter.js'
import { WideEventStore }         from './analytics/WideEventStore.js'
import { ensureWideIndexes }      from './analytics/ensureWideIndexes.js'
import { startAnalyticsListener } from './analytics/analyticsListener.js'
import { createAnalyticsRouter }  from './api/internal/analyticsRouter.js'
import { PublicationWorker } from './crystal/PublicationWorker.js'
import { registerProgressusRecorder } from './execution/progressusSink.js'
import { CANONICAL_MODI } from './crystal/seeds/modi.js'
import { CANONICAL_ESSENTIAE } from './crystal/seeds/essentiae.js'
import { CANONICAL_COMPOSITI } from './crystal/seeds/compositi.js'
import { CANONICAL_FUNDAMENTA } from './crystal/seeds/fundamenta.js'
import { makeLogger } from './lib/logger.js'
import { withTrace, makeTraceContext } from './lib/trace.js'

import { hostCutHook } from './ledger/hooks/hostCut.js'
import { hospitiumHook } from './ledger/hooks/hospitium.js'
import { modelRoyaltyHook } from './ledger/hooks/modelRoyalty.js'
import { studioSpendHook } from './ledger/hooks/studioSpend.js'
import { platformSkimHook } from './ledger/hooks/platformSkim.js'
import { referralSplitHook } from './ledger/hooks/referralSplit.js'
import { sessionSpendHook } from './ledger/hooks/sessionSpend.js'
import { spellRoyaltyHook } from './ledger/hooks/spellRoyalty.js'
import { SecurePodClient, makeSecurePodSshFactory, type R2Config, type StudioStageCb } from './crystal/SecurePodClient.js'
import { FakeRunPodClient } from './crystal/FakeRunPodClient.js'
import { FakeWarmPodClient } from './crystal/FakeWarmPodClient.js'
import { WarmPodClient } from './crystal/WarmPodClient.js'
import { ModelInstaller } from './crystal/ModelInstaller.js'
import { InstallCoordinator } from './crystal/InstallCoordinator.js'
import { terminatePod, listRunPodPods } from './crystal/terminatePod.js'
import { MongoMateria } from './crystal/MongoMateria.js'
import { MongoHospitium } from './crystal/MongoHospitium.js'
import { startIdleReaper } from './crystal/idleReaper.js'
import { startCensus } from './crystal/Census.js'
import { MongoIntella } from './crystal/MongoIntella.js'
import { R2Uploader } from './crystal/R2Uploader.js'
import { httpMediaFetcher } from './crystal/MediaFetcher.js'
import { makeTrainingFinalizer, urlLoraReader, makeTrainingExitusResolver } from './crystal/trainingFinalizer.js'
import { MongoConsuetudinum } from './crystal/MongoConsuetudinum.js'
import { MongoFundamentorum } from './crystal/MongoFundamentorum.js'
import { Compiler } from './crystal/Compiler.js'
import { WorkflowTemplateRegistry } from './crystal/WorkflowTemplateRegistry.js'
import { CANONICAL_INTELLAE } from './crystal/seeds/intellae.js'
import { ensureIndexes } from './crystal/ensureIndexes.js'
import type { Essentia } from './types/essendi.js'
import path from 'node:path'
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { makeSnarkjsVerifier } from './arcanum/ArcanumVerifier.js'

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

const BOT_TOKEN = process.env.BOT_TOKEN
if (!BOT_TOKEN) throw new Error('BOT_TOKEN is required')

const MONGODB_URI = process.env.MONGODB_URI
if (!MONGODB_URI) throw new Error('MONGODB_URI is required')

const DB_NAME = process.env.DB_NAME ?? 'noema'
const PORT = Number(process.env.PORT ?? 3000)
const RUNPOD_WEBHOOK_SECRET = process.env.RUNPOD_WEBHOOK_SECRET
const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY
const RUNPOD_SSH_KEY_PATH = process.env.RUNPOD_SSH_KEY_PATH ?? `${process.env.HOME}/.ssh/runpod`
const RUNPOD_CLOUD_TYPE = (process.env.RUNPOD_CLOUD_TYPE ?? 'SECURE') as 'SECURE' | 'COMMUNITY'
const RUNPOD_KEEP_WARM = process.env.RUNPOD_KEEP_WARM !== 'false'  // default true
const RUNPOD_WARM_TTL_MS = Number(process.env.RUNPOD_WARM_TTL_MS ?? 60_000)  // idle window before reaper kills a warm pod
// Production: derive from public WEBHOOK_URL. Local dev: post back to ourselves.
// SecurePodClient runs on our server (not on the pod), so localhost always works.
const RUNPOD_WEBHOOK_URL = process.env.WEBHOOK_URL
  ? `https://${process.env.WEBHOOK_URL.replace(/^https?:\/\//, '').replace(/\/$/, '')}/webhooks/runpod`
  : `http://localhost:${process.env.PORT ?? 3000}/webhooks/runpod`
// Where a remote training pod POSTs its `/runner/status` Progressus — same host as the webhook.
const RUNNER_STATUS_URL = process.env.WEBHOOK_URL
  ? `https://${process.env.WEBHOOK_URL.replace(/^https?:\/\//, '').replace(/\/$/, '')}/runner/status`
  : `http://localhost:${process.env.PORT ?? 3000}/runner/status`
// Remote ai-toolkit training (Slice E) — the training modus runs on billed SECURE pods.
// No enable flag: the container registers the cursor wherever its real deps exist (a RunPod
// client with launchTrainingPod + R2 + a webhook URL) — the same dependency-presence gating
// every other cursor uses. ai-toolkit is bootstrapped over SSH onto a stock torch≥2.9 base (no
// custom image); AITK_REMOTE_IMAGE optionally overrides the base, AITK_REF the cloned commit.
const AITK_REMOTE_IMAGE = process.env.AITK_REMOTE_IMAGE
const AITK_REF = process.env.AITK_REF
const AITK_REMOTE_MAX_SECONDS = process.env.AITK_REMOTE_MAX_SECONDS ? Number(process.env.AITK_REMOTE_MAX_SECONDS) : undefined
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY
const R2_OUTPUTS_BUCKET = process.env.R2_OUTPUTS_BUCKET ?? process.env.R2_BUCKET_NAME
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL
const TELEGRAM_WEBHOOK_URL = process.env.TELEGRAM_WEBHOOK_URL

// TEE private compute — optional. Set TEE_IMAGE_ID to enable real pod provisioning.
const TEE_IMAGE_ID        = process.env.TEE_IMAGE_ID         // e.g. "monyrth/tee-runner:latest"
const TEE_PLATFORM_CALLBACK = process.env.TEE_PLATFORM_CALLBACK  // e.g. "https://api.noema.ai"
const TEE_GPU_TYPE_IDS    = process.env.TEE_GPU_TYPE_IDS?.split(',').map(s => s.trim()).filter(Boolean)

// ---------------------------------------------------------------------------
// Arcanum verifier — load snarkjs VerifyFn when the ceremony key is present
// ---------------------------------------------------------------------------

const _vKeyPath = path.join(__dirname, 'arcanum', 'circuit', 'artifacts', 'verification_key.json')
let _arcanumVerifyFn: ReturnType<typeof makeSnarkjsVerifier> | undefined
if (existsSync(_vKeyPath)) {
  try {
    _arcanumVerifyFn = makeSnarkjsVerifier(JSON.parse(readFileSync(_vKeyPath, 'utf8')))
  } catch (err) {
    // Malformed vkey — proceed without ZK verification rather than crashing at startup
    console.error('[arcanum] verification_key.json is invalid, ZK proofs disabled:', err)
  }
}

// ---------------------------------------------------------------------------
// Fractal Tool Compiler — compiles Essentia + aditus → RunPod job input
// ---------------------------------------------------------------------------

const templateRegistry = new WorkflowTemplateRegistry(
  path.join(__dirname, 'crystal', 'workflows')
)

// ---------------------------------------------------------------------------
// RunPod SECURE pod client — provisions a GPU machine, SSHes in, runs ComfyUI
// ---------------------------------------------------------------------------

import type { Materia, MateriaStore } from './types/materia.js'
import type { HospitiumStore } from './types/hospitium.js'

const RUNPOD_R2: R2Config | undefined =
  R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_OUTPUTS_BUCKET
    ? { endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, accessKeyId: R2_ACCESS_KEY_ID!, secretAccessKey: R2_SECRET_ACCESS_KEY!, bucket: R2_OUTPUTS_BUCKET!, publicUrl: R2_PUBLIC_URL }
    : undefined

/**
 * Durably materialise the RunPod SSH key (incident 2026-06-19). The key MUST survive a
 * container *recreate* — so we write it from the `RUNPOD_SSH_KEY` (base64) secret on boot
 * when the file is absent, instead of relying on a hand-placed file inside a live container
 * that a recreate silently wipes. Idempotent: a present key is left untouched. If we'll need
 * a key and still have none, fail LOUD (so a missing key shows at boot, not 10 min into a
 * stuck pod run).
 */
let _sshKeyEnsured = false
function ensureRunpodSshKey(): void {
  if (_sshKeyEnsured) return
  _sshKeyEnsured = true
  const sshLog = makeLogger('startup')
  const b64 = process.env.RUNPOD_SSH_KEY
  if (b64 && !existsSync(RUNPOD_SSH_KEY_PATH)) {
    try {
      mkdirSync(path.dirname(RUNPOD_SSH_KEY_PATH), { recursive: true, mode: 0o700 })
      writeFileSync(RUNPOD_SSH_KEY_PATH, Buffer.from(b64, 'base64'), { mode: 0o600 })
      sshLog.info('RunPod SSH key materialised from RUNPOD_SSH_KEY env', { path: RUNPOD_SSH_KEY_PATH })
    } catch (err) {
      sshLog.error('failed to write RunPod SSH key from RUNPOD_SSH_KEY', { path: RUNPOD_SSH_KEY_PATH, error: String(err) })
    }
  }
  if (!existsSync(RUNPOD_SSH_KEY_PATH)) {
    sshLog.warn('⚠ RunPod SSH key MISSING — SECURE pod runs WILL FAIL. Set RUNPOD_SSH_KEY (base64) in the container env, or place the key file at this path.', { path: RUNPOD_SSH_KEY_PATH })
  }
}

function makeSecureRunPodClient(materiae?: MateriaStore, hospitia?: HospitiumStore): SecurePodClient {
  const r2 = RUNPOD_R2
  ensureRunpodSshKey()

  return new SecurePodClient(
    {
      apiKey: RUNPOD_API_KEY!,
      cloudType: RUNPOD_CLOUD_TYPE,
      sshKeyPath: RUNPOD_SSH_KEY_PATH,
      keepWarm: RUNPOD_KEEP_WARM,
      warmTtlMs: RUNPOD_WARM_TTL_MS,
      r2,
    },
    makeSecurePodSshFactory(RUNPOD_SSH_KEY_PATH),
    globalThis.fetch,
    materiae,
    hospitia,
  )
}

// ---------------------------------------------------------------------------
// TelegramIdentityResolver
// ---------------------------------------------------------------------------

class TelegramIdentityResolver implements IdentityResolver {
  constructor(private readonly ring: Ring) {}

  async resolve(telegramUserId: string): Promise<AuctorKey> {
    const existing = await this.ring.personae.findByExternus('telegram', telegramUserId)
    if (existing) return { animaId: existing.activeAnimaId }

    const anima = await this.ring.animae.create({
      nomen: `tg:${telegramUserId}`,
    })
    await this.ring.personae.findOrCreate('telegram', telegramUserId, { animaId: anima.id })
    return { animaId: anima.id }
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const log = makeLogger('startup')

  // 0. Record startup time (used to filter stale Telegram updates)
  const botStartupTime = Date.now()

  if (_arcanumVerifyFn) {
    log.info('arcanum: verification_key.json loaded — ZK spend proofs active')
  } else {
    log.warn('arcanum: verification_key.json absent — ZK spend proofs disabled (run arcanum-trusted-setup.sh)')
  }

  // 1. Connect MongoDB
  const mongo = new MongoClient(MONGODB_URI as string)
  await mongo.connect()
  log.info('MongoDB connected')
  await ensureIndexes(mongo.db(DB_NAME))
  await ensureWideIndexes(mongo.db(DB_NAME))
  log.info('Indexes ensured')

  // 2. Build embedding functions (CLIP service) and OpenAI client
  const CLIP_SERVICE_URL = process.env.CLIP_SERVICE_URL

  let embed: ContainerConfig['embed'] | undefined
  let embedImage: ContainerConfig['embedImage'] | undefined

  if (CLIP_SERVICE_URL) {
    const clipPost = async (path: string, body: unknown): Promise<number[]> => {
      const res = await fetch(`${CLIP_SERVICE_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const msg = await res.text().catch(() => '')
        throw new Error(`CLIP service ${path} failed: ${res.status} ${msg}`)
      }
      return (await res.json() as { embedding: number[] }).embedding
    }
    embed      = (text) => clipPost('/embed/text',  { text })
    embedImage = (url)  => clipPost('/embed/image', { url })
    log.info(`CLIP service: ${CLIP_SERVICE_URL}`)
  } else {
    log.warn('CLIP_SERVICE_URL not set — vestigium embeddings disabled')
  }

  let openaiClient: ContainerConfig['openaiClient'] | undefined
  if (process.env.OPENAI_API_KEY) {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    openaiClient = {
      chat: async (rawParams) => {
        const params = rawParams as { model: string; messages: unknown[]; temperature?: number }
        const res = await openai.chat.completions.create({
          model: params.model,
          messages: params.messages as OpenAI.Chat.ChatCompletionMessageParam[],
          temperature: params.temperature,
        })
        return {
          content: res.choices[0]?.message?.content ?? '',
          usage: { total_tokens: res.usage?.total_tokens },
        }
      },
      image: async (rawParams) => {
        const params = rawParams as { model: string; prompt: string; size?: string; quality?: string; n?: number }
        const res = await openai.images.generate({
          model: params.model,
          prompt: params.prompt,
          size: params.size as OpenAI.ImageGenerateParams['size'],
          quality: params.quality as OpenAI.ImageGenerateParams['quality'],
          n: params.n,
        })
        return { url: res.data?.[0]?.url ?? '' }
      },
    }
  }

  // 3. Create Ring
  // Create materiae + intellae stores before container so they can be shared
  const materiaCol = mongo.db(DB_NAME).collection('materiae')
  const materiae = new MongoMateria(materiaCol)
  // Hospitium pairs identity-bearing hosting metadata to each Materia, off-pod.
  const hospitiaCol = mongo.db(DB_NAME).collection('hospitia')
  const hospitia = new MongoHospitium(hospitiaCol)

  const intellaeCol = mongo.db(DB_NAME).collection('intellae')
  const intellae = new MongoIntella(intellaeCol)

  // Owner-keyed verb→flow bindings — backs /bind persistence + per-user /make resolution.
  const consuetudinumCol = mongo.db(DB_NAME).collection('consuetudinum')
  const consuetudinum = new MongoConsuetudinum(consuetudinumCol)
  // Compute-substrate registry (ADR-0005) — the Fundamenta essentiae reference for image/runtime/weights.
  const fundamentorum = new MongoFundamentorum(mongo.db(DB_NAME).collection('fundamenta'))
  const compiler = new Compiler(templateRegistry, undefined, intellae, fundamentorum)
  const compile = async (modus: unknown, aditus: Record<string, unknown>, pinnedModels?: import('./types/actum.js').ModelRef[]): Promise<{ hash: string; input: unknown }> => {
    const essentia = modus as Essentia
    if (!essentia.fundamentumId) {
      throw new Error(`Modus '${essentia.id}' has no fundamentumId — cannot compile for a pod`)
    }
    const { hash, spec } = await compiler.compile(essentia, aditus, pinnedModels ? { pinnedModels } : {})
    return { hash, input: spec }
  }

  // DEV_FAKE_POD: simulate the whole pod lifecycle locally (no real GPU, $0) so the
  // Telegram UX can be iterated for free. Falls back to the real SECURE cursor otherwise.
  const runpodClient = process.env.DEV_FAKE_POD
    ? new FakeRunPodClient(undefined, { warmTtlMs: RUNPOD_WARM_TTL_MS }, materiae, hospitia)
    : (RUNPOD_API_KEY ? makeSecureRunPodClient(materiae, hospitia) : undefined)
  if (process.env.DEV_FAKE_POD) log.warn('DEV_FAKE_POD active — pods are simulated, no real GPU will be provisioned')

  // In fake mode, warm reuse must NOT build a real WarmPodClient (it would SSH).
  const fakeWarmFactory = process.env.DEV_FAKE_POD
    ? (m: Materia, ms: MateriaStore) => new FakeWarmPodClient(m, ms, undefined, { warmTtlMs: RUNPOD_WARM_TTL_MS })
    : undefined

  const podTerminator = RUNPOD_API_KEY
    ? (podId: string) => terminatePod(RUNPOD_API_KEY!, podId)
    : undefined

  // Live model-apply (Part B) — install model(s) onto a warm pod (no gen). Fake mode simulates the
  // download; real posts to comfyrunner /install via WarmPodClient. The ModelInstaller resolves
  // intella ids → download refs and persists the installedModels union; the InstallCoordinator
  // serializes installs PER POD so the live-apply path (Mod • Add) and the gen-admission gate
  // (B4) never double-download the same file. Shared by both, so a gen awaits an in-flight add.
  const warmInstallClientFor = fakeWarmFactory
    ? (m: Materia) => fakeWarmFactory(m, materiae)
    : (m: Materia) => new WarmPodClient(m, materiae)
  const installCoordinator = (runpodClient || process.env.DEV_FAKE_POD)
    ? new InstallCoordinator(new ModelInstaller({ intellarum: intellae, materiae, clientFor: warmInstallClientFor }))
    : undefined

  const ring = createContainer(mongo, {
    mongoUri: MONGODB_URI as string,
    dbName: DB_NAME,
    compile: compile as ContainerConfig['compile'],
    materiae,   // pre-created, shared with SecurePodClient
    hospitia,   // pre-created, shared with SecurePodClient + TelegramAllocutio
    terminatePod: podTerminator,
    ...(runpodClient && RUNPOD_WEBHOOK_URL ? {
      runpodClient,
      runpodWebhookUrl: RUNPOD_WEBHOOK_URL,
      runpodR2: RUNPOD_R2,
      runpodWarmTtlMs: RUNPOD_WARM_TTL_MS,
      ...(fakeWarmFactory ? { warmFactory: fakeWarmFactory } : {}),
      ...(installCoordinator ? {
        admitWarm: (m: Materia, models: Array<{ id?: string }>) => installCoordinator.ensureForGen(m, models),
        installLive: (m: Materia, ids: string[]) => installCoordinator.installLive(m, ids),
      } : {}),
    } : {}),
    aitoolkitRemote: {
      statusUrl: RUNNER_STATUS_URL,
      ...(AITK_REMOTE_IMAGE ? { image: AITK_REMOTE_IMAGE } : {}),
      ...(AITK_REF ? { aitkRef: AITK_REF } : {}),
      ...(AITK_REMOTE_MAX_SECONDS !== undefined ? { maxTrainingSeconds: AITK_REMOTE_MAX_SECONDS } : {}),
    },
    ...(process.env.HF_TOKEN ? { huggingFaceToken: process.env.HF_TOKEN } : {}),
    ...(openaiClient ? { openaiClient } : {}),
    ...(embed ? { embed } : {}),
    ...(embedImage ? { embedImage } : {}),
    ...(_arcanumVerifyFn ? { arcanumVerifyFn: _arcanumVerifyFn } : {}),
    ...(TEE_IMAGE_ID && RUNPOD_API_KEY && TEE_PLATFORM_CALLBACK ? {
      teeProvisioner: {
        apiKey:           RUNPOD_API_KEY,
        imageId:          TEE_IMAGE_ID,
        platformCallback: TEE_PLATFORM_CALLBACK,
        cloudType:        RUNPOD_CLOUD_TYPE,
        ...(TEE_GPU_TYPE_IDS?.length ? { gpuTypeIds: TEE_GPU_TYPE_IDS } : {}),
      },
    } : {}),
  })

  // 3b. Rehydrate in-flight collections from DB (recovery after restart)
  await ring.collectioCursor.rehydrate()
  log.info('CollectioCursor rehydrated')

  // 3c. Recover expired acta — release locked signa; fail() now also kills any live pod
  const expired = await ring.actorum.findExpired()
  if (expired.length) {
    log.info(`Recovering ${expired.length} expired acta`)
    await Promise.all(expired.map(async a => {
      await ring.completor.fail(a, 'Actum expired — pod never reported back')
      // A recovered compositus step must fail its parent run too — the sweep bypasses
      // the webhook, so notify the engine directly (fails the parent + frees state).
      if (a.compositum) {
        await ring.compositusCursor.onStepComplete(a.compositum.parentId, a, false).catch(() => {})
      }
    }))
  }

  // 3d. Reconcile against live RunPod pods — terminate any pod not tracked by the DB.
  // This is the catch-all invariant: even if a pod ID slipped through without being written
  // to an actum or Materia, it gets killed on the next startup.
  if (RUNPOD_API_KEY) {
    try {
      const livePods = await listRunPodPods(RUNPOD_API_KEY)
      const knownPodIds = new Set<string>()
      for (const a of await ring.actorum.findInFlight()) if (a.externusJobId) knownPodIds.add(a.externusJobId)
      for (const m of await materiae.findActive()) knownPodIds.add(m.externusId)

      const orphans = livePods.filter(p => p.desiredStatus === 'RUNNING' && !knownPodIds.has(p.id))
      if (orphans.length > 0) {
        log.warn(`found ${orphans.length} orphaned pod(s) — terminating`, { ids: orphans.map(p => p.id) })
        await Promise.allSettled(orphans.map(p => terminatePod(RUNPOD_API_KEY!, p.id)))
      } else if (livePods.length > 0) {
        log.info(`pod reconciliation: ${livePods.length} pod(s) accounted for`)
      }
    } catch (err) {
      log.warn('pod reconciliation error', { error: (err as Error).message })
    }
  }

  // 4. Create Nexus, register hooks
  const nexus = new Nexus()
  nexus.on('execution_spend', hostCutHook)
  nexus.on('execution_spend', hospitiumHook)
  nexus.on('execution_spend', spellRoyaltyHook)
  nexus.on('execution_spend', modelRoyaltyHook)
  nexus.on('royalty_fired', platformSkimHook)
  nexus.on('session_spend', sessionSpendHook)
  nexus.on('studio_spend', studioSpendHook)
  nexus.on('deposit_confirmed', referralSplitHook)

  // 4. Seed canonical modi + essentiae + intellae + fundamenta
  for (const modus of CANONICAL_MODI) {
    await ring.modorum.register(modus)
  }
  log.info(`Seeded ${CANONICAL_MODI.length} canonical modi`)

  for (const fundamentum of CANONICAL_FUNDAMENTA) {
    await fundamentorum.register(fundamentum)
  }
  log.info(`Seeded ${CANONICAL_FUNDAMENTA.length} canonical fundamenta`)

  for (const essentia of CANONICAL_ESSENTIAE) {
    await ring.modorum.register(essentia)
  }
  log.info(`Seeded ${CANONICAL_ESSENTIAE.length} canonical essentiae`)

  // Compositus modi (spells) — registered after the atomic essentiae they reference.
  for (const compositus of CANONICAL_COMPOSITI) {
    await ring.modorum.register(compositus)
  }
  log.info(`Seeded ${CANONICAL_COMPOSITI.length} canonical compositi`)

  for (const intella of CANONICAL_INTELLAE) {
    await intellae.upsert(intella)
  }
  log.info(`Seeded ${CANONICAL_INTELLAE.length} canonical intellae`)

  // 5. Create FlowContextStore + FlowRouter bridge
  let stepCb: StepCallback | null = null
  let resCb: ResolutionCallback | null = null

  const store = new MongoFlowContextStore(mongo.db(DB_NAME))
  await store.hydrate()

  const router = new FlowRouter({
    store,
    onStep: (ctx, step) => stepCb?.(ctx, step),
    onResolution: (ctx, res) => resCb?.(ctx, res),
  })

  // RouterDeps adapter
  const routerDeps: RouterDeps = {
    enter: (intent, platform, userId, identity, ctx) =>
      router.enter(intent, platform, userId, identity, ctx),
    handle: (platform, userId, event) => router.handle(platform, userId, event),
    clear: (platform, userId) => router.clear(platform, userId),
    hasContext: (platform, userId) => store.get(platform, userId) !== null,
    peek: (platform, userId) => store.get(platform, userId) ?? null,
    onStep: (cb) => { stepCb = cb },
    onResolution: (cb) => { resCb = cb },
  }

  // 6. Register ExecuteFlow
  const executeFlow = new ExecuteFlow({
    modorum: ring.modorum,
    signorum: ring.signorum,
    actorum: ring.actorum,
    completor: ring.completor,
    cursorum: ring.cursorum,
    inceptor: ring.inceptor,
    actumIndex: ring.actumIndex,
    compositusCursor: ring.compositusCursor,
  })
  router.register(executeFlow)

  // 7. Create TelegramAllocutio
  const tgBot = new Telegraf(BOT_TOKEN as string)
  const identityResolver = new TelegramIdentityResolver(ring)

  // `/arm` Start — lease a warm studio (no gen) for the host via the Conductor (ADR-0006).
  // The Conductor is the single studio-lifecycle anchor: it provisions the Materia, binds a
  // Hospitium keyed by the host (so a studio is never host-less), installs the loadout live,
  // and opens a budgeted Modo. The adapter supplies the host AuctorKey + the session budget
  // (the host's current balance — Census drains the studio when spend crosses it). Present in
  // both fake and real mode (the pod client doubles as the Procurator); absent → no Start.
  const provisionStudio = ring.conductor
    ? async (
        auctor: AuctorKey,
        opts: { models: Array<{ intellaId: string }>; runtime?: string; warmMs?: number },
        onStage?: StudioStageCb,
      ) => {
        const budget = 'bursaToken' in auctor ? 0n : await ring.signorum.balance(auctor).catch(() => 0n)
        const handle = await ring.conductor!.conducere(
          auctor,
          {
            budget,
            models: opts.models.map(m => m.intellaId),
            ...(opts.runtime ? { runtime: opts.runtime } : {}),
            ...(opts.warmMs ? { warmMs: opts.warmMs } : {}),
          },
          onStage,
        ).catch(err => { log.warn('studio lease failed', { error: String(err) }); return null })
        const p = handle?.provision
        if (!p) return null
        return {
          podId: p.podId,
          ...(p.gpuType ? { gpuType: p.gpuType } : {}),
          ...(p.costPerHr !== undefined ? { costPerHr: p.costPerHr } : {}),
          provisionMs: p.provisionMs,
        }
      }
    : undefined

  // Live model-apply (Part B / B3) — Mod • Add on a warm studio installs onto the running pod.
  // Routes through the shared InstallCoordinator (built above) so it serializes per pod with the
  // gen-admission gate (B4) — no double-download of the same file.
  const installStudioModels = installCoordinator
    ? async (podId: string, intellaIds: string[]) => {
        const pods = await materiae.findActive().catch(() => [])
        const m = pods.find(p => p.externusId === podId)
        if (!m) return null
        const { installedModels } = await installCoordinator.installLive(m, intellaIds)
        return { installedModels }
      }
    : undefined

  const allocutio = new TelegramAllocutio({
    router: routerDeps,
    sender: makeTelegramSender(tgBot.telegram),
    identity: identityResolver,
    botStartupTime,
    materiae,
    hospitia,
    ...(provisionStudio ? { provisionStudio } : {}),
    ...(installStudioModels ? { installStudioModels } : {}),
    signorum: ring.signorum,
    modorum: ring.modorum,
    actorum: ring.actorum,
    intellarum: intellae,
    fundamentorum,
    actumIndex: ring.actumIndex,
    consuetudinum,
    ...(process.env.TELEGRAM_BOT_USERNAME ? { botUsername: process.env.TELEGRAM_BOT_USERNAME } : {}),
    terminatePod: RUNPOD_API_KEY ? (podId) => terminatePod(RUNPOD_API_KEY, podId) : undefined,
    acta: ring.actorum,
    cancelActum: async (actumId, reason) => {
      const a = await ring.actorum.findById(actumId)
      if (a && a.status !== 'completus' && a.status !== 'fractus') {
        await ring.completor.fail(a, reason)
        return true   // actually refunded an in-flight job
      }
      return false    // already terminal — nothing to refund
    },
  })

  tgBot.on('message', ctx => {
    const traceCtx = makeTraceContext({ platform: 'telegram' })
    withTrace(traceCtx, () => allocutio.receive(ctx.update))
  })
  tgBot.on('callback_query', ctx => {
    const traceCtx = makeTraceContext({ platform: 'telegram' })
    withTrace(traceCtx, () => allocutio.receive(ctx.update))
  })

  // 8. Express + webhook router
  const app = express()
  app.use(express.json({
    verify: (req: import('express').Request & { rawBody?: string }, _res, buf: Buffer) => {
      req.rawBody = buf.toString()
    },
  }))

  app.get('/api/health', (_req, res) => res.json({ ok: true, v: process.env.BUILD_VERSION ?? 'dev' }))
  app.use('/api/vestigia', createVestigiaRouter(ring.vestigiorum))

  // Crystal Agent API (/v1) — ApiAllocutio (docs/agent-tasks/EPIC-api-allocutio.md).
  // The agent-shaped facade over the ring + the credential→AuctorKey resolver.
  const crystalApi = new CrystalApi({
    inceptor: ring.inceptor,
    modorum: ring.modorum,
    cursorum: ring.cursorum,
    completor: ring.completor,
    actorum: ring.actorum,
    signorum: ring.signorum,
    fundamentorum: ring.fundamentorum,
    intelligendi: ring.intelligendi,
    hospitia: ring.hospitia,
    materiae: ring.materiae,
    actumIndex: ring.actumIndex,
    modos: ring.modos,
    consuetudinum,
    compositusCursor: ring.compositusCursor,
    collectiones: ring.collectiones,
    collectioCursor: ring.collectioCursor,
    sodalitatum: ring.sodalitates,
    // Publishing spine (Editio): the feed adapter + the store + prefs source.
    // No moderationGate wired → the permissive placeholder gate (real CSAM/NCMEC
    // scanner is unbuilt; the async →public gate path still always runs).
    editiones: ring.editiones,
    publicationAdapters: ring.publicationAdapters,
    animae: ring.animae,
    intellarum: intellae,
    ...(ring.conductor ? { conductor: ring.conductor } : {}),
    ...(ring.teeProvisioner ? { teeProvisioner: ring.teeProvisioner } : {}),
    // Fire-and-forget studio-ready/failed webhook (optional sugar over polling).
    notify: (url, body) => {
      void fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .catch(err => log.warn('studio webhook failed', { url, error: String(err) }))
    },
  })

  // Publication worker (publishing): drains `pending` Editiones off the store — the
  // durable queue — so settles (moderation + adapter publish + reconcile, incl. heavy
  // model uploads) run OFF the request path and survive restarts. In-process for now,
  // behind the store's atomic claim/lease so it can be split into its own container
  // later with just a thin entrypoint (see PublicationWorker). Best-effort: a crash
  // mid-settle is reclaimed once the lease lapses.
  const publicationWorker = new PublicationWorker({
    editiones: ring.editiones,
    settle: (editioId) => crystalApi.settlePublication(editioId),
  }).start(5_000)
  log.info('publication worker started')

  // Status (Progressus, spec §6a): let the in-process comfyrunner SSE parse persist its
  // typed timeline through the same sink the HTTP /runner/status uses, without an HTTP loopback.
  registerProgressusRecorder((actumId, progressus) => crystalApi.recordProgressus(actumId, progressus))
  // Identified-user acceptors → animaId via a `'web'`/`'api'` persona (create-on-sight).
  // JWT (env secret) + API-key (read-only users lookup) + anon {commitment} are live; web3
  // needs a nonce-challenge endpoint (deferred). All verification is defensive — any failure
  // degrades to auth.invalid, never a crash or a write. Real auth is validated on staging.
  const verifyApiKeyToAccountId = async (apiKey: string): Promise<string | null> => {
    try {
      if (!apiKey.startsWith('ms2_') || apiKey.length < 12) return null
      const prefix = apiKey.slice(0, 12)
      const user = await mongo.db(DB_NAME).collection('users').findOne({ 'apiKeys.keyPrefix': prefix })
      if (!user) return null
      const hash = createHash('sha256').update(apiKey).digest('hex')
      const keys = (user.apiKeys ?? []) as Array<{ keyPrefix?: string; keyHash?: string; status?: string }>
      const match = keys.find(k => k.keyPrefix === prefix && k.keyHash === hash && k.status !== 'inactive')
      return match ? String(user._id) : null
    } catch {
      return null
    }
  }
  const apiResolver = new ApiIdentityResolver(makeCredentialAcceptors({
    personae: ring.personae,
    animae: ring.animae,
    ...(process.env.JWT_SECRET ? { jwtSecret: process.env.JWT_SECRET } : {}),
    verifyApiKeyToAccountId,
  }))
  // Run-event hub — projects the bus (actum.progressus/complete/fail) into per-run SSE
  // streams + fire-and-forget completion webhooks (Phase 2). In-process (single
  // instance), per the epic's distribution note. Webhook POSTs are best-effort.
  const runHub = new RunEventHub({
    bus,
    postWebhook: async (url, body) => {
      if (!isSafeWebhookUrl(url)) return   // SSRF guard: https + public host only
      await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    },
  })
  app.use('/arcanum', createArcanumRouter(ring.arcanumIssuer, ring.arcanumTree, {
    zkeyUrl: process.env.ARCANUM_ZKEY_URL,
    serverUrl: process.env.WEBHOOK_URL,
    resolve: (req) => apiResolver.resolve(
      credentialsFromHeaders(req.headers as Record<string, string | undefined>, req.body)
    ).then((auctor) => {
      if (!('animaId' in auctor)) throw new Error('identified account required')
      return auctor as { animaId: string }
    }),
    verifier:   ring.arcanumVerifier,
    bursarium:  ring.bursarium,
    weiToCredits: process.env.ALCHEMY_API_KEY
      ? (wei) => import('./arcanum/ethPrice.js').then(m => m.weiToCredits(wei, process.env.ALCHEMY_API_KEY!))
      : undefined,
  }))
  app.use('/v1', createApiRouter({ api: crystalApi, identity: apiResolver, hub: runHub }))

  // TEE runner lifecycle callbacks — internal pod-to-platform signals, not user-facing API.
  // Mounted at /runner/* (not /v1) so PLATFORM_CALLBACK env var on the pod points here directly.
  app.post('/runner/ready',     express.json(), async (req, res) => { await crystalApi.handleRunnerReady(req.body);     res.json({ ok: true }) })
  app.post('/runner/heartbeat', express.json(), async (req, res) => { res.json(await crystalApi.handleRunnerHeartbeat(req.body)) })
  app.post('/runner/ended',     express.json(), async (req, res) => { await crystalApi.handleRunnerEnded(req.body);     res.json({ ok: true }) })
  // The universal status sink (spec §4): one channel every runner speaks — carries a
  // Progressus and returns { continue } (subsumes the heartbeat). Lenient: a legacy
  // { sessionId, step } body still works (folded into an `executing` report).
  app.post('/runner/status',    express.json(), async (req, res) => {
    res.json(await crystalApi.reportProgressus(req.body))
  })

  // TEE browser client — served at /tee so it shares the same origin as the API (no CORS needed).
  app.use('/tee', express.static(path.join(__dirname, '..', 'tee', 'browser'), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm')
    },
  }))

  // MCP adapter (/v1/mcp) — the same facade as REST, exposed as MCP tools + crystal://
  // resources for agent tool-use (Phase 3). Stateless per-request streamable-HTTP transport.
  app.use('/v1/mcp', createMcpRouter({ api: crystalApi, identity: apiResolver }))

  const INTERNAL_SECRET = process.env.INTERNAL_SECRET
  const wideStore = new WideEventStore(mongo.db(DB_NAME))
  startAnalyticsListener(wideStore)

  // Idle-pod reaper — terminate warm pods that sat idle past their warmUntil
  // deadline (default 1 min past delivery). Prevents keep-warm pods from billing
  // indefinitely when no follow-up job reuses them.
  if (RUNPOD_API_KEY) {
    startIdleReaper(materiae, (externusId) => terminatePod(RUNPOD_API_KEY, externusId), 30_000)
    log.info('idle-pod reaper started', { warmTtlMs: RUNPOD_WARM_TTL_MS })
  } else if (process.env.DEV_FAKE_POD) {
    // Fake mode has no real pods to kill; reapIdle still flips the Materia to
    // terminated and emits pod.reaped so the bulletin freezes to a receipt.
    startIdleReaper(materiae, async () => {}, 10_000)
    log.warn('idle-pod reaper started (fake mode)', { warmTtlMs: RUNPOD_WARM_TTL_MS })
  }

  // Census — the host's continuous per-time cost reckoning (studio billing tick).
  // Every 60s walks active Hospitia and debits the host secondsSinceLastTick ×
  // impetusPerSecond. Without this, hosts pay nothing for studios sitting warm — the
  // platform absorbs the underlying compute cost. See
  // docs/plans/2026-05-24-studio-billing-tick-sprint.md.
  startCensus({
    hospitia: ring.hospitia,
    materiae,
    signorum: ring.signorum,
    nexus,
    modos: ring.modos,
  }, 60_000)
  log.info('census started', { tickMs: 60_000 })

  app.use('/internal', createLiveRouter(INTERNAL_SECRET))
  app.use('/internal/analytics', createAnalyticsRouter(wideStore, INTERNAL_SECRET))

  // Alchemy address-activity webhook — processes CreditVault events.
  // Route: POST /webhooks/alchemy/:chainId  (chainId = '1' mainnet, '8453' Base)
  const ALCHEMY_SIGNING_KEYS: Record<string, string> = {}
  if (process.env.ALCHEMY_SIGNING_KEY_MAINNET) ALCHEMY_SIGNING_KEYS['1']    = process.env.ALCHEMY_SIGNING_KEY_MAINNET
  if (process.env.ALCHEMY_SIGNING_KEY_BASE)    ALCHEMY_SIGNING_KEYS['8453'] = process.env.ALCHEMY_SIGNING_KEY_BASE
  const CREDIT_VAULT = '0x00000001152d633eb2ac3cf91eac9994aeefc021'
  const alchemyDeps = {
    deposita:     ring.deposita,
    signorum:     ring.signorum,
    petitiones:   ring.petitiones,
    testimonia:   ring.testimonia,
    animae:       ring.animae,
    arcanumTree:  ring.arcanumTree,
    signingKeys:  ALCHEMY_SIGNING_KEYS,
    vaultAddresses: { '1': CREDIT_VAULT, '8453': CREDIT_VAULT },
    ethPriceUsd:  0,  // not yet used — valor stored in wei
  }
  app.post('/webhooks/alchemy/:chainId', async (req, res) => {
    const result = await handleAlchemyWebhook({
      body:      req.body,
      rawBody:   (req as { rawBody?: string }).rawBody ?? '',
      signature: req.headers['x-alchemy-signature'] as string | undefined,
      chainId:   req.params.chainId,
    }, alchemyDeps)
    log.info('alchemy webhook', { chainId: req.params.chainId, status: result.status, body: result.body })
    res.status(result.status).json(result.body)
  })

  // Training finality at the completion webhook (Slice E): a remote (pod) training run
  // completes here — host the pod-uploaded LoRA in R2 + register it as an Intella. Gated on
  // R2 (needed to host); harmless for non-training completions (resolver returns null).
  const trainingExitusResolver = RUNPOD_R2
    ? makeTrainingExitusResolver(makeTrainingFinalizer({
        reader: urlLoraReader(httpMediaFetcher),
        store: new R2Uploader(RUNPOD_R2),
        intellae,
      }))
    : undefined

  app.use('/webhooks', createWebhookRouter({
    actorum: ring.actorum,
    completor: ring.completor,
    secret: RUNPOD_WEBHOOK_SECRET,
    flowRouter: router,
    nexus,
    signorum: ring.signorum,
    modorum: ring.modorum,
    ...(trainingExitusResolver ? { resolveExitus: trainingExitusResolver } : {}),
    modos: ring.modos,
    hospitia: ring.hospitia,
    deployments: ring.deployments,
    editiones: ring.editiones,
    materiae,
    actumIndex: ring.actumIndex,
    vestigiorum: ring.vestigiorum,
    collectioRouter: ring.collectioCursor,
    compositusRouter: ring.compositusCursor,
  }))

  // --- Web app (new React frontend) — gated by STAGING_FRONTEND, registered AFTER all API routes ---
  if (process.env.STAGING_FRONTEND === '1') {
    const appDist = path.join(__dirname, '..', 'src', 'platforms', 'web', 'app', 'dist')
    const appIndex = path.join(appDist, 'index.html')
    if (existsSync(appIndex)) {
      app.use(express.static(appDist))
      // SPA fallback: serve index.html for browser navigations, but never shadow API routers.
      app.get('*', (req, res, next) => {
        if (!req.accepts('html') || /^\/(v1|api|webhooks|telegram|widget)\b/.test(req.path)) return next()
        res.sendFile(appIndex)
      })
      log.info(`[web] serving React app from ${appDist}`)
    } else {
      log.warn(`[web] STAGING_FRONTEND=1 but app build missing at ${appIndex}`)
    }
  }

  app.listen(PORT, () => log.info(`Listening on :${PORT}`))

  // 9. Register bot commands with Telegram
  const BOT_COMMANDS = [
    { command: 'make',   description: 'Generate images and art'        },
    { command: 'chat',   description: 'Chat with an AI model'          },
    { command: 'flows',  description: 'Browse all available tools'     },
    { command: 'status', description: 'View your balance and account'  },
    { command: 'wallet', description: 'Manage connected wallets'       },
    { command: 'cancel', description: 'Cancel current action'          },
    { command: 'help',   description: 'Show available commands'        },
  ]
  await tgBot.telegram.setMyCommands(BOT_COMMANDS).catch((e: unknown) =>
    log.warn('Failed to register bot commands', { error: String(e) })
  )
  log.info('Bot commands registered', { count: BOT_COMMANDS.length })

  // 10. Start Telegram
  if (TELEGRAM_WEBHOOK_URL) {
    await tgBot.telegram.setWebhook(`${TELEGRAM_WEBHOOK_URL}/telegram`)
    app.use(tgBot.webhookCallback('/telegram'))
    log.info(`Telegram webhook set to ${TELEGRAM_WEBHOOK_URL}/telegram`)
  } else {
    let pollingRestartInProgress = false
    let consecutivePollingErrors = 0

    // Launch polling
    await tgBot.launch({
      allowedUpdates: ['message', 'callback_query'],
    })
    log.info('Telegram polling started')

    tgBot.catch((err: unknown) => {
      const status = (err as { response?: { error_code?: number } })?.response?.error_code

      if (status === 409) {
        log.warn('Bot 409 conflict — concurrent instance. Backing off 50s.')
        if (!pollingRestartInProgress) {
          pollingRestartInProgress = true
          consecutivePollingErrors = 0
          setTimeout(() => {
            pollingRestartInProgress = false
            tgBot.launch({ allowedUpdates: ['message', 'callback_query'] })
              .catch((e: unknown) => log.error('Bot failed restart after 409', { error: String(e) }))
          }, 50_000)
        }
        return
      }

      consecutivePollingErrors++
      log.error(`Bot polling error (${consecutivePollingErrors})`, { error: String(err) })

      if (consecutivePollingErrors >= 5 && !pollingRestartInProgress) {
        pollingRestartInProgress = true
        consecutivePollingErrors = 0
        setTimeout(() => {
          pollingRestartInProgress = false
          tgBot.launch({ allowedUpdates: ['message', 'callback_query'] })
            .catch((e: unknown) => log.error('Bot failed restart after errors', { error: String(e) }))
        }, 5_000)
      }
    })
  }

  // 10. Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    log.info(`${signal} received — shutting down`)
    tgBot.stop(signal)

    // Tear down all active RunPod pods unless KEEP_WARM=1
    if (process.env.KEEP_WARM !== '1' && RUNPOD_API_KEY) {
      try {
        // Collect pod IDs from two sources:
        // 1. Materia records (warm pods that completed at least one job)
        // 2. In-flight actums (pods mid-bootstrap that haven't created a Materia yet)
        const activeMateriae = await materiae.findActive()
        const inFlightActa = await ring.actorum.findInFlight()

        const podIds = new Set<string>()
        for (const m of activeMateriae) podIds.add(m.externusId)
        for (const a of inFlightActa) if (a.externusJobId) podIds.add(a.externusJobId)

        if (podIds.size > 0) {
          log.info(`tearing down ${podIds.size} pod(s)`)
          await Promise.allSettled(Array.from(podIds).map(podId => terminatePod(RUNPOD_API_KEY!, podId)))
          // Mark Materia records terminated
          await Promise.allSettled(activeMateriae.map(m =>
            materiae.update(m.id, { status: 'terminated' }).catch(() => {})
          ))
        }
      } catch (err) {
        log.warn('pod teardown error', { error: (err as Error).message })
      }
    } else if (process.env.KEEP_WARM === '1') {
      log.info('KEEP_WARM=1 — leaving pods running')
    }

    await mongo.close()
    process.exit(0)
  }

  process.once('SIGINT', () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch(err => {
  const fatalLog = makeLogger('startup')
  fatalLog.error('Fatal startup error', { error: String(err) })
  process.exit(1)
})
