/**
 * Agent Card Federation API
 *
 * Provides federated agent card data for CAMEL ERC-8004 card builders:
 *   - Per-agent balance + recent usage
 *   - Dynamically-quoted spell capabilities with x402 pricing
 *
 * Routes (registered with full paths, mount at / in external API):
 *   GET  /treasury/:treasuryId/agents/:agentId
 *   POST /treasury/:treasuryId/agents/:agentId/donate
 *   GET  /agents/:agentAccountId/capabilities
 */

const express = require('express');
const { pointsToUsd, atomicUsdcToUsd } = require('./agentUtils');

// Static capability list used when spellsService is unavailable or has no listing method.
// v1: DALL-E 3 image generation is the primary capability exposed to CAMEL agents.
const STATIC_CAPABILITIES = [
  {
    id: 'spell.generate-image',
    name: 'Generate image',
    endpoint: 'https://noema.art/api/v1/partner/spells/generate-image/run',
    method: 'POST',
    x402: {
      version: '1',
      price: { amount: '0.05', currency: 'USDC' },
      chains: [8453],
      facilitator: 'https://x402.facilitator.noema.art',
    },
  },
];

/**
 * Create Agent Card Federation API router.
 *
 * @param {object} deps
 * @param {object} deps.agentAccountDb
 * @param {object} deps.treasuryDb
 * @param {object} deps.splitLedgerDb
 * @param {object} [deps.agentJwtVerifier]
 * @param {object} [deps.spellsService]
 * @param {object} [deps.economyService]
 * @param {object} [deps.logger]
 * @returns {express.Router}
 */
function createAgentCardFederationApi({ agentAccountDb, treasuryDb, splitLedgerDb, agentJwtVerifier, spellsService, economyService, logger }) {
  const log = logger || console;
  const router = express.Router();

  /**
   * GET /treasury/:treasuryId/agents/:agentId
   *
   * Returns per-agent balance and recent usage for the CAMEL card builder.
   */
  router.get('/treasury/:treasuryId/agents/:agentId', async (req, res) => {
    const { treasuryId, agentId } = req.params;

    try {
      // Step 1 — Find agent account by agentId
      const agentAccount = await agentAccountDb.findByAgentId(agentId);
      if (!agentAccount) {
        return res.status(404).json({ error: { code: 'AGENT_NOT_FOUND', message: 'Agent account not found' } });
      }

      // Step 2 — Verify treasury ownership
      if (agentAccount.treasuryId !== treasuryId) {
        return res.status(404).json({ error: { code: 'AGENT_NOT_FOUND', message: 'Agent not found in this treasury' } });
      }

      // Step 3 — Fetch treasury
      const treasury = await treasuryDb.findByTreasuryId(treasuryId);
      if (!treasury) {
        log.error('[agentCardFederation] Treasury not found', { treasuryId, agentId });
        return res.status(500).json({ error: { code: 'TREASURY_NOT_FOUND', message: 'Treasury configuration missing' } });
      }

      // Step 4 — Recent usage: last 5 runs attributed to this agentId on the split ledger.
      let recentUsage = [];
      if (splitLedgerDb) {
        try {
          const entries = await splitLedgerDb.findByAgentId(agentId, 5);
          recentUsage = entries.map(e => ({
            spell: e.spellSlug,
            cost: { amount: atomicUsdcToUsd(e.grossAmount || '0'), currency: 'USDC' },
            timestamp: e.createdAt instanceof Date ? e.createdAt.getTime() : new Date(e.createdAt).getTime(),
          }));
        } catch (usageErr) {
          log.warn('[agentCardFederation] Could not fetch recentUsage', { agentId, error: usageErr.message });
        }
      }

      // Step 5 — Return response
      return res.status(200).json({
        agentAccountId: agentAccount.agentAccountId,
        balance: { amount: pointsToUsd(agentAccount.balance), currency: 'USDC' },
        monthlyCap: pointsToUsd(treasury.faucetPolicy?.monthlyMax || 0),
        recentUsage,
      });

    } catch (err) {
      log.error('[agentCardFederation] Unexpected error in agent balance handler', { treasuryId, agentId, error: err.message });
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected error fetching agent data' } });
    }
  });

  /**
   * POST /treasury/:treasuryId/agents/:agentId/donate
   *
   * Treasury-funded manual top-up of an agent sub-account.  The caller must present a
   * valid CAMEL JWT signed by the treasury's registered JWKS issuer, proving they control
   * the treasury.  Points are atomically debited from the treasury balance and credited to
   * the agent sub-account and Noema economy ledger.
   *
   * This is the manual complement to the automated faucet drip — the treasury owner can
   * reward specific agents on demand, outside the drip schedule.
   */
  router.post('/treasury/:treasuryId/agents/:agentId/donate', async (req, res) => {
    const { treasuryId, agentId } = req.params;
    try {
      // Step 1 — Validate points input
      const { points } = req.body;
      if (points === undefined || points === null) {
        return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'points is required' } });
      }
      if (!Number.isInteger(points) || points <= 0) {
        return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'points must be a positive integer' } });
      }

      // Step 2 — Fetch treasury (needed for issuerDomain before JWT verification)
      const treasury = await treasuryDb.findByTreasuryId(treasuryId);
      if (!treasury) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: `Treasury ${treasuryId} not found` } });
      }

      // Step 3 — Verify caller is the treasury's issuer (CAMEL JWT signed by treasury JWKS)
      if (!agentJwtVerifier) {
        return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'JWT verification not available' } });
      }
      const authHeader = req.get('Authorization') || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (!token) {
        return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Bearer token required' } });
      }
      try {
        await agentJwtVerifier.verifyAssertionJwt(token, treasury.issuerDomain);
      } catch (err) {
        if (err.name === 'JwksUnavailableError') {
          return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'JWKS service unavailable' } });
        }
        return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired JWT' } });
      }

      // Step 4 — Find and validate agent account
      const agentAccount = await agentAccountDb.findByAgentId(agentId);
      if (!agentAccount) {
        return res.status(404).json({ error: { code: 'AGENT_NOT_FOUND', message: 'Agent account not found' } });
      }
      if (agentAccount.treasuryId !== treasuryId) {
        return res.status(400).json({ error: { code: 'BAD_REQUEST', message: `Agent ${agentId} does not belong to treasury ${treasuryId}` } });
      }
      if (agentAccount.status !== 'active') {
        return res.status(400).json({ error: { code: 'AGENT_SUSPENDED', message: 'Agent account is not active' } });
      }

      // Step 5 — Atomic treasury debit
      const debited = await treasuryDb.debitBalance(treasuryId, points);
      if (!debited) {
        return res.status(400).json({ error: { code: 'INSUFFICIENT_BALANCE', message: 'Treasury has insufficient balance' } });
      }

      // Step 6 — Credit agent sub-account
      // TODO(v2): if addBalance throws after debitBalance succeeds, compensate by re-crediting treasury.
      await agentAccountDb.addBalance(agentAccount.agentAccountId, points);

      // Step 7 — Credit Noema economy ledger (non-fatal)
      if (economyService && !agentAccount.noemaAccountId) {
        log.warn('[agentCardFederation] agentAccount missing noemaAccountId — sub-account credited but Noema ledger skipped', {
          agentAccountId: agentAccount.agentAccountId,
        });
      }
      if (economyService && agentAccount.noemaAccountId) {
        try {
          await economyService.creditPoints(agentAccount.noemaAccountId, {
            points,
            description: `Treasury donation from ${treasuryId}`,
            rewardType: 'AGENT_DONATE',
            relatedItems: { agentAccountId: agentAccount.agentAccountId, treasuryId },
          });
        } catch (creditErr) {
          log.error('[agentCardFederation] creditPoints failed on donate — sub-account credited but noema ledger not updated', {
            agentAccountId: agentAccount.agentAccountId,
            error: creditErr.message,
          });
        }
      }

      log.info('[agentCardFederation] Treasury donation completed', { treasuryId, agentId, points });
      return res.status(200).json({
        agentAccountId: agentAccount.agentAccountId,
        donatedPoints: points,
      });
    } catch (err) {
      log.error('[agentCardFederation] Unexpected error in donate handler', { treasuryId, agentId, error: err.message });
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected error processing donation' } });
    }
  });

  /**
   * GET /agents/:agentAccountId/capabilities
   *
   * Returns dynamically-quoted spell capabilities for the agent's CAMEL card.
   */
  router.get('/agents/:agentAccountId/capabilities', async (req, res) => {
    const { agentAccountId } = req.params;

    try {
      // Step 1 — Find agent account
      const agentAccount = await agentAccountDb.findByAgentAccountId(agentAccountId);
      if (!agentAccount) {
        return res.status(404).json({ error: { code: 'AGENT_NOT_FOUND', message: 'Agent account not found' } });
      }

      // Step 2 — Check agent is active
      if (agentAccount.status !== 'active') {
        return res.status(403).json({ error: { code: 'AGENT_SUSPENDED', message: 'Agent account is not active' } });
      }

      // Step 3 — Build capabilities array with dynamic pricing where available
      let capabilities = [];

      if (spellsService && typeof spellsService.db?.spells?.findPublicSpells === 'function') {
        try {
          const publicSpells = await spellsService.db.spells.findPublicSpells({}, { limit: 20 });
          capabilities = await Promise.all(
            (publicSpells || []).map(async (spell) => {
              const slug = spell.slug || spell.publicSlug || spell.name;
              let priceAmount = '0.05'; // static default

              // Attempt dynamic quote via spellsService.quoteSpell
              if (slug && typeof spellsService.quoteSpell === 'function') {
                try {
                  const quote = await spellsService.quoteSpell(slug);
                  if (quote && typeof quote.totalCostPts === 'number' && quote.totalCostPts > 0) {
                    priceAmount = pointsToUsd(quote.totalCostPts);
                  }
                } catch (quoteErr) {
                  log.warn('[agentCardFederation] quoteSpell failed, using static default', { slug, error: quoteErr.message });
                }
              }

              return {
                id: `spell.${slug}`,
                name: spell.name || slug,
                endpoint: `https://noema.art/api/v1/partner/spells/${slug}/run`,
                method: 'POST',
                x402: {
                  version: '1',
                  price: { amount: priceAmount, currency: 'USDC' },
                  chains: [8453],
                  facilitator: 'https://x402.facilitator.noema.art',
                },
              };
            })
          );
        } catch (err) {
          log.warn('[agentCardFederation] Failed to load public spells, falling back to static list', { error: err.message });
          capabilities = STATIC_CAPABILITIES;
        }
      } else {
        // No spellsService or listing method — use static capability list for v1
        capabilities = STATIC_CAPABILITIES;
      }

      return res.status(200).json(capabilities);

    } catch (err) {
      log.error('[agentCardFederation] Unexpected error in capabilities handler', { agentAccountId, error: err.message });
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected error fetching capabilities' } });
    }
  });

  return router;
}

module.exports = { createAgentCardFederationApi };
