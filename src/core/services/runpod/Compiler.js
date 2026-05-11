const { hashDeployment } = require('./deploymentHash');
const { validateFractalTool } = require('../../tools/fractalTool');
const WorkflowTemplateRegistry = require('./WorkflowTemplateRegistry');
const { WorkflowTemplateError } = WorkflowTemplateRegistry;

const MAX_COMPOSE_DEPTH = 16;

class CompilerError extends Error {
  constructor(code, message, context = {}) {
    super(message);
    this.name = 'CompilerError';
    this.code = code;
    this.context = context;
  }
}

function defaultRandomSeed() {
  return Math.floor(Math.random() * 0x100000000);
}

class Compiler {
  constructor({ workflowTemplates, toolVersionsDb, userPreferencesDb, logger, randomSeed } = {}) {
    if (!workflowTemplates) {
      throw new CompilerError('TEMPLATE_NOT_FOUND', 'Compiler requires workflowTemplates');
    }
    this.templates = workflowTemplates;
    this.toolVersionsDb = toolVersionsDb || null;
    this.userPreferencesDb = userPreferencesDb || null;
    this.logger = logger || console;
    this.randomSeed = typeof randomSeed === 'function' ? randomSeed : defaultRandomSeed;
  }

  /**
   * Compile a Tool (atomic or composed) into one or more Deployments.
   *
   * Atomic: returns [{ hash, spec }]
   * Composed: returns [{ hash, spec, parentStep }, ...] — one per atomic leaf, topologically ordered
   *
   * @param {{ tool, inputs, accountContext, _ancestors }} opts
   * @returns {Promise<Array<{ hash: string, spec: Object, parentStep?: string }>>}
   */
  async compile({ tool, inputs, accountContext, _ancestors } = {}) {
    const validation = validateFractalTool(tool);
    if (!validation.isValid) {
      throw new CompilerError('TOOL_INVALID', `Invalid tool: ${JSON.stringify(validation.errors)}`, { errors: validation.errors });
    }

    const ancestors = _ancestors || new Set();

    if (Array.isArray(tool.composedSteps) && tool.composedSteps.length > 0) {
      return this._compileComposed(tool, inputs || {}, accountContext || null, ancestors);
    }

    const deployment = await this._compileAtomic(tool, inputs || {}, accountContext || null);
    return [deployment];
  }

  async _compileComposed(tool, inputs, accountContext, ancestors) {
    if (!this.toolVersionsDb) {
      throw new CompilerError('NO_TOOL_VERSIONS_DB', 'Compiler requires toolVersionsDb to compile composed Tools');
    }

    if (ancestors.size >= MAX_COMPOSE_DEPTH) {
      throw new CompilerError('MAX_DEPTH_EXCEEDED', `Composed Tool depth exceeds limit of ${MAX_COMPOSE_DEPTH}`);
    }

    if (ancestors.has(tool.toolId)) {
      throw new CompilerError('CYCLE_DETECTED', `Cycle detected: '${tool.toolId}' is already in the compilation stack (${[...ancestors].join(' → ')} → ${tool.toolId})`);
    }

    const nextAncestors = new Set([...ancestors, tool.toolId]);

    // Sort steps by ordine (ascending) — parallel steps at the same ordine run in stepId order
    const steps = tool.composedSteps.slice().sort((a, b) => {
      if (a.ordine !== b.ordine) return a.ordine - b.ordine;
      return String(a.stepId) < String(b.stepId) ? -1 : 1;
    });

    const deployments = [];
    const stepOutputSchemas = {};

    for (const step of steps) {
      // Load the pinned child tool from the DB
      const childTool = await this.toolVersionsDb.findByRef({
        toolId: step.childToolRef.toolId,
        version: step.childToolRef.version,
      });

      if (!childTool) {
        throw new CompilerError(
          'CHILD_TOOL_NOT_FOUND',
          `Child tool '${step.childToolRef.toolId}@${step.childToolRef.version}' not found in toolVersionsDb`,
          { stepId: step.stepId, childToolRef: step.childToolRef }
        );
      }

      // Merkle hash check — the loaded tool must match the pinned contentHash
      this._verifyHash(childTool, step.childToolRef.contentHash, step.stepId);

      // Resolve input bindings for this step
      const stepInputs = this._resolveBindings(step.inputBindings || {}, inputs, stepOutputSchemas, step.stepId);

      // Recursively compile (handles both atomic and nested composed)
      const childDeployments = await this.compile({
        tool: childTool,
        inputs: stepInputs,
        accountContext,
        _ancestors: nextAncestors,
      });

      for (const d of childDeployments) {
        deployments.push({ ...d, parentStep: step.stepId });
      }

      // Record this step's output schema as a placeholder for downstream bindings
      stepOutputSchemas[step.stepId] = childTool.outputSchema || {};
    }

    this.logger.info(`[Compiler] compiled composed tool=${tool.toolId}@${tool.version} steps=${steps.length} deployments=${deployments.length}`);
    return deployments;
  }

  /**
   * Resolve inputBindings for one step into a plain inputs object.
   *
   * Supported binding kinds:
   *   exposedInput  → pull from outer inputs by key
   *   static        → use the literal value
   *   stepOutput    → prior step output (unknown at compile time — omitted from inputs)
   *   expression    → not supported until Phase 3; throws
   */
  _resolveBindings(inputBindings, outerInputs, stepOutputSchemas, stepId) {
    const resolved = {};
    for (const [paramKey, binding] of Object.entries(inputBindings)) {
      switch (binding.kind) {
        case 'exposedInput':
          if (outerInputs[binding.key] !== undefined) {
            resolved[paramKey] = outerInputs[binding.key];
          }
          break;
        case 'static':
          resolved[paramKey] = binding.value;
          break;
        case 'stepOutput':
          // Actual value unknown at compile time — omit so _applySlotMap skips it.
          // The runtime execution layer will substitute the real output value.
          break;
        case 'expression':
          throw new CompilerError(
            'EXPRESSION_NOT_SUPPORTED',
            `Expression bindings are not supported until Phase 3 (step '${stepId}', param '${paramKey}')`,
            { stepId, paramKey }
          );
        default:
          throw new CompilerError('UNKNOWN_BINDING_KIND', `Unknown binding kind '${binding.kind}' (step '${stepId}', param '${paramKey}')`);
      }
    }
    return resolved;
  }

  /**
   * Verify that a loaded child tool's contentHash matches the Merkle pin stored
   * in the composedStep. Throws HASH_MISMATCH if they differ.
   */
  _verifyHash(childTool, pinnedHash, stepId) {
    const actual = childTool.contentHash;
    if (!actual) {
      throw new CompilerError('HASH_MISSING', `Child tool '${childTool.toolId}@${childTool.version}' has no contentHash (step '${stepId}')`);
    }
    if (actual !== pinnedHash) {
      throw new CompilerError(
        'HASH_MISMATCH',
        `Merkle check failed for step '${stepId}': expected ${pinnedHash}, got ${actual}`,
        { stepId, expected: pinnedHash, actual }
      );
    }
  }

  async _compileAtomic(tool, inputs, accountContext) {
    const image = {
      imageId: tool.spec.imageId,
      imageVersion: tool.spec.imageVersion,
      ociRef: `${tool.spec.imageId}:${tool.spec.imageVersion}`
    };

    let template;
    try {
      template = this.templates.get(tool.spec.workflowTemplate, tool.spec.workflowTemplateVersion);
    } catch (err) {
      if (err instanceof WorkflowTemplateError) {
        throw new CompilerError('TEMPLATE_NOT_FOUND', err.message, { code: err.code });
      }
      throw err;
    }

    const cookFlags = { ...(tool.spec.defaultCookFlags || {}), ...(inputs._cookFlags || {}) };
    const seed = await this._resolveSeed(tool, inputs, accountContext, cookFlags);

    const seedKey = tool.spec.seedInputKey || 'input_seed';
    const slotInputs = { ...inputs, [seedKey]: seed };
    const comfyApiPayload = this._applySlotMap(template, slotInputs);

    const models = [
      ...(template.requiredModels || []),
      ...(tool.spec.requiredModelRefs || [])
    ].slice().sort((a, b) => {
      const ra = String(a.role || '');
      const rb = String(b.role || '');
      if (ra < rb) return -1;
      if (ra > rb) return 1;
      const ia = String(a.id || '');
      const ib = String(b.id || '');
      if (ia < ib) return -1;
      if (ia > ib) return 1;
      return 0;
    });

    const spec = {
      image,
      startup: null,
      models,
      workflow: {
        templateId: template.templateId,
        templateVersion: template.version,
        comfyApiPayload
      },
      cookFlags,
      seed,
      sourceTool: { toolId: tool.toolId, version: tool.version }
    };

    const hash = hashDeployment(spec);
    this.logger.info(`[Compiler] compiled tool=${tool.toolId}@${tool.version} hash=${hash} seed=${seed} models=${spec.models.length}`);
    return { hash, spec };
  }

  async _resolveSeed(tool, inputs, accountContext, cookFlags) {
    const seedKey = tool.spec.seedInputKey || 'input_seed';

    const explicit = inputs[seedKey];
    if (explicit !== undefined && explicit !== null && explicit !== '' && explicit !== -1) {
      return Number(explicit);
    }

    if (this.userPreferencesDb && accountContext && accountContext.masterAccountId) {
      try {
        const prefs = await this.userPreferencesDb.getPreferenceByKey(accountContext.masterAccountId, tool.toolId);
        if (prefs && prefs[seedKey] !== undefined && prefs[seedKey] !== null && prefs[seedKey] !== '') {
          return Number(prefs[seedKey]);
        }
      } catch (err) {
        this.logger.warn(`[Compiler] userPreferences lookup failed: ${err.message}`);
      }
    }

    const strategy = cookFlags.seedStrategy || 'shuffle';
    switch (strategy) {
      case 'shuffle':
        return this.randomSeed();
      case 'fixed':
        return Number(cookFlags.fixedSeed ?? tool.spec.defaultCookFlags?.seedPlaceholder ?? 88888888);
      case 'incremented':
        return Number((cookFlags.baseSeed ?? 0) + (cookFlags.pieceIndex ?? 0));
      default:
        throw new CompilerError('UNKNOWN_SEED_STRATEGY', `Unknown seedStrategy: ${strategy}`);
    }
  }

  _applySlotMap(template, inputs) {
    const payload = JSON.parse(JSON.stringify(template.comfyApiPayload || {}));
    const slotMap = template.slotMap || {};

    for (const pointer of Object.keys(slotMap)) {
      const inputKey = slotMap[pointer];
      if (typeof inputKey !== 'string') {
        throw new CompilerError('SLOT_EXPRESSION_NOT_SUPPORTED', `slotMap[${pointer}] must be a string in Phase 1`);
      }
      if (inputs[inputKey] === undefined) continue;

      if (typeof pointer !== 'string' || pointer[0] !== '/') {
        throw new CompilerError('INVALID_SLOT_POINTER', `slot pointer must start with '/': ${pointer}`);
      }
      const segments = pointer.slice(1).split('/');
      let parent = payload;
      for (let i = 0; i < segments.length - 1; i++) {
        const seg = segments[i];
        if (parent === null || typeof parent !== 'object' || !(seg in parent)) {
          throw new CompilerError('INVALID_SLOT_POINTER', `slot pointer parent missing at '${seg}' in '${pointer}'`);
        }
        parent = parent[seg];
      }
      const lastSeg = segments[segments.length - 1];
      parent[lastSeg] = inputs[inputKey];
    }

    return payload;
  }
}

module.exports = Compiler;
module.exports.Compiler = Compiler;
module.exports.CompilerError = CompilerError;

if (require.main === module) {
  (async () => {
    const failures = [];
    const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

    const tool = {
      toolId: 'runmake',
      version: '2.0.0',
      service: 'runpod',
      spec: {
        imageId: 'runpod/pytorch',
        imageVersion: '2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04',
        workflowTemplate: 'flux-schnell',
        workflowTemplateVersion: '1',
        seedInputKey: 'input_seed',
        defaultCookFlags: { batchSize: 1, seedStrategy: 'shuffle' },
        requiredModelRefs: []
      },
      inputSchema: { prompt: { name: 'Prompt', type: 'text', required: true } },
      outputSchema: { imageUrl: { name: 'Result', type: 'string' } },
      composedSteps: [],
      exposedInputs: [],
      exposedOutputs: []
    };

    const registry = new WorkflowTemplateRegistry({ logger: silentLogger });

    function makePrefsDb(map) {
      return {
        async getPreferenceByKey(masterAccountId, toolId) {
          return map.get(`${masterAccountId}:${toolId}`) || null;
        }
      };
    }

    const ctx = { masterAccountId: 'mau-1' };

    // A. Determinism
    {
      const c = new Compiler({ workflowTemplates: registry, logger: silentLogger });
      const [r1] = await c.compile({ tool, inputs: { prompt: 'a cat', input_seed: 42 }, accountContext: ctx });
      const [r2] = await c.compile({ tool, inputs: { prompt: 'a cat', input_seed: 42 }, accountContext: ctx });
      if (r1.hash !== r2.hash) failures.push(`A: hash drift ${r1.hash} vs ${r2.hash}`);
    }

    // B. Input variance
    {
      const c = new Compiler({ workflowTemplates: registry, logger: silentLogger });
      const [base] = await c.compile({ tool, inputs: { prompt: 'a cat', input_seed: 42 }, accountContext: ctx });
      const [promptChange] = await c.compile({ tool, inputs: { prompt: 'a dog', input_seed: 42 }, accountContext: ctx });
      const [seedChange] = await c.compile({ tool, inputs: { prompt: 'a cat', input_seed: 43 }, accountContext: ctx });
      const [widthChange] = await c.compile({ tool, inputs: { prompt: 'a cat', input_seed: 42, width: 768 }, accountContext: ctx });
      if (promptChange.hash === base.hash) failures.push('B: prompt change produced same hash');
      if (seedChange.hash === base.hash) failures.push('B: seed change produced same hash');
      if (widthChange.hash === base.hash) failures.push('B: width change produced same hash');
    }

    // C. Shuffle non-determinism
    {
      const c = new Compiler({ workflowTemplates: registry, logger: silentLogger });
      const [r1] = await c.compile({ tool, inputs: { prompt: 'a cat' }, accountContext: ctx });
      const [r2] = await c.compile({ tool, inputs: { prompt: 'a cat' }, accountContext: ctx });
      if (r1.hash === r2.hash) failures.push('C: shuffle produced identical hashes');
    }

    // D. Pinned shuffle via userPreferences
    {
      const map = new Map();
      map.set('mau-1:runmake', { input_seed: 1234 });
      const c = new Compiler({ workflowTemplates: registry, userPreferencesDb: makePrefsDb(map), logger: silentLogger });
      const [r1] = await c.compile({ tool, inputs: { prompt: 'a cat' }, accountContext: ctx });
      const [r2] = await c.compile({ tool, inputs: { prompt: 'a cat' }, accountContext: ctx });
      if (r1.hash !== r2.hash) failures.push(`D: pinned shuffle hash drift ${r1.hash} vs ${r2.hash}`);
      if (r1.spec.seed !== 1234) failures.push(`D: expected seed 1234, got ${r1.spec.seed}`);
    }

    // E. Explicit input wins
    {
      const map = new Map();
      map.set('mau-1:runmake', { input_seed: 1234 });
      const c = new Compiler({ workflowTemplates: registry, userPreferencesDb: makePrefsDb(map), logger: silentLogger });
      const [r] = await c.compile({ tool, inputs: { prompt: 'a cat', input_seed: 9999 }, accountContext: ctx });
      if (r.spec.seed !== 9999) failures.push(`E: expected seed 9999, got ${r.spec.seed}`);
    }

    // F. Deployment shape
    {
      const c = new Compiler({ workflowTemplates: registry, logger: silentLogger });
      const [r] = await c.compile({ tool, inputs: { prompt: 'a cat', input_seed: 42 }, accountContext: ctx });
      const requiredKeys = ['image', 'startup', 'models', 'workflow', 'cookFlags', 'seed', 'sourceTool'];
      for (const k of requiredKeys) {
        if (!(k in r.spec)) failures.push(`F: spec missing key '${k}'`);
      }
      if (r.spec.startup !== null) failures.push(`F: spec.startup expected null`);
      const seedNode = r.spec.workflow.comfyApiPayload['13'];
      if (!seedNode || seedNode.inputs.seed !== r.spec.seed) {
        failures.push(`F: comfyApiPayload['13'].inputs.seed=${seedNode && seedNode.inputs.seed} != resolved ${r.spec.seed}`);
      }
      if (r.spec.models.length !== 4) failures.push(`F: expected 4 models, got ${r.spec.models.length}`);
      const sortedCheck = r.spec.models.slice().sort((a, b) => {
        if (a.role < b.role) return -1;
        if (a.role > b.role) return 1;
        if (a.id < b.id) return -1;
        if (a.id > b.id) return 1;
        return 0;
      });
      for (let i = 0; i < sortedCheck.length; i++) {
        if (sortedCheck[i] !== r.spec.models[i]) {
          failures.push(`F: models not sorted by [role, id]`);
          break;
        }
      }
      if (r.spec.image.ociRef !== `${tool.spec.imageId}:${tool.spec.imageVersion}`) {
        failures.push(`F: ociRef wrong: ${r.spec.image.ociRef}`);
      }
      if (r.spec.workflow.templateId !== 'flux-schnell') failures.push(`F: workflow.templateId mismatch`);
    }

    // G. Slot substitution
    {
      const c = new Compiler({ workflowTemplates: registry, logger: silentLogger });
      const [r] = await c.compile({ tool, inputs: { prompt: 'a cat', input_seed: 42 }, accountContext: ctx });
      const node22 = r.spec.workflow.comfyApiPayload['22'];
      if (!node22 || node22.inputs.clip_l !== 'a cat') failures.push(`G: clip_l='${node22 && node22.inputs.clip_l}' expected 'a cat'`);
      if (!node22 || node22.inputs.t5xxl !== 'a cat') failures.push(`G: t5xxl='${node22 && node22.inputs.t5xxl}' expected 'a cat'`);
    }

    // H. compile() returns array for atomic
    {
      const c = new Compiler({ workflowTemplates: registry, logger: silentLogger });
      const result = await c.compile({ tool, inputs: { prompt: 'a cat', input_seed: 42 }, accountContext: ctx });
      if (!Array.isArray(result)) failures.push('H: compile() should return array');
      else if (result.length !== 1) failures.push(`H: expected 1 deployment, got ${result.length}`);
    }

    if (failures.length) {
      console.error('FAIL:', failures.join('; '));
      process.exit(1);
    }
    console.log('PASS: Compiler');
    console.log('  - A determinism: same inputs -> identical hash');
    console.log('  - B input variance: prompt/seed/width each change hash');
    console.log('  - C shuffle: undefined seed produces different hashes');
    console.log('  - D pinned shuffle: userPreference produces stable hash, seed=1234');
    console.log('  - E explicit input wins over userPreference (seed=9999)');
    console.log('  - F deployment shape valid; models sorted; seed wired through');
    console.log('  - G slot substitution sets node 22 clip_l and t5xxl');
    console.log('  - H compile() returns array for atomic');
  })().catch((err) => {
    console.error('FAIL: smoke threw:', err && err.stack || err);
    process.exit(1);
  });
}
