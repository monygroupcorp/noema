// Reads the contribution chain out of a Groth16 .zkey so the sequencer can check that
// an upload extends the key it actually handed out.
//
// Why this exists: snarkjs's `zkey verify` proves an uploaded key is a valid chain of
// contributions starting from the circuit's initial key — it says nothing about WHICH
// point in the chain it starts from. A contributor who forks off the root, drops every
// contribution collected so far and uploads their fork passes that check. They then own
// the only randomness in the key, which is the one thing a trusted setup must prevent.
// The `x-based-on` header can't close the gap: the client picks it. So we read the chain
// out of the bytes themselves and require it to be the head's chain plus exactly one.
//
// Binary layout (snarkjs binfileutils + zkey_utils):
//   "zkey" | u32 version | u32 nSections | { u32 id | u64 length | bytes } *
//   section 2 (groth16 header) begins u32 n8q — so G1 is 2*n8q bytes and G2 is 4*n8q.
//   section 10 (MPC params) is  csHash[64] | u32 n | contribution * n, and each
//   contribution is  deltaAfter:G1 | g1_s:G1 | g1_sx:G1 | g2_spx:G2 | transcript[64]
//                    | u32 type | u32 paramLength | params[paramLength].
// Only the fixed part is compared: `params` carries the contributor's display name, which
// is cosmetic and which snarkjs truncates on rewrite, so comparing it could reject an
// honest contributor. The fixed part is the whole cryptographic claim.

const MAGIC = 'zkey'
const TRANSCRIPT_BYTES = 64
const CS_HASH_BYTES = 64

export interface ZkeyChain {
  /** Circuit hash — identical across every key in one ceremony. */
  csHash: Buffer
  /** Per contribution, the fixed cryptographic record (delta + proof-of-knowledge + transcript). */
  links: Buffer[]
}

class ZkeyFormatError extends Error {}

/** Bounds-checked cursor over the zkey bytes; every read past the end is a format error. */
class Cursor {
  constructor(private readonly buf: Buffer, public pos = 0) {}
  u32(): number {
    this.require(4)
    const v = this.buf.readUInt32LE(this.pos)
    this.pos += 4
    return v
  }
  u64(): number {
    this.require(8)
    const v = this.buf.readBigUInt64LE(this.pos)
    this.pos += 8
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new ZkeyFormatError('section length out of range')
    return Number(v)
  }
  bytes(n: number): Buffer {
    this.require(n)
    const b = this.buf.subarray(this.pos, this.pos + n)
    this.pos += n
    return b
  }
  skip(n: number): void {
    this.require(n)
    this.pos += n
  }
  private require(n: number): void {
    if (n < 0 || this.pos + n > this.buf.length) throw new ZkeyFormatError('truncated zkey')
  }
}

/**
 * Parse the contribution chain out of a .zkey. Throws on anything that isn't a
 * well-formed Groth16 zkey with an MPC-params section.
 */
export function readZkeyChain(bytes: Buffer): ZkeyChain {
  const c = new Cursor(bytes)
  if (c.bytes(4).toString('latin1') !== MAGIC) throw new ZkeyFormatError('not a zkey file')
  c.u32() // format version — the section table below is stable across the versions snarkjs writes
  const nSections = c.u32()

  const at = new Map<number, { p: number; size: number }>()
  for (let i = 0; i < nSections; i++) {
    const id = c.u32()
    const size = c.u64()
    // Duplicate sections are a snarkjs error too; first wins, and section 10 is unique.
    if (!at.has(id)) at.set(id, { p: c.pos, size })
    c.skip(size)
  }

  const header = at.get(2)
  const mpc = at.get(10)
  if (!header) throw new ZkeyFormatError('zkey has no groth16 header section')
  if (!mpc) throw new ZkeyFormatError('zkey has no contribution section — not a ceremony key')

  const n8q = new Cursor(bytes, header.p).u32()
  if (n8q <= 0 || n8q > 1024) throw new ZkeyFormatError('implausible field size in zkey header')
  const g1 = n8q * 2
  const g2 = n8q * 4
  const fixed = g1 * 3 + g2 + TRANSCRIPT_BYTES

  const m = new Cursor(bytes, mpc.p)
  const csHash = Buffer.from(m.bytes(CS_HASH_BYTES))
  const n = m.u32()
  const links: Buffer[] = []
  for (let i = 0; i < n; i++) {
    links.push(Buffer.from(m.bytes(fixed)))
    m.u32() // contribution type: 0 = contribution, 1 = beacon
    m.skip(m.u32()) // params (display name, beacon hash) — cosmetic, see the note above
  }
  if (m.pos !== mpc.p + mpc.size) throw new ZkeyFormatError('contribution section does not match its length')
  return { csHash, links }
}

export interface ChainVerdict {
  ok: boolean
  reason?: string
}

/**
 * Does `upload` continue `head` — same circuit, every contribution the head already
 * has, and exactly one more? This is the check that makes `x-based-on` binding rather
 * than advisory.
 */
export function extendsChain(head: ZkeyChain, upload: ZkeyChain): ChainVerdict {
  if (!head.csHash.equals(upload.csHash)) {
    return { ok: false, reason: 'this key is for a different circuit' }
  }
  if (upload.links.length !== head.links.length + 1) {
    return {
      ok: false,
      reason: `expected ${head.links.length + 1} contributions, this key has ${upload.links.length}` +
        ' — re-fetch current.zkey and contribute against it',
    }
  }
  for (let i = 0; i < head.links.length; i++) {
    if (!head.links[i].equals(upload.links[i])) {
      return {
        ok: false,
        reason: `contribution ${i + 1} does not match the published chain` +
          ' — this key builds on a different history',
      }
    }
  }
  return { ok: true }
}
