#!/usr/bin/env node
/**
 * guard-claims — keep unhedged privacy absolutes out of the tree.
 *
 * Noema's product claim is ANONYMITY: unlinkable ZK credit spends, no prompt or output
 * retention, no training on user content, no email required. It is NOT confidentiality
 * from the operator — inference runs on plaintext on GPUs we operate, and
 * `docs/legal/privacy-policy.md` says so explicitly. Marketing copy must not assert what
 * the privacy policy disclaims.
 *
 * This guard fails on absolute phrasings that claim the second thing. Hedged roadmap
 * language is deliberately allowed: a SENTENCE that says "in development", "not yet
 * available", "roadmap" or "coming" is describing direction, not a shipped guarantee.
 *
 * The hedge window is the sentence, not the source line. It was the line, and that made a
 * true sentence fail on where its author happened to press Enter: "Direct-to-commitment
 * deposits, where we never see the funding wallet, are on the roadmap" tripped the guard
 * whenever the wrap put "roadmap" on the next line, so /pricing carried a hand-placed line
 * break and a comment telling the next editor not to reflow it. A guard that can be
 * satisfied or broken by a formatter is teaching the wrong lesson.
 *
 * Read-only. Never edits. Exit 0 silent when clean; exit 1 with `file:line: <phrase>`
 * for every hit.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);

/** Unhedged absolutes. Case-insensitive. */
const DENY = [
  /never have to see/i,
  /we never see/i,
  /we cannot see your/i,
  /completely private/i,
  /fully private/i,
  // Hyphen or space, either way. The hyphenated spelling was the only one denied, and the
  // site footer shipped the spaced one on every page for exactly as long.
  /privacy[-\s]by[-\s]construction/i,
  /strongest privacy/i,
  /nobody can see/i,
  /no one can see/i,
  /military[-\s]?grade/i,
  // "zero-knowledge" is only a problem as a DIRECT MODIFIER of compute/inference/session
  // — that is a confidential-compute claim. The ZK *billing* claim (zero-knowledge proofs
  // for credit spends) is true and must not be caught, and it legitimately shares a line
  // with the word "compute", so per-line adjacency cannot tell the two apart.
  /zero[-\s]?knowledge[-\s]+(compute|inference|session)/i,
];

/** A sentence carrying any of these is describing the roadmap, not a shipped guarantee. */
const HEDGES = /in development|not yet available|roadmap|coming/i;

/**
 * How far either side of a match to look for the sentence boundary. A file with no sentence
 * punctuation near the hit — minified output, a long JSX attribute — must not end up hedging
 * itself from something a page away, so the window is bounded rather than open.
 */
const SENTENCE_REACH = 400;

/**
 * Paths the guard does not read.
 * - docs/legal/** and the web app's byte-copy of the privacy policy QUOTE these phrases in
 *   order to disclaim them. The guard must not fight its own denylist.
 * - This script is the denylist.
 */
const SKIP_PREFIXES = [
  'node_modules/',
  'dist/',
  'build/',
  'coverage/',
  '.git/',
  'docs/legal/',
];
const SKIP_FILES = new Set([
  'scripts/guard-claims.mjs',
  // Quotes the denied phrases in order to assert they are denied. Same reason as the legal copy:
  // the guard must not fight its own denylist.
  'tests/unit/architecture/claimsGuard.test.ts',
  'package-lock.json',
  'src/platforms/web/app/package-lock.json',
  'src/platforms/web/app/src/content/privacy.md',
]);
const SKIP_SEGMENTS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git']);

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.tgz',
  '.woff', '.woff2', '.ttf', '.otf', '.eot', '.mp4', '.mov', '.webm', '.mp3', '.wav',
  '.wasm', '.zkey', '.ptau', '.r1cs', '.safetensors', '.bin', '.node',
]);
const MAX_BYTES = 1_000_000;

function skipped(rel) {
  if (SKIP_FILES.has(rel)) return true;
  if (SKIP_PREFIXES.some((p) => rel.startsWith(p))) return true;
  if (rel.split('/').some((seg) => SKIP_SEGMENTS.has(seg))) return true;
  const dot = rel.lastIndexOf('.');
  if (dot > -1 && BINARY_EXT.has(rel.slice(dot).toLowerCase())) return true;
  return false;
}

/**
 * Enumerate candidate files. `git ls-files -co --exclude-standard` gives us tracked files
 * PLUS untracked-but-not-ignored ones, which is exactly "respect .gitignore" — and it means
 * a brand-new file dropped into the tree is scanned before it is ever committed. Falls back
 * to a plain walk outside a git checkout.
 */
function candidates() {
  try {
    const out = execFileSync(
      'git',
      ['-C', ROOT, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    return out.split('\0').filter(Boolean);
  } catch {
    const found = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_SEGMENTS.has(entry.name)) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile()) found.push(relative(ROOT, full).split(sep).join('/'));
      }
    };
    walk(ROOT);
    return found;
  }
}

/** 1-based line number of the character at `at`. */
function lineOf(text, at) {
  let line = 1;
  for (let i = 0; i < at; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

/**
 * The sentence containing `at`, whitespace collapsed so a hedge that wrapped across lines still
 * reads as one phrase. Bounded by SENTENCE_REACH in each direction; a blank line ends a sentence
 * as firmly as a full stop, so a hedge in the next paragraph cannot excuse this one.
 */
function sentenceAround(text, at) {
  const from = Math.max(0, at - SENTENCE_REACH);
  const to = Math.min(text.length, at + SENTENCE_REACH);
  const before = text.slice(from, at);
  const after = text.slice(at, to);
  const starts = [...before.matchAll(/[.!?](?=\s)|\n\s*\n/g)];
  const start = starts.length > 0 ? starts[starts.length - 1].index + starts[starts.length - 1][0].length : 0;
  const end = after.search(/[.!?](?=\s|$)|\n\s*\n/);
  return (before.slice(start) + (end === -1 ? after : after.slice(0, end + 1))).replace(/\s+/g, ' ');
}

const hits = [];

for (const rel of candidates()) {
  if (skipped(rel)) continue;

  const abs = join(ROOT, rel);
  let text;
  try {
    if (statSync(abs).size > MAX_BYTES) continue;
    const buf = readFileSync(abs);
    if (buf.includes(0)) continue; // binary
    text = buf.toString('utf8');
  } catch {
    continue; // unreadable / vanished mid-scan
  }

  if (!DENY.some((re) => re.test(text))) continue; // fast reject

  for (const re of DENY) {
    for (const m of text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))) {
      if (HEDGES.test(sentenceAround(text, m.index))) continue;
      hits.push(`${rel}:${lineOf(text, m.index)}: ${m[0]}`);
    }
  }
}

if (hits.length > 0) {
  console.error('guard-claims: unhedged privacy absolutes found.\n');
  for (const h of hits) console.error(`  ${h}`);
  console.error(
    '\nNoema claims anonymity, not confidentiality from the operator. Rewrite onto what is' +
      '\nactually true — unlinkable ZK spends, no retention, no training, no email — or hedge' +
      '\nthe SENTENCE it sits in ("in development", "not yet available", "roadmap", "coming").',
  );
  process.exit(1);
}

process.exit(0);
