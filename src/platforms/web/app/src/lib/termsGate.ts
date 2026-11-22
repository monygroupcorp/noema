// termsGate — the hand-off between a refused run and the dialog that takes the acceptance.
//
// A flow under upstream licence terms (MiniMax H3) is refused by the server with
// `terms.required` until the caller accepts them. Six screens start runs, so the acceptance is
// not asked for in each: `api.createRun` catches the refusal and asks here, the one mounted
// <TermsGate/> shows the terms and answers, and an accepted run is sent again. With no dialog
// mounted there is nobody to ask, and the refusal reaches the screen unchanged.

/** What the server's `terms.required` refusal carries in `details`. */
export interface TermsRequest {
  terms: string;
  versio: string;
  nomen: string;
  href: string;
  licenseHref: string;
}

type Asker = (req: TermsRequest) => Promise<boolean>;
let asker: Asker | null = null;

/** Register the dialog that answers. Returns the unregister function. */
export function setTermsAsker(fn: Asker): () => void {
  asker = fn;
  return () => { if (asker === fn) asker = null; };
}

/** Ask the mounted dialog; false when none is mounted or the user declines. */
export function askTerms(req: TermsRequest): Promise<boolean> {
  return asker ? asker(req) : Promise.resolve(false);
}

/** The refusal's details as a TermsRequest, or null when they do not have that shape. */
export function termsRequestOf(details: Record<string, unknown> | undefined): TermsRequest | null {
  if (!details) return null;
  const { terms, versio, nomen, href, licenseHref } = details;
  if ([terms, versio, nomen, href, licenseHref].every((v) => typeof v === 'string' && v !== '')) {
    return { terms, versio, nomen, href, licenseHref } as TermsRequest;
  }
  return null;
}
