#!/usr/bin/env node
/**
 * guard-site-truth — the published site may only name things the running system has.
 *
 * `guard-claims.mjs` next door polices one kind of untruth: a privacy absolute we do not hold.
 * This one polices the other kind, which is duller and commoner — copy that names a capability.
 * A feature page is a list of nouns, and a noun goes stale silently: nothing type-checks the
 * sentence "FLUX.1 Schnell, SDXL, and others", nothing fails when a modality is dropped, and the
 * reader has no way to tell a shipped noun from an aspirational one.
 *
 * The pre-launch draft of /features advertised Llama, Qwen and Mistral, vLLM and llama.cpp
 * runtimes, an embeddings modality and an OpenAI-compatible API reachable by swapping a base URL.
 * None of those were in `GET /v1/models`, `GET /v1/flows` or `GET /v1/openapi.json`; several never
 * were. It read as a product description because it was shaped like one.
 *
 * So five rules, each derived from something the running system already publishes:
 *
 *   1. ENDPOINTS. Every `/v1/…` path in the copy is a path in `docs/api/openapi.json` — which
 *      `apiDocsDrift.test.ts` holds byte-equal to the in-code contract, so this reads the live
 *      surface at one remove and never a hand-kept list.
 *   2. CREDENTIALS. Every auth header the copy tells a reader to send is a declared
 *      `securityScheme` in that same document. /features named `x-bursa-token` and sent readers
 *      to "the live contract" to read about it, and the contract did not mention it.
 *   3. MODALITIES. Every modality the copy claims is a `categoria` some seeded essentia carries.
 *      This is what catches "embeddings" and "text-to-speech": words that sound like the others
 *      and correspond to nothing that runs.
 *   4. RETENTION AND FUNDING. The four surfaces that carry the widest claims — the footer,
 *      /about, /features, /pricing — must say what the privacy policy says. Run records are
 *      retained and erasure severs rather than deletes (§7, §8); anonymous funding hides an
 *      identity, not the depositing address, which is kept for sanctions screening (§2b).
 *   5. LINKS. Every internal link the copy offers resolves to a route `App.tsx` declares. A
 *      marketing page is mostly links, and a link is the one claim a reader tests immediately:
 *      renaming a screen leaves the pages that pointed at it landing on the 404 stub, and nothing
 *      about that is loud. A `/blog/<slug>` resolves only when the guide file behind it exists,
 *      because the router's `:slug` matches anything and the index is the folder.
 *
 * Read-only. Never edits. Exit 0 silent when clean; exit 1 with `file: <what is wrong>` per hit.
 *
 * `--app <dir>` points the marketing surfaces at a different `src/` — how the test drives it, and
 * the only reason it is a parameter. The contract, the seeds and the router are always read from
 * this repository: the whole value of the guard is that the truth side of every comparison is the
 * running system.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const appFlag = process.argv.indexOf('--app');
const APP = appFlag > -1 ? resolve(process.argv[appFlag + 1]) : join(ROOT, 'src/platforms/web/app/src');
const CONTENT = join(APP, 'content');

/**
 * The published marketing pages, as markdown. The legal pages are deliberately absent: they
 * describe the same facts in order to qualify them, and a guard that read them would be marking
 * the disclaimer wrong for containing the thing it disclaims.
 */
function marketingMarkdown() {
  const top = ['about.md', 'features.md'].map((f) => join('content', f));
  const guides = readdirSync(join(CONTENT, 'blog'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => join('content', 'blog', f));
  return [...top, ...guides];
}

/** The four surfaces §4 covers. Two are markdown, two are screens. */
const WIDEST_CLAIMS = [
  join('content', 'about.md'),
  join('content', 'features.md'),
  join('screens', 'Pricing.tsx'),
  join('screens', 'SiteFooter.tsx'),
];

/**
 * The surfaces §5 walks: the marketing markdown, plus the public screens — every page a reader
 * reaches without an account, and the footer that rides under all of them.
 */
const LINK_SCREENS = [
  join('screens', 'Landing.tsx'),
  join('screens', 'Pricing.tsx'),
  join('screens', 'SiteFooter.tsx'),
  join('screens', 'Blog.tsx'),
  join('screens', 'Ceremony.tsx'),
  join('screens', 'RequestDemo.tsx'),
];

const read = (rel) => readFileSync(join(APP, rel), 'utf8');

/**
 * A screen's published copy is its JSX, not its reasoning. The footer comment quotes the very
 * deletion promise it exists to warn against — scanning it would fail the file for explaining
 * itself, which is how a guard teaches people to stop writing comments.
 */
function published(rel, text) {
  if (!rel.endsWith('.tsx')) return text;
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const hits = [];
const fail = (rel, what) => hits.push(`${rel}: ${what}`);

// ── 1 & 2. Endpoints and credentials, against the contract the site itself links to ──────────
const openapi = JSON.parse(readFileSync(join(ROOT, 'docs/api/openapi.json'), 'utf8'));
const contractPaths = new Set(Object.keys(openapi.paths));
const contractHeaders = new Set(
  Object.values(openapi.components.securitySchemes)
    .filter((s) => s.in === 'header' && typeof s.name === 'string')
    .map((s) => s.name.toLowerCase()),
);

/** `/v1/runs/<id>/stream` as the contract spells it: `/runs/{id}/stream`. */
function asContractPath(cited) {
  return cited
    .replace(/^\/v1/, '')
    .replace(/<[A-Za-z0-9_]+>/g, '{id}')
    .replace(/:([A-Za-z0-9_]+)/g, '{id}')
    .replace(/\{[A-Za-z0-9_]+\}/g, '{id}');
}

const contractShapes = new Set([...contractPaths].map(asContractPath));

for (const rel of marketingMarkdown()) {
  const text = read(rel);

  for (const m of text.matchAll(/\/v1\/[A-Za-z0-9_.<>:{}/-]*[A-Za-z0-9_.>}]/g)) {
    if (!contractShapes.has(asContractPath(m[0]))) {
      fail(rel, `cites ${m[0]}, which is not a path in docs/api/openapi.json`);
    }
  }

  // An auth header is named in copy the way a reader would send it: as `x-something` in code
  // ticks. Only headers presented as credentials are checked — `content-type` and friends are
  // not claims about what we accept.
  for (const m of text.matchAll(/`(x-[a-z0-9-]+)`/gi)) {
    if (!contractHeaders.has(m[1].toLowerCase())) {
      fail(rel, `tells a reader to send \`${m[1]}\`, which no securityScheme in docs/api/openapi.json declares`);
    }
  }
}

// ── 3. Modalities, against what the seeds actually carry ─────────────────────────────────────
const seeds = readFileSync(join(ROOT, 'src/crystal/seeds/essentiae.ts'), 'utf8');
const categoriae = new Set([...seeds.matchAll(/categoria:\s*'([^']+)'/g)].map((m) => m[1].toLowerCase()));

/**
 * Modality nouns a page might claim, and the categoria each would have to be. A word absent from
 * this vocabulary is not policed — the point is not to parse English, it is that the handful of
 * words that read as "we do this modality" cannot be written without the modality existing.
 */
const MODALITY_WORDS = [
  [/\btext generation\b|\btext-to-text\b/i, 'text'],
  [/\bimage generation\b|\btext-to-image\b/i, 'image'],
  [/\bvideo generation\b|\btext-to-video\b|\bimage-to-video\b/i, 'video'],
  [/\baudio generation\b|\btext-to-music\b|\bmusic generation\b/i, 'audio'],
  [/\b3D\b/i, '3d'],
  [/\bembeddings?\b/i, 'embedding'],
  [/\btext-to-speech\b|\bspeech synthesis\b|\bvoice cloning\b/i, 'speech'],
];

for (const rel of marketingMarkdown()) {
  const text = read(rel);
  for (const [re, categoria] of MODALITY_WORDS) {
    if (re.test(text) && !categoriae.has(categoria)) {
      fail(rel, `claims the ${categoria} modality, which no seeded essentia carries a categoria for`);
    }
  }
}

// ── 4. Retention and funding, on the four widest surfaces ────────────────────────────────────

/** Deletion promises erasure does not keep. Privacy policy §7 and §8 say what actually happens. */
const DELETION_PROMISES = [
  /kept\s+(?:for you\s+)?until you (?:erase|delete)/i,
  /\b(?:we\s+)?(?:will\s+)?delete\s+(?:your|the)\s+(?:runs?|run records?|outputs?|prompts?|generated media)\b/i,
  /\berasure deletes\b/i,
  /\b(?:runs?|run records?)[^.]{0,60}\bare deleted\b/i,
];

for (const rel of WIDEST_CLAIMS) {
  const text = published(rel, read(rel));

  for (const re of DELETION_PROMISES) {
    const m = text.match(re);
    if (m) fail(rel, `promises a deletion erasure does not perform: "${m[0].replace(/\s+/g, ' ')}"`);
  }

  // Silence agrees with the policy. Speech has to.
  if (/\brun records?\b|\byour runs\b/i.test(text) && !/\bretain(?:s|ed|ing)?\b/i.test(text)) {
    fail(rel, 'describes run records without saying they are retained (privacy policy §7)');
  }

  if (/anonym/i.test(text) && /\bfund(?:s|ed|ing)?\b/i.test(text)
      && !/sanctions|compliance|screening|deposit(?:ing)? address/i.test(text)) {
    fail(rel, 'claims anonymous funding without saying the depositing address is kept (privacy policy §2b)');
  }
}

// ── 5. Links, against the routes the router declares ─────────────────────────────────────────

/**
 * Every path `App.tsx` mounts. The router is the running system's own answer to "does this URL
 * exist", so the guard reads it rather than a list — a screen renamed in `App.tsx` invalidates
 * the pages that pointed at it in the same commit. The catch-all is excluded on purpose: it is
 * the 404 stub, and matching against it would make every dead link resolve.
 */
const routes = [...readFileSync(join(ROOT, 'src/platforms/web/app/src/App.tsx'), 'utf8')
  .matchAll(/<Route\b[^>]*?\bpath="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((p) => p !== '*');

/** A route pattern matches when it has the same segments, `:param` standing for any one. */
function routeExists(path) {
  const want = path.split('/').filter(Boolean);
  return routes.some((pattern) => {
    const have = pattern.split('/').filter(Boolean);
    return have.length === want.length
      && have.every((seg, i) => seg.startsWith(':') || seg === want[i]);
  });
}

/**
 * Internal link targets, as the copy spells them. Markdown links and JSX `to=`/`href=` only:
 * a computed target is not a claim a reader can read off the page, and a guard that tried to
 * evaluate one would be guessing.
 */
function linksIn(rel, text) {
  const found = [];
  if (rel.endsWith('.md')) {
    for (const m of text.matchAll(/\]\(([^)\s]+)/g)) found.push(m[1]);
  } else {
    for (const m of text.matchAll(/\b(?:to|href)="([^"]+)"/g)) found.push(m[1]);
  }
  return found
    .map((href) => href.split('#')[0].split('?')[0])
    // `/v1/…` is the API, not a page; rule 1 already holds it to the contract.
    .filter((href) => href.startsWith('/') && !href.startsWith('/v1/'));
}

for (const rel of [...marketingMarkdown(), ...LINK_SCREENS]) {
  const text = published(rel, read(rel));

  for (const href of linksIn(rel, text)) {
    // `/blog/:slug` matches any slug, so the router cannot answer this one: a guide resolves
    // when its file is there, which is also how the index finds it.
    const guide = href.match(/^\/blog\/([^/]+)$/);
    if (guide) {
      if (!existsSync(join(CONTENT, 'blog', `${guide[1]}.md`))) {
        fail(rel, `links to ${href}, and no guide file content/blog/${guide[1]}.md exists`);
      }
      continue;
    }

    if (!routeExists(href)) fail(rel, `links to ${href}, which no route in App.tsx serves`);
  }
}

if (hits.length > 0) {
  console.error('guard-site-truth: the published site names something the system does not have.\n');
  for (const h of hits) console.error(`  ${h}`);
  console.error(
    '\nEvery noun on a marketing page is a claim. Name what /v1 actually serves and what the' +
      '\nseeds actually carry, or mark it not-yet in the sentence that names it.',
  );
  process.exit(1);
}

process.exit(0);
