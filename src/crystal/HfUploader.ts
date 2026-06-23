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

/** A minimal model card (README) so the repo is non-empty + discoverable. */
export function renderModelCard(model: ModelView): string {
  const lines = [`# ${model.nomen}`, '', `- **type:** ${model.genus}`]
  if (model.familia) lines.push(`- **base:** ${model.familia}`)
  if (model.trigger) lines.push(`- **trigger:** \`${model.trigger}\``)
  lines.push('', '_Published via noema._', '')
  return lines.join('\n')
}

export class HuggingFaceUploader implements RegistryUploader {
  constructor(private readonly deps: { transport: HfTransport; fetcher: MediaFetcher }) {}

  async upload(req: RegistryUploadRequest): Promise<{ externalRef: string }> {
    const repoId = `${req.account}/${req.slug}`
    const { url } = await this.deps.transport.ensureRepo({ repoId, private: req.private })

    // `sources` are priority-ordered MIRRORS of the same weights — upload the primary.
    const source = req.model.sources.find((s) => typeof s?.uri === 'string' && s.uri.length > 0)
    if (!source) throw new Error('hf-uploader: model has no weight source to upload')
    const filename = urlBasename(source.uri, `${req.slug}.safetensors`)

    // Authoritative oid+size by streaming the source once (bounded memory).
    const { oid, size } = await this._digest(source.uri)
    await this.deps.transport.uploadLfs({ repoId, oid, size, fetchBody: () => this._stream(source.uri) })

    await this.deps.transport.commit({
      repoId,
      message: `Upload ${filename}`,
      lfsFiles: [{ pathInRepo: filename, oid, size }],
      textFiles: [{ pathInRepo: 'README.md', content: renderModelCard(req.model) }],
    })
    return { externalRef: url }
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
