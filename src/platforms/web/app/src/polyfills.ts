// Node globals for ZK deps in the browser. circomlibjs (blake-hash) reads `Buffer` at
// module init; vite.config.ts shims `global`/`process.browser` for snarkjs but Buffer is
// a real object, not a define. Must be the FIRST import in main.tsx so it runs before any
// chunk that pulls circomlibjs.
import { Buffer } from 'buffer';

if (!(globalThis as { Buffer?: typeof Buffer }).Buffer) {
  (globalThis as { Buffer?: typeof Buffer }).Buffer = Buffer;
}
