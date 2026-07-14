// The `/chat` seed conversation is a live demo of the two-signal provenance system
// (local/sealed generation vs. routed/left-noema text), shown on first load with no
// user action required. It must never be mistaken for real history, so it's marked
// (see Chat.tsx) and dismissible — persistently, same localStorage boolean-flag
// pattern as `entry.ts`'s onboarding flag (fails closed on any storage error).

const EXAMPLE_KEY = 'noema-chat-example-cleared';

export const isExampleCleared = (): boolean => {
  try { return localStorage.getItem(EXAMPLE_KEY) === '1'; } catch { return false; }
};

export const clearExample = (): void => {
  try { localStorage.setItem(EXAMPLE_KEY, '1'); } catch { /* ignore */ }
};
