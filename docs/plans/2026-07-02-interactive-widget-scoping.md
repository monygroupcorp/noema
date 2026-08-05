# Interactive widget — scoping (the deferred half of ADR-0011 §7)

**Status:** scoping only (not built). Written 2026-07-02 after Phase 6 shipped the
read-only embed surface (`ad2c274f`) and the collection-scoped gallery.

## The gap, stated plainly

Phase 6 delivered what ADR §7 scoped: a chrome-less, themed **view** (feed + appearance
+ CSP framing) served at `/widget/:agentId` and `/widget/gallery/:addr`, driven by the
preserved `window.StationThis` SDK. The deployed camel404 client loads, the iframe mounts,
`WIDGET_READY` fires, the 404 is re-lit.

What it does **not** do: let an embedded user **run or pay for the agent**. The legacy
widget was interactive — sign in with a wallet, cast a spell, pay per call via x402, see
results *inside the iframe*. That interactive loop is the "white-label on-chain-payable
agent" premise. Today the iframe is a read-only gallery of the agent's past outputs.

This matches ADR §7's deliberate scoping (it pointed interaction at the §5 x402 API rather
than porting the legacy in-iframe casting UI), but relative to the live product it is a
functional downgrade. Closing it is a real sub-project — hence this doc.

## What's already built (the pieces to connect)

- **The SDK bridge is intact and dormant.** `widgetSdk.ts` still speaks the full legacy
  protocol: on an iframe `WALLET_AUTH_REQUEST` it runs the wallet challenge/verify flow; on
  `PAYMENT_REQUIRED` it runs the EIP-3009 x402 sign flow; it relays `SESSION_READY` back
  into the iframe. Our chrome-less iframe simply never posts those message types, so the
  flows lie idle.
- **The §5 x402 REST API exists** (`x402AgentRouter`, `/api/v1/x402/agents/:id/spell/:name`):
  discover → 402 → verify → run → settle → owner rev-share, with a real CDP facilitator
  wired (`833e4560`). This is the payment+run engine.
- **Auth acceptors exist** for identified/anon/bursa/federated callers (`IdentityResolver`),
  and runs already dispatch through `CrystalApi.invokeFlow`.

## The core mismatch to resolve

The SDK's payment/auth bridge calls **legacy widget-session endpoints** the crystal router
does not serve:

| SDK calls (legacy shape)                          | Crystal has (§5 shape)                                   |
|---------------------------------------------------|----------------------------------------------------------|
| `POST /widget/:agentId/session/x402` → 402 + pay  | `POST /api/v1/x402/agents/:id/spell/:name` → 402 + run    |
| `POST /widget/:agentId/auth/wallet/nonce`+`/verify` → session JWT | (no per-agent wallet-session issuance)   |
| iframe renders the run result itself              | REST returns the run JSON to the caller                  |

The legacy model issues a **session JWT** (owner/user tier) the iframe then uses to cast
spells repeatedly. The §5 model is **stateless pay-per-call** — one payment, one run, no
session. These are different interaction economies; picking one is the central decision.

## Two designs

### Design A — shim the legacy widget-session endpoints over crystal (higher parity)
Serve `/widget/:agentId/session/x402`, `/auth/wallet/nonce|verify`, `/auth/redeem`,
`/spells/:slug/cast`, `/casts/:id` in the widget router, backed by crystal:
- **wallet sign-in** → issue a short-lived crystal session token for `{ animaId }` (owner)
  or a user-tier `{ commitment }`; reuse the EIP-712 challenge shape the SDK already signs.
- **x402 session** → adapt to the §5 verify→(prepaid mint)→settle machinery, but bind the
  resulting credit to a session instead of a single call.
- **cast** → `CrystalApi.invokeFlow` on the agent's `workspaceModusId`; stream status; the
  iframe renders results (rebuild the minimal cast UI — spell list + inputs + output tiles).
- **Pros:** the deployed SDK works unchanged; true product parity (repeat casts per session).
- **Cons:** most work — reintroduces a session-token notion + an in-iframe cast UI; two
  payment economies to reconcile (session credit vs pay-per-call).

### Design B — make the iframe a thin §5 client (lower surface, new economy)
Keep the stateless §5 model. The iframe gets a small interactive layer that, per action:
discovers the spell, shows the quote, asks the SDK to pay (`PAYMENT_REQUIRED`), and on
`SESSION_READY`/settlement calls the §5 run and renders the result.
- **Pros:** no session-token machinery; reuses §5 as-is; smallest new surface.
- **Cons:** the SDK's payment bridge still targets `/widget/:agentId/session/x402`, so either
  (a) adapt the SDK (it's the deployed contract — a client redeploy, or a compat shim route
  that translates to §5), or (b) add one translating route. Pay-per-call UX (sign every run)
  differs from the legacy session UX.

## Open decisions (need a call before building)
1. **Economy:** session-credit (A) vs pay-per-call (B). Drives everything else.
2. **Auth tiers in the embed:** owner-only, or also user-tier (wallet sign-in) and anon
   (bursa/commitment)? The legacy issued owner *and* user JWTs.
3. **Redeploy budget:** can we adapt the deployed camel404 SDK, or must crystal serve the
   exact legacy `/widget/:agentId/session/*` paths (favoring Design A / a shim)?
4. **In-iframe cast UI scope:** full spell list + inputs (legacy), or a single default spell
   the agent's `workspaceModusId` exposes?

## Recommendation
Start with **Design A's wallet sign-in + a single-spell cast** (owner + user tier), backed
by `invokeFlow` on `workspaceModusId`, and fold x402 in as the anonymous/pay path second.
It preserves the deployed SDK (no client redeploy), and "sign in → run your agent → see the
result" is the minimum that makes the embed *the product* rather than a gallery. Defer the
full multi-spell casting UI and session-credit accounting until that loop is proven live.

## Non-goals (explicitly out)
Buy-points modal, delegation codes, gallery pin/hide/unhide moderation, partner (`initWidget`)
surface — all legacy widget features with no ADR mandate. Add only on demand.
