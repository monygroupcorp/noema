declare module 'snarkjs'
declare module 'circomlibjs'

// Minimal jsonwebtoken surface — only what the API acceptors use (verify + sign).
// The legacy JS uses the full lib untyped; we type just the bits the TS side touches.
declare module 'jsonwebtoken' {
  export interface JwtPayload { [key: string]: unknown; sub?: string; userId?: string; _id?: string; id?: string }
  export function verify(token: string, secret: string): JwtPayload | string
  export function sign(payload: string | object | Buffer, secret: string, options?: object): string
  const _default: { verify: typeof verify; sign: typeof sign }
  export default _default
}
