import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOT        = path.resolve(__dirname, '../../..')
const LIB_PATH    = path.join(ROOT, 'src/lib/logger.js')
const TRACE_PATH  = path.join(ROOT, 'src/lib/trace.js')

/**
 * Run a small TypeScript snippet in a child process via tsx.
 * The snippet is written to a temp .ts file and executed from ROOT so that
 * the project tsconfig is picked up and relative .js imports resolve to .ts.
 */
function runSnippet(code: string, env: Record<string, string> = {}): unknown[] {
  const tmpFile = path.join(os.tmpdir(), `logger-test-${process.pid}-${Date.now()}.ts`)
  try {
    fs.writeFileSync(tmpFile, code, 'utf8')
    const result = spawnSync(
      'npx',
      ['tsx', tmpFile],
      {
        cwd: ROOT,
        env: { ...process.env, ...env },
        encoding: 'utf8',
        timeout: 15_000,
      },
    )
    if (result.error) throw result.error
    const lines = (result.stdout ?? '').split('\n').filter(Boolean)
    return lines.map(line => {
      try { return JSON.parse(line) } catch { return line }
    })
  } finally {
    try { fs.unlinkSync(tmpFile) } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Test 1 — makeLogger emits JSON to stdout at info level
// ---------------------------------------------------------------------------

test('makeLogger emits JSON to stdout at info level', () => {
  // Capture stdout by overriding process.stdout.write in-process.
  const captured: string[] = []
  const orig = process.stdout.write.bind(process.stdout)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(process.stdout as any).write = (chunk: string | Uint8Array, ..._rest: unknown[]) => {
    if (typeof chunk === 'string') captured.push(chunk)
    return true
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { makeLogger } = require('../../../src/lib/logger.js') as typeof import('../../../src/lib/logger.js')
    const logger = makeLogger('test:t1')
    logger.info('hello world')

    assert.ok(captured.length >= 1, 'expected at least one stdout write')
    const entry = JSON.parse(captured[captured.length - 1]) as Record<string, unknown>
    assert.equal(entry.level, 'info')
    assert.equal(entry.component, 'test:t1')
    assert.equal(entry.msg, 'hello world')
    assert.ok(typeof entry.ts === 'string', 'ts should be a string')
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(process.stdout as any).write = orig
  }
})

// ---------------------------------------------------------------------------
// Test 2 — debug messages are suppressed when LOG_LEVEL=info
// ---------------------------------------------------------------------------

test('debug messages are suppressed when LOG_LEVEL=info', () => {
  const lines = runSnippet(
    `
import { makeLogger } from '${LIB_PATH}'
const log = makeLogger('test:t2')
log.debug('should not appear')
log.info('should appear')
`,
    { LOG_LEVEL: 'info', DEBUG: '', DEBUG_GROUP: '' },
  ) as Array<Record<string, unknown>>

  const debugLines = lines.filter(l => typeof l === 'object' && l !== null && (l as Record<string, unknown>).level === 'debug')
  const infoLines  = lines.filter(l => typeof l === 'object' && l !== null && (l as Record<string, unknown>).level === 'info')

  assert.equal(debugLines.length, 0, 'debug should be suppressed at LOG_LEVEL=info')
  assert.ok(infoLines.length >= 1, 'info should still appear')
})

// ---------------------------------------------------------------------------
// Test 3 — debug messages are emitted when LOG_LEVEL=debug
// ---------------------------------------------------------------------------

test('debug messages are emitted when LOG_LEVEL=debug', () => {
  const lines = runSnippet(
    `
import { makeLogger } from '${LIB_PATH}'
const log = makeLogger('test:t3')
log.debug('visible debug message')
`,
    { LOG_LEVEL: 'debug', DEBUG: '', DEBUG_GROUP: '' },
  ) as Array<Record<string, unknown>>

  const debugLines = lines.filter(l => typeof l === 'object' && l !== null && (l as Record<string, unknown>).level === 'debug')
  assert.ok(debugLines.length >= 1, 'debug should be emitted at LOG_LEVEL=debug')
  assert.equal((debugLines[0] as Record<string, unknown>).msg, 'visible debug message')
})

// ---------------------------------------------------------------------------
// Test 4 — DEBUG=arcanum:* enables arcanum:issuer and arcanum:tree but not ledger:signorum
// ---------------------------------------------------------------------------

test('DEBUG=arcanum:* enables arcanum:issuer and arcanum:tree but not ledger:signorum', () => {
  const lines = runSnippet(
    `
import { makeLogger } from '${LIB_PATH}'
makeLogger('arcanum:issuer').debug('issuer debug')
makeLogger('arcanum:tree').debug('tree debug')
makeLogger('ledger:signorum').debug('ledger debug')
`,
    { LOG_LEVEL: 'info', DEBUG: 'arcanum:*', DEBUG_GROUP: '' },
  ) as Array<Record<string, unknown>>

  const components = lines
    .filter(l => typeof l === 'object' && l !== null && (l as Record<string, unknown>).level === 'debug')
    .map(l => (l as Record<string, unknown>).component)

  assert.ok(components.includes('arcanum:issuer'), 'arcanum:issuer should be enabled by arcanum:*')
  assert.ok(components.includes('arcanum:tree'),   'arcanum:tree should be enabled by arcanum:*')
  assert.ok(!components.includes('ledger:signorum'), 'ledger:signorum should NOT be enabled by arcanum:*')
})

// ---------------------------------------------------------------------------
// Test 5 — DEBUG_GROUP=arcanum enables arcanum:* and ledger:signorum
// ---------------------------------------------------------------------------

test('DEBUG_GROUP=arcanum enables arcanum:* and ledger:signorum (per GROUPS map)', () => {
  const lines = runSnippet(
    `
import { makeLogger } from '${LIB_PATH}'
makeLogger('arcanum:issuer').debug('issuer debug')
makeLogger('ledger:signorum').debug('ledger debug')
makeLogger('execution:inceptor').debug('inceptor debug')
makeLogger('execution:completor').debug('completor should not appear')
`,
    { LOG_LEVEL: 'info', DEBUG: '', DEBUG_GROUP: 'arcanum' },
  ) as Array<Record<string, unknown>>

  const components = lines
    .filter(l => typeof l === 'object' && l !== null && (l as Record<string, unknown>).level === 'debug')
    .map(l => (l as Record<string, unknown>).component)

  assert.ok(components.includes('arcanum:issuer'),    'arcanum:issuer should be in arcanum group')
  assert.ok(components.includes('ledger:signorum'),   'ledger:signorum should be in arcanum group')
  assert.ok(components.includes('execution:inceptor'), 'execution:inceptor should be in arcanum group')
  assert.ok(!components.includes('execution:completor'), 'execution:completor should NOT be in arcanum group')
})

// ---------------------------------------------------------------------------
// Test 6 — trace context actumId appears in log output when set via withTrace
// ---------------------------------------------------------------------------

test('trace context actumId appears in log output when set via withTrace', () => {
  const lines = runSnippet(
    `
import { makeLogger } from '${LIB_PATH}'
import { withTrace, makeTraceContext } from '${TRACE_PATH}'
const log = makeLogger('test:t6')
const ctx = makeTraceContext({ actumId: 'abc-123' })
withTrace(ctx, () => {
  log.info('with trace context')
})
`,
    { LOG_LEVEL: 'info' },
  ) as Array<Record<string, unknown>>

  assert.ok(lines.length >= 1, 'expected at least one log line')
  const entry = lines[0] as Record<string, unknown>
  assert.equal(entry.actumId, 'abc-123', 'actumId from trace context should appear in log')
})

// ---------------------------------------------------------------------------
// Test 7 — liveTrace: true causes debug messages to emit without DEBUG env var
// ---------------------------------------------------------------------------

test('liveTrace: true causes debug messages to emit even without DEBUG env var', () => {
  const lines = runSnippet(
    `
import { makeLogger } from '${LIB_PATH}'
import { withTrace, makeTraceContext } from '${TRACE_PATH}'
const log = makeLogger('test:t7')
const ctx = makeTraceContext({ liveTrace: true })
withTrace(ctx, () => {
  log.debug('live trace debug')
})
`,
    { LOG_LEVEL: 'info', DEBUG: '', DEBUG_GROUP: '' },
  ) as Array<Record<string, unknown>>

  const debugLines = lines.filter(l => typeof l === 'object' && l !== null && (l as Record<string, unknown>).level === 'debug')
  assert.ok(debugLines.length >= 1, 'debug should emit when liveTrace is true')
  assert.equal((debugLines[0] as Record<string, unknown>).msg, 'live trace debug')
})
