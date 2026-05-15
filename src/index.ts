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
import type { AuctorKey } from './flow/types.js'
import { createWebhookRouter } from './api/webhooks/webhookRouter.js'
import { createVestigiaRouter } from './api/vestigia/vestigiaRouter.js'
import { CANONICAL_MODI } from './crystal/seeds/modi.js'

import { hostCutHook } from './ledger/hooks/hostCut.js'
import { modelRoyaltyHook } from './ledger/hooks/modelRoyalty.js'
import { platformSkimHook } from './ledger/hooks/platformSkim.js'
import { referralSplitHook } from './ledger/hooks/referralSplit.js'
import { sessionSpendHook } from './ledger/hooks/sessionSpend.js'
import { spellRoyaltyHook } from './ledger/hooks/spellRoyalty.js'
import { SecurePodClient, makeSecurePodSshFactory } from './crystal/SecurePodClient.js'
import { MongoMateria } from './crystal/MongoMateria.js'
import { MongoIntella } from './crystal/MongoIntella.js'
import { Compiler } from './crystal/Compiler.js'
import { WorkflowTemplateRegistry } from './crystal/WorkflowTemplateRegistry.js'
import { CANONICAL_INTELLAE } from './crystal/seeds/intellae.js'
import { ensureIndexes } from './crystal/ensureIndexes.js'
import type { Essentia } from './types/essendi.js'
import { fileURLToPath } from 'node:url'
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
const RUNPOD_GPU_TYPE_IDS = process.env.RUNPOD_GPU_TYPE_IDS   // comma-separated, e.g. "NVIDIA GeForce RTX 4090,NVIDIA RTX A5000"
const RUNPOD_IMAGE_NAME = process.env.RUNPOD_IMAGE_NAME        // Docker image, e.g. "stationthis/flux-comfyui-runtime:v1"
const RUNPOD_SSH_KEY_PATH = process.env.RUNPOD_SSH_KEY_PATH ?? `${process.env.HOME}/.ssh/runpod`
const RUNPOD_CLOUD_TYPE = (process.env.RUNPOD_CLOUD_TYPE ?? 'SECURE') as 'SECURE' | 'COMMUNITY'
const RUNPOD_WEBHOOK_URL = process.env.RUNPOD_WEBHOOK_URL
const RUNPOD_KEEP_WARM = process.env.RUNPOD_KEEP_WARM !== 'false'  // default true
const TELEGRAM_WEBHOOK_URL = process.env.TELEGRAM_WEBHOOK_URL

// ---------------------------------------------------------------------------
// Fractal Tool Compiler — compiles Essentia + aditus → RunPod job input
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const templateRegistry = new WorkflowTemplateRegistry(
  path.join(__dirname, 'crystal', 'workflows')
)

// ---------------------------------------------------------------------------
// RunPod SECURE pod client — provisions a GPU machine, SSHes in, runs ComfyUI
// ---------------------------------------------------------------------------

import type { MateriaStore } from './types/materia.js'

function makeSecureRunPodClient(
  apiKey: string,
  gpuTypeIds: string[],
  imageName: string,
  materiae?: MateriaStore,
): SecurePodClient {
  return new SecurePodClient(
    {
      apiKey,
      gpuTypeIds,
      imageName,
      cloudType: RUNPOD_CLOUD_TYPE,
      sshKeyPath: RUNPOD_SSH_KEY_PATH,
      keepWarm: RUNPOD_KEEP_WARM,
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
  // 0. Record startup time (used to filter stale Telegram updates)
  const botStartupTime = Date.now()

  // 1. Connect MongoDB
  const mongo = new MongoClient(MONGODB_URI as string)
  await mongo.connect()
  console.log('MongoDB connected')
  await ensureIndexes(mongo.db(DB_NAME))
  console.log('Indexes ensured')

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
    console.log(`CLIP service: ${CLIP_SERVICE_URL}`)
  } else {
    console.warn('CLIP_SERVICE_URL not set — vestigium embeddings disabled')
  }

  let openaiClient: ContainerConfig['openaiClient'] | undefined
  if (process.env.OPENAI_API_KEY) {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    openaiClient = {
      chat: async (params) => {
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
      image: async (params) => {
        const res = await openai.images.generate({
          model: params.model,
          prompt: params.prompt,
          size: params.size as OpenAI.ImageGenerateParams['size'],
          quality: params.quality as OpenAI.ImageGenerateParams['quality'],
          n: params.n,
        })
        return { url: res.data[0]?.url ?? '' }
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
    return { hash, input: spec.workflow.inputTemplate }
  }

  const gpuTypeIds = RUNPOD_GPU_TYPE_IDS?.split(',').map(s => s.trim()).filter(Boolean) ?? []
  const runpodClient =
    RUNPOD_API_KEY && gpuTypeIds.length && RUNPOD_IMAGE_NAME
      ? makeSecureRunPodClient(RUNPOD_API_KEY, gpuTypeIds, RUNPOD_IMAGE_NAME, materiae)
      : undefined

  const ring = createContainer(mongo, {
    mongoUri: MONGODB_URI as string,
    dbName: DB_NAME,
    compile: compile as ContainerConfig['compile'],
    materiae,   // pre-created, shared with SecurePodClient
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
  console.log('CollectioCursor rehydrated')

  // 3c. Recover expired acta — release locked signa from jobs that never completed
  const expired = await ring.actorum.findExpired()
  if (expired.length) {
    console.log(`Recovering ${expired.length} expired acta`)
    await Promise.all(expired.map(a => ring.completor.fail(a, 'Actum expired — pod never reported back')))
  }

  // 4. Create Nexus, register hooks
  const nexus = new Nexus()
  nexus.on('execution_spend', hostCutHook)
  nexus.on('execution_spend', spellRoyaltyHook)
  nexus.on('execution_spend', modelRoyaltyHook)
  nexus.on('royalty_fired', platformSkimHook)
  nexus.on('session_spend', sessionSpendHook)
  nexus.on('deposit_confirmed', referralSplitHook)

  // 4. Seed canonical modi + intellae
  for (const modus of CANONICAL_MODI) {
    await ring.modorum.register(modus)
  }
  console.log(`Seeded ${CANONICAL_MODI.length} canonical modi`)

  for (const intella of CANONICAL_INTELLAE) {
    await intellae.upsert(intella)
  }
  console.log(`Seeded ${CANONICAL_INTELLAE.length} canonical intellae`)

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
    sender: tgBot.telegram,
    identity: identityResolver,
    botStartupTime,
  })

  tgBot.on('message', ctx => allocutio.receive(ctx.update))
  tgBot.on('callback_query', ctx => allocutio.receive(ctx.update))

  // 8. Express + webhook router
  const app = express()
  app.use(express.json({
    verify: (req, _res, buf) => {
      (req as { rawBody?: string }).rawBody = buf.toString()
    },
  }))

  app.use('/api/vestigia', createVestigiaRouter(ring.vestigiorum))

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

  app.listen(PORT, () => console.log(`Listening on :${PORT}`))

  // 9. Start Telegram
  if (TELEGRAM_WEBHOOK_URL) {
    await tgBot.telegram.setWebhook(`${TELEGRAM_WEBHOOK_URL}/telegram`)
    app.use(tgBot.webhookCallback('/telegram'))
    console.log(`Telegram webhook set to ${TELEGRAM_WEBHOOK_URL}/telegram`)
  } else {
    let pollingRestartInProgress = false
    let consecutivePollingErrors = 0

    // Launch polling
    await tgBot.launch({
      allowedUpdates: ['message', 'callback_query'],
    })
    console.log('Telegram polling started')

    tgBot.catch((err: unknown) => {
      const status = (err as { response?: { error_code?: number } })?.response?.error_code

      if (status === 409) {
        console.warn('[Bot] 409 conflict — concurrent instance. Backing off 50s.')
        if (!pollingRestartInProgress) {
          pollingRestartInProgress = true
          consecutivePollingErrors = 0
          setTimeout(() => {
            pollingRestartInProgress = false
            tgBot.launch({ allowedUpdates: ['message', 'callback_query'] })
              .catch(e => console.error('[Bot] Failed restart after 409:', e))
          }, 50_000)
        }
        return
      }

      consecutivePollingErrors++
      console.error(`[Bot] Polling error (${consecutivePollingErrors}):`, err)

      if (consecutivePollingErrors >= 5 && !pollingRestartInProgress) {
        pollingRestartInProgress = true
        consecutivePollingErrors = 0
        setTimeout(() => {
          pollingRestartInProgress = false
          tgBot.launch({ allowedUpdates: ['message', 'callback_query'] })
            .catch(e => console.error('[Bot] Failed restart after errors:', e))
        }, 5_000)
      }
    })
  }

  // 10. Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`${signal} received — shutting down`)
    tgBot.stop(signal)
    await mongo.close()
    process.exit(0)
  }

  process.once('SIGINT', () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch(err => {
  console.error('Fatal startup error:', err)
  process.exit(1)
})
