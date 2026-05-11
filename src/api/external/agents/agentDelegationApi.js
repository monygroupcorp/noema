// src/api/external/agents/agentDelegationApi.js
//
// Public endpoints for delegation token redemption.
// No auth required — the delegation token IS the credential.
//
// POST /agents/:agentId/delegations/:token/redeem
//   → validates the token, sets a delegation session JWT as an httpOnly cookie,
//     and returns the agent's public profile. From this point the visitor's
//     requests are authenticated as the agent account (dualAuth reads the cookie).

const express = require('express');
const { DelegationService } = require('../../../core/services/agents/DelegationService');

/**
 * @param {{ db, logger }} deps
 * @returns {express.Router}
 */
function createAgentDelegationApi(deps = {}) {
  const router = express.Router();
  const logger = deps.logger || console;

  const delegationSvc = new DelegationService({
    delegationsDb: deps.db?.agentDelegations,
    userCoreDb: deps.db?.userCore,
    logger,
  });

  function handleErr(res, err, label) {
    logger.error(`[AgentDelegationApi] ${label}: ${err.message}`);
    const codeToStatus = {
      INVALID_TOKEN: 401,
      REVOKED: 410,
      EXPIRED: 410,
      CAP_EXHAUSTED: 402,
      NOT_FOUND: 404,
    };
    res.status(codeToStatus[err.code] || 500).json({
      error: { code: err.code || 'INTERNAL_ERROR', message: err.message },
    });
  }

  /**
   * POST /agents/:agentId/delegations/:token/redeem
   *
   * Validates the delegation token and issues a session cookie.
   * The response body includes the agent's public profile so the frontend
   * can render the agent page immediately.
   *
   * After calling this endpoint the visitor should reload their session —
   * all subsequent generation/spell requests will be charged to the agent.
   */
  router.post('/:agentId/delegations/:token/redeem', async (req, res) => {
    try {
      const { agentId, token } = req.params;
      const { sessionJwt, agentDoc } = await delegationSvc.redeem(agentId, token);

      const isProduction = process.env.NODE_ENV === 'production';

      // Set as httpOnly cookie — same pattern as the main auth flow
      res.cookie('jwt', sessionJwt, {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? 'strict' : 'lax',
        maxAge: 2 * 60 * 60 * 1000, // 2 hours in ms
      });

      // Return a sanitised public view of the agent
      res.json({
        success: true,
        agent: {
          _id: agentDoc._id,
          agentId: agentDoc.agentId,
          agentChainId: agentDoc.agentChainId,
          agentTokenId: agentDoc.agentTokenId,
          agentCollection: agentDoc.agentCollection,
          scope: agentDoc.scope,
          profile: agentDoc.profile,
        },
        sessionType: 'delegation',
      });
    } catch (err) {
      handleErr(res, err, 'POST /agents/:agentId/delegations/:token/redeem');
    }
  });

  return router;
}

module.exports = { createAgentDelegationApi };
