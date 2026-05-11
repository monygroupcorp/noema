// src/api/internal/treasury/middleware/assertionJwt.js
//
// Verifies issuer JWTs from camelcabal.fun (ES256, JWKS-backed).
// Two auth tiers exposed via req.assertion:
//   { tier: 'multisig', role: 'treasury-admin', sub, iat, exp }
//   { tier: 'agent',    chainId, adapter, agentId, sub, iat, exp }
//
// Env vars:
//   CAMEL_ISSUER_JWKS_URL   — JWKS endpoint (required in production)
//   CAMEL_ISSUER_DOMAIN     — expected `iss` claim value

const jwt = require('jsonwebtoken');
const https = require('https');

const JWKS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let _jwksCache = null;
let _jwksCacheAt = 0;

/**
 * Fetches JWKS from CAMEL_ISSUER_JWKS_URL and caches for TTL.
 * @returns {Promise<Array>} Array of JWK key objects
 */
async function fetchJwks() {
  const now = Date.now();
  if (_jwksCache && now - _jwksCacheAt < JWKS_CACHE_TTL_MS) {
    return _jwksCache;
  }

  const url = process.env.CAMEL_ISSUER_JWKS_URL;
  if (!url) throw new Error('CAMEL_ISSUER_JWKS_URL not configured');

  const body = await new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });

  const { keys } = JSON.parse(body);
  _jwksCache = keys;
  _jwksCacheAt = now;
  return keys;
}

/**
 * Converts a JWK (EC P-256) to PEM format for jsonwebtoken.
 * Only handles ES256 public keys.
 */
function jwkToPem(jwk) {
  // jsonwebtoken accepts the raw JWK object for EC keys when using jose-style imports
  // For simplicity, use the built-in crypto module to import via SubtleCrypto format
  // We rely on the `jwk-to-pem` pattern via manual DER encoding or fall back to
  // the `crypto.createPublicKey` approach available in Node ≥ 15.
  return require('crypto').createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'pem' });
}

/**
 * Verifies a Bearer JWT against the issuer JWKS.
 * Returns the decoded payload or throws.
 */
async function verifyIssuerJwt(token) {
  const issuerDomain = process.env.CAMEL_ISSUER_DOMAIN;

  // Decode header to find kid
  const header = jwt.decode(token, { complete: true })?.header;
  if (!header || header.alg !== 'ES256') {
    throw Object.assign(new Error('Invalid JWT algorithm — ES256 required'), { code: 'INVALID_ALG' });
  }

  const keys = await fetchJwks();
  const key = header.kid ? keys.find(k => k.kid === header.kid) : keys[0];
  if (!key) throw Object.assign(new Error('No matching JWKS key for kid'), { code: 'KEY_NOT_FOUND' });

  const pem = jwkToPem(key);

  const verifyOpts = { algorithms: ['ES256'] };
  if (issuerDomain) verifyOpts.issuer = issuerDomain;

  return jwt.verify(token, pem, verifyOpts);
}

/**
 * Parses the `sub` claim into agent identity parts.
 * Expected format: `agent:<chainId>:<adapterAddress>:<agentId>`
 * Returns null if format does not match.
 */
function parseAgentSub(sub) {
  if (!sub || !sub.startsWith('agent:')) return null;
  const parts = sub.split(':');
  if (parts.length !== 4) return null;
  const [, chainId, adapter, agentId] = parts;
  return { chainId: Number(chainId), adapter, agentId };
}

/**
 * Express middleware factory.
 *
 * @param {{ tier?: 'multisig'|'agent'|'any', required?: boolean }} [options]
 *   tier    — if set, rejects tokens that do not match the required tier
 *   required — if false, allows unauthenticated requests (req.assertion = null)
 */
function assertionJwt({ tier, required = true } = {}) {
  return async function assertionJwtMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      if (!required) {
        req.assertion = null;
        return next();
      }
      return res.status(401).json({ error: { code: 'MISSING_TOKEN', message: 'Authorization Bearer token required' } });
    }

    try {
      const payload = await verifyIssuerJwt(token);

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
}

module.exports = { assertionJwt, verifyIssuerJwt, parseAgentSub };
