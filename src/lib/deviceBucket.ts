// =============================================================================
// deviceBucket — derive a coarse, non-identifying device signature from a
// User-Agent string. The input is never retained: callers pass the raw header
// in, get a bucket out, and the raw string is discarded in the same tick.
// =============================================================================
//
// This exists so the behaviour corpus can say "mobile Safari 18 on iOS" without
// ever writing a raw user-agent string to the database (privacy policy §2h: "no
// device identifiers beyond what's necessary for rate limiting"). The bucket is
// coarse by construction — major version only, broad OS family, no build/engine
// minutiae — so it cannot work as a fingerprint even in combination with other
// coarse fields.
// =============================================================================

export type DeviceClass = 'mobile' | 'tablet' | 'desktop' | 'bot' | 'unknown'

export interface DeviceBucket {
  deviceClass:   DeviceClass
  browserFamily: string
  /** Major version only — e.g. 128, not 128.0.6613.84. Absent when unparseable. */
  browserMajor?: number
  osFamily:      string
}

const UNKNOWN: DeviceBucket = { deviceClass: 'unknown', browserFamily: 'unknown', osFamily: 'unknown' }

function majorOf(version: string | undefined): number | undefined {
  if (!version) return undefined
  const n = Number.parseInt(version, 10)
  return Number.isFinite(n) ? n : undefined
}

function osFamilyOf(ua: string): string {
  if (/iPhone|iPad|iPod|iOS/i.test(ua)) return 'iOS'
  if (/Android/i.test(ua)) return 'Android'
  if (/Windows/i.test(ua)) return 'Windows'
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macOS'
  if (/CrOS/i.test(ua)) return 'ChromeOS'
  if (/Linux/i.test(ua)) return 'Linux'
  return 'unknown'
}

function deviceClassOf(ua: string): DeviceClass {
  if (/bot|spider|crawl|curl|wget|HeadlessChrome|facebookexternalhit|Slackbot|Discordbot/i.test(ua)) return 'bot'
  if (/iPad|Tablet(?!.*Mobile)/i.test(ua)) return 'tablet'
  if (/Mobi|iPhone|Android.*Mobile/i.test(ua)) return 'mobile'
  if (/Windows|Macintosh|X11|Linux/i.test(ua)) return 'desktop'
  return 'unknown'
}

// Order matters: a browser family can appear as a substring of another's UA
// token (e.g. Chrome ships inside Edge's and Samsung Internet's UA), so the
// more specific tokens are checked first.
const BROWSER_PATTERNS: Array<[string, RegExp]> = [
  ['Edge',              /Edg\/(\d+)/],
  ['SamsungInternet',   /SamsungBrowser\/(\d+)/],
  ['OperaMobile',       /OPR\/(\d+)/],
  ['Opera',             /OPR\/(\d+)/],
  ['Firefox',           /Firefox\/(\d+)/],
  ['Chrome',            /Chrome\/(\d+)/],
  ['Safari',            /Version\/(\d+).*Safari/],
]

function browserOf(ua: string): { browserFamily: string; browserMajor?: number } {
  for (const [family, pattern] of BROWSER_PATTERNS) {
    const match = ua.match(pattern)
    if (match) return { browserFamily: family, browserMajor: majorOf(match[1]) }
  }
  return { browserFamily: 'unknown' }
}

/** Pure, synchronous. Same UA string → same bucket, always. */
export function deriveDeviceBucket(userAgent: string | undefined | null): DeviceBucket {
  if (!userAgent || !userAgent.trim()) return UNKNOWN
  const ua = userAgent.trim()
  const { browserFamily, browserMajor } = browserOf(ua)
  return {
    deviceClass: deviceClassOf(ua),
    browserFamily,
    ...(browserMajor !== undefined ? { browserMajor } : {}),
    osFamily: osFamilyOf(ua),
  }
}
