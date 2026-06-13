// Bursa — anonymous credit purse.
//
// A Bursa is minted by spending a ZK note (ArcanumProof) once. The note's valor
// (raw wei) is converted to impetus credits at the prevailing conversion rate and
// stored here. The bearer token is the only credential — there is no animaId.
// The client stores the token locally; the platform cannot link it to an identity.

export interface Bursa {
  id: string      // UUID = bearer token presented on each run
  credits: bigint // remaining impetus credits
  createdAt: Date
}

export interface Bursarum {
  create(credits: bigint): Promise<Bursa>
  findByToken(token: string): Promise<Bursa | null>
  /** Atomically debit `amount` credits. Throws if balance insufficient. */
  debit(token: string, amount: bigint): Promise<Bursa>
}
