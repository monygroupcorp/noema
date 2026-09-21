import { Ic } from '../lib/icons';
import { useCheckoutReturn } from '../lib/checkoutReturn';

// What happened to the money, said on the page the buyer came back to. Stripe used to return
// everyone to the Funding screen, which owned these four sentences; now the buyer lands where
// they left off and the shell says it there, under the top bar, above whatever they were doing.

const fmt = (n: number) => n.toLocaleString('en-US');

export function CheckoutReturn() {
  const { outcome, credited, dismiss } = useCheckoutReturn();
  if (outcome === 'none') return null;

  const tone = outcome === 'timeout' ? 'alert' : 'note';
  return (
    <div className={`ckret ${tone}`} role="status">
      <span className="ckret-ic">
        <Ic name={outcome === 'settled' ? 'check' : outcome === 'timeout' ? 'triangle-alert' : 'credit-card'} />
      </span>
      <span className="ckret-say">
        {outcome === 'polling' && <>Payment received — waiting for the credit to land…</>}
        {outcome === 'settled' && (
          <>Credited{credited != null && credited > 0 ? <> — <b>◈ +{fmt(credited)} cr</b></> : null}. Your balance is updated.</>
        )}
        {outcome === 'cancelled' && <>Checkout cancelled — nothing was charged.</>}
        {outcome === 'timeout' && (
          <>
            Stripe sent you back as paid, but the credit has not landed yet. It is credited by a
            webhook, so it can arrive after this page stops watching — reload in a few minutes.
            If it is still missing, send us the Stripe receipt and we will place it by hand.
          </>
        )}
      </span>
      {outcome !== 'polling' && (
        <button className="ckret-x" onClick={dismiss} aria-label="Dismiss">
          <Ic name="x" />
        </button>
      )}
    </div>
  );
}
