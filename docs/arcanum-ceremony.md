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

## After the ceremony: serving the key it produced

A finished transcript is only half of it. The proving key clients download has to be the
key that transcript names — otherwise the page can say "ceremony complete, final key
`dd96…`" while `/arcanum/circuit/zkey` hands out something else entirely, and from outside
nobody can tell.

So the beacon'd final key is published to the sequencer's custody, and the server serves it
from there:

```bash
CEREMONY_FINAL_ZKEY=/path/to/arcanum_final.zkey   # published into custody at boot
CEREMONY_FINALIZE=<sha256 of that file>           # seals the ceremony at that hash
```

The two must agree: a `CEREMONY_FINAL_ZKEY` that does not hash to `CEREMONY_FINALIZE` is
refused, and the key is published *before* the phase flips, so the ceremony never reads
finalized while the key it names is missing. A key too large to serve from the API goes on
R2 instead (`ARCANUM_ZKEY_URL`).

Anyone can check the running site against its own transcript, without trusting either:

```bash
curl -s https://noema.art/v1/ceremony | jq -r .finalHash
curl -s https://noema.art/arcanum/config | jq -r .zkeyHash
curl -s https://noema.art/arcanum/circuit/zkey | shasum -a 256
```

The `/ceremony` page makes that same comparison for you and prints what it found under the
transcript — including when it comes out wrong, which is the only version of this check worth
publishing. The curl above is how you confirm the page is not simply agreeing with itself.

All three are the same hash, or the ceremony's output is not what the site is serving. If
the final key is not published, `/arcanum/circuit/zkey` answers 503 and `/arcanum/config`
reports `ready: false` — the committed key is *not* served in its place, because it is not
the ceremony's output and serving it under a finished transcript would say that it was.

### When it serves nothing, which nothing is it?

`zkeySource: "none"` under a finished transcript is two different boxes wearing one answer,
and they want opposite work:

- **The custody was emptied**, by a deploy or a fresh box. Nothing else is wrong; publish the
  key here (`CEREMONY_FINAL_ZKEY`, or the mount below) and it is over.
- **The build predates the key.** This box is not missing a proving key at all — it is
  carrying one, and the ceremony finished after the image was built. No act on the box helps;
  what is deployed on it has to change.

So the refusal names both keys. `/arcanum/config` reports `imageKeyHash` — the sha256 of the
proving key *this build carries* — whenever that is not the key being served, and the 503 from
`/arcanum/circuit/zkey` carries `expectedHash` and `imageKeyHash` beside its reason:

```bash
curl -s https://noema.art/arcanum/config | jq '{zkeySource, zkeyHash, imageKeyHash}'
curl -s https://noema.art/api/health | jq -r .v     # which build that is
```

Two different hashes side by side is the second case; `imageKeyHash: null` is the first. Both
readings are available to anyone, from anywhere — which is the point. This diagnosis used to
exist only in the boot log, and a finished ceremony went unserved for ten days behind a page
that could say "not published here yet" and nothing more, because the one fact that would have
named the remedy was on the one surface nobody off the box can read.

The `/ceremony` page reads the same two fields and says which case it is in words.

The second case is now refused before it can ship. `tests/unit/arcanum/committedKeyIsTheCeremonys.test.ts`
hashes the tracked `arcanum_final.zkey` and compares it against the `finalHash` the ceremony
published, transcribed into the test from `GET /v1/ceremony`. Every other test here derives its
expected hash from the tracked file itself, so a key swapped for any other bytes proves itself and
the suite stays green while the site serves nothing; this one is the only comparison against a
number the tree does not get to choose. When a ceremony is re-run, that constant is updated from
its new transcript in the same commit that lands the new key.

`verification_key.json` must come from the same finalize run as the key being served: it is
exported from that exact zkey, and a proof made against a proving key whose verification key
the server does not hold will not verify.

That is not a detail to remember at the end. The two halves of a setup reach a running
server by different roads — the proving key follows the transcript out of ceremony custody,
the verification key is a JSON file baked into the image — so publishing the ceremony's key
against an image built before it leaves the site handing out one setup's proving key and
judging proofs with another's. Honest proofs are rejected, and the verification key still in
force is whichever the image carried: if that is the committed dev key, the forgery the
ceremony exists to close is still open, behind a page reporting that it closed.

So the server checks. `/arcanum/config` derives the verification key from the key it is
actually serving and reports `verifierPaired`; a known mismatch makes `ready` false and is
logged with the served key's hash, and the `/ceremony` page says the served key matches the
transcript *and* that the site cannot verify proofs made with it. `verifierPaired` is null,
not false, where the question cannot be answered — no key served, none held, or a key hosted
off this API — because a site that cannot check is not a site that failed the check.

Finalizing is therefore two artifacts, not one: publish the beacon'd zkey (above) and commit
the `verification_key.json` exported from that same zkey.

## Where the chain is kept, and why that is a mount

The transcript is a database record; the keys it names are files on the sequencer's disk,
under `CEREMONY_ZKEY_DIR` (content-addressed, `<sha256>.zkey`, about 5MB each). Those two
things survive different events. The record survives a deploy. The files only survive one
if the directory they are in is a mount — and the default is a directory inside the built
application, which on a container is part of the image and is replaced with it.

That is not a tidy-up: a ceremony whose custody is inside the image is a ceremony a routine
deploy ends. The record goes on publishing a chain head, `/v1/ceremony/current.zkey` has no
bytes to answer with, and every upload is refused for building on a head the server cannot
produce. `deploy.sh` and `docker-compose.prod.yml` mount `/opt/noema/ceremony` (override
with `CEREMONY_DIR`) at `/var/lib/noema/ceremony` and set `CEREMONY_ZKEY_DIR` to it. A
sequencer run any other way should have that directory pointed somewhere that outlives the
process.

That defence is two hand-written lines per file, and dropping either is invisible until a
contributor asks for a head that is gone — so `tests/unit/architecture/ceremonyCustodyIsMounted.test.ts`
holds them together. Whatever starts the production app has to set `CEREMONY_ZKEY_DIR` *and*
bind-mount a host directory at exactly that path, and the two files have to name the same
path as each other: a variable pointing at an unmounted directory is the in-image default
wearing a different name, and a mount under a path nothing reads is custody nobody keeps.

The status the page reads says which of the two is true. `acceptingContributions` is false
whenever the sequencer cannot hand out the head, whatever the phase says, and the page reads
"Ceremony open · contributions paused" rather than inviting a contribution into a 503.

### Putting a lost head back

The keys in the chain are not secret — every one of them is published by hash and was in a
contributor's browser — so a sequencer that lost its custody can be given the head back:

```bash
CEREMONY_HEAD_ZKEY=/path/to/the/head.zkey   # restored into custody at boot
```

It is checked against the head the transcript already publishes, and a file that hashes to
anything else is refused rather than installed under a name the record gives to other bytes.
Boot logs name the hash it is looking for when the head is missing.

### Putting a lost FINAL key back

`CEREMONY_HEAD_ZKEY` restores the head, and after the beacon the head is not what the site
serves. The final key is bytes the beacon produced from the head — a different file under a
different hash, and the one `/arcanum/circuit/zkey` resolves by, because the server looks up
`finalHash` and nothing else. So a finalized ceremony serving no key is not fixed by
restoring its head: that installs a real key, under a hash the record really does name, and
changes nothing a client can see.

```bash
CEREMONY_FINAL_ZKEY=/path/to/arcanum_final.zkey   # published into custody at boot
```

Custody is content-addressed, so this is equivalent to dropping the file in
`$CEREMONY_ZKEY_DIR/<its sha256>.zkey` by hand, and a running sequencer picks it up without
a restart: the served key is re-resolved until the lookup succeeds. Unnecessary when the
committed `arcanum_final.zkey` already hashes to the transcript's `finalHash` — the server
recognises that and serves it out of the image.

Both variables are one-time: once the bytes are in custody, and custody is the mount, they
stay there and the variable can come back out of the environment.

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
