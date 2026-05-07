const { isFractalTool } = require('./fractalTool');

function parseList(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

function isFractalCompilerEnabledForAccount(accountContext) {
  if (process.env.NOEMAPLANE_COMPILER_ENABLED === '1') return true;
  if (!accountContext || !accountContext.masterAccountId) return false;
  const allowlist = parseList(process.env.NOEMAPLANE_COMPILER_ALLOWLIST);
  return allowlist.includes(accountContext.masterAccountId);
}

function isFractalCompilerEnabledForTool(tool) {
  if (!tool) return false;
  const tools = parseList(process.env.NOEMAPLANE_COMPILER_TOOLS);
  if (tool.toolId && tools.includes(tool.toolId)) return true;
  if (process.env.NOEMAPLANE_COMPILER_ENABLED === '1' && isFractalTool(tool)) return true;
  return false;
}

function isFractalCompilerEnabled(tool, accountContext) {
  return isFractalCompilerEnabledForTool(tool) && isFractalCompilerEnabledForAccount(accountContext);
}

module.exports = {
  isFractalCompilerEnabledForAccount,
  isFractalCompilerEnabledForTool,
  isFractalCompilerEnabled,
};

if (require.main === module) {
  const assert = require('assert');

  const fractalShaped = {
    toolId: 'runmake',
    spec: { imageId: 'runpod/pytorch', workflowTemplate: 'flux-schnell' },
  };
  const nonFractal = { toolId: 'legacy-thing' };

  const ENV_KEYS = [
    'NOEMAPLANE_COMPILER_ENABLED',
    'NOEMAPLANE_COMPILER_ALLOWLIST',
    'NOEMAPLANE_COMPILER_TOOLS',
  ];
  const original = {};
  for (const k of ENV_KEYS) original[k] = process.env[k];
  function reset() {
    for (const k of ENV_KEYS) delete process.env[k];
  }
  function restore() {
    for (const k of ENV_KEYS) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  }

  try {
    // A
    reset();
    assert.strictEqual(isFractalCompilerEnabledForAccount({ masterAccountId: 'acc1' }), false, 'A: account false');
    assert.strictEqual(isFractalCompilerEnabledForTool(fractalShaped), false, 'A: tool false');
    assert.strictEqual(isFractalCompilerEnabled(fractalShaped, { masterAccountId: 'acc1' }), false, 'A: combined false');

    // B
    reset();
    process.env.NOEMAPLANE_COMPILER_ENABLED = '1';
    assert.strictEqual(isFractalCompilerEnabled(fractalShaped, { masterAccountId: 'acc1' }), true, 'B: combined true');

    // C
    reset();
    process.env.NOEMAPLANE_COMPILER_ENABLED = '1';
    assert.strictEqual(isFractalCompilerEnabledForTool(nonFractal), false, 'C: non-fractal tool false');
    assert.strictEqual(isFractalCompilerEnabled(nonFractal, { masterAccountId: 'acc1' }), false, 'C: combined false');

    // D
    reset();
    process.env.NOEMAPLANE_COMPILER_TOOLS = 'runmake';
    assert.strictEqual(isFractalCompilerEnabledForTool({ toolId: 'runmake' }), true, 'D: tool true via list');
    assert.strictEqual(isFractalCompilerEnabledForAccount({ masterAccountId: 'acc1' }), false, 'D: account false');
    assert.strictEqual(isFractalCompilerEnabled({ toolId: 'runmake' }, { masterAccountId: 'acc1' }), false, 'D: combined false');

    // E
    reset();
    process.env.NOEMAPLANE_COMPILER_TOOLS = 'runmake';
    process.env.NOEMAPLANE_COMPILER_ALLOWLIST = 'acc1,acc2';
    assert.strictEqual(isFractalCompilerEnabled({ toolId: 'runmake' }, { masterAccountId: 'acc1' }), true, 'E: combined true');

    // F
    reset();
    process.env.NOEMAPLANE_COMPILER_ALLOWLIST = 'acc1,acc2';
    assert.strictEqual(isFractalCompilerEnabledForAccount(null), false, 'F: null account false');
    assert.strictEqual(isFractalCompilerEnabledForAccount(undefined), false, 'F: undefined account false');

    // G
    reset();
    process.env.NOEMAPLANE_COMPILER_TOOLS = 'runmake , vastmake ';
    assert.strictEqual(isFractalCompilerEnabledForTool({ toolId: 'runmake' }), true, 'G: trimmed runmake');
    assert.strictEqual(isFractalCompilerEnabledForTool({ toolId: 'vastmake' }), true, 'G: trimmed vastmake');

    // empty-string env should not match
    reset();
    process.env.NOEMAPLANE_COMPILER_TOOLS = '';
    process.env.NOEMAPLANE_COMPILER_ALLOWLIST = '';
    assert.strictEqual(isFractalCompilerEnabledForTool({ toolId: '' }), false, 'empty env no match');
    assert.strictEqual(isFractalCompilerEnabledForAccount({ masterAccountId: '' }), false, 'empty allowlist no match');

    // null tool
    reset();
    process.env.NOEMAPLANE_COMPILER_ENABLED = '1';
    assert.strictEqual(isFractalCompilerEnabledForTool(null), false, 'null tool false');
    assert.strictEqual(isFractalCompilerEnabled(null, { masterAccountId: 'acc1' }), false, 'null tool combined false');

    console.log('featureFlags smoke: A B C D E F G all pass');
  } finally {
    restore();
  }
}
