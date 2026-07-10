import { describe, expect, it } from 'vitest';
import { phaseToStage, measure, STAGE_LABELS } from './runStream';

// No jsdom/@testing-library/react in this app's toolchain (see BuyCreditsModal.test.ts) —
// so this exercises the pure Phasis→stepline mapping rather than a full DOM render of
// the hook (which owns the EventSource/poll wiring — see the backend runEvents/RunEventHub
// hermetic tests for the bridge itself).

describe('phaseToStage — every Phasis maps into exactly one of the 5 shown stages', () => {
  it('maps queued to stage 0', () => {
    expect(phaseToStage('queued')).toBe(0);
  });

  it('maps provisioning/pulling/attesting/downloading/installing/loading/warming to stage 1', () => {
    for (const p of ['provisioning', 'pulling', 'attesting', 'downloading', 'installing', 'loading', 'warming'] as const) {
      expect(phaseToStage(p)).toBe(1);
    }
  });

  it('maps executing to stage 2', () => {
    expect(phaseToStage('executing')).toBe(2);
  });

  it('maps uploading to stage 3', () => {
    expect(phaseToStage('uploading')).toBe(3);
  });

  it('maps finalizing/cancelling to stage 4', () => {
    expect(phaseToStage('finalizing')).toBe(4);
    expect(phaseToStage('cancelling')).toBe(4);
  });

  it('maps done/failed to stage 5 (terminal)', () => {
    expect(phaseToStage('done')).toBe(5);
    expect(phaseToStage('failed')).toBe(5);
  });

  it('every mapped stage index is within STAGE_LABELS bounds (or the terminal 5)', () => {
    const phases = [
      'queued', 'provisioning', 'pulling', 'attesting', 'downloading', 'installing',
      'loading', 'warming', 'executing', 'uploading', 'finalizing', 'cancelling', 'done', 'failed',
    ] as const;
    for (const p of phases) {
      const stage = phaseToStage(p);
      expect(stage === 5 || (stage >= 0 && stage < STAGE_LABELS.length)).toBe(true);
    }
  });
});

describe('measure — the active-stage sub-line', () => {
  it('shows a placeholder when there is no progressus yet', () => {
    expect(measure(undefined)).toBe('…');
  });

  it('prefers the runner human message', () => {
    expect(measure({ phase: 'executing', message: 'restarting ComfyUI' })).toBe('restarting ComfyUI');
  });

  it('falls back to a done/total progress reading', () => {
    expect(measure({ phase: 'downloading', progress: { done: 2, total: 3, unit: 'models' } })).toBe('2 / 3 models');
  });

  it('shows just the count when there is no total', () => {
    expect(measure({ phase: 'downloading', progress: { done: 2, unit: 'models' } })).toBe('2 models');
  });

  it('falls back to phase · target when neither message nor progress is present', () => {
    expect(measure({ phase: 'pulling', target: 'model' })).toBe('pulling · model');
  });

  it('falls back to the bare phase name as a last resort', () => {
    expect(measure({ phase: 'queued' })).toBe('queued');
  });
});
