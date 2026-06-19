import { test } from 'node:test'
import assert from 'node:assert/strict'
import { provenanceHash } from '../../../src/crystal/provenance.js'
import type { Tractus } from '../../../src/types/collectio.js'

const tractus: Tractus[] = [
  { porta: 'color', valores: [{ value: 'red' }, { value: 'blue' }] },
]

test('provenanceHash is a stable sha256: digest', () => {
  const h = provenanceHash({ modusId: 'sd1-5', tractus, aditusBase: { _basePrompt: 'a {{color}} cat' } })
  assert.match(h, /^sha256:[0-9a-f]{64}$/)
})

test('same config → same hash, regardless of aditusBase key order', () => {
  const a = provenanceHash({ modusId: 'sd1-5', tractus, aditusBase: { x: 1, y: 2 } })
  const b = provenanceHash({ modusId: 'sd1-5', tractus, aditusBase: { y: 2, x: 1 } })
  assert.equal(a, b)
})

test('any substantive change → different hash', () => {
  const base = provenanceHash({ modusId: 'sd1-5', tractus, aditusBase: { _basePrompt: 'a {{color}} cat' } })
  // changed flow
  assert.notEqual(base, provenanceHash({ modusId: 'flux', tractus, aditusBase: { _basePrompt: 'a {{color}} cat' } }))
  // changed flow version
  assert.notEqual(base, provenanceHash({ modusId: 'sd1-5', modusVersio: '2.0.0', tractus, aditusBase: { _basePrompt: 'a {{color}} cat' } }))
  // changed base aditus
  assert.notEqual(base, provenanceHash({ modusId: 'sd1-5', tractus, aditusBase: { _basePrompt: 'a {{color}} dog' } }))
  // changed a trait
  const tractus2: Tractus[] = [{ porta: 'color', valores: [{ value: 'red' }, { value: 'green' }] }]
  assert.notEqual(base, provenanceHash({ modusId: 'sd1-5', tractus: tractus2, aditusBase: { _basePrompt: 'a {{color}} cat' } }))
})

test('tractus order is significant (it drives prompt assembly)', () => {
  const t1: Tractus[] = [{ porta: 'a', valores: [{ value: 1 }] }, { porta: 'b', valores: [{ value: 2 }] }]
  const t2: Tractus[] = [{ porta: 'b', valores: [{ value: 2 }] }, { porta: 'a', valores: [{ value: 1 }] }]
  assert.notEqual(
    provenanceHash({ modusId: 'm', tractus: t1, aditusBase: {} }),
    provenanceHash({ modusId: 'm', tractus: t2, aditusBase: {} }),
  )
})
