const fetch = require('node-fetch');
const { createLogger } = require('../../../utils/logger');

/**
 * Fire and forget: post a session event to the issuer's callback URL.
 * Never throws — logs on failure.
 *
 * @param {object} params
 * @param {string} params.issuerDomain
 * @param {string} params.tokenId
 * @param {object} params.payload
 * @param {object} [params.options]
 * @param {number} [params.options.timeout] default 10000
 * @param {Function} [params.options._fetchFn] injected fetch (for testing)
 * @param {object} [params.options.logger]
 */
function fireSessionCallback({ issuerDomain, tokenId, payload, options = {} }) {
  const logger = options.logger || createLogger('agentSessionCallback');
  const _fetch = options._fetchFn || fetch;
  const timeout = options.timeout || 10000;
  let sessionBase = `https://${issuerDomain}`;
  const overrideEnv = process.env.AGENT_CARD_URL_OVERRIDE;
  if (overrideEnv) {
    try {
      const overrides = JSON.parse(overrideEnv);
      if (overrides[issuerDomain]) sessionBase = overrides[issuerDomain].replace(/\/$/, '');
    } catch { /* malformed — fall through */ }
  }
  const url = `${sessionBase}/agents/${tokenId}/sessions`;

  setImmediate(async () => {
    try {
      const res = await _fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        timeout,
      });
      if (!res.ok) {
        logger.warn('[agentSessionCallback] Non-2xx response', { url, status: res.status });
      } else {
        logger.debug('[agentSessionCallback] Delivered', { url });
      }
    } catch (err) {
      logger.warn('[agentSessionCallback] Delivery failed', { issuerDomain, tokenId, error: err.message });
    }
  });
}

module.exports = { fireSessionCallback };
