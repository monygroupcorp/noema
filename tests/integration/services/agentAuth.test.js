// tests/integration/services/agentAuth.test.js
//
// Agent auth stack: OnChainVerifier, ChallengeService, VerifyService, agentOwnerSession
// Uses node:test built-in runner. No external framework.

'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { Wallet, TypedDataEncoder, getAddress } = require('ethers');
const jwt = require('jsonwebtoken');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TEST_PRIVATE_KEY = '0xc9b3234a759aef0582fc573353e43c5b043d7871d347a19d61f469ddda654777';
const TEST_WALLET      = new Wallet(TEST_PRIVATE_KEY);
const TEST_OWNER       = TEST_WALLET.address; // 0xAC8E2F0e38B7147679537734F92795F50Bb2d428

const SESSION_SECRET = 'test-session-secret-32chars-min!!';

const AGENT_DOC_PLAIN = {
    agentId: 'reg-001',
    agentChainId: 1,
    agentCollection: '0x1111111111111111111111111111111111111111',
    agentTokenId: '42',
    agentOwnerAddress: TEST_OWNER,
    // agentAdapter absent → Mode A
};

const AGENT_DOC_ADAPTER_SINGLE = {
    agentId: 'reg-002',
    agentChainId: 1,
    agentAdapter: '0x2222222222222222222222222222222222222222',
    agentTokenId: '7',
    agentOwnerAddress: TEST_OWNER,
    agentAdapterMethod: 'registrationOwnerOf',
    // agentCollection absent → Mode B
};

const AGENT_DOC_ADAPTER_TWO_STEP = {
    agentId: 'reg-003',
    agentChainId: 1,
    agentAdapter:     '0x3333333333333333333333333333333333333333',
    agentCollection:  '0x4444444444444444444444444444444444444444',
    agentTokenId: '5',          // registration ID
    agentOwnerAddress: TEST_OWNER,
    // both adapter + collection → Mode C
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const noLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/**
 * Builds a mock OnChainVerifier that resolves to a known address.
 */
function mockVerifier(ownerAddr = TEST_OWNER, { eip1271 = false } = {}) {
    return {
        getOwner: async () => ownerAddr,
        isValidSignature: async () => eip1271,
    };
}

/**
 * Calls VerifyService.verify with a wallet-signed challenge.
 * Returns { sessionJwt, ownerAddress }.
 */
async function signAndVerify(verifySvc, agentDoc) {
    const { domain, types, message } = verifySvc.issueChallenge(agentDoc);
    const signature = await TEST_WALLET.signTypedData(domain, types, message);
    return verifySvc.verify(agentDoc, { nonce: message.nonce, signature });
}

// ── 1. ChallengeService ───────────────────────────────────────────────────────

describe('ChallengeService', () => {
    const { ChallengeService } = require('../../../src/core/services/agents/ChallengeService');

    test('issueChallenge returns EIP-712 typed data with expected shape', () => {
        const svc = new ChallengeService();
        const result = svc.issueChallenge('agent-1', 1);
        assert.equal(result.primaryType, 'AgentAuth');
        assert.ok(result.domain.name);
        assert.equal(result.domain.chainId, 1);
        assert.ok(result.message.nonce, 'nonce present');
        assert.equal(result.message.agentId, 'agent-1');
        assert.ok(result.message.expiresAt > Math.floor(Date.now() / 1000), 'expires in future');
    });

    test('consumeChallenge succeeds with correct nonce', () => {
        const svc = new ChallengeService();
        const { message } = svc.issueChallenge('agent-1', 1);
        const consumed = svc.consumeChallenge('agent-1', message.nonce);
        assert.equal(consumed.message.agentId, 'agent-1');
    });

    test('consumeChallenge throws CHALLENGE_NOT_FOUND when no challenge exists', () => {
        const svc = new ChallengeService();
        assert.throws(
            () => svc.consumeChallenge('nobody', 'x'),
            err => err.code === 'CHALLENGE_NOT_FOUND'
        );
    });

    test('consumeChallenge throws INVALID_NONCE for wrong nonce', () => {
        const svc = new ChallengeService();
        svc.issueChallenge('agent-1', 1);
        assert.throws(
            () => svc.consumeChallenge('agent-1', 'wrong-nonce'),
            err => err.code === 'INVALID_NONCE'
        );
    });

    test('challenge is single-use — second consume throws NOT_FOUND', () => {
        const svc = new ChallengeService();
        const { message } = svc.issueChallenge('agent-1', 1);
        svc.consumeChallenge('agent-1', message.nonce);
        assert.throws(
            () => svc.consumeChallenge('agent-1', message.nonce),
            err => err.code === 'CHALLENGE_NOT_FOUND'
        );
    });

    test('issueChallenge replaces any existing pending challenge', () => {
        const svc = new ChallengeService();
        const first  = svc.issueChallenge('agent-1', 1);
        const second = svc.issueChallenge('agent-1', 1);
        // First nonce is now stale
        assert.throws(
            () => svc.consumeChallenge('agent-1', first.message.nonce),
            err => err.code === 'INVALID_NONCE'
        );
        // Second nonce works
        const consumed = svc.consumeChallenge('agent-1', second.message.nonce);
        assert.ok(consumed);
    });

    test('consumeChallenge throws CHALLENGE_EXPIRED when TTL is past', () => {
        const svc = new ChallengeService();
        const { message } = svc.issueChallenge('agent-1', 1);
        // Manually backdate the stored entry
        const entry = svc._challenges.get('agent-1');
        entry.expiresAt = Math.floor(Date.now() / 1000) - 1; // 1 second in the past
        assert.throws(
            () => svc.consumeChallenge('agent-1', message.nonce),
            err => err.code === 'CHALLENGE_EXPIRED'
        );
    });
});

// ── 2. OnChainVerifier — strategy selection ───────────────────────────────────

describe('OnChainVerifier — resolution mode selection', () => {
    const { OnChainVerifier } = require('../../../src/core/services/agents/OnChainVerifier');

    function makeFactories(contractBehaviour) {
        const calls = [];
        const _makeProvider = () => ({});
        const _makeContract = (address, _abi, _provider) => {
            const behaviour = contractBehaviour[address.toLowerCase()] || {};
            return new Proxy({}, {
                get(_, method) {
                    return async (...args) => {
                        calls.push({ address, method, args });
                        const val = behaviour[method];
                        if (val === undefined) throw new Error(`Unexpected call: ${address}.${method}`);
                        return typeof val === 'function' ? val(...args) : val;
                    };
                },
            });
        };
        return { calls, _makeProvider, _makeContract };
    }

    test('Mode A (no adapter): calls ownerOf on agentCollection', async () => {
        const { calls, _makeProvider, _makeContract } = makeFactories({
            [AGENT_DOC_PLAIN.agentCollection.toLowerCase()]: { ownerOf: TEST_OWNER },
        });
        const verifier = new OnChainVerifier({ logger: noLogger, _makeProvider, _makeContract });
        const owner = await verifier.getOwner(AGENT_DOC_PLAIN);
        assert.equal(owner, getAddress(TEST_OWNER));
        assert.ok(calls.some(c => c.method === 'ownerOf'), 'ownerOf called');
        assert.ok(!calls.some(c => c.method === 'camelTokenIdOf'), 'camelTokenIdOf not called');
    });

    test('Mode B (adapter, no collection): calls custom adapter method', async () => {
        const { calls, _makeProvider, _makeContract } = makeFactories({
            [AGENT_DOC_ADAPTER_SINGLE.agentAdapter.toLowerCase()]: { registrationOwnerOf: TEST_OWNER },
        });
        const verifier = new OnChainVerifier({ logger: noLogger, _makeProvider, _makeContract });
        const owner = await verifier.getOwner(AGENT_DOC_ADAPTER_SINGLE);
        assert.equal(owner, getAddress(TEST_OWNER));
        assert.ok(calls.some(c => c.method === 'registrationOwnerOf'), 'custom adapter method called');
    });

    test('Mode C (adapter + collection): calls camelTokenIdOf then ownerOf', async () => {
        const { calls, _makeProvider, _makeContract } = makeFactories({
            [AGENT_DOC_ADAPTER_TWO_STEP.agentAdapter.toLowerCase()]:    { camelTokenIdOf: 99n },
            [AGENT_DOC_ADAPTER_TWO_STEP.agentCollection.toLowerCase()]: { ownerOf: TEST_OWNER },
        });
        const verifier = new OnChainVerifier({ logger: noLogger, _makeProvider, _makeContract });
        const owner = await verifier.getOwner(AGENT_DOC_ADAPTER_TWO_STEP);
        assert.equal(owner, getAddress(TEST_OWNER));
        assert.ok(calls.some(c => c.method === 'camelTokenIdOf'), 'camelTokenIdOf called');
        assert.ok(calls.some(c => c.method === 'ownerOf'), 'ownerOf called');
    });

    test('falls back to agentOwnerAddress when RPC is unavailable', async () => {
        // No env vars set in test env → default _makeProvider throws → falls back to stored owner
        const verifier = new OnChainVerifier({ logger: noLogger });
        const owner = await verifier.getOwner(AGENT_DOC_PLAIN);
        assert.equal(owner, TEST_OWNER);
    });

    test('Mode C caches registration→NFT mapping — camelTokenIdOf called once', async () => {
        const { calls, _makeProvider, _makeContract } = makeFactories({
            [AGENT_DOC_ADAPTER_TWO_STEP.agentAdapter.toLowerCase()]:    { camelTokenIdOf: 77n },
            [AGENT_DOC_ADAPTER_TWO_STEP.agentCollection.toLowerCase()]: { ownerOf: TEST_OWNER },
        });
        const verifier = new OnChainVerifier({ logger: noLogger, _makeProvider, _makeContract });
        await verifier.getOwner(AGENT_DOC_ADAPTER_TWO_STEP);
        await verifier.getOwner(AGENT_DOC_ADAPTER_TWO_STEP);
        assert.equal(
            calls.filter(c => c.method === 'camelTokenIdOf').length,
            1,
            'camelTokenIdOf called once due to cache'
        );
    });
});

// ── 3. VerifyService ──────────────────────────────────────────────────────────

describe('VerifyService', () => {
    const { ChallengeService } = require('../../../src/core/services/agents/ChallengeService');
    const { VerifyService }    = require('../../../src/core/services/agents/VerifyService');

    function makeSvc({ ownerAddr = TEST_OWNER, eip1271 = false } = {}) {
        return new VerifyService({
            challengeService: new ChallengeService(),
            onChainVerifier:  mockVerifier(ownerAddr, { eip1271 }),
            sessionSecret:    SESSION_SECRET,
            logger:           noLogger,
        });
    }

    test('verify succeeds when recovered address matches on-chain owner', async () => {
        const svc = makeSvc();
        const { sessionJwt, ownerAddress } = await signAndVerify(svc, AGENT_DOC_PLAIN);
        assert.ok(sessionJwt, 'session JWT issued');
        assert.equal(ownerAddress, TEST_OWNER);
        const payload = jwt.verify(sessionJwt, SESSION_SECRET, { algorithms: ['HS256'] });
        assert.equal(payload.sub, AGENT_DOC_PLAIN.agentId);
        assert.equal(payload.tier, 'agent_owner');
    });

    test('session JWT carries ownerAddress and chainId', async () => {
        const svc = makeSvc();
        const { sessionJwt } = await signAndVerify(svc, AGENT_DOC_PLAIN);
        const payload = jwt.verify(sessionJwt, SESSION_SECRET, { algorithms: ['HS256'] });
        assert.equal(payload.ownerAddress, TEST_OWNER);
        assert.equal(payload.chainId, AGENT_DOC_PLAIN.agentChainId);
    });

    test('throws OWNERSHIP_MISMATCH when signer is not the on-chain owner', async () => {
        const differentOwner = Wallet.createRandom().address;
        const svc = makeSvc({ ownerAddr: differentOwner }); // on-chain owner is someone else
        await assert.rejects(
            () => signAndVerify(svc, AGENT_DOC_PLAIN),
            err => err.code === 'OWNERSHIP_MISMATCH'
        );
    });

    test('throws INVALID_SIGNATURE for a malformed signature', async () => {
        const svc = makeSvc();
        const { message } = svc.issueChallenge(AGENT_DOC_PLAIN);
        await assert.rejects(
            () => svc.verify(AGENT_DOC_PLAIN, { nonce: message.nonce, signature: '0xdeadbeef' }),
            err => err.code === 'INVALID_SIGNATURE'
        );
    });

    test('EIP-1271 fallback: accepts signature from a contract wallet', async () => {
        // recovered address will NOT match on-chain owner (different wallet)
        // but isValidSignature returns true → auth succeeds
        const contractOwner = '0xDeadDeAddeAddEAddeadDEaDDEAdDeaDDeAD0000';
        const svc = new VerifyService({
            challengeService: new ChallengeService(),
            onChainVerifier:  mockVerifier(contractOwner, { eip1271: true }),
            sessionSecret:    SESSION_SECRET,
            logger:           noLogger,
        });
        // Sign with TEST_WALLET — won't match contractOwner directly, but EIP-1271 says OK
        const { sessionJwt } = await signAndVerify(svc, AGENT_DOC_PLAIN);
        assert.ok(sessionJwt);
    });

    test('throws CHALLENGE_NOT_FOUND when no challenge was issued', async () => {
        const svc = makeSvc();
        await assert.rejects(
            () => svc.verify(AGENT_DOC_PLAIN, { nonce: 'ghost', signature: '0x00' }),
            err => err.code === 'CHALLENGE_NOT_FOUND'
        );
    });

    test('throws CONFIG_ERROR when sessionSecret is absent', async () => {
        const svc = new VerifyService({
            challengeService: new ChallengeService(),
            onChainVerifier:  mockVerifier(),
            sessionSecret:    null,
            logger:           noLogger,
        });
        const { message } = svc.issueChallenge(AGENT_DOC_PLAIN);
        const signature   = await TEST_WALLET.signTypedData(
            { name: 'StationThis Agent Auth', version: '1', chainId: 1 },
            { AgentAuth: [{ name: 'agentId', type: 'string' }, { name: 'nonce', type: 'string' }, { name: 'statement', type: 'string' }, { name: 'expiresAt', type: 'uint256' }] },
            message
        );
        await assert.rejects(
            () => svc.verify(AGENT_DOC_PLAIN, { nonce: message.nonce, signature }),
            err => err.code === 'CONFIG_ERROR'
        );
    });

    test('issueChallenge returns EIP-712 structure from ChallengeService', () => {
        const svc = makeSvc();
        const challenge = svc.issueChallenge(AGENT_DOC_PLAIN);
        assert.equal(challenge.primaryType, 'AgentAuth');
        assert.equal(challenge.domain.chainId, AGENT_DOC_PLAIN.agentChainId);
        assert.equal(challenge.message.agentId, AGENT_DOC_PLAIN.agentId);
    });
});

// ── 4. agentOwnerSession middleware ───────────────────────────────────────────

describe('agentOwnerSession middleware', () => {
    const { agentOwnerSession } = require('../../../src/api/internal/treasury/middleware/agentOwnerSession');

    const ORIG_SECRET = process.env.AGENT_SESSION_SECRET;
    before(() => { process.env.AGENT_SESSION_SECRET = SESSION_SECRET; });
    after(() => {
        if (ORIG_SECRET === undefined) delete process.env.AGENT_SESSION_SECRET;
        else process.env.AGENT_SESSION_SECRET = ORIG_SECRET;
    });

    function makeJwt(overrides = {}) {
        return jwt.sign(
            { sub: 'agent-1', ownerAddress: TEST_OWNER, chainId: 1, tier: 'agent_owner', ...overrides },
            SESSION_SECRET,
            { algorithm: 'HS256', expiresIn: 3600 }
        );
    }

    function run(middleware, req) {
        return new Promise((resolve, reject) => {
            const res = {
                status(code) { this._code = code; return this; },
                json(body)   { resolve({ code: this._code, body }); },
            };
            middleware(req, res, () => resolve({ passed: true, req }));
        });
    }

    test('valid JWT sets req.agentSession and calls next', async () => {
        const token = makeJwt();
        const req   = { headers: { authorization: `Bearer ${token}` } };
        const result = await run(agentOwnerSession(), req);
        assert.ok(result.passed);
        assert.equal(result.req.agentSession.agentId, 'agent-1');
        assert.equal(result.req.agentSession.ownerAddress, TEST_OWNER);
    });

    test('missing token returns 401 MISSING_TOKEN', async () => {
        const result = await run(agentOwnerSession(), { headers: {} });
        assert.equal(result.code, 401);
        assert.equal(result.body.error.code, 'MISSING_TOKEN');
    });

    test('expired JWT returns 401 TOKEN_EXPIRED', async () => {
        const token = jwt.sign(
            { sub: 'agent-1', ownerAddress: TEST_OWNER, chainId: 1, tier: 'agent_owner' },
            SESSION_SECRET,
            { algorithm: 'HS256', expiresIn: -1 }
        );
        const result = await run(agentOwnerSession(), { headers: { authorization: `Bearer ${token}` } });
        assert.equal(result.code, 401);
        assert.equal(result.body.error.code, 'TOKEN_EXPIRED');
    });

    test('wrong tier returns 403 WRONG_TIER', async () => {
        const token = makeJwt({ tier: 'multisig' });
        const result = await run(agentOwnerSession(), { headers: { authorization: `Bearer ${token}` } });
        assert.equal(result.code, 403);
        assert.equal(result.body.error.code, 'WRONG_TIER');
    });

    test('required=false allows unauthenticated request through', async () => {
        const result = await run(agentOwnerSession({ required: false }), { headers: {} });
        assert.ok(result.passed);
        assert.equal(result.req.agentSession, null);
    });

    test('tampered JWT returns 401 INVALID_TOKEN', async () => {
        const token = makeJwt() + 'garbage';
        const result = await run(agentOwnerSession(), { headers: { authorization: `Bearer ${token}` } });
        assert.equal(result.code, 401);
        assert.equal(result.body.error.code, 'INVALID_TOKEN');
    });
});
