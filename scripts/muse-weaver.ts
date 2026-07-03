// =============================================================================
// muse-weaver — prototype for the Muse "surprise" weaver (idea exploration)
// =============================================================================
//
// Validates the make-or-break stage of the Muse feature
// (docs/ideas/2026-06-30-muse-moodboard-to-masterpiece.md): can we take real
// dataset captions, decompose them into categorized prompt fragments, then
// recombine ONE fragment per category across a moodboard into a single coherent
// prompt — without firing a single gen?
//
// Staged so each step writes an inspectable artifact to the scratchpad:
//   fetch    moodboard sources        -> captions.json   (raw captions + trigger)
//   garden   each caption             -> garden.json     (categorized fragments)
//   combine  the garden               -> combos.json     (woven candidate prompts)
//
// Run (needs OPENAI_API + HF_TOKEN from .env):
//   ./scripts/run-with-env.sh npx tsx scripts/muse-weaver.ts fetch
//   ./scripts/run-with-env.sh npx tsx scripts/muse-weaver.ts garden
//   ./scripts/run-with-env.sh npx tsx scripts/muse-weaver.ts combine [N]
// =============================================================================

import OpenAI from 'openai'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const OUT = '/tmp/claude-1000/-home-rth-projects-main-noema-crystal/38827f87-a425-4ba0-862e-1e8bdd2311b6/scratchpad/muse'
const MODEL = 'gpt-4o'

// --- The moodboard: four anime-girl-centric sets, distinct styles ------------
// `trigger` is the LoRA binding (a fragment's source dataset == its model).
type Source =
  | { kind: 'hf'; repo: string; trigger: string }
  | { kind: 'koh-manifest'; path: string; trigger: string }

const MOODBOARD: Record<string, Source> = {
  lain:         { kind: 'hf', repo: 'noema-art/lainflux',         trigger: 'lain' },
  '13angel33':  { kind: 'hf', repo: 'noema-art/13angel33flux',    trigger: '13angel33' },
  kaminosekkei: { kind: 'hf', repo: 'noema-art/kaminosekkeiflux', trigger: 'kaminosekkei' },
  koh:          { kind: 'koh-manifest', path: 'scripts/.koh-manifest.json', trigger: 'koh' },
}

// --- Category taxonomy -------------------------------------------------------
// EXCLUSIVE categories define the world; >1 breaks the image.
// ATTRIBUTE categories describe the single figure and are MEANT to be mixed.
const EXCLUSIVE = ['setting', 'style', 'palette', 'lighting', 'mood'] as const
const ATTRIBUTE = ['subject', 'hair', 'outfit', 'pose', 'expression', 'props'] as const
const CATEGORIES = [...ATTRIBUTE, ...EXCLUSIVE]

const openai = new OpenAI({ apiKey: process.env.OPENAI_API })

// -----------------------------------------------------------------------------
// fetch — pull raw captions for each moodboard item
// -----------------------------------------------------------------------------
async function hfCaptions(repo: string, limit = 12): Promise<string[]> {
  const token = process.env.HF_TOKEN
  const auth = { Authorization: `Bearer ${token}` }
  const tree = await fetch(
    `https://huggingface.co/api/models/${repo}/tree/main?recursive=true`,
    { headers: auth },
  ).then((r) => r.json() as Promise<Array<{ path: string }>>)
  const txts = tree.filter((x) => x.path.endsWith('.txt')).slice(0, limit)
  const out: string[] = []
  for (const f of txts) {
    const url = `https://huggingface.co/${repo}/resolve/main/${encodeURIComponent(f.path)}`
    const body = await fetch(url, { headers: auth }).then((r) => r.text())
    if (body && !body.startsWith('Entry not found')) out.push(body.trim())
  }
  return out
}

async function kohCaptions(path: string, limit = 12): Promise<string[]> {
  const raw = JSON.parse(await readFile(path, 'utf8')) as Array<{ caption: string }>
  return raw.slice(0, limit).map((x) => x.caption.trim()).filter(Boolean)
}

async function stageFetch() {
  await mkdir(OUT, { recursive: true })
  const result: Record<string, { trigger: string; captions: string[] }> = {}
  for (const [name, src] of Object.entries(MOODBOARD)) {
    const captions =
      src.kind === 'hf' ? await hfCaptions(src.repo) : await kohCaptions(src.path)
    result[name] = { trigger: src.trigger, captions }
    console.log(`  ${name.padEnd(14)} ${captions.length} captions`)
  }
  await writeFile(join(OUT, 'captions.json'), JSON.stringify(result, null, 2))
  console.log(`\n→ ${join(OUT, 'captions.json')}`)
}

// -----------------------------------------------------------------------------
// garden — decompose each caption into categorized fragments (excerpt + tag)
// -----------------------------------------------------------------------------
type Fragment = { category: string; text: string; source: string; trigger: string }

const GARDEN_SYS = `You decompose an image caption into short, reusable PROMPT FRAGMENTS, each tagged with one category.

Categories (use ONLY these):
- subject: who/what the figure fundamentally is (e.g. "a young woman", "a winged angel")
- hair: hair description (e.g. "long silver wavy hair")
- outfit: clothing/attire (e.g. "a black frilly Victorian dress with lace")
- pose: body posture/action (e.g. "curled in a fetal position", "raising one hand")
- expression: face/emotion (e.g. "a melancholic distant gaze")
- props: held/worn HANDHELD or WORN objects only (e.g. "a parasol", "a small crown"). NOT scenery.
- setting: the PLACE / environment / background — the one location the figure is in (e.g. "a computer motherboard", "a sunlit meadow", "a dimly lit room")
- style: art medium/rendering style (e.g. "pixel art", "digital painting", "grainy retro photo")
- palette: dominant colors ONLY — adjectives + color words, no objects (e.g. "cool blues and whites", "muted earthy browns")
- lighting: the QUALITY of light ONLY — never a place. (e.g. "soft dappled sunlight", "a single dramatic spotlight", "harsh backlight")
- mood: overall feeling as ADJECTIVES, never a noun phrase (e.g. "serene and dreamlike", "eerie and mysterious"). Say "nostalgic", not "a nostalgic moment".

Hard rules to prevent fragments that collide when recombined:
- lighting describes HOW light falls, not WHERE. "a dimly lit room" is a SETTING, not lighting — only extract lighting if there is a distinct light QUALITY ("dim, diffuse light"). If the caption only implies a place is dark, put it in setting and leave lighting empty.
- setting is the ONE place. Do not also smuggle a place into props or lighting.
- palette is colors, not lit scenes. mood is adjectives, not events.

General rules:
- Each fragment is a SHORT noun/adjective phrase usable directly in an image prompt (3-12 words). Not a sentence.
- STRIP the trigger word "{TRIGGER}" and any "in X style" boilerplate — fragments must be reusable, not branded.
- Skip a category if the caption doesn't clearly support it. Quality over coverage.
- Return at most one fragment per category per caption (the most salient).`

async function tagCaption(caption: string, source: string, trigger: string): Promise<Fragment[]> {
  const res = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: GARDEN_SYS.replace('{TRIGGER}', trigger) },
      {
        role: 'user',
        content: `Caption:\n${caption}\n\nReturn JSON: {"fragments":[{"category":"...","text":"..."}]}`,
      },
    ],
  })
  const parsed = JSON.parse(res.choices[0].message.content || '{"fragments":[]}')
  return (parsed.fragments || [])
    .filter((f: any) => CATEGORIES.includes(f.category) && f.text)
    .map((f: any) => ({ category: f.category, text: f.text.trim(), source, trigger }))
}

async function stageGarden() {
  const captions = JSON.parse(await readFile(join(OUT, 'captions.json'), 'utf8')) as Record<
    string,
    { trigger: string; captions: string[] }
  >
  const garden: Record<string, Fragment[]> = {}
  for (const cat of CATEGORIES) garden[cat] = []
  for (const [name, { trigger, captions: caps }] of Object.entries(captions)) {
    process.stdout.write(`  ${name.padEnd(14)} `)
    for (const cap of caps) {
      const frags = await tagCaption(cap, name, trigger)
      for (const f of frags) garden[f.category].push(f)
      process.stdout.write('.')
    }
    process.stdout.write('\n')
  }
  await writeFile(join(OUT, 'garden.json'), JSON.stringify(garden, null, 2))
  console.log('\nGarden by category:')
  for (const cat of CATEGORIES) {
    const tag = (EXCLUSIVE as readonly string[]).includes(cat) ? '[excl]' : '[attr]'
    console.log(`  ${tag} ${cat.padEnd(11)} ${garden[cat].length}`)
  }
  console.log(`\n→ ${join(OUT, 'garden.json')}`)
}

// -----------------------------------------------------------------------------
// combine — sample one fragment per category, weave into one coherent prompt
// -----------------------------------------------------------------------------
// Deterministic-ish sampler: index-driven so reruns vary without Math.random.
function pick<T>(arr: T[], seed: number): T | undefined {
  if (!arr.length) return undefined
  return arr[seed % arr.length]
}

// Sample one fragment per category (skip empty), seeded by roll index.
function rollFragments(garden: Record<string, Fragment[]>, i: number): Fragment[] {
  const chosen: Fragment[] = []
  for (const cat of CATEGORIES) {
    const f = pick(garden[cat], i * 7 + cat.length + i)
    if (f) chosen.push(f)
  }
  return chosen
}

// --- Template composer: zero LLM, pure string assembly from tagged fragments -
// Slots ordered for image-model readability; missing categories just drop out.
const TEMPLATE_ORDER = [
  'style', 'subject', 'hair', 'outfit', 'pose', 'expression',
  'props', 'setting', 'lighting', 'palette', 'mood',
] as const

function composeTemplate(fragments: Fragment[]): string {
  const by: Record<string, string> = {}
  for (const f of fragments) by[f.category] = f.text
  const parts: string[] = []
  if (by.style) parts.push(by.style)
  if (by.subject) parts.push(by.subject)
  if (by.hair) parts.push(by.hair)
  if (by.outfit) parts.push(`wearing ${by.outfit}`)
  if (by.pose) parts.push(by.pose)
  if (by.expression) parts.push(by.expression)
  if (by.props) parts.push(`holding ${by.props}`)
  if (by.setting) parts.push(`set in ${by.setting}`)
  if (by.lighting) parts.push(by.lighting)
  if (by.palette) parts.push(`${by.palette} tones`)
  if (by.mood) parts.push(by.mood) // mood is now adjectival — render plainly
  return parts.join(', ')
}

// --- Conflict detector: the cheap gate that decides template vs LLM weave ----
// The exclusive/attribute split already prevents two-of-a-category. What slips
// through is CROSS-category leakage: two kept fragments implying two places, or
// brightness fighting itself. Detect those; only then is an LLM weave worth it.
const PLACE_WORDS = ['room', 'background', 'sky', 'landscape', 'environment',
  'meadow', 'forest', 'interior', 'indoors', 'outdoors', 'field', 'wall',
  'castle', 'building', 'motherboard', 'street', 'studio', 'seascape']
const BRIGHT_WORDS = ['bright', 'vibrant', 'sunlit', 'glowing', 'radiant', 'luminous']
const DIM_WORDS = ['dim', 'dark', 'muted', 'shadowy', 'gloomy', 'overcast', 'night']

function hasAny(text: string, words: string[]): boolean {
  const t = text.toLowerCase()
  return words.some((w) => t.includes(w))
}

function detectConflicts(fragments: Fragment[]): string[] {
  const reasons: string[] = []
  // 1. Two implied places (a non-setting fragment smuggling a location).
  const placeFrags = fragments.filter(
    (f) => f.category !== 'setting' && hasAny(f.text, PLACE_WORDS),
  )
  const setting = fragments.find((f) => f.category === 'setting')
  for (const pf of placeFrags) {
    reasons.push(`two places: [${pf.category}] "${pf.text}" implies a location alongside [setting] "${setting?.text ?? '—'}"`)
  }
  // 2. Brightness fighting itself across WHOLE-SCENE descriptors only.
  // (lighting is excluded: a bright light source in a dark scene is chiaroscuro,
  // not a clash — only setting↔palette describe the whole scene's brightness.)
  const scene = fragments.filter((f) => ['setting', 'palette'].includes(f.category))
  const bright = scene.find((f) => hasAny(f.text, BRIGHT_WORDS))
  const dim = scene.find((f) => hasAny(f.text, DIM_WORDS))
  if (bright && dim) {
    reasons.push(`brightness clash: [${bright.category}] "${bright.text}" vs [${dim.category}] "${dim.text}"`)
  }
  return reasons
}

const WEAVE_SYS = `You are the Muse weaver. You receive a set of prompt fragments, each from a different source, each tagged with a category. Weave them into ONE coherent, vivid image-generation prompt for a single image.

Rules:
- Use EVERY fragment's essence. Do not drop any. Do not add new major elements.
- Produce flowing, natural prompt language — not a comma-salad list, not a paragraph of prose. One tight prompt (~40-70 words).
- Resolve tension between fragments gracefully so the result is a single believable image (one figure, one setting, one style).
- Output JSON: {"prompt":"...","cohesion_note":"one sentence on the hardest tension you resolved"}`

async function weave(fragments: Fragment[]): Promise<{ prompt: string; cohesion_note: string }> {
  const lines = fragments.map((f) => `- [${f.category}] ${f.text}  (from ${f.source})`).join('\n')
  const res = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.8,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: WEAVE_SYS },
      { role: 'user', content: `Fragments:\n${lines}` },
    ],
  })
  return JSON.parse(res.choices[0].message.content || '{}')
}

async function stageCombine(n: number) {
  const garden = JSON.parse(await readFile(join(OUT, 'garden.json'), 'utf8')) as Record<
    string,
    Fragment[]
  >
  const combos: any[] = []
  for (let i = 0; i < n; i++) {
    const chosen = rollFragments(garden, i)
    const triggers = [...new Set(chosen.map((f) => f.trigger))]
    const woven = await weave(chosen)
    combos.push({ roll: i + 1, triggers, fragments: chosen, ...woven })
    console.log(`\n── Roll ${i + 1} ${'─'.repeat(40)}`)
    console.log(`models:  ${triggers.join(' + ')}`)
    for (const f of chosen) console.log(`  [${f.category.padEnd(10)}] ${f.text}  ←${f.source}`)
    console.log(`\nPROMPT:  ${woven.prompt}`)
    console.log(`cohesion: ${woven.cohesion_note}`)
  }
  await writeFile(join(OUT, 'combos.json'), JSON.stringify(combos, null, 2))
  console.log(`\n→ ${join(OUT, 'combos.json')}`)
}

// -----------------------------------------------------------------------------
// versus — same fragments, two weave methods, side by side. Judge what the
// LLM actually adds over the free template.
// -----------------------------------------------------------------------------
async function stageVersus(n: number) {
  const garden = JSON.parse(await readFile(join(OUT, 'garden.json'), 'utf8')) as Record<
    string,
    Fragment[]
  >
  const out: any[] = []
  for (let i = 0; i < n; i++) {
    const chosen = rollFragments(garden, i)
    const triggers = [...new Set(chosen.map((f) => f.trigger))]
    const template = composeTemplate(chosen) // free, instant
    const woven = await weave(chosen) // 1 LLM call
    out.push({ roll: i + 1, triggers, fragments: chosen, template, ...woven })
    console.log(`\n══ Roll ${i + 1}  (${triggers.join(' + ')}) ${'═'.repeat(28)}`)
    for (const f of chosen) console.log(`   [${f.category.padEnd(10)}] ${f.text}  ←${f.source}`)
    console.log(`\n  TEMPLATE (free):`)
    console.log(`    ${template}`)
    console.log(`\n  LLM WEAVE (1 call):`)
    console.log(`    ${woven.prompt}`)
    console.log(`    ↳ resolved: ${woven.cohesion_note}`)
  }
  await writeFile(join(OUT, 'versus.json'), JSON.stringify(out, null, 2))
  console.log(`\n→ ${join(OUT, 'versus.json')}`)
}

// -----------------------------------------------------------------------------
// smart — the production-shaped path: template by default, LLM weave ONLY when
// the conflict detector flags a real cross-category clash.
// -----------------------------------------------------------------------------
async function stageSmart(n: number) {
  const garden = JSON.parse(await readFile(join(OUT, 'garden.json'), 'utf8')) as Record<
    string,
    Fragment[]
  >
  const out: any[] = []
  let llmCalls = 0
  for (let i = 0; i < n; i++) {
    const chosen = rollFragments(garden, i)
    const triggers = [...new Set(chosen.map((f) => f.trigger))]
    const conflicts = detectConflicts(chosen)
    let prompt: string
    let path: string
    if (conflicts.length) {
      const woven = await weave(chosen)
      llmCalls++
      prompt = woven.prompt
      path = 'LLM weave'
    } else {
      prompt = composeTemplate(chosen)
      path = 'template (free)'
    }
    out.push({ roll: i + 1, triggers, path, conflicts, prompt, fragments: chosen })
    console.log(`\n══ Roll ${i + 1}  (${triggers.join(' + ')}) ${'═'.repeat(24)}`)
    console.log(`  path: ${path}${conflicts.length ? '  ← ' + conflicts.join(' ; ') : ''}`)
    console.log(`  ${prompt}`)
  }
  await writeFile(join(OUT, 'smart.json'), JSON.stringify(out, null, 2))
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`${n} rolls · ${llmCalls} LLM calls (${n - llmCalls} free) · ${Math.round((llmCalls / n) * 100)}% paid`)
  console.log(`→ ${join(OUT, 'smart.json')}`)
}

// -----------------------------------------------------------------------------
async function main() {
  const stage = process.argv[2]
  const arg = Number(process.argv[3]) || 3
  if (stage === 'fetch') await stageFetch()
  else if (stage === 'garden') await stageGarden()
  else if (stage === 'combine') await stageCombine(arg)
  else if (stage === 'versus') await stageVersus(arg)
  else if (stage === 'smart') await stageSmart(arg)
  else {
    console.log('usage: muse-weaver.ts <fetch|garden|combine [N]|versus [N]|smart [N]>')
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
