// tests/unit/services/agents/agentCardFetcher.test.js

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { fetchAgentCard, _clearCache } = require('../../../../src/core/services/agents/agentCardFetcher');

const VALID_CARD = {
  profile: { name: 'TestAgent', description: 'A test agent', image: 'https://example.com/img.png' },
  collection: 'test-collection',
  agentId: 'agent-abc',
};

function mockFetch(card, { status = 200, throws } = {}) {
  return async () => {
    if (throws) throw throws;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => card,
    };
  };
}

describe('fetchAgentCard', () => {
  // Clear cache between tests
  test.beforeEach(() => {
    _clearCache();
  });

  test('happy path: returns valid card with all fields', async () => {
    const result = await fetchAgentCard('example1.com', 'tok-1', {
      _fetchFn: mockFetch(VALID_CARD),
    });

    assert.deepEqual(result, VALID_CARD);
    assert.equal(result.profile.name, 'TestAgent');
    assert.equal(result.agentId, 'agent-abc');
  });

  test('cache hit: same domain+tokenId called twice → fetch called once', async () => {
    let fetchCallCount = 0;
    const countingFetch = async () => {
      fetchCallCount++;
      return {
        ok: true,
        status: 200,
        json: async () => VALID_CARD,
      };
    };

    await fetchAgentCard('example2.com', 'tok-2', { _fetchFn: countingFetch });
    await fetchAgentCard('example2.com', 'tok-2', { _fetchFn: countingFetch });

    assert.equal(fetchCallCount, 1);
  });

  test('concurrent dedup: Promise.all of two calls → fetch called once, both get same result', async () => {
    let fetchCallCount = 0;
    const countingFetch = async () => {
      fetchCallCount++;
      // Simulate slight async delay
      await new Promise((r) => setImmediate(r));
      return {
        ok: true,
        status: 200,
        json: async () => VALID_CARD,
      };
    };

    const [r1, r2] = await Promise.all([
      fetchAgentCard('example3.com', 'tok-3', { _fetchFn: countingFetch }),
      fetchAgentCard('example3.com', 'tok-3', { _fetchFn: countingFetch }),
    ]);

    assert.equal(fetchCallCount, 1);
    assert.deepEqual(r1, VALID_CARD);
    assert.deepEqual(r2, VALID_CARD);
  });

  test('non-200 response (404) → returns null', async () => {
    const result = await fetchAgentCard('example4.com', 'tok-4', {
      _fetchFn: mockFetch(VALID_CARD, { status: 404 }),
    });

    assert.equal(result, null);
  });

  test('network error (fetch throws) → returns null', async () => {
    const result = await fetchAgentCard('example5.com', 'tok-5', {
      _fetchFn: mockFetch(null, { throws: new Error('ECONNREFUSED') }),
    });

    assert.equal(result, null);
  });

  test('JSON parse error (json() throws) → returns null', async () => {
    const badJsonFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('Unexpected token'); },
    });

    const result = await fetchAgentCard('example6.com', 'tok-6', {
      _fetchFn: badJsonFetch,
    });

    assert.equal(result, null);
  });

  test('missing profile field in response → returns null', async () => {
    const noProfile = { collection: 'test-collection', agentId: 'agent-abc' };
    const result = await fetchAgentCard('example7.com', 'tok-7', {
      _fetchFn: mockFetch(noProfile),
    });

    assert.equal(result, null);
  });

  test('different tokenIds on same domain → separate cache entries, two fetches', async () => {
    let fetchCallCount = 0;
    const countingFetch = async () => {
      fetchCallCount++;
      return {
        ok: true,
        status: 200,
        json: async () => VALID_CARD,
      };
    };

    await fetchAgentCard('example8.com', 'tok-a', { _fetchFn: countingFetch });
    await fetchAgentCard('example8.com', 'tok-b', { _fetchFn: countingFetch });

    assert.equal(fetchCallCount, 2);
  });

  test('never throws on any failure', async () => {
    // Verify all failure modes return null rather than throwing
    const results = await Promise.all([
      fetchAgentCard('example9.com', 'tok-9a', {
        _fetchFn: mockFetch(VALID_CARD, { status: 500 }),
      }),
      fetchAgentCard('example9.com', 'tok-9b', {
        _fetchFn: mockFetch(null, { throws: new TypeError('network failure') }),
      }),
      fetchAgentCard('example9.com', 'tok-9c', {
        _fetchFn: mockFetch({ noProfile: true }),
      }),
    ]);

    for (const result of results) {
      assert.equal(result, null);
    }
  });
});
