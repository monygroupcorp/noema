# North Star — The Canonical Architecture

**Date:** 2026-05-12
**Status:** Permanent reference. Every architectural decision defers to this.

---

## The Two Cases

### The Full Case (Canonical)

An anonymous user holds an arcanum — an anonymous identity capable of ZK spend proofs.
They request a session. The platform provisions a TEE-capable GPU pod on RunPod and
establishes a WireGuard tunnel between the user's device and that pod. The ring boots
inside the TEE. The user's client connects through the tunnel and speaks directly to
the ring — the same flows, the same primitives, the same modus catalog that every user
gets. They navigate, configure, execute, and receive results entirely through the tunnel.
The platform cannot read the traffic. It knows a session opened, it knows what it cost,
it knows the session closed. Nothing else.

The arcanum settles cost via ZK spend proof. The Modo records the session. The Actum
records that computation happened. Neither contains the content.

### The Simple Case (Degenerate Form)

An identified user (animaId via Persona) sends a message to the Telegram bot. The bot
resolves their identity, runs the flows on their behalf, submits the job to compute,
receives the result, and delivers it. The user trusts the platform to act as their
client. The platform sees everything — prompt, output, identity. The privacy machinery
is absent because the user elected not to use it.

**This is the same architecture with the following collapsed:**
- arcanum → animaId (identity is known and trusted to us)
- WireGuard tunnel → absent (bot is the client)
- TEE → absent (trust model does not require it)
- Modo → ephemeral or absent (no persistent session needed)
- Tessera → direct signorum spend (no ZK proof required)

The bot acting as trusted intermediary is not a different product. It is the full
product with the client role played by our infrastructure instead of by the user's
device.

---

## The Principle

**Build for the full case. The simple case falls out as a configuration, not a
special path.**

If a design decision makes the full case impossible or requires a code branch, the
decision is wrong. The full case is not a premium feature — it is the correct form
of what we are building. The simple case should require zero architectural
accommodation beyond what the full case already provides.

---

## What the Ring Is

The crystal ring — flows, primitives, modus catalog, execution rail, ledger — is not
the backend of a Telegram bot. It is the complete protocol. It is the full set of
capabilities: what can be run, how it is configured, how results are delivered, how
cost is settled. The ring expresses this independently of who is calling it or from
where.

The ring can run anywhere:
- On our servers (normal case — Telegram, Web, REST allocutios speak to it)
- Inside a TEE pod (private case — user's client speaks to it through WireGuard)

It is the same ring. The same flows. The same cursors. Deployment is a configuration.
It is not a code change.

---

## What the Allocutio Layer Is

An allocutio is an adapter. It translates a platform's native interaction model
into the ring's language — primitives and events — and back.

| Allocutio | Client | Trust model |
|-----------|--------|-------------|
| TelegramAllocutio | Our bot acts as client | User trusts platform |
| WebAllocutio | Browser on our servers | User trusts platform |
| REST/MCPAllocutio | Any HTTP/MCP client | Configurable |
| **TunnelAllocutio** | User's device through WireGuard | Platform cannot see |

The REST and MCP allocutio (Phase 7d) is not an "API layer." It is the interface
that the TEE client speaks through the WireGuard tunnel. It is what makes the full
case possible. It is not optional polish.

---

## What the Cursor Is

A cursor is the ring's interface to a compute substrate. It receives an Actum and
returns a CursorResult — either sync (inline) or async (externusJobId for webhook
resumption).

The cursor is transport-agnostic. It does not know or care whether the ring is
running on our servers or inside a TEE. In both cases it submits jobs to RunPod
and receives completions via webhook. In the normal case the webhook fires to our
servers. In the TEE case the webhook fires to the TEE pod's endpoint. The cursor
code is identical. The webhook URL is a deployment configuration.

**The cursor's job is execution, not mediation.** It does not compile on behalf of
the user (that is the client's job in the full case). It does not relay outputs to
the user (that exits through the tunnel in the full case). It runs the job and
records the result in the actum. Everything else is the ring's business.

---

## What the Modo Is

A Modo is a session. In the full case it is the primary concept — it holds the
WireGuard credentials, the GPU allocation, the persistent volume, the tessera signum
budget. The cursor operates within a Modo.

In the simple case the Modo may be ephemeral (opened and closed within a single
Actum's lifetime) or absent (the Actum stands alone). The ring handles both without
branching.

---

## North Star Test

Before committing any architectural decision, ask:

> If this ring were running inside a TEE and an anonymous user were connected through
> WireGuard, would this design still work without modification?

If the answer is no — if the design assumes the platform mediates the payload, assumes
the platform receives the output, assumes identity is always known, or requires a code
branch for the private case — the design is wrong. Fix the design, not the test.

---

*Every phase of this rewrite serves this document. When in doubt, return here.*
