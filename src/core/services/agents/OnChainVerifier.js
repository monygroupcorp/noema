// src/core/services/agents/OnChainVerifier.js
//
// Resolves the current on-chain owner of an agent, selecting a resolution
// strategy based on which fields are present in the agent doc.
//
// ── Strategy selection ───────────────────────────────────────────────────────
//
//  Mode A — plain NFT (no adapter):
//    agentCollection.ownerOf(agentTokenId) → owner
//    Triggered when: agentAdapter is absent
//
//  Mode B — adapter, single-step (adapter returns owner directly):
//    agentAdapter.<adapterOwnerMethod>(agentTokenId) → owner
//    Triggered when: agentAdapter is present, agentCollection is absent
//    Method name: agentDoc.agentAdapterMethod || env AGENT_ADAPTER_OWNER_METHOD
//
//  Mode C — adapter, two-step (adapter resolves to NFT, then collection):
//    agentAdapter.camelTokenIdOf(agentTokenId) → nftTokenId
//    agentCollection.ownerOf(nftTokenId) → owner
//    Triggered when: both agentAdapter and agentCollection are present
//
// All modes fall back to agentDoc.agentOwnerAddress if the RPC is unavailable.
//
// ── Cache strategy ───────────────────────────────────────────────────────────
//  Registration→NFT mapping (Mode C step 1): 1-hour TTL — stable after mint
//  NFT ownership (all modes step 2):          5-min TTL — can change via transfer

const { JsonRpcProvider, Contract, getAddress } = require('ethers');
const { getRpcUrl } = require('../alchemy/foundationConfig');

const OWNER_OF_ABI     = ['function ownerOf(uint256 tokenId) view returns (address)'];
const CAMEL_ID_ABI     = ['function camelTokenIdOf(uint256 registrationId) view returns (uint256)'];
const IS_VALID_SIG_ABI = ['function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)'];

const EIP1271_MAGIC  = '0x1626ba7e';
const REG_MAP_TTL_MS = 60 * 60 * 1000;
const OWNER_TTL_MS   =  5 * 60 * 1000;

class OnChainVerifier {
    /**
     * @param {{ logger?, _makeProvider?, _makeContract? }} opts
     *   _makeProvider / _makeContract — injected in tests to avoid patching readonly ethers exports.
     *   Production code leaves these undefined; defaults use real ethers classes.
     */
    constructor({ logger, _makeProvider, _makeContract } = {}) {
        this.logger        = logger || console;
        // _makeProvider(chainId) → provider
        // Default resolves the RPC URL from chainId and throws if not configured.
        // Injected version in tests returns a mock provider, bypassing getRpcUrl entirely.
        this._makeProvider = _makeProvider || ((chainId) => {
            const url = getRpcUrl(chainId);
            return new JsonRpcProvider(url);
        });
        this._makeContract = _makeContract || ((addr, abi, p) => new Contract(addr, abi, p));
        this._regMap = new Map(); // chainId:adapter:regId   → { nftTokenId, expiresAt }
        this._owners = new Map(); // chainId:contract:tokenId → { address, expiresAt }
    }

    /**
     * Returns the current on-chain owner of the agent.
     * Selects resolution mode based on agentDoc fields (see module header).
     *
     * @param {object} agentDoc
     * @returns {Promise<string|null>} Checksummed owner address, or null on failure
     */
    async getOwner(agentDoc) {
        const { agentChainId, agentAdapter, agentCollection, agentOwnerAddress } = agentDoc;

        let provider;
        try {
            provider = this._makeProvider(agentChainId);
        } catch {
            this.logger.warn(`[OnChainVerifier] No RPC for chainId ${agentChainId} — using stored owner`);
            return agentOwnerAddress || null;
        }

        try {
            if (!agentAdapter)    return await this._modeA(provider, agentDoc);
            if (!agentCollection) return await this._modeB(provider, agentDoc);
            return await this._modeC(provider, agentDoc);
        } catch (err) {
            this.logger.warn(`[OnChainVerifier] Resolution failed: ${err.message} — using stored owner`);
            return agentOwnerAddress || null;
        }
    }

    /**
     * EIP-1271: calls isValidSignature on the current on-chain owner.
     * For smart-contract wallet holders.
     */
    async isValidSignature(agentDoc, hash, signature) {
        const ownerAddress = await this.getOwner(agentDoc);
        if (!ownerAddress) return false;

        let provider;
        try { provider = this._makeProvider(agentDoc.agentChainId); } catch { return false; }

        try {
            const contract = this._makeContract(ownerAddress, IS_VALID_SIG_ABI, provider);
            const result   = await contract.isValidSignature(hash, signature);
            return result.toLowerCase() === EIP1271_MAGIC;
        } catch {
            return false;
        }
    }

    // ---------------------------------------------------------------------------
    // Resolution modes
    // ---------------------------------------------------------------------------

    /** Mode A: no adapter — plain ownerOf on the collection */
    async _modeA(provider, agentDoc) {
        const { agentChainId, agentCollection, agentTokenId } = agentDoc;
        if (!agentCollection || agentTokenId == null) {
            throw new Error('Mode A requires agentCollection and agentTokenId');
        }
        return this._ownerOf(provider, agentChainId, agentCollection, agentTokenId);
    }

    /** Mode B: adapter returns owner directly via a single call */
    async _modeB(provider, agentDoc) {
        const { agentChainId, agentAdapter, agentTokenId } = agentDoc;
        if (!agentAdapter || agentTokenId == null) {
            throw new Error('Mode B requires agentAdapter and agentTokenId');
        }
        const methodName = agentDoc.agentAdapterMethod
            || process.env.AGENT_ADAPTER_OWNER_METHOD
            || 'ownerOf';
        const abi      = [`function ${methodName}(uint256 id) view returns (address)`];
        const contract = this._makeContract(agentAdapter, abi, provider);
        const raw      = await contract[methodName](BigInt(agentTokenId));
        return getAddress(raw);
    }

    /** Mode C: adapter maps registration → NFT token ID, then collection.ownerOf */
    async _modeC(provider, agentDoc) {
        const { agentChainId, agentAdapter, agentCollection, agentTokenId } = agentDoc;
        if (!agentAdapter || !agentCollection || agentTokenId == null) {
            throw new Error('Mode C requires agentAdapter, agentCollection, and agentTokenId');
        }
        const nftTokenId = await this._resolveNftTokenId(provider, agentChainId, agentAdapter, agentTokenId);
        return this._ownerOf(provider, agentChainId, agentCollection, nftTokenId);
    }

    // ---------------------------------------------------------------------------
    // Cached primitives
    // ---------------------------------------------------------------------------

    async _resolveNftTokenId(provider, chainId, adapterAddress, registrationId) {
        const key    = `${chainId}:${adapterAddress}:${registrationId}`;
        const cached = this._regMap.get(key);
        if (cached && Date.now() < cached.expiresAt) return cached.nftTokenId;

        const contract   = this._makeContract(adapterAddress, CAMEL_ID_ABI, provider);
        const raw        = await contract.camelTokenIdOf(BigInt(registrationId));
        const nftTokenId = raw.toString();

        this._regMap.set(key, { nftTokenId, expiresAt: Date.now() + REG_MAP_TTL_MS });
        return nftTokenId;
    }

    async _ownerOf(provider, chainId, contractAddress, tokenId) {
        const key    = `${chainId}:${contractAddress}:${tokenId}`;
        const cached = this._owners.get(key);
        if (cached && Date.now() < cached.expiresAt) return cached.address;

        const contract = this._makeContract(contractAddress, OWNER_OF_ABI, provider);
        const raw      = await contract.ownerOf(BigInt(tokenId));
        const address  = getAddress(raw);

        this._owners.set(key, { address, expiresAt: Date.now() + OWNER_TTL_MS });
        return address;
    }
}

module.exports = { OnChainVerifier };
