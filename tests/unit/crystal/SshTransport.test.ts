import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SshTransport } from '../../../src/crystal/SshTransport.js'

// The transport shells out to the system ssh/scp binaries, so exec/upload/close
// aren't unit-tested here (they'd need a live host). What IS pure and worth
// pinning is the constructor's fail-fast validation — the guard that turns a
// misconfigured factory into a clear error instead of a mystery SSH hang.

function withKeyFile(fn: (keyPath: string) => void): void {
  const keyPath = path.join(os.tmpdir(), `ssh-test-key-${process.pid}`)
  fs.writeFileSync(keyPath, 'dummy')
  try { fn(keyPath) } finally { fs.rmSync(keyPath, { force: true }) }
}

test('constructor requires a host', () => {
  withKeyFile((keyPath) => {
    assert.throws(() => new SshTransport({ host: '', privateKeyPath: keyPath }), /requires host/)
  })
})

test('constructor requires a privateKeyPath', () => {
  assert.throws(
    () => new SshTransport({ host: 'h', privateKeyPath: '' }),
    /requires privateKeyPath/,
  )
})

test('constructor throws when the private key file is missing', () => {
  assert.throws(
    () => new SshTransport({ host: 'h', privateKeyPath: '/no/such/key/anywhere' }),
    /private key not found/,
  )
})

test('constructor succeeds with a valid host + existing key', () => {
  withKeyFile((keyPath) => {
    assert.doesNotThrow(() => new SshTransport({ host: 'ssh2.vast.ai', port: 12345, privateKeyPath: keyPath }))
  })
})
