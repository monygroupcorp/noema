import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { Readable } from 'node:stream'
import type { R2Config } from './comfyrunnerClient.js'

// =============================================================================
// Uploader — host the bytes a host-side cursor produces, return a public URL
// =============================================================================
//
// GPU-pod cursors upload their outputs to R2 from inside the pod; host-side
// deterministic cursors produce bytes ON the host, so they need to host them
// here. Injected behind an interface so the cursors stay unit-testable with an
// in-memory fake (no S3/network).

export interface Uploader {
  /** Store bytes under `key` and return the public URL. */
  put(key: string, bytes: Buffer, contentType: string): Promise<string>
}

/**
 * ObjectStore — an Uploader that can also DELETE. The publishing `BucketAdapter`
 * needs deletion to honour `retract` (feed/bucket = revocable: unpublish removes
 * the hosted bytes — spec §8/§9). Kept distinct from `Uploader` so the put-only
 * cursors (LayerComposite/Ffmpeg) are unaffected.
 */
export interface ObjectStore extends Uploader {
  /** Delete the object at `key`. Idempotent (deleting a missing key is fine). */
  del(key: string): Promise<void>
  /**
   * Stream bytes to `key` without buffering the whole payload in memory, returning
   * the public URL. Optional — used for large objects like model weights; callers
   * fall back to `put` when absent. `contentLength` is a hint (may be unknown).
   */
  putStream?(key: string, body: Readable, contentType: string, contentLength?: number): Promise<string>
  /**
   * Mint a short-lived presigned PUT URL so a browser can upload bytes straight to
   * the bucket (bypassing the host). Returns the `signedUrl` to `PUT` to, plus the
   * `publicUrl` the object will be reachable at afterwards. Optional — used by the
   * storage/upload front door; callers that only server-side upload never need it.
   */
  getSignedUploadUrl?(
    key: string,
    contentType: string,
    opts?: { expiresIn?: number },
  ): Promise<{ signedUrl: string; publicUrl: string }>
  /**
   * Mint a short-lived presigned GET URL for `key` — an unguessable, expiring grant to
   * DOWNLOAD one private object without making the bucket public. The mirror of
   * `getSignedUploadUrl`; used by the GDPR self-export to hand the caller their own bundle.
   * Optional — callers that only ever upload never need it.
   */
  getSignedDownloadUrl?(key: string, opts?: { expiresIn?: number }): Promise<string>
}

/** The real uploader — Cloudflare R2 via the S3 API (same R2Config the pods use). */
export class R2Uploader implements ObjectStore {
  private readonly s3: S3Client

  constructor(private readonly cfg: R2Config) {
    this.s3 = new S3Client({
      region: 'auto',
      endpoint: cfg.endpoint,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    })
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<string> {
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, Body: bytes, ContentType: contentType }),
    )
    return this.publicUrlFor(key)
  }

  async del(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }))
  }

  /** Multipart streaming upload (lib-storage) — never holds the whole object in
   *  memory. The SDK chunks the stream into parts, so a multi-GB weight file uploads
   *  with a bounded footprint. `contentLength` is unused (multipart needs no length). */
  async putStream(key: string, body: Readable, contentType: string): Promise<string> {
    const upload = new Upload({
      client: this.s3,
      params: { Bucket: this.cfg.bucket, Key: key, Body: body, ContentType: contentType },
    })
    await upload.done()
    return this.publicUrlFor(key)
  }

  /** Presigned PUT (S3 request-presigner). Short TTL (default 5 min) — the URL is
   *  a one-shot upload grant, so it should expire well before it could be shared. */
  async getSignedUploadUrl(
    key: string,
    contentType: string,
    opts?: { expiresIn?: number },
  ): Promise<{ signedUrl: string; publicUrl: string }> {
    const cmd = new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, ContentType: contentType })
    const signedUrl = await getSignedUrl(this.s3, cmd, { expiresIn: opts?.expiresIn ?? 300 })
    return { signedUrl, publicUrl: this.publicUrlFor(key) }
  }

  /** Presigned GET (S3 request-presigner). Short TTL (default 5 min) — a one-shot,
   *  expiring download grant for a private object; the URL should lapse well before it
   *  could be shared. Unguessable (the caller only ever presigns their own owner-scoped key). */
  async getSignedDownloadUrl(key: string, opts?: { expiresIn?: number }): Promise<string> {
    const cmd = new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key })
    return getSignedUrl(this.s3, cmd, { expiresIn: opts?.expiresIn ?? 300 })
  }

  private publicUrlFor(key: string): string {
    const base = (this.cfg.publicUrl ?? `${this.cfg.endpoint}/${this.cfg.bucket}`).replace(/\/$/, '')
    return `${base}/${key}`
  }
}
