#!/usr/bin/env -S npx tsx
// =============================================================================
// muse-roll — decompose captions into a fragment garden and print real rolls
// =============================================================================
//
// The operator-facing front end for `src/crystal/muse/*`. It fires no gen,
// reserves no credits and touches no pod: captions in, a categorized garden out,
// then N woven prompts on the terminal so a human can judge the one thing no
// test can defend — whether the fragments are actually reusable.
//
//   npm run muse:roll -- --captions <file> [--trigger <word>] [--rolls 5]
//   npm run muse:roll -- --dataset <id> --captionset <id> [--trigger <word>]
//
// A captions file is one caption per line; blank lines are skipped. `--trigger`
// is that file's model binding (its LoRA trigger word) and is carried through to
// every fragment it produces, which is what lets a roll be turned back into a
// set of model attachments later.
//
// Environment:
//   OPENAI_API_KEY   the chat key; the name comes from the provider descriptor's
//                    `authEnv`, not from this file.
//   API_ORIGIN       API root for --dataset (default https://noema.art).
//   NOEMA_API_TOKEN  bearer session token for --dataset; the route is
//                    owner-scoped, so it reads only the caller's own datasets.
//
// `.env` users: ./scripts/run-with-env.sh npx tsx scripts/muse-roll.ts --captions …
//
// NOT the product path. This calls the provider directly from a developer CLI;
// nothing here is metered. `scripts/muse-weaver.ts` stays untouched as the
// original validated reference — this is a second, smaller script that drives
// the real modules instead of its own copies of them.
// =============================================================================

import { readFile } from 'node:fs/promises'
import { OPENAI_PROVIDER } from '../src/crystal/apiProviders.js'
import {
  createChatExtractor,
  gardenCounts,
  growGarden,
  type CaptionSource,
} from '../src/crystal/muse/garden.js'
import { formatRoll, formatTally, rollReport } from '../src/crystal/muse/roll.js'
import type { Captionset, Dataset } from '../src/types/dataset.js'

const USAGE = `usage:
  npm run muse:roll -- --captions <file> [--trigger <word>] [--rolls 5] [--model <id>]
  npm run muse:roll -- --dataset <id> --captionset <id> [--trigger <word>] [--rolls 5]`

type Args = {
  captions?: string
  dataset?: string
  captionset?: string
  trigger: string
  rolls: number
  model?: string
}

function parseArgs(argv: string[]): Args {
  const args: Args = { trigger: '', rolls: 5 }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = argv[i + 1]
    const need = (): string => {
      if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`)
      i++
      return value
    }
    switch (flag) {
      case '--captions': args.captions = need(); break
      case '--dataset': args.dataset = need(); break
      case '--captionset': args.captionset = need(); break
      case '--trigger': args.trigger = need(); break
      case '--model': args.model = need(); break
      case '--rolls': args.rolls = Number(need()); break
      case '--help': case '-h': console.log(USAGE); process.exit(0)
      default: throw new Error(`unknown argument '${flag}'\n\n${USAGE}`)
    }
  }
  if (!Number.isFinite(args.rolls) || args.rolls <= 0) throw new Error('--rolls must be a positive number')
  return args
}

// --- Caption sources ---------------------------------------------------------

/** One caption per line; blank lines dropped. The file name becomes the source. */
async function fromFile(path: string, trigger: string): Promise<CaptionSource> {
  const raw = await readFile(path, 'utf8')
  const captions = raw.split('\n').map((line) => line.trim()).filter(Boolean)
  const name = path.split('/').pop()?.replace(/\.[^.]+$/, '') || 'captions'
  return { name, trigger, captions }
}

/**
 * Read one captionset off a dataset the caller owns.
 *
 * The only owner-scoped route exposing captionsets is the rich dataset listing,
 * so the dataset is located within the caller's own page set. Nothing here can
 * name a dataset the caller does not own.
 */
async function fromDataset(datasetId: string, captionsetId: string, trigger: string): Promise<CaptionSource> {
  const origin = process.env.API_ORIGIN || 'https://noema.art'
  const token = process.env.NOEMA_API_TOKEN
  if (!token) throw new Error('NOEMA_API_TOKEN is required for --dataset (the route is owner-scoped)')

  let cursor: string | undefined
  let dataset: Dataset | undefined
  do {
    const url = new URL('/v1/data/datasets/full', origin)
    if (cursor) url.searchParams.set('cursor', cursor)
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } })
    const body = await res.text()
    if (!res.ok) throw new Error(`dataset listing failed (${res.status}): ${body.slice(0, 200)}`)
    const page = JSON.parse(body) as { entries?: Dataset[]; nextCursor?: string }
    dataset = page.entries?.find((d) => d.id === datasetId)
    cursor = dataset ? undefined : page.nextCursor
  } while (!dataset && cursor)

  if (!dataset) throw new Error(`no dataset '${datasetId}' among the caller's datasets`)
  const captionset: Captionset | undefined = dataset.captionsets.find((c) => c.id === captionsetId)
  if (!captionset) {
    const known = dataset.captionsets.map((c) => c.id).join(', ') || '(none)'
    throw new Error(`no captionset '${captionsetId}' on that dataset; it carries: ${known}`)
  }

  const captions = Object.values(captionset.captions ?? {}).map((c) => c.trim()).filter(Boolean)
  return { name: captionset.name || captionsetId, trigger, captions }
}

// --- Main --------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (!args.captions && !args.dataset) throw new Error(USAGE)
  if (args.captions && args.dataset) throw new Error('--captions and --dataset are alternatives')
  if (args.dataset && !args.captionset) throw new Error('--dataset also needs --captionset')

  const source = args.captions
    ? await fromFile(args.captions, args.trigger)
    : await fromDataset(args.dataset!, args.captionset!, args.trigger)

  if (source.captions.length === 0) {
    // Say so plainly rather than printing an empty garden, which reads like a
    // decomposition failure when it is simply a caption pass that has not run.
    console.log(`'${source.name}' holds no captions — nothing to decompose.`)
    console.log('A dataset captionset is filled by a caption run; until one has run, use --captions <file>.')
    return
  }

  const apiKey = process.env[OPENAI_PROVIDER.authEnv]
  if (!apiKey) throw new Error(`${OPENAI_PROVIDER.authEnv} is required to decompose captions`)

  const total = source.captions.length
  process.stdout.write(`decomposing ${total} captions from '${source.name}'`)
  const extract = createChatExtractor({
    provider: OPENAI_PROVIDER,
    apiKey,
    model: args.model,
    onCaption: () => process.stdout.write('.'),
  })
  const built = await growGarden([source], extract)
  process.stdout.write('\n\n')

  console.log(`garden: ${built.kept} fragments`)
  for (const { category, count } of gardenCounts(built.garden)) {
    console.log(`  ${category.padEnd(11)} ${count}`)
  }
  const { unknownCategory, duplicate, blank, unknownCategories } = built.drops
  console.log(
    `dropped: ${unknownCategory} outside the taxonomy` +
      (unknownCategories.length ? ` (${unknownCategories.join(', ')})` : '') +
      `, ${duplicate} duplicate, ${blank} blank`,
  )
  if (source.trigger) console.log(`model binding: every fragment carries '${source.trigger}'`)
  else console.log('model binding: none supplied (--trigger sets it)')

  console.log('')
  const report = rollReport(built.garden, args.rolls)
  for (const roll of report.rolls) console.log(`${formatRoll(roll)}\n`)
  console.log(formatTally(report))
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
