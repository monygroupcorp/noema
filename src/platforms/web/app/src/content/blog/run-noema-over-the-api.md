# Run noema over the API

**Published:** 2026-09-05

Every flow on the platform is one HTTP call away, and they all follow the same three-step shape.

The API has one idea in it. You **invoke** a flow, you get back a **run handle**, and you **observe**
that run until it settles. Text, image, video, audio, a training, a workflow you composed yourself —
same three steps, same handle, same status words. Learn it once.

Everything below is `https://noema.art`.

## Discover, never guess

Which flows exist, and what inputs each one takes, are live facts. They change as flows are added
and as you publish your own. So the first call in any integration is a discovery call, and flow ids
belong in a variable rather than baked into your source.

```
GET /v1/flows
→ { "flows": [ { "id": "…", "nomen": "…", "versio": "…" }, … ] }

GET /v1/flows/<id>
→ { "id": "…", "input": { …JSON Schema… }, "output": { … } }
```

`input` is a JSON Schema. Build your inputs to match it — the same schema the canvas builds its node
panels from, so what you see in the app and what the API expects cannot drift apart.

Both discovery endpoints are public and need no credential. Seeing that a flow exists is not using
it.

## Credentials

Running a flow needs a caller identity. There are five ways to present one, and you need exactly
one of them:

- an `X-API-Key` header,
- an `Authorization: Bearer <jwt>` header,
- an `x-bursa-token` header carrying a purse code,
- an anonymous credit commitment — an `x-commitment` header, or a `commitment` field in the body,
- a signed wallet bundle in the request body.

Two of them come with a trap.

**Send the commitment as a header if you intend to watch the run.** A `GET` carries no body, so an
anonymous caller who put their commitment in the invoke body and nowhere else can start a run and
then never read it back: the poll and the stream arrive with no credential at all and answer `401
auth.missing`. Send `x-commitment` on every call and the question does not come up.

**A purse code spends somebody else's credits.** It is a bearer string minted out of an account
holder's balance and handed on — whoever holds it is the caller. That is also why it can stop
working with nothing wrong at your end: whoever minted it can revoke it, and a code that has been
redeemed into an account stops spending too.

One honest note on the API key: **it is not minted from your account settings.** That pane says
"coming soon" rather than showing you a button that does nothing. The key rides on partner
approval instead — ask via [the partner form](/partners) — and once you are approved you generate
and rotate it yourself from your [partner dashboard](/partner). The raw key is shown once, in the
response that mints it, and rotating retires the previous one the moment the new one appears.

## Invoke

```
POST /v1/runs
{
  "modusId": "<the flow id you discovered>",
  "aditus":  { "prompt": "a red fox" }
}
```

`modusId` is the flow, `aditus` its inputs, keyed by that flow's schema. (The wire keeps its Latin;
the app says "flow" and "inputs", and both mean the same fields.)

Two options worth knowing on the way in:

- **A hard spend cap.** Send `maxImpetus` and a run whose estimated cost exceeds it is refused at
  admission rather than started and regretted. On anything automated, set it.
- **A webhook.** Send `options.webhookUrl` and the terminal event is POSTed to you. For a training
  or a long video this is the difference between an integration and a held-open connection.

You get back a run handle: an id, a status, the flow it is running, and — once it settles — its
outputs or its failure.

## Observe

`status` is one of `pending`, `running`, `complete`, `failed`. Three ways to watch, all hanging off
the same handle:

- **Poll** `GET /v1/runs/<id>`. Always available, the floor.
- **Stream** `GET /v1/runs/<id>/stream` — server-sent events: a snapshot, then stage updates, then a
  terminal frame, at which point the stream ends.
- **Webhook** — the terminal event, delivered. Best for long runs; nothing to keep open.

On `complete`, read the outputs. On `failed`, read the failure's code and message.

A `pending` run that is not moving may be in a line rather than stalled. A run that found no warm
machine waits for one instead of being refused, and while it waits it carries
`queue: { place, depth }` — its 1-based position and how many runs are ahead of it plus itself. The
line is per machine image, not one global queue, and the field is gone the moment the run is called
forward. Report it rather than leaving someone watching a `pending` that sits still.

Every way of watching carries it. It is on the invoke response and on a poll; the stream's opening
snapshot carries it too, so a client that attaches to a run minutes after casting it still reads a
waiting run as waiting rather than as merely `pending`. And as the line moves, every run still in
it gets a fresh `queued` progress event — `progress` counting `place` of `depth`, and a message
that reads "3rd in line for a warm pod". Watching by stream alone answers "how long" and keeps
answering it; there is nothing here you have to poll for.

## Two kinds of error, and why the difference matters

This trips people up, so it is worth being explicit.

A **request error** means the call was wrong: an unknown flow, a malformed input, a missing
credential, not enough credits. You get a 4xx or 5xx and an error envelope with a stable `code` —
branch on the code, not on the message text, which is written for humans and may be reworded.

A **run failure** means the call was fine and the work failed. You get `200` and a run whose status
is `failed`. This is not an HTTP error and will not be caught by code that only checks response
status.

A client that treats a failed run as a transport problem will retry things it should surface, and a
client that only checks HTTP status will report success on a run that produced nothing. Handle both
planes.

## The contract itself

This guide is the shape. The exact contract is served by the API and generated from the code, never
hand-written:

- `GET /v1/openapi.json` — the full machine-readable contract, including the error-code table.
- `GET /v1/flows` and `GET /v1/flows/<id>` — the live catalogue.

If this guide and `openapi.json` ever disagree, `openapi.json` is right.

## Also worth reading

A flow you [composed on the canvas](/blog/compose-a-workflow) is invoked exactly like a built-in
one — the whole graph runs behind a single call — and so is a model you
[trained on your own work](/blog/train-a-model).
