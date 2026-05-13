const { JsonRpcProvider, Contract } = require('ethers');

// Cypher DEX (Algebra Protocol) contracts on mainnet
const ALGEBRA_QUOTER_ADDRESS = '0x02f22D58d161d1C291ABfe88764d84120f20F723';
const ALGEBRA_PLUGIN_DEPLOYER = '0xB9783D9Bd7022b1fCa458518dC0e10646720AcF0';

const CAMEL_ADDRESS = '0x000caba1002917b27300d7b67be2d1c51b93bf00'; // normalised
const WETH_ADDRESS  = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'; // normalised

const QUOTER_ABI = [
  'function quoteExactInputSingle(address tokenIn, address tokenOut, address deployer, uint256 amountIn, uint160 limitSqrtPrice) external returns (uint256 amountOut, uint16 fee)',
];

const CACHE_TTL_MS = 30_000;
const ONE_CAMEL = BigInt('1000000000000000000'); // 1e18 — CAMEL has 18 decimals

class CypherDexService {
  constructor(logger) {
    this.logger = logger || console;
    this._cache = { price: null, ts: 0 };
    this._quoter = null;

    let rpcUrl = process.env.ETHEREUM_MAINNET_RPC_URL;
    if (!rpcUrl && process.env.ALCHEMY_API_KEY) {
      rpcUrl = `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;
    }

    if (!rpcUrl) {
      this.logger.warn('[CypherDexService] No mainnet RPC URL — CAMEL quoting disabled.');
      return;
    }

    try {
      const provider = new JsonRpcProvider(rpcUrl);
      this._quoter = new Contract(ALGEBRA_QUOTER_ADDRESS, QUOTER_ABI, provider);
      this.logger.debug('[CypherDexService] Initialized with Algebra QuoterV2 at', ALGEBRA_QUOTER_ADDRESS);
    } catch (err) {
      this.logger.error('[CypherDexService] Failed to create quoter contract:', err.message);
    }
  }

  /**
   * Returns the USD price of 1 CAMEL by quoting 1 CAMEL → WETH on Cypher DEX,
   * then multiplying by the provided ETH price.
   *
   * @param {number} ethPriceUsd - Current ETH/USD price (from priceFeedService)
   * @returns {Promise<number>} CAMEL price in USD, or 0 on failure
   */
  async getCamelPriceInUsd(ethPriceUsd) {
    if (!this._quoter) return 0;

    const now = Date.now();
    if (this._cache.price !== null && now - this._cache.ts < CACHE_TTL_MS) {
      return this._cache.price * ethPriceUsd;
    }

    try {
      // quoteExactInputSingle: how much WETH do we get for 1 CAMEL?
      const result = await this._quoter.quoteExactInputSingle.staticCall(
        CAMEL_ADDRESS,
        WETH_ADDRESS,
        ALGEBRA_PLUGIN_DEPLOYER,
        ONE_CAMEL,
        0n // limitSqrtPrice = 0 (no price cap)
      );

      // result[0] = amountOut (WETH in wei), result[1] = fee
      const wethPerCamel = Number(result[0]) / 1e18;
      this._cache = { price: wethPerCamel, ts: now };

      const priceUsd = wethPerCamel * ethPriceUsd;
      this.logger.info(
        `[CypherDexService] CAMEL: ${wethPerCamel.toFixed(10)} WETH × $${ethPriceUsd} = $${priceUsd.toFixed(8)}`
      );
      return priceUsd;
    } catch (err) {
      this.logger.error('[CypherDexService] quoteExactInputSingle failed:', err.message);
      // Return stale cache multiplied by current ETH price if available
      if (this._cache.price !== null) {
        return this._cache.price * ethPriceUsd;
      }
      return 0;
    }
  }

  static isCamelAddress(address) {
    return address && address.toLowerCase() === CAMEL_ADDRESS;
  }
}

module.exports = CypherDexService;
