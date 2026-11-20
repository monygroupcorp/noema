import { authHeaders } from './session';

// Thrown when the BYO-secret store isn't configured server-side (SECRETA_MASTER_KEY unset).
// The backend answers the connect/disconnect endpoints with an "not available on this
// deployment" internal error; the UI treats this as "unavailable", not a real failure.
export class SecretsUnavailableError extends Error {}
async function jSecret(res: Response): Promise<SecretView> {
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    if (/not available on this deployment/i.test(text)) throw new SecretsUnavailableError('BYO secrets are unavailable here');
    throw new Error(`${res.status} ${text}`);
  }
  return res.json() as Promise<SecretView>;
}

// BYO gated-origin credential providers (mirror the server `SecretProvider` union).
export type SecretProvider = 'civitai' | 'huggingface';
export const SECRET_PROVIDERS: SecretProvider[] = ['civitai', 'huggingface'];
export const SECRET_PROVIDER_LABEL: Record<SecretProvider, string> = { civitai: 'Civitai', huggingface: 'HuggingFace' };

// Result of connecting/disconnecting a BYO secret (`PUT/DELETE /v1/me/secrets/:provider`).
// The token is NEVER included. `warning` is present only for anonymous (purse) callers.
export interface SecretView {
  provider: SecretProvider;
  status: 'connected' | 'absent';
  expiresAt?: string;
  warning?: string;
}

const secretsApi = {
  // ── BYO gated-origin secrets (Secretarium, owner-keyed / anon-capable) ───────
  // Connect a Civitai/HuggingFace token so gated imports scrape + download. The token
  // is sealed server-side and NEVER echoed back — presence-only (`getMe().secrets`).
  // Anon callers get a `warning` on connect (linking a named account deanonymizes them).
  putSecret: (provider: string, token: string, idleDays?: number) =>
    fetch(`/v1/me/secrets/${provider}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ token, idleDays }) }).then(jSecret),
  removeSecret: (provider: string) =>
    fetch(`/v1/me/secrets/${provider}`, { method: 'DELETE', headers: authHeaders() }).then(jSecret),
};

export default secretsApi;
