/**
 * agentSessionCallback unit tests
 *
 * Uses node:test + assert/strict. All fetch calls are injected via _fetchFn.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { fireSessionCallback } = require('../../../../src/core/services/agents/agentSessionCallback');

// Helper: wait for the next setImmediate tick(s) to drain
function drainImmediate() {
  return new Promise((resolve) => setImmediate(resolve));
}

// Minimal mock response factory
function mockResponse({ ok = true, status = 200 } = {}) {
  return { ok, status };
}

describe('fireSessionCallback', () => {
  // 1. Happy path
  test('Happy path: posts to correct URL with correct payload, resolves cleanly', async () => {
    const calls = [];
    const mockFetch = async (url, opts) => {
      calls.push({ url, opts });
      return mockResponse({ ok: true, status: 200 });
    };

    const warnCalls = [];
    const debugCalls = [];
    const logger = {
      warn: (...args) => warnCalls.push(args),
      debug: (...args) => debugCalls.push(args),
    };

    fireSessionCallback({
      issuerDomain: 'camelcabal.fun',
      tokenId: '42',
      payload: { platform: 'noema.art', platformAgentId: 'cmw_abc' },
      options: { _fetchFn: mockFetch, logger },
    });

    await drainImmediate();

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://camelcabal.fun/agents/42/sessions');
    assert.equal(calls[0].opts.method, 'POST');
    assert.equal(calls[0].opts.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(calls[0].opts.body), { platform: 'noema.art', platformAgentId: 'cmw_abc' });
    assert.equal(warnCalls.length, 0, 'No warnings on success');
    assert.equal(debugCalls.length, 1, 'One debug log on success');
  });

  // 2. Non-2xx response: logs warn, does not throw
  test('Non-2xx response: logs warn, does not throw', async () => {
    const mockFetch = async () => mockResponse({ ok: false, status: 500 });

    const warnCalls = [];
    const logger = {
      warn: (...args) => warnCalls.push(args),
      debug: () => {},
    };

    let threw = false;
    try {
      fireSessionCallback({
        issuerDomain: 'camelcabal.fun',
        tokenId: '7',
        payload: { foo: 'bar' },
        options: { _fetchFn: mockFetch, logger },
      });
      await drainImmediate();
    } catch {
      threw = true;
    }

    assert.equal(threw, false, 'fireSessionCallback must not throw');
    assert.equal(warnCalls.length, 1, 'Should log one warning for non-2xx');
    assert.ok(warnCalls[0][0].includes('Non-2xx'), 'Warning should mention Non-2xx');
  });

  // 3. Network error (fetch throws): logs warn, does not throw
  test('Network error: fetch throws → logs warn, does not throw', async () => {
    const mockFetch = async () => { throw new Error('ECONNREFUSED'); };

    const warnCalls = [];
    const logger = {
      warn: (...args) => warnCalls.push(args),
      debug: () => {},
    };

    let threw = false;
    try {
      fireSessionCallback({
        issuerDomain: 'camelcabal.fun',
        tokenId: '99',
        payload: {},
        options: { _fetchFn: mockFetch, logger },
      });
      await drainImmediate();
    } catch {
      threw = true;
    }

    assert.equal(threw, false, 'fireSessionCallback must not throw on network error');
    assert.equal(warnCalls.length, 1, 'Should log one warning on network error');
    assert.ok(warnCalls[0][0].includes('Delivery failed'), 'Warning should mention Delivery failed');
  });

  // 4. Fire-and-forget: returns synchronously before fetch completes
  test('Fire-and-forget: returns synchronously before fetch completes', async () => {
    const order = [];

    const slowFetch = async () => {
      // Record that fetch started after the function returned
      order.push('fetch-started');
      return mockResponse();
    };

    const logger = { warn: () => {}, debug: () => {} };

    order.push('before-call');
    fireSessionCallback({
      issuerDomain: 'camelcabal.fun',
      tokenId: '1',
      payload: {},
      options: { _fetchFn: slowFetch, logger },
    });
    order.push('after-call');

    // At this point fetch has NOT started yet (it's deferred via setImmediate)
    assert.deepEqual(order, ['before-call', 'after-call'], 'Should return before fetch starts');

    await drainImmediate();
    assert.deepEqual(order, ['before-call', 'after-call', 'fetch-started'], 'Fetch runs after current tick');
  });

  // 5. Custom _fetchFn and logger injected correctly
  test('Custom _fetchFn and logger are injected correctly', async () => {
    const fetchInvocations = [];
    const logInvocations = [];

    const customFetch = async (url, opts) => {
      fetchInvocations.push({ url, opts });
      return mockResponse({ ok: true });
    };

    const customLogger = {
      warn: (msg, meta) => logInvocations.push({ level: 'warn', msg, meta }),
      debug: (msg, meta) => logInvocations.push({ level: 'debug', msg, meta }),
    };

    fireSessionCallback({
      issuerDomain: 'example.com',
      tokenId: 'tok-5',
      payload: { check: true },
      options: { _fetchFn: customFetch, logger: customLogger },
    });

    await drainImmediate();

    assert.equal(fetchInvocations.length, 1, 'Custom fetch must be called');
    assert.equal(fetchInvocations[0].url, 'https://example.com/agents/tok-5/sessions');

    assert.equal(logInvocations.length, 1, 'Custom logger must be called once (debug on success)');
    assert.equal(logInvocations[0].level, 'debug');
  });
});
