#!/usr/bin/env -S npx tsx
// =============================================================================
// verify-openai-image-models — smoke-test the OpenAI image/imageEdit lanes
// =============================================================================
//
// Runs ONE real generation and ONE real edit through the actual production
// code path (`ApiCursor` bound to `OPENAI_PROVIDER`, the same descriptor
// `src/container.ts` registers) against OpenAI's live API. Prints the request
// sent, the image returned, and the impetus the real response's token usage
// metered — the evidence a human needs to reconcile against OpenAI's own
// usage dashboard (platform.openai.com/usage) for these two calls.
//
// This spends real money on the configured OpenAI account (a few cents at
// `low`/`medium` quality). It is a developer CLI, not the product path — run
// it deliberately, not from CI or an unattended pass.
//
//   OPENAI_API_KEY=sk-... npx tsx scripts/verify-openai-image-models.ts
//   npx tsx scripts/verify-openai-image-models.ts --prompt "..." --quality medium
//   npx tsx scripts/verify-openai-image-models.ts --out ./tmp
//
// `.env` users: ./scripts/run-with-env.sh npx tsx scripts/verify-openai-image-models.ts
// =============================================================================

import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { ApiCursor, httpApiTransport } from '../src/crystal/ApiCursor.js'
import { OPENAI_PROVIDER } from '../src/crystal/apiProviders.js'
import type { Actum } from '../src/types/actum.js'
import type { Modus } from '../src/types/modus.js'

const USAGE = `usage:
  OPENAI_API_KEY=sk-... npx tsx scripts/verify-openai-image-models.ts [options]

options:
  --prompt <text>    Generation prompt (default: a dense typographic/layout poster —
                     the kind of prompt the case-corpus-catalog corpus is built from).
  --quality <q>      low | medium | high | auto (default: medium)
  --size <WxH>       default: 1024x1024
  --out <dir>        where to write the two PNGs (default: ./tmp/verify-openai-image)
`

const DEFAULT_PROMPT = [
  'A vertical poster, flat graphic design, no photographic imagery.',
  "Top third: the bold condensed headline 'FIELD NOTES' in black sans-serif,",
  'letter-spaced and centered, with a thin horizontal rule beneath it.',
  'Middle third: three columns of small monospace body text, left-aligned,',
  "separated by thin vertical rules, each column headed by a circular badge",
  "numbered '01', '02', '03'.",
  "Bottom third: a wide deep-orange bar with centered white serif text reading",
  "'SUBSCRIBE TODAY', flanked by two small arrow glyphs.",
  "Footer: small gray text bottom-left reading 'Issue No. 14 — Spring Collection',",
  'and a QR-code-shaped placeholder square bottom-right.',
  'High contrast, precise alignment, crisp readable typography throughout.',
].join(' ')

type Args = { prompt: string; quality: string; size: string; out: string }

function parseArgs(argv: string[]): Args {
  const args: Args = { prompt: DEFAULT_PROMPT, quality: 'medium', size: '1024x1024', out: './tmp/verify-openai-image' }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = argv[i + 1]
    const need = (): string => {
      if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`)
      i++
      return value
    }
    switch (flag) {
      case '--prompt': args.prompt = need(); break
      case '--quality': args.quality = need(); break
      case '--size': args.size = need(); break
      case '--out': args.out = need(); break
      case '--help': case '-h': console.log(USAGE); process.exit(0)
      default: throw new Error(`unknown argument '${flag}'\n\n${USAGE}`)
    }
  }
  return args
}

function makeModus(overrides: Partial<Modus>): Modus {
  return {
    id: 'verify-script', nomen: 'verify', genus: 'atomicus', versio: '0.0.0', contentHash: '',
    aditus: {}, exitus: {}, ministerium: 'openai', canonica: false,
    natum: new Date(), mutatum: new Date(), ...overrides,
  }
}

function makeActum(aditus: Record<string, unknown>, impetus: bigint): Actum {
  return {
    id: `verify-${Date.now()}`, modusId: 'verify-script', modusVersiono: '0.0.0',
    impetus, signaConsumed: [], aditus, status: 'nascens',
    inceptum: new Date(), expirat: new Date(Date.now() + 60_000),
  }
}

async function saveImage(dir: string, name: string, image: string): Promise<string> {
  const file = path.join(dir, name)
  if (image.startsWith('data:')) {
    const b64 = image.slice(image.indexOf(',') + 1)
    await writeFile(file, Buffer.from(b64, 'base64'))
  } else {
    const res = await fetch(image)
    await writeFile(file, Buffer.from(await res.arrayBuffer()))
  }
  return file
}

async function main(): Promise<void> {
  const apiKey = process.env[OPENAI_PROVIDER.authEnv]
  if (!apiKey) throw new Error(`${OPENAI_PROVIDER.authEnv} is not set — export it or run via scripts/run-with-env.sh`)
  const args = parseArgs(process.argv.slice(2))
  await mkdir(args.out, { recursive: true })

  const cursor = new ApiCursor(OPENAI_PROVIDER, { apiKey, http: httpApiTransport })

  // ── 1. Generation — modus.gpt-image's shape, at the provider's current defaultModel ──
  const genAditus = { prompt: args.prompt, size: args.size, quality: args.quality, __capability: 'image' as const }
  console.log('── generation ──')
  console.log('model   ', OPENAI_PROVIDER.capabilities.image?.defaultModel)
  console.log('aditus  ', genAditus)
  const genResult = await cursor.run(makeActum(genAditus, 1200n), undefined)
  if (genResult.kind !== 'sync') throw new Error(`expected a sync result, got ${genResult.kind}`)
  const genImage = (genResult.exitus.exitus as { image: string }).image
  const genFile = await saveImage(args.out, 'generation.png', genImage)
  console.log('image   ', genFile)
  console.log('impetus ', genResult.exitus.impetus.toString())

  // ── 2. Edit — feeds the generation straight back in as the source image ──
  const cursorWithFetcher = new ApiCursor(OPENAI_PROVIDER, {
    apiKey, http: httpApiTransport,
    mediaFetcher: { async fetch(url) {
      if (url.startsWith('data:')) return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')
      const res = await fetch(url)
      return Buffer.from(await res.arrayBuffer())
    } },
  })
  const editAditus = { image: genImage, prompt: 'Recolor the orange bar to deep teal.', __capability: 'imageEdit' as const }
  console.log('\n── edit ──')
  console.log('model   ', OPENAI_PROVIDER.capabilities.imageEdit?.defaultModel)
  console.log('aditus  ', { ...editAditus, image: '<generation.png>' })
  const editResult = await cursorWithFetcher.run(makeActum(editAditus, 600n), undefined)
  if (editResult.kind !== 'sync') throw new Error(`expected a sync result, got ${editResult.kind}`)
  const editImage = (editResult.exitus.exitus as { image: string }).image
  const editFile = await saveImage(args.out, 'edit.png', editImage)
  console.log('image   ', editFile)
  console.log('impetus ', editResult.exitus.impetus.toString())

  console.log('\nReconcile both calls against https://platform.openai.com/usage for this key.')
}

main().catch((err) => { console.error(err); process.exit(1) })
