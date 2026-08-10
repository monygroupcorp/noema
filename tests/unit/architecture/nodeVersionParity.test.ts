import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// The shipped image's Node base and CI's test runner must agree on major version — a mismatch
// means CI proves the code works on a Node the product never actually runs. `node:sqlite`
// (used by AitkJobStore, see src/crystal/AitkJobStore.ts) is built into Node 22.5+, so the
// floor is also pinned here: this guard fails loudly if a future edit pins either file below 22,
// not just if the two files disagree with each other.

const MIN_MAJOR = 22

function extractDockerfileMajors(text: string): number[] {
  const re = /^FROM node:(\d+)(?:\.\d+)*-slim/gm
  const out: number[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) out.push(Number(m[1]))
  return out
}

function extractCiMajors(text: string): number[] {
  const re = /node-version:\s*['"]?(\d+)/g
  const out: number[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) out.push(Number(m[1]))
  return out
}

test('Dockerfile node base and CI node-version agree, and are both >= 22 (node:sqlite floor)', () => {
  const dockerfilePath = path.join(process.cwd(), 'Dockerfile')
  const ciPath = path.join(process.cwd(), '.github/workflows/ci.yml')

  const dockerfileMajors = extractDockerfileMajors(readFileSync(dockerfilePath, 'utf8'))
  const ciMajors = extractCiMajors(readFileSync(ciPath, 'utf8'))

  assert.ok(dockerfileMajors.length > 0, 'no `FROM node:<tag>-slim` lines found in Dockerfile')
  assert.ok(ciMajors.length > 0, 'no `node-version:` lines found in .github/workflows/ci.yml')

  const dockerfileSet = new Set(dockerfileMajors)
  const ciSet = new Set(ciMajors)

  assert.equal(
    dockerfileSet.size,
    1,
    `Dockerfile pins mixed Node majors across its stages: ${[...dockerfileSet].join(', ')} — all FROM ` +
      `node:<major>-slim lines must agree`,
  )
  assert.equal(
    ciSet.size,
    1,
    `.github/workflows/ci.yml pins mixed Node majors across its jobs: ${[...ciSet].join(', ')} — all ` +
      `node-version entries must agree`,
  )

  const [dockerfileMajor] = dockerfileSet
  const [ciMajor] = ciSet

  assert.equal(
    dockerfileMajor,
    ciMajor,
    `Dockerfile pins node:${dockerfileMajor}-slim but .github/workflows/ci.yml pins node-version: ` +
      `${ciMajor} — CI must test the same Node major the image ships, or move Dockerfile to match ci.yml`,
  )

  assert.ok(
    dockerfileMajor >= MIN_MAJOR,
    `Node major ${dockerfileMajor} is below ${MIN_MAJOR} — node:sqlite (used by AitkJobStore) requires ` +
      `Node 22.5+; do not repin below ${MIN_MAJOR}`,
  )
})
