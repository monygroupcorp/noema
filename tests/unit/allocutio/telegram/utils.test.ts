import { test } from 'node:test'
import assert from 'node:assert/strict'
import { escapeMarkdownV2, abbreviateAddress } from '../../../../src/allocutio/telegram/utils.js'

// ---------------------------------------------------------------------------
// escapeMarkdownV2
// ---------------------------------------------------------------------------

test('escapeMarkdownV2 escapes underscore', () => {
  assert.equal(escapeMarkdownV2('a_b'), 'a\\_b')
})

test('escapeMarkdownV2 escapes asterisk', () => {
  assert.equal(escapeMarkdownV2('a*b'), 'a\\*b')
})

test('escapeMarkdownV2 escapes open bracket', () => {
  assert.equal(escapeMarkdownV2('a[b'), 'a\\[b')
})

test('escapeMarkdownV2 escapes close bracket', () => {
  assert.equal(escapeMarkdownV2('a]b'), 'a\\]b')
})

test('escapeMarkdownV2 escapes open paren', () => {
  assert.equal(escapeMarkdownV2('a(b'), 'a\\(b')
})

test('escapeMarkdownV2 escapes close paren', () => {
  assert.equal(escapeMarkdownV2('a)b'), 'a\\)b')
})

test('escapeMarkdownV2 escapes tilde', () => {
  assert.equal(escapeMarkdownV2('a~b'), 'a\\~b')
})

test('escapeMarkdownV2 escapes backtick', () => {
  assert.equal(escapeMarkdownV2('a`b'), 'a\\`b')
})

test('escapeMarkdownV2 escapes greater-than', () => {
  assert.equal(escapeMarkdownV2('a>b'), 'a\\>b')
})

test('escapeMarkdownV2 escapes hash', () => {
  assert.equal(escapeMarkdownV2('a#b'), 'a\\#b')
})

test('escapeMarkdownV2 escapes plus', () => {
  assert.equal(escapeMarkdownV2('a+b'), 'a\\+b')
})

test('escapeMarkdownV2 escapes hyphen', () => {
  assert.equal(escapeMarkdownV2('a-b'), 'a\\-b')
})

test('escapeMarkdownV2 escapes equals', () => {
  assert.equal(escapeMarkdownV2('a=b'), 'a\\=b')
})

test('escapeMarkdownV2 escapes pipe', () => {
  assert.equal(escapeMarkdownV2('a|b'), 'a\\|b')
})

test('escapeMarkdownV2 escapes open brace', () => {
  assert.equal(escapeMarkdownV2('a{b'), 'a\\{b')
})

test('escapeMarkdownV2 escapes close brace', () => {
  assert.equal(escapeMarkdownV2('a}b'), 'a\\}b')
})

test('escapeMarkdownV2 escapes period', () => {
  assert.equal(escapeMarkdownV2('a.b'), 'a\\.b')
})

test('escapeMarkdownV2 escapes exclamation mark', () => {
  assert.equal(escapeMarkdownV2('a!b'), 'a\\!b')
})

test('escapeMarkdownV2 escapes backslash', () => {
  assert.equal(escapeMarkdownV2('a\\b'), 'a\\\\b')
})

test('escapeMarkdownV2 passes through alphanumeric text unchanged', () => {
  assert.equal(escapeMarkdownV2('hello world 123'), 'hello world 123')
})

test('escapeMarkdownV2 escapes all special chars in a combined string', () => {
  // 19 special chars (one backslash = 1 char in JS string)
  const input = '_*[]()~`>#+\\-=|{}.!'
  const result = escapeMarkdownV2(input)
  // Every char should be prefixed with backslash
  assert.ok(!result.includes('__'), 'should not have unescaped double underscore')
  // The escaped backslash itself becomes \\ (2 backslash chars in result).
  // 18 other special chars → 18 prefix backslashes.
  // Total: 18 + 2 = 20 backslash chars in result.
  const backslashes = (result.match(/\\/g) ?? []).length
  assert.equal(backslashes, input.length + 1, 'every special char should be escaped (backslash yields 2)')
})

// ---------------------------------------------------------------------------
// abbreviateAddress
// ---------------------------------------------------------------------------

test('abbreviateAddress returns first 6 + ... + last 4 chars', () => {
  assert.equal(abbreviateAddress('0x1234567890abcdef'), '0x1234...cdef')
})

test('abbreviateAddress works for any ethereum address', () => {
  const addr = '0xDeadBeef1234567890DeadBeef1234567890dead'
  const result = abbreviateAddress(addr)
  assert.equal(result, '0xDead...dead')
})
