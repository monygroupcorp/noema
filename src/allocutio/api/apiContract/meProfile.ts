import type { JsonSchema, RouteSpec } from './types'
import { BindResponseSchema } from './flows'

export const AppearanceSchema: JsonSchema = {
  type: 'object',
  description: "The owner's presentation skin — all fields optional.",
  properties: {
    avatarUrl: { type: 'string', description: 'PFP / avatar image URL.' },
    bannerUrl: { type: 'string', description: 'Banner image URL.' },
    backgroundUrl: { type: 'string', description: 'Background image URL.' },
    accent: { type: 'string', description: 'One signal color (hex).' },
    look: { type: 'string', description: "Signature look tag (e.g. 'clean' | 'n64' | 'vapor' | 'editorial')." },
  },
}

export const GeneratioSchema: JsonSchema = {
  type: 'object',
  description: "The owner's cross-cutting generation defaults, applied at cast time — all optional.",
  properties: {
    style: { type: 'string', description: 'Prepended to the prompt when the flow has a prompt input.' },
    negativePrompt: { type: 'string', description: "Fills a flow's negative-prompt input when the caller didn't provide one." },
    outputFormat: { type: 'string', description: 'Preferred output encoding (stored; runner-applied where supported).' },
    telegramDeliverAs: { type: 'string', enum: ['album', 'individual'], description: 'Telegram delivery shape (consumed by the Telegram adapter).' },
    autoApplyModels: { type: 'array', items: { type: 'string' }, description: 'Models (intellaId) to auto-apply as pinnedModels. Stored; cast-time application pending model resolution.' },
    defaultProjectId: { type: 'string', description: 'Default project (Provincia id) new work files into. Stored; cast-time auto-filing pending.' },
    spicyMode: { type: 'boolean', description: 'Adult ("spicy") mode. When ON — and an 18+ attestation is on file — permits adult-rated models, routes concierge chat to willing OpenRouter models, and relaxes SFW-forcing default negatives. Default-absent = OFF. Enabling requires a recorded 18+ attestation (POST /v1/me/attestation) — this PUT rejects with auth.forbidden otherwise.' },
    ageAttestation: {
      type: 'object',
      description: 'One-time self-declared 18+ attestation (a click-through fact, NOT KYC/ID verification). Required on file before spicyMode may be enabled. Recorded via POST /v1/me/attestation; preserved across a Preferences replace.',
      properties: { attestedAt: { type: 'number', description: 'Epoch-ms timestamp of the attestation.' } },
      required: ['attestedAt'],
    },
    memoryNotes: { type: 'array', items: { type: 'string' }, description: "Short lines the concierge remembers about the caller between threads. Proposed by the agent as a turn-end delta and written by the CLIENT through this PUT; listed and editable on the Preferences screen. Capped server-side at 20 lines of 200 characters — a longer list is truncated to the newest 20 and each line to 200 characters rather than rejected. Deleted with the account." },
    termsAccepted: {
      type: 'object',
      description: "Upstream licence terms the caller has accepted, keyed by terms id (e.g. 'minimax-h3'), each with the version accepted. A flow that carries terms runs only when the entry matches their current version. Written only by POST /v1/me/terms/:id — this PUT ignores it and keeps the stored record.",
      additionalProperties: {
        type: 'object',
        properties: {
          versio: { type: 'string', description: 'The terms version accepted.' },
          acceptedAt: { type: 'number', description: 'Epoch-ms timestamp of the acceptance.' },
        },
        required: ['versio', 'acceptedAt'],
      },
    },
    privateOutputs: { type: 'boolean', description: 'Private generation. When ON, the outputs of NEW runs are written to a bucket with no public binding; the run record carries an opaque marker and an owner-scoped run read returns a short-lived expiring link instead. Default-absent = OFF (outputs are public). Forward-only: objects already written stay where they are. Requires the deployment to have a private-outputs bucket — this PUT rejects with internal.unavailable otherwise.' },
  },
}

export const TermsAcceptanceResponseSchema: JsonSchema = {
  type: 'object',
  description: "The caller's recorded acceptance of a flow's upstream licence terms.",
  properties: {
    acceptance: {
      type: 'object',
      properties: {
        terms: { type: 'string', description: "The terms id (e.g. 'minimax-h3')." },
        versio: { type: 'string', description: 'The terms version accepted — the current one.' },
        acceptedAt: { type: 'number', description: 'Epoch-ms timestamp of the acceptance.' },
      },
      required: ['terms', 'versio', 'acceptedAt'],
    },
  },
  required: ['acceptance'],
}

export const AttestationResponseSchema: JsonSchema = {
  type: 'object',
  description: "The caller's recorded 18+ self-attestation (a click-through fact, not KYC).",
  properties: {
    attestation: {
      type: 'object',
      properties: { attestedAt: { type: 'number', description: 'Epoch-ms timestamp of the attestation.' } },
      required: ['attestedAt'],
    },
  },
  required: ['attestation'],
}

export const SecretPresenceSchema: JsonSchema = {
  type: 'object',
  description: 'BYO gated-origin credential connect state, per provider.',
  properties: {
    civitai: { type: 'string', enum: ['connected', 'absent'], description: 'Civitai token connect state.' },
    huggingface: { type: 'string', enum: ['connected', 'absent'], description: 'HuggingFace token connect state.' },
  },
  required: ['civitai', 'huggingface'],
}

export const MeViewSchema: JsonSchema = {
  type: 'object',
  description: "The caller's identity + balance + owner-keyed account settings — appearance + generation defaults + verb bindings.",
  properties: {
    animaId: { type: 'string', description: 'The caller\'s anima id, when identified. Absent for an anonymous/purse caller.' },
    username: { type: 'string', description: 'The caller\'s fiat username, when they authenticated with a password persona. Absent for wallet-only, telegram-only, or anonymous/purse callers.' },
    appearance: AppearanceSchema,
    generatio: GeneratioSchema,
    bindings: { type: 'array', items: BindResponseSchema, description: 'The verb→flow overrides the owner has set.' },
    secrets: SecretPresenceSchema,
    secretsAvailable: { type: 'boolean', description: 'Whether this deployment can store BYO secrets (a secret store is wired). false → connecting is unavailable here; hide/disable the panel.' },
    admin: { type: 'boolean', description: 'Whether this caller is the platform administrator (the moderation reviewer). Gates the feed-review surface + approve/reject/confirm-csam controls. true only on the platform session.' },
    balanceImpetus: { type: 'string', description: 'Spendable impetus balance, serialised as a string. Same source GET /v1/me/status reports.' },
    balanceUsd: { type: 'number', description: 'USD-equivalent balance (informational). Same source as GET /v1/me/status.' },
  },
  required: ['bindings', 'secrets', 'secretsAvailable', 'admin', 'balanceImpetus', 'balanceUsd'],
}

export const PutSecretRequestSchema: JsonSchema = {
  type: 'object',
  description: 'Connect a BYO gated-origin credential. The token is sealed at rest at once and never echoed back.',
  properties: {
    token: { type: 'string', description: 'The provider API token/key (Civitai key or HuggingFace token).' },
    idleDays: { type: 'number', description: 'Idle-expiry window in days (default 90). The secret is forgotten after this long without a real use.' },
  },
  required: ['token'],
}

export const SecretViewSchema: JsonSchema = {
  type: 'object',
  description: 'Connect/disconnect result. Never includes the token.',
  properties: {
    provider: { type: 'string', enum: ['civitai', 'huggingface'], description: 'The provider affected.' },
    status: { type: 'string', enum: ['connected', 'absent'], description: 'The resulting connect state.' },
    expiresAt: { type: 'string', description: 'Idle-expiry deadline (ISO) — present when connected.' },
    warning: { type: 'string', description: 'Deanonymization caution — present for anonymous (purse) callers.' },
  },
  required: ['provider', 'status'],
}

export const AffinesEnvelopeSchema: JsonSchema = {
  type: 'object',
  description: "Per-flow input defaults (`{ inputKey: value }`) applied under the cast-time aditus.",
  properties: { affines: { type: 'object', additionalProperties: true, description: 'Input-key → default value map.' } },
  required: ['affines'],
}

export const meProfileRoutes: RouteSpec[] = [
    {
      method: 'GET',
      path: '/me',
      summary: "The caller's owner-keyed account settings — presentation skin (Profile), cross-cutting generation defaults (Preferences), and verb→flow bindings. Anon-capable (keyed by AuctorKey).",
      auth: true,
      response: MeViewSchema,
    },
    {
      method: 'POST',
      path: '/me/export',
      summary: "GDPR self-export — assemble the caller's OWN account data into a downloadable JSON bundle (strictly self-scoped to the caller) and return a short-lived, unguessable signed GET URL to it. Returns 503 when object storage is not configured.",
      auth: true,
      response: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Short-lived, unguessable signed GET URL to the hosted export bundle — the only handle returned (the raw object key is withheld so the response cannot be turned into a stable path).' },
          expiresIn: { type: 'number', description: 'Seconds until the signed URL expires.' },
          bytes: { type: 'number', description: 'Size of the serialized JSON bundle in bytes.' },
        },
        required: ['url', 'expiresIn', 'bytes'],
      },
    },
    {
      method: 'PUT',
      path: '/me/appearance',
      summary: "Replace the caller's presentation skin (avatar/banner/background/accent/look).",
      auth: true,
      request: AppearanceSchema,
      response: { type: 'object', properties: { appearance: AppearanceSchema }, required: ['appearance'] },
    },
    {
      method: 'PUT',
      path: '/me/generatio',
      summary: "Replace the caller's cross-cutting generation defaults (style, negative prompt, output format, telegram delivery, auto-apply models, spicy mode, private generation). Applied at cast time under the affines precedence chain. Enabling spicyMode requires a recorded 18+ attestation on file (else auth.forbidden); a recorded attestation is preserved across a replace. Enabling privateOutputs requires a deployment with a private-outputs bucket (else internal.unavailable).",
      auth: true,
      request: GeneratioSchema,
      response: { type: 'object', properties: { generatio: GeneratioSchema }, required: ['generatio'] },
    },
    {
      method: 'POST',
      path: '/me/attestation',
      summary: "Record the caller's one-time 18+ self-attestation (a click-through fact, NOT KYC/ID verification). Required on file before spicy mode may be enabled. Anon-capable (keyed by AuctorKey — anonymous Bursa/commitment and named Anima callers both).",
      auth: true,
      response: AttestationResponseSchema,
    },
    {
      method: 'POST',
      path: '/me/terms/:id',
      summary: "Accept the current version of a flow's upstream licence terms (e.g. 'minimax-h3', MiniMax H3's use restrictions, published at /legal/terms#minimax-h3). A flow that carries terms refuses to run with terms.required until this is on file, and with terms.suspended once the caller is suspended under them after repeated confirmed violations. Anon-capable (keyed by AuctorKey). An unknown terms id is not_found.terms.",
      auth: true,
      response: TermsAcceptanceResponseSchema,
    },
    {
      method: 'PUT',
      path: '/me/secrets/:provider',
      summary: 'Connect a BYO gated-origin credential (civitai|huggingface) so gated model imports can download their weights. The token is sealed at rest at once and never echoed back. Anon-capable (a Bursa purse is a valid owner); anonymous callers receive a deanonymization warning.',
      auth: true,
      request: PutSecretRequestSchema,
      response: SecretViewSchema,
    },
    {
      method: 'DELETE',
      path: '/me/secrets/:provider',
      summary: 'Disconnect the caller\'s BYO credential for a provider (civitai|huggingface). Idempotent.',
      auth: true,
      response: SecretViewSchema,
    },
    {
      method: 'GET',
      path: '/me/affines/:modusId',
      summary: "The caller's per-flow input defaults for one flow (`{ inputKey: value }`).",
      auth: true,
      response: AffinesEnvelopeSchema,
    },
    {
      method: 'PUT',
      path: '/me/affines/:modusId',
      summary: "Replace the caller's per-flow input defaults for one flow. Applied under the cast-time aditus (cast-time > affines > generatio > modus defaults).",
      auth: true,
      request: AffinesEnvelopeSchema,
      response: AffinesEnvelopeSchema,
    },
]
