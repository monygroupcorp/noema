const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { createLogger } = require('../../../utils/logger');

const logger = createLogger('presignApi');

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB (enforced by R2, we just document it)

// 10 presigns/min per IP
const ipLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.ip,
  message: { error: 'TOO_MANY_REQUESTS', message: 'Upload rate limit exceeded.' },
});

// 50 presigns/hour per partnerId
const partnerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 50,
  keyGenerator: (req) => req.body?.partnerId || 'unknown',
  message: { error: 'TOO_MANY_REQUESTS', message: 'Partner upload rate limit exceeded.' },
});

function createPresignApi({ storageService, partnerDb, uploadRecordDb }) {
  const router = express.Router();

  router.post('/presign', ipLimiter, partnerLimiter, async (req, res) => {
    const { partnerId, filename, mimeType } = req.body;

    if (!partnerId || !filename || !mimeType) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'partnerId, filename, mimeType required' });
    }

    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'Only image files are allowed' });
    }

    // Validate partner + domain
    const origin = req.get('Origin') || '';
    const domain = origin.replace(/^https?:\/\//, '').replace(/\/.*$/, '');

    const partner = await partnerDb.findPartnerById(partnerId);
    if (!partner) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Partner not found' });
    }
    if (!partner.allowedDomains.includes(domain)) {
      logger.warn('[presign] Domain mismatch', { partnerId, domain, allowed: partner.allowedDomains });
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Domain not registered for this partner' });
    }

    // Generate presigned URL
    const { signedUrl, permanentUrl } = await storageService.generateSignedUploadUrl(
      `partner_${partnerId}`,
      filename,
      mimeType,
      'uploads'
    );

    // Earmark the upload
    const uploadId = uuidv4();
    const ipHash = crypto.createHash('sha256').update(req.ip || '').digest('hex');
    await uploadRecordDb.createUploadRecord({ uploadId, partnerId, originDomain: domain, ipHash });

    return res.json({ uploadId, presignedUrl: signedUrl, permanentUrl, maxBytes: MAX_FILE_SIZE_BYTES });
  });

  return router;
}

module.exports = { createPresignApi };
