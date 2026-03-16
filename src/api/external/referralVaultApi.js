const express = require('express');
const { ethers } = require('ethers');
const { createLogger } = require('../../utils/logger');
const creditVaultAbi = require('../../core/contracts/abis/creditVault.json');
const { getCreditVaultAddress } = require('../../core/services/alchemy/foundationConfig');

const logger = createLogger('ReferralVaultApi');

function createReferralVaultApi(dependencies) {
  const { ethereumServices = {}, ethereumService: legacyEth, priceFeedService, creditServices = {}, creditService: legacyCredit } = dependencies;

  const getChainServices = (cid = '1') => ({
    ethereumService: ethereumServices[cid] || legacyEth,
    creditService: creditServices[cid] || legacyCredit,
  });

  const router = express.Router();

  /**
   * GET /check-name?name=coolname&chainId=1
   * Reads referralOwner(keccak256(name)) on-chain. Returns availability.
   */
  router.get('/check-name', async (req, res) => {
    const { name, chainId: queryChainId } = req.query;
    const chainId = String(queryChainId || '1');

    if (!name || name.length < 4 || !/^[a-zA-Z0-9_-]+$/.test(name)) {
      return res.status(400).json({ error: { code: 'INVALID_NAME', message: 'Name must be at least 4 characters and contain only letters, numbers, underscores, or dashes.' } });
    }

    try {
      const { ethereumService } = getChainServices(chainId);
      const vaultAddress = getCreditVaultAddress(chainId);
      const referralKey = ethers.keccak256(ethers.toUtf8Bytes(name));

      const owner = await ethereumService.read(vaultAddress, creditVaultAbi, 'referralOwner', referralKey);
      const isAvailable = owner === ethers.ZeroAddress;

      const result = { name, referralKey, isAvailable };
      if (!isAvailable) {
        result.currentOwner = owner;
      }
      res.json(result);
    } catch (error) {
      logger.error('[ReferralVaultApi] /check-name failed:', error);
      res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Error checking name availability.' } });
    }
  });

  /**
   * POST /register
   * Returns calldata for CreditVault.register(name). User's wallet submits the tx.
   */
  router.post('/register', async (req, res) => {
    const { name, userWalletAddress, chainId: bodyChainId } = req.body;
    const chainId = String(bodyChainId || '1');

    if (!name || name.length < 4 || !/^[a-zA-Z0-9_-]+$/.test(name)) {
      return res.status(400).json({ error: { code: 'INVALID_NAME', message: 'Name must be at least 4 characters and contain only letters, numbers, underscores, or dashes.' } });
    }
    if (!userWalletAddress || !ethers.isAddress(userWalletAddress)) {
      return res.status(400).json({ error: { code: 'INVALID_ADDRESS', message: 'Valid userWalletAddress is required.' } });
    }

    try {
      const { ethereumService } = getChainServices(chainId);
      const vaultAddress = getCreditVaultAddress(chainId);
      const referralKey = ethers.keccak256(ethers.toUtf8Bytes(name));

      // Check on-chain availability
      const existingOwner = await ethereumService.read(vaultAddress, creditVaultAbi, 'referralOwner', referralKey);
      if (existingOwner !== ethers.ZeroAddress) {
        return res.status(409).json({ error: { code: 'NAME_TAKEN', message: 'This referral name is already registered on-chain.' } });
      }

      // Build calldata
      const iface = new ethers.Interface(creditVaultAbi);
      const data = iface.encodeFunctionData('register', [name]);

      res.json({
        registerTx: {
          from: userWalletAddress,
          to: vaultAddress,
          data,
        },
        referralKey,
        name,
      });
    } catch (error) {
      logger.error('[ReferralVaultApi] /register failed:', error);
      res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Error preparing registration transaction.' } });
    }
  });

  /**
   * GET /my-vaults
   * Returns all referral vaults owned by the authenticated user.
   */
  router.get('/my-vaults', async (req, res) => {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'User not authenticated.' } });
    }

    try {
      const { creditService } = getChainServices('1');
      const vaults = await creditService.creditLedgerDb.findReferralVaultsByMasterAccount(userId);
      res.json({ vaults: vaults || [] });
    } catch (error) {
      logger.error('[ReferralVaultApi] /my-vaults failed:', error);
      res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch vaults.' } });
    }
  });

  /**
   * GET /:name/dashboard
   * Returns referral earnings dashboard for a named referral vault.
   */
  router.get('/:name/dashboard', async (req, res) => {
    const { name } = req.params;

    if (!name || name.length < 4 || !/^[a-zA-Z0-9_-]+$/.test(name)) {
      return res.status(400).json({ error: { code: 'INVALID_NAME', message: 'Invalid referral name.' } });
    }

    try {
      const { creditService } = getChainServices('1');
      const referralKey = ethers.keccak256(ethers.toUtf8Bytes(name));

      // Find the vault record
      const vault = await creditService.creditLedgerDb.findReferralVaultByKey(referralKey);
      if (!vault) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Referral vault not found.' } });
      }

      // Aggregate payment stats from ledger
      const tokenStats = await creditService.creditLedgerDb.getReferralDashboardStats(referralKey);

      // Enrich with price data for USD values
      const enrichedStats = await Promise.all(
        tokenStats.map(async (stat) => {
          let price = 0;
          let symbol = stat.tokenAddress === '0x0000000000000000000000000000000000000000' ? 'ETH' : 'UNKNOWN';
          try {
            if (priceFeedService) {
              price = await priceFeedService.getPriceInUsd(stat.tokenAddress);
              if (symbol === 'UNKNOWN') {
                const meta = await priceFeedService.getMetadata(stat.tokenAddress);
                symbol = meta?.symbol || 'UNKNOWN';
              }
            }
          } catch (e) {
            logger.warn(`[ReferralVaultApi] Price/metadata fetch failed for ${stat.tokenAddress}:`, e.message);
          }

          return {
            ...stat,
            symbol,
            currentPriceUsd: price,
          };
        })
      );

      res.json({
        name: vault.vault_name,
        referralKey,
        ownerAddress: vault.owner_address,
        totals: {
          referralVolumeWei: vault.total_referral_volume_wei || '0',
          referralRewardsWei: vault.total_referral_rewards_wei || '0',
        },
        tokens: enrichedStats,
      });
    } catch (error) {
      logger.error(`[ReferralVaultApi] /${name}/dashboard failed:`, error);
      res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch dashboard data.' } });
    }
  });

  return router;
}

module.exports = { createReferralVaultApi };
