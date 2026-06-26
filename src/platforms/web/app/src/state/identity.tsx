import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { IDENTS, type Ident, type Execution } from '../lib/idents';

interface IdentityCtx {
  ident: Ident;                          // the durable profile (anima)
  idents: Ident[];
  setIdentity: (id: string) => void;
  execution: Execution;                  // the session's execution mode — same profile, different locus
  setExecution: (e: Execution) => void;  // exclusive by construction (a single value per window)
}

const Ctx = createContext<IdentityCtx | null>(null);

export function IdentityProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState<string>(() => localStorage.getItem('noema-ident') || 'studio');
  const [execution, setExecution] = useState<Execution>(
    () => (localStorage.getItem('noema-exec') as Execution) || 'rented',
  );
  const ident = IDENTS.find((d) => d.id === id) ?? IDENTS[0];

  // The two trust axes tag <html>, but from different layers: funding from the profile,
  // execution from the session. CSS shifts the accent off them (anonymous funding steps
  // back; private execution steps back further). Switching the session mode re-skins the
  // whole window — the "environment shifts to reflect TEE" the same profile entered.
  useEffect(() => {
    const el = document.documentElement;
    el.classList.remove('fund-named', 'fund-bearer', 'exec-rented', 'exec-tee', 'exec-local');
    el.classList.add('fund-' + ident.funding, 'exec-' + execution);
    localStorage.setItem('noema-ident', ident.id);
    localStorage.setItem('noema-exec', execution);
  }, [ident.funding, ident.id, execution]);

  return (
    <Ctx.Provider value={{ ident, idents: IDENTS, setIdentity: setId, execution, setExecution }}>
      {children}
    </Ctx.Provider>
  );
}

export function useIdentity() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useIdentity must be used within IdentityProvider');
  return v;
}
