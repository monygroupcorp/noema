// The crystal — 15 primitives across three tiers
//
// ┌─ TIER 1: CORE (identified side) ──────────────────────────────┐
// │  anima        the persistent user soul                        │
// │  persona      the platform mask (frontend IS persona)         │
// │  signum       proof of value — identified forma:              │
// │               integer | eth | x402 | minted | mined | reward  │
// └───────────────────────────┬───────────────────────────────────┘
//                             │ commitment (one-way, no return path)
// ┌─ TIER 1: CORE (bridge) ───▼───────────────────────────────────┐
// │  signum       anonymous forma: arcanum | tessera               │
// │               arcanum = H(secret), holds balance               │
// │               tessera = bearer capability, session-scoped      │
// └───────────────────────────┬───────────────────────────────────┘
//                             │ nullifier in actum (one-time spend proof)
// ┌─ TIER 1: CORE (anonymous side) ───────────────────────────────┐
// │  modo         the runtime session — no identity, ever          │
// │  actum        execution report — no identity, ever             │
// │  materia      compute substrate — attestatio (TEE quote)       │
// │  modus        the fractal tool primitive                       │
// │  essendi      atomic expression catalog (modes of being)       │
// │  intelligendi compute/model substrate (modes of understanding) │
// └───────────────────────────────────────────────────────────────┘
//
// ┌─ TIER 1: EXTENDED ────────────────────────────────────────────┐
// │  corpus       training dataset (exemplaria assembled for a run)│
// │  collectio    batch container — Modus × parameter grid → Acta  │
// │  mandatum     standing autonomous instruction / agent          │
// │  tabula       canvas workspace — authoring draft above Modus   │
// │  vestigium    indexed output trace — prompts, embeddings, RAG  │
// └───────────────────────────────────────────────────────────────┘
//
// ┌─ TIER 2: SECONDARY ───────────────────────────────────────────┐
// │  catena       onchain layer: Depositum, Solutio, Petitio       │
// │  allocutio    platform adapter: Nuntius → Inceptio → Responsum │
// └───────────────────────────────────────────────────────────────┘
//
// The hop chain from session to identity:
//   modo → actum.nullifier → signum(arcanum) → signum(deposit) → anima
//   Three hops. Access-controlled at each. Schema-enforced.
//
// Store naming: genitive plural — Signorum, Modorum, Cursorum, Actorum,
//   Corporum, Collectionum, Mandatorum, Tabularum, Vestigiorum, Catenarum, Allocutionum
//
// Groups are grammar: animae (plural), animarum (of the group)
// Teams are not a new crystal — they emerge from the declension of anima

export * from './modus'
export * from './essendi'
export * from './intelligendi'
export * from './significandi'
export * from './actum'
export * from './materia'
export * from './modo'
export * from './anima'
export * from './persona'
export * from './nexus'
export * from './cursus'
export * from './corpus'
export * from './collectio'
export * from './mandatum'
export * from './tabula'
export * from './vestigium'
export * from './catena'
export * from './allocutio'
export * from './scholium'
export * from './consuetudo'
