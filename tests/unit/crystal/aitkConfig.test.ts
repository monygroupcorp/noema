// The modus owns the training config: buildAitkConfig turns {dataset, trigger, baseModel,
// steps} into the ai-toolkit ui_trainer yaml from a per-base-model preset. Deterministic.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAitkConfig, resolveBasePreset } from '../../../src/crystal/aitkConfig.js'

test('buildAitkConfig: user knobs + klein-4b preset → a complete ui_trainer config', () => {
  const yaml = buildAitkConfig({ name: 'koh', datasetPath: '/mnt/data/datasets/koh', triggerWord: 'koh', baseModel: 'flux2-klein-4b', steps: 500 })

  assert.match(yaml, /type: 'ui_trainer'/)                  // the SQLite-writing trainer the cursor polls
  assert.match(yaml, /name: "koh"/)
  assert.match(yaml, /trigger_word: "koh"/)
  assert.match(yaml, /folder_path: "\/mnt\/data\/datasets\/koh"/)
  assert.match(yaml, /steps: 500/)
  assert.match(yaml, /save_every: 250/)                     // default min(steps, 250)
  assert.match(yaml, /sample_every: 501/)                   // default > steps → sampling off
  assert.match(yaml, /name_or_path: "black-forest-labs\/FLUX\.2-klein-base-4B"/)
  assert.match(yaml, /arch: "flux2_klein_4b"/)
  assert.match(yaml, /sqlite_db_path: "\/aitk\/aitk_db\.db"/)
  assert.match(yaml, /training_folder: "\/aitk\/output"/)
  assert.match(yaml, /linear: 32/)                          // preset default rank
})

test('buildAitkConfig: aliases resolve, and overrides win over preset defaults', () => {
  assert.equal(resolveBasePreset('klein-4b').arch, 'flux2_klein_4b')      // alias → canonical
  const yaml = buildAitkConfig({ name: 'r', datasetPath: '/d', triggerWord: 't', baseModel: 'klein', steps: 1200, saveEvery: 400, rank: 16 })
  assert.match(yaml, /steps: 1200/)
  assert.match(yaml, /save_every: 400/)
  assert.match(yaml, /linear: 16/)
  assert.match(yaml, /linear_alpha: 16/)
})

test('buildAitkConfig: an unknown base model is a hard error (no silent default)', () => {
  assert.throws(() => buildAitkConfig({ name: 'r', datasetPath: '/d', triggerWord: 't', baseModel: 'sdxl-not-seeded', steps: 100 }), /unknown baseModel/)
})

test('buildAitkConfig is deterministic — identical inputs, identical yaml', () => {
  const a = buildAitkConfig({ name: 'koh', datasetPath: '/d', triggerWord: 'koh', baseModel: 'flux2-klein-4b', steps: 500 })
  const b = buildAitkConfig({ name: 'koh', datasetPath: '/d', triggerWord: 'koh', baseModel: 'flux2-klein-4b', steps: 500 })
  assert.equal(a, b)
})
