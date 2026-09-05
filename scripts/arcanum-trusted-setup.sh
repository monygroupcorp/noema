#!/usr/bin/env bash
# =============================================================================
# arcanum-trusted-setup.sh — compile circuit + run Groth16 trusted setup
# =============================================================================
#
# Usage:
#   ./scripts/arcanum-trusted-setup.sh              # solo dev setup (not for production)
#   ./scripts/arcanum-trusted-setup.sh --init       # coordinator: compile + Phase 2 init
#   ./scripts/arcanum-trusted-setup.sh --finalize <file.zkey>  # coordinator: finalize after contributions
#
# See docs/arcanum-ceremony.md for the full multi-party ceremony guide.
#
# PREREQUISITES:
#   npm install -g circom        # circuit compiler (Rust-based)
#   npm install -g snarkjs       # proof system CLI
#   npm install                  # installs circomlib (needed for circuit includes)
# =============================================================================

set -euo pipefail

CIRCUIT_DIR="src/arcanum/circuit"
ARTIFACTS_DIR="$CIRCUIT_DIR/artifacts"
PTAU_FILE="$ARTIFACTS_DIR/pot20_final.ptau"
PTAU_URL="https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_20.ptau"

MODE="${1:-solo}"
FINAL_KEY="${2:-}"

mkdir -p "$ARTIFACTS_DIR"

# ── Shared: download ptau + compile circuit ───────────────────────────────────

download_ptau() {
  echo "=== Powers of Tau (Hermez Phase 1 ceremony) ==="
  if [ ! -f "$PTAU_FILE" ]; then
    echo "Downloading hermez ptau (~700MB, cached after first run)..."
    curl -L "$PTAU_URL" -o "$PTAU_FILE"
  else
    echo "ptau file already cached."
  fi
}

compile_circuit() {
  echo ""
  echo "=== Compile circuit ==="
  if [ ! -d "node_modules/circomlib" ]; then
    echo "ERROR: circomlib not found. Run: npm ci"
    exit 1
  fi
  circom "$CIRCUIT_DIR/arcanum.circom" \
    --r1cs \
    --wasm \
    --sym \
    -o "$ARTIFACTS_DIR/" \
    -l node_modules \
    --O2
  # circom writes wasm into arcanum_js/ subdirectory — copy up for convenience
  if [ -f "$ARTIFACTS_DIR/arcanum_js/arcanum.wasm" ]; then
    cp "$ARTIFACTS_DIR/arcanum_js/arcanum.wasm" "$ARTIFACTS_DIR/arcanum.wasm"
  fi
  echo "Constraints:"
  node_modules/.bin/snarkjs r1cs info "$ARTIFACTS_DIR/arcanum.r1cs"
}

export_vkey() {
  echo ""
  echo "=== Export verification key ==="
  node_modules/.bin/snarkjs zkey export verificationkey \
    "$ARTIFACTS_DIR/arcanum_final.zkey" \
    "$ARTIFACTS_DIR/verification_key.json"
  echo "verification_key.json written."
}

verify_final() {
  echo ""
  echo "=== Verify final setup ==="
  node_modules/.bin/snarkjs zkey verify \
    "$ARTIFACTS_DIR/arcanum.r1cs" \
    "$PTAU_FILE" \
    "$ARTIFACTS_DIR/arcanum_final.zkey"
}

# ── Mode: --init (coordinator, start of ceremony) ─────────────────────────────

if [ "$MODE" = "--init" ]; then
  echo "=== CEREMONY INIT ==="
  echo "This produces arcanum_0000.zkey for the first contributor."
  echo "See docs/arcanum-ceremony.md for the full ceremony guide."
  echo ""

  download_ptau
  compile_circuit

  echo ""
  echo "=== Phase 2 setup ==="
  node_modules/.bin/snarkjs groth16 setup \
    "$ARTIFACTS_DIR/arcanum.r1cs" \
    "$PTAU_FILE" \
    "$ARTIFACTS_DIR/arcanum_0000.zkey"

  echo ""
  echo "=== Hash of arcanum_0000.zkey (include in ceremony announcement) ==="
  shasum -a 256 "$ARTIFACTS_DIR/arcanum_0000.zkey"

  echo ""
  echo "=== INIT DONE ==="
  echo "Send arcanum_0000.zkey to the first contributor."
  echo "Contributors run: snarkjs zkey contribute arcanum_N.zkey arcanum_N+1.zkey --name='...' -v"
  echo "When done, run: ./scripts/arcanum-trusted-setup.sh --finalize arcanum_final_contribution.zkey"
  exit 0
fi

# ── Mode: --finalize (coordinator, end of ceremony) ───────────────────────────

if [ "$MODE" = "--finalize" ]; then
  if [ -z "$FINAL_KEY" ]; then
    echo "ERROR: --finalize requires a .zkey file argument"
    echo "Usage: ./scripts/arcanum-trusted-setup.sh --finalize arcanum_last_contribution.zkey"
    exit 1
  fi
  if [ ! -f "$FINAL_KEY" ]; then
    echo "ERROR: file not found: $FINAL_KEY"
    exit 1
  fi

  echo "=== CEREMONY FINALIZE ==="
  echo "Applying random beacon and exporting final keys..."
  echo ""

  # Verify the last contribution is valid
  echo "=== Verify last contribution ==="
  node_modules/.bin/snarkjs zkey verify \
    "$ARTIFACTS_DIR/arcanum.r1cs" \
    "$PTAU_FILE" \
    "$FINAL_KEY"

  # Apply a public random beacon as the final contribution.
  # Using current Ethereum mainnet block hash as the beacon — public, unpredictable,
  # verifiable. Replace with drand output or any other public randomness if preferred.
  BEACON_HASH=$(curl -sf "https://api.blockcypher.com/v1/eth/main" | python3 -c "import sys,json; print(json.load(sys.stdin)['hash'])" 2>/dev/null || echo "")
  if [ -z "$BEACON_HASH" ]; then
    echo "WARNING: Could not fetch Ethereum block hash. Using timestamp as beacon."
    BEACON_HASH=$(date +%s%N | sha256sum | head -c 64)
  fi
  echo "Random beacon: $BEACON_HASH"

  node_modules/.bin/snarkjs zkey beacon \
    "$FINAL_KEY" \
    "$ARTIFACTS_DIR/arcanum_final.zkey" \
    "$BEACON_HASH" \
    10 \
    -n="Final beacon contribution"

  export_vkey
  verify_final

  echo ""
  echo "=== FINALIZE DONE ==="
  echo "Publish:"
  echo "  - docs/arcanum-ceremony.md with all contributor attestations"
  echo "  - $ARTIFACTS_DIR/verification_key.json  (commit to repo)"
  echo "  - The hash chain from arcanum_0000.zkey through the final key"
  echo ""
  shasum -a 256 "$ARTIFACTS_DIR/arcanum_final.zkey"
  exit 0
fi

# ── Mode: solo dev setup (default) ────────────────────────────────────────────

echo "=== SOLO DEV SETUP (not for production) ==="
echo "For a production ceremony, see docs/arcanum-ceremony.md"
echo ""

download_ptau
compile_circuit

echo ""
echo "=== Phase 2 setup ==="
node_modules/.bin/snarkjs groth16 setup \
  "$ARTIFACTS_DIR/arcanum.r1cs" \
  "$PTAU_FILE" \
  "$ARTIFACTS_DIR/arcanum_0000.zkey"

echo ""
echo "=== Solo contribution (dev entropy) ==="
echo "dev-entropy-$(date +%s)" | node_modules/.bin/snarkjs zkey contribute \
  "$ARTIFACTS_DIR/arcanum_0000.zkey" \
  "$ARTIFACTS_DIR/arcanum_final.zkey" \
  --name="dev-setup" \
  -v

export_vkey
verify_final

echo ""
echo "=== DONE ==="
echo "Artifacts in $ARTIFACTS_DIR/:"
echo "  arcanum_js/arcanum.wasm   — client-side proving (fetch for WASM)"
echo "  arcanum_final.zkey        — proving key (large, distribute to clients)"
echo "  verification_key.json     — verification key (bundle server-side)"
echo ""
echo "To wire the verifier in container config:"
echo "  import vKey from './src/arcanum/circuit/artifacts/verification_key.json'"
echo "  import { makeSnarkjsVerifier } from 'noema-crystal'"
echo "  arcanumVerifyFn: makeSnarkjsVerifier(vKey)"
