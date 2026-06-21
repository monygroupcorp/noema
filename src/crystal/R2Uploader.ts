import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
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
    const base = (this.cfg.publicUrl ?? `${this.cfg.endpoint}/${this.cfg.bucket}`).replace(/\/$/, '')
    return `${base}/${key}`
  }

  async del(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }))
  }
}
