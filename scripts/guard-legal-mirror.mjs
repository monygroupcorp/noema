#!/usr/bin/env node
/**
 * guard-legal-mirror — keep each reference copy of a legal page in step with the page we
 * actually publish.
 *
 * The published pages under `src/platforms/web/app/src/content/` are the source of truth;
 * `docs/legal/` carries a reference copy of each so the text is readable from the repo.
 * A reference copy declares its source in a leading HTML comment and is otherwise
 * byte-identical to it.
 *
 * That pairing is easy to half-update: a correction lands on the published page, the
 * reference copy keeps the old wording, and the repo now states a policy we do not
 * operate. It has happened — the privacy reference copy went on describing anonymous
 * credits that spend with no account, and purse proof records we retain, months after the
 * published page had been corrected to say that rail is switched off. `guard-claims`
 * cannot catch it: it skips `docs/legal/` on purpose, because those pages quote the
 * phrases it denies in order to disclaim them.
 *
 * Read-only. Never edits. Exit 0 silent when every pair is in step; exit 1 naming each
 * copy that drifted and the first line where it does.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const REF_DIR = 'docs/legal';

/**
 * The declaration a reference copy opens with. The source-of-truth path is read out of the
 * comment itself rather than kept in a table here, so a new legal page is covered the
 * moment its copy carries the same header — and a copy that claims a source that does not
 * exist is an error, not a silent pass.
 */
const HEADER = /^<!--[\s\S]*?source of\s+truth:\s*`([^`]+)`[\s\S]*?-->\n\n/;

const drifted = [];
const broken = [];

for (const name of readdirSync(join(ROOT, REF_DIR)).sort()) {
  if (!name.endsWith('.md')) continue;
  const rel = `${REF_DIR}/${name}`;
  const text = readFileSync(join(ROOT, rel), 'utf8');

  const header = text.match(HEADER);
  if (!header) continue; // a doc of its own, not a mirror of a published page

  const source = header[1];
  let published;
  try {
    published = readFileSync(join(ROOT, source), 'utf8');
  } catch {
    broken.push(`${rel}: declares a source of truth that is not there: ${source}`);
    continue;
  }

  const body = text.slice(header[0].length);
  if (body === published) continue;

  const a = body.split('\n');
  const b = published.split('\n');
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  drifted.push({ rel, source, line: i + 1, ref: a[i], pub: b[i] });
}

if (broken.length > 0) {
  console.error('guard-legal-mirror: a reference copy points at a page that is not there.\n');
  for (const b of broken) console.error(`  ${b}`);
}

if (drifted.length > 0) {
  console.error('guard-legal-mirror: a reference copy has drifted from the page we publish.\n');
  for (const d of drifted) {
    console.error(`  ${d.rel}:${d.line} differs from ${d.source}`);
    console.error(`    published: ${d.pub === undefined ? '(end of file)' : JSON.stringify(d.pub)}`);
    console.error(`    reference: ${d.ref === undefined ? '(end of file)' : JSON.stringify(d.ref)}`);
  }
  console.error(
    '\nThe published page is the source of truth. Correct it there, then copy it across' +
      '\nunder the reference copy\'s header comment — never the other way round.',
  );
}

process.exit(broken.length + drifted.length > 0 ? 1 : 0);
