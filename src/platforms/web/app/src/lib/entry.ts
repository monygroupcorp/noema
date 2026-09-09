// App-entry routing. The marketing Landing owns `/`; the working app (Chat front door)
// lives at `/app`. A first-time visitor is routed through the front door (`/onboard`)
// once; after they enter, "Open app" goes straight in.
//
// "Onboarded" is a local flag. It is not the only evidence of a returning visitor: a signed-in
// visitor on a browser whose flag was cleared still holds a login, and sending them back through
// the door to sign in to a session they already have is a step that decides nothing.

import { getAccounts } from './api';

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

/**
 * The front door, carrying the path to hand the visitor back to once their session is live.
 * Everywhere that turns someone away for want of an account uses this: the page they were on
 * is the page they wanted, and re-finding it after signing in is a step nobody should walk.
 * `/onboard` reads `next` back through `safeNext`, which drops anything not a same-origin path.
 */
export const doorPath = (next?: string | null): string =>
  next ? `/onboard?next=${encodeURIComponent(next)}` : '/onboard';

/** Where "Open app" should land: the app for anyone who has been through the door or holds a
 *  login, else the door itself. */
export const entryPath = (): string => {
  if (isOnboarded()) return '/app';
  try { return getAccounts().accounts.length > 0 ? '/app' : '/onboard'; } catch { return '/onboard'; }
};
