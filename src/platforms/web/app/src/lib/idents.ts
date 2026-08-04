// Identity + trust on TWO orthogonal axes — but they live at different LAYERS
// (see docs/plans/2026-06-19-frontend-pathways-braindump.md §5):
//
//   Funding   = the PROFILE (a continuous anima). named (doxxed: wallet/email/telegram/
//               discord/api-key) | bearer (a bursa-funded burner). Both build history + XP.
//   Execution = a SESSION MODE the same profile enters. rented | tee.
//
// Crucial correction: execution is NOT a property of the identity. A doxxed anima does not
// need a second account to use a private session — the *same* profile shifts into it, and
// the environment reflects that. Public and private execution are mutually exclusive within
// a window (a single session value enforces this). So `Ident` carries only the durable
// profile; session state (the execution mode) lives separately in state/identity.
// Latin stays out of the UI — these strings are already user-facing.

export type Funding = 'named' | 'bearer';
export type Execution = 'rented' | 'tee';

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
// privacy mini-indicator: [lucide icon name, label]
// IDENTITY_PRIV — "can noema see WHO you are?" (funding).
export const IDENTITY_PRIV: Record<Funding, [string, string]> = {
  named: ['eye', 'identified'],
  bearer: ['venetian-mask', 'anonymous'],
};
export const chipKind = (d: Pick<Ident, 'funding'>): 'named' | 'masked' =>
  d.funding === 'named' ? 'named' : 'masked';

// ── New-profile presets — funding only. Execution is chosen per session, not at creation. ──
export interface IdentPreset { id: string; ico: string; t: string; s: string; funding: Funding }
export const PRESETS: IdentPreset[] = [
  { id: 'identified', ico: 'user-round', t: 'Identified', funding: 'named',
    s: 'Sign in with a wallet, email, Telegram, Discord, or API key. A continuous profile — your history, your galaxy, your XP.' },
  { id: 'anonymous', ico: 'venetian-mask', t: 'Anonymous', funding: 'bearer',
    s: 'A bearer purse from an arcanum bursa. Continuous history and XP, linked to no wallet, email, or name.' },
];
