import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isSafeWebhookUrl } from '../../../../src/allocutio/api/webhookGuard.js'

test('accepts public https URLs', () => {
  assert.equal(isSafeWebhookUrl('https://example.com/hook'), true)
  assert.equal(isSafeWebhookUrl('https://hooks.example.org:8443/x?y=1'), true)
  assert.equal(isSafeWebhookUrl('https://1.2.3.4/hook'), true, 'public IP literal ok')
})

test('rejects non-https', () => {
  assert.equal(isSafeWebhookUrl('http://example.com/hook'), false)
  assert.equal(isSafeWebhookUrl('file:///etc/passwd'), false)
  assert.equal(isSafeWebhookUrl('ftp://example.com'), false)
  assert.equal(isSafeWebhookUrl('not a url'), false)
})

test('rejects localhost + private/loopback/link-local IPv4 (SSRF)', () => {
  for (const u of [
    'https://localhost/x',
    'https://app.localhost/x',
    'https://127.0.0.1/x',
    'https://10.0.0.5/x',
    'https://192.168.1.1/x',
    'https://172.16.0.1/x',
    'https://172.31.255.255/x',
    'https://169.254.169.254/latest/meta-data',  // cloud metadata
    'https://0.0.0.0/x',
  ]) {
    assert.equal(isSafeWebhookUrl(u), false, u)
  }
})

test('public 172 outside the private range is allowed', () => {
  assert.equal(isSafeWebhookUrl('https://172.32.0.1/x'), true)
  assert.equal(isSafeWebhookUrl('https://172.15.0.1/x'), true)
})

test('rejects IPv6 loopback / unique-local / link-local literals', () => {
  assert.equal(isSafeWebhookUrl('https://[::1]/x'), false)
  assert.equal(isSafeWebhookUrl('https://[fc00::1]/x'), false)
  assert.equal(isSafeWebhookUrl('https://[fd12:3456::1]/x'), false)
  assert.equal(isSafeWebhookUrl('https://[fe80::1]/x'), false)
})
