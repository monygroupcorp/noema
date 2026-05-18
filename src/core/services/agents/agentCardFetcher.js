// src/core/services/agents/agentCardFetcher.js
//
// Fetches and caches agent card metadata from CAMEL agent runtime hosts.

const fetch = require('node-fetch');
const { createLogger } = require('../../../utils/logger');

const _logger = createLogger('agentCardFetcher');

// Module-level cache: key → { data, expiresAt } for resolved, or { promise } for in-flight
const _cache = new Map();

const TTL_MS = 300_000; // 5 minutes

/**
 * Fetches an agent card from `https://{issuerDomain}/agents/{tokenId}/card`.
 *
 * @param {string} issuerDomain - e.g. 'camelcabal.fun'
 * @param {string} tokenId      - Token identifier
 * @param {object} [opts]
 * @param {Function} [opts._fetchFn]  - Injected fetch (defaults to node-fetch)
 * @param {object}   [opts.logger]    - Injected logger
 * @returns {Promise<{ profile: { name, description, image }, collection, agentId }|null>}
 */
async function fetchAgentCard(issuerDomain, tokenId, opts = {}) {
  const _fetchFn = opts._fetchFn || fetch;
  const logger = opts.logger || _logger;

  const key = `card:${issuerDomain}:${tokenId}`;

  // 1. Cache warm hit
  const entry = _cache.get(key);
  if (entry && entry.expiresAt && entry.expiresAt > Date.now()) {
    logger.debug(`agentCardFetcher: cache hit for ${key}`);
    return entry.data;
  }

  // 2. In-flight dedup
  if (entry && entry.promise) {
    return entry.promise;
  }

  // 3. Create and store promise
  const promise = _doFetch(issuerDomain, tokenId, key, _fetchFn, logger);
  _cache.set(key, { promise });
  return promise;
}

async function _doFetch(issuerDomain, tokenId, key, _fetchFn, logger) {
  const url = `https://${issuerDomain}/agents/${tokenId}/card`;

  let response;
  try {
    response = await _fetchFn(url, { timeout: 10000 });
  } catch (err) {
    logger.warn(`agentCardFetcher: network error fetching ${url}: ${err.message}`);
    _cache.delete(key);
    return null;
  }

  // 5. Non-2xx
  if (!response.ok) {
    logger.warn(`agentCardFetcher: ${url} returned ${response.status}`);
    _cache.delete(key);
    return null;
  }

  // 6. JSON parse failure
  let result;
  try {
    result = await response.json();
  } catch (err) {
    logger.warn(`agentCardFetcher: failed to parse JSON from ${url}: ${err.message}`);
    _cache.delete(key);
    return null;
  }

  // 7. Missing profile
  if (!result || !result.profile) {
    logger.warn(`agentCardFetcher: response from ${url} missing 'profile' field`);
    _cache.delete(key);
    return null;
  }

  // 8. Success: store in cache and schedule eviction
  _cache.set(key, { data: result, expiresAt: Date.now() + TTL_MS, promise: null });
  setTimeout(() => _cache.delete(key), TTL_MS).unref();

  return result;
}

/**
 * Clears the module-level cache. Exposed for testing only.
 */
function _clearCache() {
  _cache.clear();
}

module.exports = { fetchAgentCard, _clearCache };
