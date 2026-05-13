import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

export interface WorkflowTemplate {
  templateId: string
  version: string
  displayName?: string
  seedInputKey?: string
  inputTemplate: Record<string, unknown>
  slotMap: Record<string, string>
  requiredModels: Array<{ role: string; id: string; url?: string; dest: string }>
  platformHints?: Record<string, unknown>
}

export class WorkflowTemplateError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'WorkflowTemplateError'
    this.code = code
  }
}

export class WorkflowTemplateRegistry {
  private readonly cache = new Map<string, WorkflowTemplate>()

  constructor(private readonly dir: string) {}

  /** Synchronously load and cache a template by id + version. Returns a deep clone. */
  get(templateId: string, version: string): WorkflowTemplate {
    const key = `${templateId}-v${version}`
    const cached = this.cache.get(key)
    if (cached) return JSON.parse(JSON.stringify(cached)) as WorkflowTemplate

    const filename = `${templateId}-v${version}.json`
    const filepath = path.join(this.dir, filename)

    let raw: string
    try {
      raw = readFileSync(filepath, 'utf-8')
    } catch {
      throw new WorkflowTemplateError('TEMPLATE_NOT_FOUND', `Workflow template not found: ${filename}`)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      throw new WorkflowTemplateError('TEMPLATE_PARSE_ERROR', `Failed to parse template ${filename}: ${String(err)}`)
    }

    const t = parsed as WorkflowTemplate
    if (t.templateId !== templateId || t.version !== version) {
      throw new WorkflowTemplateError(
        'TEMPLATE_MISMATCH',
        `Template ${filename} declares templateId=${t.templateId} version=${t.version} but expected ${templateId}/${version}`
      )
    }

    this.cache.set(key, t)
    return JSON.parse(JSON.stringify(t)) as WorkflowTemplate
  }

  /** List all available templates in the directory (templateId + version pairs). */
  list(): Array<{ templateId: string; version: string }> {
    let files: string[]
    try {
      files = readdirSync(this.dir).filter(f => f.endsWith('.json'))
    } catch {
      return []
    }
    const result: Array<{ templateId: string; version: string }> = []
    for (const file of files) {
      try {
        const t = this.get(
          file.replace(/-v\d+\.json$/, ''),
          file.match(/-v(\d+)\.json$/)?.[1] ?? '1'
        )
        result.push({ templateId: t.templateId, version: t.version })
      } catch {
        // skip unparseable files
      }
    }
    return result
  }
}
