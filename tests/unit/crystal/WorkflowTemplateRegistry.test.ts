import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WorkflowTemplateRegistry, WorkflowTemplateError } from '../../../src/crystal/WorkflowTemplateRegistry.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.join(__dirname, '../../fixtures/workflows')
const REAL_WORKFLOWS = path.join(__dirname, '../../../src/crystal/workflows')

// ── WorkflowTemplateError ─────────────────────────────────────────────────────

test('WorkflowTemplateError is an Error subclass', () => {
  const err = new WorkflowTemplateError('TEMPLATE_NOT_FOUND', 'not found')
  assert.ok(err instanceof Error)
  assert.equal(err.code, 'TEMPLATE_NOT_FOUND')
  assert.equal(err.message, 'not found')
})

// ── get() — real templates ────────────────────────────────────────────────────

test('get() loads flux-schnell template from real workflows dir', () => {
  const registry = new WorkflowTemplateRegistry(REAL_WORKFLOWS)
  const template = registry.get('flux-schnell', '1')
  assert.equal(template.templateId, 'flux-schnell')
  assert.equal(template.version, '1')
  assert.ok(template.inputTemplate, 'inputTemplate should be present')
  assert.ok(template.slotMap, 'slotMap should be present')
})

test('get() returns template with requiredModels array', () => {
  const registry = new WorkflowTemplateRegistry(REAL_WORKFLOWS)
  const template = registry.get('flux-schnell', '1')
  assert.ok(Array.isArray(template.requiredModels))
  assert.ok(template.requiredModels.length > 0)
})

test('get() returns template with slotMap containing prompt mapping', () => {
  const registry = new WorkflowTemplateRegistry(REAL_WORKFLOWS)
  const template = registry.get('flux-schnell', '1')
  const hasPromptSlot = Object.values(template.slotMap).includes('prompt')
  assert.ok(hasPromptSlot, 'slotMap should map a slot to prompt')
})

test('get() throws WorkflowTemplateError when template not found', () => {
  const registry = new WorkflowTemplateRegistry(REAL_WORKFLOWS)
  assert.throws(
    () => registry.get('nonexistent', '1'),
    (err: unknown) => err instanceof WorkflowTemplateError && err.code === 'TEMPLATE_NOT_FOUND'
  )
})

test('get() throws WorkflowTemplateError for wrong version', () => {
  const registry = new WorkflowTemplateRegistry(REAL_WORKFLOWS)
  assert.throws(
    () => registry.get('flux-schnell', '99'),
    (err: unknown) => err instanceof WorkflowTemplateError && err.code === 'TEMPLATE_NOT_FOUND'
  )
})

test('get() returns identical content from cache without re-reading disk', () => {
  const registry = new WorkflowTemplateRegistry(REAL_WORKFLOWS)
  const a = registry.get('flux-schnell', '1')
  const b = registry.get('flux-schnell', '1')
  assert.deepEqual(a, b, 'should return identical content from cache')
})

test('get() returns a deep clone so mutations do not affect cache', () => {
  const registry = new WorkflowTemplateRegistry(REAL_WORKFLOWS)
  const t1 = registry.get('flux-schnell', '1')
  ;(t1.inputTemplate as Record<string, unknown>)['__mutated'] = true
  const t2 = registry.get('flux-schnell', '1')
  assert.equal((t2.inputTemplate as Record<string, unknown>)['__mutated'], undefined)
})

// ── list() ────────────────────────────────────────────────────────────────────

test('list() returns at least one entry from real workflows dir', () => {
  const registry = new WorkflowTemplateRegistry(REAL_WORKFLOWS)
  const entries = registry.list()
  assert.ok(Array.isArray(entries))
  assert.ok(entries.length >= 1)
})

test('list() includes flux-schnell', () => {
  const registry = new WorkflowTemplateRegistry(REAL_WORKFLOWS)
  const entries = registry.list()
  const found = entries.some(e => e.templateId === 'flux-schnell' && e.version === '1')
  assert.ok(found)
})
