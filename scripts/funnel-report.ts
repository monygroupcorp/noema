#!/usr/bin/env -S npx tsx
// =============================================================================
// funnel-report — where do visitors stop? (noema/user-behaviour-corpus clause 6)
// =============================================================================
//
// Prints the visitor journey (catalog_view → quote → sign_in → funding_attempt →
// run_attempt → run_complete) with distinct-visitor counts and drop-off at each step.
// Hits the live server's own /internal/analytics/funnel — the same aggregation the
// endpoint serves, not a parallel Mongo query — so this is never a second place the
// funnel math could drift from what the API answers.
//
// READ-ONLY. Connects, queries, prints, exits. Nothing is written.
//
// Usage:
//
//     NOEMA_URL=https://staging.example.com INTERNAL_SECRET=xxx npx tsx scripts/funnel-report.ts
//     ... --since=2024-01-01                                      # default: last 24h
//     ... --json                                                  # machine-readable
// =============================================================================

interface FunnelStage {
  stage:        string
  visitors:     number
  ofStart:      number
  ofPrevious:   number
  droppedHere:  number
}
interface FunnelResponse { since: string; stages: FunnelStage[] }

const BASE_URL = process.env.NOEMA_URL ?? 'http://localhost:3000'
const SECRET   = process.env.INTERNAL_SECRET ?? ''

function pct(n: number): string { return `${(n * 100).toFixed(1)}%` }

/** Pure — the human-readable table, so it's testable without a server. */
export function formatFunnelReport(data: FunnelResponse): string {
  const lines: string[] = []
  lines.push(`Visitor funnel since ${data.since}`)
  lines.push('')
  const stageWidth = Math.max(...data.stages.map((s) => s.stage.length), 'stage'.length)
  lines.push(`${'stage'.padEnd(stageWidth)}  visitors   of start   of previous   dropped here`)
  for (const s of data.stages) {
    lines.push(
      `${s.stage.padEnd(stageWidth)}  ${String(s.visitors).padStart(8)}   ${pct(s.ofStart).padStart(8)}   ${pct(s.ofPrevious).padStart(11)}   ${String(s.droppedHere).padStart(12)}`,
    )
  }
  return lines.join('\n')
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const asJson = args.includes('--json')
  const sinceArg = args.find((a) => a.startsWith('--since='))?.split('=')[1]

  const url = new URL('/internal/analytics/funnel', BASE_URL)
  url.searchParams.set('token', SECRET)
  if (sinceArg) url.searchParams.set('since', sinceArg)

  const res = await fetch(url)
  if (!res.ok) {
    console.error(`funnel-report: ${res.status} ${await res.text().catch(() => res.statusText)}`)
    process.exitCode = 1
    return
  }
  const data = (await res.json()) as FunnelResponse

  if (asJson) {
    console.log(JSON.stringify(data, null, 2))
    return
  }
  console.log(formatFunnelReport(data))
}

// Only auto-runs when executed directly — importing `formatFunnelReport` for a unit test
// must not also fire a live fetch (same guard as report-addressless-intellae.ts).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('funnel-report: unexpected error', err)
    process.exitCode = 1
  })
}
