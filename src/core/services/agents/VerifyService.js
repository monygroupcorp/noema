// src/core/services/agents/VerifyService.js
//
// Orchestrates the challenge/verify dance:
//   1. Consume the pending challenge and hash the EIP-712 typed data
//   2. ecrecover the signer from the signature
//   3. Compare against the current on-chain owner (with EIP-1271 fallback)
//   4. Issue a signed HS256 session JWT on success

const { TypedDataEncoder, recoverAddress, getAddress } = require('ethers');
const jwt = require('jsonwebtoken');

const SESSION_TTL_SECONDS = 24 * 60 * 60;

class VerifyService {
    constructor({ challengeService, onChainVerifier, sessionSecret, logger } = {}) {
        this.challengeService = challengeService;
        this.onChainVerifier = onChainVerifier;
        this.sessionSecret = sessionSecret || process.env.AGENT_SESSION_SECRET || null;
        this.logger = logger || console;
    }

    /**
     * Wraps ChallengeService.issueChallenge for a given agent doc.
     * @param {object} agentDoc
     * @returns {{ domain, types, primaryType, message }}
     */
    issueChallenge(agentDoc) {
        return this.challengeService.issueChallenge(agentDoc.agentId, agentDoc.agentChainId);
    }

    /**
     * Verifies the owner's signature against the pending challenge and issues a session JWT.
     *
     * @param {object} agentDoc - Agent userCore document
     * @param {{ nonce: string, signature: string }} params
     * @returns {Promise<{ sessionJwt: string, ownerAddress: string }>}
     */
    async verify(agentDoc, { nonce, signature }) {
        if (!this.sessionSecret) {
            throw Object.assign(new Error('AGENT_SESSION_SECRET is not configured'), { code: 'CONFIG_ERROR' });
        }

        const { agentId, agentChainId } = agentDoc;

        // 1. Consume single-use challenge (throws if not found/expired/wrong nonce)
        const { domain, types, message } = this.challengeService.consumeChallenge(agentId, nonce);

        // 2. Hash EIP-712 typed data
        const hash = TypedDataEncoder.hash(domain, types, message);

        // 3. Recover signer address
        let recoveredAddress;
        try {
            recoveredAddress = getAddress(recoverAddress(hash, signature));
        } catch {
            throw Object.assign(new Error('Cannot recover address from signature — invalid signature format'), { code: 'INVALID_SIGNATURE' });
        }

        // 4. Get current on-chain owner
        const onChainOwner = await this.onChainVerifier.getOwner(agentDoc);
        if (!onChainOwner) {
            throw Object.assign(new Error('Cannot resolve on-chain owner for this agent'), { code: 'OWNER_RESOLUTION_FAILED' });
        }

        // 5a. Direct EOA match
        let verified = recoveredAddress.toLowerCase() === onChainOwner.toLowerCase();

        // 5b. EIP-1271 fallback for smart-contract wallets
        if (!verified) {
            verified = await this.onChainVerifier.isValidSignature(agentDoc, hash, signature);
        }

        if (!verified) {
            throw Object.assign(
                new Error(`Ownership verification failed — recovered ${recoveredAddress}, on-chain owner ${onChainOwner}`),
                { code: 'OWNERSHIP_MISMATCH' }
            );
        }

        // 6. Issue session JWT
        const sessionJwt = jwt.sign(
            { sub: agentId, ownerAddress: onChainOwner, chainId: Number(agentChainId), tier: 'agent_owner' },
            this.sessionSecret,
            { algorithm: 'HS256', expiresIn: SESSION_TTL_SECONDS }
        );

        this.logger.info(`[VerifyService] Agent ${agentId} authenticated by owner ${onChainOwner}`);
        return { sessionJwt, ownerAddress: onChainOwner };
    }
}

module.exports = { VerifyService };
