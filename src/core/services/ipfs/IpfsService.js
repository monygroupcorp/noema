'use strict';

// IpfsService — central IPFS resolver for server-side use.
//
// Priority:
//   1. Pinata dedicated gateway (PINATA_GATEWAY_URL + PINATA_GATEWAY_TOKEN) — fastest, authenticated
//   2. Generic gateway override (IPFS_GATEWAY_URL)
//   3. Public ipfs.io gateway — fallback
//
// Use cases:
//   - NFT tokenUri resolution (including ipfs:// scheme)
//   - NFT image mirroring to R2 during workspace provisioning
//   - Fetching NFT images directly for training (no dataset required)

const https = require('https');
const http  = require('http');

class IpfsService {
  constructor(logger) {
    this.logger = logger || console;

    const pinataBase  = process.env.PINATA_GATEWAY_URL?.replace(/\/$/, '');
    const genericBase = process.env.IPFS_GATEWAY_URL?.replace(/\/$/, '');

    this._gatewayBase  = pinataBase || genericBase || 'https://ipfs.io';
    this._gatewayToken = pinataBase ? (process.env.PINATA_GATEWAY_TOKEN || null) : null;

    if (!pinataBase && !genericBase) {
      this.logger.warn('[IpfsService] No PINATA_GATEWAY_URL or IPFS_GATEWAY_URL configured — using public ipfs.io (rate-limited, unauthenticated)');
    } else {
      this.logger.debug(
        `[IpfsService] Gateway: ${this._gatewayBase}` +
        (this._gatewayToken ? ' (authenticated)' : ' (public)')
      );
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Resolves an ipfs:// URI (or bare CID) to a full HTTPS gateway URL.
   * Appends the Pinata gateway token as a query param when configured.
   */
  resolveUrl(ipfsUri) {
    const cid = ipfsUri.replace(/^ipfs:\/\//, '');
    const url  = `${this._gatewayBase}/ipfs/${cid}`;
    return this._gatewayToken ? `${url}?pinataGatewayToken=${this._gatewayToken}` : url;
  }

  /**
   * Fetches and parses JSON from an ipfs:// or https:// URI.
   * Handles ipfs:// scheme transparently — callers don't need to pre-resolve.
   */
  async fetchJson(uri) {
    const url = uri.startsWith('ipfs://') ? this.resolveUrl(uri) : uri;
    return this._fetchJson(url);
  }

  /**
   * Opens a readable stream for an ipfs:// or https:// URI.
   * Returns { stream, contentType }.
   */
  async fetchStream(uri) {
    const url = uri.startsWith('ipfs://') ? this.resolveUrl(uri) : uri;
    return this._fetchStream(url);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  _headers() {
    // Pinata also accepts the token as a header — useful for URLs we don't control
    return this._gatewayToken
      ? { 'x-pinata-gateway-token': this._gatewayToken }
      : {};
  }

  _fetchJson(url, redirectDepth = 0) {
    if (redirectDepth > 3) return Promise.reject(new Error('Too many IPFS redirects'));
    return new Promise((resolve, reject) => {
      const mod = url.startsWith('https') ? https : http;
      const req = mod.get(url, { timeout: 10_000, headers: this._headers() }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const loc = res.headers.location;
          res.resume();
          if (!loc.startsWith('https://')) {
            return reject(new Error(`Refusing non-HTTPS IPFS redirect: ${loc}`));
          }
          return this._fetchJson(loc, redirectDepth + 1).then(resolve).catch(reject);
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        }
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch { reject(new Error(`Invalid JSON from IPFS URI: ${url}`)); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error(`IPFS fetch timed out: ${url}`)); });
    });
  }

  _fetchStream(url, redirectDepth = 0) {
    if (redirectDepth > 3) return Promise.reject(new Error('Too many IPFS redirects'));
    return new Promise((resolve, reject) => {
      const mod = url.startsWith('https') ? https : http;
      const req = mod.get(url, { timeout: 15_000, headers: this._headers() }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const loc = res.headers.location;
          res.resume();
          if (!loc.startsWith('https://')) {
            return reject(new Error(`Refusing non-HTTPS IPFS redirect: ${loc}`));
          }
          return this._fetchStream(loc, redirectDepth + 1).then(resolve).catch(reject);
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} fetching stream from ${url}`));
        }
        resolve({
          stream:      res,
          contentType: res.headers['content-type'] || 'application/octet-stream',
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error(`IPFS stream timed out: ${url}`)); });
    });
  }
}

module.exports = { IpfsService };
