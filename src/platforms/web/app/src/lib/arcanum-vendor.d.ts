// Ambient module declarations for the untyped crypto vendors the Arcanum client uses.
// circomlibjs ships no types (server mirrors this via src/types/vendor.d.ts). The existing
// src/snarkjs.d.ts only declares zKey.contribute for the ceremony; this AUGMENTS the same
// ambient module with the groth16 surface the spend prover needs (ambient `declare module`
// blocks merge). Keep this file import/export-free so it stays ambient.

declare module 'circomlibjs'

declare module 'snarkjs' {
  export const groth16: {
    /**
     * Generate a Groth16 proof from a witness input + compiled circuit + proving key.
     * In the browser, wasm/zkey are URLs; snarkjs fetches them itself.
     */
    fullProve(
      input: Record<string, unknown>,
      wasmPath: string,
      zkeyPath: string,
    ): Promise<{ proof: object; publicSignals: string[] }>
  }
}
