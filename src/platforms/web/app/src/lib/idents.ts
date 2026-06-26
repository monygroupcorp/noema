// Identity + trust on TWO orthogonal axes — but they live at different LAYERS
// (see docs/plans/2026-06-19-frontend-pathways-braindump.md §5):
//
//   Funding   = the PROFILE (a continuous anima). named (doxxed: wallet/email/telegram/
//               discord/api-key) | bearer (a bursa-funded burner). Both build history + XP.
//   Execution = a SESSION MODE the same profile enters. rented | tee | local.
//
// Crucial correction: execution is NOT a property of the identity. A doxxed anima does not
// need a second account to use TEE — the *same* profile shifts into a sealed (or local)
// session, and the environment reflects that. Public and private execution are mutually
// exclusive within a window (a single session value enforces this). So `Ident` carries only
// the durable profile; everything execution-dependent (redaction, what we can see, the
// composer hint) is DERIVED from (profile.funding × session.execution).
// Latin stays out of the UI — these strings are already user-facing.

export type Funding = 'named' | 'bearer';
export type Execution = 'rented' | 'tee' | 'local';

export interface RedactRow { k: string; v: string; block?: boolean }

// The durable profile. No execution here — that's session state.
export interface Ident {
  id: string;
  name: string;
  role: string;
  funding: Funding;
  chipColor?: string;   // named funding only — the letter-avatar tint
  glyph: string;        // letter for named profiles
  bal: string;
  exp: string;          // lifetime points spent on compute (a quasi-vanity metric)
}

// ── Static labels & per-axis privacy indicators ───────────────────────────────
export const FUNDING_LABEL: Record<Funding, string> = { named: 'identified', bearer: 'anonymous' };
export const EXECUTION_LABEL: Record<Execution, string> = {
  rented: 'shared compute', tee: 'private tunnel', local: 'your machine',
};
// privacy mini-indicator: [lucide icon name, label]
// IDENTITY_PRIV — "can noema see WHO you are?" (funding).  WORK_PRIV — "…WHAT you make?" (execution).
export const IDENTITY_PRIV: Record<Funding, [string, string]> = {
  named: ['eye', 'identified'],
  bearer: ['venetian-mask', 'anonymous'],
};
export const WORK_PRIV: Record<Execution, [string, string]> = {
  rented: ['server', 'on our compute'],
  tee: ['eye-off', 'sealed · meter only'],
  local: ['laptop', 'on your machine'],
};
// short labels for the execution-mode switcher (the exclusive Shared/Sealed/Local toggle)
export const EXECUTION_SHORT: Record<Execution, string> = { rented: 'Shared', tee: 'Sealed', local: 'Local' };
export const EXECUTIONS: Execution[] = ['rented', 'tee', 'local'];

export const isPrivateExec = (e: Execution): boolean => e !== 'rented';
export const chipKind = (d: Pick<Ident, 'funding'>): 'named' | 'masked' =>
  d.funding === 'named' ? 'named' : 'masked';

// ── Derivation from (profile × session execution) ─────────────────────────────

// What noema can / can't see, given who you are and where it runs.
export function canSee(funding: Funding, execution: Execution): { can: string[]; cant: string[] } {
  const can: string[] = [];
  const cant: string[] = [];
  if (funding === 'named') can.push('identity'); else cant.push('identity');
  if (execution === 'rented') can.push('prompts', 'outputs');
  else cant.push('prompts', 'outputs');
  if (execution === 'tee') can.push('the meter');       // sealed: we still bill, never read
  // local: nothing of the work reaches us at all — not even a meter (no charge)
  return { can, cant };
}

// The "what actually reaches us" redaction table.
export function redactionFor(ident: Ident, execution: Execution): RedactRow[] {
  const priv = isPrivateExec(execution);
  return [
    ident.funding === 'named'
      ? { k: 'who', v: `${ident.name} · ${ident.role}` }
      : { k: 'who', v: '▮▮▮▮▮▮', block: true },
    priv ? { k: 'prompt', v: '▮▮▮▮▮▮▮▮▮▮', block: true } : { k: 'prompt', v: '“…neon temple, dusk”' },
    priv ? { k: 'output', v: '▮▮▮▮▮▮', block: true } : { k: 'output', v: 'flux-schnell.png' },
    { k: 'cost', v: execution === 'local' ? 'on your GPU · no charge' : '$0.043 · 12 GPU-min' },
  ];
}

// Composer destination hint (may contain <b>…</b>).
export function destFor(ident: Ident, execution: Execution): string {
  const who = ident.funding === 'named' ? `as <b>${ident.name}</b>` : '<b>anonymously</b>';
  if (execution === 'rented') {
    return ident.funding === 'named' ? `posting ${who}` : 'posting <b>anonymously</b> — no identity attached';
  }
  const where = execution === 'tee'
    ? '<b>sealed</b> to your private tunnel — we can’t read this'
    : 'running <b>on your machine</b> — nothing leaves the device';
  return `${who} — ${where}`;
}

// ── New-profile presets — funding only. Execution is chosen per session, not at creation. ──
export interface IdentPreset { id: string; ico: string; t: string; s: string; funding: Funding }
export const PRESETS: IdentPreset[] = [
  { id: 'identified', ico: 'user-round', t: 'Identified', funding: 'named',
    s: 'Sign in with a wallet, email, Telegram, Discord, or API key. A continuous profile — your history, your galaxy, your XP.' },
  { id: 'anonymous', ico: 'venetian-mask', t: 'Anonymous', funding: 'bearer',
    s: 'A bearer purse from an arcanum bursa. Continuous history and XP, linked to no wallet, email, or name.' },
];

// ── The profiles (continuous animas), distinguished only by funding ───────────
export const IDENTS: Ident[] = [
  {
    id: 'studio', name: 'studio', role: 'monyrth', funding: 'named',
    chipColor: '#cdd2ff', glyph: 'S', bal: '214 credits', exp: '4,820 xp',
  },
  {
    id: 'untitled', name: 'untitled', role: 'bearer purse', funding: 'bearer',
    glyph: '◷', bal: 'purse · 38 credits', exp: '610 xp',
  },
];
