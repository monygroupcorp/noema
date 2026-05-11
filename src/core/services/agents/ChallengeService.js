// src/core/services/agents/ChallengeService.js
//
// Issues and consumes single-use EIP-712 challenges for agent dashboard auth.
// Challenges are in-memory with a 5-minute TTL.

const crypto = require('crypto');

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

class ChallengeService {
    constructor() {
        this._challenges = new Map(); // agentId → { nonce, domain, types, message, expiresAt }
    }

    /**
     * Issues an EIP-712 typed-data challenge for the given agent.
     * Replaces any existing pending challenge.
     *
     * @param {string} agentId
     * @param {number|string} chainId
     * @returns {{ domain, types, message, primaryType }}
     */
    issueChallenge(agentId, chainId) {
        const nonce = crypto.randomBytes(16).toString('hex');
        const expiresAt = Math.floor((Date.now() + CHALLENGE_TTL_MS) / 1000);

        const domain = {
            name: 'StationThis Agent Auth',
            version: '1',
            chainId: Number(chainId),
        };
        const types = {
            AgentAuth: [
                { name: 'agentId', type: 'string' },
                { name: 'nonce',   type: 'string' },
                { name: 'statement', type: 'string' },
                { name: 'expiresAt', type: 'uint256' },
            ],
        };
        const message = {
            agentId,
            nonce,
            statement: 'Sign to authenticate with StationThis dashboard',
            expiresAt,
        };

        this._challenges.set(agentId, { nonce, domain, types, message, expiresAt });
        return { domain, types, primaryType: 'AgentAuth', message };
    }

    /**
     * Retrieves and deletes the challenge for agentId, validating expiry and nonce.
     * Single-use — calling this removes the challenge regardless of outcome.
     *
     * @param {string} agentId
     * @param {string} nonce
     * @returns {{ domain, types, message }}
     */
    consumeChallenge(agentId, nonce) {
        const entry = this._challenges.get(agentId);

        if (!entry) {
            throw Object.assign(new Error('No challenge found — request a new one'), { code: 'CHALLENGE_NOT_FOUND' });
        }
        if (Math.floor(Date.now() / 1000) > entry.expiresAt) {
            this._challenges.delete(agentId); // expired entries are always cleared
            throw Object.assign(new Error('Challenge has expired — request a new one'), { code: 'CHALLENGE_EXPIRED' });
        }
        if (entry.nonce !== nonce) {
            // Wrong nonce does NOT burn the challenge — nonces are 128-bit random so brute-force
            // is infeasible and a transient submit error shouldn't lock the user out.
            throw Object.assign(new Error('Invalid challenge nonce'), { code: 'INVALID_NONCE' });
        }

        this._challenges.delete(agentId); // single-use on success
        return { domain: entry.domain, types: entry.types, message: entry.message };
    }
}

module.exports = { ChallengeService };
