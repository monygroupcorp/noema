import type { JsonSchema, RouteSpec } from './types'

export const TabulaNodusSchema: JsonSchema = {
  type: 'object',
  description: 'A node placed on the canvas — references the Modus/Essentia it represents.',
  properties: {
    id: { type: 'string', description: "Unique within this Tabula's nodi." },
    modusId: { type: 'string', description: 'FK → Modus or Essentia this node represents.' },
    x: { type: 'number', description: 'Canvas x position.' },
    y: { type: 'number', description: 'Canvas y position.' },
    aditus: { type: 'object', description: "Per-node input overrides — become the published Modus's Porta.default values." },
  },
  required: ['id', 'modusId', 'x', 'y', 'aditus'],
}

export const TabulaVinculumSchema: JsonSchema = {
  type: 'object',
  description: 'A wire between two nodes — fonte (source) port → scopus (target) port.',
  properties: {
    id: { type: 'string' },
    fonteNodusId: { type: 'string', description: 'FK → TabulaNodus.id (source).' },
    fontePorta: { type: 'string', description: 'Output port name on the source node.' },
    scopusNodusId: { type: 'string', description: 'FK → TabulaNodus.id (target).' },
    scopusPorta: { type: 'string', description: 'Input port name on the target node.' },
    discordantia: { type: 'boolean', description: "True when the source/target port types don't match (flagged in the UI; publish rejects it)." },
  },
  required: ['id', 'fonteNodusId', 'fontePorta', 'scopusNodusId', 'scopusPorta', 'discordantia'],
}

export const TabulaSchema: JsonSchema = {
  type: 'object',
  description: 'A canvas workspace — the authoring layer above a published Modus.',
  properties: {
    id: { type: 'string' },
    nomen: { type: 'string', description: "The workspace's title." },
    descriptio: { type: 'string', description: 'Optional description for the marketplace listing.' },
    auctor: { type: 'object', description: 'The owning identity — { animaId } | { commitment } | { bursaToken }.' },
    nodi: { type: 'array', items: TabulaNodusSchema },
    vincula: { type: 'array', items: TabulaVinculumSchema },
    modusId: { type: 'string', description: 'FK → Modus. Set once this Tabula has been published.' },
    status: { type: 'string', enum: ['draft', 'published', 'archivata'] },
    visibilitas: { type: 'string', enum: ['privata', 'communis', 'publica'] },
    fonteId: { type: 'string', description: 'FK → Tabula this workspace was forked from, if any.' },
    templateId: { type: 'string', description: 'FK → the master Tabula this workspace derives from, if any.' },
    followTemplate: { type: 'boolean' },
    natum: { type: 'string', format: 'date-time' },
    mutatum: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'nomen', 'auctor', 'nodi', 'vincula', 'status', 'visibilitas', 'natum', 'mutatum'],
}

export const TabulaEnvelopeSchema: JsonSchema = {
  type: 'object',
  properties: { tabula: TabulaSchema },
  required: ['tabula'],
}

export const TabulaeListSchema: JsonSchema = {
  type: 'object',
  properties: { tabulae: { type: 'array', items: TabulaSchema } },
  required: ['tabulae'],
}

export const CreateTabulaRequestSchema: JsonSchema = {
  type: 'object',
  description: 'Create a draft Tabula owned by the caller.',
  properties: {
    nomen: { type: 'string', description: "The workspace's title." },
    descriptio: { type: 'string' },
    visibilitas: { type: 'string', enum: ['privata', 'communis', 'publica'], description: "Defaults to 'privata'." },
  },
  required: ['nomen'],
}

export const UpdateTabulaRequestSchema: JsonSchema = {
  type: 'object',
  description: "Patch the Tabula's graph/metadata. Omitted fields are left unchanged.",
  properties: {
    nomen: { type: 'string' },
    descriptio: { type: 'string' },
    nodi: { type: 'array', items: TabulaNodusSchema },
    vincula: { type: 'array', items: TabulaVinculumSchema },
    visibilitas: { type: 'string', enum: ['privata', 'communis', 'publica'] },
  },
}

export const PublishTabulaResponseSchema: JsonSchema = {
  type: 'object',
  properties: { modusId: { type: 'string', description: 'The registered compositus Modus id — immediately runnable via POST /v1/runs.' } },
  required: ['modusId'],
}

export const tabulaeRoutes: RouteSpec[] = [
    {
      method: 'GET',
      path: '/tabulae',
      summary: "List the caller's own canvas workspaces (Tabulae). Owner-scoped.",
      auth: true,
      response: TabulaeListSchema,
    },
    {
      method: 'POST',
      path: '/tabulae',
      summary: 'Create a draft Tabula owned by the caller.',
      auth: true,
      request: CreateTabulaRequestSchema,
      response: TabulaEnvelopeSchema,
    },
    {
      method: 'GET',
      path: '/tabulae/:id',
      summary: 'Fetch one owned Tabula by id (404 if not the owner).',
      auth: true,
      response: TabulaEnvelopeSchema,
    },
    {
      method: 'PUT',
      path: '/tabulae/:id',
      summary: "Patch a Tabula's graph/metadata (nomen/descriptio/nodi/vincula/visibilitas). Owner-only.",
      auth: true,
      request: UpdateTabulaRequestSchema,
      response: TabulaEnvelopeSchema,
    },
    {
      method: 'DELETE',
      path: '/tabulae/:id',
      summary: 'Delete a Tabula outright. Owner-only.',
      auth: true,
    },
    {
      method: 'POST',
      path: '/tabulae/:id/publish',
      summary: 'Compile the canvas graph into a compositus Modus and register it — immediately runnable via POST /v1/runs. 400 with the offending vinculum on a cycle or a port-type mismatch.',
      auth: true,
      response: PublishTabulaResponseSchema,
    },
]
