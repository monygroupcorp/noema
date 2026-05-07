const fs = require('fs');
const path = require('path');

const FILENAME_RE = /^(.+)-v(\d+)\.json$/;

class WorkflowTemplateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WorkflowTemplateError';
    this.code = code;
  }
}

class WorkflowTemplateRegistry {
  constructor({ rootDir, logger } = {}) {
    this.rootDir = rootDir || path.join(__dirname, 'workflows');
    this.logger = logger || console;
    this._cache = new Map();
  }

  get(templateId, version) {
    const key = `${templateId}-v${version}`;
    if (this._cache.has(key)) {
      return this._cache.get(key);
    }

    const filePath = path.join(this.rootDir, `${key}.json`);

    let raw;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        throw new WorkflowTemplateError(
          'TEMPLATE_NOT_FOUND',
          `Workflow template not found: ${filePath}`
        );
      }
      throw new WorkflowTemplateError(
        'TEMPLATE_NOT_FOUND',
        `Failed to read workflow template ${filePath}: ${err.message}`
      );
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new WorkflowTemplateError(
        'TEMPLATE_PARSE_ERROR',
        `Failed to parse workflow template ${filePath}: ${err.message}`
      );
    }

    if (parsed.templateId !== templateId) {
      throw new WorkflowTemplateError(
        'TEMPLATE_MISMATCH',
        `Template ${filePath} declares templateId="${parsed.templateId}", expected "${templateId}"`
      );
    }
    if (String(parsed.version) !== String(version)) {
      throw new WorkflowTemplateError(
        'TEMPLATE_MISMATCH',
        `Template ${filePath} declares version="${parsed.version}", expected "${version}"`
      );
    }

    this._cache.set(key, parsed);
    return parsed;
  }

  list() {
    let entries;
    try {
      entries = fs.readdirSync(this.rootDir);
    } catch (err) {
      this.logger.warn(`[WorkflowTemplateRegistry] Failed to read ${this.rootDir}: ${err.message}`);
      return [];
    }

    const out = [];
    for (const name of entries) {
      const m = FILENAME_RE.exec(name);
      if (!m) continue;
      out.push({ templateId: m[1], version: m[2] });
    }
    return out;
  }

  clearCache() {
    this._cache.clear();
  }
}

module.exports = WorkflowTemplateRegistry;
module.exports.WorkflowTemplateRegistry = WorkflowTemplateRegistry;
module.exports.WorkflowTemplateError = WorkflowTemplateError;

if (require.main === module) {
  (() => {
    const failures = [];
    const registry = new WorkflowTemplateRegistry({
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
    });

    // A. get('flux-schnell', '1') resolves with expected shape.
    let tpl;
    try {
      tpl = registry.get('flux-schnell', '1');
    } catch (err) {
      failures.push(`A: get('flux-schnell','1') threw: ${err.message}`);
    }
    if (tpl) {
      if (tpl.templateId !== 'flux-schnell') failures.push(`A: templateId expected 'flux-schnell', got '${tpl.templateId}'`);
      if (String(tpl.version) !== '1') failures.push(`A: version expected '1', got '${tpl.version}'`);
      const expectedSlots = [
        '/13/inputs/seed',
        '/13/inputs/steps',
        '/6/inputs/width',
        '/6/inputs/height',
        '/22/inputs/clip_l',
        '/22/inputs/t5xxl'
      ];
      for (const k of expectedSlots) {
        if (!tpl.slotMap || !(k in tpl.slotMap)) {
          failures.push(`A: slotMap missing key '${k}'`);
        }
      }
    }

    // B. Second get serves from cache — wrap fs.readFileSync in a counting spy.
    const realReadFileSync = fs.readFileSync;
    let readCount = 0;
    fs.readFileSync = function spy(...args) {
      readCount += 1;
      return realReadFileSync.apply(fs, args);
    };
    try {
      const r2 = new WorkflowTemplateRegistry({
        logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
      });
      r2.get('flux-schnell', '1');
      r2.get('flux-schnell', '1');
      if (readCount !== 1) failures.push(`B: expected 1 readFileSync call, got ${readCount}`);
      r2.clearCache();
      r2.get('flux-schnell', '1');
      if (readCount !== 2) failures.push(`B: expected 2 readFileSync calls after clearCache, got ${readCount}`);
    } finally {
      fs.readFileSync = realReadFileSync;
    }

    // C. Missing template throws TEMPLATE_NOT_FOUND.
    let caught = null;
    try {
      registry.get('nonexistent', '1');
    } catch (err) {
      caught = err;
    }
    if (!caught) {
      failures.push("C: expected get('nonexistent','1') to throw");
    } else if (!(caught instanceof WorkflowTemplateError)) {
      failures.push(`C: expected WorkflowTemplateError, got ${caught.constructor.name}`);
    } else if (caught.code !== 'TEMPLATE_NOT_FOUND') {
      failures.push(`C: expected code TEMPLATE_NOT_FOUND, got ${caught.code}`);
    }

    // D. list() includes flux-schnell v1, excludes README.
    const entries = registry.list();
    const hasFlux = entries.some((e) => e.templateId === 'flux-schnell' && String(e.version) === '1');
    if (!hasFlux) failures.push(`D: list() missing { templateId:'flux-schnell', version:'1' }: ${JSON.stringify(entries)}`);
    const hasReadme = entries.some((e) => /readme/i.test(e.templateId));
    if (hasReadme) failures.push(`D: list() should not include README: ${JSON.stringify(entries)}`);

    if (failures.length) {
      console.error('FAIL:', failures.join('; '));
      process.exit(1);
    }
    console.log('PASS: WorkflowTemplateRegistry');
    console.log("  - get('flux-schnell','1') returns template with all expected slotMap keys");
    console.log('  - second get() served from cache (readFileSync called once); clearCache() forces re-read');
    console.log("  - get('nonexistent','1') throws WorkflowTemplateError code=TEMPLATE_NOT_FOUND");
    console.log(`  - list() returns ${entries.length} entry(ies) including flux-schnell v1, excludes README`);
  })();
}
