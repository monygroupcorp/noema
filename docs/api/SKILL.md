---
name: crystal-api
description: >-
  Use when calling the Noema Crystal `/v1` API to run flows — discover flows,
  invoke a run, and observe it. Teaches the run-handle lifecycle, the
  discovery-first habit (never guess flow ids or inputs), auth options, and points
  at the live self-describing endpoints. Triggers: "run a crystal flow", "call the
  /v1 API", "noema API", "invoke a flow", "list flows", "POST /v1/runs".
---

# Crystal API (`/v1`)

The crystal exposes its flows as an API in two shapes over the same facade: a **REST**
surface under `/v1`, and an **MCP** endpoint at `/v1/mcp` for agent tool-use (tools
`run_flow` / `get_run` / `list_flows` / `describe_flow`; resources `crystal://flows`
and `crystal://flows/{id}`). Either way you **run flows**: pick a flow, give it inputs,
get back a **run handle**, then observe the run until it completes.

This skill is the stable conceptual model + pointers. It deliberately does **not**
list which flows exist — that is discovered live (see "Discovery-first"). For exact
shapes, read the self-describing source of truth:

- `GET /v1/openapi.json` — the full machine-readable contract (served by the API).
- `docs/api/reference.md` — the generated human reference (in this repo).
- The discovery endpoints below — the *live* catalog.

## The run-handle lifecycle (uniform)

Every invocation follows the same shape: **invoke → handle → observe.**

1. **Invoke** — `POST /v1/runs` with a target + inputs. You get back a `Run` handle:
   `{ id, status, modusId, exitus?, failure?, cost?, createdAt? }`.
2. **Observe** — poll `GET /v1/runs/:id` until `status` is `complete` (read `exitus`)
   or `failed` (read `failure.code`/`failure.message`). `status` is one of
   `pending | running | complete | failed`.

Three observation channels hang off the same `Run` handle — pick one:
- **poll** — `GET /v1/runs/:id` (above); the floor, always available.
- **SSE** — `GET /v1/runs/:id/stream` (`text/event-stream`): a snapshot then live
  `stage`/`complete`/`failed` frames; the stream ends on the terminal event.
- **webhook** — pass `options.webhookUrl` on `POST /v1/runs`; the terminal run event is
  POSTed there (fire-and-forget — essential for long, hours/days runs).

Note the two error planes:
- **Request errors** (bad call / unauthorized / unknown id) → an HTTP 4xx/5xx with
  the envelope `{ error: { code, message, retryable?, retryAfter?, details? } }`.
  Branch on the stable `code` (e.g. `not_found.flow`, `input.invalid_aditus`,
  `auth.missing`, `economy.insufficient_signa`). See the error table in the reference.
- **Run failures** (an accepted run that failed executing) are **not** request errors:
  you still get `200` with a `Run` whose `status` is `failed`.

## Discovery-first (never guess)

Flow ids and their input shapes are **dynamic** — they change as flows are seeded.
Never hardcode or guess them. Always discover:

- `GET /v1/flows` → `{ flows: [{ id, nomen, versio, categoria? }] }` — list what exists.
- `GET /v1/flows/:id` → `{ id, nomen, versio, input, output? }` — the flow's input
  JSON-Schema. Build your `aditus` (inputs) to match `input` before invoking.

Both discovery endpoints are public (no auth). Listing that a flow/model/LoRA exists
is discovery; *using* it happens at invoke time.

## Auth

`POST /v1/runs` and `GET /v1/runs/:id` require a caller identity; the discovery
endpoints are public. Provide **one** credential:

- `X-API-Key: <key>` header.
- `Authorization: Bearer <jwt>` header.
- A `web3` bundle `{ address, signature, nonce }` in the request body.
- An anonymous arcanum `commitment` string in the request body.

## Worked examples

**1. List flows, then describe one.**

```bash
curl https://HOST/v1/flows
# → { "flows": [ { "id": "make.flux@1", "nomen": "make", "versio": "1" }, ... ] }

curl https://HOST/v1/flows/make.flux@1
# → { "id": "make.flux@1", "nomen": "make", "versio": "1",
#     "input": { "type": "object", "properties": { "prompt": { "type": "string" } },
#                "required": ["prompt"] } }
```

**2. Invoke (using the input schema you just read) → get a run handle.**

```bash
curl -X POST https://HOST/v1/runs \
  -H 'X-API-Key: sk_...' -H 'Content-Type: application/json' \
  -d '{ "modusId": "make.flux@1", "aditus": { "prompt": "a red fox" } }'
# → { "run": { "id": "run_abc", "status": "pending", "modusId": "make.flux@1" } }
```

You may target a flow by `modusId` (explicit) or by `verb` (resolved to a flow).
Anonymous callers swap the header for a body field, e.g.
`{ "commitment": "0x…", "modusId": "make.flux@1", "aditus": { … } }`.

**3. Poll the run until it settles.**

```bash
curl -H 'X-API-Key: sk_...' https://HOST/v1/runs/run_abc
# pending/running → keep polling
# complete → { "run": { "id": "run_abc", "status": "complete",
#                        "exitus": { "image": "https://…" } } }
# failed   → { "run": { "id": "run_abc", "status": "failed",
#                        "failure": { "code": "...", "message": "..." } } }
```

## Keep this current

This file is pattern + pointers only — it stays stable as flows and endpoints are
added (those are discovered live / served from `openapi.json`). Update it **only** when
the conceptual model shifts (e.g. a new observation channel changes the lifecycle).
The committed `docs/api/*` are generated by `npm run gen:api-docs` and gated by a
drift-check — read them, don't duplicate them here.
