// tests/unit/services/agents/camelJwtVerifier.test.js

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { generateKeyPairSync } = require('crypto');

const {
  CamelJwtVerifier,
  JwksUnavailableError,
  UnknownKeyError,
  AssertionExpiredError,
} = require('../../../../src/core/services/agents/camelJwtVerifier');

// Generate a real ES256 keypair once for all tests
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const jwkPublicKey = publicKey.export({ format: 'jwk' });

function mockFetch(keys, { status = 200, cacheControl = null } = {}) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Not Found',
    headers: { get: (h) => h === 'cache-control' ? cacheControl : null },
    json: async () => ({ keys })
  });
}

function mintJwt(payload, { kid = 'test-key-1', expiresIn = '1h', audience = 'noema.art', issuer = 'https://camelcabal.fun' } = {}) {
  return jwt.sign(payload, privateKeyPem, {
    algorithm: 'ES256',
    keyid: kid,
    expiresIn,
    audience,
    issuer
  });
}

describe('CamelJwtVerifier', () => {
  test('verifyAssertionJwt: happy path — returns decoded payload', async () => {
    const jwkWithKid = { ...jwkPublicKey, kid: 'test-key-1' };
    const token = mintJwt({ agentId: 'agent-1', tokenId: 'tok-1' });

    const verifier = new CamelJwtVerifier({ _fetchFn: mockFetch([jwkWithKid]) });
    const payload = await verifier.verifyAssertionJwt(token, 'camelcabal.fun');

    assert.equal(payload.agentId, 'agent-1');
    assert.equal(payload.tokenId, 'tok-1');
  });

  test('verifyAssertionJwt: caches JWKS — concurrent calls fetch only once', async () => {
    const jwkWithKid = { ...jwkPublicKey, kid: 'test-key-1' };
    let fetchCallCount = 0;

    const countingFetch = async (url, opts) => {
      fetchCallCount++;
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => null },
        json: async () => ({ keys: [jwkWithKid] })
      };
    };

    const verifier = new CamelJwtVerifier({ _fetchFn: countingFetch });

    const token1 = mintJwt({ agentId: 'agent-1' });
    const token2 = mintJwt({ agentId: 'agent-2' });

    const [r1, r2] = await Promise.all([
      verifier.verifyAssertionJwt(token1, 'camelcabal.fun'),
      verifier.verifyAssertionJwt(token2, 'camelcabal.fun'),
    ]);
    assert.equal(fetchCallCount, 1); // must be 1, not 2
  });

  test('verifyAssertionJwt: throws UnknownKeyError when kid not in JWKS', async () => {
    const jwkWithKid = { ...jwkPublicKey, kid: 'test-key-1' };
    const token = mintJwt({ agentId: 'agent-1' }, { kid: 'missing-key' });

    const verifier = new CamelJwtVerifier({ _fetchFn: mockFetch([jwkWithKid]) });

    await assert.rejects(
      () => verifier.verifyAssertionJwt(token, 'camelcabal.fun'),
      (err) => {
        assert.equal(err.name, 'UnknownKeyError');
        return true;
      }
    );
  });

  test('verifyAssertionJwt: throws AssertionExpiredError for expired token', async () => {
    const jwkWithKid = { ...jwkPublicKey, kid: 'test-key-1' };
    const token = mintJwt({ agentId: 'agent-1' }, { expiresIn: '-1s' });

    const verifier = new CamelJwtVerifier({ _fetchFn: mockFetch([jwkWithKid]) });

    await assert.rejects(
      () => verifier.verifyAssertionJwt(token, 'camelcabal.fun'),
      (err) => {
        assert.equal(err.name, 'AssertionExpiredError');
        return true;
      }
    );
  });

  test('verifyAssertionJwt: throws JwksUnavailableError on non-200 JWKS response', async () => {
    const token = mintJwt({ agentId: 'agent-1' });

    const verifier = new CamelJwtVerifier({ _fetchFn: mockFetch([], { status: 404 }) });

    await assert.rejects(
      () => verifier.verifyAssertionJwt(token, 'camelcabal.fun'),
      (err) => {
        assert.equal(err.name, 'JwksUnavailableError');
        return true;
      }
    );
  });

  test('verifyAssertionJwt: throws JwksUnavailableError when JWKS missing keys array', async () => {
    const token = mintJwt({ agentId: 'agent-1' });

    // Return an object without a `keys` field
    const badFetch = async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      json: async () => ({})
    });

    const verifier = new CamelJwtVerifier({ _fetchFn: badFetch });

    await assert.rejects(
      () => verifier.verifyAssertionJwt(token, 'camelcabal.fun'),
      (err) => {
        assert.equal(err.name, 'JwksUnavailableError');
        return true;
      }
    );
  });

  test('verifyAssertionJwt: rejects token with wrong audience', async () => {
    const jwkWithKid = { ...jwkPublicKey, kid: 'test-key-1' };
    const wrongAudToken = mintJwt({ agentId: 'agent-1' }, { audience: 'wrong-audience' });

    const verifier = new CamelJwtVerifier({ _fetchFn: mockFetch([jwkWithKid]) });

    await assert.rejects(
      async () => verifier.verifyAssertionJwt(wrongAudToken, 'camelcabal.fun'),
      (err) => { assert.equal(err.name, 'JsonWebTokenError'); return true; }
    );
  });

  test('verifyAssertionJwt: rejects token with wrong issuer', async () => {
    const jwkWithKid = { ...jwkPublicKey, kid: 'test-key-1' };
    const wrongIssToken = mintJwt({ agentId: 'agent-1' }, { issuer: 'https://wrong-issuer.com' });

    const verifier = new CamelJwtVerifier({ _fetchFn: mockFetch([jwkWithKid]) });

    await assert.rejects(
      async () => verifier.verifyAssertionJwt(wrongIssToken, 'camelcabal.fun'),
      (err) => { assert.equal(err.name, 'JsonWebTokenError'); return true; }
    );
  });

  test('verifyAssertionJwt: throws plain Error when token has no kid', async () => {
    // Sign without keyid so kid is absent from header
    const token = jwt.sign({ agentId: 'agent-1' }, privateKeyPem, {
      algorithm: 'ES256',
      expiresIn: '1h',
      audience: 'noema.art'
    });

    const verifier = new CamelJwtVerifier({ _fetchFn: mockFetch([]) });

    await assert.rejects(
      () => verifier.verifyAssertionJwt(token, 'camelcabal.fun'),
      (err) => {
        assert.match(err.message, /kid/);
        return true;
      }
    );
  });
});
