import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { IDENTS, type Ident } from '../lib/idents';

interface IdentityCtx {
  ident: Ident;
  idents: Ident[];
  setIdentity: (id: string) => void;
}

const Ctx = createContext<IdentityCtx | null>(null);

export function IdentityProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState<string>(() => localStorage.getItem('noema-ident') || 'studio');
  const ident = IDENTS.find((d) => d.id === id) ?? IDENTS[0];

  // tier drives the accent shift via a class on <html> (the single trust signal)
  useEffect(() => {
    document.documentElement.classList.remove('tier-identified', 'tier-anon', 'tier-tee');
    document.documentElement.classList.add('tier-' + ident.tier);
    localStorage.setItem('noema-ident', ident.id);
  }, [ident.tier, ident.id]);

  return <Ctx.Provider value={{ ident, idents: IDENTS, setIdentity: setId }}>{children}</Ctx.Provider>;
}

export function useIdentity() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useIdentity must be used within IdentityProvider');
  return v;
}
