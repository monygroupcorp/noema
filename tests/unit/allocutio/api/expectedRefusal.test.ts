import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Errors } from '../../../../src/allocutio/api/errors.js'

// GET /v1/me/partner answers 404 to every user who is not a partner. The dashboard asks on
// every load and branches on the code, so that 404 is the ordinary answer — and it was logged
// at warn like any other 4xx, sixty a day, the largest single source of warns in the log.
describe('an ordinary refusal is marked expected, and stays off the wire', () => {
  it('the non-partner 404 is expected', () => {
    assert.equal(Errors.notFoundPartner().opts.expected, true)
  })

  it('so is "you never filed a partner request" — the same shape on your own account', () => {
    assert.equal(Errors.notFoundOwnPartnerRequest().opts.expected, true)
  })

  it('asking for a SPECIFIC request that is not there is not ordinary, and still warns', () => {
    assert.notEqual(Errors.notFoundPartnerRequest('pr_404').opts.expected, true)
  })

  it('a refusal that may mean something is wrong is not marked expected', () => {
    assert.notEqual(Errors.insufficientSigna({ available: '0' }).opts.expected, true)
    assert.notEqual(Errors.notFoundRun('run_1').opts.expected, true)
  })

  it('never reaches the caller: it is an operator concern, not part of the body', () => {
    const body = Errors.notFoundPartner().toBody()
    assert.equal('expected' in body, false)
    assert.deepEqual(Object.keys(body).sort(), ['code', 'message'])
  })

  it('both own-account lookups still answer 404 with the codes the dashboard branches on', () => {
    assert.equal(Errors.notFoundPartner().httpStatus, 404)
    assert.equal(Errors.notFoundPartner().code, 'not_found.partner')
    assert.equal(Errors.notFoundOwnPartnerRequest().code, 'not_found.partner_request')
  })
})
