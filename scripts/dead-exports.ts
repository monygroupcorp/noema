#!/usr/bin/env -S npx tsx
// =============================================================================
// dead-exports — exported declarations under src/ with zero references anywhere
// in the repo (src/, scripts/, tests/) except their own declaration.
// =============================================================================
//
// codebase-factoring clause 3: dead code the census proves unreferenced gets deleted.
// This is the prover. It builds a real TypeScript program (not a text grep) and asks the
// language service for every reference to every top-level exported declaration under src/
// (excluding src/platforms/web/app, which is its own program/package — see the note below).
// A declaration with no reference outside its own declaration site is a candidate.
//
// This is a candidate list, not an auto-delete: a route registered by string name, a default
// export picked up by a loader, or a symbol re-exported for a consumer outside this program
// (the web app, a script invoked only in CI, a future caller) can show zero *static* references
// here and still be live. Read every candidate before deleting it.
//
// READ-ONLY: prints a report, writes nothing.
//
// Usage:
//     npx tsx scripts/dead-exports.ts
// =============================================================================

import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

// A reference living only in tests/ or scripts/ still makes a declaration live — a bespoke
// in-memory store under src/crystal/Memory*.ts exists FOR tests/unit/**, and a migration under
// src/migrations/ exists FOR scripts/. Building the program from src/'s tsconfig alone treats
// every such reference as absent and the declaration as dead. So this unions the file lists of
// tsconfig.json, tsconfig.tests.json and tsconfig.scripts.json into one program. The web app
// (src/platforms/web/app) keeps its own tsconfig (bundler resolution, JSX, a separate package) and
// is deliberately left out of this program — it is excluded from all three configs already.
function fileNamesOf(configPath: string): string[] {
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile)
  if (configFile.error) throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'))
  return ts.parseJsonConfigFileContent(configFile.config, ts.sys, ROOT).fileNames
}

function loadProgram(): ts.Program {
  const rootNames = new Set<string>([
    ...fileNamesOf(join(ROOT, 'tsconfig.json')),
    ...fileNamesOf(join(ROOT, 'tsconfig.tests.json')),
    ...fileNamesOf(join(ROOT, 'tsconfig.scripts.json')),
  ])
  // One consistent option set for the combined program (module/resolution only affect how imports
  // are followed for this analysis, not any emit — nothing here is compiled or run).
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    esModuleInterop: true,
    skipLibCheck: true,
    strict: true,
  }
  return ts.createProgram({ rootNames: [...rootNames], options })
}

interface Candidate {
  file: string
  name: string
  kind: string
  line: number
}

function topLevelExportedDecls(sourceFile: ts.SourceFile): { name: ts.Identifier; node: ts.Node; kind: string }[] {
  const out: { name: ts.Identifier; node: ts.Node; kind: string }[] = []
  for (const stmt of sourceFile.statements) {
    const hasExport = (ts.canHaveModifiers(stmt) && ts.getModifiers(stmt)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) ?? false
    if (!hasExport) continue
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) out.push({ name: decl.name, node: stmt, kind: 'const/let' })
      }
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      out.push({ name: stmt.name, node: stmt, kind: 'function' })
    } else if (ts.isClassDeclaration(stmt) && stmt.name) {
      out.push({ name: stmt.name, node: stmt, kind: 'class' })
    } else if (ts.isInterfaceDeclaration(stmt)) {
      out.push({ name: stmt.name, node: stmt, kind: 'interface' })
    } else if (ts.isTypeAliasDeclaration(stmt)) {
      out.push({ name: stmt.name, node: stmt, kind: 'type' })
    } else if (ts.isEnumDeclaration(stmt)) {
      out.push({ name: stmt.name, node: stmt, kind: 'enum' })
    }
    // default exports, `export { X }` re-export lists, and `export *` are deliberately
    // skipped — re-export surfaces need call-site awareness this script doesn't have.
  }
  return out
}

function main() {
  const program = loadProgram()
  const checker = program.getTypeChecker()
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => program.getSourceFiles().map(f => f.fileName),
    getScriptVersion: () => '0',
    getScriptSnapshot: (fileName) => {
      const text = program.getSourceFile(fileName)?.text ?? (ts.sys.fileExists(fileName) ? ts.sys.readFile(fileName) : undefined)
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text)
    },
    getCurrentDirectory: () => ROOT,
    getCompilationSettings: () => program.getCompilerOptions(),
    getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  }
  const languageService = ts.createLanguageService(host, ts.createDocumentRegistry())

  const candidates: Candidate[] = []
  for (const sourceFile of program.getSourceFiles()) {
    if (!sourceFile.fileName.includes('/src/')) continue
    if (program.isSourceFileFromExternalLibrary(sourceFile)) continue
    if (sourceFile.fileName.endsWith('.d.ts')) continue
    const decls = topLevelExportedDecls(sourceFile)
    for (const { name, kind } of decls) {
      const refs = languageService.getReferencesAtPosition(sourceFile.fileName, name.getStart(sourceFile))
      const externalRefs = (refs ?? []).filter(r => !(r.fileName === sourceFile.fileName && r.textSpan.start === name.getStart(sourceFile)))
      if (externalRefs.length === 0) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(name.getStart(sourceFile))
        candidates.push({ file: sourceFile.fileName.replace(ROOT + '/', ''), name: name.text, kind, line: line + 1 })
      }
    }
  }

  candidates.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
  console.log(`# ${candidates.length} exported declaration(s) with zero references found anywhere in the TS program rooted at src/ (web app excluded — separate program/tsconfig)\n`)
  for (const c of candidates) {
    console.log(`${c.file}:${c.line}  ${c.kind}  ${c.name}`)
  }
}

main()
