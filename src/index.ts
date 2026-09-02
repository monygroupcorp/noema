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
import { startTelegram } from './allocutio/telegram/startTelegram.js'
import type { AuctorKey } from './flow/types.js'
import { createWebhookRouter } from './api/webhooks/webhookRouter.js'
import { handleAlchemyWebhook, sweepConfirmatumDeposita } from './api/webhooks/alchemyWebhook.js'
import { makeResolveWalletAnima } from './crystal/resolveWalletAnima.js'
import { AlchemyPricer, nullPricer } from './crystal/AssetPricer.js'
import { permissiveSanctionsScreen, type SanctionsScreen } from './compliance/SanctionsScreen.js'
import { createVestigiaRouter } from './api/vestigia/vestigiaRouter.js'
import { createQuerelaRouter } from './api/querela/querelaRouter.js'
import { createPartnerRequestRouter } from './api/partner/partnerRequestRouter.js'
import { createPartnerAdminRouter } from './api/partner/partnerAdminRouter.js'
import { verifyApiKeyToAccountId as verifyApiKeyToAccountIdCore } from './crystal/apiKeys.js'
import { createArcanumRouter } from './api/arcanum/arcanumRouter.js'
import { mountCeremony } from './api/arcanum/mountCeremony.js'
import { CrystalApi } from './allocutio/api/CrystalApi.js'
import { IdentityResolver as ApiIdentityResolver, credentialsFromHeaders } from './allocutio/api/IdentityResolver.js'
import { createApiRouter } from './allocutio/api/apiRouter.js'
import { makeCredentialAcceptors, resolveOrCreateAnima, federatedExternusId, type ApiKeyAccount } from './allocutio/api/apiAcceptors.js'
import { AgentJwtVerifier, parseJwksOverride } from './allocutio/api/AgentJwtVerifier.js'
import { AgentProvisioner } from './crystal/AgentProvisioner.js'
import { createAgentCompatRouter } from './allocutio/api/agentCompatRouter.js'
import { createStorageRouter } from './allocutio/api/storageRouter.js'
import { createTreasuryAdminRouter } from './api/internal/treasuryAdminRouter.js'
import { createDepositsAdminRouter } from './api/internal/depositsAdminRouter.js'
import { alchemyRpc, runBootReconcile, resolveReconcileIntervalMs, startReconcileTimer } from './crystal/DepositReconciler.js'
import { MongoScanCursor } from './crystal/MongoScanCursor.js'
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
import { createColloquiaRouter } from './allocutio/api/colloquiaRouter.js'
import { runToolChat, httpApiTransport } from './allocutio/api/OpenRouterToolClient.js'
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
import { selectModerationGate, type ModerationGate } from './crystal/ModerationGate.js'
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
import { MongoActorum } from './crystal/MongoActorum.js'
import { startIdleReaper } from './crystal/idleReaper.js'
import { startExpiryReaper, recoverExpiredActa } from './crystal/expiryReaper.js'
import { MongoMandatum } from './crystal/MongoMandatum.js'
import { MandatumRunner, type AttemptOutcome } from './crystal/MandatumRunner.js'
import type { ComputeStrategy, GpuClass } from './types/actum.js'
import { startCensus } from './crystal/Census.js'
import { MongoIntella } from './crystal/MongoIntella.js'
import { R2Uploader } from './crystal/R2Uploader.js'
import { MeExporter } from './crystal/MeExporter.js'
import { MeEraser } from './crystal/MeEraser.js'
import { MongoErasedDenylist } from './crystal/MongoErasedDenylist.js'
import { MongoAnima } from './crystal/MongoAnima.js'
import { MongoPersona } from './crystal/MongoPersona.js'
import { MongoMemoria } from './crystal/MongoMemoria.js'
import { MongoProvinciarum } from './crystal/MongoProvinciarum.js'
import { MongoPetitio } from './crystal/MongoPetitio.js'
import { MongoColloquium } from './crystal/MongoColloquium.js'
import { MongoDictum } from './crystal/MongoDictum.js'
import { httpMediaFetcher, registerPrivateMediaResolver } from './crystal/MediaFetcher.js'
import { makeTrainingFinalizer, urlLoraReader, makeTrainingExitusResolver } from './crystal/trainingFinalizer.js'
import { makeCaptionFinalizer, urlCaptionHarvestReader, makeCaptionExitusResolver, composeExitusResolvers } from './crystal/captionFinalizer.js'
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
const EXPIRY_REAPER_INTERVAL_MS = Number(process.env.EXPIRY_REAPER_INTERVAL_MS ?? 60_000)  // sweep cadence for cold-start-timeout acta
const MANDATUM_RUNNER_INTERVAL_MS = Number(process.env.MANDATUM_RUNNER_INTERVAL_MS ?? 30_000)  // tick cadence for standing orders (the hour between attempts is the ORDER's, not this loop's)
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

// Dedicated PRIVATE bucket for GDPR self-exports (`docs/spec/publishing.md` §3). This bundle is the
// caller's whole PII (credit ledger, deposits, personae, chat messages, …) — it MUST NOT land
// in R2_OUTPUTS_BUCKET, which is the PUBLIC bucket (bound to R2_PUBLIC_URL) that serves the
// unauthenticated feed/editions. Deliberately NO `publicUrl`: the object is never publicly
// reachable, so the short-lived presigned GET URL is the ONLY handle to it and the 15-min
// expiry is a real control, not an illusion. Distinct bucket, same R2 account/credentials.
// The bucket itself must NOT be bound to a public domain (infra/R2 config, off-repo).
const R2_EXPORTS_BUCKET = process.env.R2_EXPORTS_BUCKET
const EXPORTS_R2: R2Config | undefined =
  R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_EXPORTS_BUCKET
    ? { endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, accessKeyId: R2_ACCESS_KEY_ID!, secretAccessKey: R2_SECRET_ACCESS_KEY!, bucket: R2_EXPORTS_BUCKET! }
    : undefined

// Dedicated PRIVATE bucket for private generation (noema-347) — the same pattern as the exports
// bucket above, for the same reason. A caller who turns private generation on is told their
// outputs are visible only to them, so those objects must NOT land in R2_OUTPUTS_BUCKET, the
// PUBLIC bucket (bound to R2_PUBLIC_URL) that serves the unauthenticated feed/editions.
// Deliberately NO `publicUrl`: the object has no public handle at all, so a short-lived
// presigned GET is the only way to read it and the expiry is a real control. Distinct bucket,
// same R2 account/credentials; the bucket itself must NOT be bound to a public domain (infra/R2
// config, off-repo). Unset → the feature is dark: the preference cannot be enabled (the write is
// refused) and every run generates public. It is never a fallback to the public bucket.
const R2_PRIVATE_OUTPUTS_BUCKET = process.env.R2_PRIVATE_OUTPUTS_BUCKET
const PRIVATE_OUTPUTS_R2: R2Config | undefined =
  R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_PRIVATE_OUTPUTS_BUCKET
    ? { endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, accessKeyId: R2_ACCESS_KEY_ID!, secretAccessKey: R2_SECRET_ACCESS_KEY!, bucket: R2_PRIVATE_OUTPUTS_BUCKET! }
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

function makeSecureRunPodClient(materiae?: MateriaStore, hospitia?: HospitiumStore, isActumLive?: (actumId: string) => Promise<boolean>): SecurePodClient {
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
    undefined,
    isActumLive,
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
  // Zombie-retry guard (noema-043): the retry loop only ever holds an actumId (via trace),
  // not a store — hand it the smallest read surface instead of a whole Actorum dependency.
  // Built off the same `acta` collection/default createContainer uses so both readers agree.
  const actumLivenessActorum = new MongoActorum(mongo.db(DB_NAME).collection('acta'))
  const isActumLive = async (actumId: string): Promise<boolean> => {
    const actum = await actumLivenessActorum.findById(actumId)
    return !actum || (actum.status !== 'completus' && actum.status !== 'fractus')
  }

  const runpodClient = process.env.DEV_FAKE_POD
    ? new FakeRunPodClient(undefined, { warmTtlMs: RUNPOD_WARM_TTL_MS }, materiae, hospitia)
    : (RUNPOD_API_KEY ? makeSecureRunPodClient(materiae, hospitia, isActumLive) : undefined)
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

  // Private generation (noema-347), startup wiring. The private-outputs store is the ONLY way to
  // read an object the runs wrote there, so it is registered as the process-wide resolver for
  // `noema-private://` markers: every host-side read path that already takes a MediaFetcher —
  // the CSAM/moderation gate, batch triage, image embeddings — keeps working on a private output
  // with no change of its own. The gate is fail-closed, so this seam is what stops a private
  // output from being unmoderatable. Unregistered when no private bucket is configured: a marker
  // then fails loudly rather than falling through to the network.
  const privateOutputsStore = PRIVATE_OUTPUTS_R2 ? new R2Uploader(PRIVATE_OUTPUTS_R2) : undefined
  if (privateOutputsStore) {
    registerPrivateMediaResolver({
      async fetch(key: string): Promise<Buffer> {
        // Self-presign, then read. The bucket has no public binding; this URL is minted for our
        // own immediate use and lapses in a minute.
        const url = await privateOutputsStore.getSignedDownloadUrl(key, { expiresIn: 60 })
        const res = await fetch(url)
        if (!res.ok) throw new Error(`private media fetch failed: ${res.status}`)
        return Buffer.from(await res.arrayBuffer())
      },
    })
  } else {
    log.warn('R2_PRIVATE_OUTPUTS_BUCKET unset — private generation DISABLED (the preference cannot be enabled and every run generates public). Refusing to host private outputs in the public outputs bucket.')
  }

  const ring = createContainer(mongo, {
    mongoUri: MONGODB_URI as string,
    dbName: DB_NAME,
    compile: compile as ContainerConfig['compile'],
    materiae,   // pre-created, shared with SecurePodClient
    hospitia,   // pre-created, shared with SecurePodClient + TelegramAllocutio
    terminatePod: podTerminator,
    // Private generation (noema-347): the dedicated bucket, and the preferences store the
    // dispatch site reads the caller's choice from.
    ...(PRIVATE_OUTPUTS_R2 ? { privateOutputsR2: PRIVATE_OUTPUTS_R2 } : {}),
    consuetudinum,
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

  // 3c. Recover expired acta — release locked signa; fail() now also kills any live pod.
  // Shares one code path with the periodic expiry reaper (startExpiryReaper) so boot
  // recovery and the timer can never diverge.
  const recovered = await recoverExpiredActa({
    actorum: ring.actorum,
    completor: ring.completor,
    compositusCursor: ring.compositusCursor,
  })
  if (recovered) log.info(`Recovered ${recovered} expired acta`)

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
    enter: (intent, platform, userId, chatId, identity, ctx) =>
      router.enter(intent, platform, userId, chatId, identity, ctx),
    handle: (platform, userId, chatId, event) => router.handle(platform, userId, chatId, event),
    clear: (platform, userId, chatId) => router.clear(platform, userId, chatId),
    hasContext: (platform, userId, chatId) => store.get(platform, userId, chatId) !== undefined,
    peek: (platform, userId, chatId) => store.get(platform, userId, chatId) ?? null,
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
  app.set('trust proxy', 1)
  app.use(express.json({
    verify: (req: import('express').Request & { rawBody?: string }, _res, buf: Buffer) => {
      req.rawBody = buf.toString()
    },
  }))

  app.get('/api/health', (_req, res) => res.json({ ok: true, v: process.env.BUILD_VERSION ?? 'dev' }))

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
  //   2. else the interim MANUAL-REVIEW hold gate ONLY under an explicit MODERATION_MANUAL_REVIEW opt-in
  //      (holds every public publish for the admin review queue — interim human-review posture);
  //   3. else the permissive no-op ONLY under an explicit MODERATION_ALLOW_UNSCANNED opt-in;
  //   4. else `denyModerationGate` (the safe default — public publishing off until the scanner is wired).
  // Selection is `selectModerationGate` (ModerationGate.ts, unit-tested); we log the chosen mode here.
  // Default (no private gate, neither MODERATION_MANUAL_REVIEW nor MODERATION_ALLOW_UNSCANNED) = fail-closed deny.
  const privateGate = compliance ? await compliance.configureModerationGate({ fetcher: httpMediaFetcher, log }) : null
  const { gate: moderationGate, mode: moderationMode } = selectModerationGate({
    privateGate,
    manualReview: process.env.MODERATION_MANUAL_REVIEW === '1',
    allowUnscanned: process.env.MODERATION_ALLOW_UNSCANNED === '1',
  })
  if (moderationMode === 'manual') {
    log.warn('MODERATION_MANUAL_REVIEW=1 — public publishing is HELD for manual human review (interim posture): every public publish routes to the admin review queue, none auto-publishes. The reviewer approves/rejects; the NCMEC report/preserve is the reviewer\'s explicit confirm-csam action, not this gate. Requires the queue be actively cleared.')
  } else if (moderationMode === 'permissive') {
    log.warn('MODERATION_ALLOW_UNSCANNED=1 — public publishing approves content WITHOUT CSAM/NCMEC scanning. Dev/staging only; NEVER in production.')
  } else if (moderationMode === 'deny') {
    log.warn('No CSAM/NCMEC scanner active (private compliance module absent or unconfigured) — public publishing (feed/marketplace) is DENIED (fail-closed). Private/unlisted still work.')
  }

  // Input-side CSAM prompt guard (generation boundary, FAIL-OPEN). From the private
  // module; absent (public build) → permissive stub. Refuses only minor∧sexual prompts
  // (+ an out-of-band code-word lexicon) — adult content passes. The publish-time gate
  // above is the fail-closed backstop.
  const promptGuard: PromptGuard = compliance?.configurePromptGuard({ log })
    ?? (log.warn('Input CSAM prompt guard inactive (private compliance module absent) — generation prompts are NOT screened. The publish-time gate still applies.'), permissivePromptGuard)

  // Import-by-URL (`docs/spec/model-import.md` Tier 1): register a Civitai/HF/direct model as a
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

  // Publish-safety cost forwarding (`docs/spec/moderation-classifier.md` §7): a content-addressed
  // verdict cache so an identical re-publish reuses the gate verdict (no re-scan, no re-fee),
  // and a per-scan fee charger that forwards the paid-classifier cost to the publisher — only
  // on a BILLABLE scan (a real Thorn call). PUBLISH_SCAN_FEE (impetus points) is the config
  // knob until Thorn quotes; unset/0 ⇒ no fee.
  const verdictCache = new MongoVerdictCache(mongo.db(DB_NAME).collection('verdict_cache'))
  void verdictCache.ensureIndexes().catch(err => log.warn('verdictCache: ensureIndexes failed', { error: String(err) }))
  const PUBLISH_SCAN_FEE = BigInt(process.env.PUBLISH_SCAN_FEE ?? '0')
  const scanFeeCharger = ledgerScanFeeCharger({ signorum: ring.signorum, amount: PUBLISH_SCAN_FEE })

  // Crystal Agent API (/v1) — ApiAllocutio.
  // The agent-shaped facade over the ring + the credential→AuctorKey resolver.
  // Reviewer-confirmed-CSAM NCMEC report seam (human-review path, spec §4). From the
  // private module; absent (public build) → the confirm action rejects but logs that no
  // report was filed. Assembles + preserves; live NCMEC submission needs the ESP account.
  const csamReviewReporter = compliance?.configureCsamReviewReporter({ fetcher: httpMediaFetcher })

  // Wide-event store (per-job telemetry incl. costUsd) — constructed here (ahead of its other
  // consumers below) so the admin COGS report can read off the SAME instance analyticsListener
  // writes through.
  const wideStore = new WideEventStore(mongo.db(DB_NAME))

  // GDPR Art. 17 right-to-erasure (noema-025) — build the erased-account denylist (session
  // revocation, shared with the auth acceptors below so an erase is visible to verifyJwt at once)
  // and the MeEraser. The eraser takes narrow concrete stores (mirror the MeExporter wiring); the
  // financial ledger + ZK set are deliberately NOT wired in, so erasure cannot reach them. The
  // endpoint itself is flag-gated (`ERASURE_ENABLED`, default off, counsel-gated in prod).
  const erasedDenylist = new MongoErasedDenylist(mongo.db(DB_NAME).collection('erased_denylist'))
  await erasedDenylist.ensureIndexes().catch((err) => log.warn('erased_denylist index ensure failed', { error: String(err) }))
  const meEraser = new MeEraser({
    denylist: erasedDenylist,
    animae: new MongoAnima(mongo.db(DB_NAME).collection('animae')),
    personae: new MongoPersona(mongo.db(DB_NAME).collection('personae')),
    credenta,
    consuetudinum,
    memoriae: new MongoMemoria(mongo.db(DB_NAME).collection('memoriae')),
    provinciae: new MongoProvinciarum(mongo.db(DB_NAME).collection('provinciae')),
    petitiones: new MongoPetitio(mongo.db(DB_NAME).collection('petitiones')),
    colloquia: new MongoColloquium(mongo.db(DB_NAME).collection('colloquia')),
    dicta: new MongoDictum(mongo.db(DB_NAME).collection('dicta')),
  })

  // Standing orders (Mandatum, noema-310) — a training click is an instruction that outlives
  // any one attempt at it. Built here (like the erased denylist above) rather than in the ring
  // because exactly two things hold it: the facade that opens and reads orders, and the runner
  // below that works them.
  const mandata = new MongoMandatum(mongo.db(DB_NAME).collection('mandata'))
  await mandata.ensureIndexes().catch((err) => log.warn('mandata index ensure failed', { error: String(err) }))

  const crystalApi = new CrystalApi({
    pricer,
    mandata,
    eraser: meEraser,
    depositAddress: CREDIT_VAULT,
    deposita: ring.deposita,
    personae: ring.personae,
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
    hospitia: ring.hospitia,
    materiae: ring.materiae,
    actumIndex: ring.actumIndex,
    modos: ring.modos,
    consuetudinum,
    // Private generation (noema-347): presence gates the preference (a toggle the deployment
    // cannot honour is refused, not silently downgraded) and presigns markers on an owner-scoped
    // run read.
    ...(privateOutputsStore ? { privateOutputs: { store: privateOutputsStore } } : {}),
    compositusCursor: ring.compositusCursor,
    collectiones: ring.collectiones,
    datasets: ring.datasets,
    // The corpus store a declared corpus reference resolves against (the training modus's
    // dataset port). Wired for the same reason the dataset store is: the run entry point
    // resolves the reference for the calling anima, and a store it cannot reach is a
    // reference it has to refuse.
    corpora: ring.corpora,
    museSessions: ring.museSessions,
    collectioCursor: ring.collectioCursor,
    sodalitatum: ring.sodalitates,
    provinciarum: ring.provinciae,
    tabulae: ring.tabulae,
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
    // Admin COGS report (admin workspace, credits-only/read-only): trailing-window rollup of
    // per-job costUsd off the same wide-event store the analytics listener writes through.
    costReport: wideStore,
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
  //
  // `users.apiKeys[]` entries may carry an OPTIONAL `maxImpetusPerRun` (a stringified bigint —
  // string so a value beyond Number.MAX_SAFE_INTEGER survives the round trip): a per-run spend
  // ceiling minted onto the key itself, used for partner keys. `verifyApiKeyToAccountIdCore`
  // (crystal/apiKeys.ts) passes it through raw; parsing/enforcement lives in `apiAcceptors`
  // (hermetic, and an unreadable value refuses the key there rather than degrading to "no
  // ceiling"). A key without the field is unchanged in every respect.
  const usersCol = mongo.db(DB_NAME).collection('users')
  const verifyApiKeyToAccountId = (apiKey: string): Promise<ApiKeyAccount | null> => verifyApiKeyToAccountIdCore(usersCol, apiKey)
  const apiResolver = new ApiIdentityResolver(makeCredentialAcceptors({
    personae: ring.personae,
    animae: ring.animae,
    ...(process.env.JWT_SECRET ? { jwtSecret: process.env.JWT_SECRET } : {}),
    verifyApiKeyToAccountId,
    // Federated (JWKS) SSO — trusted-issuer registry + the live prod JWKS override.
    issuers: ring.issuers,
    jwksOverride: parseJwksOverride(process.env.AGENT_JWKS_OVERRIDE),
    // Session revocation (noema-025) — verifyJwt rejects an erased soul's still-valid JWT.
    denylist: erasedDenylist,
  }))
  // Vestigia (traces) — GET / + /search + /projection. Mounted here (not at its
  // original spot above) because / and /projection resolve the CALLER's identity
  // via apiResolver, mirroring createSponsioRouter below.
  app.use('/api/vestigia', createVestigiaRouter({ vestigiorum: ring.vestigiorum, identity: apiResolver }))
  // Querela reports (bug/feature/feedback) — anon-capable (animaId,
  // commitment, AND bursaToken), so mounted here (not via apiResolver-only vestigia-style
  // resolveCaller) with its own bursa-permitting auth seam, mirroring createSponsioRouter below.
  app.use('/v1/reports', express.json(), createQuerelaRouter({ querelae: ring.querelae, identity: apiResolver }))

  // Partner program intake (B2B "request a demo") — public, anon-capable (identity is
  // OPPORTUNISTIC here: a logged-in submitter's animaId is attached, but resolution
  // failure is never fatal — see partnerRequestRouter.ts's header). Mirrors querelaRouter's
  // shape (own hand-rolled counted-window rate limit, no CrystalApi facade).
  app.use('/v1/partner-requests', express.json(), createPartnerRequestRouter({
    partnerRequests: ring.partnerRequests,
    identity: apiResolver,
  }))
  // Admin review + approval-provisioning of those requests. Platform-admin only — see
  // partnerAdminRouter.ts's header for why the gate is reproduced there rather than
  // imported from CrystalApi, mirroring querelaAdminRouter.ts's precedent.
  app.use('/v1/admin/partner-requests', express.json(), createPartnerAdminRouter({
    partnerRequests: ring.partnerRequests,
    partners: ring.partners,
    identity: apiResolver,
    personae: ring.personae,
    usersCol,
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
  // ANON_PURSE_ENABLED (noema-131) — default OFF. The arcanum ZK purse verifies against a
  // committed SOLO DEV proving key: anonymity holds but SOUNDNESS does not (the dev-key holder
  // can forge spend proofs). Until the trusted-setup ceremony runs, gate the forgeable money path
  // off: arcanum issue/mint refuse, and an ownerless bursa spend is refused at the shared
  // chokepoints (owned/identified-funded purses stay live). Flip true post-ceremony (one-flag flip).
  const anonPurseEnabled = process.env.ANON_PURSE_ENABLED === 'true'
  if (anonPurseEnabled) log.warn('ANON_PURSE_ENABLED=true — the anonymous ZK purse (arcanum) is LIVE on this instance')
  else log.info('ANON_PURSE_ENABLED off — anonymous ZK purse gated (arcanum issue/mint + ownerless bursa spend refused)')
  app.use('/arcanum', createArcanumRouter(ring.arcanumIssuer, ring.arcanumTree, {
    anonPurseEnabled,
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
    const buildStorageRouter = () => createStorageRouter({ store: new R2Uploader(RUNPOD_R2), identity: apiResolver, anonPurseEnabled, bursarium: ring.bursarium })
    app.use('/v1/storage', buildStorageRouter())
    app.use('/api/v1/storage', buildStorageRouter())
    log.info('storage upload front door mounted at /v1/storage + /api/v1/storage')
  } else {
    log.warn('R2 unconfigured — storage upload front door DISABLED (/storage/uploads/sign will 404)')
  }

  // GDPR self-export assembler (T1) — the single auditable home for the caller's own PII
  // egress. Constructed with exactly the owner-scoped read stores it needs (all already on the
  // ring, plus the locally-built consuetudinum/credenta/intellae). The bundle is hosted in the
  // DEDICATED PRIVATE exports bucket (EXPORTS_R2, no publicUrl) — NEVER the public outputs
  // bucket — so the signed GET URL is the only handle and its expiry is real. Only wired when
  // that private bucket is configured; otherwise POST /v1/me/export 503s (never falls back to a
  // public bucket).
  if (RUNPOD_R2 && !EXPORTS_R2) {
    log.warn('R2_EXPORTS_BUCKET unset — GDPR self-export DISABLED (POST /v1/me/export will 503). Refusing to host PII bundles in the public outputs bucket.')
  }
  const meExporter = EXPORTS_R2
    ? new MeExporter({
        store: new R2Uploader(EXPORTS_R2),
        consuetudinum,
        personae: ring.personae,
        credenta,
        provinciae: ring.provinciae,
        actumIndex: ring.actumIndex,
        intellae,
        editiones: ring.editiones,
        memoriae: ring.memoriae,
        colloquia: ring.colloquia,
        dicta: ring.dicta,
        vestigiorum: ring.vestigiorum,
        bursarium: ring.bursarium,
        signorum: ring.signorum,
        deposita: ring.deposita,
      })
    : undefined

  // ERASURE_ENABLED (noema-025) — default OFF. Gates DELETE /v1/me; works on staging for
  // verification, stays disabled in production until counsel signs Art.17(3)(b) sufficiency.
  const erasureEnabled = process.env.ERASURE_ENABLED === 'true'
  if (erasureEnabled) log.warn('ERASURE_ENABLED=true — DELETE /v1/me (GDPR erasure) is LIVE on this instance')

  // Public-publish volume cap (noema-119, manual-review launch posture): the held-review queue
  // (noema-118) only stays humanly clearable if public inflow (feed/marketplace) is bounded.
  // Per-OWNER (not IP — anon-capable callers publish under an animaId/commitment, never bare
  // IP), a real limiter by default (this is a safety cap, unlike quote/wallet's opt-in guards).
  // Window/count are env-overridable like the app's other rate limiters.
  const { default: publishRateLimit } = await import('express-rate-limit')
  const PUBLISH_RATE_LIMIT_MAX = Number(process.env.PUBLISH_RATE_LIMIT_MAX ?? 20)
  const PUBLISH_RATE_LIMIT_WINDOW_MS = Number(process.env.PUBLISH_RATE_LIMIT_WINDOW_MS ?? 60 * 60 * 1000)
  const publishLimiter = publishRateLimit({
    windowMs: PUBLISH_RATE_LIMIT_WINDOW_MS,
    max: PUBLISH_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    // Stamped onto the request by apiRouter's /editiones handler BEFORE invoking this
    // middleware — owner-keyed, never IP (see `publishOwnerKey` in apiRouter.ts).
    keyGenerator: (req) => (req as { publishOwnerKey?: string }).publishOwnerKey ?? 'unknown',
    message: { error: { code: 'rate.limited', message: 'public publishing is rate-limited during review — try again shortly' } },
  })

  app.use('/v1', createApiRouter({
    api: crystalApi,
    identity: apiResolver,
    hub: runHub,
    erasureEnabled,
    anonPurseEnabled,
    bursarium: ring.bursarium,
    partners: ring.partners,
    ...(meExporter ? { exporter: meExporter } : {}),
    rateLimiters: { publish: publishLimiter },
  }))

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
  // The unauthenticated discover/quote GET is IP-rate-limited (express-rate-limit) — the POST
  // run is not, since it's already gated by a stronger control (on-chain payment verification).
  const { default: x402RateLimit } = await import('express-rate-limit')
  const x402QuoteLimiter = x402RateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false })
  app.use('/api/v1/x402', express.json(), createX402AgentRouter({
    legati: ring.legati,
    modorum: ring.modorum,
    facilitator: cdpFacilitator ?? disabledX402Facilitator,
    log: ring.x402Log,
    config: x402Config,
    enabled: x402Enabled,
    rateLimiters: { quote: x402QuoteLimiter },
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
  //
  // Redeem is limited on TWO independent keys, because either one alone leaves an easy way
  // around it: per source address, and per caller credential (an address rotation does not
  // reset the caller bucket, and a fresh account does not reset the address bucket). Tokens
  // are UUIDs, so this is hygiene on a route that moves credits, not the thing standing
  // between an attacker and a purse. Callers with no credential share one bucket — they are
  // answered 401 by the route regardless.
  const { default: purseRateLimit } = await import('express-rate-limit')
  const PURSE_REDEEM_WINDOW_MS = Number(process.env.PURSE_REDEEM_RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000)
  const PURSE_REDEEM_MAX = Number(process.env.PURSE_REDEEM_RATE_LIMIT_MAX ?? 20)
  const redeemLimitMessage = { error: { code: 'rate.limited', message: 'too many code redemptions — try again shortly' } }
  const purseRedeemPerIp = purseRateLimit({
    windowMs: PURSE_REDEEM_WINDOW_MS, max: PURSE_REDEEM_MAX,
    standardHeaders: true, legacyHeaders: false, message: redeemLimitMessage,
  })
  const purseRedeemPerCaller = purseRateLimit({
    windowMs: PURSE_REDEEM_WINDOW_MS, max: PURSE_REDEEM_MAX,
    standardHeaders: true, legacyHeaders: false, message: redeemLimitMessage,
    // The credential itself is never used as a key — it is hashed, so the limiter's store
    // holds no bearer material.
    keyGenerator: (req) => {
      const cred = req.headers.authorization
      return cred ? `c:${createHash('sha256').update(cred).digest('hex')}` : 'c:unauthenticated'
    },
  })
  app.use('/v1/purses', express.json(), createPurseRouter({
    rateLimiters: { redeem: [purseRedeemPerIp, purseRedeemPerCaller] },
    identity: apiResolver,
    signorum: ring.signorum,
    bursarium: ring.bursarium,
    // noema-082 (Q3 freeze boundary): the purse-mint freeze check needs the AnimaStore to read the
    // caller's disputeFrozen flag (mint is a bearer-value-extraction outflow; reclaim is not gated).
    animae: ring.animae,
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

  // Concierge conversational surface (noema-095, MONEY CODE): POST /v1/colloquia (create a
  // thread) + POST /v1/colloquia/:id/dicta (run one metered turn). A turn persists the user +
  // agent Dicta, runs the read-only ConciergeAgent (noema-094), and settles DIRECTLY at the
  // exact OpenRouter chat cost per turn (Decision Q1) — Signorum exact-cost for animaId/commitment
  // callers, Bursa flat-cap for bursaToken (locked ruling). Only wired when an OpenRouter
  // key is configured — without it the tool-use agent cannot run, so the endpoints stay unmounted
  // (404) rather than 401-ing every turn.
  const openRouterKey = process.env.OPENROUTER_API_KEY
  if (openRouterKey) {
    const conciergeTurnCap = process.env.CONCIERGE_TURN_CAP_IMPETUS
    app.use('/v1/colloquia', express.json(), createColloquiaRouter({
      identity: apiResolver,
      colloquia: ring.colloquia,
      dicta: ring.dicta,
      signorum: ring.signorum,
      bursarium: ring.bursarium,
      api: crystalApi,
      agent: {
        runToolChat,
        toolClient: { http: httpApiTransport, apiKey: openRouterKey },
        ...(process.env.CONCIERGE_MODEL ? { model: process.env.CONCIERGE_MODEL } : {}),
      },
      ...(conciergeTurnCap && /^[1-9][0-9]*$/.test(conciergeTurnCap) ? { turnCapImpetus: BigInt(conciergeTurnCap) } : {}),
    }))
  } else {
    log.warn('OPENROUTER_API_KEY unset — concierge endpoints (/v1/colloquia) DISABLED (the read-only tool-use agent cannot run without it).')
  }

  // ERC-8004 platform agent card (ADR-0011 §5): advertises Noema itself as the x402
  // capability execution target an external agent resolves → pays → runs against.
  // Mounted at `/` (specific paths only).
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

  // MCP adapter (/v1/mcp) — the same facade as REST, exposed as MCP tools + crystal://
  // resources for agent tool-use (Phase 3). Stateless per-request streamable-HTTP transport.
  app.use('/v1/mcp', createMcpRouter({ api: crystalApi, identity: apiResolver }))

  const INTERNAL_SECRET = process.env.INTERNAL_SECRET
  // The `/internal` routers below check `INTERNAL_SECRET` unconditionally, so an unset value
  // leaves them refusing every request. In production that is a misconfiguration rather than a
  // posture — fail the boot so it surfaces immediately instead of as a silent dead surface.
  // Outside production the routers stay fail-closed; only the assertion is skipped.
  if (process.env.NODE_ENV === 'production' && !INTERNAL_SECRET) {
    throw new Error('INTERNAL_SECRET must be set in production: the /internal routers refuse all requests without it')
  }
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

  // Expiry reaper — release the locked reserve of any cold-start-timeout actum. The
  // boot sequence (step 3c) was the ONLY caller of findExpired, so on a long-lived
  // server a timed-out actum's locked signa (up to the 30-min RunPod cap) stayed
  // locked against the user's balance until the next restart. This runs the same
  // recovery sweep on an interval (release-only, never a charge).
  startExpiryReaper({
    actorum: ring.actorum,
    completor: ring.completor,
    compositusCursor: ring.compositusCursor,
  }, EXPIRY_REAPER_INTERVAL_MS)
  log.info('expiry reaper started', { tickMs: EXPIRY_REAPER_INTERVAL_MS })

  // Mandatum runner (noema-310) — works the standing orders a training click opens. It reads
  // each order's outstanding attempt, and when that attempt failed for a reason another
  // machine could fix, asks again on the hour until the order lands or its day runs out.
  // In-process beside the other reapers, behind the store's atomic claim (the PublicationWorker
  // shape), so it survives restarts and can be lifted into its own container unchanged.
  //
  // It moves no money itself: every attempt is an ordinary invoke as the order's payer, so the
  // freeze, content, cap and balance gates all re-run, and a failed attempt refunds exactly as
  // a hand-clicked one does.
  new MandatumRunner({
    mandata,
    outcome: async (actumId): Promise<AttemptOutcome | null> => {
      const a = await ring.actorum.findById(actumId)
      if (!a) return null
      if (a.status === 'completus') return { state: 'succeeded' }
      if (a.status === 'fractus') return { state: 'failed', error: a.error ?? 'run failed' }
      return { state: 'pending' }
    },
    fire: async (m) => {
      const run = await crystalApi.invokeFlow(
        m.by,
        { modusId: m.modusId },
        m.aditus,
        {
          mandatumId: m.id,
          ...(m.invocatio?.maxImpetus !== undefined ? { maxImpetus: m.invocatio.maxImpetus } : {}),
          ...(m.invocatio?.computeStrategy ? { computeStrategy: m.invocatio.computeStrategy as ComputeStrategy } : {}),
          ...(m.invocatio?.gpuClass ? { gpuClass: m.invocatio.gpuClass as GpuClass } : {}),
        },
      )
      return run.id
    },
    // An erased account is never spent on: erasure ends the order rather than pausing it.
    payerLive: async (by) => ('animaId' in by ? !(await erasedDenylist.has(by.animaId)) : true),
  }, ).start(MANDATUM_RUNNER_INTERVAL_MS)
  log.info('mandatum runner started', { tickMs: MANDATUM_RUNNER_INTERVAL_MS })

  // Census — the host's continuous per-time cost reckoning (studio billing tick).
  // Every 60s walks active Hospitia and debits the host secondsSinceLastTick ×
  // impetusPerSecond. Without this, hosts pay nothing for studios sitting warm — the
  // platform absorbs the underlying compute cost. See
  // the studio billing tick.
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
    animae: ring.animae,
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
  // The chains this deployment serves. Built unconditionally from the CreditVault constant, so its
  // KEYS are the served set — the webhook refuses any other `:chainId` at the door (a caller-supplied
  // chain resolves neither a signing key nor a vault address, so no guard downstream is keyed to it).
  // Declared here rather than inline in `alchemyDeps` so the key check below reads the same set.
  const ALCHEMY_VAULT_ADDRESSES: Record<string, string> = { '1': CREDIT_VAULT, '8453': CREDIT_VAULT }
  // A served chain whose signing key is absent takes the dev-mode path — HMAC validation is skipped
  // for its deliveries. Say so at boot, the way absent OFAC screening does fifteen lines below:
  // otherwise a key that stops resolving on a future deploy changes the security posture silently.
  for (const chainId of Object.keys(ALCHEMY_VAULT_ADDRESSES)) {
    if (!ALCHEMY_SIGNING_KEYS[chainId]) {
      log.warn(`Alchemy webhook signing key absent for chain ${chainId} (ALCHEMY_SIGNING_KEY_${chainId} / ALCHEMY_SIGNING_KEY unset) — HMAC validation is SKIPPED for that chain's deliveries, so its deposit webhook is unauthenticated. Configure before real deposits — go-live blocker.`)
    }
  }
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
  // Deposit attribution seam (noema-027): resolve payer wallet → account via the auth rail's `web`
  // Persona binding (custos fallback), NOT the dead `animae.custos` read that parked every linked
  // deposit. Shared by the webhook payment + NFT paths and the retry sweep.
  const resolveWalletAnima = makeResolveWalletAnima({ personae: ring.personae, animae: ring.animae })
  const alchemyDeps = {
    deposita:     ring.deposita,
    signorum:     ring.signorum,
    redituum:     ring.redituum,
    petitiones:   ring.petitiones,
    testimonia:   ring.testimonia,
    resolveWalletAnima,
    arcanumTree:  ring.arcanumTree,
    sanctions,
    signingKeys:  ALCHEMY_SIGNING_KEYS,
    vaultAddresses: ALCHEMY_VAULT_ADDRESSES,
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

  // Retry sweep (noema-027 decision 3): on boot + every DEPOSIT_SWEEP_INTERVAL_MS, re-attribute and
  // credit parked `confirmatum` deposita whose payer wallet now resolves to an account (e.g. the
  // wallet was linked after the deposit landed). No new admin surface. Credits from the persisted
  // receipt-time basis; the unique-partial testis index makes a sweep tick racing an Alchemy
  // re-delivery credit exactly once. Legacy rows without a persisted basis are skipped + warned.
  const DEPOSIT_SWEEP_INTERVAL_MS = Number(process.env.DEPOSIT_SWEEP_INTERVAL_MS ?? 5 * 60 * 1000)
  const runDepositSweep = () =>
    void sweepConfirmatumDeposita(alchemyDeps).catch(err => log.warn('deposit sweep failed', { error: String(err) }))
  runDepositSweep()
  const depositSweepTimer = setInterval(runDepositSweep, DEPOSIT_SWEEP_INTERVAL_MS)
  depositSweepTimer.unref?.()

  // Deposit reconciliation (noema-348): the sweep above re-processes deposits we RECORDED; this
  // reads the vault's own logs back from the chain, so a deposit whose webhook delivery never
  // arrived is still found and credited through the same core. Boot-time catch-up (window-bounded
  // from the persisted cursor, idempotent, fire-and-forget) plus an operator route for healing a
  // known gap on demand. Needs the RPC key — without it the reconciler is not wired, and the
  // webhook remains the only path, which is the condition this warning names.
  if (ALCHEMY_API_KEY) {
    const scanCursor = new MongoScanCursor(mongo.db(DB_NAME).collection('deposit_scan_cursor'))
    void scanCursor.ensureIndexes().catch(err => log.warn('deposit scan cursor: ensureIndexes failed', { error: String(err) }))
    const reconcilerDeps = {
      webhook: alchemyDeps,
      rpc: alchemyRpc(ALCHEMY_API_KEY),
      cursor: scanCursor,
    }
    app.use('/internal/v1', express.json(), createDepositsAdminRouter({
      reconciler: reconcilerDeps,
      servedChainIds: Object.keys(ALCHEMY_VAULT_ADDRESSES),
      ...(INTERNAL_SECRET ? { secret: INTERNAL_SECRET } : {}),
    }))
    void runBootReconcile(reconcilerDeps, Object.keys(ALCHEMY_VAULT_ADDRESSES))
      .catch(err => log.warn('deposit reconcile failed', { error: String(err) }))

    // The patrol (noema-352): boot alone heals only the gap a restart opens, so a missed delivery
    // between deploys would wait for the next boot. Every DEPOSIT_RECONCILE_INTERVAL_MS the timer
    // runs the same cursor-driven pass — no explicit window, so the cursor advances and a long
    // historical range finishes itself tick by tick. Unset = the module default; `0` or a
    // non-number disables the timer (boot + operator route only), named once at startup.
    startReconcileTimer(
      reconcilerDeps,
      Object.keys(ALCHEMY_VAULT_ADDRESSES),
      resolveReconcileIntervalMs(process.env.DEPOSIT_RECONCILE_INTERVAL_MS),
    )
  } else {
    log.warn('Alchemy RPC key unset (ALCHEMY_API_KEY / ALCHEMY_KEY) — deposit reconciliation is NOT running, so a deposit whose webhook delivery is missed stays unrecorded. Configure before real deposits.')
  }

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

  // Caption finality at the same webhook: a completed batch caption run reads the pod-uploaded
  // {mediaId: caption} map and persists it as a captionset on the dataset. Gated on the same R2
  // presence the training resolver uses (it needs R2 to read the harvest back).
  const captionExitusResolver = RUNPOD_R2
    ? makeCaptionExitusResolver(makeCaptionFinalizer({
        reader: urlCaptionHarvestReader(httpMediaFetcher),
        datasets: ring.datasets,
      }))
    : undefined

  // COMPOSE, never replace: the router has ONE `resolveExitus` slot. Each resolver declines
  // (returns null) for a ministerium that is not its own, so both stay reachable through one
  // slot; passing either alone would leave the other's completions to the generic projection —
  // a finished training run would stop hosting its LoRA and registering its Intella while still
  // reporting success. Absent both (no R2), the spread below stays empty exactly as before.
  const exitusResolver = composeExitusResolvers(captionExitusResolver, trainingExitusResolver)

  app.use('/webhooks', createWebhookRouter({
    actorum: ring.actorum,
    completor: ring.completor,
    secret: RUNPOD_WEBHOOK_SECRET,
    flowRouter: router,
    nexus,
    signorum: ring.signorum,
    modorum: ring.modorum,
    ...(exitusResolver ? { resolveExitus: exitusResolver } : {}),
    hospitia: ring.hospitia,
    deployments: ring.deployments,
    editiones: ring.editiones,
    materiae,
    actumIndex: ring.actumIndex,
    vestigiorum: ring.vestigiorum,
    collectioRouter: ring.collectioCursor,
    compositusRouter: ring.compositusCursor,
  }))

  // --- Web app (new React frontend) — gated by SERVE_WEB_APP, registered AFTER all API routes ---
  // Serve the built React SPA from this process. Named SERVE_WEB_APP because it governs PRODUCTION
  // as much as staging — under its old name (STAGING_FRONTEND) prod shipped a 200 /api/health and a
  // 404 front page after the 2026-08-06 cutover. STAGING_FRONTEND is a deprecated alias for one release.
  const serveWebApp = process.env.SERVE_WEB_APP === '1' || process.env.STAGING_FRONTEND === '1'
  if (process.env.SERVE_WEB_APP !== '1' && process.env.STAGING_FRONTEND === '1') {
    log.warn('[web] STAGING_FRONTEND is deprecated — rename it to SERVE_WEB_APP=1 in .env')
  }
  if (serveWebApp) {
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
      log.warn(`[web] SERVE_WEB_APP=1 but app build missing at ${appIndex}`)
    }
  } else {
    log.info('[web] SERVE_WEB_APP is not set — API only, no SPA (/ will 404)')
  }

  app.listen(PORT, () => log.info(`Listening on :${PORT}`))

  // 9. Graceful shutdown — registered BEFORE any optional integration is started.
  // Everything `shutdown` closes over is constructed far above this point, and a process must be
  // able to die cleanly before it starts anything that may not return: the Telegram polling start
  // below does not resolve while the bot is running, so a handler registered after it is never
  // registered at all, and SIGTERM would then fall through to the default disposition with warm
  // pods still running and Mongo still open.
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

  // 10. Register bot commands and start Telegram.
  //
  // Non-fatal by construction: `startTelegram` returns a result rather than throwing, so a Telegram
  // credential or connectivity failure degrades the chat surface instead of taking down a process
  // that is already serving HTTP. Every Telegram call inside it is bounded by a timeout, and the
  // polling start is not awaited to completion. See src/allocutio/telegram/startTelegram.ts.
  const BOT_COMMANDS = [
    { command: 'make',   description: 'Generate images and art'        },
    { command: 'chat',   description: 'Chat with an AI model'          },
    { command: 'flows',  description: 'Browse all available tools'     },
    { command: 'status', description: 'View your balance and account'  },
    { command: 'wallet', description: 'Manage connected wallets'       },
    { command: 'cancel', description: 'Cancel current action'          },
    { command: 'help',   description: 'Show available commands'        },
  ]

  const tgStart = await startTelegram({
    bot: tgBot,
    commands: BOT_COMMANDS,
    log,
    webhookUrl: TELEGRAM_WEBHOOK_URL,
    app,
  })

  if (tgStart.mode === 'degraded') {
    log.warn(
      'Telegram DEGRADED — the bot is not receiving updates. HTTP API, web app and background ' +
      'workers are unaffected and continue to serve. Restore by correcting the bot credential or ' +
      'connectivity and restarting the process.',
      { error: tgStart.error, commandsRegistered: tgStart.commandsRegistered }
    )
  }
}

main().catch(err => {
  const fatalLog = makeLogger('startup')
  fatalLog.error('Fatal startup error', { error: String(err) })
  process.exit(1)
})
