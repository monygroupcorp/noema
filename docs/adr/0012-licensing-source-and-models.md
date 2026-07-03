# ADR-0012: Licensing — platform source and user-trained models

- **Status:** proposed
- **Date:** 2026-07-02

## Context

We are formalizing licensing before go-live ("going pro"). Two legally distinct
objects have been governed only by instinct and prose comments, never by policy or
enforceable metadata:

1. **The crystal source itself** — how the platform code is licensed. Founder stance:
   maximally open, but prudent; the crypto layer should be *loudly* public (openness is a
   trust asset there), while abuse-prevention logic must not become a public bypass map.
2. **Model weights** — both the base models we host and the LoRAs users train on our GPUs.
   Today the only license record is prose in code comments
   (`src/crystal/seeds/fundamenta.ts:152`, `src/crystal/seeds/essentiae.ts:237`). There is
   **no structured, enforceable `license` field** on `Fundamentum`/`Intella`, so the
   platform cannot mechanically decide "may this run be sold / minted / published."

The load-bearing insight separating the two: **source license and model license are
unrelated legal objects.** Apache/AGPL govern the code that runs the platform; a model
license governs a bag of weights. A closed app can serve open weights and vice versa. They
live in separate drawers and this ADR keeps them separate.

Two license mechanics drive every decision below:

- **Permissive spreads; copyleft protects.** Permissive (Apache) charges no adoption tax
  but grants no protection. Copyleft/"viral" (AGPL) charges an adoption tax (integrators
  can't embed it in closed code) but blocks the silent hosted clone. Apply each where its
  behavior matches the layer's job.
- **The base-model floor.** A LoRA is a *derivative* of its base model and can never be
  freer than that base. A FLUX.1-**dev** (non-commercial) LoRA is non-commercial forever;
  the only way to de-encumber a concept is to **retrain it on a permissive base**, not to
  port weights. This is why the `ms2-klein` retraining backlog is a *license-cleaning*
  operation, not merely a quality upgrade.

## Decision

### Part A — Platform source: open by default, copyleft the core, hide only abuse logic

Three buckets, per-directory `LICENSE` files, SPDX headers on core files, and a root
`LICENSING.md` map so the boundary is unambiguous and machine-checkable.

| Bucket | What's in it | License | Rationale |
|---|---|---|---|
| **Edges — permissive** | `src/types/`, the `/v1` client SDK, MCP glue, spec docs (`docs/spec/`), ADRs, flow/spell + exitus schemas, **ZK circuits + ceremony** | **Apache-2.0** | These exist to be *adopted/embedded in closed code* — integrators, agent harnesses, third-party clients. Copyleft here would repel the exact integrations that are our soft lock-in. Publishing the ZK layer is a deliberate trust signal. |
| **Core — defended** | crystal server, `Compiler`, executors, `src/execution/`, `src/ledger/` runtime, `Editio` | **AGPL-3.0** | This is the cloneable-into-a-hosted-competitor surface. AGPL's network-copyleft forces a hosted fork to publish its changes while keeping the code genuinely open (OSI-approved — the "every line is open" claim holds). |
| **Abuse surface — private** | CSAM/NCMEC scanning logic + thresholds, OFAC screening rules, moderation-gate internals, trust-boundary checks, ops runbooks, deploy/GPU secrets | **Not published** (separate private repo, injected at deploy) | Publishing these only helps abusers evade them. The *port/interface* stays public (an open `ModerationGate` seam with a stub); the *implementation* is private. Protecting users beats ideological purity. |

We will **NOT** license the whole repo permissively (forfeits clone protection for no gain
over AGPL on trust), and will **NOT** license it all copyleft (taxes the adoption we want
at the edges). We require a lightweight **CLA** on the AGPL core before the first external
PR, to preserve future dual-license / enterprise-edition optionality.

Public story, fully truthful: *"NOEMA is open source. Protocol and SDK are Apache. The
platform core is AGPL. The ZK credit system is fully public and auditable. The only thing
we don't publish is child-safety and sanctions-screening logic — because publishing it
helps abusers evade it."*

### Part B — Model weights: users own what they train, floored by the base license

**1. Structured license metadata (the enforcement seam).** Add a machine-readable
`license` descriptor to `Fundamentum`/`Intella` (SPDX id + `commercialUse: boolean` +
optional `commercialCap` + `attributionRequired`). The platform reads this to gate
sell/mint/publish — no more trusting that a human read a license comment. This is the
crystal-first core of the whole ADR: policy becomes a field, not prose.

**2. Base-model floor is enforced at train time.** Users may only train on bases whose
license permits the intended downstream use. **Permissive bases are the catalog default**,
because they leave the entire downstream tree free and sellable. Confirmed clean bases:
FLUX.1 **schnell** (Apache-2.0) and **FLUX.2 klein 4B** (Apache-2.0 — verified against
BFL's release). **⚠ klein *9B* is non-commercial** — excluded as a commercial base.
FLUX.1-**dev** is retired as a training base (its LoRAs are permanently non-commercial);
the `ms2-klein` backlog retrains those concepts onto **klein 4B** to de-encumber them.

**3. Ownership & grants for user-trained LoRAs.**
- **The user owns their trained LoRA.** The platform does not claim ownership.
- **The platform receives a license grant** (not ownership): to host, serve, and execute
  the LoRA and to apply royalty accounting (`modelRoyaltyHook`, Editio splits).
- **The trainer chooses the openness tier**, clamped by the base floor: *Private* (only
  they run it) / *Catalog* (others run it; trainer earns a royalty split) / *Open release*
  (published freely, e.g. to the HF org, no royalty).
- **Training-data rights are the user's responsibility** — a required attestation on
  dataset upload keeps us a neutral compute provider, mirroring the catalog-vs-BYO
  liability split one layer down.

**4. Commercial-cap licenses (Krea-class) are a platform obligation, not a user one.**
A capped community license attaches to **the licensee that runs the weights**. When a
capped model sits in our catalog, **NOEMA is the licensee.** Krea 2's actual text (verified)
measures the cap on **"total company-wide annual revenue < $1M, trailing twelve months,
including all revenue from all sources"** — *not* the revenue attributable to Krea. So the
cap trips on NOEMA's **total** revenue: $1.1M from credit sales with only $20k of Krea
generations **still triggers it**, and we must then cease commercial use and obtain a Krea
enterprise license (opensource@krea.ai). Credits sold to users for cash are revenue; we
cannot argue "credits aren't money" to a model licensor while selling them for USD.
Consequence: **a successful platform crosses this cap almost immediately regardless of how
lightly the capped model is used.** Therefore **capped-license models are excluded from the
commercial catalog unless we pre-negotiate a platform-wide commercial license; otherwise
they live only in BYO/private tiers, where the user is the direct licensee.** Uncapped
(Apache) bases — schnell, klein 4B — remain the default precisely because they carry no
such ceiling.

## Consequences

- **Enforcement.** The `license` field on `Fundamentum`/`Intella` becomes the gate for
  sell/mint/publish in Editio; a test asserts every catalog model carries a valid
  descriptor and that `commercialUse:false` models cannot reach a commercial export path.
  The prose comments in `fundamenta.ts`/`essentiae.ts` migrate into this field.
- **Easier:** a clean, defensible "going pro" story; mechanical (not human-judgment)
  decisions about what may be monetized; a truthful maximal-openness public narrative.
- **Harder / follow-ups (open):**
  1. ~~Verify FLUX.2 klein's license~~ — **resolved: klein 4B is Apache-2.0** (klein 9B is
     non-commercial, excluded). klein 4B is the confirmed clean base.
  2. Finish the `ms2-klein` retraining backlog to de-encumber the dev-trained LoRAs.
  7. Decide on Krea 2: pre-negotiate a platform commercial license, or restrict it to
     BYO/private tiers — it is a commercial-catalog time bomb above $1M total revenue.
  3. Implement the `license` descriptor type + backfill the catalog.
  4. ~~Formalize the `ModerationGate` port so the compliance impl lifts cleanly into a
     private module before go-live.~~ — **DONE 2026-07-02**: the port + fail-closed stubs
     stay public (`src/crystal/ModerationGate.ts`); the real CSAM/NCMEC gate (detection
     logic, thresholds, hash-set loader, NCMEC report assembly) lives in the gitignored
     `src/private/compliance` module, injected at deploy. `src/index.ts` loads it via a
     guarded dynamic import (variable path → a public build compiles + runs fail-closed
     without it). **OFAC `SanctionsScreen` moved private too** (2026-07-02): the port +
     `permissiveSanctionsScreen` stub stay public; `makeBlocklistScreen` + the SDN loader +
     `configureSanctionsScreen` are private. The private module is its own repo,
     **`monygroupcorp/noema-compliance` (PRIVATE)**, cloned into `src/private/` at deploy:
     `git clone git@github.com:monygroupcorp/noema-compliance.git src/private`. The detection
     DATA (known-CSAM hash sets, OFAC snapshots) is provisioned out-of-band, never committed
     even to the private repo.
  5. Draft the CLA and the per-bucket `LICENSE` files + root `LICENSING.md`.
  6. Decide (founder call, deferred): does `Editio` stay AGPL-core, or move to the Apache
     edge to seed a publishing/royalty ecosystem?
- **Legal note:** crossing a model's commercial cap or shipping the ToS that encodes the
  ownership/grant language above warrants counsel review — this ADR is the engineering
  policy, not legal advice.
