import type { Db } from 'mongodb'

/**
 * Creates all indexes for noemaplane.* collections.
 * Idempotent — safe to call on every boot. MongoDB skips existing indexes.
 */
export async function ensureIndexes(db: Db): Promise<void> {
  await Promise.all([
    // acta — execution ledger
    db.collection('acta').createIndex({ id: 1 }, { unique: true }),
    db.collection('acta').createIndex({ externusJobId: 1 }, { sparse: true }),
    db.collection('acta').createIndex({ status: 1, expirat: 1 }),

    // modi — modus/spell registry
    db.collection('modi').createIndex({ id: 1, versio: 1 }, { unique: true }),

    // signa — credit ledger
    db.collection('signa').createIndex({ id: 1 }, { unique: true }),
    db.collection('signa').createIndex({ animaId: 1, status: 1 }),
    db.collection('signa').createIndex({ testis: 1, forma: 1 }, { sparse: true }),

    // animae — soul / identity
    db.collection('animae').createIndex({ id: 1 }, { unique: true }),
    db.collection('animae').createIndex({ custos: 1 }, { sparse: true }),

    // personae — platform mask (hot path: every inbound message)
    db.collection('personae').createIndex({ genus: 1, externusId: 1 }, { unique: true }),
    db.collection('personae').createIndex({ animaIds: 1 }),

    // vestigia — RAG traces (Atlas Vector Search index managed separately in Atlas UI)
    db.collection('vestigia').createIndex({ 'auctorKey.animaId': 1 }, { sparse: true }),

    // modos — GPU sessions
    db.collection('modos').createIndex({ id: 1 }, { unique: true }),
    db.collection('modos').createIndex({ status: 1 }),

    // mandatores — standing agent instructions
    db.collection('mandatores').createIndex({ id: 1 }, { unique: true }),
    db.collection('mandatores').createIndex({ status: 1, _nextFire: 1 }, { sparse: true }),

    // corpora — training datasets
    db.collection('corpora').createIndex({ id: 1 }, { unique: true }),

    // collectiones — batch containers
    db.collection('collectiones').createIndex({ id: 1 }, { unique: true }),

    // tabulae — canvas workspaces
    db.collection('tabulae').createIndex({ id: 1 }, { unique: true }),
    db.collection('tabulae').createIndex({ templateId: 1 }, { sparse: true }),

    // testimonia — NFT attestations
    db.collection('testimonia').createIndex({ id: 1 }, { unique: true }),
    db.collection('testimonia').createIndex({ possessor: 1, contractus: 1 }),
    db.collection('testimonia').createIndex({ animaId: 1, status: 1 }),

    // deposita — onchain deposits
    db.collection('deposita').createIndex({ id: 1 }, { unique: true }),
    db.collection('deposita').createIndex({ transactioHash: 1, chainId: 1 }, { sparse: true }),

    // solutiones — payment settlements
    db.collection('solutiones').createIndex({ id: 1 }, { unique: true }),

    // petitiones — payment requests
    db.collection('petitiones').createIndex({ id: 1 }, { unique: true }),
    db.collection('petitiones').createIndex({ animaId: 1, status: 1 }),

    // scholia — community annotations
    db.collection('scholia').createIndex({ id: 1 }, { unique: true }),
    db.collection('scholia').createIndex({ targetType: 1, targetId: 1 }),

    // colloquia — conversation threads
    db.collection('colloquia').createIndex({ id: 1 }, { unique: true }),
    db.collection('colloquia').createIndex({ animaId: 1, status: 1 }),

    // dicta — conversation turns
    db.collection('dicta').createIndex({ id: 1 }, { unique: true }),
    db.collection('dicta').createIndex({ colloquiumId: 1, natum: 1 }),

    // memoriae — distilled agent memory (one per anima)
    db.collection('memoriae').createIndex({ animaId: 1 }, { unique: true }),

    // intelligendi — user-facing model catalog
    db.collection('intelligendi').createIndex({ id: 1 }, { unique: true }),

    // materiae — GPU pod records
    db.collection('materiae').createIndex({ id: 1 }, { unique: true }),
    db.collection('materiae').createIndex({ status: 1, imageRef: 1 }),

    // deployments — content-addressed compiled specs
    db.collection('deployments').createIndex({ hash: 1 }, { unique: true }),

    // intellae — deploy-time model registry
    db.collection('intellae').createIndex({ id: 1 }, { unique: true }),
    db.collection('intellae').createIndex({ canonica: 1 }),
    db.collection('intellae').createIndex({ genus: 1 }),

    // arcanum_leaves — ZK Merkle tree leaf records
    db.collection('arcanum_leaves').createIndex({ leafIndex: 1 }, { unique: true }),
    db.collection('arcanum_leaves').createIndex({ commitment: 1 }, { unique: true }),

    // arcanum_nullifiers — spent note registry (double-spend prevention)
    db.collection('arcanum_nullifiers').createIndex({ nullifierHash: 1 }, { unique: true }),
  ])
}
