const { Parser } = require('expr-eval');
const registry = require('../adapterRegistry');

const parser = new Parser({
  allowMemberAccess: true,
  operators: {
    conditional: true,
    logical: true,
    comparison: true,
    add: true, subtract: true, multiply: true, divide: true, remainder: true,
    power: true, concatenate: true,
    assignment: false,
  },
});

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const staticFunctions = {
  len: (str) => Array.isArray(str) ? str.length : String(str).length,
  range: (n) => Array.from({ length: n }, (_, i) => i),
  toString: (v) => String(v),
  toNumber: (v) => Number(v),
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  abs: Math.abs,
  min: Math.min,
  max: Math.max,
};

function buildContextFunctions(vars) {
  const inp = () => vars.input ?? '';
  return {
    replace: (...a) => a.length < 3
      ? String(inp()).replace(new RegExp(escapeRe(a[0]), 'g'), String(a[1]))
      : String(a[0]).replace(new RegExp(escapeRe(a[1]), 'g'), String(a[2])),
    split: (...a) => a.length < 2
      ? String(inp()).split(String(a[0]))
      : String(a[0]).split(String(a[1])),
    trim: (...a) => String(a.length ? a[0] : inp()).trim(),
    padStart: (...a) => a.length < 3
      ? String(inp()).padStart(a[0], a[1] || ' ')
      : String(a[0]).padStart(a[1], a[2] || ' '),
    padEnd: (...a) => a.length < 3
      ? String(inp()).padEnd(a[0], a[1] || ' ')
      : String(a[0]).padEnd(a[1], a[2] || ' '),
    toUpperCase: (...a) => String(a.length ? a[0] : inp()).toUpperCase(),
    toLowerCase: (...a) => String(a.length ? a[0] : inp()).toLowerCase(),
    slice: (...a) => a.length < 3 && typeof a[0] === 'number'
      ? String(inp()).slice(a[0], a[1])
      : String(a[0]).slice(a[1], a[2]),
    at: (arr, idx) => Array.isArray(arr) ? arr[idx] : String(arr).charAt(idx),
    join: (sep, arr) => Array.isArray(arr) ? arr.join(sep ?? ',') : (Array.isArray(sep) ? sep.join(',') : String(sep)),
    includes: (...a) => a.length < 2
      ? String(inp()).includes(String(a[0]))
      : String(a[0]).includes(String(a[1])),
    startsWith: (...a) => a.length < 2
      ? String(inp()).startsWith(String(a[0]))
      : String(a[0]).startsWith(String(a[1])),
    endsWith: (...a) => a.length < 2
      ? String(inp()).endsWith(String(a[0]))
      : String(a[0]).endsWith(String(a[1])),
    repeat: (str, n) => n === undefined
      ? String(inp()).repeat(str)
      : String(str).repeat(n),
  };
}

class ExpressionAdapter {
  async execute(params) {
    const { expression, ...inputVars } = params;
    if (!expression) throw new Error('expression is required');

    const vars = { ...inputVars };
    const ctxFunctions = buildContextFunctions(vars);
    Object.assign(vars, staticFunctions, ctxFunctions);
    Object.assign(vars, inputVars);

    const lines = expression.split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));
    if (lines.length === 0) throw new Error('No expression to evaluate');

    const originalInput = vars.input;
    let result;
    try {
      for (let i = 0; i < lines.length; i++) {
        result = parser.evaluate(lines[i], vars);
        if (Array.isArray(result) && i < lines.length - 1) {
          const N = result.length;
          const remaining = lines.slice(i + 1);
          result = result.map((_, n) => {
            const iterVars = { ...inputVars, input: originalInput, n, N };
            const iterCtx = buildContextFunctions(iterVars);
            Object.assign(iterVars, staticFunctions, iterCtx);
            Object.assign(iterVars, { input: originalInput, n, N });
            let iterResult = originalInput;
            for (const line of remaining) {
              iterResult = parser.evaluate(line, iterVars);
              iterVars.input = iterResult;
            }
            return iterResult;
          });
          break;
        }
        vars.input = result;
      }
    } catch (err) {
      throw new Error(`Expression error: ${err.message}`);
    }

    const text = Array.isArray(result) ? JSON.stringify(result) : String(result);
    return { type: 'text', data: { text: [text], result: text }, status: 'succeeded' };
  }
}

const adapter = new ExpressionAdapter();
registry.register('expression', adapter);
module.exports = adapter;
