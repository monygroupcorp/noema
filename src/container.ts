import type { Collection, MongoClient } from 'mongodb'
import { makeLogger } from './lib/logger.js'
import type { Modus } from './types/modus.js'
import type { Actorum, Cursorum, ActumCompletor as IActumCompletor, Inceptio } from './types/cursus.js'
import type { RunPodClient } from './crystal/RunPodCursor.js'
import type { ActumInceptor as IActumInceptor } from './execution/ActumInceptor.js'
import type { Signorum } from './types/significandi.js'
import type { Redituum } from './types/reditus.js'
import type { Modorum } from './types/modus.js'
import type { AnimaStore } from './types/anima.js'
import type { PersonaStore } from './types/persona.js'
import type { Vestigiorum } from './types/vestigium.js'
import type { ModoStore } from './types/modo.js'
import type { Mandatorum } from './types/mandatum.js'
import type { Corporum } from './types/corpus.js'
import type { Collectionum } from './types/collectio.js'
import type { Datasets } from './types/dataset.js'
import type { MuseSessions } from './types/museSession.js'
import type { Editionum } from './types/editio.js'
import type { Sodalitatum } from './types/sodalitas.js'
import type { Provinciarum } from './types/provincia.js'
import type { Tabularum } from './types/tabula.js'
import type { Testimoniorum, Depositorum, Solutionum, Petitionum } from './types/catena.js'
import type { Scholiorum } from './types/scholium.js'
import type { ColloquiumStore, DictumStore } from './types/colloquium.js'
import type { QuerelaStore } from './types/Querela.js'
import type { MemoriaStore } from './types/anima.js'
import type { Materia, MateriaStore } from './types/materia.js'
import type { HospitiumStore } from './types/hospitium.js'
import type { DeploymentumStore } from './types/deploymentum.js'
import { MongoMateria } from './crystal/MongoMateria.js'
import { MongoHospitium } from './crystal/MongoHospitium.js'
import { MongoActumIndex } from './crystal/MongoActumIndex.js'
import { MongoDeploymentum } from './crystal/MongoDeploymentum.js'
import { Praefectus } from './crystal/Praefectus.js'
import { WarmPodClient } from './crystal/WarmPodClient.js'
import { Conductor } from './crystal/Conductor.js'
import type { Procurator } from './crystal/Procurator.js'
import { TeeProvisioner } from './crystal/TeeProvisioner.js'
import type { TeeProvisionerConfig } from './crystal/TeeProvisioner.js'
import { ConfidentialPodClient } from './crystal/ConfidentialPodClient.js'
import type { ConfidentialPodClientConfig } from './crystal/ConfidentialPodClient.js'
import type { TeePodProvisioner } from './crystal/TeePodProvisioner.js'

import { MongoActorum } from './crystal/MongoActorum.js'
import { MongoModorum } from './crystal/MongoModorum.js'
import { MongoFundamentorum } from './crystal/MongoFundamentorum.js'
import { MongoSignorum } from './crystal/MongoSignorum.js'
import { MongoRedituum } from './crystal/MongoRedituum.js'
import { MongoMerces } from './crystal/MongoMerces.js'
import type { Mercedum } from './types/merces.js'
import { MongoTripwireBandStore } from './crystal/MongoTripwireBand.js'
import type { TripwireBandStore } from './crystal/licenseTripwire.js'
import { MongoAnima } from './crystal/MongoAnima.js'
import { MongoPersona } from './crystal/MongoPersona.js'
import { MongoIssuer } from './crystal/MongoIssuer.js'
import type { IssuerStore } from './types/issuer.js'
import { MongoLegatus } from './crystal/MongoLegatus.js'
import type { LegatusStore } from './types/legatus.js'
import { MongoX402Log } from './crystal/MongoX402Log.js'
import type { X402LogStore } from './types/x402.js'
import { MongoSponsio } from './crystal/MongoSponsio.js'
import type { SponsioStore } from './types/sponsio.js'
import { MongoVestigiorum } from './crystal/MongoVestigiorum.js'
import { MongoModo } from './crystal/MongoModo.js'
import { RunPodCursor } from './crystal/RunPodCursor.js'
import { TesseraCursor } from './crystal/TesseraCursor.js'
import { ApiCursor, httpApiTransport } from './crystal/ApiCursor.js'
import type { ApiProvider } from './crystal/apiProviders.js'
import { LayerCompositeCursor } from './crystal/LayerCompositeCursor.js'
import { JimpLayerCompositeEngine } from './crystal/LayerCompositeEngine.js'
import { FfmpegCursor } from './crystal/FfmpegCursor.js'
import { SpawnFfmpegEngine } from './crystal/FfmpegEngine.js'
import { AitoolkitTrainingCursor, type AitoolkitTrainingCursorDeps } from './crystal/AitoolkitTrainingCursor.js'
import { RemoteAitoolkitTrainingCursor } from './crystal/RemoteAitoolkitTrainingCursor.js'
import { RemoteAitkLauncher, securePodTrainingProvisioner } from './crystal/RemoteAitkLauncher.js'
import { DatasetCaptionCursor } from './crystal/DatasetCaptionCursor.js'
import { MuseDecomposeCursor, MUSE_DECOMPOSE_MINISTERIUM } from './crystal/MuseDecomposeCursor.js'
import { MuseSteerCursor, MUSE_STEER_MINISTERIUM } from './crystal/MuseSteerCursor.js'
import { CaptionPodLauncher } from './crystal/CaptionPodLauncher.js'
import { makeDatasetResolver } from './crystal/datasetManifest.js'
import { SqliteAitkJobStore } from './crystal/AitkJobStore.js'
import { DockerAitkSpawner } from './crystal/AitkSpawner.js'
import { MongoIntella } from './crystal/MongoIntella.js'
import { makeTrainingFinalizer, fsLoraReader, withLocalSamples } from './crystal/trainingFinalizer.js'
import { fsConfigWriter } from './crystal/aitkConfig.js'
import { httpMediaFetcher } from './crystal/MediaFetcher.js'
import { R2Uploader } from './crystal/R2Uploader.js'
import { FeedAdapter } from './crystal/FeedAdapter.js'
import { BucketAdapter } from './crystal/BucketAdapter.js'
import { ArchiveAdapter } from './crystal/ArchiveAdapter.js'
import { GalleryAdapter } from './crystal/GalleryAdapter.js'
import { ArweaveAdapter } from './crystal/ArweaveAdapter.js'
import { ArweaveUploader, IrysTransport, type ArweaveCharger } from './crystal/ArweaveUploader.js'
import { collectioArchiveSource } from './crystal/collectioArchiveSource.js'
import { ModelPublishAdapter, huggingFaceRegistry, civitaiRegistry } from './crystal/ModelPublishAdapter.js'
import { MintAdapter, MarketplaceAdapter } from './crystal/MintAdapter.js'
import { HuggingFaceUploader, HfHttpTransport } from './crystal/HfUploader.js'
import type { PublicationAdapter } from './crystal/PublicationAdapter.js'
import { SimpleCursorum } from './crystal/SimpleCursorum.js'
import { ActumCompletor } from './execution/ActumCompletor.js'
import { ActumInceptor, DEFAULT_EXPIRAT_MS } from './execution/ActumInceptor.js'
import { dispatchInceptio } from './execution/dispatchInceptio.js'
import { MongoMandatum } from './crystal/MongoMandatum.js'
import { MongoCorpus } from './crystal/MongoCorpus.js'
import { MongoCollectio } from './crystal/MongoCollectio.js'
import { MongoDataset } from './crystal/MongoDataset.js'
import { MongoMuseSession } from './crystal/MongoMuseSession.js'
import { MongoEditionum } from './crystal/MongoEditionum.js'
import { MongoSodalitatum } from './crystal/MongoSodalitatum.js'
import { MongoProvinciarum } from './crystal/MongoProvinciarum.js'
import { MongoTabula } from './crystal/MongoTabula.js'
import { MongoTestimoniorum } from './crystal/MongoTestimoniorum.js'
import { MongoDepositum } from './crystal/MongoDepositum.js'
import { MongoSolutio } from './crystal/MongoSolutio.js'
import { MongoPetitio } from './crystal/MongoPetitio.js'
import { MongoScholium } from './crystal/MongoScholium.js'
import { MongoColloquium } from './crystal/MongoColloquium.js'
import { MongoDictum } from './crystal/MongoDictum.js'
import { MongoQuerela } from './crystal/MongoQuerela.js'
import { MongoMemoria } from './crystal/MongoMemoria.js'
import { MongoPartnerRequest } from './crystal/MongoPartnerRequest.js'
import type { PartnerRequestStore } from './types/partnerRequest.js'
import { MongoPartner } from './crystal/MongoPartner.js'
import type { PartnerStore } from './types/partner.js'
import { CollectioCursor } from './crystal/CollectioCursor.js'
import { CompositusCursor } from './crystal/CompositusCursor.js'
import { ArcanumIssuer } from './ledger/ArcanumIssuer.js'
import { MongoArcanumTree } from './arcanum/ArcanumTree.js'
import { ArcanumVerifier, MongoNullifierStore, type VerifyFn } from './arcanum/ArcanumVerifier.js'
import { MongoBursarium } from './arcanum/MongoBursarium.js'
import { MongoCeremoniaStore } from './arcanum/CeremoniaStore.js'

/**
 * The pod-rail slice of the RunPod client, restated structurally because `config.runpodClient` is
 * typed as the narrower inference client. It must stay in step with `SecurePodClient.
 * launchTrainingPod` — the hooks are how the run gets its handle stamped before any pod-side work
 * starts, and how a background launch failure reaches the run.
 */
type TrainingPodClient = {
  launchTrainingPod(opts: {
    image: string
    env: Record<string, string>
    setup: string[]
    onPodId?: (podId: string) => Promise<void>
    onLaunchFailed?: (err: unknown) => Promise<void>
  }): Promise<{ podId: string }>
}

export interface Ring {
  actorum: Actorum
  modorum: Modorum
  signorum: Signorum
  /** USD revenue book (ADR-0013) — the second ledger, distinct from `signorum` (credits). */
  redituum: Redituum
  /** Payee-payout book (ADR-0013 §4c) — money OUT, per-payee, gated at the $600 line. */
  mercedum: Mercedum
  /** Conditional-license revenue tripwire's persisted band (edge-triggered across restarts). */
  tripwireBand: TripwireBandStore
  animae: AnimaStore
  personae: PersonaStore
  /** Trusted-issuer registry (federated JWKS SSO) — see types/issuer.ts. */
  issuers: IssuerStore
  /** Agent-sidecar registry (ERC-8004 CAMEL agents) — see types/legatus.ts. */
  legati: LegatusStore
  /** x402 payment audit trail (replay-protected) — see types/x402.ts. */
  x402Log: X402LogStore
  /** Sponsorship pledges (the generalized faucet) — see types/sponsio.ts. */
  sponsiones: SponsioStore
  vestigiorum: Vestigiorum
  modos: ModoStore
  mandatores: Mandatorum
  corpora: Corporum
  collectiones: Collectionum
  datasets: Datasets
  /** Muse session store — a dataset break-off with its own floor and piece ledger. */
  museSessions: MuseSessions
  /** Publication records (Editio) — backs the publishing spine + feed. */
  editiones: Editionum
  /** Registered publication adapters (FeedAdapter always; BucketAdapter when R2 is configured). */
  publicationAdapters: PublicationAdapter[]
  sodalitates: Sodalitatum
  /** Project store (Provincia) — account-scoped workspace lenses + holdings. */
  provinciae: Provinciarum
  tabulae: Tabularum
  testimonia: Testimoniorum
  deposita: Depositorum
  solutiones: Solutionum
  petitiones: Petitionum
  scholia: Scholiorum
  colloquia: ColloquiumStore
  dicta: DictumStore
  querelae: QuerelaStore
  memoriae: MemoriaStore
  /** B2B partner program intake queue — see types/partnerRequest.ts. */
  partnerRequests: PartnerRequestStore
  /** Approved B2B partners (an ordinary Anima that has been approved) — see types/partner.ts. */
  partners: PartnerStore
  fundamentorum: import('./types/fundamentum.js').Fundamentorum
  cursorum: Cursorum
  completor: IActumCompletor
  inceptor: IActumInceptor
  arcanumIssuer: ArcanumIssuer
  arcanumTree: MongoArcanumTree
  arcanumVerifier: ArcanumVerifier
  bursarium: MongoBursarium
  /** Arcanum trusted-setup ceremony coordinator (status + contributor slots). */
  ceremonia: MongoCeremoniaStore
  materiae: MateriaStore
  /** Identity-bearing hosting metadata (host + admins) — see types/hospitium.ts. */
  hospitia: HospitiumStore
  /** Per-anima dispatch index — populates /status YOUR GENS without touching
   *  the modo/actum privacy chain. See types/actumIndex.ts. */
  actumIndex: import('./types/actumIndex.js').ActumIndexStore
  deployments: DeploymentumStore
  collectioCursor: CollectioCursor
  /** Compositus chain orchestrator (ADR-0008) — runs a modus-made-of-modi, threading
   *  each step's exitus into the next step's aditus. Sibling of collectioCursor. */
  compositusCursor: CompositusCursor
  /** Studio-lifecycle anchor (ADR-0006) — present only when a Procurator
   *  (provisionStudio-capable pod client) is wired. Composes Materia + Hospitium
   *  + Modo + budget tessera into one verb both adapters call. */
  conductor?: Conductor
  /** TEE pod provisioner — present when TEE_IMAGE_ID + RUNPOD_API_KEY are configured. */
  teeProvisioner?: TeePodProvisioner
}

export interface ContainerConfig {
  /** Atlas URI or local connection string */
  mongoUri: string
  /** MongoDB database name — never 'noema' or 'noemaplane' in tests */
  dbName: string
  /**
   * Compile a Modus + aditus into the RunPod job input payload.
   * Bridges to the Fractal Tool Compiler. Injected to avoid circular deps.
   */
  compile: (modus: Modus, aditus: Record<string, unknown>, pinnedModels?: import('./types/actum.js').ModelRef[], ownerKey?: string) => Promise<{ hash: string; input: unknown }>
  /**
   * RunPod SECURE pod client — provisions a GPU pod, runs the workflow via SSH,
   * and POSTs the result to webhookUrl. Absent: RunPod tools will throw at run().
   */
  runpodClient?: RunPodClient
  /**
   * Where the runner POSTs the completion webhook.
   * Normal deployment: our server (e.g. https://api.noema.io/webhooks/runpod)
   * TEE deployment: the TEE pod's local endpoint.
   * This is the ONLY config that differs between deployment contexts.
   */
  runpodWebhookUrl?: string
  /** R2 config for warm-pod jobs so they upload to durable storage (not pod-proxy URLs). */
  runpodR2?: import('./crystal/SecurePodClient.js').R2Config
  /**
   * Private generation (noema-347): the DEDICATED private-outputs bucket — deliberately no
   * `publicUrl`, so nothing written there is publicly reachable and a presigned GET is the only
   * handle. Absent → private generation is dark on this deployment (the preference cannot be
   * enabled, and every run dispatches public). It is NEVER a fallback for `runpodR2`.
   */
  privateOutputsR2?: import('./crystal/SecurePodClient.js').R2Config
  /**
   * Account preferences, read at DISPATCH to resolve the caller's `privateOutputs` choice for a
   * run. Passed through to RunPodCursor, which is the one dispatch site holding the run's owner.
   */
  consuetudinum?: import('./types/consuetudo.js').Consuetudinum
  /**
   * Local ai-toolkit training (build #5, ministerium 'aitoolkit'). Present only on a box
   * with a GPU + the `stationthis-klein` image + a host-mounted `aitk_db.db`. Registers the
   * `AitoolkitTrainingCursor`; absent in prod (no local trainer) → no registration.
   */
  aitoolkit?: {
    /** Path to the host-mounted ai-toolkit SQLite DB (`aitk_db.db`). */
    dbPath: string
    /** The ai-toolkit Docker image (e.g. 'stationthis-klein:1'). */
    image: string
    /** Bind mounts for the container (ai-toolkit clone, dataset, HF cache). */
    mounts?: import('./crystal/AitkSpawner.js').AitkMount[]
    /** `--shm-size` for the container (PyTorch DataLoader) — default '8g'. */
    shmSize?: string
    /** Overall poll cap (ms) — a hung run trips this and fails. */
    timeoutMs?: number
    /**
     * Host path of ai-toolkit's output dir (a trained run leaves `<outputDir>/<jobId>/
     * <jobId>.safetensors`). Present (with `runpodR2`) → a completed run hosts the LoRA
     * in R2 + registers it as a private Intella (training finality, build #5b). Absent →
     * the run still trains but the exitus stays `{ trained, steps }` (headless).
     */
    outputDir?: string
    /**
     * Host path of the ai-toolkit `config/` dir (under the mounted clone). Present → the
     * modus SYNTHESISES each run's training yaml here from {dataset, baseModel, steps, …}
     * (users never author a config). Absent → only a pre-built `configPath` aditus runs.
     */
    configDir?: string
  }
  /**
   * Remote ai-toolkit training (Slice E, ministerium 'aitoolkit') — the PROD path: training runs
   * on a provisioned, billed SECURE pod instead of a local GPU. Present (+ `runpodClient` with
   * `launchTrainingPod`, `runpodR2`, `runpodWebhookUrl`) → registers `RemoteAitoolkitTrainingCursor`.
   * Mutually exclusive with the local `aitoolkit` block (a box runs one or the other; the modus is
   * identical). The completion-side finality (urlLoraReader → re-host + Intella) is the webhook's
   * `resolveExitus` seam, wired in index.ts.
   */
  aitoolkitRemote?: {
    /** Pod base image — a stock RunPod image with torch ≥2.9 (default `DEFAULT_AITK_IMAGE`);
     *  ai-toolkit is bootstrapped onto it over SSH (no custom image to maintain). */
    image?: string
    /** ai-toolkit commit to clone on the pod (default the verified `DEFAULT_AITK_REF`). */
    aitkRef?: string
    /** Our `/runner/status` sink URL — the pod POSTs its Progressus here. */
    statusUrl: string
    /** Reservation cap in pod-seconds (settled to actual at completion) — default 7200 (2h). */
    maxTrainingSeconds?: number
    /** Reservation cap in pod-seconds for a batch CAPTION pass (settled to actual at completion)
     *  — default `DEFAULT_MAX_CAPTION_SECONDS` (30m), far below the training cap. */
    maxCaptionSeconds?: number
  }
  /** Warm-window TTL (ms) passed to warm-pod jobs — default 60_000. */
  runpodWarmTtlMs?: number
  /** Override the warm-pod client factory (dev fake mode swaps in FakeWarmPodClient). */
  warmFactory?: (materia: Materia, materiae: MateriaStore) => RunPodClient
  /** Admission gate for a gen reusing a warm pod — install any models it needs that aren't on the
   *  pod yet (awaiting in-flight live-apply installs). Wired to the shared InstallCoordinator. */
  admitWarm?: (materia: Materia, models: Array<{ id?: string }>) => Promise<void>
  /** Install models live onto a just-leased studio pod (the InstallCoordinator seam) — handed to
   *  the `Conductor` so `conducere` installs the loadout after park. Wired to the same coordinator. */
  installLive?: (materia: Materia, intellaIds: string[]) => Promise<unknown>
  /** BYO-secrets Phase C: mint the per-job pod credential (bound to `JOB_TOKEN_SECRET`) so a run's
   *  pod can fetch gated private weights through our proxy. Absent → no token minted. */
  mintJobToken?: (claims: { actumId: string; ownerKey: string; exp: number }) => string
  /** Collection name for acta — default 'acta' */
  actaCollection?: string
  /** Collection name for modi — default 'modi' */
  modiCollection?: string
  /** Collection name for signa — default 'signa' */
  signaCollection?: string
  reditusCollection?: string
  /** Collection name for the license-tripwire band state — default 'license_tripwire' */
  tripwireBandCollection?: string
  /** Collection name for animae — default 'animae' */
  animaeCollection?: string
  /** Collection name for personae — default 'personae' */
  personaeCollection?: string
  /** Collection name for the trusted-issuer registry — default 'trusted_issuers' */
  issuersCollection?: string
  /** Collection name for the agent-sidecar registry — default 'legati' */
  legatiCollection?: string
  /** Collection name for the x402 payment log — default 'x402_payment_log' */
  x402LogCollection?: string
  /** Collection name for the payee-payout book — default 'mercedes' */
  mercesCollection?: string
  /** Collection name for sponsorship pledges — default 'sponsiones' */
  sponsionesCollection?: string
  /** Collection name for vestigia — default 'vestigia' */
  vestigiaCollection?: string
  /** Collection name for modos — default 'modos' */
  modosCollection?: string
  mandatoresCollection?: string
  corporaCollection?: string
  collectionesCollection?: string
  /** Collection name for datasets — default 'datasets' */
  datasetsCollection?: string
  /** Collection name for Muse sessions — default 'museSessions' */
  museSessionsCollection?: string
  editionesCollection?: string
  /** Our HuggingFace org for `custody:'ours'` model publishes (default 'ms2stationthis'). */
  huggingFaceOrg?: string
  /** HF_TOKEN — present → the HF registry gets a real LFS uploader; absent → projection-only. */
  huggingFaceToken?: string
  /** ARWEAVE_PRIVATE_KEY — funding wallet for the Irys bundler. Present → the `arweave`
   *  graduation destination is registered (LIVE-UNVERIFIED); absent → not offered. */
  arweavePrivateKey?: string
  /** Base URL the MarketplaceAdapter projects listing handles under (default 'https://noema.art/market'). */
  marketplaceBaseUrl?: string
  sodalitatesCollection?: string
  provinciaeCollection?: string
  tabulaeCollection?: string
  testimoniaCollection?: string
  depositaCollection?: string
  solutionesCollection?: string
  petitionesCollection?: string
  scholiaCollection?: string
  colloquiaCollection?: string
  dictaCollection?: string
  querelaCollection?: string
  memoriaeCollection?: string
  partnerRequestsCollection?: string
  partnersCollection?: string
  /** Collection name for materiae — default 'materiae' */
  materiaCollection?: string
  /** Collection name for hospitia (identity-bearing hosting metadata) — default 'hospitia' */
  hospitiaCollection?: string
  /** Collection name for the per-anima dispatch index — default 'actum_index' */
  actumIndexCollection?: string
  /** Collection name for deployments — default 'deployments' */
  deploymentsCollection?: string
  /** Collection name for arcanum Merkle tree leaves — default 'arcanum_leaves' */
  arcanumLeavesCollection?: string
  /** Collection name for spent nullifiers — default 'arcanum_nullifiers' */
  arcanumNullifiersCollection?: string
  /** Collection name for anonymous credit purses — default 'bursarium' */
  bursariumCollection?: string
  /** Collection name for the ceremony status doc — default 'caeremonia' */
  caeremoniaCollection?: string
  /** Collection name for ceremony contributor-slot requests — default 'caeremonia_slots' */
  caeremoniaSlotsCollection?: string
  /**
   * Groth16 verify function — inject makeSnarkjsVerifier(verificationKey) after running
   * arcanum-trusted-setup.sh. Absent: all ZK spend proofs will throw at verify().
   */
  arcanumVerifyFn?: VerifyFn
  /**
   * Pre-created MateriaStore — if provided, used directly instead of creating a new MongoMateria.
   * Pass this when the same store instance needs to be shared with SecurePodClient (keep-warm mode).
   */
  materiae?: MateriaStore
  /**
   * Pre-created HospitiumStore — share-with-test injection point. When absent, the
   * container creates a MongoHospitium against `hospitiaCollection`.
   */
  hospitia?: HospitiumStore
  /** Pre-built per-anima dispatch index store. Container builds a Mongo-backed
   *  one against `actumIndexCollection` when this is absent. */
  actumIndex?: import('./types/actumIndex.js').ActumIndexStore
  /**
   * The event bus. The completor emits `execution_spend`/`royalty_fired` on it
   * directly, so every completion rail routes royalty, host cut and platform skim
   * identically. Absent → no ledger hooks fire at all, which is the right shape for
   * a slim deployment or a test that has no ledger.
   */
  nexus?: import('./types/nexus.js').Nexus
  /**
   * Terminate a RunPod pod by ID. Injected so ActumCompletor can kill orphaned pods when
   * failing an actum (boot recovery, manual expiry). Absent: pods are left running on fail().
   */
  terminatePod?: (podId: string) => Promise<void>
  /**
   * Embed function for semantic search — inject the OpenAI/local model.
   * Absent: index() and search() will throw; create/findById/forIdentity still work.
   */
  embed?: (text: string) => Promise<number[]>
  embedImage?: (imageUrl: string) => Promise<number[]>
  /**
   * Hosted-API inference providers (OpenAI, OpenRouter, …). Each entry is a
   * declarative descriptor + its resolved bearer key. One ApiCursor is
   * registered per provider under `provider.id`. Absent providers → their tools
   * throw at resolve(). Adding a provider is a descriptor + env key — no code.
   */
  apiProviders?: Array<{ provider: ApiProvider; apiKey: string }>
  /** TEE runner pod provisioner config — if present, POST /v1/sessions/tee boots real pods. */
  teeProvisioner?: TeeProvisionerConfig
  /** Confidential-CVM backend (Azure NCC H100) — the hardware-sealed tier. Takes
   *  precedence over teeProvisioner. */
  confidentialPod?: ConfidentialPodClientConfig
}

const log = makeLogger('container')

export function createContainer(mongo: MongoClient, config: ContainerConfig): Ring {
  const db = mongo.db(config.dbName)

  // ── Phase 1 + 2: real ─────────────────────────────────────────────────────
  const col: Collection = db.collection(config.actaCollection ?? 'acta')
  const actorum = new MongoActorum(col)

  const modiCol: Collection = db.collection(config.modiCollection ?? 'modi')
  const modorum = new MongoModorum(modiCol)

  // Compute-substrate registry (ADR-0005) — resolves a flow's referenced Fundamentum
  // for warm-pod image matching (the image moved off the flow onto its fundament).
  const fundamentorum = new MongoFundamentorum(db.collection('fundamenta'))

  const signaCol: Collection = db.collection(config.signaCollection ?? 'signa')
  const signorum = new MongoSignorum(signaCol, mongo)

  // USD revenue book (ADR-0013) — the second ledger, distinct from signa (credits). Indexes
  // (incl. the unique partial index on depositumId that guarantees idempotent deposit booking)
  // are created centrally in ensureIndexes(). See src/types/reditus.ts.
  const redituum = new MongoRedituum(db.collection(config.reditusCollection ?? 'reditus'))

  // Payee-payout book (ADR-0013 §4c) — money OUT to a person (agent cut / royalty / referral),
  // per-payee/per-year, gated at the $600 reporting line. Indexes in ensureIndexes().
  const mercedum = new MongoMerces(db.collection(config.mercesCollection ?? 'mercedes'))

  // Conditional-license revenue tripwire — the single-doc persisted band (ADR-0012/0013 §5). See
  // src/crystal/licenseTripwire.ts; the evaluator/scheduler is wired in index.ts.
  const tripwireBand = new MongoTripwireBandStore(db.collection(config.tripwireBandCollection ?? 'license_tripwire'))

  const animaeCol: Collection = db.collection(config.animaeCollection ?? 'animae')
  const animae = new MongoAnima(animaeCol)

  const personaeCol: Collection = db.collection(config.personaeCollection ?? 'personae')
  const personae = new MongoPersona(personaeCol)

  // Trusted-issuer registry (collection matches the legacy JS `trusted_issuers`).
  const issuers = new MongoIssuer(db.collection(config.issuersCollection ?? 'trusted_issuers'))

  // Agent-sidecar registry (ERC-8004 CAMEL agents).
  const legati = new MongoLegatus(db.collection(config.legatiCollection ?? 'legati'))

  // x402 payment audit trail (replay-protected by a unique signatureHash index).
  const x402Log = new MongoX402Log(db.collection(config.x402LogCollection ?? 'x402_payment_log'))

  // Sponsorship pledges (the generalized faucet).
  const sponsiones = new MongoSponsio(db.collection(config.sponsionesCollection ?? 'sponsiones'))

  const vestigiaCol: Collection = db.collection(config.vestigiaCollection ?? 'vestigia')
  const vestigiorum = new MongoVestigiorum(vestigiaCol, config.embed, config.embedImage)

  const modosCol: Collection = db.collection(config.modosCollection ?? 'modos')
  const modos = new MongoModo(modosCol)

  const mandatores = new MongoMandatum(db.collection(config.mandatoresCollection ?? 'mandatores'))
  const corpora = new MongoCorpus(db.collection(config.corporaCollection ?? 'corpora'))
  const collectiones = new MongoCollectio(db.collection(config.collectionesCollection ?? 'collectiones'))
  const datasets = new MongoDataset(db.collection(config.datasetsCollection ?? 'datasets'))
  const museSessions = new MongoMuseSession(db.collection(config.museSessionsCollection ?? 'museSessions'))
  const editiones = new MongoEditionum(db.collection(config.editionesCollection ?? 'editiones'))
  const sodalitates = new MongoSodalitatum(db.collection(config.sodalitatesCollection ?? 'sodalitates'))
  const provinciae = new MongoProvinciarum(db.collection(config.provinciaeCollection ?? 'provinciae'))
  const tabulae = new MongoTabula(db.collection(config.tabulaeCollection ?? 'tabulae'))
  const testimonia = new MongoTestimoniorum(db.collection(config.testimoniaCollection ?? 'testimonia'))
  const deposita = new MongoDepositum(db.collection(config.depositaCollection ?? 'deposita'))
  const solutiones = new MongoSolutio(db.collection(config.solutionesCollection ?? 'solutiones'))
  const petitiones = new MongoPetitio(db.collection(config.petitionesCollection ?? 'petitiones'))
  const scholia = new MongoScholium(db.collection(config.scholiaCollection ?? 'scholia'))
  const colloquia = new MongoColloquium(db.collection(config.colloquiaCollection ?? 'colloquia'))
  const dicta = new MongoDictum(db.collection(config.dictaCollection ?? 'dicta'))
  const querelae = new MongoQuerela(db.collection(config.querelaCollection ?? 'querelae'))
  const memoriae = new MongoMemoria(db.collection(config.memoriaeCollection ?? 'memoriae'))
  const partnerRequests = new MongoPartnerRequest(db.collection(config.partnerRequestsCollection ?? 'partnerRequests'))
  const partners = new MongoPartner(db.collection(config.partnersCollection ?? 'partners'))

  const materiaCol: Collection = db.collection(config.materiaCollection ?? 'materiae')
  const materiae = config.materiae ?? new MongoMateria(materiaCol)
  const praefectus = new Praefectus(materiae)

  const hospitiaCol: Collection = db.collection(config.hospitiaCollection ?? 'hospitia')
  const hospitia = config.hospitia ?? new MongoHospitium(hospitiaCol)

  const actumIndexCol: Collection = db.collection(config.actumIndexCollection ?? 'actum_index')
  const actumIndex = config.actumIndex ?? new MongoActumIndex(actumIndexCol)

  const deploymentsCol: Collection = db.collection(config.deploymentsCollection ?? 'deployments')
  const deployments = new MongoDeploymentum(deploymentsCol)

  // ── Execution rail ─────────────────────────────────────────────────────────
  const cursorum = new SimpleCursorum()
  let conductor: Conductor | undefined

  // The warm-pod match key = the flow's substrate image, resolved from its referenced
  // Fundamentum (ADR-0005 moved image/runtime off the flow onto the fundament).
  const imageRefOf = async (modus: Modus): Promise<string | undefined> => {
    const ref = modus as { fundamentumId?: string; fundamentumVersio?: string }
    if (!ref.fundamentumId) return undefined
    const f = await fundamentorum.find(ref.fundamentumId, ref.fundamentumVersio)
    return f?.imageId && f.imageVersion ? `${f.imageId}:${f.imageVersion}` : undefined
  }

  if (config.runpodClient && config.runpodWebhookUrl) {
    const runpodCursor = new RunPodCursor(
      config.runpodClient,
      config.compile,
      modorum,
      actorum,
      {
        webhookUrl: config.runpodWebhookUrl,
        praefectus,
        warmFactory: config.warmFactory
          ? (m) => config.warmFactory!(m, materiae)
          : (m) => new WarmPodClient(m, materiae, undefined, {
              r2: config.runpodR2,
              warmTtlMs: config.runpodWarmTtlMs,
            }),
        imageRefOf,
        // Studio pinning: a studioId-targeted run (actum.modoId) routes to the session's
        // bound pod, atomically claimed — deterministic even with many warm pods per image.
        studioPodFor: async (modoId: string) => {
          const modo = await modos.findById(modoId).catch(() => null)
          if (!modo?.materiamId) return null
          return materiae.findWarm({ materiaId: modo.materiamId })
        },
        ...(config.admitWarm ? { admitWarm: config.admitWarm } : {}),
        ...(config.mintJobToken ? { mintJobToken: config.mintJobToken } : {}),
        // Private generation (noema-347): both are required for a run to dispatch private — the
        // bucket to write to, and the preferences to read the caller's choice from.
        ...(config.privateOutputsR2 ? { privateOutputsR2: config.privateOutputsR2 } : {}),
        ...(config.consuetudinum ? { consuetudinum: config.consuetudinum } : {}),
        deployments,
        hospitia,
      },
    )
    const tesseraCursor = new TesseraCursor(runpodCursor, modos, signorum)
    cursorum.register('runpod', runpodCursor)
    cursorum.register('tessera', tesseraCursor)

    // Studio-lifecycle anchor (ADR-0006). The pod client doubles as the Procurator
    // when it can provision studios (SecurePodClient / FakeRunPodClient); the
    // TesseraCursor is the Modo opener. Absent provisionStudio → no Conductor.
    const procurator = config.runpodClient && 'provisionStudio' in config.runpodClient
      ? (config.runpodClient as unknown as Procurator)
      : undefined
    if (procurator) {
      conductor = new Conductor({
        procurator,
        opener: tesseraCursor,
        materiae,
        modos,
        hospitia,
        ...(config.installLive ? { installLive: config.installLive } : {}),
        ...(config.terminatePod ? { terminate: config.terminatePod } : {}),
      })
    }
  }

  // Hosted-API inference: ONE cursor class, one registration per provider
  // descriptor. `ministerium: 'openai'` (ChatGPT/DALL·E/gpt-image-edit) and
  // `ministerium: 'openrouter'` resolve here with no per-provider code.
  for (const { provider, apiKey } of config.apiProviders ?? []) {
    cursorum.register(provider.id, new ApiCursor(provider, {
      apiKey,
      http: httpApiTransport,
      mediaFetcher: httpMediaFetcher,
    }))
  }

  // Muse decompose (`modus.dataset-decompose`) — the same hosted-API chat rail, its OWN
  // ministerium. `Cursorum` is a flat Map<ministerium, Cursor> whose `register` is a bare set,
  // so this must never be registered under a provider id: that key belongs to the ApiCursor
  // above and a second registration there would take over every chat, image and image-edit
  // dispatch. Registered unconditionally so a deployment with no chat key refuses a decompose
  // with the cursor's own named error instead of an unresolvable ministerium; it reuses the
  // `datasets` store constructed above rather than opening a second one.
  //
  // A decompose dispatches ASYNC and finishes off-request, and no webhook comes back for it
  // — the pass has no pod — so the cursor settles its own run. That is what `actorum` and
  // `completor` are here for. `completor` is a lazy closure for the same reason the pod
  // rail's launch-failure sink below is one: it is constructed further down this function,
  // and the accessor is called at the END of a pass, long after wiring has finished.
  cursorum.register(MUSE_DECOMPOSE_MINISTERIUM, new MuseDecomposeCursor({
    datasets,
    providers: (config.apiProviders ?? []).map(({ provider, apiKey }) => ({ provider, apiKey })),
    actorum,
    completor: () => completor,
  }))

  // Muse steer (`modus.muse-steer`) — the same chat rail again, and again its OWN ministerium,
  // never 'musegarden' (that key is the decomposer's) and never a provider id. Registered
  // unconditionally for the same reason as the decomposer: a deployment with no chat key refuses
  // a steer with the cursor's own named error instead of an unresolvable ministerium.
  //
  // It takes NO STORE. A steer reads a floor passed inline in the aditus and returns a proposal;
  // it holds no session store and can write nothing. That is the property the whole feature rests
  // on — the floor moves only when the user confirms the proposal through the floor routes.
  cursorum.register(MUSE_STEER_MINISTERIUM, new MuseSteerCursor({
    providers: (config.apiProviders ?? []).map(({ provider, apiKey }) => ({ provider, apiKey })),
  }))

  // Publication adapters (spec §5b): feed + model registries need nothing; the
  // bucket adapter needs R2 (custody=ours hosting) so it is gated on config below.
  // Model registries (HuggingFace/Civitai, publishing #3): our HF org hosts a
  // custody:'ours' publish; Civitai has no org → requires custody:'theirs' (BYO).
  // Collection/mint (publishing #5): the mint + marketplace adapters freeze a drop's
  // canon into a deterministic content-addressed handle. Pure projectors (no chain tx
  // / venue API yet — placeholder §10), so they need no deps and are always available.
  // Real HF weight upload (LFS) when a token is configured; else projection-only.
  // Runs inside the PublicationWorker's settle, so a multi-GB upload is durable.
  const hfUploader = config.huggingFaceToken
    ? new HuggingFaceUploader({ transport: new HfHttpTransport({ token: config.huggingFaceToken }), fetcher: httpMediaFetcher })
    : undefined
  const publicationAdapters: PublicationAdapter[] = [
    new FeedAdapter(),
    new ModelPublishAdapter(huggingFaceRegistry(config.huggingFaceOrg ?? 'ms2stationthis', hfUploader)),
    new ModelPublishAdapter(civitaiRegistry()),
    new MintAdapter(),
    new MarketplaceAdapter({ base: config.marketplaceBaseUrl ?? 'https://noema.art/market' }),
  ]

  // Shared piece-enumeration for the collection-export destinations (archive ZIP,
  // gallery hosting, Arweave graduation) — closes over the stores, needs no R2.
  const archiveSource = collectioArchiveSource({ collectiones, actorum })

  // Arweave graduation (editio-hosting → permanence): push a collection's pieces to
  // Arweave via the Irys bundler. Gated on a funding key (secret) — NOEMA-side, since
  // NOESIS is static/secretless. LIVE-UNVERIFIED until a funded wallet is set up.
  if (config.arweavePrivateKey) {
    // PLACEHOLDER(publishing#6-arweave): metering is balance-check-only — it does NOT
    // debit. Wire a real bytes→credits price/markup + signa settlement before funding.
    const arweaveCharger: ArweaveCharger = {
      async charge(by, bytes) {
        const bal = await signorum.balance(by)
        log.warn('arweave charge is a PLACEHOLDER — verifying balance, not debiting', { bytes, balance: bal.toString() })
        if (bal <= 0n) throw new Error('insufficient credits for Arweave graduation')
      },
    }
    const uploader = new ArweaveUploader({
      transport: new IrysTransport({ privateKey: config.arweavePrivateKey }),
      fetcher: httpMediaFetcher,
      charger: arweaveCharger,
    })
    publicationAdapters.push(new ArweaveAdapter({ uploader, source: archiveSource }))
  }

  // Host-side deterministic processing runtimes (spec §4a). They produce bytes
  // ON the host, so they need R2 to host the result — gate registration on it.
  if (config.runpodR2) {
    const uploader = new R2Uploader(config.runpodR2)
    // The private-outputs store for host-side writers — a SEPARATE bucket, never a view of the
    // public one. Absent → a private run refuses host-side compositing rather than writing public.
    const privateUploader = config.privateOutputsR2 ? new R2Uploader(config.privateOutputsR2) : undefined
    cursorum.register('composite', new LayerCompositeCursor({
      engine: new JimpLayerCompositeEngine(),
      fetcher: httpMediaFetcher,
      uploader,
      ...(privateUploader ? { privateUploader } : {}),
    }))
    cursorum.register('ffmpeg', new FfmpegCursor({
      engine: new SpawnFfmpegEngine(),
      fetcher: httpMediaFetcher,
      uploader,
      ...(privateUploader ? { privateUploader } : {}),
    }))
    // Bucket custody (publishing #2): re-hosts an artifact's media to R2.
    publicationAdapters.push(new BucketAdapter({ fetcher: httpMediaFetcher, store: uploader }))
    // Archive (editio-export): bundle a collection's approved pieces into a ZIP in
    // OUR bucket — the sovereign-download destination. Private/custody-ours, so it
    // never touches the moderation gate.
    publicationAdapters.push(new ArchiveAdapter({ fetcher: httpMediaFetcher, store: uploader, source: archiveSource }))
    // Gallery (editio-hosting): host a collection's approved pieces as PUBLIC ERC-721
    // tokenURIs — the temporary bridge NOESIS (static/secretless) leans on. Public
    // surface → the moderation gate applies (fail-closed until a CSAM scanner lands).
    publicationAdapters.push(new GalleryAdapter({ fetcher: httpMediaFetcher, store: uploader, source: archiveSource }))
  }

  // Local ai-toolkit training (build #5) — only where a GPU + image + host-mounted DB exist.
  if (config.aitoolkit) {
    const aitkDeps: AitoolkitTrainingCursorDeps = {
      store: new SqliteAitkJobStore(config.aitoolkit.dbPath),
      spawner: new DockerAitkSpawner(),
      image: config.aitoolkit.image,
      ...(config.aitoolkit.mounts ? { mounts: config.aitoolkit.mounts } : {}),
      ...(config.aitoolkit.shmSize ? { shmSize: config.aitoolkit.shmSize } : {}),
      ...(config.aitoolkit.timeoutMs !== undefined ? { timeoutMs: config.aitoolkit.timeoutMs } : {}),
      ...(config.aitoolkit.configDir ? { writeConfig: fsConfigWriter(config.aitoolkit.configDir) } : {}),
    }
    // Training finality (build #5b): a completed run hosts its LoRA in R2 + registers it
    // as a private Intella — only where both an output dir (to read it) and R2 (to host it) exist.
    if (config.aitoolkit.outputDir && config.runpodR2) {
      const store = new R2Uploader(config.runpodR2)
      const finalize = makeTrainingFinalizer({
        reader: fsLoraReader(config.aitoolkit.outputDir),
        store,
        intellae: new MongoIntella(db.collection('intellae')),
      })
      // Local runs leave their preview samples on disk — collect + host them so the Intella + a
      // later HF publish carry previews, same as the remote pod path (aitktrainer.py).
      aitkDeps.resolveOutput = withLocalSamples(finalize, { outputDir: config.aitoolkit.outputDir, store })
    }
    cursorum.register('aitoolkit', new AitoolkitTrainingCursor(aitkDeps))
  } else if (
    config.aitoolkitRemote && config.runpodClient && config.runpodR2 && config.runpodWebhookUrl &&
    'launchTrainingPod' in config.runpodClient
  ) {
    // Remote ai-toolkit training (Slice E) — the prod path. Reuses the SAME finalizer at the
    // completion webhook (resolveExitus, index.ts); here we just dispatch onto a billed pod.

    // Failure sink for the pod rail. A launch resolves at the pod id and finishes SSH + bootstrap
    // in the background, so a failure there has no caller to reach — this is how it reaches the
    // run. Deliberately a lazy closure: `completor` is constructed below (this call happens minutes
    // into a run, long after), and `fail` takes the record rather than an id, so the lookup here is
    // required rather than incidental. `fail` re-reads the actum and no-ops on one already
    // finished, so this racing the deadline reaper cannot double-release — no second guard.
    const onLaunchFailed = async (actumId: string, err: unknown): Promise<void> => {
      const a = await actorum.findById(actumId)
      if (a) await completor.fail(a, String(err))
    }

    const launcher = new RemoteAitkLauncher({
      provisioner: securePodTrainingProvisioner(
        config.runpodClient as unknown as TrainingPodClient,
      ),
      onLaunchFailed,
      resolver: makeDatasetResolver({ corpora }),
      ...(config.aitoolkitRemote.image ? { image: config.aitoolkitRemote.image } : {}),
      ...(config.aitoolkitRemote.aitkRef ? { aitkRef: config.aitoolkitRemote.aitkRef } : {}),
      r2: config.runpodR2,
      statusUrl: config.aitoolkitRemote.statusUrl,
      webhookUrl: config.runpodWebhookUrl,
    })
    cursorum.register('aitoolkit', new RemoteAitoolkitTrainingCursor({
      launcher,
      actorum,
      ...(config.aitoolkitRemote.maxTrainingSeconds !== undefined ? { maxTrainingSeconds: config.aitoolkitRemote.maxTrainingSeconds } : {}),
    }))

    // Batch dataset captioning — the same pod rail, its OWN ministerium. `Cursorum` is a flat
    // Map<ministerium, Cursor> whose `register` is a bare set, so this must never be registered
    // under 'aitoolkit': that key belongs to training and a second registration there would take
    // over every training dispatch. It reuses the `datasets` store constructed above rather than
    // opening a second one, and rides the same provisioner, image, R2, status and webhook config.
    cursorum.register('aitkcaption', new DatasetCaptionCursor({
      launcher: new CaptionPodLauncher({
        provisioner: securePodTrainingProvisioner(
          config.runpodClient as unknown as TrainingPodClient,
        ),
        onLaunchFailed,
        datasets,
        ...(config.aitoolkitRemote.image ? { image: config.aitoolkitRemote.image } : {}),
        ...(config.aitoolkitRemote.aitkRef ? { aitkRef: config.aitoolkitRemote.aitkRef } : {}),
        r2: config.runpodR2,
        statusUrl: config.aitoolkitRemote.statusUrl,
        webhookUrl: config.runpodWebhookUrl,
      }),
      actorum,
      // The same `datasets` store the launcher reads, wired to the CURSOR as well: `reserve()`
      // is where a caption pass that has nothing left to caption is refused, and it can only
      // know that by reading the captionset it was asked to extend. Without this dep the
      // refusal would exist only in tests.
      datasets,
      ...(config.aitoolkitRemote.maxCaptionSeconds !== undefined ? { maxCaptionSeconds: config.aitoolkitRemote.maxCaptionSeconds } : {}),
    }))
  }

  const completor = new ActumCompletor({
    acta: actorum,
    signorum,
    terminatePod: config.terminatePod,
    vestigiorum,
    deployments,
    intellarum: new MongoIntella(db.collection('intellae')),
    // Session spend accrues here, from the settled amount — the sole accrual site.
    modos,
    // Royalty, host cut and platform skim are emitted here too, for the same reason:
    // every rail funnels through complete(), so this is the only place the payout can
    // be stated once and hold for all of them.
    nexus: config.nexus,
    modorum,
    editiones,
    hospitia,
  })
  const arcanumLeafCol = db.collection(config.arcanumLeavesCollection ?? 'arcanum_leaves')
  const arcanumNullifiersCol = db.collection(config.arcanumNullifiersCollection ?? 'arcanum_nullifiers')
  const arcanumTree = new MongoArcanumTree(arcanumLeafCol)
  const arcanumNullifiers = new MongoNullifierStore(arcanumNullifiersCol)
  const arcanumVerifier = new ArcanumVerifier({
    tree: arcanumTree,
    nullifiers: arcanumNullifiers,
    // Production: inject makeSnarkjsVerifier(verificationKey) from container config after
    // running arcanum-trusted-setup.sh. Absent: ZK spend proofs will throw at verify().
    verify: config.arcanumVerifyFn
      ?? (async () => { throw new Error('arcanumVerifyFn not configured — run arcanum-trusted-setup.sh') }),
  })
  const bursariumCol = db.collection(config.bursariumCollection ?? 'bursarium')
  const bursarium = new MongoBursarium(bursariumCol)
  const ceremonia = new MongoCeremoniaStore(
    db.collection(config.caeremoniaCollection ?? 'caeremonia'),
    db.collection(config.caeremoniaSlotsCollection ?? 'caeremonia_slots'),
  )
  const inceptor = new ActumInceptor({ modorum, cursorum, signorum, acta: actorum, arcanumVerifier, bursarium })
  const arcanumIssuer = new ArcanumIssuer({ signorum, tree: arcanumTree })

  // Both fan-out cursors (collectio + compositus) dispatch their pieces/steps through
  // the SAME dispatchInceptio used everywhere else — so they get the full rail
  // (actumIndex, hooks) AND a Collectio piece can itself be a compositus (cook-over-spell).
  // Self-reference resolved via a holder — `compositusCursor` is assigned before any
  // dispatch call can fire.
  let compositusCursor: CompositusCursor
  const sharedDispatch = (inc: Inceptio) =>
    dispatchInceptio({ inceptor, modorum, cursorum, completor, actumIndex, compositusCursor }, inc)
  // The parent actum's deadline is derived from its steps' own wall-clock budgets, so a step
  // cursor that declares a long terminus cannot be outlived by the umbrella that owns it.
  // Injected as a function so CompositusCursor stays independent of Cursorum, exactly as
  // `dispatch` is.
  const terminusOf = async (m: Modus, a: Record<string, unknown>): Promise<number> =>
    await cursorum.resolve(m).terminus?.(m, a) ?? DEFAULT_EXPIRAT_MS
  compositusCursor = new CompositusCursor(sharedDispatch, modorum, actorum, terminusOf)
  // Review ON by default: every completed piece waits for the creator's approve/reject
  // (curation) before it counts toward the collection and the next piece fires. This is
  // a GLOBAL flag today (not per-collection) — a per-collection review toggle is net-new.
  const collectioCursor = new CollectioCursor(sharedDispatch, collectiones, actorum, { reviewEnabled: true })

  return {
    actorum, modorum, signorum, redituum, mercedum, tripwireBand, animae, personae, issuers, legati, x402Log, sponsiones, vestigiorum, modos,
    mandatores, corpora, collectiones, datasets, museSessions, editiones, publicationAdapters, sodalitates, provinciae, tabulae, testimonia,
    deposita, solutiones, petitiones, scholia,
    colloquia, dicta, querelae, memoriae, partnerRequests, partners,
    cursorum, completor, inceptor, arcanumIssuer,
    arcanumTree, arcanumVerifier, bursarium, ceremonia,
    materiae, hospitia, actumIndex, deployments,
    fundamentorum,
    collectioCursor,
    compositusCursor,
    ...(conductor ? { conductor } : {}),
    ...(config.confidentialPod
      ? { teeProvisioner: new ConfidentialPodClient(config.confidentialPod) }
      : config.teeProvisioner ? { teeProvisioner: new TeeProvisioner(config.teeProvisioner) } : {}),
  }
}
