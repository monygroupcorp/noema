import { Parser } from 'expr-eval';

const parser = new Parser({
  allowMemberAccess: true,
  operators: {
    conditional: true,   // ternary
    logical: true,       // &&, ||
    comparison: true,    // ==, !=, <, >, <=, >=
    add: true, subtract: true, multiply: true, divide: true, remainder: true,
    power: true, concatenate: true,
    // Disallow assignment and function definition
    assignment: false,
  },
});

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Functions that don't need access to `input` context
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

// Build string functions that auto-use `input` when called with fewer args.
// e.g. replace("old","new") → replace(input, "old", "new")
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

/**
 * Evaluate an expression string (multi-line supported) with given variables.
 * Each line runs in sequence. The result of each line becomes `input` for the next.
 * Blank lines and lines starting with # are skipped.
 *
 * String functions auto-use `input` when called with fewer args:
 *   replace("old","new")     → replaces in input
 *   replace(str,"old","new") → replaces in str
 *
 * @param {string} expression - One or more expr-eval expressions, one per line
 * @param {object} variables - Variables available in the expression (e.g., { input: 'hello', n: 0, N: 6 })
 * @returns {*} The result of the last expression
 *
 * If a non-final line returns an array (e.g. range(4)), the remaining lines run
 * N times as a batch. `n` (0-based index) and `N` (total) are injected per iteration
 * and `input` is preserved as the original wired value — not overwritten by the array.
 * This lets you write:
 *   range(4)
 *   replace("{x}", n == 0 ? "a" : n == 1 ? "b" : ...)
 * in a single expression node.
 */
export function evaluate(expression, variables = {}) {
  const vars = { ...variables };
  const ctxFunctions = buildContextFunctions(vars);
  Object.assign(vars, staticFunctions, ctxFunctions);
  Object.assign(vars, variables);

  const lines = expression.split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));

  if (lines.length === 0) throw new Error('No expression to evaluate');

  const originalInput = vars.input;

  let result;
  for (let i = 0; i < lines.length; i++) {
    result = parser.evaluate(lines[i], vars);

    // Privileged range: a non-final line returning an array switches to batch mode.
    // Remaining lines run N times with n/N injected and original input preserved.
    if (Array.isArray(result) && i < lines.length - 1) {
      const N = result.length;
      const remaining = lines.slice(i + 1);
      return result.map((_, n) => {
        const iterVars = { ...variables, input: originalInput, n, N };
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
    }

    vars.input = result;
  }
  return result;
}

/**
 * Validate an expression string (multi-line) without executing it.
 * @param {string} expression
 * @returns {{ valid: boolean, error?: string, line?: number }}
 */
export function validate(expression) {
  const lines = expression.split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));

  for (let i = 0; i < lines.length; i++) {
    try {
      parser.parse(lines[i]);
    } catch (err) {
      return { valid: false, error: `Line ${i + 1}: ${err.message}`, line: i + 1 };
    }
  }
  return { valid: true };
}
