import { MongoClient } from 'mongodb'
import { Telegraf } from 'telegraf'
import express from 'express'

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
import { AlchemyPricer, nullPricer } from './crystal/AssetPricer.js'
import { permissiveSanctionsScreen, type SanctionsScreen } from './compliance/SanctionsScreen.js'
import { createVestigiaRouter } from './api/vestigia/vestigiaRouter.js'
import { createArcanumRouter } from './api/arcanum/arcanumRouter.js'
import { mountCeremony } from './api/arcanum/mountCeremony.js'
import { CrystalApi } from './allocutio/api/CrystalApi.js'
import { IdentityResolver as ApiIdentityResolver, credentialsFromHeaders } from './allocutio/api/IdentityResolver.js'
import { createApiRouter } from './allocutio/api/apiRouter.js'
import { makeCredentialAcceptors, resolveOrCreateAnima, federatedExternusId } from './allocutio/api/apiAcceptors.js'
import { AgentJwtVerifier, parseJwksOverride } from './allocutio/api/AgentJwtVerifier.js'
import { AgentProvisioner } from './crystal/AgentProvisioner.js'
import { createAgentCompatRouter } from './allocutio/api/agentCompatRouter.js'
import { createStorageRouter } from './allocutio/api/storageRouter.js'
import { createTreasuryAdminRouter } from './api/internal/treasuryAdminRouter.js'
import { seedCamel, CAMEL_TREASURY } from './crystal/seeds/camel.js'
import { createX402AgentRouter } from './allocutio/api/x402AgentRouter.js'
import { DEFAULT_X402_CONFIG } from './crystal/x402Pricing.js'
import { accruePayeePayout, agentCutMicro } from './crystal/accruePayeePayout.js'
import { createCdpX402Facilitator } from './crystal/CdpX402Facilitator.js'
import type { X402Facilitator } from './types/x402.js'
import { createSponsioRouter } from './allocutio/api/sponsioRouter.js'
import { createAuthRouter } from './allocutio/api/authRouter.js'
import { MongoCredentum } from './crystal/MongoCredentum.js'
import { MongoLinkToken } from './crystal/MongoLinkToken.js'
import { linkTelegramToAccount, issueTelegramRecoveryCode } from './allocutio/telegram/telegramRecovery.js'
import { createWidgetRouter } from './allocutio/api/widgetRouter.js'
import { createPurseRouter } from './allocutio/api/purseRouter.js'
import { createAgentCardRouter } from './allocutio/api/agentCardRouter.js'
import { startSubsidySweeper } from './crystal/SubsidySweeper.js'
import { startLicenseTripwire } from './crystal/licenseTripwire.js'
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
import { permissiveModerationGate, denyModerationGate, type ModerationGate } from './crystal/ModerationGate.js'
import { permissivePromptGuard, type PromptGuard } from './crystal/PromptGuard.js'
import { ModelImporter } from './crystal/ModelImporter.js'
import { MongoVerdictCache } from './crystal/MongoVerdictCache.js'
import { ledgerScanFeeCharger } from './crystal/ScanFeeCharger.js'
import { httpJsonFetcher, secretJsonFetcher } from './crystal/modelImportResolver.js'
import { secretBoxFromEnv } from './crystal/secretBox.js'
import { MongoSecretarium } from './crystal/MongoSecretarium.js'
import { mintJobToken, verifyJobToken } from './crystal/jobToken.js'
import { createWeightProxyRouter } from './api/internal/weightProxyRouter.js'
import { registerProgressusRecorder } from './execution/progressusSink.js'
import { CANONICAL_MODI } from './crystal/seeds/modi.js'
import { API_PROVIDERS } from './crystal/apiProviders.js'
import { CANONICAL_ESSENTIAE } from './crystal/seeds/essentiae.js'
import { CANONICAL_COMPOSITI } from './crystal/seeds/compositi.js'
import { CANONICAL_CUSTOM_MODI } from './crystal/seeds/modiCustom.js'
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

// A deny-all x402 facilitator — the safe default until the real @coinbase/x402 CDP
// facilitator is wired. With x402 feature-flagged off, the endpoints 404 before this
// is ever consulted; if flagged on without a real facilitator, payments fail closed.
const disabledX402Facilitator: X402Facilitator = {
  async verify() { return { valid: false, error: 'x402 facilitator not configured' } },
  async settle() { return { success: false, error: 'x402 facilitator not configured' } },
}

// The real CDP facilitator, built only when `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` are set.
// `node10` moduleResolution can't see @x402/core's `exports` map, so the client trio is
// loaded via runtime `require` (Node honours exports maps) — the same combo the platform
// x402 middleware uses. Our adapter maps the shapes; NETWORK is decided by x402Config
// (DEFAULT_X402_CONFIG = Base mainnet, eip155:8453 — real USDC).
function buildCdpX402Facilitator(): X402Facilitator | null {
  const apiKeyId = process.env.CDP_API_KEY_ID
  const apiKeySecret = process.env.CDP_API_KEY_SECRET
  if (!apiKeyId || !apiKeySecret) return null
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { createFacilitatorConfig } = require('@coinbase/x402')
  const { HTTPFacilitatorClient } = require('@x402/core/server')
  const { decodePaymentSignatureHeader } = require('@x402/core/http')
  /* eslint-enable @typescript-eslint/no-var-requires */
  const client = new HTTPFacilitatorClient(createFacilitatorConfig(apiKeyId, apiKeySecret))
  return createCdpX402Facilitator({ client, decodePayment: decodePaymentSignatureHeader })
}

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
// Confidential-CVM tier (Azure NCCads_H100_v5, SEV-SNP + H100 CC-On) — the hardware-sealed
// backend behind /v1/sessions/tee. ALL TEE_AZURE_* vars (incl. the ingress template) must be
// set to enable it; it then takes precedence over the RunPod TeeProvisioner.
// Pool = pre-created, deallocated CVMs.
const TEE_AZURE_TENANT_ID       = process.env.TEE_AZURE_TENANT_ID
const TEE_AZURE_CLIENT_ID       = process.env.TEE_AZURE_CLIENT_ID
const TEE_AZURE_CLIENT_SECRET   = process.env.TEE_AZURE_CLIENT_SECRET
const TEE_AZURE_SUBSCRIPTION_ID = process.env.TEE_AZURE_SUBSCRIPTION_ID
const TEE_AZURE_RESOURCE_GROUP  = process.env.TEE_AZURE_RESOURCE_GROUP
const TEE_AZURE_VM_NAMES        = process.env.TEE_AZURE_VM_NAMES?.split(',').map(s => s.trim()).filter(Boolean)
// Billing rate — fail fast on a malformed value: NaN here would flow into every session's
// costPerHrUsd and either 500 the heartbeat billing or silently bill 0.
const TEE_AZURE_COST_PER_HR = (() => {
  const raw = process.env.TEE_AZURE_COST_PER_HR
  if (raw === undefined) return 6.98   // NCC40ads_H100_v5 East US 2 list (2026-07)
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) throw new Error(`TEE_AZURE_COST_PER_HR must be a positive number, got "${raw}"`)
  return n
})()
// REQUIRED for the Azure backend: without it, sessions would go 'ready' with the runner's
// self-reported localhost endpoint — billed but unreachable.
const TEE_AZURE_INGRESS_TEMPLATE = process.env.TEE_AZURE_INGRESS_TEMPLATE  // e.g. "socks5+wss://{vm}.tee.noema.art/?gost&insecureudp"

// A privacy-tier downgrade must never be silent: if the Azure backend is partially
// configured, say exactly what's missing instead of quietly serving the RunPod tier.
{
  const req: Record<string, unknown> = {
    TEE_AZURE_TENANT_ID, TEE_AZURE_CLIENT_ID, TEE_AZURE_CLIENT_SECRET,
    TEE_AZURE_SUBSCRIPTION_ID, TEE_AZURE_RESOURCE_GROUP,
    TEE_AZURE_VM_NAMES: TEE_AZURE_VM_NAMES?.length, TEE_AZURE_INGRESS_TEMPLATE,
    TEE_PLATFORM_CALLBACK,
  }
  const missing = Object.entries(req).filter(([, v]) => !v).map(([k]) => k)
  if (missing.length > 0 && missing.length < Object.keys(req).length) {
    console.warn(`[tee] confidential-CVM backend DISABLED — partial config, missing: ${missing.join(', ')}. /v1/sessions/tee will serve the RunPod (non-confidential) tier if configured.`)
  }
}

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

  // 2. Build embedding functions (CLIP service) and hosted-API providers
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

  // Hosted-API inference providers: register each descriptor whose key is set.
  // Adding a provider is a descriptor in apiProviders.ts + its env key — no SDK,
  // no cursor. The generic OpenAI-compatible wire is handled inside ApiCursor.
  const apiProviders = API_PROVIDERS.flatMap((provider) => {
    const apiKey = process.env[provider.authEnv]
    return apiKey ? [{ provider, apiKey }] : []
  })

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

  // BYO-secrets Phase C: the per-job pod credential + weight-download proxy. Three envs gate it,
  // and ALL must be set together (plus a runner that attaches its token — see docs):
  //   JOB_TOKEN_SECRET   — HMAC secret for minting/verifying job tokens.
  //   SECRETA_MASTER_KEY — the secret store (secretBox below); resolve() serves the BYO origin token.
  //   WEIGHT_PROXY_BASE  — our public API base; when set, the Compiler rewrites gated private
  //                        weight urls to `${base}/internal/weights/:id` (opt-in once the runner
  //                        forwards its token). Unset → no rewrite (pre-Phase-C behavior).
  // The rewrite is enabled only when the token secret is ALSO present, so we never point a pod at a
  // proxy that can't authenticate it.
  const JOB_TOKEN_SECRET = process.env.JOB_TOKEN_SECRET
  const WEIGHT_PROXY_BASE = (process.env.WEIGHT_PROXY_BASE && JOB_TOKEN_SECRET)
    ? process.env.WEIGHT_PROXY_BASE : undefined
  const mintJobTokenFn = JOB_TOKEN_SECRET
    ? (claims: { actumId: string; ownerKey: string; exp: number }) => mintJobToken(JOB_TOKEN_SECRET, claims)
    : undefined

  const compiler = new Compiler(templateRegistry, undefined, intellae, fundamentorum, WEIGHT_PROXY_BASE)
  const compile = async (modus: unknown, aditus: Record<string, unknown>, pinnedModels?: import('./types/actum.js').ModelRef[], ownerKey?: string): Promise<{ hash: string; input: unknown }> => {
    const essentia = modus as Essentia
    if (!essentia.fundamentumId) {
      throw new Error(`Modus '${essentia.id}' has no fundamentumId — cannot compile for a pod`)
    }
    // ownerKey scopes private-model resolution: the runner's own private imports resolve by
    // trigger, and a private id the runner does NOT own is refused (Compiler enforcement).
    const { hash, spec } = await compiler.compile(essentia, aditus, {
      ...(pinnedModels ? { pinnedModels } : {}),
      ...(ownerKey ? { ownerKey } : {}),
    })
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
      ...(mintJobTokenFn ? { mintJobToken: mintJobTokenFn } : {}),
    } : {}),
    aitoolkitRemote: {
      statusUrl: RUNNER_STATUS_URL,
      ...(AITK_REMOTE_IMAGE ? { image: AITK_REMOTE_IMAGE } : {}),
      ...(AITK_REF ? { aitkRef: AITK_REF } : {}),
      ...(AITK_REMOTE_MAX_SECONDS !== undefined ? { maxTrainingSeconds: AITK_REMOTE_MAX_SECONDS } : {}),
    },
    ...(process.env.HF_TOKEN ? { huggingFaceToken: process.env.HF_TOKEN } : {}),
    ...(process.env.ARWEAVE_PRIVATE_KEY ? { arweavePrivateKey: process.env.ARWEAVE_PRIVATE_KEY } : {}),
    ...(apiProviders.length ? { apiProviders } : {}),
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
    ...(TEE_AZURE_TENANT_ID && TEE_AZURE_CLIENT_ID && TEE_AZURE_CLIENT_SECRET
        && TEE_AZURE_SUBSCRIPTION_ID && TEE_AZURE_RESOURCE_GROUP && TEE_AZURE_VM_NAMES?.length
        && TEE_AZURE_INGRESS_TEMPLATE && TEE_PLATFORM_CALLBACK ? {
      confidentialPod: {
        tenantId:         TEE_AZURE_TENANT_ID,
        clientId:         TEE_AZURE_CLIENT_ID,
        clientSecret:     TEE_AZURE_CLIENT_SECRET,
        subscriptionId:   TEE_AZURE_SUBSCRIPTION_ID,
        resourceGroup:    TEE_AZURE_RESOURCE_GROUP,
        vmNames:          TEE_AZURE_VM_NAMES,
        platformCallback: TEE_PLATFORM_CALLBACK,
        costPerHrUsd:     TEE_AZURE_COST_PER_HR,
        ingressProxyUrlTemplate: TEE_AZURE_INGRESS_TEMPLATE,
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

  // Authored flagship custom modi (canonica:false) — registered after the essentiae they fork from.
  for (const customModus of CANONICAL_CUSTOM_MODI) {
    await ring.modorum.register(customModus)
  }
  log.info(`Seeded ${CANONICAL_CUSTOM_MODI.length} custom modi`)

  // CAMEL onboarding seed (ADR-0011 §8): the trusted issuer, the treasury Anima,
  // and the CamelMemify starter template. Idempotent.
  await seedCamel({ issuers: ring.issuers, modorum: ring.modorum, db: mongo.db(DB_NAME) })
  log.info('Seeded CAMEL issuer + treasury + starter template')

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

  // One-time link/recovery codes bridging web ⇆ this bot — the Telegram account-backup
  // channel (docs/spec/fiat-auth.md §recovery). Shared with the auth router below.
  const linkTokens = new MongoLinkToken(mongo.db(DB_NAME).collection('link_tokens'))
  void linkTokens.ensureIndexes().catch(err => log.warn('linkTokens: ensureIndexes failed', { error: String(err) }))

  const allocutio = new TelegramAllocutio({
    router: routerDeps,
    sender: makeTelegramSender(tgBot.telegram),
    identity: identityResolver,
    botStartupTime,
    materiae,
    hospitia,
    // Account backup/recovery: bind this Telegram at a web soul, and mint recovery codes.
    linkTelegramAccount: (tgUserId, code) => linkTelegramToAccount({ personae: ring.personae, linkTokens }, tgUserId, code),
    issueTelegramRecovery: (tgUserId) => issueTelegramRecoveryCode({ personae: ring.personae, animae: ring.animae, linkTokens }, tgUserId),
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

  // PRIVATE compliance module (ADR-0012 §49 — abuse surface, not published): the real
  // CSAM/NCMEC gate AND the OFAC sanctions screen live in the gitignored
  // `src/private/compliance` module, injected at deploy. This public repo ships only
  // the PORTS + fail-closed/permissive stubs. Loaded ONCE here via a guarded dynamic
  // import (path in a variable so a public build doesn't statically resolve it); absent
  // (public build) → both fall back to their stubs. The OFAC block below reuses it.
  interface PrivateCompliance {
    configureModerationGate(deps: { fetcher: typeof httpMediaFetcher; log: typeof log }): Promise<ModerationGate | null>
    configureSanctionsScreen(deps: { log: typeof log }): SanctionsScreen | null
    configurePromptGuard(deps: { log: typeof log }): PromptGuard | null
    configureCsamReviewReporter(deps: { fetcher: typeof httpMediaFetcher }): import('./crystal/CsamReviewReporter.js').CsamReviewReporter
  }
  let compliance: PrivateCompliance | null = null
  const compliancePath = './private/compliance/index.js'
  try {
    compliance = (await import(compliancePath)) as PrivateCompliance
  } catch {
    log.warn('Private compliance module (src/private/compliance) not present — CSAM/NCMEC + OFAC screening unavailable in this build.')
  }

  // →public moderation gate (CSAM/NCMEC). Preference order, all fail-closed:
  //   1. the real PRIVATE gate when present AND detection is configured (CSAM_HASHSET_PATH / classifier);
  //   2. else the permissive no-op ONLY under an explicit MODERATION_ALLOW_UNSCANNED opt-in;
  //   3. else DENY (the safe default — public publishing off until the scanner is wired).
  const privateGate = compliance ? await compliance.configureModerationGate({ fetcher: httpMediaFetcher, log }) : null
  const moderationGate: ModerationGate = privateGate
    ? privateGate
    : process.env.MODERATION_ALLOW_UNSCANNED === '1'
      ? (log.warn('MODERATION_ALLOW_UNSCANNED=1 — public publishing approves content WITHOUT CSAM/NCMEC scanning. Dev/staging only; NEVER in production.'), permissiveModerationGate)
      : (log.warn('No CSAM/NCMEC scanner active (private compliance module absent or unconfigured) — public publishing (feed/marketplace) is DENIED (fail-closed). Private/unlisted still work.'), denyModerationGate)

  // Input-side CSAM prompt guard (generation boundary, FAIL-OPEN). From the private
  // module; absent (public build) → permissive stub. Refuses only minor∧sexual prompts
  // (+ an out-of-band code-word lexicon) — adult content passes. The publish-time gate
  // above is the fail-closed backstop.
  const promptGuard: PromptGuard = compliance?.configurePromptGuard({ log })
    ?? (log.warn('Input CSAM prompt guard inactive (private compliance module absent) — generation prompts are NOT screened. The publish-time gate still applies.'), permissivePromptGuard)

  // Import-by-URL (spec/model-import.md Tier 1): register a Civitai/HF/direct model as a
  // private, owner-scoped Intella — WEIGHTS origin-only (no R2 copy; we don't custody third-party
  // BYO weights for personal use — the R2 weight mirror happens only on a public promotion,
  // BucketAdapter). The store/fetcher here re-host only the small PREVIEW image(s), so the CSAM
  // scan covers the exact bytes we display (no TOCTOU) and our UI doesn't hot-link the origin.
  // Reuses the same moderation gate for the mandatory preview-media safety scan (fail-closed).
  // BYO secrets (Secretarium) — sealed gated-origin credentials, keyed by ownerKey. Gated on
  // SECRETA_MASTER_KEY: no key → store absent → /v1/me/secrets 501 + getMe.secrets all 'absent'.
  // The full resolve-capable store stays local (its ASYMMETRY: only the two server-side consumers
  // get resolve — the import gated-fetcher here + the future weight-proxy). CrystalApi is handed
  // only the write + presence slices.
  const secretBox = secretBoxFromEnv()
  const secretarium = secretBox ? new MongoSecretarium(mongo.db(DB_NAME).collection('secreta'), secretBox) : undefined
  if (secretarium) void secretarium.ensureIndexes().catch(err => log.warn('secretarium: ensureIndexes failed', { error: String(err) }))

  // Fiat username/password auth (docs/spec/fiat-auth.md): the credential store (username +
  // password hash). NO EMAIL — accounts are anonymous username/password and recover via
  // backup channels (Telegram/wallet), not email links. The auth router is mounted below.
  const credenta = new MongoCredentum(mongo.db(DB_NAME).collection('credenta'))
  void credenta.ensureIndexes().catch(err => log.warn('credenta: ensureIndexes failed', { error: String(err) }))

  const modelImporter = new ModelImporter({
    json: httpJsonFetcher,
    // Gated Civitai/HF metadata scrape: wrap the fetcher with the owner's BYO token (server-side,
    // via Secretarium.resolve in the closure — a legitimate resolve consumer, never CrystalApi).
    ...(secretarium ? {
      gatedFetcherFor: (ownerKey: string) =>
        secretJsonFetcher(httpJsonFetcher, (provider) => secretarium.resolve(ownerKey, provider)),
    } : {}),
    intellae,
    moderationGate,
    fetcher: httpMediaFetcher,
    ...(RUNPOD_R2 ? { store: new R2Uploader(RUNPOD_R2) } : {}),
  })

  // Deposit boundary shared by the /v1 quote endpoint AND the Alchemy webhook: the CreditVault
  // address + the per-asset USD FMV oracle. Constructed once here so the quote and the webhook
  // credit use the SAME pricer (they must agree — one source of truth).
  const CREDIT_VAULT = '0x00000001152d633eb2ac3cf91eac9994aeefc021'
  // The Alchemy Prices API key (chain-agnostic; used in the request path). Prefer the crystal name,
  // but fall back to the legacy bot's env names (`ALCHEMY_KEY` / per-chain `ALCHEMY_KEY_1`) so a
  // deployment that already carries them lights up the pipeline without a rename.
  const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY ?? process.env.ALCHEMY_KEY ?? process.env.ALCHEMY_KEY_1
  const pricer = ALCHEMY_API_KEY
    ? new AlchemyPricer(ALCHEMY_API_KEY)
    : (log.warn('Alchemy price key unset (ALCHEMY_API_KEY / ALCHEMY_KEY) — deposits will NOT be priced (no revenue booked, no credits issued, quote unavailable). Configure before real deposits.'), nullPricer)

  // Publish-safety cost forwarding (spec/moderation-classifier.md §7): a content-addressed
  // verdict cache so an identical re-publish reuses the gate verdict (no re-scan, no re-fee),
  // and a per-scan fee charger that forwards the paid-classifier cost to the publisher — only
  // on a BILLABLE scan (a real Thorn call). PUBLISH_SCAN_FEE (impetus points) is the config
  // knob until Thorn quotes; unset/0 ⇒ no fee.
  const verdictCache = new MongoVerdictCache(mongo.db(DB_NAME).collection('verdict_cache'))
  void verdictCache.ensureIndexes().catch(err => log.warn('verdictCache: ensureIndexes failed', { error: String(err) }))
  const PUBLISH_SCAN_FEE = BigInt(process.env.PUBLISH_SCAN_FEE ?? '0')
  const scanFeeCharger = ledgerScanFeeCharger({ signorum: ring.signorum, amount: PUBLISH_SCAN_FEE })

  // Crystal Agent API (/v1) — ApiAllocutio (docs/agent-tasks/EPIC-api-allocutio.md).
  // The agent-shaped facade over the ring + the credential→AuctorKey resolver.
  // Reviewer-confirmed-CSAM NCMEC report seam (human-review path, spec §4). From the
  // private module; absent (public build) → the confirm action rejects but logs that no
  // report was filed. Assembles + preserves; live NCMEC submission needs the ESP account.
  const csamReviewReporter = compliance?.configureCsamReviewReporter({ fetcher: httpMediaFetcher })

  const crystalApi = new CrystalApi({
    pricer,
    depositAddress: CREDIT_VAULT,
    verdictCache,
    scanFeeCharger,
    ...(csamReviewReporter ? { csamReviewReporter } : {}),
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
    provinciarum: ring.provinciae,
    // Publishing spine (Editio): the feed adapter + the store + prefs source.
    // moderationGate fails closed (deny) unless MODERATION_ALLOW_UNSCANNED=1 — the
    // async →public gate path always runs; only its verdict changes.
    moderationGate,
    // Input CSAM prompt guard (generation boundary, fail-open) — refuses minor∧sexual prompts.
    promptGuard,
    editiones: ring.editiones,
    publicationAdapters: ring.publicationAdapters,
    animae: ring.animae,
    intellarum: intellae,
    // Admin revenue report (conditional-license tripwire, ADR-0013 §5): the trailing-12mo rollup
    // + the last persisted band. Read-only; the scheduled evaluator (below) owns alerts/persistence.
    redituum: ring.redituum,
    tripwireBand: ring.tripwireBand,
    modelImporter,
    // Only the write + presence slices — never the resolve-capable store (ASYMMETRY).
    ...(secretarium ? { secretWriter: secretarium, secretPresence: secretarium } : {}),
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
    // Federated (JWKS) SSO — trusted-issuer registry + the live prod JWKS override.
    issuers: ring.issuers,
    jwksOverride: parseJwksOverride(process.env.AGENT_JWKS_OVERRIDE),
  }))

  // ── CAMEL agent onboarding (ADR-0011 phase 3) ─────────────────────────────────
  // Treasury config is injected (not a stored noun): prod has exactly one treasury.
  const camelTreasury = (treasuryId: string) => (treasuryId === CAMEL_TREASURY.treasuryId ? CAMEL_TREASURY : null)
  const agentVerifier = new AgentJwtVerifier({
    issuers: ring.issuers,
    jwksOverride: parseJwksOverride(process.env.AGENT_JWKS_OVERRIDE),
  })
  const agentProvisioner = new AgentProvisioner({
    legati: ring.legati,
    signorum: ring.signorum,
    modorum: ring.modorum,
    treasury: camelTreasury,
  })
  // The compat route resolves the agent's Anima with the SAME federated find-or-create
  // the JWKS acceptor uses, so provisioning and later auth land on one soul.
  const resolveAgentAnima = (iss: string, sub: string): Promise<string> =>
    resolveOrCreateAnima(ring.personae, ring.animae, 'federated', federatedExternusId(iss, sub))
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
    weiToCredits: ALCHEMY_API_KEY
      ? (wei) => import('./arcanum/ethPrice.js').then(m => m.weiToCredits(wei, ALCHEMY_API_KEY))
      : undefined,
  }))
  // Ceremony sequencer — mounted before the /v1 catch-all so /v1/ceremony resolves here.
  // Live chain: public status + self-serve contribution upload (KZG-summoning model).
  // express.json() handles /slots; the contribution route brings its own raw() parser.
  await mountCeremony(app, ring.ceremonia)
  // Sponsorship pledges (ADR-0011 §2) — mounted before the /v1 catch-all so
  // /v1/sponsorships resolves here. The sweeper (below) does the actual dripping.
  app.use('/v1/sponsorships', express.json(), createSponsioRouter({ sponsiones: ring.sponsiones, identity: apiResolver }))

  // Fiat username/password auth (docs/spec/fiat-auth.md). Mounted at BOTH `/v1/auth` (native)
  // and `/api/v1/auth` (compat) — BEFORE the `/v1` + `/api/v1` catch-alls so the literal auth
  // paths resolve here. Only wired when JWT_SECRET is set (it signs + verifies the session).
  // Auth-sensitive routes are IP-rate-limited (express-rate-limit) to blunt credential stuffing.
  if (process.env.JWT_SECRET) {
    const { default: rateLimit } = await import('express-rate-limit')
    const limiter = (max: number) => rateLimit({ windowMs: 15 * 60 * 1000, max, standardHeaders: true, legacyHeaders: false })
    const buildAuthRouter = () => createAuthRouter({
      credenta,
      personae: ring.personae,
      animae: ring.animae,
      jwtSecret: process.env.JWT_SECRET as string,
      linkTokens,
      ...(process.env.TELEGRAM_BOT_USERNAME ? { botUsername: process.env.TELEGRAM_BOT_USERNAME } : {}),
      ...(process.env.SESSION_TTL_SECONDS ? { ttl: { sessionSeconds: Number(process.env.SESSION_TTL_SECONDS) } } : {}),
      rateLimiters: { register: limiter(20), login: limiter(20), wallet: limiter(30) },
    })
    app.use('/v1/auth', express.json(), buildAuthRouter())
    app.use('/api/v1/auth', express.json(), buildAuthRouter())
    log.info('fiat auth rail mounted at /v1/auth + /api/v1/auth')
  } else {
    log.warn('JWT_SECRET unset — fiat username/password auth is DISABLED (no session minting/verify)')
  }

  // Storage upload front door (JS-nuke blocker #10) — presigned browser→R2 uploads
  // for i2i input images + profile avatar/banner. One router, mounted at BOTH the
  // compat path the web app bakes (`/api/v1/storage`) and the native `/v1/storage`,
  // BEFORE the `/v1` + `/api/v1` catch-alls so the literal paths resolve here. Only
  // wired when R2 is configured (otherwise the upload path is genuinely unavailable).
  if (RUNPOD_R2) {
    const buildStorageRouter = () => createStorageRouter({ store: new R2Uploader(RUNPOD_R2), identity: apiResolver })
    app.use('/v1/storage', buildStorageRouter())
    app.use('/api/v1/storage', buildStorageRouter())
    log.info('storage upload front door mounted at /v1/storage + /api/v1/storage')
  } else {
    log.warn('R2 unconfigured — storage upload front door DISABLED (/storage/uploads/sign will 404)')
  }

  app.use('/v1', createApiRouter({ api: crystalApi, identity: apiResolver, hub: runHub }))

  // CAMEL agent compat surface (ADR-0011 §8) — the exact `/api/v1/...` paths the
  // deployed camel404 client bakes (on-chain-referenced). No catch-all in front,
  // so a bad assertion is a 401 INVALID_ASSERTION, never a 403 (the go/no-go probe).
  app.use('/api/v1', express.json(), createAgentCompatRouter({
    verifier: agentVerifier,
    provisioner: agentProvisioner,
    legati: ring.legati,
    resolveAgentAnima,
    treasury: camelTreasury,
    balanceOf: (animaId: string) => ring.signorum.balance({ animaId }),
    ...(process.env.PUBLIC_BASE ? { publicBase: process.env.PUBLIC_BASE } : {}),
  }))

  // x402 pay-per-call capability serving (ADR-0011 phase 4 — "the premise"). Feature-
  // flagged: X402_ENABLED=true + X402_PAY_TO wire it live; otherwise the endpoints 404.
  // The facilitator (on-chain verify/settle via @coinbase/x402) is edge I/O — a
  // deny-stub until CDP creds are wired; the whole state machine is otherwise crystal.
  const X402_PAY_TO = process.env.X402_PAY_TO
  const x402Config = { ...DEFAULT_X402_CONFIG, payTo: X402_PAY_TO ?? '0x0000000000000000000000000000000000000000' }
  const x402Enabled = process.env.X402_ENABLED === 'true' && !!X402_PAY_TO
  const SYSTEM_AUCTOR = { animaId: process.env.PLATFORM_ANIMA_ID ?? 'platform' }
  const cdpFacilitator = x402Enabled ? buildCdpX402Facilitator() : null
  if (x402Enabled && cdpFacilitator) log.info(`x402: CDP facilitator wired (${x402Config.network}, payTo ${x402Config.payTo})`)
  else if (x402Enabled) log.warn('x402: X402_ENABLED but CDP_API_KEY_ID/CDP_API_KEY_SECRET missing — payments fail closed (deny-stub)')
  app.use('/api/v1/x402', express.json(), createX402AgentRouter({
    legati: ring.legati,
    modorum: ring.modorum,
    facilitator: cdpFacilitator ?? disabledX402Facilitator,
    log: ring.x402Log,
    config: x402Config,
    enabled: x402Enabled,
    quoteImpetus: async (modusId, aditus) => BigInt((await crystalApi.quote(SYSTEM_AUCTOR, { modusId }, aditus)).impetus),
    // Prepaid run: the verified x402 payment backs a mint of the quote's impetus onto
    // the agent's Anima, which the normal run path then spends. Payment funds the run.
    runSpell: async ({ agentAnimaId, modusId, aditus, grossImpetus }) => {
      await ring.signorum.issue({ animaId: agentAnimaId, forma: 'minted', valor: grossImpetus, auctor: 'x402:prepaid' })
      return crystalApi.invokeFlow({ animaId: agentAnimaId }, { modusId }, aditus, { maxImpetus: grossImpetus })
    },
    // The agent's cut = the MARGIN (price − our serve cost) minus our fee, accrued to the
    // payee's GATED USD payout book (ADR-0013 §4c). Not an at-settle on-chain split; held
    // once the payee crosses the $600/yr reporting line without tax docs. Best-effort.
    accrueAgentCut: ({ payoutAddress, priceAtomic, serveImpetus, sourceRef, network }) =>
      accruePayeePayout(
        { mercedum: ring.mercedum, animae: ring.animae },
        {
          payoutAddress,
          usdMicro: agentCutMicro(BigInt(priceAtomic), serveImpetus),
          fmvSource: `x402:margin-split@${network}`,
          sourceRef: `x402:${sourceRef}`,
          kind: 'agent',
        },
      ),
    // Live status: await the async run + stream its real Progressus phases (SSE) to the caller.
    hub: runHub,
    getRun: (runId, ownerAnimaId) => crystalApi.getRun({ animaId: ownerAnimaId }, runId).catch(() => null),
    ...(process.env.PUBLIC_BASE ? { publicBase: process.env.PUBLIC_BASE } : {}),
  }))

  // /widget — the Noema embed surface (ADR-0011 §7): the SDK + chrome-less,
  // themed per-agent & gallery views, composed from the public feed + owner appearance.
  // Framing is a per-partner CSP allowlist (WIDGET_FRAME_ANCESTORS, space/comma-sep)
  // replacing the legacy `frame-ancestors *`; default 'self' (same-origin only).
  const widgetFrameAncestors = (process.env.WIDGET_FRAME_ANCESTORS ?? '')
    .split(/[\s,]+/).map((o) => o.trim()).filter(Boolean)
  app.use('/widget', createWidgetRouter({
    legati: ring.legati,
    feed: (filter) => crystalApi.feed(filter),
    appearance: (owner) => crystalApi.publicAppearance(owner),
    // Interactive run panel: resolve the agent's Modus + quote its price (§5 x402 pay-per-call).
    modorum: ring.modorum,
    quoteImpetus: async (modusId) => BigInt((await crystalApi.quote(SYSTEM_AUCTOR, { modusId }, {})).impetus),
    x402Config,
    frameAncestors: widgetFrameAncestors,
  }))

  // Owned purses (§7) — the crystal-core "delegation": an identified account mints a
  // shareable Bursa funded from its balance (or an agent's it owns); the purse token is
  // the invite code, runs spend it via the existing `/v1/runs` x-bursa-token path. Purses
  // are owner-linked (dashboard/reclaim); the anon Bursa path is untouched (privacy).
  app.use('/v1/purses', express.json(), createPurseRouter({
    identity: apiResolver,
    signorum: ring.signorum,
    bursarium: ring.bursarium,
    // fund-from-agent: the caller's linked wallet (Anima.custos) must equal the agent owner.
    fundFromAgent: async (agentId, callerAnimaId) => {
      const legatus = await ring.legati.findByAgentId(agentId)
      if (!legatus) return null
      const caller = await ring.animae.find(callerAnimaId)
      if (!caller?.custos || caller.custos.toLowerCase() !== legatus.ownerAddress.toLowerCase()) return null
      return { animaId: legatus.animaId }   // spend the agent's (sponsor-fed) balance
    },
    ...(process.env.PUBLIC_BASE ? { publicBase: process.env.PUBLIC_BASE } : {}),
  }))

  // ERC-8004 agent cards (ADR-0011 §7/§8): the platform card + per-agent capability
  // cards that advertise an agent's x402-callable Modus — the discoverable "agent link"
  // an external agent resolves → pays → runs. Mounted at `/` (specific paths only).
  const cardBase = process.env.PUBLIC_BASE ?? 'https://noema.art'
  app.use(createAgentCardRouter({
    legati: ring.legati,
    modorum: ring.modorum,
    quoteImpetus: async (modusId) => BigInt((await crystalApi.quote(SYSTEM_AUCTOR, { modusId }, {})).impetus),
    x402Config,
    publicBase: cardBase,
    appearance: (owner) => crystalApi.publicAppearance(owner),
    platform: {
      name: 'NOEMA',
      description: 'AI generation infrastructure — images, video, and media, with on-chain pay-per-call agents.',
      publicBase: cardBase,
      ...(process.env.ERC8004_AGENT_ID && process.env.ERC8004_IDENTITY_REGISTRY
        ? { registration: { agentId: Number(process.env.ERC8004_AGENT_ID), agentRegistry: `eip155:1:${process.env.ERC8004_IDENTITY_REGISTRY}` } }
        : {}),
    },
  }))

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

  // Subsidy sweeper (ADR-0011 §2) — drips every active sponsorship pledge once per
  // cycle. Hourly sweep; the per-pledge cycle key makes the drip idempotent.
  startSubsidySweeper(
    { sponsiones: ring.sponsiones, signorum: ring.signorum },
    { intervalMs: 60 * 60 * 1000, onError: (err) => log.error('subsidy sweep failed', { error: String(err) }) },
  )
  log.info('subsidy sweeper started', { tickMs: 60 * 60 * 1000 })

  // Conditional-license revenue tripwire (ADR-0012/0013 §5) — evaluates the company-wide
  // trailing-12mo USD revenue against the tightest active conditional cap and fires an
  // edge-triggered ops alert on band transitions (breach = compliance incident). Slow-moving
  // line → 6h cadence; the persisted band makes transitions detectable across restarts.
  startLicenseTripwire(
    { redituum: ring.redituum, intellarum: intellae, bandStore: ring.tripwireBand },
    { intervalMs: 6 * 60 * 60 * 1000, onError: (err) => log.error('license tripwire eval failed', { error: String(err) }) },
  )
  log.info('license tripwire started', { tickMs: 6 * 60 * 60 * 1000 })

  app.use('/internal', createLiveRouter(INTERNAL_SECRET))
  app.use('/internal/analytics', createAnalyticsRouter(wideStore, INTERNAL_SECRET))
  // BYO-secrets Phase C: the weight-download proxy. Mounted only when a job-token secret AND a
  // secret store are configured (the same envs that let the Compiler rewrite gated urls). A pod
  // presents its per-job token; we stream the owner's gated private weights with their BYO token
  // attached to the OUTBOUND request only. Authn is the job token itself (not INTERNAL_SECRET).
  if (JOB_TOKEN_SECRET && secretarium) {
    app.use('/internal', createWeightProxyRouter({
      verifyToken: (t: string) => verifyJobToken(JOB_TOKEN_SECRET, t),
      intellae,
      secrets: secretarium,   // resolve-only slice (SecretResolver); never handed to CrystalApi
    }))
    log.info('weight-download proxy mounted at /internal/weights/:intellaId (BYO-secrets Phase C)')
  }
  // Manual treasury funding (faucet off in prod) — fund the treasury Anima / top up an agent.
  app.use('/internal/v1', express.json(), createTreasuryAdminRouter({
    signorum: ring.signorum,
    legati: ring.legati,
    treasury: camelTreasury,
    ...(INTERNAL_SECRET ? { secret: INTERNAL_SECRET } : {}),
  }))

  // Alchemy address-activity webhook — processes CreditVault events.
  // Route: POST /webhooks/alchemy/:chainId  (chainId = '1' mainnet, '8453' Base)
  // Per-chain webhook HMAC signing secrets. Prefer the crystal names, fall back to the legacy bot's
  // chainId-suffixed names (`ALCHEMY_SIGNING_KEY_1`/`_8453`), then a single shared `ALCHEMY_SIGNING_KEY`.
  // When a chain's key is absent the webhook SKIPS HMAC validation (dev mode) — a prod hole — so this
  // reconciliation is what actually enforces signature checks on a deployment carrying the legacy names.
  const ALCHEMY_SIGNING_KEYS: Record<string, string> = {}
  const mainnetSigningKey = process.env.ALCHEMY_SIGNING_KEY_MAINNET ?? process.env.ALCHEMY_SIGNING_KEY_1 ?? process.env.ALCHEMY_SIGNING_KEY
  const baseSigningKey    = process.env.ALCHEMY_SIGNING_KEY_BASE    ?? process.env.ALCHEMY_SIGNING_KEY_8453 ?? process.env.ALCHEMY_SIGNING_KEY
  if (mainnetSigningKey) ALCHEMY_SIGNING_KEYS['1']    = mainnetSigningKey
  if (baseSigningKey)    ALCHEMY_SIGNING_KEYS['8453'] = baseSigningKey
  // CREDIT_VAULT + `pricer` are constructed once above (shared with the /v1 deposit-quote endpoint).
  // OFAC sanctions screen for deposit boundaries. The real Set-backed screen + SDN
  // loader are PRIVATE (ADR-0012 §49) — from the `compliance` module loaded above.
  // Falls back to the permissive screen with a LOUD warning if unconfigured/absent so
  // an un-synced production never silently runs unscreened — go-live blocker.
  const privateScreen = compliance?.configureSanctionsScreen({ log }) ?? null
  const sanctions: SanctionsScreen = privateScreen ?? permissiveSanctionsScreen
  if (!privateScreen) {
    log.warn('OFAC sanctions screening inactive (private compliance module absent or OFAC_BLOCKLIST_PATH unset) — deposit screening is a NO-OP. Configure before real deposits.')
  }
  const alchemyDeps = {
    deposita:     ring.deposita,
    signorum:     ring.signorum,
    redituum:     ring.redituum,
    petitiones:   ring.petitiones,
    testimonia:   ring.testimonia,
    animae:       ring.animae,
    arcanumTree:  ring.arcanumTree,
    sanctions,
    signingKeys:  ALCHEMY_SIGNING_KEYS,
    vaultAddresses: { '1': CREDIT_VAULT, '8453': CREDIT_VAULT },
    pricer,
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
