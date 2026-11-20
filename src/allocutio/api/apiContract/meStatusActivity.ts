import type { JsonSchema, RouteSpec } from './types'
import { QueuePlaceSchema, RunsPageSchema } from './runs'

export const EARNING_KINDS = ['spell-royalty', 'model-royalty', 'host-cut', 'host-bonus', 'referral']

export const EarningSchema: JsonSchema = {
  type: 'object',
  description: 'One payment the caller RECEIVED because someone else ran something.',
  properties: {
    id: { type: 'string', description: 'The ledger row id — also the page cursor\'s tiebreak.' },
    kind: {
      type: 'string',
      enum: EARNING_KINDS,
      description:
        'Which stream paid: a royalty on the caller\'s flow (spell-royalty) or on a model of theirs a ' +
        'run used (model-royalty), a cut of a gen served on their pod (host-cut) or the ambassador ' +
        'bonus on it (host-bonus), or a share of a referred account\'s deposit (referral).',
    },
    impetus: { type: 'string', description: 'Impetus earned by this row, serialised as a string.' },
    usd: { type: 'number', description: 'Derived USD at the platform reference rate.' },
    earnedAt: { type: 'string', format: 'date-time', description: 'When it was earned, ISO-8601.' },
    studioId: { type: 'string', description: 'The studio it was served from, on the hosting streams that carry one.' },
  },
  required: ['id', 'kind', 'impetus', 'usd', 'earnedAt'],
}

export const EarningStreamSchema: JsonSchema = {
  type: 'object',
  description: 'One stream\'s lifetime contribution to the caller\'s earnings.',
  properties: {
    kind: { type: 'string', enum: EARNING_KINDS, description: 'The stream.' },
    impetus: { type: 'string', description: 'Everything this stream has ever paid the caller, as a string.' },
    usd: { type: 'number', description: 'Derived USD at the platform reference rate.' },
    count: { type: 'number', description: 'How many payments make up the total.' },
  },
  required: ['kind', 'impetus', 'usd', 'count'],
}

export const EarningsViewSchema: JsonSchema = {
  type: 'object',
  description:
    'What the caller has earned: the lifetime total, the per-stream breakdown behind it, and a page ' +
    'of the individual payments. `lifetime` and `streams` cover the caller\'s whole history, not just ' +
    'this page. Every total sums earnings of EVERY status — a royalty since spent was still earned — ' +
    'so this is a statement of earnings, not a balance (GET /v1/me/status is the balance).',
  properties: {
    lifetime: {
      type: 'object',
      description: 'Everything the caller has ever earned, across every stream.',
      properties: {
        impetus: { type: 'string', description: 'Total impetus earned, serialised as a string.' },
        usd: { type: 'number', description: 'Total USD, derived at the platform reference rate.' },
      },
      required: ['impetus', 'usd'],
    },
    streams: {
      type: 'array',
      items: EarningStreamSchema,
      description: 'The streams that have paid, in a stable display order. A stream that never paid is absent.',
    },
    earnings: { type: 'array', items: EarningSchema, description: 'This page of payments, newest first.' },
    nextCursor: { type: 'string', description: 'Opaque cursor for the next page; absent on the last page.' },
  },
  required: ['lifetime', 'streams', 'earnings'],
}

export const ActivityDoorSchema: JsonSchema = {
  type: 'object',
  description: 'The way back to a run\'s artifact. Every field is optional; a field the run did not produce is absent.',
  properties: {
    modelId: { type: 'string', description: 'The registered model (Intella) id a training run produced.' },
    datasetId: { type: 'string', description: 'The dataset the run trained on, captioned, or decomposed.' },
    captionsetId: { type: 'string', description: 'The captionset the run produced or decomposed.' },
    mediaUrl: { type: 'string', description: 'First media URL among the run\'s outputs, when one is trivially present.' },
  },
}

export const ActivityRowSchema: JsonSchema = {
  type: 'object',
  description: 'One run in the owner\'s activity — in-flight, settled, or released — with a door to its artifact.',
  properties: {
    actumId: { type: 'string', description: 'The run (Actum) identifier.' },
    kind: {
      type: 'string',
      enum: ['training', 'caption', 'decompose', 'generation'],
      description: 'What the run produced. Resolved from a modusId table; "generation" is the catch-all.',
    },
    modusId: { type: 'string', description: 'The flow (modus) the run executed.' },
    modusLabel: { type: 'string', description: 'Human label of the modus, when the index row carries one.' },
    status: { type: 'string', enum: ['running', 'settled', 'released'], description: 'In-flight, settled (charged), or released (failed/cancelled — nothing charged).' },
    createdAt: { type: 'string', format: 'date-time', description: 'When the run started, ISO-8601.' },
    settledAt: { type: 'string', format: 'date-time', description: 'When the run settled, ISO-8601. Absent unless status is "settled".' },
    releasedAt: { type: 'string', format: 'date-time', description: 'When the run released, ISO-8601. Absent unless status is "released".' },
    door: ActivityDoorSchema,
    queue: QueuePlaceSchema,
  },
  required: ['actumId', 'kind', 'modusId', 'status'],
}

export const ActivityPageSchema: JsonSchema = {
  type: 'object',
  description: 'A page of the owner\'s activity: in-flight, settled, and released runs merged newest-first.',
  properties: {
    activity: { type: 'array', items: ActivityRowSchema, description: 'Activity rows, newest first.' },
    nextCursor: { type: 'string', description: 'Opaque cursor for the next page of settled rows; absent on the last page.' },
  },
  required: ['activity'],
}

export const PartnerRequestSchema: JsonSchema = {
  type: 'object',
  description: "The caller's most recent B2B partner application and where it stands.",
  properties: {
    id: { type: 'string', description: 'The application id.' },
    status: { type: 'string', description: "'pending' (awaiting review), 'approved' (GET /v1/me/partner now returns a record), or 'declined'." },
    useCase: { type: 'string', description: 'What the applicant said they wanted to build.' },
    contactEmail: { type: 'string', description: 'The contact email the application was filed with.' },
    nomen: { type: 'string', description: 'Applicant display name, if given.' },
    org: { type: 'string', description: 'Organization name, if given.' },
    notes: { type: 'string', description: 'Free-text notes, if given.' },
    natum: { type: 'string', format: 'date-time', description: 'When the application was filed.' },
    decidedAt: { type: 'string', format: 'date-time', description: 'When it was approved or declined. Absent while pending.' },
  },
  required: ['id', 'status', 'useCase', 'contactEmail', 'natum'],
}

export const PartnerSchema: JsonSchema = {
  type: 'object',
  description: "The caller's approved B2B partner record — an ordinary Anima a platform admin has approved. No on-chain agent/treasury concept.",
  properties: {
    animaId: { type: 'string', description: 'The partner Anima, same id GET /v1/me/status reports for.' },
    status: { type: 'string', description: "'active' or 'revoked'. A revoked partner 404s here rather than being returned with this status." },
    org: { type: 'string', description: 'Organization name, if given at request time.' },
    contactEmail: { type: 'string', description: 'Contact email, if given at request time.' },
    sourceRequestId: { type: 'string', description: 'The partner-request this record was provisioned from.' },
    natum: { type: 'string', format: 'date-time', description: 'When this Partner record was created.' },
  },
  required: ['animaId', 'status', 'sourceRequestId', 'natum'],
}

export const StatusViewSchema: JsonSchema = {
  type: 'object',
  description: "The caller's account snapshot — balance, in-flight gens, studios.",
  properties: {
    balanceImpetus: { type: 'string', description: 'Spendable impetus balance, serialised as a string. Excludes anything currently held — see `heldImpetus`.' },
    balanceUsd: { type: 'number', description: 'USD-equivalent balance (informational).' },
    heldImpetus: { type: 'string', description: 'Impetus currently LOCKED against the caller\'s own in-flight runs (the sum of `gens[].heldImpetus`), serialised as a string. Not spendable, not spent — a training run that reserves 7200 against a future charge shows here, not as a silent drop in `balanceImpetus` with nothing to explain it.' },
    heldUsd: { type: 'number', description: 'USD-equivalent of `heldImpetus` (informational).' },
    gens: { type: 'array', description: 'In-flight generation entries.', items: { type: 'object', additionalProperties: true } },
    studios: { type: 'array', description: 'Active studio entries.', items: { type: 'object', additionalProperties: true } },
    joinable: { type: 'array', description: 'Joinable studio invites.', items: { type: 'object', additionalProperties: true } },
    takenAt: { type: 'string', format: 'date-time', description: 'When the snapshot was taken.' },
  },
  required: ['balanceImpetus', 'balanceUsd', 'heldImpetus', 'heldUsd', 'gens', 'studios', 'joinable', 'takenAt'],
}

export const meStatusActivityRoutes: RouteSpec[] = [
    {
      method: 'GET',
      path: '/me/partner',
      summary: "Return the authenticated caller's B2B partner record — an ordinary Anima a platform admin has approved. 404 not_found.partner when the caller has no partner record, or has one but it was revoked (indistinguishable from the caller's side). 503 internal.unavailable when this deployment has no partner directory wired.",
      auth: true,
      response: PartnerSchema,
    },
    {
      method: 'GET',
      path: '/me/partner-request',
      summary: "Return the authenticated caller's most recent B2B partner application and its state, so an applicant can see whether they are pending, approved or declined without waiting to be told. Only applications filed while signed in are visible — an anonymous submission carries no account to match on. 404 not_found.partner_request when this account has filed none. 503 internal.unavailable when this deployment has no partner intake wired.",
      auth: true,
      response: PartnerRequestSchema,
    },
    {
      method: 'GET',
      path: '/me/status',
      summary: "Return the authenticated caller's account snapshot — balance, in-flight gens, and studios.",
      auth: true,
      response: StatusViewSchema,
    },
    {
      method: 'GET',
      path: '/me/runs',
      summary: "The caller's SETTLED spend history — per-run impetus cost (+ derived USD), settledAt, and a lifetime running total. Owner-scoped (identified or anon-commitment), cursor-paginated, newest first. Only completus runs (a refunded failed run is not spend).",
      auth: true,
      query: [
        {
          name: 'cursor',
          description: 'Opaque page cursor: pass the `nextCursor` from the previous response to fetch the next page.',
          schema: { type: 'string' },
        },
        {
          name: 'limit',
          description: 'Page size. Clamped to 1..100; defaults to 20.',
          schema: { type: 'integer' },
        },
      ],
      response: RunsPageSchema,
    },
    {
      method: 'GET',
      path: '/me/earnings',
      summary:
        "What the caller has EARNED — royalties on their flows and models, cuts and bonuses on gens served " +
        "from their pods, referral shares. Returns the lifetime total, the per-stream breakdown, and a " +
        "newest-first page of the individual payments. Owner-scoped by the ledger's own identity key, " +
        "cursor-paginated. Sums every status: a royalty since spent was still earned.",
      auth: true,
      query: [
        {
          name: 'cursor',
          description: 'Opaque page cursor: pass the `nextCursor` from the previous response to fetch the next page of payments.',
          schema: { type: 'string' },
        },
        {
          name: 'limit',
          description: 'Page size. Clamped to 1..100; defaults to 20.',
          schema: { type: 'integer' },
        },
      ],
      response: EarningsViewSchema,
    },
    {
      method: 'GET',
      path: '/me/activity',
      summary: "The caller's activity — in-flight and settled runs in ONE newest-first projection, each row carrying its kind and a door to the artifact it produced. Owner-scoped (identified or anon-commitment), cursor-paginated. In-flight rows ride the first page; the cursor pages settled history.",
      auth: true,
      query: [
        {
          name: 'cursor',
          description: 'Opaque page cursor: pass the `nextCursor` from the previous response to fetch the next page of settled rows.',
          schema: { type: 'string' },
        },
        {
          name: 'limit',
          description: 'Page size. Clamped to 1..100; defaults to 20.',
          schema: { type: 'integer' },
        },
      ],
      response: ActivityPageSchema,
    },
]
