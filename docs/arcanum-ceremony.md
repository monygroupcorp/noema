# Arcanum Trusted Setup Ceremony

## What is this and why does it matter?

The Arcanum anonymous credit system uses Groth16 zero-knowledge proofs. Groth16
requires a one-time setup that produces two keys:

- **Proving key** (`arcanum_final.zkey`) — used by clients to generate proofs
- **Verification key** (`verification_key.json`) — used by the server to verify proofs

During setup, each participant contributes secret randomness called **toxic waste**.
If anyone ever knows the toxic waste of *every single contributor*, they can forge
proofs — creating fake anonymous notes from nothing, spending credits they don't have.

**The security guarantee:** if even ONE contributor truly destroys their toxic waste,
the system is secure forever. You cannot reverse-engineer others' contributions.

This is the same model used by Zcash, Tornado Cash, and the broader Hermez/Polygon
ecosystem. It is well-understood and battle-tested.

---

## Phase 1 vs Phase 2

**Phase 1 — Powers of Tau** (already done, not your concern)

The Hermez Network ran a public Phase 1 ceremony with 90+ contributors in 2021.
Their output (`pot28_hez_final_20.ptau`) is universally trusted and reusable across
all circuits. We download it once. No action needed from participants.

**Phase 2 — Circuit-specific** (this is the ceremony)

Phase 2 is specific to the Arcanum circuit (`arcanum.circom`). It starts from the
Phase 1 output and adds circuit-specific setup. Each contributor adds a layer of
randomness. This is what you are participating in.

The circuit was compiled with depth=32 (4.3 billion notes). It is permanent — the
same circuit will be used forever. The ceremony only needs to happen once.

---

## Who should participate

Anyone who has a stake in the system being trustworthy. Ideal participants:

- Core team members
- Early community members / testers
- Anyone who will use anonymous notes themselves

Minimum: **1 participant** (solo setup, trust yourself only).
Recommended: **3–5 participants**.
More is better, but diminishing returns after ~5.

You do not need to trust each other. The setup is secure as long as one of you
destroys their randomness. You only need to be independently not-all-compromised.

---

## What participants need to install

```
node >= 18
npm install -g snarkjs
```

That is it. You do not need circom. You do not need to understand ZK math.
The contribution is a single command that takes about 2 minutes.

---

## Coordinator instructions

The coordinator runs setup start-to-finish and collects contributions from others.

### Step 1: Initial setup (run once, before anyone contributes)

```bash
./scripts/arcanum-trusted-setup.sh --init
```

This:
1. Downloads the Hermez Powers of Tau file (~700MB, cached)
2. Compiles the circuit (requires `circom` installed: `npm install -g circom`)
3. Runs Phase 2 `groth16 setup` to produce `arcanum_0000.zkey`
4. Prints a hash of `arcanum_0000.zkey` — include this in your ceremony announcement

### Step 2: Send `arcanum_0000.zkey` to the first contributor

Share the file securely (private link, encrypted transfer, S3 bucket, etc.).
Also share the hash so they can verify they received the right file.

### Step 3: Collect contributions in order

Each contributor returns a new `.zkey` file named `arcanum_000N.zkey`.
Verify each using `snarkjs zkey verify` before passing to the next contributor:

```bash
snarkjs zkey verify \
  src/arcanum/circuit/artifacts/arcanum.r1cs \
  src/arcanum/circuit/artifacts/pot20_final.ptau \
  src/arcanum/circuit/artifacts/arcanum_000N.zkey
```

### Step 4: Finalize

Once all contributions are collected, apply the random beacon:

```bash
./scripts/arcanum-trusted-setup.sh --finalize arcanum_000N.zkey
```

This applies a public random beacon (block hash, drand output, or similar) as the
final contribution, then exports `verification_key.json`.

### Step 5: Publish the ceremony transcript

Publish:
- The hash of each `.zkey` file (before and after each contribution)
- Each contributor's attestation (see below)
- The final `verification_key.json`

Commit `verification_key.json` to the repo. Do NOT commit `.zkey` files — they
are large (~300MB). Host them separately if clients need the proving key.

---

## Contributor instructions

You will receive a `.zkey` file from the coordinator or the previous contributor.

### Step 1: Verify what you received

```bash
snarkjs zkey verify \
  src/arcanum/circuit/artifacts/arcanum.r1cs \
  src/arcanum/circuit/artifacts/pot20_final.ptau \
  arcanum_previous.zkey
```

If this fails, do not contribute — contact the coordinator.

### Step 2: Contribute your randomness

```bash
snarkjs zkey contribute \
  arcanum_previous.zkey \
  arcanum_yourname.zkey \
  --name="Your Name or Handle" \
  -v
```

You will be prompted to enter a random string. Type something only you know —
keyboard mashing is fine. This is your toxic waste. **The security of the system
requires you to NOT save or share this string** (and to not use something predictable
like your name).

The command prints a contribution hash. Copy it.

### Step 3: Delete your input and send your output

```bash
rm arcanum_previous.zkey
```

Deleting the input `.zkey` is the critical act. Your toxic waste lives in the
difference between input and output. Once you delete the input, it is
computationally infeasible to recover your contribution.

Send `arcanum_yourname.zkey` to the coordinator.

### Step 4: Attest

Send the coordinator a message (email, Telegram, Discord) containing:

```
Arcanum ceremony contribution
Contributor: [your name/handle]
Input hash:  [hash of the file you received]
Output hash: [contribution hash printed by snarkjs zkey contribute]
I have deleted my input file and my entropy.
```

This message is your public attestation. It will be included in the ceremony
transcript.

---

## Verifying the final setup (anyone can do this)

Anyone can verify the final `.zkey` is a valid continuation from the Phase 1 ptau:

```bash
snarkjs zkey verify \
  src/arcanum/circuit/artifacts/arcanum.r1cs \
  src/arcanum/circuit/artifacts/pot20_final.ptau \
  src/arcanum/circuit/artifacts/arcanum_final.zkey
```

This confirms:
- The proving key is consistent with the circuit
- The proving key is consistent with the Phase 1 ceremony
- All contributions are structurally valid

It does NOT require trusting anyone — it is a mathematical verification.

### What `zkey verify` does not tell you

It proves the key you hold is *a* valid chain of contributions. It cannot tell you the
chain is *the* one the transcript published: a key that forks off an earlier point and
drops every contribution since is, on its own, just as valid. So compare the two — the
contributions inside the key must match the published transcript link for link, same
order, nothing missing.

The sequencer enforces this on the way in. An upload is checked against the bytes of the
key it was handed, not against the `x-based-on` hash the client claims, so a fork that
drops contributions is refused however it labels itself.

---

## After the ceremony: wiring the verifier

Once `verification_key.json` is in `src/arcanum/circuit/artifacts/`, load it in
the container config:

```typescript
import verificationKey from './src/arcanum/circuit/artifacts/verification_key.json' assert { type: 'json' }
import { makeSnarkjsVerifier } from 'noema-crystal'

const ring = createContainer(mongo, {
  // ... other config ...
  arcanumVerifyFn: makeSnarkjsVerifier(verificationKey),
})
```

Without `arcanumVerifyFn`, all ZK spend proofs are rejected with:
`arcanumVerifyFn not configured — run arcanum-trusted-setup.sh`

---

## Security notes

**The circuit is permanent.** The proving key is tied to this exact circuit
(depth=32, Poseidon). If the circuit ever changes, a new ceremony is required.
The circuit will not change — depth 32 holds 4.3 billion notes.

**The verification key is small (~2KB) and can be bundled server-side.**
The proving key is ~300MB and is fetched client-side (WASM).

**Proof generation happens on the client.** The server never sees nullifier or
secret. The server only sees `nullifierHash`, `valor`, `root`, `recipient` —
none of which can identify the note or its owner.

**The Hermez ptau file is public and auditable.** Its hash is:
`0x9e25f8...` (verify against https://github.com/iden3/snarkjs#7-prepare-phase-2)

---

## Quickstart: solo dev setup (not for production)

If you just need to run locally without a ceremony:

```bash
./scripts/arcanum-trusted-setup.sh
```

This runs a solo setup with `dev-entropy`. Suitable for development only.
Anyone who ran this script could forge proofs on that key.
