// Minimal well-formed .zkey bytes for tests: enough of the binfile that
// `readZkeyChain` can walk it, without a 5MB artifact or a trusted setup.
//
// Layout mirrors snarkjs (see src/arcanum/zkeyChain.ts for the full note):
//   "zkey" | u32 version | u32 nSections | { u32 id | u64 length | bytes } *
// with section 2 carrying n8q and section 10 the contribution chain.

const N8Q = 32
const FIXED = N8Q * 2 * 3 + N8Q * 4 + 64 // deltaAfter, g1_s, g1_sx, g2_spx, transcript

function seeded(seed: string, n: number): Buffer {
  // Deterministic filler that differs per seed — stands in for curve points.
  const b = Buffer.alloc(n)
  for (let i = 0; i < n; i++) b[i] = (seed.charCodeAt(i % seed.length) + i * 31) & 0xff
  return b
}

function section(id: number, body: Buffer): Buffer {
  const head = Buffer.alloc(12)
  head.writeUInt32LE(id, 0)
  head.writeBigUInt64LE(BigInt(body.length), 4)
  return Buffer.concat([head, body])
}

export interface FakeLink {
  /** Decides the contribution's cryptographic bytes — the part the chain check compares. */
  seed: string
  /** Display name, stored in the cosmetic params the chain check must ignore. */
  name?: string
}

/** A zkey whose contribution chain is exactly `links`, in order. */
export function fakeZkey(links: FakeLink[], opts: { csHash?: string } = {}): Buffer {
  const chain: Buffer[] = [seeded(opts.csHash ?? 'arcanum-circuit', 64)]
  const count = Buffer.alloc(4)
  count.writeUInt32LE(links.length, 0)
  chain.push(count)
  for (const link of links) {
    const name = Buffer.from(link.name ?? '', 'utf8')
    const params = name.length ? Buffer.concat([Buffer.from([1, name.length]), name]) : Buffer.alloc(0)
    const tail = Buffer.alloc(8)
    tail.writeUInt32LE(0, 0) // type 0 = contribution (1 would be the final beacon)
    tail.writeUInt32LE(params.length, 4)
    chain.push(seeded(link.seed, FIXED), tail, params)
  }

  const n8q = Buffer.alloc(4)
  n8q.writeUInt32LE(N8Q, 0)
  const header = Buffer.alloc(8)
  header.write('zkey', 0, 'latin1')
  header.writeUInt32LE(1, 4)
  const nSections = Buffer.alloc(4)
  nSections.writeUInt32LE(2, 0)

  return Buffer.concat([
    header, nSections,
    section(2, n8q),
    section(10, Buffer.concat(chain)),
  ])
}

/** The honest move: take a key and add one contribution to its chain. */
export function contributeTo(links: FakeLink[], link: FakeLink): FakeLink[] {
  return [...links, link]
}
