import type { SecretProvider } from './secrets';
import { j } from './core';
import { authHeaders, readHeaders } from './session';

// Account settings (mirror the backend Consuetudo shapes).
export interface Appearance { avatarUrl?: string; bannerUrl?: string; backgroundUrl?: string; accent?: string; look?: string }
export interface Generatio {
  style?: string;
  negativePrompt?: string;
  outputFormat?: string;
  telegramDeliverAs?: 'album' | 'individual';
  autoApplyModels?: string[];
  defaultProjectId?: string;
  // Adult ("spicy") mode (noema-091). When ON — and an 18+ attestation is on file — permits
  // adult-rated models, routes concierge chat to willing OpenRouter models, relaxes SFW default
  // negatives. Default-absent = OFF. Enabling requires a recorded attestation (see recordAttestation).
  spicyMode?: boolean;
  // One-time self-declared 18+ attestation (a click-through fact, NOT KYC). Required on file before
  // spicyMode may be enabled. Recorded via POST /v1/me/attestation.
  ageAttestation?: { attestedAt: number };
  /** Licence terms accepted, by terms id — written by the server only (POST /v1/me/terms/:id). */
  termsAccepted?: Record<string, { versio: string; acceptedAt: number }>;
  // Private generation (noema-347). When ON, the outputs of NEW runs are visible only to you, via
  // expiring links; default-absent = OFF. Forward-only — it never moves what already exists.
  privateOutputs?: boolean;
  // Short lines the concierge remembers about you between threads (the author ladder). Written
  // by THIS client at the end of a turn the agent proposed a delta on; listed and editable on
  // Preferences; capped server-side at MEMORY_NOTES_MAX lines; deleted with the account.
  memoryNotes?: string[];
}

export interface MeView {
  appearance?: Appearance;
  generatio?: Generatio;
  bindings: Array<{ verb: string; modusId: string }>;
  // Per-provider connect state. Absent (undefined) or all-'absent' when the store is
  // unconfigured server-side — never carries the token itself.
  secrets?: Record<SecretProvider, 'connected' | 'absent'>;
  // Whether this deployment can store BYO secrets at all. false → connecting is unavailable
  // here (SECRETA_MASTER_KEY unset); hide/disable the panel proactively. Older servers omit it
  // (undefined) → treat as available and fall back to the reactive SecretsUnavailableError path.
  secretsAvailable?: boolean;
  // Whether this caller is the platform administrator (the moderation reviewer). Gates the
  // feed-review surface + its approve/reject controls. Server-authoritative; `true` only on
  // the platform session. Older servers omit it (undefined) → treated as not-admin.
  admin?: boolean;
}

const accountApi = {
  // ── Account settings (Consuetudinum, owner-keyed / anon-capable) ─────────────
  // GET /v1/me — appearance (Profile) + generation defaults (Preferences) + bindings.
  getMe: () => fetch('/v1/me', { headers: readHeaders() }).then(j<MeView>),
  setAppearance: (appearance: Appearance) =>
    fetch('/v1/me/appearance', { method: 'PUT', headers: authHeaders(), body: JSON.stringify(appearance) }).then(j<{ appearance: Appearance }>),
  setGeneratio: (generatio: Generatio) =>
    fetch('/v1/me/generatio', { method: 'PUT', headers: authHeaders(), body: JSON.stringify(generatio) }).then(j<{ generatio: Generatio }>),
  // POST /v1/me/attestation — record the one-time 18+ self-attestation (a click-through fact, not
  // KYC). Required on file before spicyMode may be enabled. Anon-capable.
  recordAttestation: () =>
    fetch('/v1/me/attestation', { method: 'POST', headers: authHeaders() }).then(j<{ attestation: { attestedAt: number } }>),
  // PUT /v1/me/bindings/:verb — rebind a canon verb (e.g. `make`) to a chosen flow. Auth
  // required (bearer purses can't rebind). Powers the Preferences default-flow picker.
  setBinding: (verb: string, modusId: string) =>
    fetch(`/v1/me/bindings/${encodeURIComponent(verb)}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ modusId }) }).then(j<{ verb: string; modusId: string }>),
  getAffines: (modusId: string) =>
    fetch(`/v1/me/affines/${encodeURIComponent(modusId)}`, { headers: readHeaders() }).then(j<{ affines: Record<string, unknown> }>),
  setAffines: (modusId: string, affines: Record<string, unknown>) =>
    fetch(`/v1/me/affines/${encodeURIComponent(modusId)}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ affines }) }).then(j<{ affines: Record<string, unknown> }>),
};

export default accountApi;
