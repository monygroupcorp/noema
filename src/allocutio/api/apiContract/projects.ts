import type { JsonSchema, RouteSpec } from './types'

export const ProjectSchema: JsonSchema = {
  type: 'object',
  description: 'A project (Provincia) — an account-owned workspace lens. Holdings are id references, never copies: filing an asset here does not change who may read that asset.',
  properties: {
    id: { type: 'string' },
    owner: { type: 'string', description: "The owning Anima id (the project's hard ownership boundary)." },
    name: { type: 'string', description: 'The project display name.' },
    desc: { type: 'string', description: 'Optional description.' },
    glyph: { type: 'string', description: 'Presentation glyph.' },
    color: { type: 'string', description: 'Presentation color.' },
    datasetIds: { type: 'array', items: { type: 'string' }, description: 'Filed dataset ids.' },
    modelIds: { type: 'array', items: { type: 'string' }, description: 'Filed model (Intella) ids.' },
    collectionIds: { type: 'array', items: { type: 'string' }, description: 'Filed collection ids.' },
    teamId: { type: 'string', description: 'Optional referenced Team (Sodalitas) id — every member of it may read the project and file assets into it. An overlay on the owner, not a second owner.' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'owner', 'name', 'datasetIds', 'modelIds', 'collectionIds', 'createdAt', 'updatedAt'],
}

export const ProjectEnvelopeSchema: JsonSchema = {
  type: 'object',
  properties: { project: ProjectSchema },
  required: ['project'],
}

export const ProjectsListSchema: JsonSchema = {
  type: 'object',
  properties: { projects: { type: 'array', items: ProjectSchema } },
  required: ['projects'],
}

export const CreateProjectRequestSchema: JsonSchema = {
  type: 'object',
  description: 'Create a project owned by the caller.',
  properties: {
    name: { type: 'string', description: 'The project display name.' },
    desc: { type: 'string', description: 'Optional description.' },
    glyph: { type: 'string', description: 'Presentation glyph.' },
    color: { type: 'string', description: 'Presentation color.' },
    teamId: { type: 'string', description: 'Optional Team (Sodalitas) to reference for the shared member set.' },
  },
  required: ['name'],
}

export const UpdateProjectRequestSchema: JsonSchema = {
  type: 'object',
  description: 'Patch project metadata. Omitted fields are left unchanged; teamId null clears the reference.',
  properties: {
    name: { type: 'string' },
    desc: { type: 'string' },
    glyph: { type: 'string' },
    color: { type: 'string' },
    teamId: { type: 'string', description: 'Set/clear the referenced Team (Sodalitas).' },
  },
}

export const FileAssetRequestSchema: JsonSchema = {
  type: 'object',
  description: 'File an asset reference into the project (idempotent).',
  properties: {
    kind: { type: 'string', enum: ['dataset', 'model', 'collection'], description: 'Which holding list.' },
    assetId: { type: 'string', description: "The asset's id." },
  },
  required: ['kind', 'assetId'],
}

export const projectsRoutes: RouteSpec[] = [
    {
      method: 'GET',
      path: '/me/projects',
      summary: "List the projects the caller can read (Provincia) — their own, plus any shared with a Team they belong to. Identified callers only.",
      auth: true,
      response: ProjectsListSchema,
    },
    {
      method: 'POST',
      path: '/me/projects',
      summary: 'Create a project owned by the caller. Holdings start empty; assets are filed in by reference.',
      auth: true,
      request: CreateProjectRequestSchema,
      response: ProjectEnvelopeSchema,
    },
    {
      method: 'GET',
      path: '/me/projects/:id',
      summary: 'Fetch one project by id — the owner, or a member of the Team it is shared with (404 for anyone else).',
      auth: true,
      response: ProjectEnvelopeSchema,
    },
    {
      method: 'PATCH',
      path: '/me/projects/:id',
      summary: 'Patch project metadata (name/desc/glyph/color/teamId). Owner-only.',
      auth: true,
      request: UpdateProjectRequestSchema,
      response: ProjectEnvelopeSchema,
    },
    {
      method: 'DELETE',
      path: '/me/projects/:id',
      summary: 'Delete a project. Owner-only. Filed assets are untouched (holdings are references).',
      auth: true,
    },
    {
      method: 'POST',
      path: '/me/projects/:id/holdings',
      summary: 'File an asset reference (dataset|model|collection) into the project. Owner or a member of the Team it is shared with; idempotent. Filing is a reference, not a grant — it does not widen who can read the asset.',
      auth: true,
      request: FileAssetRequestSchema,
      response: ProjectEnvelopeSchema,
    },
    {
      method: 'DELETE',
      path: '/me/projects/:id/holdings/:kind/:assetId',
      summary: 'Unfile an asset reference from the project. Owner-only; idempotent.',
      auth: true,
      response: ProjectEnvelopeSchema,
    },
]
