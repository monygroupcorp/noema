/**
 * @file Manages database operations for the userCore collection in the Noema database.
 */

const { BaseDB, ObjectId } = require('./BaseDB');
const { PRIORITY, getCachedClient } = require('./utils/queue');

const COLLECTION_NAME = 'userCore';

/** Valid account types for the accountType field. */
const ACCOUNT_TYPES = Object.freeze(['user', 'group', 'agent', 'treasury']);

class UserCoreDB extends BaseDB {
  constructor(logger) {
    super(COLLECTION_NAME);
    if (!logger) {
      // Fallback to console logging if no logger is provided, with a warning.
      // This maintains basic functionality but signals a configuration issue.
      console.warn('[UserCoreDB] Logger instance was not provided during construction. Falling back to console.');
      this.logger = console; 
    } else {
      this.logger = logger;
    }
  }

  /**
   * Finds a userCore document by its masterAccountId.
   * @param {ObjectId | string} masterAccountId - The masterAccountId of the user.
   * @returns {Promise<Object|null>} The userCore document or null if not found.
   */
  async findUserCoreById(masterAccountId) {
    const id = typeof masterAccountId === 'string' ? new ObjectId(masterAccountId) : masterAccountId;
    return this.findOne({ _id: id }, PRIORITY.HIGH);
  }

  /**
   * Finds a userCore document by a platform identifier.
   * @param {string} platformName - E.g., 'telegram', 'discord'.
   * @param {string} platformId - The user's ID on that platform.
   * @returns {Promise<Object|null>} The userCore document or null if not found.
   */
  async findUserCoreByPlatformId(platformName, platformId) {
    const query = { [`platformIdentities.${platformName}`]: platformId };
    return this.findOne(query, PRIORITY.HIGH);
  }

  /**
   * Finds a userCore document by platform identifier, or creates one if not found.
   * @param {string} platformName - E.g., 'telegram', 'discord'.
   * @param {string} platformId - The user's ID on that platform.
   * @param {Object} [additionalData={}] - Additional data to include if creating a new user.
   * @returns {Promise<Object|null>} The userCore document.
   */
  async findOrCreateByPlatformId(platformName, platformId, additionalData = {}) {
    let userDoc = await this.findUserCoreByPlatformId(platformName, platformId);
    if (userDoc) {
      return { user: userDoc, isNew: false };
    }

    // User not found, create a new one
    const timestamp = new Date();
    const newUserDocumentData = {
      platformIdentities: {
        [platformName]: platformId,
      },
      wallets: [],
      apiKeys: [],
      awards: [],
      profile: {},
      status: 'active',
      userCreationTimestamp: timestamp,
      updatedAt: timestamp,
      lastLoginTimestamp: timestamp, // Set lastLogin on creation as well
      lastSeenPlatform: platformName, // Set lastSeenPlatform on creation
      ...additionalData, // Allow overriding defaults or adding more info
    };

    // Ensure platformIdentities from additionalData are merged, not overwritten, if any.
    if (additionalData.platformIdentities) {
      newUserDocumentData.platformIdentities = {
        ...newUserDocumentData.platformIdentities,
        ...additionalData.platformIdentities,
      };
    }

    try {
      userDoc = await this.createUserCore(newUserDocumentData);
      // createUserCore in the current implementation returns { _id: result.insertedId, ...newUserDocument }
      // which is what we want.
      if (!userDoc || !userDoc._id) { // Defensive check
        // Log error or throw, as createUserCore should ideally always return a user or throw
        this.logger.error(`[UserCoreDB] Failed to create user for ${platformName}:${platformId} but createUserCore did not throw or return valid user.`);
        // To maintain a consistent return type, though this state indicates a deeper issue.
        return { user: null, isNew: false }; 
      }
      return { user: userDoc, isNew: true };
    } catch (error) {
      this.logger.error(`[UserCoreDB] Error creating user for ${platformName}:${platformId}:`, error);
      // Depending on desired error handling, re-throw or return null
      throw error; // Or return null if preferred that callers handle it
    }
  }

  /**
   * Finds a userCore document by a wallet address.
   * @param {string} walletAddress - The wallet address.
   * @returns {Promise<Object|null>} The userCore document or null if not found.
   */
  async findUserCoreByWalletAddress(walletAddress) {
    // Ensure case-insensitivity if wallet addresses might be stored with varying cases
    // Or ensure they are always stored checksummed/lowercase.
    // For now, assuming direct match.
    return this.findOne({ 'wallets.address': walletAddress }, PRIORITY.HIGH);
  }

  /**
   * Creates a new userCore document.
   * @param {Object} userData - The initial data for the new user.
   * @returns {Promise<Object>} The created userCore document including its _id.
   */
  async createUserCore(userData) {
    const timestamp = new Date();
    const newUserDocument = {
      platformIdentities: {}, // Should be provided or explicitly set
      wallets: [],
      apiKeys: [],
      awards: [],
      profile: {},
      status: 'active',
      ...userData, // userData can override defaults
      userCreationTimestamp: userData.userCreationTimestamp || timestamp,
      updatedAt: timestamp,
    };
    // _id will be auto-generated by MongoDB and included in the result of insertOne
    const result = await this.insertOne(newUserDocument, false, PRIORITY.CRITICAL);
    // Fetch and return the newly created document to ensure it's the complete, correct version from the DB
    return this.findUserCoreById(result.insertedId);
  }

  /**
   * Updates an existing userCore document.
   * Automatically sets the updatedAt timestamp for the main document.
   * @param {ObjectId | string} masterAccountId - The masterAccountId of the user to update.
   * @param {Object} updateOperations - MongoDB update operators (e.g., { $set: { field: value } }).
   * @param {Object} [options={}] - MongoDB options for the updateOne operation (e.g., arrayFilters).
   * @returns {Promise<Object|null>} The updated userCore document or null if not found.
   */
  async updateUserCore(masterAccountId, updateOperations, options = {}) {
    const id = typeof masterAccountId === 'string' ? new ObjectId(masterAccountId) : masterAccountId;
    const updateDoc = {
      ...updateOperations,
      $set: {
        ...(updateOperations.$set || {}),
        updatedAt: new Date(),
      },
    };
    // BaseDB.updateOne returns the result of the operation, not the document.
    // To get the updated document, we'd typically findOneAndUpdate or findOne after update.
    // Modifying BaseDB.updateOne to return document or doing a subsequent find is an option.
    // For now, let's assume we need to fetch it if BaseDB.updateOne doesn't return it.
    const updateResult = await super.updateOne({ _id: id }, updateDoc, options, false, PRIORITY.HIGH);
    if (updateResult.matchedCount > 0) {
        return this.findUserCoreById(id); // Fetch the updated document
    }
    return null;
  }

  /**
   * Adds an award to a user's profile.
   * @param {ObjectId | string} masterAccountId
   * @param {Object} awardData - Object containing awardId, achievedAt, displayName, description.
   * @returns {Promise<Object|null>} The updated userCore document.
   */
  async addAward(masterAccountId, awardData) {
    const award = {
        achievedAt: new Date(),
        ...awardData
    }
    return this.updateUserCore(masterAccountId, { $push: { awards: award } });
  }

  /**
   * Updates specific fields in the user's profile object.
   * @param {ObjectId | string} masterAccountId
   * @param {Object} profileUpdates - Object with fields to update (e.g., { displayName: 'New Name' }).
   * @returns {Promise<Object|null>} The updated userCore document.
   */
  async updateProfile(masterAccountId, profileUpdates) {
    const $set = {};
    for (const key in profileUpdates) {
      if (profileUpdates.hasOwnProperty(key)) {
        $set[`profile.${key}`] = profileUpdates[key];
      }
    }
    if (Object.keys($set).length === 0) {
        return this.findUserCoreById(masterAccountId); // No changes, return current doc
    }
    return this.updateUserCore(masterAccountId, { $set });
  }

  /**
   * Updates the last login timestamp and platform for a user.
   * @param {ObjectId | string} masterAccountId
   * @param {string} platform - The platform the user logged in from.
   * @returns {Promise<Object|null>} The updated userCore document.
   */
  async updateLastLogin(masterAccountId, platform) {
    return this.updateUserCore(masterAccountId, {
      $set: {
        lastLoginTimestamp: new Date(),
        lastSeenPlatform: platform,
      },
    });
  }
  
  /**
   * Adds a platform identity to the user.
   * @param {ObjectId | string} masterAccountId
   * @param {string} platformName e.g., 'telegram', 'discord'
   * @param {string} platformId The user's ID on that platform.
   * @returns {Promise<Object|null>} Updated userCore document.
   */
  async addPlatformIdentity(masterAccountId, platformName, platformId) {
    const updateDoc = { $set: { [`platformIdentities.${platformName}`]: platformId } };
    return this.updateUserCore(masterAccountId, updateDoc);
  }

  /**
   * Adds a wallet to the user's wallets array.
   * @param {ObjectId | string} masterAccountId
   * @param {Object} walletData - { address: string, isPrimary?: boolean, verified?: boolean }
   * @returns {Promise<Object|null>} Updated userCore document.
   */
  async addWallet(masterAccountId, walletData) {
    if (!walletData || typeof walletData.address !== 'string') {
        throw new Error('walletData.address must be provided as a string');
    }

    // 1. Normalise the wallet address for uniqueness checks/storage
    const normalisedAddress = walletData.address.toLowerCase();
    // mutate original object so upstream callers see lowercase too (important for post-insert lookup)
    walletData.address = normalisedAddress;

    // 2. Check if the wallet already exists on ANOTHER user
    const existingUser = await this.findUserCoreByWalletAddress(normalisedAddress);
    if (existingUser && existingUser._id.toString() !== masterAccountId.toString()) {
        // Graceful conflict that upstream maps to 409
        throw new Error('Wallet address already exists');
    }

    // 3. Determine if this wallet should be primary (first wallet or no existing primary)
    let makePrimary = false;
    try {
        const currentUser = await this.findUserCoreById(masterAccountId);
        if (!currentUser || !currentUser.wallets || currentUser.wallets.length === 0) {
            // No wallets yet – make this one primary
            makePrimary = true;
        } else {
            // Check if none of the existing wallets are marked primary (legacy data)
            const hasPrimary = currentUser.wallets.some(w => w.isPrimary === true);
            if (!hasPrimary) makePrimary = true;
        }
    } catch (err) {
        // Non-fatal – default to non-primary, but log for visibility
        this.logger.warn('[UserCoreDB] addWallet – failed to determine existing wallets for primary logic:', err.message);
    }

    // 4. Prepare the wallet object (store the normalised address)
    const newWallet = {
        addedAt: new Date(),
        verified: false,
        isPrimary: makePrimary,
        ...walletData,
        address: normalisedAddress, // ensure stored lower-case
    };
    try {
        // 5. Use $addToSet to avoid duplicates within the SAME document
        return await this.updateUserCore(masterAccountId, { $addToSet: { wallets: newWallet } });
    } catch (error) {
        // 5. Handle race-condition duplicate key error from unique index
        if (error.code === 11000 || (error.message && error.message.includes('E11000'))) {
            throw new Error('Wallet address already exists');
        }
        throw error;
    }
  }

  /**
   * Updates a user's status.
   * @param {ObjectId | string} masterAccountId
   * @param {string} status - New status (e.g., 'active', 'suspended').
   * @returns {Promise<Object|null>} Updated userCore document.
   */
  async updateUserStatus(masterAccountId, status) {
    // Add validation for allowed status values if needed, based on schema enum
    return this.updateUserCore(masterAccountId, { $set: { status: status } });
  }

  /**
   * Finds a userCore document by an API key prefix.
   * Since multiple users could theoretically have keys with the same prefix (highly unlikely with good generation),
   * this method is designed to return the first one found. The application logic should handle the rest.
   * @param {string} keyPrefix - The prefix of the API key.
   * @returns {Promise<Object|null>} The userCore document or null if not found.
   */
  async findUserByApiKeyPrefix(keyPrefix) {
    if (!keyPrefix) {
      this.logger.warn('[UserCoreDB] findUserByApiKeyPrefix called with no prefix.');
      return null;
    }
    // This query finds a document where the apiKeys array contains at least one element
    // that has a keyPrefix matching the provided one.
    const query = { 'apiKeys.keyPrefix': keyPrefix };
    return this.findOne(query, PRIORITY.HIGH);
  }

  /**
   * Deletes a wallet from a user's wallets array by its address.
   * @param {ObjectId | string} masterAccountId - The masterAccountId of the user.
   * @param {string} walletAddress - The address of the wallet to delete.
   * @returns {Promise<Object|null>} Updated userCore document, or null if user not found or wallet not found/not deleted.
   */
  async deleteWallet(masterAccountId, walletAddress) {
    if (!walletAddress || typeof walletAddress !== 'string') {
        this.logger.error('[UserCoreDB] deleteWallet: walletAddress is required and must be a non-empty string.');
        return { success: false, message: 'Wallet address is required.' };
    }

    const updateOperation = {
      $pull: {
        wallets: { address: walletAddress }
      }
    };
    // updateUserCore will set the main document's updatedAt timestamp.
    // It returns the updated document if matchedCount > 0.
    // If the wallet address didn't exist, matchedCount would still be >0 if the user exists,
    // but the wallets array wouldn't change. The caller (API layer) might need to verify
    // that the wallet is actually gone or check modifiedCount if that was available.
    return this.updateUserCore(masterAccountId, updateOperation);
  }

  /**
   * Adds an API key to a user's apiKeys array.
   * @param {ObjectId | string} masterAccountId - The masterAccountId of the user.
   * @param {Object} apiKeyDocument - The API key object to add (should include keyPrefix, keyHash, name, permissions, createdAt, updatedAt, lastUsedAt, status).
   * @returns {Promise<Object|null>} Updated userCore document, or null if user not found.
   */
  async addApiKey(masterAccountId, apiKeyDocument) {
    if (!apiKeyDocument || !apiKeyDocument.keyHash) {
        this.logger.error('[UserCoreDB] addApiKey: apiKeyDocument is invalid or missing keyHash.');
        return { success: false, message: 'API key document with keyHash is required.' };
    }
    const timestamp = new Date();
    const updateOperation = {
      $push: {
        apiKeys: apiKeyDocument
      }
    };
    // updateUserCore will set the main document's updatedAt timestamp.
    return this.updateUserCore(masterAccountId, updateOperation);
  }

  /**
   * Updates specific fields of an API key for a user.
   * @param {ObjectId | string} masterAccountId - The masterAccountId of the user.
   * @param {string} keyPrefix - The prefix of the API key to update.
   * @param {Object} updatesForSubDoc - An object containing the fields to update within the matching apiKey element (e.g., { name: 'new name', status: 'inactive' }). MUST include `updatedAt` for the sub-document.
   * @returns {Promise<Object|null>} Updated userCore document, or null if user or key not found/not updated.
   */
  async updateApiKey(masterAccountId, keyPrefix, updatesForSubDoc) {
    if (!masterAccountId) {
      throw new Error('masterAccountId is required for updating API key');
    }
    if (!keyPrefix) {
      throw new Error('keyPrefix is required for updating API key');
    }
    if (!updatesForSubDoc || Object.keys(updatesForSubDoc).length === 0 || !updatesForSubDoc.updatedAt) {
      // Ensure updatedAt is included for the sub-document update
      throw new Error('updatesForSubDoc object is required, cannot be empty, and must include updatedAt field for updating API key');
    }

    // Construct the $set operations for the sub-document using the positional operator
    const setOperations = {};
    for (const key in updatesForSubDoc) {
        setOperations[`apiKeys.$[elem].${key}`] = updatesForSubDoc[key];
    }

    // Prepare the options object with arrayFilters for updateUserCore
    const options = { 
      arrayFilters: [{ 'elem.keyPrefix': keyPrefix }]
    }; 

    this.logger.debug(`[UserCoreDB] updateApiKey: Calling updateUserCore for masterAccountId=${masterAccountId}, keyPrefix=${keyPrefix}, updates=${JSON.stringify(setOperations)}`);
    
    // Call updateUserCore, which handles the update and fetches the updated document
    // updateUserCore expects the full update operation object ({ $set: ... }) and options
    const updatedUserDoc = await this.updateUserCore(masterAccountId, { $set: setOperations }, options);

    if (updatedUserDoc) {
      // Check if the specific key was actually modified if needed (e.g., by comparing updatedAt)
      // For now, assume success if updateUserCore returned a document.
      this.logger.debug(`[UserCoreDB] updateApiKey: Successfully updated API key subdocument for masterAccountId ${masterAccountId}, keyPrefix ${keyPrefix}.`);
      return updatedUserDoc;
    } else {
      this.logger.warn(`[UserCoreDB] updateApiKey: Failed to update API key (user or key not found) for masterAccountId ${masterAccountId}, keyPrefix ${keyPrefix}.`);
      return null; // updateUserCore returns null if match count is 0
    }
  }

  async deleteApiKey(masterAccountId, keyPrefix) {
    const id = typeof masterAccountId === 'string' ? new ObjectId(masterAccountId) : masterAccountId;
    // This operation pulls the API key from the array if it matches the keyPrefix.
    // It ensures the main document updatedAt is also set.
    const updateResult = await this.updateUserCore(id, {
      $pull: { apiKeys: { keyPrefix: keyPrefix } },
    });
    return updateResult;
  }

  /**
   * Updates the lastUsedAt timestamp for a specific API key.
   * This is a fire-and-forget operation that uses super.updateOne directly
   * to properly support arrayFilters for targeting specific array elements.
   * @param {ObjectId | string} masterAccountId - The masterAccountId of the user.
   * @param {string} keyPrefix - The prefix of the API key to update.
   * @returns {Promise<Object>} The MongoDB update result.
   */
  async updateApiKeyLastUsed(masterAccountId, keyPrefix) {
    const id = typeof masterAccountId === 'string' ? new ObjectId(masterAccountId) : masterAccountId;
    const now = new Date();

    // Use arrayFilters to target the specific API key in the array
    // Call super.updateOne directly to ensure arrayFilters are passed correctly
    const filter = { _id: id };
    const update = {
      $set: {
        'apiKeys.$[elem].lastUsedAt': now,
        updatedAt: now, // Also update main document timestamp
      }
    };
    const options = {
      arrayFilters: [{ 'elem.keyPrefix': keyPrefix, 'elem.status': 'active' }],
    };

    try {
      const result = await super.updateOne(filter, update, options, false, PRIORITY.HIGH);
      if (result.matchedCount === 0) {
        this.logger.warn(`[UserCoreDB] updateApiKeyLastUsed: User ${id} not found or no matching active API key with prefix ${keyPrefix}.`);
      }
      return result;
    } catch (error) {
      this.logger.error(`[UserCoreDB] updateApiKeyLastUsed error for user ${id}, keyPrefix ${keyPrefix}:`, error.message);
      throw error;
    }
  }

  /**
   * Updates the 'lastTouch' timestamp for a user.
   * @param {ObjectId | string} masterAccountId - The masterAccountId of the user.
   * @returns {Promise<Object|null>} The updated userCore document or null if not found.
   */
  async updateLastTouch(masterAccountId) {
    return this.updateUserCore(masterAccountId, {
      $set: {
        lastTouch: new Date(),
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Phase 1 — Typed account support (agent / treasury / group)
  // ---------------------------------------------------------------------------

  /**
   * Ensures the two sparse indexes required for typed accounts exist.
   * Called at startup via the standard ensureIndexes() pattern.
   */
  async ensureIndexes() {
    try {
      const client = await getCachedClient();
      const collection = client.db(this.dbName).collection(this.collectionName);
      await collection.createIndexes([
        {
          key: { accountType: 1, agentId: 1 },
          name: 'idx_account_type_agent_id',
          unique: true,
          background: true,
          partialFilterExpression: { agentId: { $exists: true } },
        },
        {
          key: { accountType: 1, masterTreasuryId: 1 },
          name: 'idx_account_type_treasury',
          sparse: true,
          background: true,
        },
      ]);
      this.logger.debug('[UserCoreDB] Typed account indexes ensured.');
    } catch (err) {
      this.logger.error('[UserCoreDB] Failed to ensure indexes:', err);
    }
  }

  /**
   * Creates a typed account (agent, treasury, group).
   * Wraps createUserCore with accountType validation.
   *
   * @param {'agent'|'treasury'|'group'} accountType
   * @param {object} data - Additional fields merged into the new document.
   * @returns {Promise<object>}
   */
  async createTypedAccount(accountType, data = {}) {
    if (!ACCOUNT_TYPES.includes(accountType)) {
      throw new Error(`Invalid accountType: ${accountType}. Must be one of: ${ACCOUNT_TYPES.join(', ')}`);
    }
    return this.createUserCore({ ...data, accountType });
  }

  /**
   * Finds all accounts of a given type.
   * @param {'user'|'group'|'agent'|'treasury'} accountType
   * @param {object} [additionalFilter={}]
   * @returns {Promise<object[]>}
   */
  async findByAccountType(accountType, additionalFilter = {}) {
    const query = { accountType, ...additionalFilter };
    const client = await getCachedClient();
    const collection = client.db(this.dbName).collection(this.collectionName);
    return collection.find(query).toArray();
  }

  /**
   * Finds an agent userCore by its ERC-8004 agentId string.
   * @param {string} agentId
   * @returns {Promise<object|null>}
   */
  async findByAgentId(agentId) {
    return this.findOne({ accountType: 'agent', agentId }, PRIORITY.HIGH);
  }

  /**
   * Sets or clears the masterTreasuryId on any typed account.
   * @param {ObjectId|string} masterAccountId
   * @param {ObjectId|string|null} treasuryId - null to unlink
   */
  async setMasterTreasuryId(masterAccountId, treasuryId) {
    const update = treasuryId
      ? { $set: { masterTreasuryId: typeof treasuryId === 'string' ? new ObjectId(treasuryId) : treasuryId } }
      : { $unset: { masterTreasuryId: '' } };
    return this.updateUserCore(masterAccountId, update);
  }

  /**
   * Updates the payoutPolicy sub-document on an agent account.
   * @param {ObjectId|string} masterAccountId
   * @param {{ mode: string, withdrawAddress?: string, split?: object }} policy
   */
  async updatePayoutPolicy(masterAccountId, policy) {
    return this.updateUserCore(masterAccountId, { $set: { payoutPolicy: policy } });
  }

  /**
   * Sets on-chain identity fields for an agent account.
   * @param {ObjectId|string} masterAccountId
   * @param {{ agentId, agentChainId, agentAdapter, agentRegistry, agentTokenId, agentOwnerAddress, agentCollection }} fields
   */
  async setAgentOnChainFields(masterAccountId, fields) {
    const allowed = ['agentId', 'agentChainId', 'agentAdapter', 'agentRegistry', 'agentTokenId', 'agentOwnerAddress', 'agentCollection'];
    const $set = {};
    for (const key of allowed) {
      if (fields[key] !== undefined) $set[key] = fields[key];
    }
    if (Object.keys($set).length === 0) return this.findUserCoreById(masterAccountId);
    return this.updateUserCore(masterAccountId, { $set });
  }

  /**
   * Updates or creates the treasuryFaucetPolicy on a treasury account.
   * @param {ObjectId|string} masterAccountId
   * @param {{ starterGrantPoints: number, monthlyMaxPoints: number, subsidyMode: string, refillCadence: string }} policy
   */
  async updateTreasuryFaucetPolicy(masterAccountId, policy) {
    return this.updateUserCore(masterAccountId, { $set: { treasuryFaucetPolicy: policy } });
  }

  // ---------------------------------------------------------------------------
  // Phase 1.4 — Group memberSpendCaps
  // ---------------------------------------------------------------------------

  /**
   * Upserts a per-member spend cap entry on a group document.
   * Uses arrayFilters to update in-place if the member already has an entry,
   * or $push if not.
   *
   * @param {ObjectId|string} groupId - The group's userCore _id
   * @param {ObjectId|string} memberAccountId
   * @param {number} monthlyCapPoints
   * @returns {Promise<object|null>}
   */
  async upsertMemberSpendCap(groupId, memberAccountId, monthlyCapPoints) {
    const gid = typeof groupId === 'string' ? new ObjectId(groupId) : groupId;
    const mid = typeof memberAccountId === 'string' ? new ObjectId(memberAccountId) : memberAccountId;

    // Try update-in-place first
    const client = await getCachedClient();
    const collection = client.db(this.dbName).collection(this.collectionName);
    const result = await collection.updateOne(
      { _id: gid, 'memberSpendCaps.masterAccountId': mid },
      { $set: { 'memberSpendCaps.$[cap].monthlyCapPoints': monthlyCapPoints, updatedAt: new Date() } },
      { arrayFilters: [{ 'cap.masterAccountId': mid }] }
    );

    if (result.matchedCount > 0) {
      return this.findUserCoreById(gid);
    }

    // Member not in array yet — push a new entry
    return this.updateUserCore(gid, {
      $push: {
        memberSpendCaps: {
          masterAccountId: mid,
          monthlyCapPoints,
          currentMonthPoints: 0,
          resetAt: this._nextMonthResetDate(),
        },
      },
    });
  }

  /**
   * Returns the current spend usage for a member within a group's cap.
   * Returns null if the member has no cap configured (uncapped).
   *
   * @param {object} groupDoc - Full group userCore document
   * @param {ObjectId|string} memberAccountId
   * @returns {{ monthlyCapPoints: number, currentMonthPoints: number, resetAt: Date, isExpired: boolean } | null}
   */
  getMemberSpendCapStatus(groupDoc, memberAccountId) {
    const mid = memberAccountId.toString();
    const caps = groupDoc.memberSpendCaps || [];
    const entry = caps.find(c => c.masterAccountId?.toString() === mid);
    if (!entry) return null;
    const isExpired = entry.resetAt && new Date() > new Date(entry.resetAt);
    return { ...entry, isExpired };
  }

  /**
   * Increments currentMonthPoints for a member's spend cap entry.
   * Resets the counter if resetAt has passed.
   *
   * @param {ObjectId|string} groupId
   * @param {ObjectId|string} memberAccountId
   * @param {number} points
   */
  async recordMemberSpend(groupId, memberAccountId, points) {
    const gid = typeof groupId === 'string' ? new ObjectId(groupId) : groupId;
    const mid = typeof memberAccountId === 'string' ? new ObjectId(memberAccountId) : memberAccountId;
    const now = new Date();

    const client = await getCachedClient();
    const collection = client.db(this.dbName).collection(this.collectionName);

    // If the reset window has expired, reset counter first then add new spend
    await collection.updateOne(
      { _id: gid, 'memberSpendCaps.masterAccountId': mid, 'memberSpendCaps.resetAt': { $lt: now } },
      {
        $set: {
          'memberSpendCaps.$[cap].currentMonthPoints': points,
          'memberSpendCaps.$[cap].resetAt': this._nextMonthResetDate(),
          updatedAt: now,
        },
      },
      { arrayFilters: [{ 'cap.masterAccountId': mid }] }
    );

    // Unconditional increment path (no-op on matched reset docs since counter was already set)
    await collection.updateOne(
      { _id: gid, 'memberSpendCaps.masterAccountId': mid, 'memberSpendCaps.resetAt': { $gte: now } },
      {
        $inc: { 'memberSpendCaps.$[cap].currentMonthPoints': points },
        $set: { updatedAt: now },
      },
      { arrayFilters: [{ 'cap.masterAccountId': mid }] }
    );
  }

  /** @private Returns the first day of next month at midnight UTC. */
  _nextMonthResetDate() {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  }

}

module.exports = UserCoreDB; // Export the class, not an instance 