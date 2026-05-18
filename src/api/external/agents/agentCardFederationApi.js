/**
 * Agent Card Federation API
 *
 * Provides federated agent card data for CAMEL ERC-8004 card builders:
 *   - Per-agent balance + recent usage
 *   - Dynamically-quoted spell capabilities with x402 pricing
 *
 * Routes (registered with full paths, mount at / in external API):
 *   GET /treasury/:treasuryId/agents/:agentId
 *   GET /agents/:agentAccountId/capabilities
 */

const express = require('express');
const { pointsToUsd } = require('./agentUtils');

// USDC has 6 decimals; grossAmount in split_ledger is stored as USDC atomic units.
// e.g. "50000" → $0.05 USDC
function grossAmountToUsd(entry) {
  const raw = Number(entry.grossAmount || 0);
  return (raw / 1e6).toFixed(6);
}

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
 * @param {object} [deps.spellsService]
 * @param {object} [deps.logger]
 * @returns {express.Router}
 */
function createAgentCardFederationApi({ agentAccountDb, treasuryDb, splitLedgerDb, spellsService, logger }) {
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

      // Step 4 — Query recent usage via partnerId (closest available filter in SplitLedgerDB)
      let recentUsage = [];
      if (splitLedgerDb && typeof splitLedgerDb.findByPartnerId === 'function' && treasury.partnerId) {
        try {
          const entries = await splitLedgerDb.findByPartnerId(treasury.partnerId, 10);
          recentUsage = (entries || []).map(entry => ({
            spell: entry.spellSlug || entry.spell || null,
            cost: { amount: grossAmountToUsd(entry), currency: 'USDC' },
            timestamp: Math.floor(new Date(entry.createdAt).getTime() / 1000),
          }));
        } catch (err) {
          log.warn('[agentCardFederation] Failed to fetch recent usage', { treasuryId, error: err.message });
          // Non-fatal — return empty recentUsage
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
