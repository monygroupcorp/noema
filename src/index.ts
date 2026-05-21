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
import { TelegramAllocutio } from './allocutio/TelegramAllocutio.js'
import type { RouterDeps, IdentityResolver } from './allocutio/TelegramAllocutio.js'
import { makeTelegramSender } from './allocutio/TelegramSenderAdapter.js'
import type { AuctorKey } from './flow/types.js'
import { createWebhookRouter } from './api/webhooks/webhookRouter.js'
import { createVestigiaRouter } from './api/vestigia/vestigiaRouter.js'
import { createLiveRouter } from './api/internal/liveRouter.js'
import { WideEventStore }         from './analytics/WideEventStore.js'
import { ensureWideIndexes }      from './analytics/ensureWideIndexes.js'
import { startAnalyticsListener } from './analytics/analyticsListener.js'
import { createAnalyticsRouter }  from './api/internal/analyticsRouter.js'
import { CANONICAL_MODI } from './crystal/seeds/modi.js'
import { CANONICAL_ESSENTIAE } from './crystal/seeds/essentiae.js'
import { makeLogger } from './lib/logger.js'
import { withTrace, makeTraceContext } from './lib/trace.js'

import { hostCutHook } from './ledger/hooks/hostCut.js'
import { modelRoyaltyHook } from './ledger/hooks/modelRoyalty.js'
import { platformSkimHook } from './ledger/hooks/platformSkim.js'
import { referralSplitHook } from './ledger/hooks/referralSplit.js'
import { sessionSpendHook } from './ledger/hooks/sessionSpend.js'
import { spellRoyaltyHook } from './ledger/hooks/spellRoyalty.js'
import { SecurePodClient, makeSecurePodSshFactory, type R2Config } from './crystal/SecurePodClient.js'
import { terminatePod, listRunPodPods } from './crystal/terminatePod.js'
import { MongoMateria } from './crystal/MongoMateria.js'
import { startIdleReaper } from './crystal/idleReaper.js'
import { MongoIntella } from './crystal/MongoIntella.js'
import { Compiler } from './crystal/Compiler.js'
import { WorkflowTemplateRegistry } from './crystal/WorkflowTemplateRegistry.js'
import { CANONICAL_INTELLAE } from './crystal/seeds/intellae.js'
import { ensureIndexes } from './crystal/ensureIndexes.js'
import type { Essentia } from './types/essendi.js'
import path from 'node:path'

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
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY
const R2_OUTPUTS_BUCKET = process.env.R2_OUTPUTS_BUCKET ?? process.env.R2_BUCKET_NAME
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL
const TELEGRAM_WEBHOOK_URL = process.env.TELEGRAM_WEBHOOK_URL

// ---------------------------------------------------------------------------
// Fractal Tool Compiler — compiles Essentia + aditus → RunPod job input
// ---------------------------------------------------------------------------

const templateRegistry = new WorkflowTemplateRegistry(
  path.join(__dirname, 'crystal', 'workflows')
)

// ---------------------------------------------------------------------------
// RunPod SECURE pod client — provisions a GPU machine, SSHes in, runs ComfyUI
// ---------------------------------------------------------------------------

import type { MateriaStore } from './types/materia.js'

function makeSecureRunPodClient(materiae?: MateriaStore): SecurePodClient {
  const r2: R2Config | undefined =
    R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_OUTPUTS_BUCKET
      ? { endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, accessKeyId: R2_ACCESS_KEY_ID!, secretAccessKey: R2_SECRET_ACCESS_KEY!, bucket: R2_OUTPUTS_BUCKET!, publicUrl: R2_PUBLIC_URL }
      : undefined

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
      affines: {},
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

  const intellaeCol = mongo.db(DB_NAME).collection('intellae')
  const intellae = new MongoIntella(intellaeCol)
  const compiler = new Compiler(templateRegistry, undefined, intellae)
  const compile = async (modus: unknown, aditus: Record<string, unknown>): Promise<{ hash: string; input: unknown }> => {
    const essentia = modus as Essentia
    if (!essentia.runpodSpec) {
      throw new Error(`Modus '${essentia.id}' has no runpodSpec — cannot compile for RunPod`)
    }
    const { hash, spec } = await compiler.compile(essentia, aditus)
    return { hash, input: spec }
  }

  const runpodClient = RUNPOD_API_KEY ? makeSecureRunPodClient(materiae) : undefined

  const podTerminator = RUNPOD_API_KEY
    ? (podId: string) => terminatePod(RUNPOD_API_KEY!, podId)
    : undefined

  const ring = createContainer(mongo, {
    mongoUri: MONGODB_URI as string,
    dbName: DB_NAME,
    compile: compile as ContainerConfig['compile'],
    materiae,   // pre-created, shared with SecurePodClient
    terminatePod: podTerminator,
    ...(runpodClient && RUNPOD_WEBHOOK_URL ? {
      runpodClient,
      runpodWebhookUrl: RUNPOD_WEBHOOK_URL,
    } : {}),
    ...(openaiClient ? { openaiClient } : {}),
    ...(embed ? { embed } : {}),
    ...(embedImage ? { embedImage } : {}),
  })

  // 3b. Rehydrate in-flight collections from DB (recovery after restart)
  await ring.collectioCursor.rehydrate()
  log.info('CollectioCursor rehydrated')

  // 3c. Recover expired acta — release locked signa; fail() now also kills any live pod
  const expired = await ring.actorum.findExpired()
  if (expired.length) {
    log.info(`Recovering ${expired.length} expired acta`)
    await Promise.all(expired.map(a => ring.completor.fail(a, 'Actum expired — pod never reported back')))
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
  nexus.on('execution_spend', spellRoyaltyHook)
  nexus.on('execution_spend', modelRoyaltyHook)
  nexus.on('royalty_fired', platformSkimHook)
  nexus.on('session_spend', sessionSpendHook)
  nexus.on('deposit_confirmed', referralSplitHook)

  // 4. Seed canonical modi + essentiae + intellae
  for (const modus of CANONICAL_MODI) {
    await ring.modorum.register(modus)
  }
  log.info(`Seeded ${CANONICAL_MODI.length} canonical modi`)

  for (const essentia of CANONICAL_ESSENTIAE) {
    await ring.modorum.register(essentia)
  }
  log.info(`Seeded ${CANONICAL_ESSENTIAE.length} canonical essentiae`)

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
  })
  router.register(executeFlow)

  // 7. Create TelegramAllocutio
  const tgBot = new Telegraf(BOT_TOKEN as string)
  const identityResolver = new TelegramIdentityResolver(ring)

  const allocutio = new TelegramAllocutio({
    router: routerDeps,
    sender: makeTelegramSender(tgBot.telegram),
    identity: identityResolver,
    botStartupTime,
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

  const INTERNAL_SECRET = process.env.INTERNAL_SECRET
  const wideStore = new WideEventStore(mongo.db(DB_NAME))
  startAnalyticsListener(wideStore)

  // Idle-pod reaper — terminate warm pods that sat idle past their warmUntil
  // deadline (default 1 min past delivery). Prevents keep-warm pods from billing
  // indefinitely when no follow-up job reuses them.
  if (RUNPOD_API_KEY) {
    startIdleReaper(materiae, (externusId) => terminatePod(RUNPOD_API_KEY, externusId), 30_000)
    log.info('idle-pod reaper started', { warmTtlMs: RUNPOD_WARM_TTL_MS })
  }
  app.use('/internal', createLiveRouter(INTERNAL_SECRET))
  app.use('/internal/analytics', createAnalyticsRouter(wideStore, INTERNAL_SECRET))

  app.use('/webhooks', createWebhookRouter({
    actorum: ring.actorum,
    completor: ring.completor,
    secret: RUNPOD_WEBHOOK_SECRET,
    flowRouter: router,
    nexus,
    signorum: ring.signorum,
    modorum: ring.modorum,
    modos: ring.modos,
    vestigiorum: ring.vestigiorum,
    collectioRouter: ring.collectioCursor,
  }))

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
