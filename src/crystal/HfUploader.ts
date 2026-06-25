// =============================================================================
// HfUploader — push a model's weights to HuggingFace via Git LFS
// =============================================================================
//
// A concrete `RegistryUploader` (roadmap Tier 2 #3) that runs INSIDE the
// PublicationWorker's settle, so a multi-GB upload is durable + off the request
// path. It is HF-specific, but plugs into the platform-agnostic upload seam — the
// `ModelPublishAdapter` neither knows nor cares that this is HuggingFace.
//
// SPLIT for testability:
//   - `HuggingFaceUploader` — the ORCHESTRATION (ensure repo → digest → LFS upload
//     → commit). Pure logic over an injected `HfTransport` + `MediaFetcher`; fully
//     hermetically tested with fakes.
//   - `HfHttpTransport` — the REAL HF HTTP (repo create, the 3-step LFS batch
//     protocol, the commit API). Isolated here, and LIVE-UNVERIFIED: it cannot be
//     exercised hermetically (needs HF_TOKEN + network), so it carries the only
//     untested surface. PLACEHOLDER(publishing#3): verify against real HF before
//     relying on it.
//
// Weights stream end-to-end (reuses the #2 `fetchStream` primitive): the digest
// pass and the LFS PUT each read the source as a stream, never buffering the whole
// file. Idempotent: `ensureRepo` is repo-exists-guarded and the LFS batch returns no
// upload action for an object already present, so a worker retry re-runs safely.
// =============================================================================

import { createHash } from 'node:crypto'
import type { Readable } from 'node:stream'
import type { RegistryUploader, RegistryUploadRequest, ModelView } from './ModelPublishAdapter.js'
import type { MediaFetcher } from './MediaFetcher.js'

/** One file's LFS pointer in a commit. */
export interface LfsFile { pathInRepo: string; oid: string; size: number }
/** One small (inline) file in a commit — e.g. the model card. */
export interface TextFile { pathInRepo: string; content: string }

/**
 * HfTransport — the HuggingFace I/O seam. Injected so the uploader's orchestration
 * is testable with a fake; the real impl is `HfHttpTransport`.
 */
export interface HfTransport {
  /** Create the model repo if absent (idempotent). Returns its canonical URL. */
  ensureRepo(args: { repoId: string; private: boolean }): Promise<{ url: string }>
  /** Upload one object via Git LFS (batch → PUT → verify). A no-op if HF reports the
   *  object already present. `fetchBody` yields a FRESH byte stream for the PUT. */
  uploadLfs(args: { repoId: string; oid: string; size: number; fetchBody: () => Promise<{ body: Readable }> }): Promise<void>
  /** Commit the uploaded LFS pointers (+ any inline text files) to the repo. */
  commit(args: { repoId: string; message: string; lfsFiles: LfsFile[]; textFiles?: TextFile[] }): Promise<void>
}

/** Basename of a URL (query/fragment stripped), or a fallback. */
function urlBasename(url: string, fallback: string): string {
  const seg = url.split('?')[0].split('#')[0].split('/').pop() ?? ''
  return seg || fallback
}

/** Image extension from a URL basename (lowercased), or `.png` when absent/unknown. */
function urlImageExt(url: string): string {
  const base = urlBasename(url, '')
  const dot = base.lastIndexOf('.')
  const ext = dot >= 0 ? base.slice(dot).toLowerCase() : ''
  return ['.png', '.jpg', '.jpeg', '.webp'].includes(ext) ? ext : '.png'
}

// ---------------------------------------------------------------------------
// Model card — frontmatter + body, matching the StationThis card format.
// Training details are DERIVED from a per-base-model facts table (keyed by the
// Intella `familia`), so the card can never drift from what the trainer actually
// ran; the few run-specific bits (steps, description, samples, provenance) thread
// in via the optional ModelView fields and degrade gracefully when absent.
// ---------------------------------------------------------------------------

interface BaseFacts {
  /** Display name in prose, e.g. "FLUX.2 [klein] 4B". */
  displayBase: string
  /** HF repo for the `base_model` frontmatter + load (the trainable/base checkpoint). */
  baseRepo: string
  /** HF repo to load for inference in the usage snippet. */
  inferenceRepo: string
  /** diffusers pipeline class for the usage snippet. */
  pipelineClass: string
  /** SPDX-ish license id for the frontmatter. */
  license: string
  /** Discovery tags. */
  tags: string[]
  rank: number
  lr: string
  /** Multi-res bucket list, as a display string. */
  resolution: string
}

const KLEIN_4B: BaseFacts = {
  displayBase: 'FLUX.2 [klein] 4B',
  baseRepo: 'black-forest-labs/FLUX.2-klein-base-4B',
  inferenceRepo: 'black-forest-labs/FLUX.2-klein-4B',
  pipelineClass: 'Flux2Pipeline',
  license: 'apache-2.0',
  tags: ['text-to-image', 'lora', 'diffusers', 'flux2', 'klein', 'flowmatch', 'stationthis'],
  rank: 32, lr: '1e-4', resolution: '512, 768, 1024',
}

const FLUX1_DEV: BaseFacts = {
  displayBase: 'FLUX.1 [dev]',
  baseRepo: 'black-forest-labs/FLUX.1-dev',
  inferenceRepo: 'black-forest-labs/FLUX.1-dev',
  pipelineClass: 'FluxPipeline',
  license: 'wtfpl',
  tags: ['text-to-image', 'lora', 'diffusers', 'flux', 'flowmatch', 'stationthis'],
  rank: 32, lr: '1e-4', resolution: '512, 768, 1024',
}

/** Map an Intella `familia` to its card facts. Unknown familiae fall back to FLUX.1 [dev]. */
function baseFacts(familia?: string): BaseFacts {
  const f = (familia ?? '').toLowerCase()
  if (f.includes('klein') || f.includes('flux2')) return KLEIN_4B
  return FLUX1_DEV
}

/**
 * Render the model card (README) — frontmatter + the StationThis body (description,
 * trigger, sample gallery, usage, settings, training details, about). `repoId` is the
 * `account/slug` used in the load snippet; falls back to the model slug.
 */
/** One-line, pipe-safe, truncated caption — dataset-derived prompts are long + multi-paragraph,
 *  which breaks markdown table cells and bloats widget text. Collapse whitespace, escape `|`, clip. */
function galleryCaption(s: string, n = 90): string {
  const one = s.replace(/\s+/g, ' ').replace(/\|/g, '/').trim()
  return one.length > n ? `${one.slice(0, n - 1).trimEnd()}…` : one
}

export function renderModelCard(model: ModelView, repoId?: string): string {
  const facts = baseFacts(model.familia)
  const trigger = model.trigger ?? ''
  const repo = repoId ?? model.slug ?? model.nomen

  // ── frontmatter ──────────────────────────────────────────────────────────
  const fm: string[] = [
    '---',
    `license: ${facts.license}`,
    `base_model: ${facts.baseRepo}`,
    'base_model_relation: adapter',
    'pipeline_tag: text-to-image',
    `tags: [${facts.tags.join(', ')}]`,
  ]
  if (trigger) fm.push(`instance_prompt: ${JSON.stringify(trigger)}`)   // quoted — a numeric-looking trigger (e.g. "333") must stay a YAML string, else HF rejects the card
  if (model.trainingSteps) fm.push(`training_steps: ${model.trainingSteps}`)
  fm.push('network_type: lora', 'library_name: ai-toolkit')
  // widget → HF renders the first output as the model's preview thumbnail (uniform org grid, like the old cards).
  if (model.samples && model.samples.length > 0) {
    fm.push('widget:')
    for (const s of model.samples) {
      fm.push(`- text: ${JSON.stringify(galleryCaption(s.prompt ?? trigger, 120))}`, '  output:', `    url: ${s.pathInRepo}`)
    }
  }
  fm.push('---', '')

  // ── body ─────────────────────────────────────────────────────────────────
  const body: string[] = [`# ${model.nomen}`, '']
  body.push(model.description?.trim() || `A LoRA for ${facts.displayBase}.`, '')
  if (trigger) body.push(`**Trigger word:** \`${trigger}\``)
  if (model.provenance) {
    const from = model.provenance.base ? ` (${model.provenance.base})` : ''
    body.push(`_Retrained onto ${facts.displayBase} from [${model.provenance.repo}](https://huggingface.co/${model.provenance.repo})${from}._`)
  }
  body.push('')

  // Sample gallery (2-col), when previews were generated + committed.
  if (model.samples && model.samples.length > 0) {
    body.push('## Sample Outputs', '')
    for (let i = 0; i < model.samples.length; i += 2) {
      const row = model.samples.slice(i, i + 2)
      body.push(`| ${row.map(s => `![sample](${s.pathInRepo})`).join(' | ')} |`)
      body.push(`|${row.map(() => ':---:').join('|')}|`)
      if (row.some(s => s.prompt)) body.push(`| ${row.map(s => (s.prompt ? `*${galleryCaption(s.prompt)}*` : '')).join(' | ')} |`)
    }
    body.push('')
  }

  // Usage.
  body.push(
    '## Usage (Diffusers)', '',
    '```python',
    'import torch',
    `from diffusers import ${facts.pipelineClass}`,
    '',
    `pipe = ${facts.pipelineClass}.from_pretrained(`,
    `    "${facts.inferenceRepo}", torch_dtype=torch.bfloat16`,
    ').to("cuda")',
    `pipe.load_lora_weights("${repo}")`,
    `image = pipe("${trigger ? `${trigger}, ` : ''}a character portrait", guidance_scale=4.0, num_inference_steps=25).images[0]`,
    'image.save("out.png")',
    '```', '',
    '## Recommended Settings', '',
    '| LoRA strength | Guidance | Steps | Resolution |',
    '|---|---|---|---|',
    '| 0.8–1.0 | 4.0 | 25 | 1024×1024 |', '',
    '## Training Details', '',
    `- **Base:** ${facts.baseRepo}`,
    `- **Steps:** ${model.trainingSteps ?? 'n/a'} · **Network:** LoRA rank ${facts.rank} / alpha ${facts.rank}`,
    `- **Optimizer:** adamw8bit, lr ${facts.lr} · **Scheduler:** flowmatch`,
    `- **Resolution:** ${facts.resolution} (multi-res bucketed) · **Precision:** bf16 train / fp16 save`, '',
  )
  if ((model.datasetItems && model.datasetItems.length > 0) || model.configYaml) {
    const bits: string[] = []
    if (model.datasetItems?.length) bits.push(`the full **\`dataset/\`** (${model.datasetItems.length} image-caption pairs)`)
    if (model.configYaml) bits.push('the exact **\`config.yaml\`**')
    body.push('## Reproduction', '', `This repo includes ${bits.join(' and ')} so the LoRA can be retrained as-is.`, '')
  }
  body.push(
    '## About', '',
    'Trained on [StationThis](https://miladystation2.net) — an AI creative platform powered by $MS2.',
    'Train your own LoRAs via [@stationthisbot](https://t.me/stationthisbot) on Telegram.', '',
    '<sub>Published via noema.</sub>', '',
  )

  return [...fm, ...body].join('\n')
}

export class HuggingFaceUploader implements RegistryUploader {
  constructor(private readonly deps: { transport: HfTransport; fetcher: MediaFetcher }) {}

  async upload(req: RegistryUploadRequest): Promise<{ externalRef: string }> {
    const repoId = `${req.account}/${req.slug}`
    const { url } = await this.deps.transport.ensureRepo({ repoId, private: req.private })
    const model = req.model

    // `sources` are priority-ordered MIRRORS of the same weights — upload the primary.
    const source = model.sources.find((s) => typeof s?.uri === 'string' && s.uri.length > 0)
    if (!source) throw new Error('hf-uploader: model has no weight source to upload')
    const filename = urlBasename(source.uri, `${req.slug}.safetensors`)

    // All binary artifacts (weights + sample/dataset images) go via Git-LFS — robust at any
    // size (a 46-image dataset would blow up a single inline commit). Text (captions, config,
    // README) is committed inline.
    const lfsFiles: LfsFile[] = [await this._lfs(repoId, source.uri, filename)]
    const textFiles: TextFile[] = []

    // Preview samples → samples/sample_NNN.<ext> (the card gallery references these paths).
    for (const s of model.samples ?? []) {
      lfsFiles.push(await this._lfs(repoId, s.url, s.pathInRepo))
    }
    // Training dataset → dataset/NNNN.<ext> + the caption sidecar, for reproduction.
    const dataset = model.datasetItems ?? []
    for (let i = 0; i < dataset.length; i++) {
      const stem = `dataset/${String(i).padStart(4, '0')}`
      lfsFiles.push(await this._lfs(repoId, dataset[i].url, `${stem}${urlImageExt(dataset[i].url)}`))
      const caption = dataset[i].caption?.trim()
      if (caption) textFiles.push({ pathInRepo: `${stem}.txt`, content: caption })
    }
    // The training config, for reproduction.
    if (model.configYaml?.trim()) textFiles.push({ pathInRepo: 'config.yaml', content: model.configYaml })

    // README last — the card references the sample paths committed above.
    textFiles.push({ pathInRepo: 'README.md', content: renderModelCard(model, repoId) })

    await this.deps.transport.commit({ repoId, message: `Publish ${req.slug}`, lfsFiles, textFiles })
    return { externalRef: url }
  }

  /** Upload one URL's bytes via Git-LFS and return its commit pointer. */
  private async _lfs(repoId: string, url: string, pathInRepo: string): Promise<LfsFile> {
    const { oid, size } = await this._digest(url)
    await this.deps.transport.uploadLfs({ repoId, oid, size, fetchBody: () => this._stream(url) })
    return { pathInRepo, oid, size }
  }

  private async _stream(url: string): Promise<{ body: Readable }> {
    if (!this.deps.fetcher.fetchStream) throw new Error('hf-uploader: fetcher has no streaming support')
    return this.deps.fetcher.fetchStream(url)
  }

  /** Stream the source once → its sha256 oid + byte size (LFS needs both up front). */
  private async _digest(url: string): Promise<{ oid: string; size: number }> {
    const { body } = await this._stream(url)
    const hash = createHash('sha256')
    let size = 0
    for await (const chunk of body) {
      const b = chunk as Buffer
      hash.update(b)
      size += b.length
    }
    return { oid: hash.digest('hex'), size }
  }
}

// ---------------------------------------------------------------------------
// HfHttpTransport — the REAL HuggingFace HTTP. LIVE-UNVERIFIED (no token in tests).
// PLACEHOLDER(publishing#3): verify against real HF before relying on it.
// ---------------------------------------------------------------------------

const HF_BASE = 'https://huggingface.co'

export class HfHttpTransport implements HfTransport {
  private readonly base: string
  constructor(private readonly deps: { token: string; apiBase?: string }) {
    this.base = deps.apiBase ?? HF_BASE
  }

  private auth(): Record<string, string> {
    return { Authorization: `Bearer ${this.deps.token}` }
  }

  async ensureRepo({ repoId, private: isPrivate }: { repoId: string; private: boolean }): Promise<{ url: string }> {
    const head = await fetch(`${this.base}/api/models/${repoId}`, { headers: this.auth() })
    if (head.ok) return { url: `${this.base}/${repoId}` } // already exists → idempotent
    const slash = repoId.indexOf('/')
    const organization = repoId.slice(0, slash)
    const name = repoId.slice(slash + 1)
    const res = await fetch(`${this.base}/api/repos/create`, {
      method: 'POST',
      headers: { ...this.auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, organization, type: 'model', private: isPrivate }),
    })
    if (!res.ok) throw new Error(`hf createRepo ${repoId}: ${res.status} ${await res.text()}`)
    return { url: `${this.base}/${repoId}` }
  }

  async uploadLfs({ repoId, oid, size, fetchBody }: { repoId: string; oid: string; size: number; fetchBody: () => Promise<{ body: Readable }> }): Promise<void> {
    // 1. LFS batch — ask HF where (and whether) to upload this object.
    const batch = await fetch(`${this.base}/${repoId}.git/info/lfs/objects/batch`, {
      method: 'POST',
      headers: { ...this.auth(), 'Content-Type': 'application/vnd.git-lfs+json', Accept: 'application/vnd.git-lfs+json' },
      body: JSON.stringify({ operation: 'upload', transfers: ['basic'], hash_algo: 'sha256', objects: [{ oid, size }] }),
    })
    if (!batch.ok) throw new Error(`hf lfs batch ${repoId}: ${batch.status} ${await batch.text()}`)
    const obj = ((await batch.json()) as { objects?: Array<{ actions?: { upload?: { href: string; header?: Record<string, string> }; verify?: { href: string; header?: Record<string, string> } } }> }).objects?.[0]
    const upload = obj?.actions?.upload
    if (!upload) return // no upload action → object already present (idempotent)

    // 2. PUT the bytes to the (usually presigned) href — streamed, no buffering.
    const { body } = await fetchBody()
    const put = await fetch(upload.href, {
      method: 'PUT',
      headers: { ...(upload.header ?? {}), 'Content-Length': String(size) },
      // Node fetch (undici) streams a Readable body with duplex:'half'.
      body: body as unknown as BodyInit,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })
    if (!put.ok) throw new Error(`hf lfs put ${repoId}/${oid}: ${put.status}`)

    // 3. Verify, when HF asks for it.
    const verify = obj?.actions?.verify
    if (verify) {
      const v = await fetch(verify.href, {
        method: 'POST',
        headers: { ...(verify.header ?? {}), 'Content-Type': 'application/vnd.git-lfs+json' },
        body: JSON.stringify({ oid, size }),
      })
      if (!v.ok) throw new Error(`hf lfs verify ${repoId}/${oid}: ${v.status}`)
    }
  }

  async commit({ repoId, message, lfsFiles, textFiles }: { repoId: string; message: string; lfsFiles: LfsFile[]; textFiles?: TextFile[] }): Promise<void> {
    // NDJSON commit: header, then inline text files, then LFS pointers.
    const lines: string[] = [JSON.stringify({ key: 'header', value: { summary: message } })]
    for (const f of textFiles ?? []) {
      lines.push(JSON.stringify({ key: 'file', value: { path: f.pathInRepo, content: Buffer.from(f.content, 'utf-8').toString('base64'), encoding: 'base64' } }))
    }
    for (const f of lfsFiles) {
      lines.push(JSON.stringify({ key: 'lfsFile', value: { path: f.pathInRepo, algo: 'sha256', oid: f.oid, size: f.size } }))
    }
    const res = await fetch(`${this.base}/api/models/${repoId}/commit/main`, {
      method: 'POST',
      headers: { ...this.auth(), 'Content-Type': 'application/x-ndjson' },
      body: lines.join('\n'),
    })
    if (!res.ok) throw new Error(`hf commit ${repoId}: ${res.status} ${await res.text()}`)
  }
}
