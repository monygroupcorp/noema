declare module 'snarkjs'
declare module 'circomlibjs'

// Minimal jsonwebtoken surface — only what the API acceptors + JWKS verifier use.
// The legacy JS uses the full lib untyped; we type just the bits the TS side touches.
declare module 'jsonwebtoken' {
  export interface JwtPayload {
    [key: string]: unknown
    iss?: string; sub?: string; aud?: string | string[]; exp?: number
    userId?: string; _id?: string; id?: string
  }
  export interface JwtHeader { alg: string; kid?: string; [key: string]: unknown }
  export interface Jwt { header: JwtHeader; payload: JwtPayload | string; signature: string }
  export interface VerifyOptions { algorithms?: string[]; audience?: string | string[]; issuer?: string | string[] }
  export function verify(token: string, secretOrPublicKey: string, options?: VerifyOptions): JwtPayload | string
  export function decode(token: string, options: { complete: true }): Jwt | null
  export function decode(token: string): JwtPayload | string | null
  export function sign(payload: string | object | Buffer, secret: string, options?: object): string
  const _default: { verify: typeof verify; sign: typeof sign; decode: typeof decode }
  export default _default
}
