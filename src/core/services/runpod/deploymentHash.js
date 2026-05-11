const crypto = require('crypto');

const MAX_SAFE_INT = Number.MAX_SAFE_INTEGER;

function escapeString(str) {
  let out = '"';
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c === 0x22) out += '\\"';
    else if (c === 0x5c) out += '\\\\';
    else if (c === 0x08) out += '\\b';
    else if (c === 0x09) out += '\\t';
    else if (c === 0x0a) out += '\\n';
    else if (c === 0x0c) out += '\\f';
    else if (c === 0x0d) out += '\\r';
    else if (c < 0x20) out += '\\u' + c.toString(16).padStart(4, '0');
    else out += str[i];
  }
  return out + '"';
}

function canonicalizeNumber(n) {
  if (!Number.isFinite(n)) {
    throw new Error(`canonicalize: non-finite number not allowed (${n})`);
  }
  if (Number.isInteger(n) && Math.abs(n) <= MAX_SAFE_INT) {
    return String(n);
  }
  return String(n);
}

function canonicalize(value) {
  if (value === null) return 'null';
  if (value === undefined) {
    throw new Error('canonicalize: undefined not allowed');
  }
  const t = typeof value;
  if (t === 'function') {
    throw new Error('canonicalize: function not allowed');
  }
  if (t === 'bigint') {
    throw new Error('canonicalize: bigint not allowed');
  }
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'number') return canonicalizeNumber(value);
  if (t === 'string') return escapeString(value);
  if (Array.isArray(value)) {
    const parts = value.map(canonicalize);
    return '[' + parts.join(',') + ']';
  }
  if (t === 'object') {
    const keys = Object.keys(value).sort();
    const parts = [];
    for (const k of keys) {
      const v = value[k];
      if (v === undefined) {
        throw new Error(`canonicalize: undefined value at key "${k}" not allowed`);
      }
      parts.push(escapeString(k) + ':' + canonicalize(v));
    }
    return '{' + parts.join(',') + '}';
  }
  throw new Error(`canonicalize: unsupported type ${t}`);
}

function hashDeployment(spec) {
  const canonical = canonicalize(spec);
  const digest = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
  return `sha256:${digest}`;
}

/**
 * Compute the content hash for a Tool version (atomic or composed).
 * This is the Merkle pin used in composedSteps[].childToolRef.contentHash.
 *
 * Atomic: hashes { toolId, version, inputSchema, outputSchema, service, spec }
 * Composed: hashes { toolId, version, inputSchema, outputSchema, composedSteps, exposedInputs, exposedOutputs }
 *
 * @param {Object} tool - the tool definition object
 * @returns {string} sha256:<hex>
 */
function hashToolVersion(tool) {
  const isComposed = Array.isArray(tool.composedSteps) && tool.composedSteps.length > 0;

  let payload;
  if (isComposed) {
    payload = {
      toolId: tool.toolId,
      version: tool.version,
      inputSchema: tool.inputSchema || {},
      outputSchema: tool.outputSchema || {},
      composedSteps: (tool.composedSteps || []).map(s => ({
        stepId: s.stepId,
        ordine: s.ordine,
        childToolRef: {
          toolId: s.childToolRef.toolId,
          version: s.childToolRef.version,
          contentHash: s.childToolRef.contentHash,
        },
        inputBindings: s.inputBindings || {},
        runCondition: s.runCondition || null,
      })),
      exposedInputs: tool.exposedInputs || [],
      exposedOutputs: tool.exposedOutputs || [],
    };
  } else {
    const spec = tool.spec;
    payload = {
      toolId: tool.toolId,
      version: tool.version,
      inputSchema: tool.inputSchema || {},
      outputSchema: tool.outputSchema || {},
      service: tool.service || null,
      spec: spec ? {
        imageId: spec.imageId,
        imageVersion: spec.imageVersion,
        workflowTemplate: spec.workflowTemplate,
        workflowTemplateVersion: spec.workflowTemplateVersion || null,
        requiredModelRefs: (spec.requiredModelRefs || [])
          .slice()
          .sort((a, b) => {
            const ra = String(a.role || ''), rb = String(b.role || '');
            if (ra < rb) return -1; if (ra > rb) return 1;
            const ia = String(a.id || ''), ib = String(b.id || '');
            return ia < ib ? -1 : ia > ib ? 1 : 0;
          }),
        defaultCookFlags: spec.defaultCookFlags || {},
      } : null,
    };
  }

  const canonical = canonicalize(payload);
  const digest = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
  return `sha256:${digest}`;
}

module.exports = { hashDeployment, hashToolVersion, canonicalize };

if (require.main === module) {
  const assert = require('assert');

  const baseSpec = {
    image: { imageId: 'img-1', imageVersion: 'v1', ociRef: 'docker.io/foo:bar' },
    startup: 'a'.repeat(64),
    models: [
      { role: 'checkpoint', id: 'sd_xl_base_1.0.safetensors' },
      { role: 'lora', id: 'detail.safetensors' }
    ],
    workflow: { templateId: 'tpl-1', templateVersion: '1.0.0', comfyApiPayload: { nodes: { 1: { class_type: 'KSampler' } } } },
    cookFlags: { warmup: true, gpuType: 'A40' },
    seed: 42,
    sourceTool: { toolId: 'sdxl-basic', version: '0.1.0' }
  };

  // A. Determinism
  const h1 = hashDeployment(baseSpec);
  for (let i = 0; i < 100; i++) {
    assert.strictEqual(hashDeployment(baseSpec), h1, 'A: hash drift across calls');
  }

  // B. Sensitivity
  const mutators = [
    (s) => { s.image.imageId = 'img-2'; },
    (s) => { s.seed = 43; },
    (s) => { s.cookFlags.warmup = false; },
    (s) => { s.models[0].id = 'other.safetensors'; },
    (s) => { s.startup = 'b'.repeat(64); }
  ];
  for (const mut of mutators) {
    const copy = JSON.parse(JSON.stringify(baseSpec));
    mut(copy);
    assert.notStrictEqual(hashDeployment(copy), h1, 'B: mutation did not change hash');
  }

  // C. Object key ordering
  assert.strictEqual(
    hashDeployment({ a: 1, b: 2 }),
    hashDeployment({ b: 2, a: 1 }),
    'C: key order changed hash'
  );

  // D. Array order matters
  assert.notStrictEqual(
    hashDeployment([1, 2]),
    hashDeployment([2, 1]),
    'D: array order ignored'
  );

  // E. Reject NaN, Infinity, undefined, BigInt
  assert.throws(() => hashDeployment(NaN), /non-finite/, 'E: NaN allowed');
  assert.throws(() => hashDeployment(Infinity), /non-finite/, 'E: Infinity allowed');
  assert.throws(() => hashDeployment(undefined), /undefined/, 'E: undefined allowed');
  assert.throws(() => hashDeployment(BigInt(1)), /bigint/, 'E: bigint allowed');
  assert.throws(() => hashDeployment({ x: undefined }), /undefined/, 'E: undefined value allowed');

  // F. Number canonicalization
  assert.strictEqual(hashDeployment(1.0), hashDeployment(1), 'F: 1.0 vs 1');
  assert.strictEqual(hashDeployment(1e2), hashDeployment(100), 'F: 1e2 vs 100');

  // G. Frozen fixture — pinned to sha256 of the literal canonical bytes
  const FROZEN_INPUT = { a: 1, b: [2, 3] };
  const FROZEN_CANONICAL = '{"a":1,"b":[2,3]}';
  assert.strictEqual(canonicalize(FROZEN_INPUT), FROZEN_CANONICAL, 'G: canonical form drift');
  const FROZEN_HASH = hashDeployment(FROZEN_INPUT);
  const EXPECTED_FROZEN = 'sha256:efbd0040190fb0871831e606c581f8a66db79d8e2bb836745a70051306956070';
  console.log('[smoke] G frozen canonical =', FROZEN_CANONICAL);
  console.log('[smoke] G frozen hash      =', FROZEN_HASH);

  // H. String escaping matches JSON.stringify
  const tricky = 'line1\nline2\t"quoted"\\back';
  assert.strictEqual(canonicalize(tricky), JSON.stringify(tricky), 'H: string escape mismatch');
  const hStable1 = hashDeployment(tricky);
  const hStable2 = hashDeployment(tricky);
  assert.strictEqual(hStable1, hStable2, 'H: tricky string hash drift');

  console.log('[smoke] A determinism: ok');
  console.log('[smoke] B sensitivity: ok');
  console.log('[smoke] C key-order invariance: ok');
  console.log('[smoke] D array-order sensitivity: ok');
  console.log('[smoke] E reject NaN/Inf/undefined/bigint: ok');
  console.log('[smoke] F number canonicalization: ok');
  console.log('[smoke] H string escaping: ok');
  console.log('[smoke] base hash =', h1);

  if (FROZEN_HASH !== EXPECTED_FROZEN) {
    console.error('[smoke] G FAIL: frozen hash drift');
    console.error('  expected:', EXPECTED_FROZEN);
    console.error('  actual:  ', FROZEN_HASH);
    process.exit(1);
  }
  console.log('[smoke] G frozen-fixture: ok');
  console.log('[smoke] all checks passed');
}
