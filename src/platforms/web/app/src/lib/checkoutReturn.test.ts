import { describe, expect, it } from 'vitest';
import { readCheckoutFlag, stripCheckoutFlag } from './checkoutReturn';

// The return from Stripe now lands on whatever page the buyer left, so reading and clearing the
// outcome flag has to leave that page's own URL intact. The funding page could clear the whole
// query because its query meant nothing on return; a task page's query IS the task.

describe('readCheckoutFlag', () => {
  it('reads the two outcomes Stripe can redirect back with', () => {
    expect(readCheckoutFlag('?checkout=success')).toBe('success');
    expect(readCheckoutFlag('?checkout=cancel')).toBe('cancel');
  });

  it('says nothing happened on an ordinary page load', () => {
    expect(readCheckoutFlag('')).toBe(null);
    expect(readCheckoutFlag('?doc=17')).toBe(null);
  });

  it('refuses a value that is not an outcome, rather than announcing an unknown one', () => {
    expect(readCheckoutFlag('?checkout=paid')).toBe(null);
    expect(readCheckoutFlag('?checkout=')).toBe(null);
  });
});

describe('stripCheckoutFlag', () => {
  it('drops the flag so a refresh neither re-polls nor re-announces an old return', () => {
    expect(stripCheckoutFlag('https://noema.example/app?checkout=success')).toBe('/app');
  });

  it('keeps the rest of the query — that is what identifies the task the buyer broke off', () => {
    expect(stripCheckoutFlag('https://noema.example/canvas?doc=17&checkout=success'))
      .toBe('/canvas?doc=17');
    expect(stripCheckoutFlag('https://noema.example/canvas?checkout=cancel&doc=17'))
      .toBe('/canvas?doc=17');
  });

  it('keeps a fragment, which addresses a place within the page', () => {
    expect(stripCheckoutFlag('https://noema.example/space?checkout=success#run-9'))
      .toBe('/space#run-9');
  });

  it('leaves a URL that carries no flag exactly as it was', () => {
    expect(stripCheckoutFlag('https://noema.example/canvas?doc=17')).toBe('/canvas?doc=17');
  });
});
