// =============================================================================
// walletAuth — wallet-signature challenge/verify for the backup-recovery channel.
// =============================================================================
//
// A wallet proves control by signing a short-lived challenge (EIP-191 personal_sign).
// The challenge is STATELESS: a JWT (signed with `JWT_SECRET`) carries the target address
// + a random nonce, TTL ~5min. The human-readable statement the wallet signs embeds that
// nonce, so a signature is bound to one challenge and cannot be replayed past the TTL.
//
// Flow (see authRouter `/wallet/*`):
//   1. client → POST /wallet/challenge { address }  → { token, statement }
//   2. client signs `statement` with the wallet     → signature
//   3. client → /wallet/link | /wallet/recover { challengeToken: token, signature }
//   4. server `verifyWalletChallenge(token, signature)` → the proven address (or null)
//
// The proven address is used as a `'web'`-genus Persona externusId (lowercased) — the same
// convention the web3 credential acceptor uses, so a linked wallet doubles as a login.
// =============================================================================

import jwt from 'jsonwebtoken'
import { randomBytes } from 'node:crypto'
import { getAddress, verifyMessage } from 'ethers'

const CHALLENGE_TYP = 'wallet-challenge' as const

/** Challenge lifetime (seconds) — long enough to open a wallet + sign, short enough to blunt replay. */
export const DEFAULT_CHALLENGE_TTL_SECONDS = 5 * 60

/** Validate + normalize an EVM address (checksum-tolerant) to lowercase, or `null` if malformed. */
export function normalizeAddress(raw: unknown): string | null {
  try {
    return getAddress(String(raw ?? '')).toLowerCase()
  } catch {
    return null
  }
}

/** The exact human-readable message a wallet signs — the nonce binds it to one challenge. */
export function challengeMessage(nonce: string): string {
  return [
    'NOEMA wallet verification',
    '',
    'Sign this message to prove you control this wallet.',
    'This is free and does not send a transaction or spend gas.',
    '',
    `Nonce: ${nonce}`,
  ].join('\n')
}

export interface WalletChallenge {
  /** Opaque challenge JWT the client echoes back on link/recover. */
  token: string
  /** The message the client must sign verbatim. */
  statement: string
}

/** Mint a stateless challenge for `address` (already normalized). */
export function mintWalletChallenge(
  address: string,
  jwtSecret: string,
  ttlSeconds = DEFAULT_CHALLENGE_TTL_SECONDS,
): WalletChallenge {
  const nonce = randomBytes(16).toString('hex')
  const token = jwt.sign({ typ: CHALLENGE_TYP, addr: address, nonce }, jwtSecret, { expiresIn: ttlSeconds })
  return { token, statement: challengeMessage(nonce) }
}

/**
 * Verify a presented challenge token + signature → the PROVEN wallet address (lowercased),
 * or `null` if the token is invalid/expired or the signature doesn't recover to that address.
 */
export function verifyWalletChallenge(token: unknown, signature: unknown, jwtSecret: string): string | null {
  if (typeof token !== 'string' || typeof signature !== 'string') return null
  let addr: string
  let nonce: string
  try {
    const payload = jwt.verify(token, jwtSecret)
    if (typeof payload === 'string' || payload.typ !== CHALLENGE_TYP) return null
    if (typeof payload.addr !== 'string' || typeof payload.nonce !== 'string') return null
    addr = payload.addr
    nonce = payload.nonce
  } catch {
    return null
  }
  let signer: string
  try {
    signer = verifyMessage(challengeMessage(nonce), signature).toLowerCase()
  } catch {
    return null
  }
  return signer === addr ? addr : null
}
