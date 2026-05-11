// src/core/services/agents/DelegationService.js
//
// Creates and validates agent delegation links.
// A delegation link lets a non-wallet visitor spend from an agent's balance.
// The visitor exchanges the opaque token for a short-lived session JWT that
// is indistinguishable from a regular user JWT to the rest of the system —
// but masterAccountId points to the agent account.

const jwt = require('jsonwebtoken');
const { createLogger } = require('../../../utils/logger');

const logger = createLogger('DelegationService');

// Session length for a redeemed delegation token
const DELEGATION_SESSION_SECONDS = 2 * 60 * 60; // 2 hours

class DelegationService {
  /**
   * @param {{ delegationsDb, userCoreDb, logger? }} deps
   */
  constructor({ delegationsDb, userCoreDb, logger: injectedLogger } = {}) {
    this.delegationsDb = delegationsDb;
    this.userCoreDb = userCoreDb;
    this.logger = injectedLogger || logger;
  }

  // ---------------------------------------------------------------------------
  // Agent-owner operations (require verified agent ownership upstream)
  // ---------------------------------------------------------------------------

  /**
   * Creates a new delegation link for an agent.
   *
   * @param {string} agentId - ERC-8004 agentId
   * @param {{ label?, spendCapPoints?, expiresInHours? }} options
   * @returns {Promise<{ delegation: object, shareUrl: string }>}
   */
  async create(agentId, { label, spendCapPoints, expiresInHours } = {}) {
    const agentDoc = await this._requireAgent(agentId);

    const expiresAt = expiresInHours
      ? new Date(Date.now() + expiresInHours * 60 * 60 * 1000)
      : null;

    const delegation = await this.delegationsDb.create({
      agentId,
      agentAccountId: agentDoc._id,
      label,
      spendCapPoints: spendCapPoints || null,
      expiresAt,
    });

    this.logger.info(`[DelegationService] Created delegation ${delegation._id} for agent ${agentId}`);
    return { delegation, token: delegation.token };
  }

  /**
   * Lists all active (non-revoked) delegations for an agent.
   * Includes expired ones so the owner can see history.
   *
   * @param {string} agentId
   */
  async list(agentId) {
    const agentDoc = await this._requireAgent(agentId);
    const delegations = await this.delegationsDb.findByAgentAccountId(agentDoc._id);
    const now = new Date();
    return delegations.map(d => ({
      ...d,
      isExpired: d.expiresAt ? d.expiresAt < now : false,
      remainingPoints: d.spendCapPoints !== null ? d.spendCapPoints - d.pointsSpent : null,
    }));
  }

  /**
   * Revokes a delegation. Validates that it belongs to the given agent.
   *
   * @param {string} agentId
   * @param {string} delegationId
   */
  async revoke(agentId, delegationId) {
    const agentDoc = await this._requireAgent(agentId);
    const delegation = await this.delegationsDb.findById(delegationId);

    if (!delegation) {
      throw Object.assign(new Error('Delegation not found'), { code: 'NOT_FOUND' });
    }
    if (delegation.agentAccountId.toString() !== agentDoc._id.toString()) {
      throw Object.assign(new Error('Delegation does not belong to this agent'), { code: 'FORBIDDEN' });
    }

    await this.delegationsDb.revoke(delegationId);
    this.logger.info(`[DelegationService] Revoked delegation ${delegationId} for agent ${agentId}`);
  }

  // ---------------------------------------------------------------------------
  // Visitor operations (public — no ownership verification)
  // ---------------------------------------------------------------------------

  /**
   * Validates a delegation token and issues a short-lived session JWT.
   * The JWT is cookie-compatible with the platform's standard dualAuth flow —
   * the visitor's requests will charge the agent's masterAccountId.
   *
   * @param {string} agentId
   * @param {string} token - Opaque delegation token from the URL
   * @returns {Promise<{ sessionJwt: string, delegation: object, agentDoc: object }>}
   */
  async redeem(agentId, token) {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) throw new Error('JWT_SECRET not configured');

    const delegation = await this.delegationsDb.findByToken(token);

    if (!delegation) {
      throw Object.assign(new Error('Invalid delegation token'), { code: 'INVALID_TOKEN' });
    }
    if (delegation.agentId !== agentId) {
      throw Object.assign(new Error('Token does not match agent'), { code: 'INVALID_TOKEN' });
    }
    if (delegation.revokedAt) {
      throw Object.assign(new Error('This delegation link has been revoked'), { code: 'REVOKED' });
    }
    if (delegation.expiresAt && new Date() > new Date(delegation.expiresAt)) {
      throw Object.assign(new Error('This delegation link has expired'), { code: 'EXPIRED' });
    }

    // Check spend cap at redeem time (best-effort; real enforcement is at recordSpend)
    if (delegation.spendCapPoints !== null && delegation.pointsSpent >= delegation.spendCapPoints) {
      throw Object.assign(new Error('This delegation link has reached its spending limit'), { code: 'CAP_EXHAUSTED' });
    }

    const agentDoc = await this.userCoreDb.findUserCoreById(delegation.agentAccountId);
    if (!agentDoc) throw Object.assign(new Error('Agent account not found'), { code: 'NOT_FOUND' });

    // Remaining point budget for this session
    const remainingPoints = delegation.spendCapPoints !== null
      ? delegation.spendCapPoints - delegation.pointsSpent
      : null;

    // Issue a delegation session JWT.
    // Uses platform JWT_SECRET so dualAuth verifies it transparently.
    // masterAccountId = agent's account → all charges hit the agent's balance.
    const sessionPayload = {
      userId: agentDoc._id.toString(),
      masterAccountId: agentDoc._id.toString(),
      sessionType: 'delegation',
      delegationId: delegation._id.toString(),
      agentId,
      ...(remainingPoints !== null && { delegationRemainingPoints: remainingPoints }),
    };

    const sessionJwt = jwt.sign(sessionPayload, jwtSecret, {
      expiresIn: DELEGATION_SESSION_SECONDS,
    });

    this.logger.info(`[DelegationService] Redeemed delegation ${delegation._id} for agent ${agentId} (remaining: ${remainingPoints ?? 'unlimited'} pts)`);

    return { sessionJwt, delegation, agentDoc };
  }

  /**
   * Records spend against a delegation after a successful charge.
   * Should be called by the generation execution path when delegationId is present.
   * Non-throwing — logs errors rather than failing the request.
   *
   * @param {string} delegationId
   * @param {number} points
   */
  async recordSpend(delegationId, points) {
    try {
      await this.delegationsDb.recordSpend(delegationId, points);
      this.logger.debug(`[DelegationService] Recorded ${points} pts spend against delegation ${delegationId}`);
    } catch (err) {
      // CAP_EXCEEDED here means a race condition — the charge already went through,
      // so we log rather than throw to avoid a false error surface.
      this.logger.warn(`[DelegationService] recordSpend for ${delegationId}: ${err.message} (code: ${err.code})`);
    }
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  async _requireAgent(agentId) {
    const agentDoc = await this.userCoreDb.findByAgentId(agentId);
    if (!agentDoc) throw Object.assign(new Error(`Agent ${agentId} not found`), { code: 'NOT_FOUND' });
    return agentDoc;
  }
}

module.exports = { DelegationService };
