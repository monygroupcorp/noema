#!/usr/bin/env node
/**
 * guard-browser-storage — keep the Cookie Policy's browser-storage inventory equal to the
 * keys the web app actually writes.
 *
 * The Privacy Policy sends the reader to the Cookie Policy for "the full browser-storage
 * inventory", so that table is a completeness claim, not a sample. Nothing kept it honest:
 * a new `localStorage` key shipped without a row, and a row outlived the key it described.
 * Both had happened — `noema-<account>-space-selection` and `concierge-seen:<route>` were
 * stored and undisclosed, while `noema-tee` was disclosed and stored by nothing.
 *
 * So this reads the app's own storage call sites and compares the two sets in BOTH
 * directions. A key with no row is undisclosed storage; a row with no key describes
 * something we do not do.
 *
 * A key built from a variable (`noema-${scope}-projects`) is compared as a pattern: the
 * interpolated part matches the `<account>`-style placeholder the table writes. A call site
 * whose key this cannot resolve is an error of its own — the fix is to name the key in a
 * module-level const, which is what every other call site already does.
 *
 * Read-only. Never edits. Exit 0 silent when the two agree.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const APP = 'src/platforms/web/app/src';
const POLICY = 'src/platforms/web/app/src/content/cookies.md';
const SECTION = '## Browser storage (not cookies)';

/** Every key shape collapses to this, so a template and a `<placeholder>` compare equal. */
const normalize = (k) => k.replace(/\$\{[^}]*\}/g, '*').replace(/<[^>]*>/g, '*');

function sources(dir, out = []) {
  for (const name of readdirSync(join(ROOT, dir)).sort()) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) sources(rel, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(rel);
  }
  return out;
}

/** The first argument of a call, by balanced-paren scan from just after the `(`. */
function firstArg(text, i) {
  let depth = 0;
  for (let j = i; j < text.length; j += 1) {
    const c = text[j];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' && depth === 0) return text.slice(i, j).trim();
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    else if (c === ',' && depth === 0) return text.slice(i, j).trim();
  }
  return null;
}

const LITERAL = /^(?:'([^']*)'|"([^"]*)"|`([^`]*)`)$/;

/** An expression → the key it names, or null. Literals, module consts, and key helpers. */
function resolveKey(expr, text) {
  const lit = expr.match(LITERAL);
  if (lit) return lit[1] ?? lit[2] ?? lit[3];

  const ident = expr.match(/^[A-Za-z_$][\w$]*$/);
  if (ident) {
    const decl = text.match(new RegExp(`\\bconst\\s+${expr}\\s*=\\s*((?:'[^']*'|"[^"]*"|\`[^\`]*\`))`));
    return decl ? resolveKey(decl[1], text) : null;
  }

  const call = expr.match(/^([A-Za-z_$][\w$]*)\s*\(/);
  if (call) {
    const decl = text.match(
      new RegExp(`\\bconst\\s+${call[1]}\\s*=\\s*\\([^)]*\\)\\s*(?::[^=]*)?=>\\s*((?:'[^']*'|"[^"]*"|\`[^\`]*\`))`),
    );
    return decl ? resolveKey(decl[1], text) : null;
  }

  return null;
}

const stored = new Map(); // normalized key → where it is written
const unresolved = [];

for (const rel of sources(APP)) {
  const text = readFileSync(join(ROOT, rel), 'utf8');
  const call = /(?:window\.)?(?:localStorage|sessionStorage)\.(?:get|set|remove)Item\(/g;
  let m;
  while ((m = call.exec(text)) !== null) {
    const expr = firstArg(text, m.index + m[0].length);
    if (expr === null) continue;
    const key = resolveKey(expr, text);
    const line = text.slice(0, m.index).split('\n').length;
    if (key === null) unresolved.push(`${rel}:${line} cannot resolve the key in \`${expr}\``);
    else if (!stored.has(normalize(key))) stored.set(normalize(key), { key, at: `${rel}:${line}` });
  }
}

const policy = readFileSync(join(ROOT, POLICY), 'utf8');
const start = policy.indexOf(SECTION);
if (start < 0) {
  console.error(`guard-browser-storage: ${POLICY} has no "${SECTION}" section to read.`);
  process.exit(1);
}
const rest = policy.slice(start + SECTION.length);
const end = rest.indexOf('\n## ');
const table = end < 0 ? rest : rest.slice(0, end);

const documented = new Map();
for (const row of table.split('\n')) {
  if (!row.startsWith('|')) continue;
  for (const [, tok] of row.matchAll(/`([^`]+)`/g)) documented.set(normalize(tok), tok);
}

const undisclosed = [...stored.values()].filter((s) => !documented.has(normalize(s.key)));
const stale = [...documented.values()].filter((d) => !stored.has(normalize(d)));

if (unresolved.length > 0) {
  console.error('guard-browser-storage: a storage key this guard cannot read.\n');
  for (const u of unresolved) console.error(`  ${u}`);
  console.error('\nName the key in a module-level const, the way every other call site does.\n');
}

if (undisclosed.length > 0) {
  console.error('guard-browser-storage: the app stores a key the Cookie Policy does not list.\n');
  for (const s of undisclosed) console.error(`  ${s.key}  (written at ${s.at})`);
  console.error(`\nThe Privacy Policy calls that table the full browser-storage inventory.\nAdd a row to ${POLICY} saying what the key holds.\n`);
}

if (stale.length > 0) {
  console.error('guard-browser-storage: the Cookie Policy lists a key nothing stores.\n');
  for (const d of stale) console.error(`  ${d}`);
  console.error(`\nA row describing storage we do not write is a claim we do not back.\nRemove it from ${POLICY}, or point it at the key the app really uses.\n`);
}

process.exit(unresolved.length + undisclosed.length + stale.length > 0 ? 1 : 0);
