// src/core/services/agents/WorkspaceFactory.js
const { IpfsService } = require('../ipfs/IpfsService');
//
// Provisions and keeps agent starter workspaces in sync with the admin template.
//
// Revision model (git-like):
//   template.revision          — incremented each time admin publishes a new version
//   agentWs.origin.templateRevision — the revision the agent was last synced to
//   toolWindow.templateWindowId    — links each window back to its template ancestor
//
// Merge rules (CSS cascade, no conflicts):
//   template controls: toolId, step structure, base spell definition
//   agent controls:    position, agentOverrides, their cloned spell document
//   agent-added windows (templateWindowId: null) are always preserved untouched

class WorkspaceFactory {
  /**
   * @param {{ workspacesDb, spellsDb, userCoreDb, storageService?, logger? }} deps
   */
  constructor({ workspacesDb, spellsDb, userCoreDb, storageService, ipfsService, logger } = {}) {
    this.workspacesDb = workspacesDb;
    this.spellsDb = spellsDb;
    this.userCoreDb = userCoreDb;
    this.storageService = storageService || null;
    this.logger = logger || console;
    this.ipfsService = ipfsService || new IpfsService(this.logger);
  }

  // ---------------------------------------------------------------------------
  // Provision (initial clone)
  // ---------------------------------------------------------------------------

  /**
   * Provisions the agent's starter workspace from the admin template.
   *
   * @param {{ agentDoc: object, tokenUri?: string }} params
   * @returns {Promise<{ slug: string, workspaceId: ObjectId }>}
   */
  async provisionAgentWorkspace({ agentDoc, tokenUri }) {
    const template = await this._loadTemplate();
    this.logger.info(`[WorkspaceFactory] Provisioning from template ${template.slug} r${template.revision ?? 1}`);

    const { placeholders, portMap } = await this._buildPlaceholderMap(tokenUri, agentDoc);
    const clonedSnapshot = this._substituteSnapshot(template.snapshot, placeholders);
    const factoryBindings = this._resolveFactoryBindings(clonedSnapshot, portMap);
    const { snapshot: patchedSnapshot } = await this._cloneSpells(clonedSnapshot, agentDoc, { tagTemplateIds: true, factoryBindings });

    const displayName = placeholders['$NFT_NAME'] || agentDoc.profile?.name || agentDoc.agentId || 'Agent Workspace';

    const { _id: workspaceId, slug } = await this.workspacesDb.createWorkspace({
      snapshot: patchedSnapshot,
      name: displayName,
      ownerId: agentDoc._id,
      origin: {
        slug: template.slug,
        ownerId: template.ownerId || null,
        walletAddress: template.walletAddress || null,
        templateRevision: template.revision ?? 1,
      },
      visibility: 'private',
    });

    await this.workspacesDb.updateOne(
      { _id: workspaceId },
      { $set: { isAgentStarter: true, updatedAt: new Date() } }
    ).catch(err => this.logger.warn(`[WorkspaceFactory] isAgentStarter tag failed: ${err.message}`));

    await this.userCoreDb.updateOne(
      { _id: agentDoc._id },
      { $set: { starterWorkspaceSlug: slug, updatedAt: new Date() } }
    ).catch(err => this.logger.warn(`[WorkspaceFactory] starterWorkspaceSlug record failed: ${err.message}`));

    this.logger.info(`[WorkspaceFactory] Agent ${agentDoc.agentId} → workspace ${slug}`);
    return { slug, workspaceId };
  }

  // ---------------------------------------------------------------------------
  // Sync status
  // ---------------------------------------------------------------------------

  /**
   * Returns how far behind the agent's workspace is from the current template.
   *
   * @param {string} agentWorkspaceSlug
   * @returns {Promise<{ templateRevision: number, agentRevision: number, behindBy: number, upToDate: boolean }>}
   */
  async getSyncStatus(agentWorkspaceSlug) {
    const [template, agentWs] = await Promise.all([
      this._loadTemplate(),
      this.workspacesDb.findBySlug(agentWorkspaceSlug),
    ]);

    if (!agentWs) throw Object.assign(new Error(`Workspace not found: ${agentWorkspaceSlug}`), { code: 'NOT_FOUND' });

    const templateRevision = template.revision ?? 1;
    const agentRevision = agentWs.origin?.templateRevision ?? 0;

    return {
      templateRevision,
      agentRevision,
      behindBy: Math.max(0, templateRevision - agentRevision),
      upToDate: agentRevision >= templateRevision,
    };
  }

  // ---------------------------------------------------------------------------
  // Merge (pull template updates into an existing agent workspace)
  // ---------------------------------------------------------------------------

  /**
   * Merges the latest template into an agent's existing workspace.
   *
   * @param {string} agentWorkspaceSlug
   * @param {object} agentDoc  — the agent's userCore document
   * @returns {Promise<{ status: 'up_to_date'|'merged', fromRevision: number, toRevision: number, changes: object }>}
   */
  async mergeTemplateUpdate(agentWorkspaceSlug, agentDoc) {
    const template = await this._loadTemplate();
    const agentWs = await this.workspacesDb.findBySlug(agentWorkspaceSlug);

    if (!agentWs) throw Object.assign(new Error(`Workspace not found: ${agentWorkspaceSlug}`), { code: 'NOT_FOUND' });

    const templateRevision = template.revision ?? 1;
    const agentRevision = agentWs.origin?.templateRevision ?? 0;

    if (agentRevision >= templateRevision) {
      return { status: 'up_to_date', fromRevision: agentRevision, toRevision: templateRevision, changes: {} };
    }

    const { snapshot: mergedSnapshot, changes } = await this._mergeSnapshots(
      agentWs.snapshot,
      template.snapshot,
      agentDoc
    );

    const sizeBytes = Buffer.byteLength(JSON.stringify(mergedSnapshot), 'utf8');

    await this.workspacesDb.updateOne(
      { slug: agentWorkspaceSlug },
      {
        $set: {
          snapshot: mergedSnapshot,
          sizeBytes,
          'origin.templateRevision': templateRevision,
          updatedAt: new Date(),
        },
      }
    );

    this.logger.info(
      `[WorkspaceFactory] Merged ${agentWorkspaceSlug}: r${agentRevision}→r${templateRevision} ` +
      `(+${changes.added.length} added, -${changes.removed.length} removed, ~${changes.updated.length} updated)`
    );

    return { status: 'merged', fromRevision: agentRevision, toRevision: templateRevision, changes };
  }

  /**
   * Propagates the latest template to all agent workspaces that are behind.
   * Returns a summary; individual failures do not abort the batch.
   *
   * @returns {Promise<{ total: number, merged: number, upToDate: number, failed: number, errors: Array }>}
   */
  async propagateToAll() {
    const template = await this._loadTemplate();
    const templateRevision = template.revision ?? 1;

    const behind = await this.workspacesDb.findBehindTemplate(template.slug, templateRevision);
    this.logger.info(`[WorkspaceFactory] Propagating r${templateRevision} to ${behind.length} workspaces`);

    let merged = 0, failed = 0;
    const errors = [];

    for (const ws of behind) {
      try {
        // Resolve agentDoc from ownerId
        const agentDoc = ws.ownerId
          ? await this.userCoreDb.findOne({ _id: ws.ownerId })
          : null;

        await this.mergeTemplateUpdate(ws.slug, agentDoc);
        merged++;
      } catch (err) {
        failed++;
        errors.push({ slug: ws.slug, error: err.message });
        this.logger.warn(`[WorkspaceFactory] Propagate failed for ${ws.slug}: ${err.message}`);
      }
    }

    return { total: behind.length, merged, upToDate: 0, failed, errors };
  }

  // ---------------------------------------------------------------------------
  // Private — merge internals
  // ---------------------------------------------------------------------------

  async _mergeSnapshots(agentSnapshot, templateSnapshot, agentDoc) {
    const agentWinsByTemplateId = new Map();
    const agentAddedWindows = [];

    for (const win of agentSnapshot.toolWindows || []) {
      if (win.templateWindowId) {
        agentWinsByTemplateId.set(win.templateWindowId, win);
      } else {
        agentAddedWindows.push(win);
      }
    }

    const templateWinIds = new Set((templateSnapshot.toolWindows || []).map(w => w.id));
    const changes = { added: [], removed: [], updated: [], preserved: [] };
    const mergedWindows = [];

    for (const tmplWin of templateSnapshot.toolWindows || []) {
      const existing = agentWinsByTemplateId.get(tmplWin.id);

      if (existing) {
        // Window exists in both: template controls structure, agent controls position + overrides
        mergedWindows.push({
          ...tmplWin,
          templateWindowId: tmplWin.id,
          // Preserve agent-controlled fields
          ...(existing.position !== undefined && { position: existing.position }),
          ...(existing.agentOverrides && { agentOverrides: existing.agentOverrides }),
          // Keep the agent's own cloned spell (not the template's spell reference)
          ...(existing.isSpell && existing.spell ? { isSpell: true, spell: existing.spell } : {}),
        });
        changes.updated.push(tmplWin.id);
      } else {
        // New window added by admin — add to agent workspace
        const newWin = await this._cloneWindowSpell(
          { ...tmplWin, templateWindowId: tmplWin.id },
          agentDoc
        );
        mergedWindows.push(newWin);
        changes.added.push(tmplWin.id);
      }
    }

    // Track windows the admin removed from the template
    for (const [templateWindowId] of agentWinsByTemplateId) {
      if (!templateWinIds.has(templateWindowId)) {
        changes.removed.push(templateWindowId);
        // Deliberately not added to mergedWindows — admin removed it
      }
    }

    // Preserve all agent-added windows untouched
    for (const win of agentAddedWindows) {
      mergedWindows.push(win);
      changes.preserved.push(win.id);
    }

    const mergedWindowIds = new Set(mergedWindows.map(w => w.id));
    const mergedConnections = this._mergeConnections(
      agentSnapshot.connections || [],
      templateSnapshot.connections || [],
      mergedWindowIds
    );

    return {
      snapshot: { toolWindows: mergedWindows, connections: mergedConnections },
      changes,
    };
  }

  /**
   * Clones the spell on a single window if it's a spell window.
   * Returns the window with the new spell reference, or as-is if not a spell window.
   */
  async _cloneWindowSpell(win, agentDoc) {
    if (!win.isSpell || !win.spell?._id || !agentDoc) return win;

    let original;
    try { original = await this.spellsDb.findById(win.spell._id); } catch (_) {}
    if (!original) return win;

    const cloned = await this.spellsDb.createSpell({
      name: original.name,
      description: original.description || '',
      creatorId: agentDoc._id,
      steps: JSON.parse(JSON.stringify(original.steps || [])),
      exposedInputs: JSON.parse(JSON.stringify(original.exposedInputs || [])),
      tags: original.tags || [],
      visibility: 'private',
    });

    return { ...win, spell: { _id: cloned._id, slug: cloned.slug, name: cloned.name } };
  }

  _mergeConnections(agentConns, templateConns, mergedWindowIds) {
    const result = [];
    const seen = new Set();

    const key = (c) => `${c.fromWindowId}:${c.toWindowId}`;

    // Template connections first — they take priority
    for (const conn of templateConns) {
      const k = key(conn);
      if (mergedWindowIds.has(conn.fromWindowId) && mergedWindowIds.has(conn.toWindowId) && !seen.has(k)) {
        result.push(conn);
        seen.add(k);
      }
    }

    // Agent connections fill in remaining (agent-added wires, or preserved template wires)
    for (const conn of agentConns) {
      const k = key(conn);
      if (mergedWindowIds.has(conn.fromWindowId) && mergedWindowIds.has(conn.toWindowId) && !seen.has(k)) {
        result.push(conn);
        seen.add(k);
      }
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Private — provision helpers
  // ---------------------------------------------------------------------------

  async _loadTemplate() {
    const envSlug = process.env.AGENT_STARTER_WORKSPACE_SLUG;
    if (envSlug) {
      const ws = await this.workspacesDb.findBySlug(envSlug);
      if (!ws) throw Object.assign(new Error(`Template workspace not found: ${envSlug}`), { code: 'NOT_FOUND' });
      return ws;
    }
    const ws = await this.workspacesDb.findOne({ isAgentTemplate: true });
    if (!ws) {
      throw Object.assign(
        new Error('No agent template workspace configured. Set AGENT_STARTER_WORKSPACE_SLUG or mark one with isAgentTemplate: true'),
        { code: 'NOT_FOUND' }
      );
    }
    return ws;
  }

  async _buildPlaceholderMap(tokenUri, agentDoc) {
    const portMap = {
      nftTokenId: String(agentDoc.agentTokenId ?? ''),
      nftName: agentDoc.profile?.name || agentDoc.agentId || '',
      nftImage: '',
      nftCollection: agentDoc.contractAddress || '',
      chainId: agentDoc.chainId ? String(agentDoc.chainId) : '',
      nftDescription: agentDoc.profile?.description || '',
    };

    const placeholders = {
      '$NFT_TOKEN_ID': portMap.nftTokenId,
      '$NFT_NAME': portMap.nftName,
      '$NFT_IMAGE': portMap.nftImage,
    };

    if (!tokenUri) return { placeholders, portMap };

    try {
      const meta = await this.ipfsService.fetchJson(tokenUri);

      if (meta.image) {
        let imageUrl = meta.image;
        if (imageUrl.startsWith('ipfs://')) {
          try {
            imageUrl = await this._mirrorImageToR2(imageUrl, agentDoc._id?.toString());
          } catch (err) {
            this.logger.warn(`[WorkspaceFactory] IPFS mirror failed, falling back to gateway: ${err.message}`);
            imageUrl = this.ipfsService.resolveUrl(imageUrl);
          }
        }
        portMap.nftImage = imageUrl;
        placeholders['$NFT_IMAGE'] = imageUrl;
      }

      if (meta.name) {
        portMap.nftName = meta.name;
        placeholders['$NFT_NAME'] = meta.name;
      }

      if (meta.description) {
        portMap.nftDescription = meta.description;
      }

      const attrs = meta.attributes || meta.traits || [];
      for (const attr of attrs) {
        if (!attr.trait_type) continue;
        const traitName = String(attr.trait_type);
        const val = String(attr.value ?? '');
        placeholders[`$NFT_TRAIT_${traitName.toUpperCase().replace(/\s+/g, '_')}`] = val;
        portMap[`trait:${traitName.toLowerCase().replace(/\s+/g, '_')}`] = val;
      }
    } catch (err) {
      this.logger.warn(`[WorkspaceFactory] Token metadata fetch failed (${tokenUri}): ${err.message}`);
    }

    return { placeholders, portMap };
  }

  _substituteSnapshot(snapshot, placeholders) {
    let raw = JSON.stringify(snapshot);
    for (const [placeholder, value] of Object.entries(placeholders)) {
      // JSON.stringify gives us a quoted, escaped string; slice(1,-1) strips the outer quotes
      // so the result is safe to splice directly into the serialized JSON.
      const escaped = JSON.stringify(String(value ?? '')).slice(1, -1);
      raw = raw.split(placeholder).join(escaped);
    }
    return JSON.parse(raw);
  }

  /**
   * Clones all spell windows, tagging templateWindowId on every window.
   * Agent-context windows are stripped (their bindings are already baked).
   * @param {object} snapshot
   * @param {object} agentDoc
   * @param {{ tagTemplateIds?: boolean, factoryBindings?: Map }} opts
   */
  async _cloneSpells(snapshot, agentDoc, { tagTemplateIds = false, factoryBindings = null } = {}) {
    const toolWindows = snapshot.toolWindows || [];
    const patchedWindows = [];
    const agentContextIds = new Set();

    for (const win of toolWindows) {
      // Strip agent-context nodes — they're template-only scaffolding
      if (win.type === 'agent-context') {
        agentContextIds.add(win.id);
        continue;
      }

      const base = tagTemplateIds ? { ...win, templateWindowId: win.id } : { ...win };

      if (!win.isSpell || !win.spell?._id) {
        patchedWindows.push(base);
        continue;
      }

      let original;
      try { original = await this.spellsDb.findById(win.spell._id); } catch (_) {}

      if (!original) {
        this.logger.warn(`[WorkspaceFactory] Spell ${win.spell._id} not found — keeping reference`);
        patchedWindows.push(base);
        continue;
      }

      // Apply factory bindings: bake static values into spell, remove from exposedInputs
      const bindings = factoryBindings?.get(win.id) || [];
      const boundPortKeys = new Set(bindings.map(b => b.portKey));
      const exposedInputs = JSON.parse(JSON.stringify(original.exposedInputs || []));
      const filteredExposedInputs = exposedInputs.filter(
        ei => !boundPortKeys.has(`${ei.nodeId}__${ei.paramKey}`)
      );
      const parameterMappings = {};
      for (const b of bindings) parameterMappings[b.portKey] = b.value;

      const cloned = await this.spellsDb.createSpell({
        name: original.name,
        description: original.description || '',
        creatorId: agentDoc._id,
        steps: JSON.parse(JSON.stringify(original.steps || [])),
        exposedInputs: filteredExposedInputs,
        ...(bindings.length > 0 && { parameterMappings }),
        tags: original.tags || [],
        visibility: 'private',
      });

      if (bindings.length > 0) {
        this.logger.debug(`[WorkspaceFactory] Baked ${bindings.length} factory binding(s) into spell ${cloned.slug}`);
      }
      this.logger.debug(`[WorkspaceFactory] Cloned spell ${original.slug} → ${cloned.slug}`);
      patchedWindows.push({ ...base, spell: { _id: cloned._id, slug: cloned.slug, name: cloned.name } });
    }

    // Strip connections involving agent-context windows (both field name variants)
    const filteredConnections = (snapshot.connections || []).filter(c => {
      const fromId = c.fromWindowId || c.from;
      const toId = c.toWindowId || c.to;
      return !agentContextIds.has(fromId) && !agentContextIds.has(toId);
    });

    return { snapshot: { ...snapshot, toolWindows: patchedWindows, connections: filteredConnections } };
  }

  /**
   * Walks the snapshot for connections from agent-context windows and maps them
   * to `{ portKey, value }` bindings grouped by target windowId.
   *
   * @param {object} snapshot
   * @param {object} portMap  — { nftName, nftImage, nftTokenId, 'trait:*', ... }
   * @returns {Map<string, Array<{ portKey: string, value: string }>>}
   */
  _resolveFactoryBindings(snapshot, portMap) {
    const contextWindowIds = new Set(
      (snapshot.toolWindows || [])
        .filter(w => w.type === 'agent-context')
        .map(w => w.id)
    );

    if (contextWindowIds.size === 0) return new Map();

    const bindingsByWindowId = new Map();
    for (const conn of snapshot.connections || []) {
      if (!contextWindowIds.has(conn.fromWindowId)) continue;
      // Canvas stores fromOutput/toInput (CanvasEngine field names)
      const portId = conn.fromOutput || conn.fromPort;
      const targetKey = conn.toInput || conn.toPort;
      const value = portMap[portId];
      if (value === undefined || !targetKey) continue;
      if (!bindingsByWindowId.has(conn.toWindowId)) {
        bindingsByWindowId.set(conn.toWindowId, []);
      }
      bindingsByWindowId.get(conn.toWindowId).push({ portKey: targetKey, value });
    }

    return bindingsByWindowId;
  }

  async _mirrorImageToR2(ipfsUrl, agentId) {
    if (!this.storageService) throw new Error('storageService not configured');
    const { stream, contentType } = await this.ipfsService.fetchStream(ipfsUrl);
    const safeCid = ipfsUrl.replace(/^ipfs:\/\//, '').replace(/\//g, '_');
    const key = `agent-nft-images/${agentId || 'unknown'}/${safeCid}`;
    const { permanentUrl } = await this.storageService.uploadFromStream(stream, key, contentType);
    this.logger.debug(`[WorkspaceFactory] Mirrored IPFS → R2: ${key}`);
    return permanentUrl;
  }
}

module.exports = { WorkspaceFactory };
