# Spec — Vault wires to the live arcanum rail (in-browser notes + spend proofs)

**Date:** 2026-07-10 · **For:** a repo-context agent on `noema-crystal` · **Status:** spec, not started
**Context:** backend LIVE-VERIFIED 2026-06-13 (full anon flow: deposit → proof → Bursa purse →
run → delivery). This is the go-live-runway "frontend wallet + snarkjs" blocker.
**Prior art:** `docs/arcanum-bursa-frontend.md` · the ceremony screen's lazy-snarkjs pattern
(`lib/ceremony.ts:100`).

## Finding
`screens/Vault.tsx` is pure theater: hardcoded 12-word phrase (Vault.tsx:5), fake "38 credits"
(Vault.tsx:32,47), stub commitment/nullifier hex (Vault.tsx:57-60). The entire backend it
sketches EXISTS and answers on staging (`/arcanum/*`, 8 routes). Client-side proving code also
exists — but only server-side (`src/arcanum/prover.ts`, used by tests); the browser does none
of it yet.

## Goal
Vault = the anonymous credit wallet, all secrets client-side: create/hold notes, prove + mint
bearer purses, watch balances, export/import the secret material. Platform never sees
nullifier/secret.

## Shape
1. **Client crypto module** `src/platforms/web/app/src/lib/arcanum.ts` — browser port of the
   server prover (the functions are small; poseidon comes with circomlibjs or via snarkjs
   deps — mirror `src/arcanum/poseidon.ts:24-34` and `prover.ts:120-131`):
   - `generateNote(valor)` → {nullifier, secret} from `crypto.getRandomValues` (32B each);
   - `computeCommitment(nullifier, secret)` = poseidon2; `computeNullifierHash(nullifier)`;
   - `generateSpendProof(note, merkleProof, recipient)` → lazy `import('snarkjs')` +
     `groth16.fullProve`, wasm/zkey URLs from `GET /arcanum/config` (`wasmUrl`, `zkeyUrl`,
     `ready` — if `!ready`, Vault shows the honest "ceremony not finalized" state and links
     /ceremony);
   - `computeRecipient(modusId, aditus)` = sha256 binding, EXACTLY mirroring
     `prover.ts:86-93` (31-byte truncation — byte-for-byte compat or proofs verify false).
2. **Note store** — localStorage `noema-vault` (versioned JSON): notes
   `{nullifier, secret, valor, leafIndex, commitment, spent}` + minted purse tokens. THE
   dangerous state: add export (download JSON / reveal for manual copy) + import. The screen's
   existing "recovery phrase" UI becomes real by encoding the store — v1 can export raw JSON
   and keep the phrase UI as display-only; BIP39 encoding is a follow-up, not a blocker.
3. **Flows on the screen (api.ts client methods for each arcanum route):**
   - **Fund a note:** signed-in path first (v1): `POST /arcanum/issue {valor, commitment,
     nullifier}` converts identified balance → note (server inserts leaf, returns merkle path;
     store leafIndex). The on-chain deposit path (CreditVault → note) is [[project_arcanum_blind_issuance]] — OUT of this spec.
   - **Mint a purse:** pick note → `GET /arcanum/tree/proof/:leafIndex` (fresh root) →
     generateSpendProof → `POST /arcanum/purse {arcanumProof}` → {token, credits}; mark note
     spent; store token.
   - **Watch:** `GET /arcanum/purse/:token` per stored purse → live balances. Real stat tiles
     replace "38 credits".
   - **Spend:** purse token feeds runs via existing `RunRequest.bursaToken` (already in
     api.ts) — add a "use this purse" action that stashes the active token where Card/Run
     read it.
4. **Honesty guardrails:** loud "we cannot recover this" on note creation; export nudge before
   first mint; `ready:false` → whole mint path disabled with the ceremony link (no fiction).

## Acceptance
- Signed-in user: fund a 500-credit note → mint purse → run a cheap flow with `x-bursa-token`
  → purse balance drops — all from the Vault UI, zero server knowledge of secrets.
- Export → clear localStorage → import → purses/notes restored.
- `ready:false` config → screen honest, no crash.
- Hermetic: poseidon/commitment/recipient parity tests against the server implementations'
  fixtures (same inputs → same decimal strings as `tests/unit/arcanum/ArcanumProver.real.test.ts`).
- Proof generation happens in a worker or with a busy state — fullProve blocks ~seconds.

## Leads
- Routes+shapes: `src/api/arcanum/arcanumRouter.ts:74,150,190,210,234,259,280,298`.
- Server prover to mirror: `src/arcanum/prover.ts:42-131`, `src/arcanum/poseidon.ts:24-34`.
- Purse debit path (already live): `src/execution/ActumInceptor.ts:199-247`.
- snarkjs lazy-load pattern: `src/platforms/web/app/src/lib/ceremony.ts:100-102` + `snarkjs.d.ts`.
- NB: `api.ts`'s `commitment()` (random 24B, `x-commitment` header) is the IDENTITY commitment,
  NOT a ZK note commitment — unrelated value spaces; do not conflate or reuse.
