import { bus } from './bus.js'
import { getTrace } from './trace.js'

export type Level = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  ts:          string
  level:       Level
  component:   string
  msg:         string
  actumId?:    string
  animaId?:    string
  [key: string]: unknown
}

const LEVELS: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 }
const MIN_LEVEL = LEVELS[(process.env.LOG_LEVEL as Level) ?? 'info']

// Parse DEBUG env var into enabled component patterns
// Supports: 'arcanum:*,ledger:signorum' or DEBUG_GROUP=arcanum (see GROUPS below)
const GROUPS: Record<string, string[]> = {
  arcanum:   ['arcanum:*',    'ledger:signorum',    'execution:inceptor'],
  deposit:   ['webhook:alchemy', 'deposit:*',       'ledger:signorum'],
  execution: ['execution:*',  'flow:execute',       'cursor:*'],
  telegram:  ['telegram:*',   'flow:*'],
  ledger:    ['ledger:*'],
}

function resolveDebugPatterns(): string[] {
  const patterns: string[] = []
  const group = process.env.DEBUG_GROUP
  if (group && GROUPS[group]) patterns.push(...GROUPS[group])
  const raw = process.env.DEBUG
  if (raw) patterns.push(...raw.split(',').map(s => s.trim()))
  return patterns
}

const DEBUG_PATTERNS = resolveDebugPatterns()

function matchesDebug(component: string): boolean {
  return DEBUG_PATTERNS.some(pat => {
    if (pat.endsWith(':*')) return component.startsWith(pat.slice(0, -1))
    return component === pat
  })
}

function emit(entry: LogEntry): void {
  process.stdout.write(JSON.stringify(entry) + '\n')
  bus.emit('log', entry)
}

function log(level: Level, component: string, msg: string, fields?: Record<string, unknown>): void {
  const ctx = getTrace()
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    component,
    msg,
    ...(ctx?.actumId  ? { actumId:  ctx.actumId  } : {}),
    ...(ctx?.animaId  ? { animaId:  ctx.animaId  } : {}),
    ...fields,
  }

  if (LEVELS[level] >= MIN_LEVEL) {
    emit(entry)
    return
  }

  // Below global threshold — only emit if component is debug-enabled or trace is live
  if (level === 'debug') {
    if (ctx?.liveTrace || matchesDebug(component)) {
      emit(entry)
    }
    // Always push to trace buffer regardless (for retroactive flush in Phase 2)
    ctx?.buffer.push(entry)
  }
}

export function makeLogger(component: string) {
  return {
    debug: (msg: string, fields?: Record<string, unknown>) => log('debug', component, msg, fields),
    info:  (msg: string, fields?: Record<string, unknown>) => log('info',  component, msg, fields),
    warn:  (msg: string, fields?: Record<string, unknown>) => log('warn',  component, msg, fields),
    error: (msg: string, fields?: Record<string, unknown>) => log('error', component, msg, fields),
  }
}
