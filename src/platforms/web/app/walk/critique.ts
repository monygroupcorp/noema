// walk/critique.ts — the Phase-2 critic. Every shot of a named run is critiqued by several
// independent multimodal passes against two written standards, and only what survives two gates
// reaches a person:
//
//   1. the citation gate — a finding names the shot it was observed in, one rule (a D-*/P-* from
//      DESIGN.md or the screen's own REF-* from REFERENCES.md), and what that rule says. Missing
//      any of the three, it is discarded before anyone reads it. A multimodal critic reports
//      issues it never observed, confidently and in the house format; the citation is the only
//      thing that catches it, because a citation can be checked and a vibe cannot.
//   2. the majority gate — the passes run blind to each other, and a finding that only one of
//      them saw is noise by definition (the run-to-run agreement of these models is about κ≈0.5).
//      What two of three agree on is kept, with the agreement recorded beside it.
//
// What is left lands in the house CRIT format: a pack the proprietor rules on inline, finding by
// finding, with the shot each one came from beside it. The pack says what was discarded and why,
// so the gate is a receipt and not a black box.
//
//   npm run walk:critique -- <run>                      critique the run's mobile shots, 3 passes
//   npm run walk:critique -- <run> --viewport desktop   the other viewport
//   npm run walk:critique -- <run> --only /catalog,/run  a subset, while tuning
//   npm run walk:critique -- <run> --pack-only          rebuild the pack from findings.json
//
// The critic is the `claude` CLI in print mode — the one model the box already pays for, with no
// new vendor and no key in the repo. Each pass is its own process with no session, so no pass sees
// another's answer. The standards travel in the system prompt, identical for every call, so they
// are read once into the prompt cache and not 165 times.

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { chromium, type Browser } from 'playwright';
import { execFile } from 'node:child_process';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');

import {
  designRules, referenceRows, referencesPreamble, discardReason, majorityMerge, sameFinding,
  type RefRow, type Severity, type Finding, type Discarded, type Admitted, type Merged, type GateContext,
} from './gate.ts';

// The gate's functions and types are re-exported so a reader who starts here finds them, and so
// nothing that imported them from this file before the split has to move.
export {
  designRules, referenceRows, discardReason, majorityMerge, sameFinding,
  type RefRow, type Severity, type Finding, type Discarded, type Admitted, type Merged, type GateContext,
};

// ---------------------------------------------------------------- the critic, one pass ---------

interface Shot { route: string; viewport: string; file: string; bytes: number }
interface Manifest {
  run: string; capturedAt: string; revision: string; baseUrl: string; authenticated: boolean;
  coverage?: string; routes: number; shots: Shot[]; failed?: { route: string; viewport?: string; error: string }[];
  webgl?: boolean;
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          rule: { type: 'string', description: 'exactly one id: D-n, P-na, or this screen\'s REF-n' },
          shot: { type: 'string', description: 'the shot id you were given, verbatim' },
          element: { type: 'string', description: 'the UI element, as a short noun phrase (e.g. "filter row", "primary button", "empty-state copy")' },
          where: { type: 'string', enum: ['top', 'upper-middle', 'middle', 'lower-middle', 'bottom'] },
          observed: { type: 'string', description: 'what is visibly in the shot, specifically — text quoted, position named' },
          convention: { type: 'string', description: 'what the cited rule says, quoted or closely paraphrased; for a REF-*, the convention the reference screen establishes and where' },
          severity: { type: 'string', enum: ['blocking', 'should', 'nit'] },
        },
        required: ['rule', 'shot', 'element', 'where', 'observed', 'convention', 'severity'],
      },
    },
  },
  required: ['findings'],
};

function systemPrompt(design: string, references: string): string {
  return `You are the Phase-2 UX critic for the noema web app. You are shown ONE screenshot at a time and you report only what you can see in it, against two written standards.

The two standards answer two different questions, and a finding cites exactly one of them:
- DESIGN.md (below, in full) grounds whether the screen is noema-shaped. Cite a D-* rule or a P-* priority.
- The screen's reference app (named in each request) grounds whether the screen is good at the job it does: it is one screen of one app the user has already used for this same task. Cite the screen's REF-* id, name the convention the reference screen establishes and where it establishes it, and say how the shot departs from it. "The reference does this better" names no convention and will be discarded.

The citation contract (DESIGN.md §0.1 and REFERENCES.md §0.5): every finding carries all three of (1) the shot id it was observed in, verbatim as given, (2) one rule id, (3) what that rule says. A finding missing any of them is discarded unread. A finding that matches DESIGN.md §9 (any EX-*) has already been adjudicated — do not file it under any rule.

Discipline:
- Report ONLY what is visible in the shot. Do not infer hover, focus, motion, what happens after a tap, or what another screen does. If a rule needs something the shot cannot show (a measurement, a media query, a reload), cite it only when the shot shows the failure plainly.
- The shot is a full-page capture at a fixed viewport width; the visible fold is the top viewport-height of it. A rule about "above the fold" or "without scrolling" is judged against that.
- When the capture is anonymous and the shot shows a sign-in gate or an anonymous render instead of the member's screen, critique the gate that IS shown against the rules. Do not critique the screen that is not shown.
- Before filing, re-read the rule's own words against the shot. A finding the rule's words do not support is an invented one: a label that is one capitalised word is sentence case; a control that is visible is not "hidden"; a count that is shown is not "missing".
- One finding per distinct observation. Prefer few, certain findings over many. Zero findings is a legitimate answer and is better than an invented one.
- Severity: blocking — a user cannot do the screen's job, or a P-* priority is violated outright; should — a rule is plainly broken; nit — a small break of a rule.
- D-27 reserves uppercase for marquee display type and for overline labels carrying \`--tracking-caps\` — it sets a ceiling on how many such uppercase runs the site carries, not a ban on the overline role itself. An overline label in the shot is not a D-27 finding on its own; file D-27 only when you can show the count of uppercase runs has gone past the census ceiling (9 across 32 routes), not for the label being uppercase.
- D-42 and D-9: a filled button is one whose background is the accent colour. A dark pill on the page background with a hairline border is a ghost, however bold its label and however dim the accent is on that screen; do not file it as a second filled control.

Quote text from the shot where you can; name positions. Write for a reader who has the shot open beside your words.

<DESIGN.md>
${design}
</DESIGN.md>

<REFERENCES.md section-0>
${references}
</REFERENCES.md section-0>`;
}

/** A full-page shot of a long screen is thousands of pixels tall, and an image that tall reaches
 *  the model shrunk to fit, which turns 11px type into a smear the critic then reports on. So a
 *  tall shot is cut into tiles no taller than TILE_H — the long edge the model receives unshrunk —
 *  and the critic reads every tile, top to bottom, citing the one shot id. The cut runs in the
 *  browser Playwright already provides, the way review.ts diffs, rather than adding an image
 *  library. Tiles are regenerated output under report/<run>/crit/tiles/. */
const TILE_H = 1568;

const TILE_JS = `(function () {
  const img = document.getElementById('a');
  const w = img.naturalWidth, h = img.naturalHeight, T = ${TILE_H};
  const out = [];
  for (let y = 0; y < h; y += T) {
    const c = document.createElement('canvas');
    c.width = w; c.height = Math.min(T, h - y);
    c.getContext('2d').drawImage(img, 0, -y);
    out.push(c.toDataURL('image/png'));
  }
  return { w, h, tiles: out };
})()`;

async function tileShot(browser: Browser, absPath: string, outDir: string, stem: string): Promise<{ width: number; height: number; tiles: string[] }> {
  const page = await (await browser.newContext()).newPage();
  try {
    await page.setContent(`<!doctype html><meta charset="utf-8"><img id="a" src="data:image/png;base64,${readFileSync(absPath).toString('base64')}">`);
    await page.waitForFunction('document.getElementById("a").complete && document.getElementById("a").naturalHeight > 0');
    const r = await page.evaluate(TILE_JS) as { w: number; h: number; tiles: string[] };
    if (r.tiles.length <= 1) return { width: r.w, height: r.h, tiles: [absPath] };
    mkdirSync(outDir, { recursive: true });
    const files = r.tiles.map((d, i) => {
      const f = resolve(outDir, `${stem}-${String(i + 1).padStart(2, '0')}.png`);
      writeFileSync(f, Buffer.from(d.split(',')[1], 'base64'));
      return f;
    });
    return { width: r.w, height: r.h, tiles: files };
  } finally {
    await page.context().close();
  }
}

function userPrompt(shot: Shot, tiles: { width: number; height: number; tiles: string[] }, ref: RefRow | undefined, m: Manifest, viewport: { width: number; height: number }): string {
  const refLine = ref && !ref.unnamed
    ? `Reference row: ${ref.id} — ${ref.reference}. The reference is the reference for: ${ref.purpose}`
    : ref
      ? `Reference row: ${ref.id} — deliberately unnamed (${ref.purpose}). Cite DESIGN.md rules only; do not cite ${ref.id}.`
      : 'This screen has no row in the reference map. Cite DESIGN.md rules only.';
  return `Screen: ${shot.route}${ref?.screen ? ` (${ref.screen})` : ''}
Viewport: ${shot.viewport}, ${viewport.width}×${viewport.height}, full-page capture.${m.webgl === false ? '\nThe capturing browser could draw no WebGL. If this shot shows a "needs WebGL" notice or an empty 3D area, that is the camera, not the screen: do not file it.' : ''}
${refLine}
Capture: ${m.coverage ?? (m.authenticated ? 'signed in' : 'anonymous')}
Shot id to cite, verbatim: ${shot.file}

${tiles.tiles.length === 1
    ? `Read the image at ${tiles.tiles[0]} with the Read tool`
    : `The shot is ${tiles.width}×${tiles.height}px, taller than fits one image, so it is cut into ${tiles.tiles.length} tiles of the same width, top to bottom, each ${TILE_H}px tall except the last. Read every tile with the Read tool, in order, before you answer — the fold is the top ${viewport.height}px of tile 1, and the whole page is the whole set:
${tiles.tiles.map((t, i) => `  tile ${i + 1}: ${t}`).join('\n')}
Then`}, return your findings as JSON per the schema. Cite the shot id exactly as given above, never a tile path.`;
}

interface PassResult { run: number; findings: Partial<Finding>[]; error?: string; costUsd?: number }

/** One pass, retried once when the CLI exits with nothing at all — an empty exit 1 is a transient
 *  of the harness, not an answer, and a screen with two of its three passes missing has no majority
 *  to vote. A pass that returns anything, including an error it names, is not retried. */
async function claudePass(opts: { model: string; system: string; prompt: string; run: number; cwd: string }): Promise<PassResult> {
  const first = await claudePassOnce(opts);
  if (first.error && /^no structured output; exit \d+$/.test(first.error)) return claudePassOnce(opts);
  return first;
}

function claudePassOnce(opts: { model: string; system: string; prompt: string; run: number; cwd: string }): Promise<PassResult> {
  const args = [
    '-p', '--model', opts.model, '--no-session-persistence',
    '--output-format', 'json', '--json-schema', JSON.stringify(SCHEMA),
    '--allowedTools', 'Read', '--max-turns', '8',
    '--append-system-prompt', opts.system,
    opts.prompt,
  ];
  return new Promise((done) => {
    const child = execFile('claude', args, { cwd: opts.cwd, maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60_000 }, (err, stdout, stderr) => {
      try {
        const out = JSON.parse(String(stdout || '{}')) as { structured_output?: { findings?: Partial<Finding>[] }; is_error?: boolean; result?: string; total_cost_usd?: number };
        if (out.structured_output?.findings) return done({ run: opts.run, findings: out.structured_output.findings, costUsd: out.total_cost_usd });
        const tail = String(stderr).trim().split('\n').slice(-3).join(' | ').slice(0, 300);
        done({ run: opts.run, findings: [], error: `no structured output${out.is_error ? ` (is_error: ${String(out.result).slice(0, 200)})` : ''}${err ? `; exit ${(err as { code?: number }).code ?? '?'}` : ''}${tail ? `; stderr: ${tail}` : ''}`, costUsd: out.total_cost_usd });
      } catch {
        done({ run: opts.run, findings: [], error: `unparseable output${err ? `: ${err.message.split('\n')[0]}` : ''} ${String(stderr).slice(0, 200)}`.trim() });
      }
    });
    // The prompt is an argument, not stdin. Left open, the CLI waits on the pipe for input that
    // never comes and then exits with nothing — which is what every failed pass looked like.
    child.stdin?.end();
  });
}

async function pool<T>(items: (() => Promise<T>)[], width: number): Promise<T[]> {
  const out: T[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) { const i = next++; out[i] = await items[i](); }
  }
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, worker));
  return out;
}

// ---------------------------------------------------------------- the run ----------------------

export interface ScreenReport {
  route: string;
  screen: string;
  ref: RefRow | undefined;
  shot: string;
  passes: { run: number; returned: boolean; raw: number; error?: string; costUsd?: number }[];
  discarded: Discarded[];
  minority: Merged[];
  merged: Merged[];
}

export interface CritiqueReport {
  run: string;
  viewport: string;
  model: string;
  passes: number;
  critiquedAt: string;
  manifest: Omit<Manifest, 'shots'>;
  screens: ScreenReport[];
  costUsd: number;
}

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

async function critique(): Promise<void> {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith('--') && !process.argv[process.argv.indexOf(a) - 1]?.startsWith('--'));
  const RUN = positional[0];
  if (!RUN) throw new Error('usage: walk:critique -- <run> [--viewport mobile|desktop] [--passes 3] [--model <id>] [--only /a,/b] [--concurrency 4] [--pack-only]');
  const VIEWPORT = arg('--viewport', 'mobile');
  const PASSES = Number(arg('--passes', '3'));
  const MODEL = arg('--model', 'claude-sonnet-5');
  const ONLY = arg('--only', '').split(',').map((s) => s.trim()).filter(Boolean);
  const WIDTH = Number(arg('--concurrency', '4'));
  const OUT = resolve(HERE, 'report', RUN, 'crit');
  const FINDINGS = resolve(OUT, `findings-${VIEWPORT}.json`);

  const manifestFile = resolve(HERE, 'report', RUN, 'manifest.json');
  if (!existsSync(manifestFile)) throw new Error(`no manifest for run "${RUN}" — capture it first:  npm run walk -- --run ${RUN}`);
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as Manifest & { viewports?: { name: string; width: number; height: number }[] };
  const vp = manifest.viewports?.find((v) => v.name === VIEWPORT) ?? { name: VIEWPORT, width: 0, height: 0 };

  const design = readFileSync(resolve(APP, 'DESIGN.md'), 'utf8');
  const references = readFileSync(resolve(APP, 'REFERENCES.md'), 'utf8');
  const rules = designRules(design);
  const designIds = new Set([...rules.keys()].filter((k) => !k.startsWith('EX-')));
  const rows = referenceRows(references);
  const refFor = (route: string) => rows.find((r) => r.routes.includes(route));

  mkdirSync(OUT, { recursive: true });

  let report: CritiqueReport;
  if (process.argv.includes('--pack-only')) {
    if (!existsSync(FINDINGS)) throw new Error(`--pack-only: no ${FINDINGS} yet`);
    report = JSON.parse(readFileSync(FINDINGS, 'utf8')) as CritiqueReport;
  } else {
    const shots = manifest.shots.filter((s) => s.viewport === VIEWPORT && (!ONLY.length || ONLY.includes(s.route)));
    if (!shots.length) throw new Error(`run "${RUN}" has no ${VIEWPORT} shots${ONLY.length ? ` for ${ONLY.join(', ')}` : ''}`);
    const system = systemPrompt(design, referencesPreamble(references));
    console.log(`critique · run ${RUN} · ${shots.length} ${VIEWPORT} shots × ${PASSES} passes · ${MODEL} · ${WIDTH} at a time`);

    const browser = await chromium.launch();
    const tiled = new Map<Shot, { width: number; height: number; tiles: string[] }>();
    for (const shot of shots) {
      const abs = resolve(HERE, 'shots', RUN, shot.file);
      tiled.set(shot, await tileShot(browser, abs, resolve(OUT, 'tiles'), shot.file.replace(/\.png$/, '').replace(/[/:]/g, '-')));
    }
    await browser.close();
    const tilesTotal = [...tiled.values()].reduce((n, t) => n + t.tiles.length, 0);
    if (tilesTotal > shots.length) console.log(`  ${tilesTotal - shots.length} extra tiles cut from ${[...tiled.values()].filter((t) => t.tiles.length > 1).length} tall shots (≤${TILE_H}px each)`);

    const jobs: (() => Promise<{ shot: Shot; pass: PassResult }>)[] = [];
    for (const shot of shots) {
      const prompt = userPrompt(shot, tiled.get(shot)!, refFor(shot.route), manifest, vp);
      for (let run = 1; run <= PASSES; run++) {
        jobs.push(async () => {
          const pass = await claudePass({ model: MODEL, system, prompt, run, cwd: APP });
          process.stdout.write(`  ${pass.error ? '!' : '·'} ${shot.route} pass ${run}: ${pass.error ?? `${pass.findings.length} raw`}\n`);
          return { shot, pass };
        });
      }
    }
    const results = await pool(jobs, WIDTH);

    const screens: ScreenReport[] = shots.map((shot) => {
      const ref = refFor(shot.route);
      const mine = results.filter((r) => r.shot === shot).map((r) => r.pass).sort((a, b) => a.run - b.run);
      const ctx: GateContext = { shotKey: shot.file, ref, designIds };
      const discarded: Discarded[] = [], admitted: Admitted[] = [];
      for (const p of mine) {
        for (const f of p.findings) {
          const reason = discardReason(f, ctx);
          const full = { rule: '', shot: '', element: '', where: '', observed: '', convention: '', severity: 'nit' as Severity, ...f };
          if (reason) discarded.push({ ...full, run: p.run, reason });
          else admitted.push({ ...full, rule: full.rule.toUpperCase().replace(/([A-D])$/, (c) => c.toLowerCase()), run: p.run });
        }
      }
      const returned = mine.filter((p) => !p.error).length;
      const { merged, minority } = majorityMerge(admitted, returned);
      return {
        route: shot.route, screen: ref?.screen ?? '', ref, shot: shot.file,
        passes: mine.map((p) => ({ run: p.run, returned: !p.error, raw: p.findings.length, error: p.error, costUsd: p.costUsd })),
        discarded, minority, merged,
      };
    });

    const { shots: _omit, ...rest } = manifest;
    report = {
      run: RUN, viewport: VIEWPORT, model: MODEL, passes: PASSES, critiquedAt: new Date().toISOString(),
      manifest: rest, screens,
      costUsd: results.reduce((n, r) => n + (r.pass.costUsd ?? 0), 0),
    };
    writeFileSync(FINDINGS, JSON.stringify(report, null, 2));
  }

  const md = packMarkdown(report, rules);
  const mdFile = resolve(OUT, `pack-${report.viewport}.md`);
  writeFileSync(mdFile, md);
  const htmlFile = resolve(OUT, `pack-${report.viewport}.html`);
  writeFileSync(htmlFile, packHtml(report, rules, { embed: false }));
  // a self-contained copy for delivery: shots embedded, so it reads the same on any machine
  const deliverDir = resolve(OUT, 'deliver');
  mkdirSync(deliverDir, { recursive: true });
  writeFileSync(resolve(deliverDir, `pack-${report.viewport}.html`), packHtml(report, rules, { embed: true }));
  copyFileSync(mdFile, resolve(deliverDir, basename(mdFile)));

  const totals = tally(report);
  console.log(`\n${totals.raw} raw findings → ${totals.discarded} discarded at the citation gate, ${totals.minority} dropped as minority, ${totals.merged} kept (${totals.blocking} blocking · ${totals.should} should · ${totals.nit} nit)`);
  console.log(`  ${report.screens.filter((s) => !s.merged.length).length} of ${report.screens.length} screens carry no majority finding`);
  if (report.costUsd) console.log(`  cost: $${report.costUsd.toFixed(2)}`);
  console.log(`  findings: ${FINDINGS}\n  pack:     ${mdFile}\n            ${htmlFile}\n  deliver:  ${deliverDir}`);
}

// ---------------------------------------------------------------- the pack ---------------------

function tally(r: CritiqueReport) {
  const all = r.screens.flatMap((s) => s.merged);
  return {
    raw: r.screens.reduce((n, s) => n + s.passes.reduce((m, p) => m + p.raw, 0), 0),
    discarded: r.screens.reduce((n, s) => n + s.discarded.length, 0),
    minority: r.screens.reduce((n, s) => n + s.minority.length, 0),
    merged: all.length,
    blocking: all.filter((f) => f.severity === 'blocking').length,
    should: all.filter((f) => f.severity === 'should').length,
    nit: all.filter((f) => f.severity === 'nit').length,
    failedPasses: r.screens.reduce((n, s) => n + s.passes.filter((p) => !p.returned).length, 0),
  };
}

function discardReasons(r: CritiqueReport): [string, number][] {
  const counts = new Map<string, number>();
  for (const s of r.screens) for (const d of s.discarded) {
    const key = d.reason.replace(/"[^"]*"/g, '"…"').replace(/\b(D|P|REF|EX)-\d+[a-d]?\b/g, '$1-*').replace(/\([^)]*\)/g, '').trim();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

const ruleText = (rules: Map<string, string>, id: string) => rules.get(id) ?? '';

function packMarkdown(r: CritiqueReport, rules: Map<string, string>): string {
  const t = tally(r);
  const m = r.manifest;
  const withFindings = r.screens.filter((s) => s.merged.length);
  const quiet = r.screens.filter((s) => !s.merged.length);
  let n = 0;
  const lines: string[] = [];
  lines.push(`# Phase-2 critique — run \`${r.run}\`, ${r.viewport} (for rth's ruling)`);
  lines.push('');
  lines.push(`> **This is a proposal, not a change. It touches zero app code.** Every finding below was observed in a`);
  lines.push(`> named shot of this run by at least a majority of ${r.passes} independent critic passes, and cites one rule it can`);
  lines.push(`> be checked against. What did not meet that bar is counted at the end, not shown. Write \`**VERDICT:** …\``);
  lines.push(`> inline under each F. Nothing is forged before the verdicts.`);
  lines.push(`>`);
  lines.push(`> **Walk the visual first:** \`pack-${r.viewport}.html\` — every screen's shot beside its findings, dark ground.`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## The run in one paragraph');
  lines.push('');
  lines.push(`Run \`${r.run}\` photographed ${m.routes} routes at revision \`${m.revision}\` against \`${m.baseUrl}\` on ${m.capturedAt.slice(0, 10)}, each viewport as a first visit at its own width. The ${r.viewport} shots were critiqued ${r.passes} times each by \`${r.model}\`, blind to one another, against DESIGN.md and the screen's row in REFERENCES.md. ${t.raw} raw findings came back; ${t.discarded} were discarded at the citation gate, ${t.minority} were seen by only one pass and dropped, and **${t.merged} remain** (${t.blocking} blocking · ${t.should} should · ${t.nit} nit) across ${withFindings.length} screens. ${quiet.length} screens carry no majority finding.`);
  lines.push('');
  lines.push('## SETTLED — carried as fixed');
  lines.push('');
  lines.push('| # | Settled | Where |');
  lines.push('|---|---|---|');
  lines.push('| S1 | DESIGN.md is fully ratified and the critic may cite it | DESIGN.md §10, rth 2026-08-26 |');
  lines.push('| S2 | Anything in DESIGN.md §9 (EX-*) is adjudicated and is not re-filed | DESIGN.md §0.1 |');
  lines.push('| S3 | A finding with no shot, no rule, or no statement of the rule is discarded before it is read | REFERENCES.md §0.5 |');
  lines.push('| S4 | The REF-* rows are proposals until ruled; a REF citation below stands on the row as proposed | REFERENCES.md status line |');
  lines.push('');
  lines.push('## FACTS the findings stand on');
  lines.push('');
  lines.push(`- Capture: ${m.coverage ?? (m.authenticated ? 'signed in' : 'anonymous')}.`);
  lines.push(`- ${m.failed?.length ? `Unreachable in the walk: ${m.failed.map((f) => `${f.route}${f.viewport ? ` [${f.viewport}]` : ''}`).join(', ')}.` : 'Every route in the census was reached.'}`);
  lines.push(`- Passes that returned no answer: ${t.failedPasses} of ${r.screens.length * r.passes}. A screen's majority is over the passes that returned.`);
  lines.push(`- Agreement is printed beside each finding as seen-by/returned, e.g. 3/3 or 2/3.`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## VERDICTS');
  lines.push('');
  for (const s of withFindings) {
    const refLine = s.ref ? (s.ref.unnamed ? `${s.ref.id} — unnamed` : `${s.ref.id} — ${s.ref.reference}`) : 'no row in the map';
    lines.push(`### ${s.route}${s.screen ? ` — ${s.screen}` : ''} · ${refLine}`);
    lines.push('');
    lines.push(`shot: \`shots/${r.run}/${s.shot}\``);
    lines.push('');
    for (const f of s.merged) {
      n++;
      lines.push(`#### F-${n} — ${f.rule} · ${f.severity} · ${f.runs.length}/${f.of}`);
      lines.push('');
      lines.push(`**Observed** (${f.element}, ${f.where}): ${f.observed}`);
      lines.push('');
      lines.push(`**Rule says:** ${f.convention}${f.rule.startsWith('REF-') ? '' : ruleText(rules, f.rule) ? `  \n_${f.rule} in DESIGN.md:_ ${ruleText(rules, f.rule)}` : ''}`);
      lines.push('');
      lines.push('**VERDICT:** ');
      lines.push('');
    }
  }
  if (quiet.length) {
    lines.push('### Screens with no majority finding');
    lines.push('');
    lines.push(quiet.map((s) => `\`${s.route}\``).join(', '));
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push('## Discarded before you saw them — the gate\'s receipt');
  lines.push('');
  lines.push(`${t.discarded} findings failed the citation gate and ${t.minority} were a single pass's opinion. The full record, including each discarded finding's text and reason, is \`findings-${r.viewport}.json\` beside this file.`);
  lines.push('');
  const reasons = discardReasons(r);
  if (reasons.length) {
    lines.push('| Reason | Count |');
    lines.push('|---|---|');
    for (const [reason, count] of reasons) lines.push(`| ${reason} | ${count} |`);
    lines.push('');
  }
  lines.push('## What this pack deliberately does NOT touch');
  lines.push('');
  lines.push(`- The ${r.viewport === 'mobile' ? 'desktop' : 'mobile'} shots of the same run — a separate pass.`);
  lines.push('- Anything behind sign-in that the capture did not reach; an anonymous render was critiqued as what it is.');
  lines.push('- Severity is the critic\'s coarse bin, not a priority call; the order of work is yours.');
  lines.push('');
  return lines.join('\n');
}

const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function packHtml(r: CritiqueReport, rules: Map<string, string>, { embed }: { embed: boolean }): string {
  const t = tally(r);
  const m = r.manifest;
  const src = (file: string) => embed
    ? `data:image/png;base64,${readFileSync(resolve(HERE, 'shots', r.run, file)).toString('base64')}`
    : `../../../shots/${esc(r.run)}/${esc(file)}`;
  let n = 0;
  const screens = r.screens.filter((s) => s.merged.length).map((s) => {
    const refLine = s.ref ? (s.ref.unnamed ? `${s.ref.id} — unnamed` : `${s.ref.id} — ${s.ref.reference}`) : 'no row in the map';
    const cards = s.merged.map((f) => {
      n++;
      return `<article class="f ${esc(f.severity)}" id="f-${n}">
  <header><span class="id">F-${n}</span><span class="rule">${esc(f.rule)}</span><span class="sev">${esc(f.severity)}</span><span class="agree">${f.runs.length}/${f.of}</span></header>
  <p class="obs"><b>Observed</b> <span class="el">${esc(f.element)} · ${esc(f.where)}</span><br>${esc(f.observed)}</p>
  <p class="conv"><b>Rule says</b><br>${esc(f.convention)}${!f.rule.startsWith('REF-') && ruleText(rules, f.rule) ? `<br><span class="src">${esc(f.rule)} in DESIGN.md: ${esc(ruleText(rules, f.rule))}</span>` : ''}</p>
  <p class="verdict">VERDICT: <span class="blank">rule in pack-${esc(r.viewport)}.md</span></p>
</article>`;
    }).join('\n');
    return `<section class="screen" id="${esc(s.route.replace(/[^a-z0-9]+/gi, '-'))}">
  <h2>${esc(s.route)}${s.screen ? ` <span class="name">${esc(s.screen)}</span>` : ''}</h2>
  <p class="ref">${esc(refLine)}${s.ref && !s.ref.unnamed ? ` — <span class="purpose">${esc(s.ref.purpose)}</span>` : ''}</p>
  <div class="pair">
    <figure><figcaption>shots/${esc(r.run)}/${esc(s.shot)}</figcaption><div class="scroll"><img loading="lazy" src="${src(s.shot)}" alt="${esc(s.route)} at ${esc(r.viewport)}"></div></figure>
    <div class="findings">${cards}</div>
  </div>
</section>`;
  }).join('\n');
  const quiet = r.screens.filter((s) => !s.merged.length);
  const reasons = discardReasons(r);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>critique · ${esc(r.run)} · ${esc(r.viewport)}</title>
<style>
  :root{color-scheme:dark;--bg:#0b0c0e;--panel:#141619;--panel2:#1a1d21;--line:#26292e;--ink:#e8e6e1;--dim:#8a8f98;--mono:#9aa3ad;--accent:#c9f24b;--bad:#e07a5f;--warn:#f2c94b}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif;padding:40px 20px 80px}
  .wrap{max-width:1180px;margin:0 auto}
  h1{font-size:22px;font-weight:600;margin-bottom:6px}
  .sub{color:var(--dim);margin-bottom:12px;max-width:80ch}
  .meta{font:12px ui-monospace,Menlo,monospace;color:var(--mono);margin-bottom:36px}
  .tally{display:flex;gap:18px;flex-wrap:wrap;margin:0 0 32px}
  .tally div{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px 14px;min-width:120px}
  .tally b{display:block;font-size:20px;font-weight:600}
  .tally span{color:var(--dim);font-size:12px}
  h2{font-size:17px;font-weight:600;margin:44px 0 4px}
  h2 .name{color:var(--dim);font-weight:400}
  .ref{color:var(--dim);font-size:13px;margin-bottom:14px}
  .purpose{color:var(--ink)}
  .pair{display:grid;grid-template-columns:${r.viewport === 'mobile' ? '410px' : '1fr'} 1fr;gap:20px;align-items:start}
  @media(max-width:900px){.pair{grid-template-columns:1fr}}
  figure{background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden}
  figcaption{font:11px/1 ui-monospace,Menlo,monospace;letter-spacing:.06em;padding:8px 12px;border-bottom:1px solid var(--line);color:var(--dim)}
  .scroll{max-height:720px;overflow:auto}
  figure img{display:block;width:100%;height:auto}
  .f{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--line);border-radius:8px;padding:12px 14px;margin-bottom:12px}
  .f.blocking{border-left-color:var(--bad)} .f.should{border-left-color:var(--warn)} .f.nit{border-left-color:var(--line)}
  .f header{display:flex;gap:12px;align-items:baseline;font:12px ui-monospace,Menlo,monospace;color:var(--dim);margin-bottom:8px}
  .f .id{color:var(--accent)} .f .rule{color:var(--ink)} .f .agree{margin-left:auto}
  .f p{margin:0 0 8px;font-size:14px}
  .f .el{color:var(--dim);font-size:12.5px}
  .f .src{color:var(--dim);font-size:12.5px}
  .verdict{font:12px ui-monospace,Menlo,monospace;color:var(--dim)} .blank{color:var(--mono)}
  .quiet,.receipt{margin-top:48px;color:var(--dim);font-size:13.5px;max-width:90ch}
  code{font:12.5px ui-monospace,Menlo,monospace;color:var(--mono)}
  table{border-collapse:collapse;font:12.5px ui-monospace,Menlo,monospace;margin-top:10px}
  td{padding:5px 14px 5px 0;border-bottom:1px solid var(--line);color:var(--dim)} td:last-child{color:var(--ink);text-align:right}
</style></head><body><div class="wrap">
<h1>critique · ${esc(r.run)} · ${esc(r.viewport)}</h1>
<p class="sub">Every finding here was seen in the shot beside it by a majority of ${r.passes} independent passes and cites one rule it can be checked against. Rule in <code>pack-${esc(r.viewport)}.md</code> — this page decides nothing.</p>
<div class="meta">${m.routes} routes · ${esc(m.revision)} · ${esc(m.baseUrl)} · ${esc(m.coverage ?? (m.authenticated ? 'signed in' : 'anonymous'))} · captured ${esc(m.capturedAt)} · critiqued ${esc(r.critiquedAt)} by ${esc(r.model)}</div>
<div class="tally">
  <div><b>${t.raw}</b><span>raw findings</span></div>
  <div><b>${t.discarded}</b><span>discarded at the citation gate</span></div>
  <div><b>${t.minority}</b><span>dropped as a single pass's opinion</span></div>
  <div><b>${t.merged}</b><span>kept · ${t.blocking} blocking · ${t.should} should · ${t.nit} nit</span></div>
  <div><b>${quiet.length}</b><span>screens with no majority finding</span></div>
</div>
${screens}
<div class="quiet"><b>No majority finding:</b> ${quiet.map((s) => `<code>${esc(s.route)}</code>`).join(', ') || 'none'}</div>
<div class="receipt"><b>The gate's receipt.</b> ${t.discarded} findings were discarded unread, for these reasons; the full text of each is in <code>findings-${esc(r.viewport)}.json</code>.
<table>${reasons.map(([reason, count]) => `<tr><td>${esc(reason)}</td><td>${count}</td></tr>`).join('')}</table></div>
</div></body></html>`;
}

// ---------------------------------------------------------------- CLI ---------------------------

const isMain = process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`;
if (isMain) {
  critique().catch((err) => { console.error(String(err instanceof Error ? err.message : err)); process.exit(1); });
}
