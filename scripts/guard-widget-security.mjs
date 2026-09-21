#!/usr/bin/env node
/**
 * guard-widget-security — the embed surface may not hand a partner's visitors our spend.
 *
 * `/widget` is the one surface where a stranger holds a spending credential. Three properties
 * keep that safe, and all three are the kind that rot silently: nothing type-checks them,
 * nothing fails when they stop being true, and each was already broken once.
 *
 *   1. EVERY PRESENTATION IS GATED. A `bursaToken` is a bearer credential, so revocation has
 *      to be an ACCESS fact and not a balance one. Revoking used to drain the purse and
 *      nothing on the request path read `Bursa.status`, so a revoked code still authenticated
 *      everywhere and any credits that landed back in it were spendable again. The fix put one
 *      gate in `bursaGate.ts` and called it from all three surfaces that accept a presented
 *      token — but nothing stops a fourth router from reading `x-bursa-token` and forgetting.
 *      So: wherever the header is read, a gate call stands between the read and the identity
 *      it returns.
 *
 *   2. THE DEPLOYED EMBED RECORDS ITS FRAMING. `WIDGET_FRAME_ANCESTORS` unset is the CLOSED
 *      default — the router falls back to `frame-ancestors 'self'` and no partner site may
 *      frame the embed at all. That is a deployment's posture, not the repository's, and the
 *      only honest way to know it is to ask the running deployment. A per-agent override
 *      exists in the types and has no write endpoint, so this variable is the whole of it.
 *
 *   3. THE ACCESS CODE IS NOT IN THE URL. The code is a bearer token capped only by the
 *      purse balance and carrying no expiry, so a copy of it is the purse; it used to ride
 *      `?code=`, which puts it in history, shared links, Referers and access logs. The server
 *      now reads it from nowhere — the gate hands it to the run panel inside the browser and
 *      it leaves only as `x-bursa-token`. A legacy link is adopted once in the browser and
 *      scrubbed, under `Referrer-Policy: no-referrer`, which is the header that says the
 *      deployed build carries the fix rather than merely having merged it.
 *
 * Read-only. Never edits. Exit 0 silent when clean; exit 1 with one `rule: what is wrong` per hit.
 *
 * Rules 2 and 3's live half ask the deployment. `--offline` skips them, which is how the
 * hermetic suite runs this; `--host <origin>` points them elsewhere, which is how a staging
 * deployment is read. The static half always runs.
 *
 * `--src <dir>` points the static half at a different source tree. That exists for one reason:
 * a guard whose patterns stop matching goes green over the defect it was written for and says
 * nothing. `widgetSecurityGuard.test.ts` drives this against fabricated routers, both ways per
 * rule, so a passing run is evidence the rules still find the real thing.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OFFLINE = process.argv.includes('--offline');
const hostFlag = process.argv.indexOf('--host');
const HOST = hostFlag > -1 ? process.argv[hostFlag + 1] : 'https://noema.art';
const srcFlag = process.argv.indexOf('--src');
const SRC = srcFlag > -1 ? resolve(process.argv[srcFlag + 1]) : join(ROOT, 'src');

const problems = [];
const fail = (rule, what) => problems.push(`${rule}: ${what}`);

/** Every `.ts` under `src/`, minus the browser app — which SENDS the header and gates nothing. */
function serverSources(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (e === 'node_modules' || p === join(SRC, 'platforms/web/app')) continue;
    if (statSync(p).isDirectory()) serverSources(p, out);
    else if (e.endsWith('.ts') && !e.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

// ── 1. Every presentation of a bursa token is gated ──────────────────────────
// The read is always the same line, because all three surfaces copied it from each other:
//   const bursaToken = req.body?.bursaToken ?? (req.headers['x-bursa-token'] as string | undefined)
// What follows it must call the gate before the resolver hands back an identity. The slice
// between the read and the next `return` is that window; a gate call has to be inside it.
const GATES = ['admitBursaToken(', 'refuseTerminalPurse('];
const READ = /req\.headers\[['"]x-bursa-token['"]\]/g;

let readSites = 0;
for (const file of serverSources(SRC)) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(READ)) {
    readSites++;
    const after = src.slice(m.index, src.indexOf('return', m.index) + 1 || undefined);
    if (!GATES.some((g) => after.includes(g))) {
      const line = src.slice(0, m.index).split('\n').length;
      fail('gated', `${relative(SRC, file)}:${line} reads x-bursa-token and resolves an identity `
        + `without calling admitBursaToken or refuseTerminalPurse — a revoked or redeemed purse `
        + `would still authenticate here`);
    }
  }
}
// A rule that silently matches nothing is not a rule. The three known surfaces are apiRouter,
// storageRouter and colloquiaRouter; fewer means the read line was reworded and this stopped
// looking at anything.
if (readSites < 3) {
  fail('gated', `found ${readSites} place(s) reading x-bursa-token, expected at least 3 `
    + `(apiRouter, storageRouter, colloquiaRouter) — the read was reworded and this rule is blind`);
}

// ── 3 (static). The server reads no access code from the query string ────────
const widget = join(SRC, 'allocutio/api/widgetRouter.ts');
const widgetSrc = readFileSync(widget, 'utf8');
for (const m of widgetSrc.matchAll(/req\.query(?:\.code\b|\[['"]code['"]\])/g)) {
  const line = widgetSrc.slice(0, m.index).split('\n').length;
  fail('no-code-in-url', `${relative(SRC, widget)}:${line} reads the access code from the query `
    + `string — it is a bearer token with no expiry and no cap but the purse balance, so it may `
    + `not reach a server log, a Referer, a history entry or a shared link`);
}

// ── The live half ────────────────────────────────────────────────────────────
async function live() {
  // Any /widget path serves the framing headers, including the 404: `frame()` sets them before
  // the route resolves an agent. So this needs no real agent id and mints no run.
  const url = `${HOST}/widget/_guard-widget-security-probe`;
  let res;
  try {
    res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    fail('deployed', `could not read ${url}: ${e.message}`);
    return;
  }

  // 2. The recorded framing value, read from the deployment rather than from the repository.
  const csp = res.headers.get('content-security-policy');
  const ancestors = /frame-ancestors\s+([^;]+)/i.exec(csp ?? '')?.[1].trim();
  if (!ancestors) {
    fail('frame-ancestors', `${url} serves no frame-ancestors (content-security-policy: `
      + `${csp ?? 'absent'}) — any site could frame the embed`);
  } else if (ancestors !== "'self'") {
    // Not a defect in itself: a partner allowlist is a decision. But it is the decision this
    // clause exists to record, so it may not happen quietly.
    fail('frame-ancestors', `${url} serves frame-ancestors ${ancestors}, not the closed default `
      + `'self' — WIDGET_FRAME_ANCESTORS is set on this deployment and partner sites may frame `
      + `the embed. Record the change on noema/widget-security before this goes green again`);
  }

  // 3 (live). `Referrer-Policy: no-referrer` is the header the code-transport fix added. The
  // deployment serving it is what says the fix is DEPLOYED and not merely merged.
  const referrer = res.headers.get('referrer-policy');
  if (referrer !== 'no-referrer') {
    fail('no-code-in-url', `${url} serves referrer-policy: ${referrer ?? 'absent'}, not `
      + `no-referrer — a legacy ?code= link would leak the purse token in the Referer of every `
      + `request the embed then makes, and the deployed build is behind the transport fix`);
  }
}

if (!OFFLINE) await live();

if (problems.length) {
  for (const p of problems) console.error(p);
  process.exit(1);
}
