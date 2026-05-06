const fs = require('fs');
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { Upload } = require('@aws-sdk/lib-storage');

const DEFAULT_TTL_SEC = 24 * 60 * 60;

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.txt': 'text/plain',
  '.json': 'application/json'
};

function inferContentType(filename) {
  const ext = path.extname(filename || '').toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

function sanitizeSegment(seg) {
  return String(seg).replace(/[^a-zA-Z0-9._-]/g, '_');
}

class OutputUploader {
  constructor({ logger, defaultTtlSec, dryRun } = {}) {
    this.logger = logger || console;
    this.defaultTtlSec = defaultTtlSec || DEFAULT_TTL_SEC;
    this.dryRun = !!dryRun || process.env.OUTPUT_UPLOADER_DRYRUN === '1';

    this.bucket = process.env.R2_OUTPUTS_BUCKET || process.env.R2_BUCKET_NAME;
    this.accountId = process.env.R2_ACCOUNT_ID;
    this.accessKeyId = process.env.R2_ACCESS_KEY_ID;
    this.secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

    if (this.dryRun) {
      this.s3Client = null;
      return;
    }

    if (!this.accountId || !this.accessKeyId || !this.secretAccessKey || !this.bucket) {
      this.logger.warn('[OutputUploader] R2 env not configured; uploader disabled.');
      this.s3Client = null;
      return;
    }

    this.s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${this.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.secretAccessKey
      }
    });
  }

  buildKey({ accountId, jobId, filename }) {
    if (!accountId) throw new Error('OutputUploader: accountId required');
    if (!jobId) throw new Error('OutputUploader: jobId required');
    if (!filename) throw new Error('OutputUploader: filename required');
    return `outputs/${sanitizeSegment(accountId)}/${sanitizeSegment(jobId)}/${sanitizeSegment(filename)}`;
  }

  async getSignedUrl(key, ttlSec) {
    const expiresIn = ttlSec || this.defaultTtlSec;
    if (this.dryRun || !this.s3Client) {
      const sig = crypto.createHash('sha256').update(`${this.bucket || 'dryrun'}|${key}|${expiresIn}`).digest('hex').slice(0, 32);
      return `https://dryrun.r2.local/${this.bucket || 'outputs'}/${key}?X-Amz-Expires=${expiresIn}&X-Amz-Signature=${sig}`;
    }
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.s3Client, cmd, { expiresIn });
  }

  async uploadBuffer({ accountId, jobId, filename, buffer, contentType, ttlSec }) {
    if (!Buffer.isBuffer(buffer)) {
      throw new Error('OutputUploader.uploadBuffer: buffer must be a Buffer');
    }
    const key = this.buildKey({ accountId, jobId, filename });
    const ct = contentType || inferContentType(filename);
    const expiresIn = ttlSec || this.defaultTtlSec;

    if (!this.dryRun) {
      if (!this.s3Client) throw new Error('OutputUploader is not configured.');
      await new Upload({
        client: this.s3Client,
        params: { Bucket: this.bucket, Key: key, Body: buffer, ContentType: ct }
      }).done();
    }

    const signedUrl = await this.getSignedUrl(key, expiresIn);
    return {
      key,
      signedUrl,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString()
    };
  }

  async uploadFromPod({ sshConnection, accountId, jobId, remotePaths, ttlSec }) {
    if (!Array.isArray(remotePaths) || remotePaths.length === 0) {
      throw new Error('OutputUploader.uploadFromPod: remotePaths must be a non-empty array');
    }
    if (!this.dryRun && (!sshConnection || typeof sshConnection.download !== 'function')) {
      throw new Error('OutputUploader.uploadFromPod: sshConnection.download() required');
    }

    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), `output-upload-${sanitizeSegment(jobId)}-`));
    const results = [];
    try {
      for (const remotePath of remotePaths) {
        const filename = path.basename(remotePath);
        const localPath = path.join(tmpDir, filename);

        let size = 0;
        let buffer;
        if (this.dryRun) {
          buffer = Buffer.from(`dryrun:${remotePath}`);
          size = buffer.length;
        } else {
          await sshConnection.download(remotePath, localPath, { stdio: 'pipe' });
          const stat = await fsp.stat(localPath);
          size = stat.size;
          buffer = await fsp.readFile(localPath);
        }

        const uploaded = await this.uploadBuffer({
          accountId,
          jobId,
          filename,
          buffer,
          ttlSec
        });

        results.push({
          filename,
          key: uploaded.key,
          size,
          signedUrl: uploaded.signedUrl,
          expiresAt: uploaded.expiresAt
        });
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
    return results;
  }
}

module.exports = OutputUploader;

if (require.main === module) {
  (async () => {
    const dryRun = process.env.OUTPUT_UPLOADER_DRYRUN === '1';
    const uploader = new OutputUploader({ dryRun });

    const sample = {
      accountId: 'acct_42',
      jobId: 'job_abc/../weird',
      filename: 'render 01.png'
    };
    const key = uploader.buildKey(sample);
    console.log('[smoke] key =', key);

    const signed = await uploader.getSignedUrl(key, 3600);
    console.log('[smoke] signed url =', signed);

    if (dryRun) {
      const fakePodResult = await uploader.uploadFromPod({
        sshConnection: null,
        accountId: 'acct_42',
        jobId: 'job_abc',
        remotePaths: ['/workspace/output/render_001.png', '/workspace/output/render_002.png'],
        ttlSec: 600
      });
      console.log('[smoke] uploadFromPod (dryrun):');
      for (const r of fakePodResult) console.log('  ', r);

      const buf = Buffer.from('hello world');
      const bufRes = await uploader.uploadBuffer({
        accountId: 'acct_42',
        jobId: 'job_abc',
        filename: 'hello.txt',
        buffer: buf,
        ttlSec: 60
      });
      console.log('[smoke] uploadBuffer (dryrun):', bufRes);
      process.exit(0);
    }

    if (!uploader.s3Client) {
      console.log('[smoke] no R2 creds present; set OUTPUT_UPLOADER_DRYRUN=1 to run dry.');
      process.exit(1);
    }

    const buf = Buffer.from(`OutputUploader live smoke ${new Date().toISOString()}`);
    const live = await uploader.uploadBuffer({
      accountId: 'smoke',
      jobId: `live-${Date.now()}`,
      filename: 'hello.txt',
      buffer: buf,
      ttlSec: 300
    });
    console.log('[smoke] uploaded:', live);
    const res = await fetch(live.signedUrl);
    console.log('[smoke] GET status:', res.status);
    if (res.status !== 200) process.exit(2);
    const body = await res.text();
    console.log('[smoke] body matches:', body === buf.toString());
    process.exit(body === buf.toString() ? 0 : 3);
  })().catch((err) => {
    console.error('[smoke] failed:', err);
    process.exit(1);
  });
}
