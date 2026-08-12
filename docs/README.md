# Documentation

This directory explains the project: what it is, how it is designed, how to run it, and what the
rules are. If you are new here, start with `north-star.md` and then `adr/`.

`docs/` is published deliberately. A file belongs here when it helps someone reading the repo
understand the system as it stands today — the architecture, an interface, a decision and its
reasoning, a procedure they need to follow. Working notes that track how we got somewhere live
outside the repo, so that what remains stays short enough to be worth reading.

New paths under `docs/` are private by default; `.gitignore` names the published ones explicitly.
To publish something new, add it to that list in the same change.

## Orientation

| Document | What it covers |
|---|---|
| [north-star.md](north-star.md) | The principles. Build for the full case; the simple case is a config. |
| [capability-map.md](capability-map.md) | The signature matrix and canon verbs — the command surface. |
| [PROTOCOL_CHARTER.md](PROTOCOL_CHARTER.md) | The protocol's scope and commitments. |
| [TEST_SPEC.md](TEST_SPEC.md) | What the test suites cover and which gate runs where. |

## Design and decisions

| Path | What it covers |
|---|---|
| [adr/](adr/) | Architecture decision records — the durable decisions, with their reasoning. Honor these. |
| [spec/](spec/) | Component specifications: schemas, triage, publishing, moderation, ledger, licensing. |
| [embed-spec.md](embed-spec.md) | The embed surface. |

## Interfaces

| Path | What it covers |
|---|---|
| [api/](api/) | HTTP API reference and the OpenAPI document. |
| [x402/](x402/) | The x402 payment protocol integration: architecture, data models, configuration, testing. |

## Arcanum

| Document | What it covers |
|---|---|
| [arcanum-ceremony.md](arcanum-ceremony.md) | The multi-party trusted-setup ceremony guide, for contributors. |
| [arcanum-blind-issuance.md](arcanum-blind-issuance.md) | Blind issuance design. |
| [arcanum-bursa-frontend.md](arcanum-bursa-frontend.md) | The bursa frontend. |

## Operating it

| Path | What it covers |
|---|---|
| [ops/production-deploy.md](ops/production-deploy.md) | Deploying to production. |
| [ops/staging-deploy.md](ops/staging-deploy.md) | Deploying to staging. Read it before you deploy. |

## Reference

| Path | What it covers |
|---|---|
| [legal/](legal/) | Privacy policy, terms, cookie policy, and the compliance landscape. |
| [site/](site/) | Marketing site copy. |
| [reference/discord-parity.md](reference/discord-parity.md) | Feature parity notes for the Discord surface. |
| [benchmarks/](benchmarks/) | GPU provider cold-start benchmarking and its conclusion. |
