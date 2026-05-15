// src/api/internal/treasury/middleware/assertionJwt.js
//
// Verifies issuer JWTs (ES256, JWKS-backed) for any registered trusted issuer.
// Issuers are stored in the `trusted_issuers` collection — no env vars per partner.
//
// Usage:
//   const { createAssertionJwt } = require('./assertionJwt');
//   const assertionJwt = createAssertionJwt({ issuerDb: deps.db.issuer });
//   router.get('/protected', assertionJwt({ tier: 'multisig' }), handler);

const jwt = require('jsonwebtoken');
const https = require('https');

const JWKS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

// Per-issuer JWKS cache: issuerId → { keys: JWK[], cachedAt: number }
const _cache = new Map();

/**
 * Force-bust the JWKS cache for a specific issuer (used by admin refresh endpoint).
 * @param {string} issuerId
 */
function bustJwksCache(issuerId) {
  _cache.delete(issuerId);
}

/**
 * Fetches JWKS from the given URL and caches per issuerId.
 */
async function fetchJwks(issuerId, jwksUrl) {
  const now = Date.now();
  const cached = _cache.get(issuerId);
  if (cached && now - cached.cachedAt < JWKS_CACHE_TTL_MS) return cached.keys;

  const body = await new Promise((resolve, reject) => {
    https.get(jwksUrl, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });

  const { keys } = JSON.parse(body);
  _cache.set(issuerId, { keys, cachedAt: Date.now() });
  return keys;
}

function jwkToPem(jwk) {
  return require('crypto').createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'pem' });
}

/**
 * Parses `sub` claim → agent identity.
 * Format: `agent:<chainId>:<adapterAddress>:<agentId>`
 */
function parseAgentSub(sub) {
  if (!sub || !sub.startsWith('agent:')) return null;
  const parts = sub.split(':');
  if (parts.length !== 4) return null;
  const [, chainId, adapter, agentId] = parts;
  return { chainId: Number(chainId), adapter, agentId };
}

/**
 * Factory — binds issuerDb once, returns the assertionJwt(options) middleware factory.
 *
 * @param {{ issuerDb: import('../../../../core/services/db/issuerDb') }} deps
 */
function createAssertionJwt({ issuerDb } = {}) {
  if (!issuerDb) throw new Error('createAssertionJwt requires issuerDb');

  /**
   * @param {{ tier?: 'multisig'|'agent'|'any', required?: boolean }} [options]
   */
  return function assertionJwt({ tier, required = true } = {}) {
    return async function assertionJwtMiddleware(req, res, next) {
      const authHeader = req.headers['authorization'] || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

      if (!token) {
        if (!required) { req.assertion = null; return next(); }
        return res.status(401).json({ error: { code: 'MISSING_TOKEN', message: 'Authorization Bearer token required' } });
      }

      try {
        // Decode without verifying to extract `iss` and `kid`
        const decoded = jwt.decode(token, { complete: true });
        if (!decoded || decoded.header?.alg !== 'ES256') {
          return res.status(401).json({ error: { code: 'INVALID_ALG', message: 'ES256 JWT required' } });
        }

        const issuerId = decoded.payload?.iss;
        if (!issuerId) {
          return res.status(401).json({ error: { code: 'MISSING_ISS', message: 'JWT missing iss claim' } });
        }

        // Look up trusted issuer in DB
        const issuer = await issuerDb.findByIssuerId(issuerId);
        if (!issuer) {
          return res.status(401).json({ error: { code: 'UNKNOWN_ISSUER', message: `Issuer '${issuerId}' is not registered or is suspended` } });
        }

        // Fetch JWKS and find matching key
        const keys = await fetchJwks(issuerId, issuer.jwksUrl);
        const kid = decoded.header?.kid;
        const key = kid ? keys.find(k => k.kid === kid) : keys[0];
        if (!key) {
          return res.status(401).json({ error: { code: 'KEY_NOT_FOUND', message: 'No matching JWKS key for kid' } });
        }

        const pem = jwkToPem(key);
        const payload = jwt.verify(token, pem, { algorithms: ['ES256'], issuer: issuerId });

        // Determine tier from claims
        let assertion;
        const agentParts = parseAgentSub(payload.sub);
        if (agentParts) {
          assertion = { tier: 'agent', ...agentParts, sub: payload.sub, iat: payload.iat, exp: payload.exp };
        } else if (payload.role === 'treasury-admin') {
          assertion = { tier: 'multisig', role: payload.role, sub: payload.sub, iat: payload.iat, exp: payload.exp };
        } else {
          return res.status(403).json({ error: { code: 'UNKNOWN_TIER', message: 'JWT does not match a recognised claim tier' } });
        }

        if (tier && tier !== 'any' && assertion.tier !== tier) {
          return res.status(403).json({ error: { code: 'WRONG_TIER', message: `This endpoint requires tier: ${tier}` } });
        }

        req.assertion = assertion;
        next();
      } catch (err) {
        const code = err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED'
          : err.name === 'JsonWebTokenError' ? 'INVALID_TOKEN'
          : err.code || 'AUTH_ERROR';
        return res.status(401).json({ error: { code, message: err.message } });
      }
    };
  };
}

module.exports = { createAssertionJwt, bustJwksCache, parseAgentSub };
