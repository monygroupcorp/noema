import { describe, expect, it } from 'vitest';
import { takeTelegramLaunch, purchaseAllocutio, type LaunchWindow } from './telegramLaunch';

const INIT_DATA = 'auth_date=1763380800&query_id=AAH&user=%7B%22id%22%3A42%7D&hash=' + 'ab'.repeat(32);

function fakeWindow(hash: string, over: Partial<LaunchWindow> = {}) {
  const urls: string[] = [];
  const store = new Map<string, string>();
  const win: LaunchWindow = {
    location: { pathname: '/funding', search: '?pack=starter_10', hash },
    history: { state: { k: 1 }, replaceState: (_s, _u, url) => { urls.push(url); } },
    sessionStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => { store.set(k, v); } },
    ...over,
  };
  return { win, urls, store };
}

describe('takeTelegramLaunch', () => {
  it('reads the signed launch from the fragment Telegram opens the page with', () => {
    const hash = `#tgWebAppData=${encodeURIComponent(INIT_DATA)}&tgWebAppVersion=8.0&tgWebAppPlatform=ios`;
    const { win } = fakeWindow(hash);
    expect(takeTelegramLaunch(win)).toBe(INIT_DATA);
  });

  it('strips every Telegram param from the address bar, keeping the path, query and any other fragment', () => {
    const { win, urls } = fakeWindow(`#tgWebAppData=${encodeURIComponent(INIT_DATA)}&tgWebAppVersion=8.0&section=cards`);
    takeTelegramLaunch(win);
    expect(urls).toEqual(['/funding?pack=starter_10#section=cards']);
    expect(urls[0]).not.toContain('tgWebApp');
  });

  it('prefers Telegram’s own script when it is loaded', () => {
    const { win } = fakeWindow('', { Telegram: { WebApp: { initData: INIT_DATA } } });
    expect(takeTelegramLaunch(win)).toBe(INIT_DATA);
  });

  it('is null, and touches nothing, on an ordinary visit', () => {
    const { win, urls, store } = fakeWindow('#section=cards');
    expect(takeTelegramLaunch(win)).toBeNull();
    expect(urls).toEqual([]);
    expect(store.size).toBe(0);
  });

  it('marks the tab so a purchase from it is credited to the bot', () => {
    const { win } = fakeWindow(`#tgWebAppData=${encodeURIComponent(INIT_DATA)}`);
    expect(purchaseAllocutio(win.sessionStorage as Storage)).toBeUndefined();
    takeTelegramLaunch(win);
    expect(purchaseAllocutio(win.sessionStorage as Storage)).toBe('telegram');
  });

  it('survives blocked storage', () => {
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    const { win } = fakeWindow(`#tgWebAppData=${encodeURIComponent(INIT_DATA)}`, { sessionStorage: blocked });
    expect(takeTelegramLaunch(win)).toBe(INIT_DATA);
    expect(purchaseAllocutio(blocked)).toBeUndefined();
  });
});
