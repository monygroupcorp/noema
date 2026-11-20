import type { JsonSchema, RouteSpec } from './types'

export const TeamSchema: JsonSchema = {
  type: 'object',
  description: 'A team (Sodalitas) — a fellowship of Animae that co-owns work.',
  properties: {
    id: { type: 'string' },
    nomen: { type: 'string', description: 'The team display name.' },
    members: { type: 'array', items: { type: 'string' }, description: 'Member Anima ids (includes the founder).' },
    founder: { type: 'string', description: "The founder's Anima id." },
    createdAt: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'nomen', 'members', 'founder', 'createdAt'],
}

export const TeamEnvelopeSchema: JsonSchema = {
  type: 'object',
  properties: { team: TeamSchema },
  required: ['team'],
}

export const TeamsListSchema: JsonSchema = {
  type: 'object',
  properties: { teams: { type: 'array', items: TeamSchema } },
  required: ['teams'],
}

export const CreateTeamRequestSchema: JsonSchema = {
  type: 'object',
  description: 'Create a team. The caller becomes the founder and first member.',
  properties: {
    nomen: { type: 'string', description: 'The team display name.' },
    members: { type: 'array', items: { type: 'string' }, description: 'Additional member Anima ids to seed.' },
  },
  required: ['nomen'],
}

export const AddMemberRequestSchema: JsonSchema = {
  type: 'object',
  description: 'Add a member to a team.',
  properties: { animaId: { type: 'string', description: 'The Anima id to add.' } },
  required: ['animaId'],
}

export const teamsRoutes: RouteSpec[] = [
    {
      method: 'POST',
      path: '/teams',
      summary: 'Create a team (Sodalitas) — a fellowship of Animae that co-owns work. The caller becomes the founder and first member.',
      auth: true,
      request: CreateTeamRequestSchema,
      response: TeamEnvelopeSchema,
    },
    {
      method: 'GET',
      path: '/teams',
      summary: "List the caller's teams (every team they are a member of).",
      auth: true,
      response: TeamsListSchema,
    },
    {
      method: 'GET',
      path: '/teams/:id',
      summary: 'Fetch one team by id. Member-scoped (404 if not a member).',
      auth: true,
      response: TeamEnvelopeSchema,
    },
    {
      method: 'POST',
      path: '/teams/:id/members',
      summary: 'Add a member to a team. Member-scoped; idempotent.',
      auth: true,
      request: AddMemberRequestSchema,
      response: TeamEnvelopeSchema,
    },
    {
      method: 'DELETE',
      path: '/teams/:id/members/:animaId',
      summary: 'Remove a member from a team (the founder cannot be removed). Member-scoped.',
      auth: true,
      response: TeamEnvelopeSchema,
    },
]
