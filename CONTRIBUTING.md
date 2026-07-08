# Contributing Guide

Welcome! Before diving into code, read **[`AGENTS.md`](AGENTS.md)** — it's the authoritative
onboarding and workflow doc (domain model, module boundaries, the hermetic verify loop, how to
pick up a task).

## Contributor License Agreement (required)

Before your first pull request can be merged, you must agree to our
**[Contributor License Agreement](CLA.md)**. You keep ownership of your work; the CLA grants
NOEMA a broad license (including the right to relicense) so the project can run an open-core
/ dual-licensing model. Agreement is a one-time step covering all your future contributions —
a CLA check on your PR will prompt you to confirm.

## Quick Start
1. Fork & clone the repo
2. Read `AGENTS.md` for the domain model and module boundaries
3. Create a branch: `git checkout -b feature/your-change`
4. Commit using conventional commits (`feat:`, `fix:`, etc.)
5. Open a PR

## Code Style & Verify
* Language: TypeScript, with semicolons.
* CSS: BEM-ish class naming, 2-space indent.

Run the hermetic gate before pushing — this is what CI's `verify` job runs, no live DB required:
```
npm run typecheck && npm run test:hermetic
```
`npm run test:crystal` needs a real MongoDB via `.env` (see `AGENTS.md`); CI runs it separately
against a Mongo service. Run it locally with a real `.env` when your change touches the crystal
or ledger layers.

## Thank You!
Your contributions help StationThis stay open, transparent, and fun. ❤️
