// Module-level "unsaved work" guard. A plain module, not a React context: there is one app
// instance, the shell needs to read the flag from outside the screen that owns it, and a
// module is testable without a DOM (this app has no jsdom / @testing-library/react).
//
// Wired by TraitsGarden and TraitRules (the two screens that hold authored work behind an
// explicit Save button) and consumed by every in-app exit in the shell (Rail, Account) and
// on the two screens themselves. Worded consistently with the existing fire-path confirm so
// a user meets one phrasing for "you have unsaved trait changes", not two.

import { useEffect } from 'react';

export const LEAVE_MESSAGE = 'Unsaved trait changes will be lost. Leave anyway?';

let dirty = false;

export function setDirty(v: boolean): void {
  dirty = v;
}

export function isDirty(): boolean {
  return dirty;
}

export function confirmLeave(ask: (message: string) => boolean = window.confirm): boolean {
  if (!dirty) return true;
  return ask(LEAVE_MESSAGE);
}

export function guardedClick(e: { preventDefault(): void }): void {
  if (!confirmLeave()) e.preventDefault();
}

export function guardedNavigate(nav: (to: string) => void, to: string): void {
  if (confirmLeave()) nav(to);
}

// Publishes `dirty` into the module store, warns on tab close/reload while dirty, and resets
// the store on unmount (and whenever `dirty` goes false) so a screen that has left the page
// never leaves the rest of the app permanently guarded.
export function useDirtyGuard(dirty: boolean): void {
  useEffect(() => {
    setDirty(dirty);
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      setDirty(false);
    };
  }, [dirty]);
}
