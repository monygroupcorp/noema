import type { JsonSchema, RouteSpec } from './types'

export const FundamentumCardSchema: JsonSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    nomen: { type: 'string', description: 'Display label.' },
    versio: { type: 'string', description: 'Semantic version.' },
    runtime: { type: 'string', description: 'On-pod runtime (e.g. ComfyUI).' },
    imageId: { type: 'string', description: 'Docker image id.' },
    imageVersion: { type: 'string', description: 'Docker image version.' },
    vramGb: { type: 'number', description: 'Minimum VRAM in GB.' },
  },
  required: ['id', 'versio', 'imageId', 'imageVersion'],
}

export const FundamentaListSchema: JsonSchema = {
  type: 'object',
  properties: {
    fundamenta: { type: 'array', items: FundamentumCardSchema },
  },
  required: ['fundamenta'],
}

export const ModelCardSchema: JsonSchema = {
  type: 'object',
  properties: {
    intellaId: { type: 'string' },
    nomen: { type: 'string', description: 'Display name.' },
    genus: { type: 'string', description: 'Weight class (lora, checkpoint, vae, …).' },
    basis: { type: 'string', description: 'Base model family this weight is compatible with.' },
    trigger: { type: 'string', description: 'Trigger words (LoRA only).' },
    description: { type: 'string', description: 'Human-readable description.' },
    access: { type: 'string', enum: ['public', 'private'], description: "Resolvability of the caller's own model (GET /me/models only)." },
    license: { type: 'string', description: "License id, e.g. 'apache-2.0' (owner/admin views)." },
    commercialUse: { type: 'string', enum: ['yes', 'no', 'conditional', 'unknown'], description: 'Whether this model may be promoted to the public (commercial) catalog (owner/admin views).' },
    slug: { type: 'string', description: 'ComfyUI LoRA filename token for explicit <lora:slug:weight> syntax (LoRA only).' },
    defaultWeight: { type: 'number', description: 'Recommended application weight when the caller does not specify one (LoRA only).' },
    samples: { type: 'array', items: { type: 'object', properties: { url: { type: 'string' }, prompt: { type: 'string' } }, required: ['url'] }, description: 'Preview samples: image URL + the prompt it was rendered from.' },
    tags: { type: 'array', items: { type: 'object', properties: { tag: { type: 'string' }, source: { type: 'string' } }, required: ['tag'] }, description: 'Discovery/classification tags.' },
  },
  required: ['intellaId', 'nomen', 'genus'],
}

export const ModelsListSchema: JsonSchema = {
  type: 'object',
  properties: {
    models: { type: 'array', items: ModelCardSchema },
  },
  required: ['models'],
}

export const ModelImportResponseSchema: JsonSchema = {
  type: 'object',
  properties: {
    model: ModelCardSchema,
  },
  required: ['model'],
}

export const ModelImportRequestSchema: JsonSchema = {
  type: 'object',
  description: 'Import a model/LoRA by URL as a private, owner-scoped model — usable in your flows at once; never on the public catalogue until a separate publish promotion passes moderation.',
  properties: {
    url: { type: 'string', description: 'A Civitai page (or ?modelVersionId), a HuggingFace repo, or a direct .safetensors/.ckpt link.' },
    genus: { type: 'string', enum: ['lora', 'model'], description: 'For a direct-file URL where the origin can\'t be scraped to infer it. Default lora.' },
  },
  required: ['url'],
}

export const ModelLicenseRequestSchema: JsonSchema = {
  type: 'object',
  description: 'Admin: set a model\'s license clearance so the public-catalog gate treats it correctly. Provide an explicit license/commercialUse, or reclassify:true to re-derive from the base string.',
  properties: {
    license: { type: 'string', description: "License id to record, e.g. 'apache-2.0', 'stability-community'." },
    commercialUse: { type: 'string', enum: ['yes', 'no', 'conditional', 'unknown'], description: 'The commercial-catalog verdict (the operator\'s clearance decision).' },
    reclassify: { type: 'boolean', description: "Re-derive license + verdict from the model's recorded base string (bulk-fix legacy imports)." },
  },
}

export const RevenueReportSchema: JsonSchema = {
  type: 'object',
  description: 'Admin revenue report: company-wide trailing-12mo USD revenue vs the tightest active conditional-license cap (the tripwire, ADR-0012/0013 §5).',
  properties: {
    asOf: { type: 'string', description: 'ISO timestamp the trailing window was computed against.' },
    trailingUsdRevenueMicro: { type: 'string', description: 'Trailing-12mo USD revenue in micro-USD (exact).' },
    trailingUsdRevenue: { type: 'string', description: 'Trailing-12mo USD revenue, formatted.' },
    band: { type: 'string', enum: ['clear', 'watch', 'warn', 'breach'], description: 'Live band of revenue against the binding cap.' },
    bindingCapUsd: { type: 'number', nullable: true, description: 'Tightest active conditional cap (whole USD), or null when dormant.' },
    activeConditionalLicenses: { type: 'array', items: { type: 'string' }, description: 'Conditional license ids currently reachable in the public catalog.' },
    lastAlertedBand: { type: 'string', enum: ['clear', 'watch', 'warn', 'breach'], nullable: true, description: 'The last band the scheduled evaluator alerted/persisted.' },
  },
  required: ['asOf', 'trailingUsdRevenue', 'band', 'activeConditionalLicenses'],
}

export const CogsReportSchema: JsonSchema = {
  type: 'object',
  description: 'Admin COGS report: trailing-window rollup of per-job costUsd off wide_events — the read-only pair to the revenue report.',
  properties: {
    asOf: { type: 'string', description: 'ISO timestamp the trailing window was computed against.' },
    sinceIso: { type: 'string', description: "ISO timestamp of the trailing window's cutoff (same window the revenue report uses)." },
    costUsd: { type: 'number', description: 'Trailing-window COGS, whole USD (pod compute spend, per-job costUsd summed).' },
    count: { type: 'number', description: 'Job count in the trailing window (includes jobs with no cost telemetry, counted at 0).' },
  },
  required: ['asOf', 'sinceIso', 'costUsd', 'count'],
}

export const fundamentaRoutes: RouteSpec[] = [
    {
      method: 'GET',
      path: '/fundamenta',
      summary: 'List the canonical compute substrates (fundamenta) available for flows.',
      auth: false,
      response: FundamentaListSchema,
    },
]

export const modelsRoutes: RouteSpec[] = [
    {
      method: 'GET',
      path: '/models',
      summary: 'Browse the model weight catalog.',
      auth: false,
      query: [
        { name: 'genus', description: 'Filter by model genus.', schema: { type: 'string' } },
        { name: 'basis', description: 'Filter by model basis.', schema: { type: 'string' } },
        { name: 'fundamentumId', description: 'Filter by compute substrate id.', schema: { type: 'string' } },
        { name: 'trigger', description: 'Filter by trigger word.', schema: { type: 'string' } },
        { name: 'q', description: 'Free-text search query.', schema: { type: 'string' } },
        { name: 'limit', description: 'Maximum number of results to return.', schema: { type: 'integer' } },
        {
          name: 'sort',
          description:
            'Sort order for results: `newest | name | genus`. Applied server-side before the `limit` slice.',
          schema: { type: 'string' },
        },
      ],
      response: ModelsListSchema,
    },
]

export const modelAdminRoutes: RouteSpec[] = [
    {
      method: 'POST',
      path: '/models/import',
      summary: 'Import a model/LoRA by URL (Civitai/HuggingFace/direct) as a private, owner-scoped model — usable in your flows immediately; promoting it to the public catalogue is a separate publish.',
      auth: true,
      request: ModelImportRequestSchema,
      response: ModelImportResponseSchema,
    },
    {
      method: 'GET',
      path: '/me/models',
      summary: "List the caller's own privately-held models (imports + trained LoRAs), newest first — the public /v1/models catalog is canonical-only.",
      auth: true,
      response: ModelsListSchema,
    },
    {
      method: 'PUT',
      path: '/models/:id/license',
      summary: 'Admin: clear or backfill a model\'s license so the public-catalog gate treats it correctly (explicit license/commercialUse, or reclassify from the base). Platform-admin only.',
      auth: true,
      request: ModelLicenseRequestSchema,
      response: ModelImportResponseSchema,
    },
    {
      method: 'GET',
      path: '/admin/revenue',
      summary: 'Admin: company-wide trailing-12mo USD revenue vs the tightest active conditional-license cap (the tripwire). Platform-admin only.',
      auth: true,
      response: RevenueReportSchema,
    },
    {
      method: 'GET',
      path: '/admin/cogs',
      summary: 'Admin: trailing-window rollup of per-job costUsd off wide_events — the read-only pair to the revenue report. Platform-admin only.',
      auth: true,
      response: CogsReportSchema,
    },
]
