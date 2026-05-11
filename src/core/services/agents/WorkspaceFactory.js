// src/core/services/agents/WorkspaceFactory.js
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
   * @param {{ workspacesDb, spellsDb, userCoreDb, logger? }} deps
   */
  constructor({ workspacesDb, spellsDb, userCoreDb, logger } = {}) {
    this.workspacesDb = workspacesDb;
    this.spellsDb = spellsDb;
    this.userCoreDb = userCoreDb;
    this.logger = logger || console;
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

    const placeholders = await this._buildPlaceholderMap(tokenUri, agentDoc);
    const clonedSnapshot = this._substituteSnapshot(template.snapshot, placeholders);
    const { snapshot: patchedSnapshot } = await this._cloneSpells(clonedSnapshot, agentDoc, { tagTemplateIds: true });

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
    const map = {
      '$NFT_TOKEN_ID': String(agentDoc.agentTokenId ?? ''),
      '$NFT_NAME': agentDoc.profile?.name || agentDoc.agentId || '',
      '$NFT_IMAGE': '',
    };

    if (!tokenUri) return map;

    try {
      const meta = await this._fetchJson(tokenUri);
      if (meta.image) map['$NFT_IMAGE'] = meta.image;
      if (meta.name) map['$NFT_NAME'] = meta.name;

      const attrs = meta.attributes || meta.traits || [];
      for (const attr of attrs) {
        if (!attr.trait_type) continue;
        const k = `$NFT_TRAIT_${String(attr.trait_type).toUpperCase().replace(/\s+/g, '_')}`;
        map[k] = String(attr.value ?? '');
      }
    } catch (err) {
      this.logger.warn(`[WorkspaceFactory] Token metadata fetch failed (${tokenUri}): ${err.message}`);
    }

    return map;
  }

  _substituteSnapshot(snapshot, placeholders) {
    let raw = JSON.stringify(snapshot);
    for (const [placeholder, value] of Object.entries(placeholders)) {
      raw = raw.split(placeholder).join(value);
    }
    return JSON.parse(raw);
  }

  /**
   * Clones all spell windows, tagging templateWindowId on every window.
   * @param {object} snapshot
   * @param {object} agentDoc
   * @param {{ tagTemplateIds?: boolean }} opts
   */
  async _cloneSpells(snapshot, agentDoc, { tagTemplateIds = false } = {}) {
    const toolWindows = snapshot.toolWindows || [];
    const patchedWindows = [];

    for (const win of toolWindows) {
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

      const cloned = await this.spellsDb.createSpell({
        name: original.name,
        description: original.description || '',
        creatorId: agentDoc._id,
        steps: JSON.parse(JSON.stringify(original.steps || [])),
        exposedInputs: JSON.parse(JSON.stringify(original.exposedInputs || [])),
        tags: original.tags || [],
        visibility: 'private',
      });

      this.logger.debug(`[WorkspaceFactory] Cloned spell ${original.slug} → ${cloned.slug}`);
      patchedWindows.push({ ...base, spell: { _id: cloned._id, slug: cloned.slug, name: cloned.name } });
    }

    return { snapshot: { ...snapshot, toolWindows: patchedWindows } };
  }

  _fetchJson(uri) {
    return new Promise((resolve, reject) => {
      const mod = uri.startsWith('https') ? require('https') : require('http');
      const req = mod.get(uri, { timeout: 8000 }, (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} from tokenUri`));
        }
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch { reject(new Error('Invalid JSON from tokenUri')); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('tokenUri fetch timed out')); });
    });
  }
}

module.exports = { WorkspaceFactory };
