# Cookie Policy — DRAFT
**Last updated:** 2026-08-26
**Status:** DRAFT. Requires review before publication.

---

## The short version

We set one cookie, and only if you contribute to the trusted-setup ceremony. Everything else the app remembers is kept in your own browser's `localStorage` — it is not a cookie, and it is not sent to us except where noted. We have no advertising cookies, no analytics cookies, and no third-party tracking of any kind.

---

## The cookie

| Name | Type | Purpose | Properties |
|---|---|---|---|
| `noema-cer-sid` | Strictly necessary | Holds one contribution slot per session in the trusted-setup ceremony, so a page refresh cannot inflate the transcript | httpOnly, SameSite=Lax, scoped to the `/v1/ceremony` path, 30 days |

It is a random id with a signature attached, which is what stops someone presenting a made-up value as another contributor's slot. It carries no account data, no name, and no email. It is set on your first ceremony contribution attempt and never before.

## Browser storage (not cookies)

The rest of what the app remembers lives in your browser's `localStorage`. It stays on your device. Your sign-in token is sent to us on each API call, because that is what authenticates you; the preference keys are read by the app in your browser and are not transmitted.

| Key | What it holds |
|---|---|
| `noema-sessions` | Your saved logins — for each one, the account id, the session token, and the username. This is the sign-in credential. |
| `noema-session`, `noema-session-username` | The earlier single-login form of the above, read once and migrated. |
| `noema-vault` | Your anonymous credit: notes and minted purse tokens, including their private secrets. **These are bearer secrets. They never leave your browser, and if you lose this storage the credit is gone with it** — export a backup from the Vault screen. |
| `noema-active-purse` | Which purse token a run should spend from. |
| `noema-commitment` | A random per-browser id used to identify an anonymous caller when quoting a price. It is not linked to an account. |
| `noema-tee` | The browser-side keypair for a private-compute session. The private key never leaves your browser. |
| `noema-projects`, `noema-project` and their per-account forms (`noema-<account>-projects`, `noema-<account>-project`) | Your project list and which project is open. |
| `noema-exec`, `noema-<account>-exec` | Your execution-mode preference — whose hardware a run should go to. |
| `noema-availability` | Your availability preference from Account Settings. |
| `noema-pins` | The flows you pinned to the rail. |
| `noema-onboarded` | Whether you have completed onboarding. |
| `noema-chat-example-cleared` | Whether you dismissed the example prompt in chat. |

## What we do not use

- Analytics cookies (no Google Analytics, no Mixpanel, no similar)
- Advertising or targeting cookies
- Social media tracking pixels
- Third-party cookies of any kind

## Why so few

Third-party analytics would create tracking vectors that contradict the privacy commitment in our [Privacy Policy](/legal/privacy). We chose not to use them, and the service does not need a cookie to know who you are — the sign-in token in your own storage does that.

## Your choices

There is no cookie preference manager, because there is nothing to manage: the one cookie is strictly necessary for the ceremony feature and is set only if you use it.

You can clear cookies and site data at any time through your browser settings. Clearing site data logs you out — and it **destroys any anonymous credit held in `noema-vault`**, which cannot be recovered. Export your Vault first.

## Contact

Questions about cookies: [PRIVACY EMAIL]
