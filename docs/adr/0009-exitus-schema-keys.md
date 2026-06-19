# ADR-0009: Exitus is keyed by the Modus's declared schema; consumers read by value

- **Status:** accepted
- **Date:** 2026-06-19

## Context

A run's outputs land in `actum.exitus`. Historically the key was assigned ad hoc and inconsistently:
the execution webhook hard-coded `imageUrl`/`videoUrl`/`audioUrl` by file extension; `OpenAICursor`
hard-coded `imageUrl`; `seeds/modi.ts` *declared* an `imageUrl` exitus Porta while `seeds/essentiae.ts`
declared `image`/`audio`/`mesh`/`text`. So the runtime exitus keys did not match the flow's declared
`exitus` schema, and even the schemas disagreed with each other.

This surfaced when wiring a **compositus** (ADR-0008): a step's ligamen references an upstream step's
exitus *by key*. With the divergence, the natural `{ image: { gradus: 0, exitus: 'image' } }` read
`undefined` at runtime (the webhook had written `imageUrl`), silently feeding the next step a blank
input. It also made delivery fragile: `ExecuteFlow` detected media by keys *ending in `Url`*, so any
schema-key rename would silently stop delivering images to users.

## Decision

**`actum.exitus` is keyed by the Modus's declared `exitus` schema — the typed Porta names**
(`image`, `video`, `audio`, `mesh`, `text`), never a hard-coded `imageUrl`. A media output's URL lives
under its typed Porta key. This makes input and output **symmetric** (an `image`-typed aditus already
holds a URL — see the i2i primitive) and lets a compositus wire `exitus.image → aditus.image`
port-to-port: same name, same type.

Two rules enforce it:

1. **Producers project through one helper.** `src/execution/projectExitus.ts` is the single source of
   truth: given the Modus + raw output URLs, it keys each URL under the schema's matching media-typed
   Porta (a flow with exactly one media output uses that key directly; otherwise match by the URL's
   extension type; with no schema, fall back to the bare type name). The execution webhook and every
   sync cursor call it. **Do not hand-assign exitus media keys anywhere else.**

2. **Consumers read by VALUE, not key name.** Anything that delivers/uses an output (`ExecuteFlow`
   result rendering, `vestigiumHook`) treats *any http(s)-URL string value* as media (type inferred
   from the extension) — never matching on the key spelling. This is key-agnostic, so a schema rename
   can never again decouple production from delivery.

`seeds/modi.ts` was corrected (`imageUrl` → `image`) so every canonical schema uses typed names.

## Consequences

- **Easier:** compositus ligamina wire by the declared schema key with no surprises; adding a new media
  flow needs no delivery-side change. The producer/consumer split means the key contract has exactly
  one writer (`projectExitus`) and value-based readers — it cannot drift.
- **API-visible:** `/v1` runs now surface `exitus.image` (etc.) instead of `imageUrl`. The Run exitus
  is an open `Record`, so no contract/drift test pinned the old key; staging data predating this keeps
  its old keys, and value-driven consumers read both.
- **Enforced by:** `projectExitus.test.ts` (schema-keyed projection, single/multi/3d/fallback) plus the
  updated webhook, OpenAICursor, ExecuteFlow, and vestigiumHook tests. Full suites green
  (test:hermetic, test:crystal).
- **Watch:** any NEW completion site or output-consuming surface must use `projectExitus` (producer) or
  value-detection (consumer) — not a literal `imageUrl`.
