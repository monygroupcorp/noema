/**
 * WorkspaceFactory — provision, merge, propagate, sync-status
 *
 * Merge rules (CSS cascade):
 *   template controls: toolId, step structure, base spell definition
 *   agent controls:    position, agentOverrides, their cloned spell document
 *   agent-added windows (templateWindowId: null) are always preserved untouched
 *
 * Key "gotcha" covered by tests:
 *   If an agent deletes a template-originated window, it comes back on the next
 *   merge because the template still owns it.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');

const { WorkspaceFactory } = require('../../../src/core/services/agents/WorkspaceFactory');

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeId() {
  return new ObjectId().toString();
}

function makeTemplateWorkspace({ revision = 1, windows = [], connections = [] } = {}) {
  return {
    _id: new ObjectId(),
    slug: 'admin-template',
    isAgentTemplate: true,
    revision,
    ownerId: null,
    walletAddress: null,
    snapshot: { toolWindows: windows, connections },
  };
}

function makeWindow(id, { isSpell = false, spell = null, type = 'tool', position = { x: 0, y: 0 }, toolId = 'tool-a', templateWindowId = null } = {}) {
  return {
    id,
    type,
    toolId,
    position,
    isSpell,
    ...(spell && { spell }),
    ...(templateWindowId && { templateWindowId }),
  };
}

function makeSpell(id, { steps = [], exposedInputs = [] } = {}) {
  return { _id: new ObjectId(id), slug: `spell-${id}`, name: `Spell ${id}`, steps, exposedInputs, tags: [], visibility: 'private' };
}

function makeAgentDoc(id = makeId()) {
  return {
    _id: new ObjectId(),
    agentId: `agent-${id}`,
    profile: { name: 'Test Agent' },
    agentTokenId: '42',
    contractAddress: '0xabc',
    chainId: '1',
  };
}

// ── Stub factories ─────────────────────────────────────────────────────────────

function makeWorkspacesDb(template, agentWorkspace = null) {
  let stored = agentWorkspace ? { ...agentWorkspace } : null;
  const updates = [];

  return {
    findOne: async (query) => {
      if (query.isAgentTemplate) return template;
      return stored;
    },
    findBySlug: async (slug) => {
      if (slug === template.slug) return template;
      if (stored && stored.slug === slug) return stored;
      return null;
    },
    findBehindTemplate: async (slug, revision) => {
      if (!stored) return [];
      const agentRev = stored.origin?.templateRevision ?? 0;
      return agentRev < revision ? [stored] : [];
    },
    createWorkspace: async (params) => {
      const id = new ObjectId();
      stored = { _id: id, slug: `ws-${id}`, ...params };
      return stored;
    },
    updateOne: async (query, update) => {
      updates.push({ query, update });
      if (update.$set && stored) {
        Object.assign(stored, update.$set);
      }
    },
    _updates: updates,
    _getStored: () => stored,
  };
}

function makeSpellsDb(initialSpells = []) {
  const spells = new Map(initialSpells.map(s => [s._id.toString(), s]));
  const created = [];

  return {
    findById: async (id) => spells.get(id?.toString()) || null,
    createSpell: async (params) => {
      const id = new ObjectId();
      const spell = { _id: id, slug: `spell-${id}`, ...params };
      spells.set(id.toString(), spell);
      created.push(spell);
      return spell;
    },
    _created: created,
    _all: () => spells,
  };
}

function makeUserCoreDb() {
  const updates = [];
  return {
    findOne: async () => null,
    updateOne: async (q, u) => updates.push({ q, u }),
    _updates: updates,
  };
}

function makeFactory(template, agentWorkspace, spells = []) {
  return new WorkspaceFactory({
    workspacesDb: makeWorkspacesDb(template, agentWorkspace),
    spellsDb: makeSpellsDb(spells),
    userCoreDb: makeUserCoreDb(),
    logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
  });
}

// ── provision() ───────────────────────────────────────────────────────────────

describe('WorkspaceFactory.provision()', () => {

  test('creates workspace from template, sets origin.templateRevision', async () => {
    const template = makeTemplateWorkspace({ revision: 3, windows: [makeWindow('w1')] });
    const factory = makeFactory(template, null);

    const { slug } = await factory.provisionAgentWorkspace({ agentDoc: makeAgentDoc() });

    const ws = factory.workspacesDb._getStored();
    assert.equal(ws.origin.templateRevision, 3);
    assert.ok(slug.startsWith('ws-'));
  });

  test('tags templateWindowId on every provisioned window', async () => {
    const template = makeTemplateWorkspace({ windows: [makeWindow('w1'), makeWindow('w2')] });
    const factory = makeFactory(template, null);

    await factory.provisionAgentWorkspace({ agentDoc: makeAgentDoc() });

    const ws = factory.workspacesDb._getStored();
    const windows = ws.snapshot.toolWindows;
    assert.equal(windows.length, 2);
    assert.equal(windows[0].templateWindowId, 'w1');
    assert.equal(windows[1].templateWindowId, 'w2');
  });

  test('strips agent-context windows from provisioned snapshot', async () => {
    const template = makeTemplateWorkspace({
      windows: [
        makeWindow('ctx1', { type: 'agent-context' }),
        makeWindow('w1'),
      ],
      connections: [
        { fromWindowId: 'ctx1', toWindowId: 'w1', fromOutput: 'nftName', toInput: 'prompt' },
      ],
    });
    const factory = makeFactory(template, null);

    await factory.provisionAgentWorkspace({ agentDoc: makeAgentDoc() });

    const ws = factory.workspacesDb._getStored();
    assert.equal(ws.snapshot.toolWindows.length, 1);
    assert.equal(ws.snapshot.toolWindows[0].id, 'w1');
    assert.equal(ws.snapshot.connections.length, 0);
  });

  test('deep-clones spell documents — new _id assigned', async () => {
    const templateSpellId = makeId();
    const templateSpell = makeSpell(templateSpellId, { steps: [{ type: 'prompt', value: 'hello' }] });
    const spellWindow = makeWindow('w1', { isSpell: true, spell: { _id: templateSpell._id, slug: templateSpell.slug, name: templateSpell.name } });
    const template = makeTemplateWorkspace({ windows: [spellWindow] });
    const factory = makeFactory(template, null, [templateSpell]);

    await factory.provisionAgentWorkspace({ agentDoc: makeAgentDoc() });

    const ws = factory.workspacesDb._getStored();
    const windowSpell = ws.snapshot.toolWindows[0].spell;
    assert.notEqual(windowSpell._id.toString(), templateSpell._id.toString(), 'cloned spell must have new _id');

    const cloned = factory.spellsDb._created[0];
    assert.deepEqual(cloned.steps, templateSpell.steps);
  });

  test('substitutes $NFT_NAME placeholder in snapshot', async () => {
    const template = makeTemplateWorkspace({
      windows: [{ id: 'w1', type: 'tool', toolId: 'info', label: '$NFT_NAME' }],
      connections: [],
    });
    const factory = makeFactory(template, null);
    const agentDoc = makeAgentDoc();
    agentDoc.profile.name = 'Milady #42';

    await factory.provisionAgentWorkspace({ agentDoc });

    const ws = factory.workspacesDb._getStored();
    assert.equal(ws.snapshot.toolWindows[0].label, 'Milady #42');
  });

  test('bakes factory bindings into parameterMappings and removes them from exposedInputs', async () => {
    const templateSpellId = makeId();
    const templateSpell = makeSpell(templateSpellId, {
      exposedInputs: [
        { nodeId: 'n1', paramKey: 'nftName' },
        { nodeId: 'n2', paramKey: 'prompt' },
      ],
    });
    const spellWindow = makeWindow('w1', { isSpell: true, spell: { _id: templateSpell._id, slug: templateSpell.slug, name: templateSpell.name } });
    const template = makeTemplateWorkspace({
      windows: [
        { id: 'ctx1', type: 'agent-context', toolId: 'agent-context' },
        spellWindow,
      ],
      connections: [
        { fromWindowId: 'ctx1', toWindowId: 'w1', fromOutput: 'nftName', toInput: 'n1__nftName' },
      ],
    });
    const factory = makeFactory(template, null, [templateSpell]);
    const agentDoc = makeAgentDoc();
    agentDoc.profile.name = 'Bonky';

    await factory.provisionAgentWorkspace({ agentDoc });

    const cloned = factory.spellsDb._created[0];
    assert.equal(cloned.parameterMappings?.['n1__nftName'], 'Bonky');
    assert.ok(!cloned.exposedInputs.find(ei => ei.nodeId === 'n1'), 'baked input should be removed from exposedInputs');
    assert.ok(cloned.exposedInputs.find(ei => ei.nodeId === 'n2'), 'unbaked input should remain');
  });

  test('throws NOT_FOUND when no template workspace is configured', async () => {
    const factory = new WorkspaceFactory({
      workspacesDb: { findOne: async () => null, findBySlug: async () => null, updateOne: async () => {} },
      spellsDb: makeSpellsDb(),
      userCoreDb: makeUserCoreDb(),
      logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
    });

    await assert.rejects(
      () => factory.provisionAgentWorkspace({ agentDoc: makeAgentDoc() }),
      (err) => err.code === 'NOT_FOUND'
    );
  });

  test('keeps window reference when spell doc is missing, logs warning', async () => {
    const spellWindow = makeWindow('w1', {
      isSpell: true,
      spell: { _id: new ObjectId(), slug: 'missing-spell', name: 'Gone' },
    });
    const template = makeTemplateWorkspace({ windows: [spellWindow] });
    const warnings = [];
    const factory = new WorkspaceFactory({
      workspacesDb: makeWorkspacesDb(template, null),
      spellsDb: makeSpellsDb([]),
      userCoreDb: makeUserCoreDb(),
      logger: { info: () => {}, warn: (m) => warnings.push(m), debug: () => {}, error: () => {} },
    });

    await factory.provisionAgentWorkspace({ agentDoc: makeAgentDoc() });

    assert.ok(warnings.some(w => w.includes('not found')));
    const ws = factory.workspacesDb._getStored();
    assert.equal(ws.snapshot.toolWindows[0].spell.slug, 'missing-spell');
  });

});

// ── mergeTemplateUpdate() — happy paths ───────────────────────────────────────

describe('WorkspaceFactory.mergeTemplateUpdate() — happy paths', () => {

  test('returns up_to_date when agent revision matches template', async () => {
    const template = makeTemplateWorkspace({ revision: 5 });
    const agentWs = {
      slug: 'agent-ws',
      isAgentStarter: true,
      origin: { templateRevision: 5 },
      snapshot: { toolWindows: [], connections: [] },
    };
    const factory = makeFactory(template, agentWs);

    const result = await factory.mergeTemplateUpdate('agent-ws', makeAgentDoc());

    assert.equal(result.status, 'up_to_date');
  });

  test('adds new windows the admin added to the template', async () => {
    const template = makeTemplateWorkspace({
      revision: 2,
      windows: [makeWindow('w1'), makeWindow('w-new')],
    });
    const agentWs = {
      slug: 'agent-ws',
      origin: { templateRevision: 1 },
      snapshot: {
        toolWindows: [{ id: 'w1', templateWindowId: 'w1', toolId: 'tool-a' }],
        connections: [],
      },
    };
    const factory = makeFactory(template, agentWs);

    const result = await factory.mergeTemplateUpdate('agent-ws', makeAgentDoc());

    assert.equal(result.status, 'merged');
    assert.ok(result.changes.added.includes('w-new'));
    const ws = factory.workspacesDb._getStored();
    assert.ok(ws.snapshot.toolWindows.find(w => w.templateWindowId === 'w-new'));
  });

  test('removes windows the admin deleted from template', async () => {
    const template = makeTemplateWorkspace({ revision: 2, windows: [makeWindow('w1')] });
    const agentWs = {
      slug: 'agent-ws',
      origin: { templateRevision: 1 },
      snapshot: {
        toolWindows: [
          { id: 'w1', templateWindowId: 'w1', toolId: 'tool-a' },
          { id: 'w-old', templateWindowId: 'w-old', toolId: 'tool-b' },
        ],
        connections: [],
      },
    };
    const factory = makeFactory(template, agentWs);

    const result = await factory.mergeTemplateUpdate('agent-ws', makeAgentDoc());

    assert.ok(result.changes.removed.includes('w-old'));
    const ws = factory.workspacesDb._getStored();
    assert.ok(!ws.snapshot.toolWindows.find(w => w.id === 'w-old'));
  });

  test('preserves agent-controlled position when template window is updated', async () => {
    const template = makeTemplateWorkspace({
      revision: 2,
      windows: [{ id: 'w1', type: 'tool', toolId: 'tool-v2', position: { x: 0, y: 0 } }],
    });
    const agentWs = {
      slug: 'agent-ws',
      origin: { templateRevision: 1 },
      snapshot: {
        toolWindows: [{
          id: 'w1',
          templateWindowId: 'w1',
          toolId: 'tool-v1',
          position: { x: 999, y: 888 },
        }],
        connections: [],
      },
    };
    const factory = makeFactory(template, agentWs);

    await factory.mergeTemplateUpdate('agent-ws', makeAgentDoc());

    const ws = factory.workspacesDb._getStored();
    const w1 = ws.snapshot.toolWindows.find(w => w.templateWindowId === 'w1');
    assert.deepEqual(w1.position, { x: 999, y: 888 }, 'agent position must be preserved');
    assert.equal(w1.toolId, 'tool-v2', 'template toolId must be applied');
  });

  test('preserves agentOverrides through merge', async () => {
    const template = makeTemplateWorkspace({
      revision: 2,
      windows: [makeWindow('w1')],
    });
    const agentWs = {
      slug: 'agent-ws',
      origin: { templateRevision: 1 },
      snapshot: {
        toolWindows: [{
          id: 'w1',
          templateWindowId: 'w1',
          toolId: 'tool-a',
          agentOverrides: { title: 'My Custom Title', color: '#ff0000' },
        }],
        connections: [],
      },
    };
    const factory = makeFactory(template, agentWs);

    await factory.mergeTemplateUpdate('agent-ws', makeAgentDoc());

    const ws = factory.workspacesDb._getStored();
    const w1 = ws.snapshot.toolWindows.find(w => w.templateWindowId === 'w1');
    assert.deepEqual(w1.agentOverrides, { title: 'My Custom Title', color: '#ff0000' });
  });

  test("preserves the agent's own cloned spell through merge (not replaced by template's)", async () => {
    const templateSpellId = makeId();
    const templateSpell = makeSpell(templateSpellId);
    const agentSpellId = makeId();
    const agentSpell = makeSpell(agentSpellId, { steps: [{ type: 'prompt', value: 'agent-customized' }] });

    const template = makeTemplateWorkspace({
      revision: 2,
      windows: [makeWindow('w1', { isSpell: true, spell: { _id: templateSpell._id, slug: templateSpell.slug, name: templateSpell.name } })],
    });
    const agentWs = {
      slug: 'agent-ws',
      origin: { templateRevision: 1 },
      snapshot: {
        toolWindows: [{
          id: 'w1',
          templateWindowId: 'w1',
          isSpell: true,
          spell: { _id: agentSpell._id, slug: agentSpell.slug, name: agentSpell.name },
        }],
        connections: [],
      },
    };
    const factory = makeFactory(template, agentWs, [templateSpell, agentSpell]);

    await factory.mergeTemplateUpdate('agent-ws', makeAgentDoc());

    const ws = factory.workspacesDb._getStored();
    const w1 = ws.snapshot.toolWindows.find(w => w.templateWindowId === 'w1');
    assert.equal(w1.spell._id.toString(), agentSpell._id.toString(), "agent's spell must be kept");
  });

  test('preserves agent-added windows (no templateWindowId) through merge', async () => {
    const template = makeTemplateWorkspace({ revision: 2, windows: [makeWindow('w1')] });
    const agentWs = {
      slug: 'agent-ws',
      origin: { templateRevision: 1 },
      snapshot: {
        toolWindows: [
          { id: 'w1', templateWindowId: 'w1', toolId: 'tool-a' },
          { id: 'agent-w2', toolId: 'my-custom-tool' }, // no templateWindowId
        ],
        connections: [],
      },
    };
    const factory = makeFactory(template, agentWs);

    const result = await factory.mergeTemplateUpdate('agent-ws', makeAgentDoc());

    const ws = factory.workspacesDb._getStored();
    assert.ok(ws.snapshot.toolWindows.find(w => w.id === 'agent-w2'), 'agent-added window must survive');
    assert.ok(result.changes.preserved.includes('agent-w2'));
  });

  test('updates origin.templateRevision after merge', async () => {
    const template = makeTemplateWorkspace({ revision: 7, windows: [makeWindow('w1')] });
    const agentWs = {
      slug: 'agent-ws',
      origin: { templateRevision: 3 },
      snapshot: { toolWindows: [{ id: 'w1', templateWindowId: 'w1', toolId: 'tool-a' }], connections: [] },
    };
    const factory = makeFactory(template, agentWs);

    await factory.mergeTemplateUpdate('agent-ws', makeAgentDoc());

    const ws = factory.workspacesDb._getStored();
    assert.equal(ws['origin.templateRevision'], 7);
  });

});

// ── mergeTemplateUpdate() — the "admin wins" scenarios ────────────────────────

describe('WorkspaceFactory.mergeTemplateUpdate() — admin wins rules', () => {

  test('CRITICAL: template window deleted by agent is re-added on next merge', async () => {
    // Admin has w1 + w2 in template.
    // Agent deleted w2 from their workspace.
    // On merge, w2 must come back because the template still owns it.
    const template = makeTemplateWorkspace({
      revision: 2,
      windows: [makeWindow('w1'), makeWindow('w2')],
    });
    const agentWs = {
      slug: 'agent-ws',
      origin: { templateRevision: 1 },
      snapshot: {
        // Agent's snapshot only has w1 — they deleted w2
        toolWindows: [{ id: 'w1', templateWindowId: 'w1', toolId: 'tool-a' }],
        connections: [],
      },
    };
    const factory = makeFactory(template, agentWs);

    const result = await factory.mergeTemplateUpdate('agent-ws', makeAgentDoc());

    const ws = factory.workspacesDb._getStored();
    assert.ok(ws.snapshot.toolWindows.find(w => w.templateWindowId === 'w2'),
      'w2 must be re-added even though agent deleted it');
    assert.ok(result.changes.added.includes('w2'));
  });

  test('template connection is restored if agent removed it', async () => {
    const template = makeTemplateWorkspace({
      revision: 2,
      windows: [makeWindow('w1'), makeWindow('w2')],
      connections: [{ fromWindowId: 'w1', toWindowId: 'w2' }],
    });
    const agentWs = {
      slug: 'agent-ws',
      origin: { templateRevision: 1 },
      snapshot: {
        toolWindows: [
          { id: 'w1', templateWindowId: 'w1', toolId: 'tool-a' },
          { id: 'w2', templateWindowId: 'w2', toolId: 'tool-b' },
        ],
        connections: [], // agent deleted the connection
      },
    };
    const factory = makeFactory(template, agentWs);

    await factory.mergeTemplateUpdate('agent-ws', makeAgentDoc());

    const ws = factory.workspacesDb._getStored();
    assert.ok(ws.snapshot.connections.find(c => c.fromWindowId === 'w1' && c.toWindowId === 'w2'),
      'template connection must be restored');
  });

  test('toolId updated from template even if agent had old toolId', async () => {
    const template = makeTemplateWorkspace({
      revision: 2,
      windows: [{ id: 'w1', type: 'tool', toolId: 'new-tool-id' }],
    });
    const agentWs = {
      slug: 'agent-ws',
      origin: { templateRevision: 1 },
      snapshot: {
        toolWindows: [{ id: 'w1', templateWindowId: 'w1', toolId: 'old-tool-id' }],
        connections: [],
      },
    };
    const factory = makeFactory(template, agentWs);

    await factory.mergeTemplateUpdate('agent-ws', makeAgentDoc());

    const ws = factory.workspacesDb._getStored();
    const w1 = ws.snapshot.toolWindows.find(w => w.templateWindowId === 'w1');
    assert.equal(w1.toolId, 'new-tool-id');
  });

  test('agent-added connection survives if both its windows still exist', async () => {
    const template = makeTemplateWorkspace({
      revision: 2,
      windows: [makeWindow('w1'), makeWindow('w2')],
      connections: [],
    });
    const agentWs = {
      slug: 'agent-ws',
      origin: { templateRevision: 1 },
      snapshot: {
        toolWindows: [
          { id: 'w1', templateWindowId: 'w1', toolId: 'tool-a' },
          { id: 'w2', templateWindowId: 'w2', toolId: 'tool-b' },
        ],
        connections: [{ fromWindowId: 'w1', toWindowId: 'w2' }],
      },
    };
    const factory = makeFactory(template, agentWs);

    await factory.mergeTemplateUpdate('agent-ws', makeAgentDoc());

    const ws = factory.workspacesDb._getStored();
    assert.ok(ws.snapshot.connections.find(c => c.fromWindowId === 'w1' && c.toWindowId === 'w2'));
  });

  test('agent-added connection is dropped if its source window was removed by template', async () => {
    // Template removes w2 — any connections involving w2 must be dropped
    const template = makeTemplateWorkspace({
      revision: 2,
      windows: [makeWindow('w1')], // w2 removed
    });
    const agentWs = {
      slug: 'agent-ws',
      origin: { templateRevision: 1 },
      snapshot: {
        toolWindows: [
          { id: 'w1', templateWindowId: 'w1', toolId: 'tool-a' },
          { id: 'w2', templateWindowId: 'w2', toolId: 'tool-b' },
        ],
        connections: [{ fromWindowId: 'w1', toWindowId: 'w2' }],
      },
    };
    const factory = makeFactory(template, agentWs);

    await factory.mergeTemplateUpdate('agent-ws', makeAgentDoc());

    const ws = factory.workspacesDb._getStored();
    assert.equal(ws.snapshot.connections.length, 0, 'dangling connection must be removed');
  });

});

// ── getSyncStatus() ───────────────────────────────────────────────────────────

describe('WorkspaceFactory.getSyncStatus()', () => {

  test('returns upToDate: true when revisions match', async () => {
    const template = makeTemplateWorkspace({ revision: 5 });
    const agentWs = { slug: 'agent-ws', origin: { templateRevision: 5 }, snapshot: { toolWindows: [], connections: [] } };
    const factory = makeFactory(template, agentWs);

    const status = await factory.getSyncStatus('agent-ws');

    assert.equal(status.upToDate, true);
    assert.equal(status.behindBy, 0);
  });

  test('returns correct behindBy count', async () => {
    const template = makeTemplateWorkspace({ revision: 10 });
    const agentWs = { slug: 'agent-ws', origin: { templateRevision: 6 }, snapshot: { toolWindows: [], connections: [] } };
    const factory = makeFactory(template, agentWs);

    const status = await factory.getSyncStatus('agent-ws');

    assert.equal(status.behindBy, 4);
    assert.equal(status.upToDate, false);
    assert.equal(status.templateRevision, 10);
    assert.equal(status.agentRevision, 6);
  });

  test('throws NOT_FOUND for missing workspace', async () => {
    const template = makeTemplateWorkspace({ revision: 1 });
    const factory = makeFactory(template, null);

    await assert.rejects(
      () => factory.getSyncStatus('nonexistent-ws'),
      (err) => err.code === 'NOT_FOUND'
    );
  });

});

// ── propagateToAll() ──────────────────────────────────────────────────────────

describe('WorkspaceFactory.propagateToAll()', () => {

  test('merges all behind workspaces and returns correct summary', async () => {
    const template = makeTemplateWorkspace({ revision: 2, windows: [makeWindow('w1')] });
    const agentWs = {
      slug: 'agent-ws',
      origin: { templateRevision: 1 },
      snapshot: { toolWindows: [{ id: 'w1', templateWindowId: 'w1', toolId: 'tool-a' }], connections: [] },
    };
    const factory = makeFactory(template, agentWs);

    const summary = await factory.propagateToAll();

    assert.equal(summary.total, 1);
    assert.equal(summary.merged, 1);
    assert.equal(summary.failed, 0);
  });

  test('continues on individual failure, accumulates errors', async () => {
    const template = makeTemplateWorkspace({ revision: 2 });

    // workspacesDb that returns one workspace but mergeTemplateUpdate will fail
    // because the workspace will not be findable during the merge call
    const badWorkspacesDb = {
      findOne: async (q) => q.isAgentTemplate ? template : null,
      findBySlug: async (slug) => {
        if (slug === template.slug) return template;
        if (slug === 'failing-ws') return null; // makes merge throw NOT_FOUND
        return null;
      },
      findBehindTemplate: async () => [{ slug: 'failing-ws', ownerId: null }],
      updateOne: async () => {},
    };

    const factory = new WorkspaceFactory({
      workspacesDb: badWorkspacesDb,
      spellsDb: makeSpellsDb(),
      userCoreDb: makeUserCoreDb(),
      logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
    });

    const summary = await factory.propagateToAll();

    assert.equal(summary.failed, 1);
    assert.ok(summary.errors.length > 0);
    assert.ok(summary.errors[0].slug === 'failing-ws');
  });

  test('skips workspaces already up to date (findBehindTemplate filters them)', async () => {
    const template = makeTemplateWorkspace({ revision: 5 });
    const agentWs = {
      slug: 'agent-ws',
      origin: { templateRevision: 5 }, // already current
      snapshot: { toolWindows: [], connections: [] },
    };
    const factory = makeFactory(template, agentWs);

    const summary = await factory.propagateToAll();

    assert.equal(summary.total, 0);
    assert.equal(summary.merged, 0);
  });

});
