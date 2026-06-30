// App-entry routing. The marketing Landing owns `/`; the working app (Chat front door)
// lives at `/app`. A first-time visitor is routed through the Welcome card (`/onboard`)
// once; after they pick how to start, we mark them onboarded and "Open app" goes straight in.
//
// There is no server auth yet — "onboarded" is a local flag, the lightest gate that makes
// the Landing → Welcome → app handoff feel right. TODO(backend: real session) when auth lands.

const ONBOARDED_KEY = 'noema-onboarded';

export const isOnboarded = (): boolean => {
  try { return localStorage.getItem(ONBOARDED_KEY) === '1'; } catch { return false; }
};

export const markOnboarded = (): void => {
  try { localStorage.setItem(ONBOARDED_KEY, '1'); } catch { /* ignore */ }
};

export const clearOnboarded = (): void => {
  try { localStorage.removeItem(ONBOARDED_KEY); } catch { /* ignore */ }
};

/** Where "Open app" should land: the app if they've been welcomed, else the Welcome card. */
export const entryPath = (): string => (isOnboarded() ? '/app' : '/onboard');
