# Octra as Noema's Confidential Economics Layer — North Star

**Status:** Vision / north-star. Not a build spec. The payment rail
([`octra-blind-issuance.md`](./octra-blind-issuance.md)) is step 1 of this.

This document captures *where Octra actually fits Noema* beyond the payment rail,
and the organizing principle that makes the roadmap coherent rather than a
grab-bag of "blockchain features."

---

## The core reframe: privacy has two axes, not one

Stop thinking "private vs. not private." Think in two **independent** dimensions:

| Axis | Question | Hidden by | Who holds the secret |
|---|---|---|---|
| **Identity** | *Who did this?* | **ZK / Arcanum** | the user (proves about their own secret) |
| **Value** | *What were the amounts?* | **FHE / Octra** | computed by others who *can't read it* |

These are orthogonal. You can have either, both, or neither. Noema's crystal
**already** owns the identity axis as a schema invariant: the `animaId`
(identified) vs `commitment` (anonymous) partition, with the ZK nullifier as the
only one-way bridge across it. Octra adds a **second axis Noema does not currently
have**: confidentiality of *values*.

The interesting territory — the part worth building toward — is the **corner
where both axes are on at once.**

---

## The discipline: when does FHE actually earn its place?

ZK and FHE are good at genuinely different things. Misapplying one as the other
is the root of all the hype-confusion.

- **ZK proves something about a secret *you hold*.** "I know a valid note." "My
  balance covers this." The prover already has the data.
- **FHE lets *someone else* compute on secrets they *cannot read*.** The platform,
  or a shared on-chain Circle, evaluates `f(x)` over many users' ciphertexts and
  never decrypts.

**The test:** *does the platform need to compute across other people's secrets?*

- **No** — an individual just needs to prove entitlement → **ZK alone suffices.**
  (Notably, confidential *note amounts* are ZK-doable Zcash-style; you do **not**
  need FHE for that. Don't sprinkle FHE where ZK already works.)
- **Yes** — the platform must **accumulate, match, or aggregate over many secret
  values** → **that is FHE's actual sweet spot, and ZK cannot do it.**

That rule is what selects which Noema features genuinely want Octra.

---

## What Octra is NOT for

To keep this honest: Octra (and FHE generally) is the **wrong tool** for Noema's
heavy compute — diffusion, LLM inference, training. FHE evaluates boolean/arith
circuits at many orders of magnitude slowdown; it cannot run GPU workloads at
usable speed. The "run Noema itself homomorphically so the GPU never sees the
prompt" dream is not reachable with FHE. That blindness, if ever wanted, needs
**confidential-compute hardware (TEEs)**, not Octra.

So the clean division:

- **Heavy compute** (ComfyUI / diffusion / training) → GPUs (+ TEEs for blindness).
  Octra can't touch this.
- **Economics + privacy** (credits, payments, royalties, entitlements, anonymity)
  → ZK (identity) + Octra/FHE (value). **This is the layer Octra is excellent at.**

Octra owns *money / value / policy* (small computations over secret numbers).
GPUs own *media generation* (huge compute). We are not bolting FHE onto the wrong
layer — we are putting it exactly where it is strong.

---

## The composition zone — features that need BOTH axes

These fail with ZK-alone and fail with FHE-alone; only the combination works.
Ordered grounded → ambitious.

### 1. Anonymous royalties (the standout — chase this first)

Noema pays spell-authors and model-authors per use. Even with anonymous spenders,
a naive design still logs "spell X used → owe author Y" — recreating the exact
usage trail we promised not to keep.

- ZK alone: hides *who spent* — but a per-use royalty ledger still exists.
- FHE alone: hides *the accrual* — but the spender is identified.
- **Both:** user spends an Arcanum note (ZK → no identity); the royalty owed flows
  into the author's **FHE-encrypted royalty pot** via homomorphic addition (FHE →
  platform sums without holding any per-use record). No spender identity, **no
  usage log to subpoena**, author still decrypts their own running total.

Why first: homomorphic *addition* is the easiest FHE operation, and the use case
is real and directly on-ethos. Maps onto existing hooks (`spellRoyalty`,
`modelRoyalty`).

### 2. Confidential anonymous host economy

The host/guest pod economy: guests pay via anonymous notes (ZK); each host's
earnings **accumulate encrypted** (FHE), so a host learns their own take but the
platform never sees who earned what. The ambassador bonus / host-cut logic
(`hospitiumHook`, `hostCut`) become homomorphic accruals.

### 3. The fully-blind credit balance

The `Signum` ledger, but the *balance itself* is an Octra ciphertext the platform
**decrements homomorphically** as the holder spends — while the holder stays
anonymous via ZK. An account nobody (including the platform) can see the owner
*or* the balance of, yet which still enforces "you can't spend what you don't
have." This is the literal "blind account" the original vision reached for —
reachable on the *economics* layer, not the compute layer.

### 4. The settlement Circle (the deep one)

The full form. Octra **Circles** (isolated execution environments) hold shared
encrypted state. Move Noema's *economic core* — the append-only lock/settle/refund
logic of `Signorum` — into an Octra Circle as encrypted shared state. The platform
runs settlement as homomorphic operations over balances it cannot read; ZK notes
authorize the spends; GPUs keep running off-chain in the clear.

**Noema's money-brain runs encrypted on Octra; its compute-brain runs on GPUs.**
That is the coherent, honest version of "blind Noema" — not diffusion-under-FHE
(impossible), but economics-under-FHE (possible).

---

## The linchpin: WHO can decrypt?

This makes or breaks everything above. **FHE preserves privacy only if Noema
cannot decrypt.** If the platform holds the FHE secret key, every "confidential"
balance and royalty pot is theater — the operator could read it all.

So decryption authority **must** be pushed away from the platform:

- **Client-held keys** — the user/author decrypts their own balance/pot. Simple,
  strong; no recovery (lose key = lose funds — the same bearer-instrument tradeoff
  Arcanum already makes).
- **Threshold decryption** — no single party (not even Noema) can decrypt alone;
  requires a quorum. More robust, more complex.

**This is THE design decision.** Get it right → the confidential-economics layer
is genuinely trustless toward the operator (exactly the ethos). Get it wrong →
privacy cosplay. Decide it before building any of 1–4.

---

## The honest hard parts

- **Circuit immutability.** Arcanum's tree is "chosen once, never changed," and
  `valor` is currently a **public** signal in the circuit. Anything that changes
  how value is encoded means a **parallel v2 note system** with its own anonymity
  set — never an in-place edit/migration. Plan additively.
- **Bridging two crypto systems.** snarkjs Groth16 (off-chain) and Octra FHE state
  (on-chain) are different worlds. The clean seam: platform verifies the ZK proof
  off-chain → that authorizes a homomorphic state mutation in the Circle.
  Designing that handshake is the core engineering.
- **FHE throughput.** Slow per-op — but economic operations are tiny and
  infrequent vs. a diffusion run. Latency that would kill image-gen is a rounding
  error on a credit decrement. Precisely why economics is FHE's right home.

---

## Staged path (each step reuses the last; none needs blind GPU compute)

1. **Payment rail** (in progress) — proves the Octra integration end-to-end; the
   foundation everything else reuses.
2. **Anonymous royalty pots** — smallest, highest-ethos win; homomorphic addition;
   introduces the encrypted-accrual pattern.
3. **Blind credit balance** — confidential `Signum` variant; forces the
   key-custody decision in earnest.
4. **Settlement Circle** — once 2–3 prove the ZK→FHE handshake, lift the economic
   core into a Circle.

---

## One-line summary

We are not building a private app *on* a private chain. We are building a
**two-axis privacy system**: Noema supplies **identity-anonymity (ZK)**, Octra
supplies **value-confidentiality (FHE)**, and the product magic is the handful of
features that need **both at once** — starting with anonymous royalties.
