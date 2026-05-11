// src/core/services/agents/FaucetService.js
//
// Drips points from a treasury to its agent sub-accounts on a weekly cadence.
// All drips are idempotent via the `faucet:${agentId}:${weekIso}` key.

const { createLogger } = require('../../../utils/logger');
const { isoWeek } = require('./AgentAccountService');

const logger = createLogger('FaucetService');

class FaucetService {
  /**
   * @param {{ userCoreDb, economyService, creditLedgerDb, logger? }} deps
   */
  constructor({ userCoreDb, economyService, creditLedgerDb, logger: injectedLogger } = {}) {
    this.userCoreDb = userCoreDb;
    this.economyService = economyService;
    this.creditLedgerDb = creditLedgerDb;
    this.logger = injectedLogger || logger;
  }

  /**
   * Runs a faucet drip cycle for all agent sub-accounts of a given treasury.
   *
   * @param {string|import('mongodb').ObjectId} treasuryId
   * @returns {Promise<{ dripped: number, skipped: number, failed: number, results: Array }>}
   */
  async runForTreasury(treasuryId) {
    const treasury = await this.userCoreDb.findUserCoreById(treasuryId);
    if (!treasury || treasury.accountType !== 'treasury') {
      throw Object.assign(new Error(`Treasury ${treasuryId} not found`), { code: 'NOT_FOUND' });
    }

    const policy = treasury.treasuryFaucetPolicy;
    if (!policy || policy.subsidyMode === 'off') {
      this.logger.debug(`[FaucetService] Treasury ${treasuryId} has subsidyMode=off — skipping`);
      return { dripped: 0, skipped: 0, failed: 0, results: [] };
    }

    const { starterGrantPoints = 0, monthlyMaxPoints = 0 } = policy;

    if (starterGrantPoints <= 0) {
      this.logger.debug(`[FaucetService] Treasury ${treasuryId} has starterGrantPoints=0 — nothing to drip`);
      return { dripped: 0, skipped: 0, failed: 0, results: [] };
    }

    // Check treasury balance before starting
    const treasuryBalance = await this._sumBalance(treasury._id);
    if (treasuryBalance < starterGrantPoints) {
      this.logger.warn(`[FaucetService] Treasury ${treasuryId} balance (${treasuryBalance}) is below drip amount (${starterGrantPoints}) — skipping run`);
      return { dripped: 0, skipped: 0, failed: 0, results: [] };
    }

    // Find all agent sub-accounts for this treasury
    const agents = await this.userCoreDb.findByAccountType('agent', {
      masterTreasuryId: typeof treasuryId === 'string' ? { $oid: treasuryId } : treasuryId,
    }).catch(() => []);

    const weekIso = isoWeek();
    const results = [];
    let dripped = 0;
    let skipped = 0;
    let failed = 0;

    for (const agent of agents) {
      const agentId = agent.agentId || agent._id.toString();
      const result = await this._dripOne(treasury, agent, { starterGrantPoints, monthlyMaxPoints, weekIso });
      results.push({ agentId, ...result });
      if (result.status === 'dripped') dripped++;
      else if (result.status === 'skipped') skipped++;
      else failed++;
    }

    this.logger.info(`[FaucetService] Treasury ${treasuryId} drip complete: ${dripped} dripped, ${skipped} skipped, ${failed} failed`);
    return { dripped, skipped, failed, results };
  }

  /**
   * @private Drips to a single agent, respecting idempotency and monthly cap.
   */
  async _dripOne(treasury, agentDoc, { starterGrantPoints, monthlyMaxPoints, weekIso }) {
    const agentId = agentDoc.agentId || agentDoc._id.toString();
    const idempotencyKey = `faucet:${agentDoc._id}:${weekIso}`;

    // Idempotency check
    const existingDrip = await this.creditLedgerDb.findOne({ 'related_items.idempotencyKey': idempotencyKey }).catch(() => null);
    if (existingDrip) {
      return { status: 'skipped', reason: 'already_dripped_this_week' };
    }

    // Check if agent was active in the last 30 days (V1 placeholder: presence of any SPEND_DEBIT)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    let isActive = true;
    try {
      const recentSpend = await this.creditLedgerDb.findOne({
        master_account_id: agentDoc._id,
        type: 'SPEND_DEBIT',
        createdAt: { $gte: thirtyDaysAgo },
      });
      isActive = Boolean(recentSpend);
    } catch (err) {
      this.logger.warn(`[FaucetService] Could not check activity for agent ${agentId}: ${err.message}`);
    }

    if (!isActive) {
      return { status: 'skipped', reason: 'inactive_30d' };
    }

    // Monthly cap check
    if (monthlyMaxPoints > 0) {
      const balance = await this._sumBalance(agentDoc._id);
      if (balance >= monthlyMaxPoints) {
        return { status: 'skipped', reason: 'at_monthly_max', balance };
      }
    }

    // Check treasury still has enough for this drip
    const treasuryBalance = await this._sumBalance(treasury._id);
    if (treasuryBalance < starterGrantPoints) {
      this.logger.warn(`[FaucetService] Treasury ${treasury._id} exhausted during drip run`);
      return { status: 'failed', reason: 'treasury_insufficient', treasuryBalance };
    }

    try {
      await this.economyService.transferPoints(treasury._id, agentDoc._id, starterGrantPoints, {
        description: `Weekly faucet drip (${weekIso})`,
        rewardType: 'FAUCET_DRIP',
        relatedItems: { treasuryId: treasury._id.toString(), agentId, idempotencyKey },
        idempotencyKey,
      });

      this.logger.info(`[FaucetService] Dripped ${starterGrantPoints} pts to agent ${agentId} (${weekIso})`);
      return { status: 'dripped', points: starterGrantPoints };
    } catch (err) {
      this.logger.error(`[FaucetService] Failed to drip to agent ${agentId}: ${err.message}`);
      return { status: 'failed', reason: err.message };
    }
  }

  async _sumBalance(accountId) {
    try {
      const deposits = await this.creditLedgerDb.findActiveDepositsForUser(accountId);
      return deposits.reduce((sum, d) => sum + (d.points_remaining || 0), 0);
    } catch {
      return 0;
    }
  }
}

module.exports = { FaucetService };
