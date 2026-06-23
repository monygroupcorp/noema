import type { Collection, MongoClient } from 'mongodb'
import type { Modus } from './types/modus.js'
import type { Actorum, Cursorum, ActumCompletor as IActumCompletor, Inceptio } from './types/cursus.js'
import type { RunPodClient } from './crystal/RunPodCursor.js'
import type { ActumInceptor as IActumInceptor } from './execution/ActumInceptor.js'
import type { Signorum } from './types/significandi.js'
import type { Modorum } from './types/modus.js'
import type { AnimaStore } from './types/anima.js'
import type { PersonaStore } from './types/persona.js'
import type { Vestigiorum } from './types/vestigium.js'
import type { ModoStore } from './types/modo.js'
import type { Mandatorum } from './types/mandatum.js'
import type { Corporum } from './types/corpus.js'
import type { Collectionum } from './types/collectio.js'
import type { Editionum } from './types/editio.js'
import type { Sodalitatum } from './types/sodalitas.js'
import type { Tabularum } from './types/tabula.js'
import type { Testimoniorum, Depositorum, Solutionum, Petitionum } from './types/catena.js'
import type { Scholiorum } from './types/scholium.js'
import type { ColloquiumStore, DictumStore } from './types/colloquium.js'
import type { MemoriaStore } from './types/anima.js'
import type { IntelligentiumStore } from './types/intelligendi.js'
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

import { MongoActorum } from './crystal/MongoActorum.js'
import { MongoModorum } from './crystal/MongoModorum.js'
import { MongoFundamentorum } from './crystal/MongoFundamentorum.js'
import { MongoSignorum } from './crystal/MongoSignorum.js'
import { MongoAnima } from './crystal/MongoAnima.js'
import { MongoPersona } from './crystal/MongoPersona.js'
import { MongoVestigiorum } from './crystal/MongoVestigiorum.js'
import { MongoModo } from './crystal/MongoModo.js'
import { RunPodCursor } from './crystal/RunPodCursor.js'
import { TesseraCursor } from './crystal/TesseraCursor.js'
import { OpenAICursor } from './crystal/OpenAICursor.js'
import { HuggingFaceCursor } from './crystal/HuggingFaceCursor.js'
import { LayerCompositeCursor } from './crystal/LayerCompositeCursor.js'
import { JimpLayerCompositeEngine } from './crystal/LayerCompositeEngine.js'
import { FfmpegCursor } from './crystal/FfmpegCursor.js'
import { SpawnFfmpegEngine } from './crystal/FfmpegEngine.js'
import { AitoolkitTrainingCursor, type AitoolkitTrainingCursorDeps } from './crystal/AitoolkitTrainingCursor.js'
import { SqliteAitkJobStore } from './crystal/AitkJobStore.js'
import { DockerAitkSpawner } from './crystal/AitkSpawner.js'
import { MongoIntella } from './crystal/MongoIntella.js'
import { makeTrainingFinalizer, fsLoraReader } from './crystal/trainingFinalizer.js'
import { fsConfigWriter } from './crystal/aitkConfig.js'
import { httpMediaFetcher } from './crystal/MediaFetcher.js'
import { R2Uploader } from './crystal/R2Uploader.js'
import { FeedAdapter } from './crystal/FeedAdapter.js'
import { BucketAdapter } from './crystal/BucketAdapter.js'
import { ModelPublishAdapter, huggingFaceRegistry, civitaiRegistry } from './crystal/ModelPublishAdapter.js'
import { MintAdapter, MarketplaceAdapter } from './crystal/MintAdapter.js'
import { HuggingFaceUploader, HfHttpTransport } from './crystal/HfUploader.js'
import type { PublicationAdapter } from './crystal/PublicationAdapter.js'
import { SimpleCursorum } from './crystal/SimpleCursorum.js'
import { ActumCompletor } from './execution/ActumCompletor.js'
import { ActumInceptor } from './execution/ActumInceptor.js'
import { dispatchInceptio } from './execution/dispatchInceptio.js'
import { MongoMandatum } from './crystal/MongoMandatum.js'
import { MongoCorpus } from './crystal/MongoCorpus.js'
import { MongoCollectio } from './crystal/MongoCollectio.js'
import { MongoEditionum } from './crystal/MongoEditionum.js'
import { MongoSodalitatum } from './crystal/MongoSodalitatum.js'
import { MongoTabula } from './crystal/MongoTabula.js'
import { MongoTestimoniorum } from './crystal/MongoTestimoniorum.js'
import { MongoDepositum } from './crystal/MongoDepositum.js'
import { MongoSolutio } from './crystal/MongoSolutio.js'
import { MongoPetitio } from './crystal/MongoPetitio.js'
import { MongoScholium } from './crystal/MongoScholium.js'
import { MongoColloquium } from './crystal/MongoColloquium.js'
import { MongoDictum } from './crystal/MongoDictum.js'
import { MongoMemoria } from './crystal/MongoMemoria.js'
import { MongoIntelligendi } from './crystal/MongoIntelligendi.js'
import { CollectioCursor } from './crystal/CollectioCursor.js'
import { CompositusCursor } from './crystal/CompositusCursor.js'
import { ArcanumIssuer } from './ledger/ArcanumIssuer.js'
import { MongoArcanumTree } from './arcanum/ArcanumTree.js'
import { ArcanumVerifier, MongoNullifierStore, type VerifyFn } from './arcanum/ArcanumVerifier.js'
import { MongoBursarium } from './arcanum/MongoBursarium.js'

export interface Ring {
  actorum: Actorum
  modorum: Modorum
  signorum: Signorum
  animae: AnimaStore
  personae: PersonaStore
  vestigiorum: Vestigiorum
  modos: ModoStore
  mandatores: Mandatorum
  corpora: Corporum
  collectiones: Collectionum
  /** Publication records (Editio) — backs the publishing spine + feed. */
  editiones: Editionum
  /** Registered publication adapters (FeedAdapter always; BucketAdapter when R2 is configured). */
  publicationAdapters: PublicationAdapter[]
  sodalitates: Sodalitatum
  tabulae: Tabularum
  testimonia: Testimoniorum
  deposita: Depositorum
  solutiones: Solutionum
  petitiones: Petitionum
  scholia: Scholiorum
  colloquia: ColloquiumStore
  dicta: DictumStore
  memoriae: MemoriaStore
  intelligendi: IntelligentiumStore
  fundamentorum: import('./types/fundamentum.js').Fundamentorum
  cursorum: Cursorum
  completor: IActumCompletor
  inceptor: IActumInceptor
  arcanumIssuer: ArcanumIssuer
  arcanumTree: MongoArcanumTree
  arcanumVerifier: ArcanumVerifier
  bursarium: MongoBursarium
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
  teeProvisioner?: TeeProvisioner
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
  compile: (modus: Modus, aditus: Record<string, unknown>, pinnedModels?: import('./types/actum.js').ModelRef[]) => Promise<{ hash: string; input: unknown }>
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
  /** Collection name for acta — default 'acta' */
  actaCollection?: string
  /** Collection name for modi — default 'modi' */
  modiCollection?: string
  /** Collection name for signa — default 'signa' */
  signaCollection?: string
  /** Collection name for animae — default 'animae' */
  animaeCollection?: string
  /** Collection name for personae — default 'personae' */
  personaeCollection?: string
  /** Collection name for vestigia — default 'vestigia' */
  vestigiaCollection?: string
  /** Collection name for modos — default 'modos' */
  modosCollection?: string
  mandatoresCollection?: string
  corporaCollection?: string
  collectionesCollection?: string
  editionesCollection?: string
  /** Our HuggingFace org for `custody:'ours'` model publishes (default 'ms2stationthis'). */
  huggingFaceOrg?: string
  /** HF_TOKEN — present → the HF registry gets a real LFS uploader; absent → projection-only. */
  huggingFaceToken?: string
  /** Base URL the MarketplaceAdapter projects listing handles under (default 'https://noema.art/market'). */
  marketplaceBaseUrl?: string
  sodalitatesCollection?: string
  tabulaeCollection?: string
  testimoniaCollection?: string
  depositaCollection?: string
  solutionesCollection?: string
  petitionesCollection?: string
  scholiaCollection?: string
  colloquiaCollection?: string
  dictaCollection?: string
  memoriaeCollection?: string
  /** Collection name for intelligendi — default 'intelligendi' */
  intelligentiaeCollection?: string
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
  /** OpenAI-compatible client — absent: OpenAI tools will throw at reserve() */
  openaiClient?: {
    chat(params: unknown): Promise<{ content: string; usage?: { total_tokens?: number } }>
    image(params: unknown): Promise<{ url: string }>
  }
  /** HuggingFace client — absent: HuggingFace tools will throw at reserve() */
  huggingfaceClient?: {
    predict(spaceUrl: string, params: Record<string, unknown>): Promise<Record<string, unknown>>
  }
  /** TEE runner pod provisioner config — if present, POST /v1/sessions/tee boots real pods. */
  teeProvisioner?: TeeProvisionerConfig
}

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
  const signorum = new MongoSignorum(signaCol)

  const animaeCol: Collection = db.collection(config.animaeCollection ?? 'animae')
  const animae = new MongoAnima(animaeCol)

  const personaeCol: Collection = db.collection(config.personaeCollection ?? 'personae')
  const personae = new MongoPersona(personaeCol)

  const vestigiaCol: Collection = db.collection(config.vestigiaCollection ?? 'vestigia')
  const vestigiorum = new MongoVestigiorum(vestigiaCol, config.embed, config.embedImage)

  const modosCol: Collection = db.collection(config.modosCollection ?? 'modos')
  const modos = new MongoModo(modosCol)

  const mandatores = new MongoMandatum(db.collection(config.mandatoresCollection ?? 'mandatores'))
  const corpora = new MongoCorpus(db.collection(config.corporaCollection ?? 'corpora'))
  const collectiones = new MongoCollectio(db.collection(config.collectionesCollection ?? 'collectiones'))
  const editiones = new MongoEditionum(db.collection(config.editionesCollection ?? 'editiones'))
  const sodalitates = new MongoSodalitatum(db.collection(config.sodalitatesCollection ?? 'sodalitates'))
  const tabulae = new MongoTabula(db.collection(config.tabulaeCollection ?? 'tabulae'))
  const testimonia = new MongoTestimoniorum(db.collection(config.testimoniaCollection ?? 'testimonia'))
  const deposita = new MongoDepositum(db.collection(config.depositaCollection ?? 'deposita'))
  const solutiones = new MongoSolutio(db.collection(config.solutionesCollection ?? 'solutiones'))
  const petitiones = new MongoPetitio(db.collection(config.petitionesCollection ?? 'petitiones'))
  const scholia = new MongoScholium(db.collection(config.scholiaCollection ?? 'scholia'))
  const colloquia = new MongoColloquium(db.collection(config.colloquiaCollection ?? 'colloquia'))
  const dicta = new MongoDictum(db.collection(config.dictaCollection ?? 'dicta'))
  const memoriae = new MongoMemoria(db.collection(config.memoriaeCollection ?? 'memoriae'))
  const intelligendi = new MongoIntelligendi(db.collection(config.intelligentiaeCollection ?? 'intelligendi'))

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

  if (config.openaiClient) {
    const openaiCursor = new OpenAICursor(config.openaiClient as ConstructorParameters<typeof OpenAICursor>[0])
    cursorum.register('openai', openaiCursor)
  }

  if (config.huggingfaceClient) {
    const hfCursor = new HuggingFaceCursor(config.huggingfaceClient)
    cursorum.register('huggingface', hfCursor)
  }

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

  // Host-side deterministic processing runtimes (spec §4a). They produce bytes
  // ON the host, so they need R2 to host the result — gate registration on it.
  if (config.runpodR2) {
    const uploader = new R2Uploader(config.runpodR2)
    cursorum.register('composite', new LayerCompositeCursor({
      engine: new JimpLayerCompositeEngine(),
      fetcher: httpMediaFetcher,
      uploader,
    }))
    cursorum.register('ffmpeg', new FfmpegCursor({
      engine: new SpawnFfmpegEngine(),
      fetcher: httpMediaFetcher,
      uploader,
    }))
    // Bucket custody (publishing #2): re-hosts an artifact's media to R2.
    publicationAdapters.push(new BucketAdapter({ fetcher: httpMediaFetcher, store: uploader }))
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
      aitkDeps.resolveOutput = makeTrainingFinalizer({
        reader: fsLoraReader(config.aitoolkit.outputDir),
        store: new R2Uploader(config.runpodR2),
        intellae: new MongoIntella(db.collection('intellae')),
      })
    }
    cursorum.register('aitoolkit', new AitoolkitTrainingCursor(aitkDeps))
  }

  const completor = new ActumCompletor({ acta: actorum, signorum, terminatePod: config.terminatePod })
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
  compositusCursor = new CompositusCursor(sharedDispatch, modorum, actorum)
  const collectioCursor = new CollectioCursor(sharedDispatch, collectiones, actorum, {})

  return {
    actorum, modorum, signorum, animae, personae, vestigiorum, modos,
    mandatores, corpora, collectiones, editiones, publicationAdapters, sodalitates, tabulae, testimonia,
    deposita, solutiones, petitiones, scholia,
    colloquia, dicta, memoriae, intelligendi,
    cursorum, completor, inceptor, arcanumIssuer,
    arcanumTree, arcanumVerifier, bursarium,
    materiae, hospitia, actumIndex, deployments,
    fundamentorum,
    collectioCursor,
    compositusCursor,
    ...(conductor ? { conductor } : {}),
    ...(config.teeProvisioner ? { teeProvisioner: new TeeProvisioner(config.teeProvisioner) } : {}),
  }
}
