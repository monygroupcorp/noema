import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Errors } from '../../../../src/allocutio/api/errors.js'
import { API_CONTRACT } from '../../../../src/allocutio/api/apiContract.js'

// A zero-balance caller produced 58 refused runs in ten seconds. The refusal carried no
// `retryable` at all, so an automated caller had nothing to read and asked again immediately.
// Funding the account is the only thing that changes the answer, so the refusal is terminal
// and now says so on the wire.
describe('economy.insufficient_signa is a terminal refusal', () => {
  it('says retryable: false on the wire, rather than leaving it unsaid', () => {
    const body = Errors.insufficientSigna({ available: '0', required: '900' }).toBody()
    assert.equal(body.code, 'economy.insufficient_signa')
    assert.equal(body.retryable, false)
  })

  it('is still a 402, and still carries the numbers that explain it', () => {
    const err = Errors.insufficientSigna({ available: '0', required: '900' })
    assert.equal(err.httpStatus, 402)
    assert.deepEqual(err.toBody().details, { available: '0', required: '900' })
  })

  it('the published contract declares the same thing the code returns', () => {
    const spec = API_CONTRACT.errorCodes.find((e) => e.code === 'economy.insufficient_signa')
    assert.ok(spec, 'the contract declares the code')
    assert.equal(spec.retryable, false)
  })

  it('is not confused with a refusal that IS worth retrying', () => {
    assert.equal(Errors.conflictRunInFlight('already running').toBody().retryable, true)
  })
})
