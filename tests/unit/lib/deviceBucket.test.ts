import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveDeviceBucket } from '../../../src/lib/deviceBucket.js'

const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.84 Mobile Safari/537.36'
const SAFARI_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const CHROME_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0'
const SAFARI_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
const BOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'

test('derives mobile/Android/Chrome from a real Android UA', () => {
  const b = deriveDeviceBucket(CHROME_ANDROID)
  assert.equal(b.deviceClass, 'mobile')
  assert.equal(b.osFamily, 'Android')
  assert.equal(b.browserFamily, 'Chrome')
  assert.equal(b.browserMajor, 128)
})

test('derives mobile/iOS/Safari from a real iPhone UA', () => {
  const b = deriveDeviceBucket(SAFARI_IOS)
  assert.equal(b.deviceClass, 'mobile')
  assert.equal(b.osFamily, 'iOS')
  assert.equal(b.browserFamily, 'Safari')
  assert.equal(b.browserMajor, 17)
})

test('derives desktop/Windows/Chrome', () => {
  const b = deriveDeviceBucket(CHROME_DESKTOP)
  assert.equal(b.deviceClass, 'desktop')
  assert.equal(b.osFamily, 'Windows')
  assert.equal(b.browserFamily, 'Chrome')
})

test('derives desktop/Linux/Firefox', () => {
  const b = deriveDeviceBucket(FIREFOX_LINUX)
  assert.equal(b.deviceClass, 'desktop')
  assert.equal(b.osFamily, 'Linux')
  assert.equal(b.browserFamily, 'Firefox')
})

test('derives desktop/macOS/Safari', () => {
  const b = deriveDeviceBucket(SAFARI_MAC)
  assert.equal(b.deviceClass, 'desktop')
  assert.equal(b.osFamily, 'macOS')
  assert.equal(b.browserFamily, 'Safari')
})

test('classifies a known crawler as a bot', () => {
  const b = deriveDeviceBucket(BOT)
  assert.equal(b.deviceClass, 'bot')
})

test('absent/empty user-agent → the unknown bucket, never throws', () => {
  assert.deepEqual(deriveDeviceBucket(undefined), { deviceClass: 'unknown', browserFamily: 'unknown', osFamily: 'unknown' })
  assert.deepEqual(deriveDeviceBucket(null), { deviceClass: 'unknown', browserFamily: 'unknown', osFamily: 'unknown' })
  assert.deepEqual(deriveDeviceBucket('   '), { deviceClass: 'unknown', browserFamily: 'unknown', osFamily: 'unknown' })
})

test('pure: same input always yields the same bucket', () => {
  assert.deepEqual(deriveDeviceBucket(CHROME_ANDROID), deriveDeviceBucket(CHROME_ANDROID))
})

test('the bucket never contains the raw string it was derived from', () => {
  const b = deriveDeviceBucket(CHROME_ANDROID) as unknown as Record<string, unknown>
  for (const v of Object.values(b)) assert.notEqual(v, CHROME_ANDROID)
})
