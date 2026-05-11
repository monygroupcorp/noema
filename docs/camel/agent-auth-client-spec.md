# agent-auth/1

**Status:** Draft, pending integration partner review
**Audience:** External runtime/platform teams integrating with NFT-bound agent identities (initial: noema.art × CAMEL)
**Last updated:** 2026-05-06

This document specifies a protocol for binding ERC-8004 agent identities to NFT-collection holders, allowing third-party platforms ("runtimes") to authenticate, host, and bill those agents through a small, well-defined surface.

It is collection-agnostic. CAMEL is the first issuer, but every endpoint, schema, and verification step generalizes to any NFT collection that adopts the adapter pattern in §2.

The protocol covers two traffic legs:

1. **Inbound** — a CAMEL agent uses runtime spells/widgets, paid by a treasury, donations, or self-funded balance.
2. **Outbound** — external agents (anyone with a wallet) call CAMEL agent endpoints via x402 and pay per invocation.

Both legs share one identity model, one auth handshake, and one card endpoint.

---

## 1. Context

### 1.1 What is a CAMEL agent

CAMEL (`0x000Caba1002917B27300d7b67Be2d1C51B93bF00` on Ethereum mainnet) is a DN404 collection of 2,222 NFT camels. Every camel can register a single soulbound agent identity on the live ERC-8004 identity registry at `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`. Registrations are mediated by a `CamelAgentAdapter` proxy contract (per §2) which is the registry-side custodian of every agent NFT — agents are non-transferable but the right to *control* an agent follows the live owner of the underlying CAMEL NFT.

Practical consequence: when CAMEL #42 changes hands, the new owner inherits control of agent #N tied to that token. No on-chain migration needed.

### 1.2 Why a runtime

The ERC-8004 record is identity. It is not compute. Holders need somewhere to actually *run* their agent — invoke spells, host widgets, accept payment. Noema is that runtime. This spec defines how the two systems integrate without making either the source of truth for the other.

### 1.3 Goals of this spec

| Goal | How met |
|---|---|
| Identity is sovereign and portable | ERC-8004 record + adapter — no database lock-in |
| Runtime owns its bookkeeping | Treasury, balances, usage, donations all live on the runtime |
| Third parties integrate against a protocol, not a vendor | Card schema + auth handshake are universal |
| External agents can call CAMEL agents per-invocation | x402 layer at §7 |
| Holders have a single revocation surface | Card-listed sessions, mandatory `revokeURI` on each |
| Privacy as a future option | v2 ZK extension noted at §9; v1 uses EIP-712 |

---

## 2. Identity model

### 2.1 Layers

```
Holder wallet
   │  ↓ owns
CAMEL NFT #N (DN404 ERC-721 mirror)
   │  ↓ controlled by (live ownerOf)
CamelAgentAdapter proxy (Solady ERC1967)
   │  ↓ msg.sender to
ERC-8004 IdentityRegistry (0x8004A169...)
   │  ↓ holds
Agent NFT (soulbound, owned by adapter forever)
```

The adapter is the registry-side owner of every agent. CAMEL holders *control* their agent through the adapter's `registerAgent` / `agentExec` functions, gated by a live `ownerOf(camelTokenId)` check on the DN404 mirror. Transfer the camel, transfer agent control automatically.

### 2.2 Verifying the chain off-chain

Any party can verify "this address controls this agent right now" with three reads:

```solidity
adapter.agentIdOf(camelTokenId)            // → agentId
registry.ownerOf(agentId)                  // → adapter.address (always)
mirror.ownerOf(camelTokenId)               // → claimedHolder
```

If the third call returns the address claiming control, the chain is valid. The card endpoint (§3) packages this into a single `ownerProof` block so platforms can cache instead of re-verifying every request.

### 2.3 Generalization beyond CAMEL

The adapter pattern is collection-agnostic. Any NFT collection can deploy its own adapter implementing the same interface, point it at the ERC-8004 registry, and become an agent issuer. The card endpoint, handshake, and runtime API are unchanged — only the `collection` block in the card differs. A platform implementing this spec serves all such collections equally.

---

## 3. The card endpoint

### 3.1 Location

`GET https://{issuer-domain}/agents/{tokenId}/card`

For CAMEL: `https://camelcabal.fun/agents/{tokenId}/card`

`Content-Type: application/json`. CORS open. Cacheable with `Cache-Control: public, max-age=300, stale-while-revalidate=3600`. Idempotent.

### 3.2 Purpose

A platform integrating with an agent reads the card *first*. The card is OIDC-style discovery: it points at every other endpoint the platform needs and provides enough on-chain context to verify the agent's authority before running the handshake.

### 3.3 Schema

See Appendix A for a complete sample. Top-level fields:

| Field | Type | Required | Notes |
|---|---|---|---|
| `spec` | string | yes | Always `"agent-auth/1"` for this version |
| `agentId` | string (decimal) | yes | The ERC-8004 agentId |
| `issuer` | string (URL) | yes | Origin that signs assertions; matches `https://{issuer-domain}` |
| `collection` | object | yes | Backing NFT (chain, contract, tokenId, adapter, registry) |
| `owner` | address | yes | Live `mirror.ownerOf(tokenId)` at the time of card generation |
| `ownerProof` | object | yes | Method + on-chain reads for re-verification |
| `profile` | object | yes | Display name, description, image |
| `auth` | object | yes | URLs for challenge / verify / sessions endpoints |
| `sessions` | array | yes | Active runtime sessions; federated from runtimes (cacheable) |
| `capabilities` | array | conditional | Required if agent advertises x402 endpoints (§7) |
| `metadata` | object | yes | All ERC-8004 `getMetadata` keys set by the holder |

### 3.4 Federation

`sessions[]` and `capabilities[]` are federated by the issuer's card endpoint from each registered runtime. The card cache TTL is short (5 min) so changes propagate quickly without overloading runtime APIs. If a runtime is unreachable, its entries are omitted from the card with a `degraded: true` flag at the top level. Platforms must handle missing federated data gracefully.

---

## 4. Auth handshake

The handshake produces a short-lived **agent assertion JWT** that the runtime accepts as proof "this holder authorized us to act for this agent." The JWT is signed by the issuer; the runtime never needs to talk to a user wallet directly.

### 4.1 Sequence

```
Platform (P)         Issuer (I)            Holder wallet (W)
   │                     │                       │
   │ 1. POST /challenge  │                       │
   │   {platformId,scope}│                       │
   ├────────────────────►│                       │
   │                     │                       │
   │ 2. {nonce, typed_data, expires_at}          │
   │◄────────────────────┤                       │
   │                     │                       │
   │ 3. show typed_data ─────────────────────────│
   │                     │                       │
   │ 4. signature ◄──────────────────────────────│
   │                     │                       │
   │ 5. POST /verify     │                       │
   │   {nonce, signature}│                       │
   ├────────────────────►│                       │
   │                     │ verifies sig + on-chain ownership
   │ 6. {assertion_jwt, expires_at}              │
   │◄────────────────────┤                       │
   │                     │                       │
   │ 7. provision agent sub-account on runtime   │
   │   (use assertion_jwt as auth)               │
   │                     │                       │
   │ 8. POST issuer /sessions {session metadata} │
   ├────────────────────►│                       │
   │                     │ stores session, exposes on card
   │                     │                       │
```

### 4.2 Step 1 — challenge

```
POST {issuer}/agents/{tokenId}/auth/challenge
Content-Type: application/json

{
  "platformId": "noema.art",
  "scope": ["spell.image.generate", "spell.text.complete"],
  "callbackURL": "https://noema.art/agents/onboard/callback",
  "spendingCap": { "amount": "25", "currency": "USDC", "period": "monthly" }
}
```

Response:

```
{
  "nonce": "0x7f3a...",
  "expiresAt": 1714000000,
  "typedData": { /* EIP-712 typed message — see §4.3 */ },
  "verifyURL": "https://camelcabal.fun/agents/42/auth/verify"
}
```

`nonce` is a cryptographically random 32-byte value, single-use, server-tracked. `expiresAt` is ≤ 5 minutes from issuance.

### 4.3 EIP-712 typed message

```
domain:
  name:               "agent-auth"
  version:            "1"
  chainId:            <chain of the camel collection>
  verifyingContract:  <adapter.address>

primaryType: "AgentAuthorization"

types:
  AgentAuthorization:
    - tokenId         uint256
    - agentId         uint256
    - platformId      string
    - scope           string[]
    - spendingCapWei  uint256       # 0 if no cap; in USDC base units
    - nonce           bytes32
    - expiresAt       uint256
```

The holder sees this in their wallet as a clean human-readable structure. No opaque hex.

### 4.4 Step 5 — verify

```
POST {issuer}/agents/{tokenId}/auth/verify
Content-Type: application/json

{
  "nonce": "0x7f3a...",
  "signature": "0x..."
}
```

The issuer:

1. Looks up the nonce; rejects if unknown, expired, or already consumed.
2. Recovers the signer from the EIP-712 signature.
3. Reads the live `mirror.ownerOf(tokenId)` and asserts equality with the recovered signer.
   - Falls back to EIP-1271 (`isValidSignature`) if the owner is a smart-account wallet.
4. Marks the nonce consumed.
5. Mints an **agent assertion JWT** (§5) and returns it.

Response:

```
{
  "assertion": "eyJhbGc...",
  "expiresAt": 1714003600
}
```

Failure responses use standard HTTP codes (400 invalid request, 401 signature invalid, 410 nonce expired, 409 nonce reused).

### 4.5 Replay and scope binding

The combination of `(nonce, platformId, scope, expiresAt)` is bound into the typed message. A signature obtained for one scope cannot be replayed for a wider scope, a different platform, or after expiry. The issuer enforces this at verify time.

---

## 5. Agent assertion JWT

The runtime treats this JWT the way a service treats an OAuth token — as proof of authorization, not as a session itself.

### 5.1 Format

```
header:
  alg: "ES256"
  kid: "<key id; rotated quarterly>"
  typ: "JWT"

payload:
  iss:       "https://camelcabal.fun"
  aud:       "<platformId>"
  sub:       "agent:<chainId>:<adapter>:<agentId>"
  iat:       <unix>
  exp:       <iat + 3600>
  scope:     ["spell.image.generate", ...]
  spending_cap: { "amount": "25", "currency": "USDC", "period": "monthly" }
  agent: {
    chainId: 1,
    collection: "0x000Caba1...",
    tokenId: 42,
    adapter: "0x...",
    registry: "0x8004A169...",
    agentId: 17
  }
  owner_at_assertion: "0xHolder..."
```

`exp` is one hour. The runtime is expected to use the assertion to provision its own session and then refresh independently.

### 5.2 Verification by the runtime

1. Fetch the issuer's JWKS at `https://{issuer}/.well-known/jwks.json`.
2. Verify the JWT signature using the key matching `kid`.
3. Check `iss` matches the expected issuer for the agent's collection.
4. Check `aud` matches the runtime's platformId.
5. Optionally re-verify on-chain ownership (`owner_at_assertion`) at the runtime's discretion. The issuer guarantees it was correct at `iat`; later changes are not the issuer's responsibility.

### 5.3 Key rotation

The issuer publishes a JWKS with multiple active keys. Quarterly rotation, with a 7-day grace window where both old and new keys verify. Compromised keys are removed immediately and announced via a `rev` field in the JWKS response.

---

## 6. Treasury / sub-account model

This section describes the runtime-side model. The runtime **owns** all of this; the issuer never holds funds, never tracks balances, never makes grant decisions. The model below is a contract on the runtime's API shape, not a prescription on the runtime's internal implementation.

### 6.1 Three-tier hierarchy

```
TreasuryAccount
  │   funded by an issuer team multisig
  │   policies: faucet drip rate, caps, subsidy/user-pay split
  │
  └──── AgentAccount (one per agent registered through the issuer)
          │   balance flows in from: treasury drips, x402 earnings, donations
          │   balance flows out to: spell invocations
          │   scoped permissions: which capabilities this agent can call
          │
          └──── UsageEvent (per-call ledger)
```

### 6.2 Faucet / drip semantics

The runtime owns the activity scoring formula. Recommended (not required): a periodic cron that scores each agent on `(sessions_opened, spells_invoked, holder_token_balance, recency_decay)` and tops up balances proportionally, capped at a per-agent monthly maximum. The issuer's role is configuring the faucet *policy* (caps, rates, currency, refill schedule) via the runtime API; the runtime executes.

### 6.3 Donation primitive

Anyone can send a donation to an agent's sub-account directly:

```
POST {runtime}/api/treasury/{treasuryId}/agents/{agentId}/donate
{
  "amount": "5.00",
  "currency": "USDC",
  "from": "0xDonor...",  // optional, surfaced as donor recognition
  "memo": "love your haikus"
}
```

The runtime credits the agent's sub-account and emits a public donation event. The card endpoint surfaces total donations (anonymized counts unless `from` is provided).

### 6.4 Subsidy → user-pay shift

A treasury policy field `subsidyMode` can be `"on"`, `"off"`, or `"hybrid"`. The runtime applies it transparently — when a holder uses a spell, the runtime decides whether the agent's sub-account or the holder's wallet pays based on the policy and the holder's pre-funded balance. The agent doesn't know or care which lane funded a given invocation.

### 6.5 Endpoints exposed by the runtime

See §10 for the full list.

---

## 7. x402 capability layer

### 7.1 Discovery

Capabilities are advertised on the agent's card under `capabilities[]`:

```json
{
  "id": "spell.image.generate",
  "name": "Generate image",
  "description": "256x256 image from a prompt; SDXL backend.",
  "endpoint": "https://noema.art/x402/agents/cmw_1234/spell/image",
  "method": "POST",
  "x402": {
    "version": "1",
    "price": { "amount": "0.05", "currency": "USDC" },
    "chains": [1, 8453, 42161],
    "facilitator": "https://x402.facilitator.noema.art",
    "schema": "https://noema.art/x402/schemas/image-gen.json"
  }
}
```

External agents read the card, find capabilities they want to use, and call the endpoint cold. The endpoint serves an HTTP 402 with x402 payment requirements; the caller pays via the facilitator and retries with the payment proof. Standard x402.

### 7.2 The runtime owns the endpoint

The endpoint URL points at the runtime, not the issuer. The issuer's role is *advertising* the capability through the card. The runtime handles 402 negotiation, payment verification (via its chosen facilitator), payload validation, execution, and response.

### 7.3 Revenue routing

Each agent has a `payout-policy` configured by the holder (or the issuer team on the holder's behalf via admin):

| Mode | Inbound x402 revenue routes to | Use case |
|---|---|---|
| `"self-fund"` (default) | Agent sub-account on the runtime | Earnings cover the agent's own usage |
| `"withdraw"` | Holder's `agent_wallet` (on-chain) | Holder pockets revenue directly |
| `"split"` | Configurable % to sub-account, % to wallet, % to treasury | Commercial agreements |

The card endpoint does *not* surface payout policy — it's an internal detail. External agents only see the price and endpoint.

### 7.4 Schema-driven calls

The `schema` URL on each capability points at an OpenAPI-shaped JSON document describing request/response payloads. This makes capabilities introspectable and machine-callable: an external LLM agent can discover a capability, fetch its schema, generate a valid request, and pay.

### 7.5 Failure modes

| Scenario | Behavior |
|---|---|
| Capability removed by holder | Runtime returns 404; card omits on next refresh |
| Price changed mid-flight | The 402 response is the source of truth; cached card prices are advisory |
| Payment fails to settle | Runtime returns 402 again with a fresh payment requirement |
| Agent disabled | Runtime returns 503 with a `Retry-After` hint or holder revocation note |

---

## 8. V1 hardenings

These are the seven failure modes the spec deliberately addresses in v1:

| Hardening | Mechanism |
|---|---|
| Cross-platform replay | EIP-712 domain (`name="agent-auth"`, `version="1"`, `verifyingContract=<adapter>`) |
| Same-session replay | 32-byte server-tracked single-use nonce |
| Long-tail signature leak | `expiresAt` ≤ 5 minutes on the typed message |
| Backend key compromise | Quarterly JWKS rotation with 7-day grace; immediate revocation list |
| Stale sessions after revocation | Mandatory `revokeURI` on every session; issuer cron sweeps weekly |
| Rogue runtime sessions | Public session ledger on the card — holders + observers see everything |
| Smart-account wallet support | EIP-1271 fallback in `verify` step |

These are non-negotiable in v1. Implementations that skip any of them are out of spec.

---

## 9. Versioning and future extensions

### 9.1 Semantic versioning

The `spec` field on the card is a major version (`agent-auth/1`). Backwards-incompatible changes mint a new major. Additive changes (new optional fields, new endpoint variants) are minor and don't bump the field.

### 9.2 Multi-runtime

V1 assumes a single runtime hosts an agent at a time. Multi-runtime support adds a `runtime` field per session and per capability, naming the runtime explicitly. Spec-aware platforms ignore sessions not attributed to themselves. Coming in `agent-auth/1.x` (additive).

### 9.3 ZK / anonymous agents (v2 deferral)

V1 uses EIP-712 because (a) every wallet supports it, (b) the brittle joints in auth (replay, expiry, key management, revocation) are not solved by ZK, and (c) the agent's tokenId is publicly bound to the on-chain identity anyway, so anonymity isn't preserved by the handshake alone.

A future `agent-auth/2` will add an optional `proofMethod` field on the card supporting ZK Merkle-membership proofs. Use case: holders who want to act as "some CAMEL holder" without revealing which specific token. This buys anonymity, not security. The v1 EIP-712 path remains canonical.

### 9.4 Cross-chain agents

V1 binds an agent to a single `(chainId, collection, tokenId)` triple. Cross-chain extension (e.g., a CAMEL on L2 with the same agent) is left to future versions.

---

## 10. Endpoint surface

### 10.1 Issued by us (the issuer)

All under `https://camelcabal.fun`:

| Endpoint | Purpose | Auth |
|---|---|---|
| `GET /agents/{tokenId}` | HTML profile (humans + crawlers) | Public |
| `GET /agents/{tokenId}/card` | JSON manifest | Public |
| `POST /agents/{tokenId}/auth/challenge` | Issue handshake nonce + typed data | Public, rate-limited |
| `POST /agents/{tokenId}/auth/verify` | Verify signature, mint assertion JWT | Public, nonce-gated |
| `POST /agents/{tokenId}/sessions` | Runtime callback after onboarding | Signed by the runtime |
| `DELETE /agents/{tokenId}/sessions/{platformId}` | Holder-initiated revocation (forwards to `revokeURI`) | EIP-712 holder signature |
| `GET /.well-known/jwks.json` | JWKS for assertion JWT verification | Public |

### 10.2 Required by us from the runtime

Twelve endpoints across treasury, sessions, and x402:

**Treasury & accounts:**

| Endpoint | Caller | Purpose |
|---|---|---|
| `POST /api/treasury` | Issuer team multisig | Create master account once |
| `POST /api/treasury/{id}/fund` | Issuer team multisig | Deposit balance |
| `POST /api/treasury/{id}/agents` | Issuer onboarding flow | Provision new sub-account; carries assertion JWT |
| `POST /api/treasury/{id}/agents/{agentId}/topup` | Issuer admin | Manual balance adjustment |
| `PATCH /api/treasury/{id}/policy` | Issuer admin | Faucet config (rates, caps, subsidy mode) |
| `GET /api/treasury/{id}` | Issuer | Read total balance + policy |
| `GET /api/treasury/{id}/agents/{agentId}` | Public | Read per-agent balance + recent usage (for card) |
| `POST /api/treasury/{id}/agents/{agentId}/donate` | Public | Tip an agent's sub-account |

**Capabilities & x402:**

| Endpoint | Caller | Purpose |
|---|---|---|
| `GET /api/agents/{agentId}/capabilities` | Issuer | Federated into the card |
| `PATCH /api/agents/{agentId}/capabilities/{id}` | Issuer admin | Holder-delegated price/availability changes |
| `PATCH /api/agents/{agentId}/payout-policy` | Issuer admin | Holder-delegated revenue routing config |
| `GET /api/agents/{agentId}/earnings` | Public | Recent x402 inflows for the public profile |

The actual x402 endpoints (`POST /x402/agents/{agentId}/spell/{name}`) are runtime-defined per capability and not enumerated here — they're discovered through the card.

---

## 11. What we'll build vs. what we need from the runtime

### 11.1 Issuer side (us)

Already built or in flight:

- The adapter contract (`CamelAgentAdapter`, deployed via Solady ERC1967 factory)
- On-chain registration flow (`registerAgent`, `agentExec` with selector whitelist)
- Holder-facing UI for registration + metadata management
- Local end-to-end smoke test (`npm run chain:start:agent`)

To be built for v1.0:

- Card endpoint (`/agents/{tokenId}/card`) — JSON manifest
- HTML profile page (`/agents/{tokenId}`) — embeds card + widgets
- Auth handshake server (challenge / verify / JWT minting)
- JWKS endpoint + key rotation tooling
- Session callback receiver (`/sessions`)
- Holder revocation flow forwarding to `revokeURI`
- Admin panel for treasury management (top-up, policy edits, earnings view)

Estimated effort: ~1 week of focused work.

### 11.2 Runtime side (noema)

Required for v1.0:

- 12 endpoints in §10.2
- x402 capability servers (one per advertised spell)
- Branded onboarding view (post-handshake landing for users arriving from the issuer)
- ERC-8004 indexer for our adapter address (so noema can detect new agents and pre-provision)
- Faucet cron implementation (their algorithm; our policy)
- Revocation handling (`revokeURI` pattern)
- Donation receipt flow

The protocol leaves implementation choices open — circuit, database, payment facilitator, key management — so noema can build to their existing stack. The contract is the endpoint shapes and behavior, not the internals.

---

## 12. Open items / decisions needed

The following are intentionally undecided in this draft and need joint sign-off before v1.0 is final:

1. **Currency of treasury** — USDC, ETH, runtime-credit, or multi-currency? Affects funding flow and donation routing.
2. **Faucet algorithm details** — runtime's call, but issuer wants visibility into the formula for the admin UI.
3. **Donation custody model** — direct on-chain custody at the runtime, or a contract that escrows then forwards? Affects exit risk for donors.
4. **JWT key rotation cadence** — quarterly proposed; some platforms prefer monthly.
5. **Rate limits on `/auth/challenge`** — proposed 60 req/min/IP, no per-token cap. Adjust based on expected traffic shape.
6. **Cross-chain support timeline** — v1 single-chain. If a CAMEL deploys on L2 in v1.x, what's the migration path?
7. **Reference implementation language(s)** — which language for the runtime's reference impl of the 12 endpoints? Affects which TypeScript types we ship in Appendix C.
8. **Card cache TTL** — 5 minutes proposed. Long enough to be cheap, short enough to keep the public ledger fresh.

---

## Appendix A — Sample card JSON

Complete sample for CAMEL #42, fully populated:

```json
{
  "spec": "agent-auth/1",
  "agentId": "17",
  "issuer": "https://camelcabal.fun",

  "collection": {
    "name": "CAMEL",
    "symbol": "CAMEL",
    "chain": 1,
    "tokenContract": "0x000Caba1002917B27300d7b67Be2d1C51B93bF00",
    "tokenId": 42,
    "adapter": "0x6356f980e7270a210DaC550DfE570B529A23d809",
    "registry": "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"
  },

  "owner": "0xHolder1234567890abcdef1234567890abcdef12",
  "ownerProof": {
    "method": "erc8004-camel-adapter",
    "verifyOnChain": [
      "registry.ownerOf(17) == adapter",
      "adapter.agentIdOf(42) == 17",
      "mirror.ownerOf(42) == owner"
    ]
  },

  "profile": {
    "name": "camel42",
    "description": "Desert Runner: 24/7 DCA bot for CAMEL on dips.",
    "image": "https://camelcabal.fun/agents/42/avatar.png"
  },

  "auth": {
    "challenge": "https://camelcabal.fun/agents/42/auth/challenge",
    "verify":    "https://camelcabal.fun/agents/42/auth/verify",
    "sessions":  "https://camelcabal.fun/agents/42/sessions",
    "jwks":      "https://camelcabal.fun/.well-known/jwks.json"
  },

  "sessions": [
    {
      "platform": "noema.art",
      "scope": ["spell.image.generate", "spell.text.complete"],
      "issuedAt": 1714000000,
      "expiresAt": 1715000000,
      "manifestURI": "https://noema.art/api/agents/cmw_1234/manifest",
      "revokeURI": "https://noema.art/api/sessions/cmw_1234/revoke",
      "billing": {
        "model": "treasury-funded",
        "treasuryRef": "camelcabal:treasury:1",
        "agentBalance": "12.50",
        "monthlyCap": "25.00",
        "currency": "USDC"
      }
    }
  ],

  "capabilities": [
    {
      "id": "spell.image.generate",
      "name": "Generate image",
      "description": "256x256 image from a prompt; SDXL backend.",
      "endpoint": "https://noema.art/x402/agents/cmw_1234/spell/image",
      "method": "POST",
      "x402": {
        "version": "1",
        "price": { "amount": "0.05", "currency": "USDC" },
        "chains": [1, 8453, 42161],
        "facilitator": "https://x402.facilitator.noema.art",
        "schema": "https://noema.art/x402/schemas/image-gen.json"
      }
    },
    {
      "id": "spell.text.complete",
      "name": "Text completion",
      "endpoint": "https://noema.art/x402/agents/cmw_1234/spell/text",
      "method": "POST",
      "x402": {
        "version": "1",
        "price": { "amount": "0.01", "currency": "USDC" },
        "chains": [1, 8453],
        "facilitator": "https://x402.facilitator.noema.art"
      }
    }
  ],

  "metadata": {
    "description": "Desert Runner: 24/7 DCA bot for CAMEL on dips.",
    "noema": "https://noema.art/agents/cmw_1234",
    "agent_wallet": "0xAgentWallet0000000000000000000000000000",
    "twitter": "@desertrunner_eth"
  },

  "generatedAt": 1714123456,
  "cacheUntil":  1714123756
}
```

---

## Appendix B — Sample handshake transcript

Concrete trace of a successful onboarding from noema for CAMEL #42:

```http
# Step 1 — Platform requests challenge
POST https://camelcabal.fun/agents/42/auth/challenge
Content-Type: application/json

{
  "platformId": "noema.art",
  "scope": ["spell.image.generate", "spell.text.complete"],
  "callbackURL": "https://noema.art/agents/onboard/callback",
  "spendingCap": { "amount": "25", "currency": "USDC", "period": "monthly" }
}

# Step 2 — Issuer responds
HTTP/1.1 200 OK
Content-Type: application/json

{
  "nonce": "0x7f3a8c1d9e0b2a4f5d6e7c8b9a0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d",
  "expiresAt": 1714000300,
  "verifyURL": "https://camelcabal.fun/agents/42/auth/verify",
  "typedData": {
    "domain": {
      "name": "agent-auth",
      "version": "1",
      "chainId": 1,
      "verifyingContract": "0x6356f980e7270a210DaC550DfE570B529A23d809"
    },
    "primaryType": "AgentAuthorization",
    "types": {
      "AgentAuthorization": [
        { "name": "tokenId",        "type": "uint256" },
        { "name": "agentId",        "type": "uint256" },
        { "name": "platformId",     "type": "string"  },
        { "name": "scope",          "type": "string[]"},
        { "name": "spendingCapWei", "type": "uint256" },
        { "name": "nonce",          "type": "bytes32" },
        { "name": "expiresAt",      "type": "uint256" }
      ]
    },
    "message": {
      "tokenId": "42",
      "agentId": "17",
      "platformId": "noema.art",
      "scope": ["spell.image.generate", "spell.text.complete"],
      "spendingCapWei": "25000000",
      "nonce": "0x7f3a...c8d",
      "expiresAt": "1714000300"
    }
  }
}

# Step 3-4 — Holder signs typedData in their wallet (off-spec; wallet UI)
# Result: signature = 0x...

# Step 5 — Platform submits signature to verify
POST https://camelcabal.fun/agents/42/auth/verify
Content-Type: application/json

{
  "nonce": "0x7f3a...c8d",
  "signature": "0xb1a2c3d4..."
}

# Step 6 — Issuer verifies and returns assertion JWT
HTTP/1.1 200 OK
Content-Type: application/json

{
  "assertion": "eyJhbGciOiJFUzI1NiIsImtpZCI6IjIwMjYtUTIifQ.eyJpc3MiOi...",
  "expiresAt": 1714003600
}

# Step 7 — Platform provisions sub-account using the JWT
POST https://noema.art/api/treasury/camel-1/agents
Authorization: Bearer eyJhbGciOiJFUzI1NiIs...
Content-Type: application/json

{
  "agentId": "17",
  "owner": "0xHolder...",
  "scope": ["spell.image.generate", "spell.text.complete"],
  "spendingCap": { "amount": "25", "currency": "USDC", "period": "monthly" }
}

HTTP/1.1 201 Created
{
  "agentAccountId": "cmw_1234",
  "manifestURI": "https://noema.art/api/agents/cmw_1234/manifest",
  "revokeURI": "https://noema.art/api/sessions/cmw_1234/revoke",
  "balance": { "amount": "5.00", "currency": "USDC" }
}

# Step 8 — Platform notifies issuer of the live session
POST https://camelcabal.fun/agents/42/sessions
Content-Type: application/json
X-Platform-Signature: 0x...

{
  "platform": "noema.art",
  "platformAgentId": "cmw_1234",
  "scope": ["spell.image.generate", "spell.text.complete"],
  "issuedAt": 1714000350,
  "expiresAt": 1715000000,
  "manifestURI": "https://noema.art/api/agents/cmw_1234/manifest",
  "revokeURI": "https://noema.art/api/sessions/cmw_1234/revoke"
}

HTTP/1.1 201 Created
```

Total round-trips: 4 (challenge, verify, provision, session-notify). One signature from the holder. End-to-end under 10 seconds in normal conditions.

---

## Appendix C — TypeScript types

For runtime implementations in TypeScript. Drop into a shared `agent-auth.d.ts`.

```typescript
// ─── Card ──────────────────────────────────────────────────────────────────

export interface AgentCard {
  spec: "agent-auth/1";
  agentId: string;
  issuer: string;
  collection: CollectionRef;
  owner: `0x${string}`;
  ownerProof: OwnerProof;
  profile: AgentProfile;
  auth: AuthEndpoints;
  sessions: SessionEntry[];
  capabilities?: CapabilityEntry[];
  metadata: Record<string, string>;
  generatedAt: number;
  cacheUntil: number;
  degraded?: true;
}

export interface CollectionRef {
  name: string;
  symbol?: string;
  chain: number;
  tokenContract: `0x${string}`;
  tokenId: number;
  adapter: `0x${string}`;
  registry: `0x${string}`;
}

export interface OwnerProof {
  method: "erc8004-camel-adapter" | string;
  verifyOnChain: string[];
}

export interface AgentProfile {
  name: string;
  description: string;
  image?: string;
}

export interface AuthEndpoints {
  challenge: string;
  verify: string;
  sessions: string;
  jwks: string;
}

// ─── Sessions ──────────────────────────────────────────────────────────────

export interface SessionEntry {
  platform: string;
  scope: string[];
  issuedAt: number;
  expiresAt: number;
  manifestURI: string;
  revokeURI: string;
  billing?: SessionBilling;
}

export interface SessionBilling {
  model: "treasury-funded" | "user-paid" | "hybrid";
  treasuryRef?: string;
  agentBalance?: string;
  monthlyCap?: string;
  currency: string;
}

// ─── Capabilities (x402) ───────────────────────────────────────────────────

export interface CapabilityEntry {
  id: string;
  name: string;
  description?: string;
  endpoint: string;
  method: "GET" | "POST";
  x402: X402Spec;
}

export interface X402Spec {
  version: "1";
  price: Money;
  chains: number[];
  facilitator: string;
  schema?: string;
}

export interface Money {
  amount: string;
  currency: "USDC" | "ETH" | string;
  period?: "monthly" | "yearly";
}

// ─── Handshake ─────────────────────────────────────────────────────────────

export interface ChallengeRequest {
  platformId: string;
  scope: string[];
  callbackURL: string;
  spendingCap?: Money;
}

export interface ChallengeResponse {
  nonce: `0x${string}`;
  expiresAt: number;
  verifyURL: string;
  typedData: EIP712TypedData;
}

export interface VerifyRequest {
  nonce: `0x${string}`;
  signature: `0x${string}`;
}

export interface VerifyResponse {
  assertion: string;     // JWT
  expiresAt: number;
}

// ─── JWT payload ───────────────────────────────────────────────────────────

export interface AgentAssertion {
  iss: string;
  aud: string;
  sub: string;           // "agent:<chainId>:<adapter>:<agentId>"
  iat: number;
  exp: number;
  scope: string[];
  spending_cap?: Money;
  agent: {
    chainId: number;
    collection: `0x${string}`;
    tokenId: number;
    adapter: `0x${string}`;
    registry: `0x${string}`;
    agentId: number;
  };
  owner_at_assertion: `0x${string}`;
}

// ─── Session callback (runtime → issuer) ───────────────────────────────────

export interface SessionCallback {
  platform: string;
  platformAgentId: string;
  scope: string[];
  issuedAt: number;
  expiresAt: number;
  manifestURI: string;
  revokeURI: string;
  billing?: SessionBilling;
}

// ─── Treasury / sub-account (runtime → issuer admin) ───────────────────────

export interface TreasuryAccount {
  id: string;
  balance: Money;
  fundingPolicy: "manual" | "scheduled";
  faucetPolicy: FaucetPolicy;
}

export interface FaucetPolicy {
  starterGrant: Money;
  monthlyMax: Money;
  subsidyMode: "on" | "off" | "hybrid";
  refillCadence: "weekly" | "biweekly" | "monthly";
}

export interface AgentAccount {
  agentAccountId: string;
  agentId: string;
  owner: `0x${string}`;
  balance: Money;
  scope: string[];
  payoutPolicy: PayoutPolicy;
  recentUsage: UsageEvent[];
}

export interface PayoutPolicy {
  mode: "self-fund" | "withdraw" | "split";
  withdrawAddress?: `0x${string}`;
  split?: { subAccountPct: number; walletPct: number; treasuryPct: number };
}

export interface UsageEvent {
  spell: string;
  cost: Money;
  timestamp: number;
  sessionId: string;
}

export interface DonationRequest {
  amount: string;
  currency: string;
  from?: `0x${string}`;
  memo?: string;
}

// ─── EIP-712 typed data (handshake message) ────────────────────────────────

export interface EIP712TypedData {
  domain: {
    name: "agent-auth";
    version: "1";
    chainId: number;
    verifyingContract: `0x${string}`;
  };
  primaryType: "AgentAuthorization";
  types: {
    AgentAuthorization: Array<{ name: string; type: string }>;
  };
  message: {
    tokenId: string;
    agentId: string;
    platformId: string;
    scope: string[];
    spendingCapWei: string;
    nonce: `0x${string}`;
    expiresAt: string;
  };
}
```

---

## Glossary

- **Agent** — An ERC-8004 identity registered via the issuer's adapter, controlled by the live owner of a backing NFT.
- **Adapter** — A smart contract holding the agent NFT and mediating control through the backing NFT's `ownerOf`.
- **Issuer** — The party serving the card endpoint and minting agent assertion JWTs (e.g., camelcabal.fun for CAMEL agents).
- **Runtime** — The platform hosting an agent's compute and balance (e.g., noema.art).
- **Card** — The JSON manifest at `/agents/{tokenId}/card`. The discovery surface.
- **Capability** — A spell or service an agent advertises for x402 invocation.
- **Treasury** — The issuer-funded master account on the runtime that subsidizes agent usage.
- **Sub-account** — A per-agent ledger on the runtime tracking balance and usage.
- **Assertion** — A short-lived JWT signed by the issuer attesting to agent ownership at a moment in time.
- **Facilitator** — An x402 settlement service that verifies payments and submits them to chain.

---

*End of `agent-auth/1` draft.*
