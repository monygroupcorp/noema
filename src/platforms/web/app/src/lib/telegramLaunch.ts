// A page the bot opens as a Telegram Mini App (its Buy credits button, in a private chat) is
// handed the user's identity, signed by Telegram: `initData`, in the URL fragment as
// `tgWebAppData` (and on `window.Telegram.WebApp` when Telegram's script is loaded). The session
// layer posts it once to /v1/auth/telegram/webapp, which checks the signature and signs the visitor
// in as that Telegram account — so the bot's button lands them on Funding signed in, with no code
// to fetch and paste.
//
// The fragment never reaches a server, but it does sit in the address bar and the history, so it
// is read once and removed. The launch also marks this tab as come-from-Telegram, so a purchase
// made here is credited as the bot's.

const ALLOCUTIO_KEY = 'noema.allocutio';

export interface LaunchWindow {
  location: { pathname: string; search: string; hash: string };
  history: { state: unknown; replaceState(state: unknown, unused: string, url: string): void };
  sessionStorage?: Pick<Storage, 'getItem' | 'setItem'>;
  Telegram?: { WebApp?: { initData?: string } };
}

/** Read this page's Telegram launch, if it has one, and strip Telegram's params from the URL. */
export function takeTelegramLaunch(win: LaunchWindow): string | null {
  const fragment = new URLSearchParams(win.location.hash.replace(/^#/, ''));
  const telegramKeys = [...fragment.keys()].filter((k) => k.startsWith('tgWebApp'));
  const initData = win.Telegram?.WebApp?.initData || fragment.get('tgWebAppData') || null;
  if (telegramKeys.length) {
    for (const k of telegramKeys) fragment.delete(k);
    const rest = fragment.toString();
    win.history.replaceState(win.history.state, '', `${win.location.pathname}${win.location.search}${rest ? `#${rest}` : ''}`);
  }
  if (initData) {
    try { win.sessionStorage?.setItem(ALLOCUTIO_KEY, 'telegram'); } catch { /* storage blocked: the purchase goes untagged */ }
  }
  return initData;
}

/** The surface to credit a purchase from this tab to: 'telegram' after a bot launch, else none. */
export function purchaseAllocutio(storage?: Pick<Storage, 'getItem'>): 'telegram' | undefined {
  try {
    return storage?.getItem(ALLOCUTIO_KEY) === 'telegram' ? 'telegram' : undefined;
  } catch {
    return undefined;
  }
}

/** This tab's sessionStorage, or undefined where reading it throws (blocked site data). */
export function safeSessionStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}
