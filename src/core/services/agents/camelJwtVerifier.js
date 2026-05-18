// src/core/services/agents/camelJwtVerifier.js
//
// Verifies ES256 JWTs issued by CAMEL agent runtimes using JWKS discovery.

const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');
const { createPublicKey } = require('crypto');
const { createLogger } = require('../../../utils/logger');

// ---------------------------------------------------------------------------
// Custom error classes
// ---------------------------------------------------------------------------

class JwksUnavailableError extends Error {
  constructor(message, { cause, issuerDomain } = {}) {
    super(message);
    this.name = 'JwksUnavailableError';
    this.issuerDomain = issuerDomain;
    if (cause) this.cause = cause;
  }
}

class UnknownKeyError extends Error {
  constructor(message, { kid, issuerDomain } = {}) {
    super(message);
    this.name = 'UnknownKeyError';
    this.kid = kid;
    this.issuerDomain = issuerDomain;
  }
}

class AssertionExpiredError extends Error {
  constructor(message, { exp } = {}) {
    super(message);
    this.name = 'AssertionExpiredError';
    this.exp = exp;
  }
}

// ---------------------------------------------------------------------------
// CamelJwtVerifier
// ---------------------------------------------------------------------------

class CamelJwtVerifier {
  /**
   * @param {object} opts
   * @param {object}   [opts.logger]           - Optional pre-created logger
   * @param {number}   [opts.jwksTtlSeconds]   - How long to cache JWKS (default 300s)
   * @param {Function} [opts._fetchFn]         - Dependency-injected fetch (for testing)
   */
  constructor({ logger, jwksTtlSeconds = 300, _fetchFn } = {}) {
    this.logger = logger || createLogger('CamelJwtVerifier');
    this.jwksTtlSeconds = jwksTtlSeconds;
    this._fetch = _fetchFn || fetch;
    this._jwksCache = new Map(); // keyed by `jwks:${issuerDomain}`
  }

  /**
   * Verifies a CAMEL-issued ES256 JWT assertion.
   *
   * @param {string} token          - Raw JWT string
   * @param {string} issuerDomain   - e.g. 'camelcabal.fun'
   * @returns {Promise<object>}     - Decoded JWT payload
   */
  async verifyAssertionJwt(token, issuerDomain) {
    // Step 1: decode to extract kid
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || !decoded.header.kid) {
      throw new Error('Token missing kid header claim');
    }
    const kid = decoded.header.kid;

    // Step 2: fetch (or use cached) JWKS
    const keys = await this._getJwks(issuerDomain);

    // Step 3: find the matching key
    const foundKey = keys.find((k) => k.kid === kid);
    if (!foundKey) {
      throw new UnknownKeyError(
        `No key with kid '${kid}' found in JWKS for ${issuerDomain}`,
        { kid, issuerDomain }
      );
    }

    // Step 4: convert JWK → PEM
    const pem = createPublicKey({ key: foundKey, format: 'jwk' }).export({
      type: 'spki',
      format: 'pem',
    });

    // Step 5: verify
    try {
      const payload = jwt.verify(token, pem, {
        algorithms: ['ES256'],
        audience: 'noema.art',
      });
      return payload;
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        throw new AssertionExpiredError(
          `JWT assertion has expired (exp: ${err.expiredAt})`,
          { exp: err.expiredAt }
        );
      }
      throw err;
    }
  }

  /**
   * Fetches and caches the JWKS for the given issuer domain.
   *
   * @param {string} issuerDomain
   * @returns {Promise<Array>} - Array of JWK objects
   */
  async _getJwks(issuerDomain) {
    const cacheKey = 'jwks:' + issuerDomain;
    const entry = this._jwksCache.get(cacheKey);

    if (entry && entry.expiresAt > Date.now()) {
      return entry.keys;
    }

    const url = `https://${issuerDomain}/.well-known/jwks.json`;

    let response;
    try {
      response = await this._fetch(url, { timeout: 10000 });
    } catch (err) {
      throw new JwksUnavailableError(
        `Failed to fetch JWKS from ${url}: ${err.message}`,
        { cause: err, issuerDomain }
      );
    }

    if (!response.ok) {
      throw new JwksUnavailableError(
        `JWKS endpoint returned ${response.status} ${response.statusText} for ${url}`,
        { issuerDomain }
      );
    }

    let data;
    try {
      data = await response.json();
    } catch (err) {
      throw new JwksUnavailableError(
        `Failed to parse JWKS JSON from ${url}: ${err.message}`,
        { cause: err, issuerDomain }
      );
    }

    if (!Array.isArray(data.keys)) {
      throw new JwksUnavailableError(
        `JWKS response from ${url} is missing a 'keys' array`,
        { issuerDomain }
      );
    }

    // Parse Cache-Control max-age; fall back to configured TTL
    let ttlSeconds = this.jwksTtlSeconds;
    const cacheControl = response.headers.get('cache-control');
    if (cacheControl) {
      const match = cacheControl.match(/max-age=(\d+)/);
      if (match) {
        ttlSeconds = parseInt(match[1], 10);
      }
    }

    const ttlMs = ttlSeconds * 1000;

    this._jwksCache.set(cacheKey, { keys: data.keys, expiresAt: Date.now() + ttlMs });

    // Auto-evict after TTL to avoid stale entries accumulating
    setTimeout(() => this._jwksCache.delete(cacheKey), ttlMs);

    this.logger.debug(`Cached JWKS for ${issuerDomain} (ttl=${ttlSeconds}s, keys=${data.keys.length})`);

    return data.keys;
  }
}

module.exports = { CamelJwtVerifier, JwksUnavailableError, UnknownKeyError, AssertionExpiredError };
