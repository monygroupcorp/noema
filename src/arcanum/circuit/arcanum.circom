pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";

// =============================================================================
// ArcanumSpend — ZK proof of anonymous credit note ownership
// =============================================================================
//
// Proves: "I know (nullifier, secret) such that:
//   - commitment = poseidon(nullifier, secret)
//   - leaf = poseidon(commitment, valor)
//   - leaf is in the Merkle tree with root `root`
//   - nullifierHash = poseidon(nullifier)"
//
// Public inputs (known to verifier):
//   root          — current Merkle root
//   nullifierHash — prevents replay without revealing which commitment was spent
//   valor         — credit amount; certifies the note is worth this much
//   recipient     — hash(modusId, aditus) — binds proof to this execution
//
// Private inputs (known only to the prover):
//   nullifier     — random value chosen at note creation
//   secret        — random value chosen at note creation
//   pathElements  — sibling hashes along the Merkle path
//   pathIndices   — 0 = left child, 1 = right child at each level
//
// SECURITY:
//   - nullifierHash is poseidon(nullifier), not poseidon(commitment, nullifier).
//     This means the verifier cannot derive the commitment from nullifierHash.
//   - leaf includes valor, so the proof is also a proof of the note's denomination.
//   - recipient prevents a proof generated for one execution being replayed for another.
// =============================================================================

// Swap two values based on a selector bit (0 = keep order, 1 = swap)
template DualMux() {
    signal input in[2];
    signal input s;
    signal output out[2];

    s * (1 - s) === 0;
    out[0] <== (in[1] - in[0]) * s + in[0];
    out[1] <== (in[0] - in[1]) * s + in[1];
}

// Verify a Merkle inclusion proof for `leaf` against `root`
template MerkleProof(levels) {
    signal input leaf;
    signal input root;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    component hashers[levels];
    component mux[levels];
    signal computedHash[levels + 1];
    computedHash[0] <== leaf;

    for (var i = 0; i < levels; i++) {
        hashers[i] = Poseidon(2);
        mux[i] = DualMux();
        mux[i].in[0] <== computedHash[i];
        mux[i].in[1] <== pathElements[i];
        mux[i].s <== pathIndices[i];
        hashers[i].inputs[0] <== mux[i].out[0];
        hashers[i].inputs[1] <== mux[i].out[1];
        computedHash[i + 1] <== hashers[i].out;
    }

    root === computedHash[levels];
}

// levels = Merkle tree depth. Must match the tree built by ArcanumTree.ts (20).
template ArcanumSpend(levels) {
    // ── Private inputs ───────────────────────────────────────────────────────
    signal input nullifier;
    signal input secret;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    // ── Public inputs ────────────────────────────────────────────────────────
    signal input root;
    signal input nullifierHash;
    signal input valor;
    signal input recipient;

    // ── 1. Derive commitment = poseidon(nullifier, secret) ───────────────────
    component commitmentHasher = Poseidon(2);
    commitmentHasher.inputs[0] <== nullifier;
    commitmentHasher.inputs[1] <== secret;
    signal commitment <== commitmentHasher.out;

    // ── 2. Derive leaf = poseidon(commitment, valor) ─────────────────────────
    component leafHasher = Poseidon(2);
    leafHasher.inputs[0] <== commitment;
    leafHasher.inputs[1] <== valor;
    signal leaf <== leafHasher.out;

    // ── 3. Verify nullifierHash = poseidon(nullifier) ────────────────────────
    component nullifierHasher = Poseidon(1);
    nullifierHasher.inputs[0] <== nullifier;
    nullifierHash === nullifierHasher.out;

    // ── 4. Verify leaf is in the Merkle tree ─────────────────────────────────
    component merkle = MerkleProof(levels);
    merkle.leaf <== leaf;
    merkle.root <== root;
    for (var i = 0; i < levels; i++) {
        merkle.pathElements[i] <== pathElements[i];
        merkle.pathIndices[i] <== pathIndices[i];
    }

    // ── 5. Bind proof to this execution (prevents front-running) ─────────────
    // recipient is a public input — constrain it so it can't be stripped
    signal recipientCheck <== recipient * recipient;
    _ <== recipientCheck;
}

// Depth 32 = 2^32 = ~4.3 billion notes.
// Compiled once. Never changed. No migration ever needed.
component main {public [root, nullifierHash, valor, recipient]} = ArcanumSpend(32);
