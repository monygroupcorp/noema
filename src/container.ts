import type { Collection, MongoClient } from 'mongodb'
import type { Modus } from './types/modus.js'
import type { Actorum, Cursorum, ActumCompletor as IActumCompletor } from './types/cursus.js'
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
import type { Tabularum } from './types/tabula.js'
import type { Testimoniorum, Depositorum, Solutionum, Petitionum } from './types/catena.js'
import type { Scholiorum } from './types/scholium.js'
import type { ColloquiumStore, DictumStore } from './types/colloquium.js'
import type { MemoriaStore } from './types/anima.js'
import type { IntelligentiumStore } from './types/intelligendi.js'
import type { MateriaStore } from './types/materia.js'
import type { DeploymentumStore } from './types/deploymentum.js'
import { MongoMateria } from './crystal/MongoMateria.js'
import { MongoDeploymentum } from './crystal/MongoDeploymentum.js'
import { Praefectus } from './crystal/Praefectus.js'
import { WarmPodClient } from './crystal/WarmPodClient.js'

import { MongoActorum } from './crystal/MongoActorum.js'
import { MongoModorum } from './crystal/MongoModorum.js'
import { MongoSignorum } from './crystal/MongoSignorum.js'
import { MongoAnima } from './crystal/MongoAnima.js'
import { MongoPersona } from './crystal/MongoPersona.js'
import { MongoVestigiorum } from './crystal/MongoVestigiorum.js'
import { MongoModo } from './crystal/MongoModo.js'
import { RunPodCursor } from './crystal/RunPodCursor.js'
import { TesseraCursor } from './crystal/TesseraCursor.js'
import { OpenAICursor } from './crystal/OpenAICursor.js'
import { HuggingFaceCursor } from './crystal/HuggingFaceCursor.js'
import { SimpleCursorum } from './crystal/SimpleCursorum.js'
import { ActumCompletor } from './crystal/ActumCompletor.js'
import { ActumInceptor } from './execution/ActumInceptor.js'
import { MongoMandatum } from './crystal/MongoMandatum.js'
import { MongoCorpus } from './crystal/MongoCorpus.js'
import { MongoCollectio } from './crystal/MongoCollectio.js'
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
  cursorum: Cursorum
  completor: IActumCompletor
  inceptor: IActumInceptor
  materiae: MateriaStore
  deployments: DeploymentumStore
  collectioCursor: CollectioCursor
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
  compile: (modus: Modus, aditus: Record<string, unknown>) => Promise<{ hash: string; input: unknown }>
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
  /** Collection name for deployments — default 'deployments' */
  deploymentsCollection?: string
  /**
   * Pre-created MateriaStore — if provided, used directly instead of creating a new MongoMateria.
   * Pass this when the same store instance needs to be shared with SecurePodClient (keep-warm mode).
   */
  materiae?: MateriaStore
  /**
   * Embed function for semantic search — inject the OpenAI/local model.
   * Absent: index() and search() will throw; create/findById/forIdentity still work.
   */
  embed?: (text: string) => Promise<number[]>
  /** OpenAI-compatible client — absent: OpenAI tools will throw at reserve() */
  openaiClient?: {
    chat(params: unknown): Promise<{ content: string; usage?: { total_tokens?: number } }>
    image(params: unknown): Promise<{ url: string }>
  }
  /** HuggingFace client — absent: HuggingFace tools will throw at reserve() */
  huggingfaceClient?: {
    predict(spaceUrl: string, params: Record<string, unknown>): Promise<Record<string, unknown>>
  }
}

export function createContainer(mongo: MongoClient, config: ContainerConfig): Ring {
  const db = mongo.db(config.dbName)

  // ── Phase 1 + 2: real ─────────────────────────────────────────────────────
  const col: Collection = db.collection(config.actaCollection ?? 'acta')
  const actorum = new MongoActorum(col)

  const modiCol: Collection = db.collection(config.modiCollection ?? 'modi')
  const modorum = new MongoModorum(modiCol)

  const signaCol: Collection = db.collection(config.signaCollection ?? 'signa')
  const signorum = new MongoSignorum(signaCol)

  const animaeCol: Collection = db.collection(config.animaeCollection ?? 'animae')
  const animae = new MongoAnima(animaeCol)

  const personaeCol: Collection = db.collection(config.personaeCollection ?? 'personae')
  const personae = new MongoPersona(personaeCol)

  const vestigiaCol: Collection = db.collection(config.vestigiaCollection ?? 'vestigia')
  const vestigiorum = new MongoVestigiorum(vestigiaCol, config.embed)

  const modosCol: Collection = db.collection(config.modosCollection ?? 'modos')
  const modos = new MongoModo(modosCol)

  const mandatores = new MongoMandatum(db.collection(config.mandatoresCollection ?? 'mandatores'))
  const corpora = new MongoCorpus(db.collection(config.corporaCollection ?? 'corpora'))
  const collectiones = new MongoCollectio(db.collection(config.collectionesCollection ?? 'collectiones'))
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

  const deploymentsCol: Collection = db.collection(config.deploymentsCollection ?? 'deployments')
  const deployments = new MongoDeploymentum(deploymentsCol)

  // ── Execution rail ─────────────────────────────────────────────────────────
  const cursorum = new SimpleCursorum()

  const imageRefOf = (modus: Modus): string | undefined => {
    const spec = (modus as { runpodSpec?: { imageId?: string; imageVersion?: string } }).runpodSpec
    return spec?.imageId && spec.imageVersion
      ? `${spec.imageId}:${spec.imageVersion}`
      : undefined
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
        warmFactory: (m) => new WarmPodClient(m, materiae),
        imageRefOf,
        deployments,
      },
    )
    const tesseraCursor = new TesseraCursor(runpodCursor, modos, signorum)
    cursorum.register('runpod', runpodCursor)
    cursorum.register('tessera', tesseraCursor)
  }

  if (config.openaiClient) {
    const openaiCursor = new OpenAICursor(config.openaiClient as Parameters<typeof OpenAICursor>[0])
    cursorum.register('openai', openaiCursor)
  }

  if (config.huggingfaceClient) {
    const hfCursor = new HuggingFaceCursor(config.huggingfaceClient)
    cursorum.register('huggingface', hfCursor)
  }

  const completor = new ActumCompletor(actorum, signorum)
  const inceptor = new ActumInceptor({ modorum, cursorum, signorum, acta: actorum })
  const collectioCursor = new CollectioCursor(inceptor, collectiones, actorum, {})

  return {
    actorum, modorum, signorum, animae, personae, vestigiorum, modos,
    mandatores, corpora, collectiones, tabulae, testimonia,
    deposita, solutiones, petitiones, scholia,
    colloquia, dicta, memoriae, intelligendi,
    cursorum, completor, inceptor,
    materiae, deployments,
    collectioCursor,
  }
}
