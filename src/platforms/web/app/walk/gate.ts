// walk/gate.ts — the gate, as pure functions: the standards read as data, and the two checks that
// stand between a multimodal critic and a reader. No browser, no process, no file system — this
// module is what tests/unit/web/critiqueGate.test.ts proves, and it is kept free of the walker's
// runtime dependencies so the root tree can typecheck it without the app's node_modules.
//
//   1. the citation gate — a finding must cite a shot of this run and a rule that exists (a D-*/P-*
//      DESIGN.md declares, or the screen's own named REF-*); an EX-* is refused as adjudicated.
//   2. the majority gate — findings only one of three blind passes saw are dropped.
//
// critique.ts runs the passes and builds the pack; everything it decides with, it imports from here.

// ---------------------------------------------------------------- the standards, as data ------

export interface RefRow {
  id: string;
  routes: string[];
  screen: string;
  reference: string;
  purpose: string;
  unnamed: boolean;
}

/** Every rule DESIGN.md declares, by id, with the sentence(s) that follow the id. */
export function designRules(md: string): Map<string, string> {
  const rules = new Map<string, string>();
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    // `- **D-20** text`, `- **P-1a** text`, and §9's `- **EX-1 — Title.** text`
    const m = /^\s*-\s+\*\*((?:D|P|EX)-\d+[a-d]?)(?:\s*[—–-]\s*([^*]*))?\*\*\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    let text = m[2] ? `${m[2].trim()} ${m[3]}` : m[3];
    // a rule's text runs on indented continuation lines until the next list item or blank
    for (let j = i + 1; j < lines.length && /^\s{2,}\S/.test(lines[j]) && !/^\s*-\s/.test(lines[j]); j++) {
      text += ' ' + lines[j].trim();
    }
    rules.set(m[1], text.replace(/\*\*/g, '').trim());
  }
  return rules;
}

/** The map's rows: one per `| REF-n | routes | screen | reference | purpose |` table line. */
export function referenceRows(md: string): RefRow[] {
  const rows: RefRow[] = [];
  for (const line of md.split('\n')) {
    const m = /^\|\s*(REF-\d+)\s*(?:—\s*)?/.exec(line);
    if (!m) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    // §1.9 has four columns (surface, reference, purpose) with the id folded into the first
    const [idCell, routesCell, screen, reference, purpose] =
      cells.length >= 5 ? cells : [cells[0], cells[0], '', cells[1] ?? '', cells[2] ?? ''];
    rows.push({
      id: m[1],
      routes: [...routesCell.matchAll(/`(\/[^`\s]*)`/g)].map((r) => r[1]),
      screen,
      reference: reference.replace(/\*\*/g, ''),
      purpose,
      unnamed: /\*\*unnamed\*\*/.test(reference) || /\*\*unnamed\*\*/.test(idCell),
    });
  }
  return rows;
}

/** The §0 of REFERENCES.md — the grounding and the citation contract — without the map itself. */
export function referencesPreamble(md: string): string {
  const i = md.indexOf('## 1. The map');
  return i > 0 ? md.slice(0, i) : md;
}

// ---------------------------------------------------------------- findings and the gates ------

export type Severity = 'blocking' | 'should' | 'nit';

export interface Finding {
  rule: string;
  shot: string;
  element: string;
  where: string;
  observed: string;
  convention: string;
  severity: Severity;
}

export interface Discarded extends Finding { run: number; reason: string }
export interface Admitted extends Finding { run: number }
export interface Merged extends Finding {
  /** which passes saw it, 1-based */
  runs: number[];
  /** of how many passes that returned */
  of: number;
}

export interface GateContext {
  /** the shot id the critic was told to cite, e.g. "catalog/mobile.png" */
  shotKey: string;
  /** this screen's row in the map, if it has one */
  ref: RefRow | undefined;
  /** every D-n and P-n id DESIGN.md declares */
  designIds: Set<string>;
}

const SEVERITIES = new Set<string>(['blocking', 'should', 'nit']);

/** The citation gate. Returns the reason a finding is discarded, or null when it is admitted. */
export function discardReason(f: Partial<Finding>, ctx: GateContext): string | null {
  const rule = String(f.rule ?? '').trim().toUpperCase();
  if (!rule) return 'cites no rule';
  if (/^EX-\d+$/.test(rule)) return `cites ${rule}, which DESIGN.md §9 has already adjudicated`;
  if (/^(D|P)-\d+[A-D]?$/.test(rule)) {
    const id = rule.replace(/([A-D])$/, (c) => c.toLowerCase());
    if (!ctx.designIds.has(id)) return `cites ${id}, a rule DESIGN.md does not have`;
  } else if (/^REF-\d+$/.test(rule)) {
    if (!ctx.ref) return `cites ${rule}, but this screen has no row in the map`;
    if (rule !== ctx.ref.id) return `cites ${rule}, which is not this screen's row (${ctx.ref.id})`;
    if (ctx.ref.unnamed) return `cites ${rule}, a row that deliberately names no reference`;
  } else {
    return `cites "${f.rule}", which is not a D-*, P-* or REF-* id`;
  }
  const shot = String(f.shot ?? '').trim();
  if (!shot) return 'cites no shot';
  if (shot !== ctx.shotKey && !shot.endsWith(`/${ctx.shotKey}`) && !shot.endsWith(ctx.shotKey)) {
    return `cites shot "${shot}", which is not the shot of this run it was shown (${ctx.shotKey})`;
  }
  if (String(f.observed ?? '').trim().length < 12) return 'says nothing it observed';
  if (String(f.convention ?? '').trim().length < 12) return 'does not say what the rule says';
  if (!SEVERITIES.has(String(f.severity))) return `severity "${f.severity}" is not blocking|should|nit`;
  return null;
}

const STOP = new Set(['the', 'and', 'for', 'that', 'this', 'with', 'from', 'are', 'its', 'not', 'but', 'has', 'have', 'into', 'than', 'then', 'there', 'their', 'what', 'which', 'when', 'where', 'while', 'does', 'is', 'of', 'to', 'in', 'on', 'at', 'a', 'an', 'it', 'as', 'by', 'or', 'be', 'no', 'so', 'one', 'two', 'all', 'any', 'each', 'both', 'same', 'only', 'also', 'very', 'screen', 'shot', 'page', 'user', 'users', 'shows', 'show', 'shown']);

function tokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Two findings are the same observation when they cite the same rule and point at the same
 *  thing — the same element by name, or descriptions that share enough of their words. The
 *  threshold is deliberately loose: the cost of merging two distinct findings under one rule is a
 *  slightly broader card; the cost of failing to merge the same finding is that a 3/3 agreement
 *  reads as three 1/3 minorities and is thrown away. */
export function sameFinding(a: Finding, b: Finding): boolean {
  if (a.rule.toUpperCase() !== b.rule.toUpperCase()) return false;
  if (norm(a.element) && norm(a.element) === norm(b.element)) return true;
  const ta = tokens(`${a.element} ${a.observed}`), tb = tokens(`${b.element} ${b.observed}`);
  return jaccard(ta, tb) >= 0.3;
}

/** The majority gate. `admitted` carries every finding that passed the citation gate, tagged with
 *  the pass that produced it; `of` is how many passes returned an answer. A cluster is kept when
 *  more than half the passes saw it. */
export function majorityMerge(admitted: Admitted[], of: number): { merged: Merged[]; minority: Merged[] } {
  const clusters: { rep: Admitted; members: Admitted[] }[] = [];
  for (const f of admitted) {
    const hit = clusters.find((c) => c.members.some((m) => sameFinding(m, f)));
    if (hit) hit.members.push(f); else clusters.push({ rep: f, members: [f] });
  }
  const merged: Merged[] = [], minority: Merged[] = [];
  for (const c of clusters) {
    const runs = [...new Set(c.members.map((m) => m.run))].sort((x, y) => x - y);
    // the fullest description speaks for the cluster; the severity is the one most passes gave
    const rep = [...c.members].sort((x, y) => y.observed.length - x.observed.length)[0];
    const sev = (['blocking', 'should', 'nit'] as Severity[])
      .map((s) => ({ s, n: c.members.filter((m) => m.severity === s).length }))
      .sort((x, y) => y.n - x.n)[0].s;
    const out: Merged = { ...rep, severity: sev, runs, of };
    delete (out as Partial<Admitted>).run;
    (runs.length * 2 > of ? merged : minority).push(out);
  }
  const order: Record<Severity, number> = { blocking: 0, should: 1, nit: 2 };
  merged.sort((x, y) => order[x.severity] - order[y.severity] || y.runs.length - x.runs.length);
  return { merged, minority };
}
