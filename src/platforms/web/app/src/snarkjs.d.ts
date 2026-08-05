// Minimal ambient types for the snarkjs surface the ceremony uses. snarkjs ships no
// types; we only touch zKey.contribute for in-browser Phase-2 contributions.
declare module 'snarkjs' {
  export const zKey: {
    /**
     * Fold a contributor's entropy into a Phase-2 zkey.
     * @param zkeyOld  input: a Uint8Array, a URL string, or a fastfile mem descriptor.
     * @param zkeyNew  output: a fastfile mem descriptor `{ type: 'mem' }`; its `.data`
     *                 holds the resulting zkey bytes after the call.
     * @param name     contributor label recorded in the contribution.
     * @param entropy  high-entropy seed string (the toxic waste).
     */
    contribute(
      zkeyOld: Uint8Array | string | { type: 'mem'; data?: Uint8Array },
      zkeyNew: string | { type: 'mem'; data?: Uint8Array },
      name: string,
      entropy: string,
    ): Promise<unknown>;
  };
}
