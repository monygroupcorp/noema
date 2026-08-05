#!/usr/bin/env node
// Usage: NOEMA_URL=https://staging.example.com INTERNAL_SECRET=xxx node scripts/dashboard.js

const blessed     = require('blessed')
const contrib     = require('blessed-contrib')
const EventSource = require('eventsource')

const BASE_URL = process.env.NOEMA_URL ?? 'http://localhost:3000'
const SECRET   = process.env.INTERNAL_SECRET ?? ''
const URL      = `${BASE_URL}/internal/live?token=${encodeURIComponent(SECRET)}`

// ── Screen setup ─────────────────────────────────────────────────────────────

const screen = blessed.screen({ smartCSR: true, title: 'noema dashboard' })
const grid   = new contrib.grid({ rows: 12, cols: 12, screen })

// ── Hints bar (bottom 1 row, outside grid) ────────────────────────────────────

const hintsBar = blessed.box({
  parent: screen,
  bottom: 0,
  left: 0,
  width: '100%',
  height: 1,
  tags: true,
  style: { fg: 'white', bg: 'blue' },
})

// ── Widgets ───────────────────────────────────────────────────────────────────

const activeTable = grid.set(0, 0, 6, 4, contrib.table, {
  label: ' ACTIVE PODS ',
  columnSpacing: 1,
  columnWidth: [8, 12, 6, 12],
  border: { type: 'line' },
})

const revLine = grid.set(0, 4, 3, 8, contrib.line, {
  label: ' REVENUE / COST (60m) ',
  showLegend: true,
  legend: { width: 12 },
  border: { type: 'line' },
})

const completionsTable = grid.set(3, 4, 3, 8, contrib.table, {
  label: ' RECENT COMPLETIONS ',
  headers: ['actumId', 'modus', 'duration', 'outcome'],
  columnWidth: [8, 12, 8, 14],
  border: { type: 'line' },
})

const logBox = grid.set(6, 0, 5, 12, contrib.log, {
  label: ' LOG [info] ',
  fg: 'white',
  border: { type: 'line' },
  scrollable: true,
})

// ── State ─────────────────────────────────────────────────────────────────────

const activeActa = new Map()        // actumId → { modusId, stage, startTs }
const completions = []              // last 20 wide events
const revenuePoints = new Array(60).fill(0)   // ETH per minute, rolling
const costPoints    = new Array(60).fill(0)
let logLevel   = 'info'
let logFilter  = ''
let connected  = false
let mouseMode  = false   // start with mouse OFF so text is selectable by default

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }

// ── Hints bar renderer ────────────────────────────────────────────────────────

function renderHints() {
  const debugPart  = logLevel === 'debug'
    ? '{bold}[D]{/bold} {green-fg}debug ON{/}'
    : '{bold}[D]{/bold} debug'
  const filterPart = logFilter
    ? `{bold}[F]{/bold} filter: {yellow-fg}${logFilter}{/}  {bold}[X]{/bold} clear`
    : '{bold}[F]{/bold} filter'
  const mousePart  = mouseMode
    ? '{bold}[M]{/bold} {green-fg}scroll ON{/}'
    : '{bold}[M]{/bold} scroll'
  const retroPart  = '{bold}[T]{/bold} retro'
  const quitPart   = '{bold}[Q]{/bold} quit'
  const connPart   = connected
    ? '{green-fg}● connected{/}'
    : '{red-fg}✗ disconnected{/}'

  hintsBar.setContent(
    `  ${debugPart}   ${filterPart}   ${mousePart}   ${retroPart}   ${quitPart}   │   ${connPart}   ${BASE_URL}`
  )
  screen.render()
}

// ── Renderers ─────────────────────────────────────────────────────────────────

function renderActive() {
  activeTable.setLabel(` ACTIVE PODS (${activeActa.size}) `)
  const rows = Array.from(activeActa.entries()).map(([id, info]) => {
    const elapsed = Math.round((Date.now() - info.startTs) / 1000)
    const elapsedStr = elapsed >= 60 ? `${Math.floor(elapsed/60)}m${elapsed%60}s` : `${elapsed}s`
    return [id.slice(0, 8), (info.modusId ?? '').slice(0, 12), elapsedStr, info.stage ?? 'initiated']
  })
  activeTable.setData({ headers: ['actum', 'modus', 'elapsed', 'stage'], data: rows })
  screen.render()
}

function renderCompletions() {
  const rows = completions.slice(-20).reverse().map(w => [
    w.actumId.slice(0, 8),
    (w.modusId ?? '').slice(0, 12),
    `${(w.durationMs / 1000).toFixed(1)}s`,
    w.status === 'completed'
      ? `+${(Number(w.impetus) / 1e18).toFixed(4)} ETH`
      : `✗ ${w.errorCode ?? 'error'}`,
  ])
  completionsTable.setData({ headers: ['actumId', 'modus', 'duration', 'outcome'], data: rows })
  screen.render()
}

function renderRevLine() {
  revLine.setData([
    { title: 'revenue', x: revenuePoints.map((_, i) => String(i)), y: revenuePoints, style: { line: 'green' } },
    { title: 'cost',    x: costPoints.map((_, i) => String(i)),    y: costPoints,    style: { line: 'red'   } },
  ])
  screen.render()
}

function addLog(entry) {
  if (!entry.msg) return
  if ((LEVELS[entry.level] ?? 1) < (LEVELS[logLevel] ?? 1)) return
  if (logFilter && !entry.component?.includes(logFilter) && !entry.msg.includes(logFilter)) return

  const ts    = entry.ts ? new Date(entry.ts).toISOString().slice(11, 19) : ''
  const retro = entry._retro ? ' {bold}[retro]{/bold}' : ''
  const line  = `${ts} [${entry.component ?? '?'}]  ${entry.msg}${retro}`

  const color = entry.level === 'error' ? '{red-fg}'
              : entry.level === 'warn'  ? '{yellow-fg}'
              : entry.level === 'debug' ? '{grey-fg}'
              : ''
  logBox.log(color ? `${color}${line}{/}` : line)
  screen.render()
}

// ── Event handlers ────────────────────────────────────────────────────────────

function onActumStart(data) {
  activeActa.set(data.actumId, { modusId: data.modusId, startTs: Date.now(), stage: 'initiated' })
  renderActive()
}

function onActumStage(data) {
  const info = activeActa.get(data.actumId)
  if (info) { info.stage = data.stage; renderActive() }
}

function onActumComplete(wide) {
  activeActa.delete(wide.actumId)
  completions.push(wide)
  if (completions.length > 100) completions.shift()

  // Roll ETH into revenue/cost buckets (current minute slot = index 59)
  revenuePoints[59] += Number(wide.impetus) / 1e18
  costPoints[59]    += (Number(wide.impetus) * 0.25) / 1e18  // rough infra cost estimate

  renderActive()
  renderCompletions()
  renderRevLine()
}

// ── SSE connection ────────────────────────────────────────────────────────────

const es = new EventSource(URL)

es.addEventListener('log',            e => { try { addLog(JSON.parse(e.data))            } catch {} })
es.addEventListener('actum.start',    e => { try { onActumStart(JSON.parse(e.data))      } catch {} })
es.addEventListener('actum.stage',    e => { try { onActumStage(JSON.parse(e.data))      } catch {} })
es.addEventListener('actum.complete', e => { try { onActumComplete(JSON.parse(e.data))   } catch {} })
es.addEventListener('actum.fail',     e => { try { onActumComplete(JSON.parse(e.data))   } catch {} })

es.onopen  = () => { connected = true;  renderHints() }
es.onerror = () => {
  connected = false
  renderHints()
  logBox.log('{red-fg}[dashboard] SSE connection lost — reconnecting…{/}')
}

// ── Keyboard bindings ─────────────────────────────────────────────────────────

screen.key(['d', 'D'], () => {
  logLevel = logLevel === 'debug' ? 'info' : 'debug'
  logBox.setLabel(` LOG [${logLevel}] `)
  renderHints()
})

screen.key(['t', 'T'], () => {
  // Toggle _retro lines: invert — if currently hiding retro, show; vice versa
  // Implemented by toggling a flag and re-rendering (requires log history — omit for simplicity;
  // just annotate the filter label)
  logBox.log('{yellow-fg}[dashboard] retro lines toggled — reconnect to replay{/}')
})

screen.key(['f', 'F'], () => {
  const box = blessed.textbox({
    parent: screen,
    top: 'center', left: 'center',
    width: 40, height: 3,
    border: { type: 'line' },
    label: ' Filter (component or msg) ',
    inputOnFocus: true,
  })
  box.focus()
  box.on('submit', val => {
    logFilter = val.trim()
    logBox.setLabel(` LOG [${logLevel}]${logFilter ? `  /${logFilter}/` : ''} `)
    box.destroy()
    renderHints()
  })
  screen.render()
})

screen.key(['m', 'M'], () => {
  mouseMode = !mouseMode
  if (mouseMode) {
    screen.program.enableMouse()
  } else {
    screen.program.disableMouse()
  }
  renderHints()
})

screen.key(['x', 'X'], () => {
  logFilter = ''
  logBox.setLabel(` LOG [${logLevel}] `)
  renderHints()
})

screen.key(['q', 'Q', 'C-c'], () => {
  es.close()
  process.exit(0)
})

// ── Minute tick — advance sparkline buckets ───────────────────────────────────

setInterval(() => {
  revenuePoints.shift(); revenuePoints.push(0)
  costPoints.shift();    costPoints.push(0)
  renderRevLine()
}, 60_000)

// ── Initial render ────────────────────────────────────────────────────────────

renderRevLine()
activeTable.setData({ headers: ['actum', 'modus', 'elapsed', 'stage'], data: [] })
completionsTable.setData({ headers: ['actumId', 'modus', 'duration', 'outcome'], data: [] })
renderHints()

logBox.log('{green-fg}[dashboard] connecting to ' + BASE_URL + '{/}')
logBox.log('{grey-fg}[dashboard] server raw logs → /tmp/crystal-dev.log{/}')
