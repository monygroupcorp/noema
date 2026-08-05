# Spec — deposit crediting must read the auth rail's wallet seam (P0 revenue bug)

**Date:** 2026-07-10 · **For:** a repo-context agent on `noema-crystal` · **Status:** spec, not started
**Severity: P0** — real money observed stuck on staging (2026-07-10 19:01 UTC, tx
`0x832a0016ff98…`, 0.00027 ETH mainnet, parked `confirmatum`, never credited). Two June
deposits (`0x8027f1be…`, `0xf125445b…`) in the identical state — the path has NEVER credited
on the new rail.

## Root cause (verified against live noemaplane)
Two identity seams for "which account owns wallet X":
- **Webhook (reader):** `handlePaymentLog` → `deps.animae.findByCustos(payer)`
  (`src/api/webhooks/alchemyWebhook.ts:342`; also `:483` for NFT path) →
  `MongoAnima.findByCustos` queries `animae.custos` (`src/crystal/MongoAnima.ts:28`).
- **Auth rail (writer):** `POST /v1/auth/wallet/link` binds the proven wallet as a
  **Persona row** — `personae` collection, `genus:'web'`, `externusId:<address>`
  (`src/allocutio/api/authRouter.ts:160`). Nothing ever writes `animae.custos` for users.

Result: deposit lands → priced → revenue booked → `findByCustos` misses → deposit parked
`confirmatum` with **no warning log and no user-visible state**. Webhook still answers
`processed:1`.

## Fix
1. **One resolver, the Persona seam.** Deposit attribution resolves payer →
   `personae.findOne({ genus:'web', externusId: payerLowercase, status:'active' })` →
   `activeAnimaId`. Wrap as a small injectable (`resolveWalletAnima`) used by BOTH
   `handlePaymentLog` and the NFT path (`:483`). Decide `animae.custos`'s fate explicitly:
   if anything else still writes/reads it (grep `custos` — `accruePayeePayout.ts:52` also
   uses `findByCustos`), keep it as fallback (`persona ?? custos`), else delete the dead seam.
   Crystal-first: do NOT add a third seam.
2. **Never silent.** Unattributed deposit → `log.warn('deposit confirmed but unattributed —
   no account linked to payer wallet', { payer, txHash, valor })`. Parked `confirmatum` stays
   retryable (idempotency skips only `processatum` — correct today, keep).
3. **Retry without Alchemy dashboard.** Small internal sweep or admin endpoint: re-run
   crediting for `confirmatum` deposita (they're already priced + revenue-booked — make
   `bookRevenue` idempotent on depositumId, which the comment claims it is; verify).
   This also heals the three stuck staging deposits once wallets are linked.
4. **Frontend guardrail (BuyCreditsModal + Funding):** before/while showing the deposit
   address, compare the connected wallet against `api.auth.listWallets()`:
   - linked → proceed;
   - signed-in but wallet unlinked → inline "link this wallet first" step (the challenge/sign
     flow already exists on Profile — reuse, one click);
   - anon → say plainly the deposit can't reach an account until this wallet is linked to one.
   The settle-watch UI should also poll something real: add deposit status to `/v1/me/status`
   or a `GET /v1/deposit/mine` (by linked wallets) so "waiting to settle" reflects the actual
   depositum status (`confirmatum`/`processatum`) instead of hoping.
5. **Tests:** hermetic webhook test with a Persona-linked payer (credits), unlinked payer
   (parks + warns), re-delivery after linking (credits exactly once). NFT path same matrix.

## Acceptance
- Deposit from a linked wallet credits impetus within one webhook delivery; `/v1/me/status`
  balance moves; depositum `processatum` with `signumId`.
- Deposit from an unlinked wallet: loud warn, parked, UI told the user beforehand; linking +
  retry credits it exactly once (no double via revenue book or signum).
- The three stuck staging deposita heal via the retry path.
- Hermetic + docs-drift green (if any route shape changed).

## Also observed same session (fold in or split as a micro-spec)
`express-rate-limit` throws `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` on every rate-limited route
behind caddy — Express `trust proxy` is false, so limiter keys are useless behind the proxy.
Set `app.set('trust proxy', 1)` (or configure the limiter's keyGenerator) in `src/index.ts`.
