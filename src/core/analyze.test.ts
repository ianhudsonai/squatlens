import { describe, expect, it } from 'vitest';
import { makeSquatTrack } from '../../test/synthetic/makeSquatTrack';
import type { SquatOptions } from '../../test/synthetic/makeSquatTrack';
import { analyzeSet } from './analyze';
import { renderCue } from './cues';
import type { PoseTrack, SetReport } from './types';

const run = (o: Partial<SquatOptions>, opts?: Parameters<typeof analyzeSet>[1]) =>
  analyzeSet(makeSquatTrack({ noise: 1, ...o }), opts);
const ids = (r: SetReport) => r.cues.map((c) => c.id);

/** Rounds every number so the snapshot ignores last-bit float noise. */
const rounded = (r: SetReport): unknown =>
  JSON.parse(JSON.stringify(r, (_k, v: unknown) => (typeof v === 'number' ? +v.toFixed(4) : v)));

describe('analyzeSet', () => {
  it('lateral set: depth, trunk and tempo per rep, frontal metrics wrong_view', () => {
    const r = run({ view: 'lateral', reps: 3 });
    expect(r.version).toBe(1);
    expect(r.quality.ok).toBe(true);
    expect(r.view.view).toBe('lateral');
    expect(r.view.side).toBe('left');
    expect(r.reps).toHaveLength(3);
    for (const rep of r.reps) {
      expect(rep.depth.value?.cls).toBe('below');
      expect(rep.trunk.value).not.toBeNull();
      expect(rep.tempo.value).not.toBeNull();
      expect(rep.valgus).toEqual({ value: null, confidence: null, reason: 'wrong_view' });
      expect(rep.asymmetry).toEqual({ value: null, confidence: null, reason: 'wrong_view' });
    }
    expect(ids(r)).toEqual(['depth.below', 'depth.below', 'depth.below', 'tempo.summary']);
    expect(r.cues.map((c) => c.repIndex)).toEqual([0, 1, 2, null]);
  });

  it('shallow lateral set with a forward trunk gives depth.above and trunk.forward', () => {
    const r = run({ view: 'lateral', depth: 15, trunkLeanDeg: 60, shinLeanDeg: 25 });
    expect(r.reps.length).toBeGreaterThan(0);
    for (const rep of r.reps) expect(rep.depth.value?.cls).toBe('above');
    const perRep = r.cues.filter((c) => c.repIndex === 0).map((c) => c.id);
    expect(perRep).toEqual(['depth.above', 'trunk.forward']);
    expect(r.cues.find((c) => c.id === 'depth.above')?.severity).toBe('warn');
  });

  it('frontal set: valgus and asymmetry per rep, lateral metrics wrong_view', () => {
    const r = run({ view: 'frontal', valgusDeg: 15, hipShift: 0.15 });
    expect(r.quality.ok).toBe(true);
    expect(r.view.view).toBe('frontal');
    expect(r.reps).toHaveLength(3);
    for (const rep of r.reps) {
      expect(rep.depth.reason).toBe('wrong_view');
      expect(rep.trunk.reason).toBe('wrong_view');
      expect(rep.tempo.value).not.toBeNull();
      expect(rep.valgus.value?.flagged).toBe(true);
      expect(rep.asymmetry.value?.flagged).toBe(true);
    }
    const rep0 = r.cues.filter((c) => c.repIndex === 0);
    expect(rep0.map((c) => c.id)).toEqual(['valgus.flag', 'asym.shift']);
    expect(rep0[0]!.params.conf).toBe(r.reps[0]!.valgus.confidence);
    expect(rep0[1]!.params.side).toBe('left');
  });

  it('clean frontal set gives no form cues', () => {
    const r = run({ view: 'frontal' });
    expect(ids(r)).toEqual(['tempo.summary']);
  });

  it('diagonal set: only tempo, plus the refilm cue', () => {
    const r = run({ view: 'diagonal' });
    expect(r.view.view).toBe('diagonal');
    expect(r.reps.length).toBeGreaterThan(0);
    for (const rep of r.reps) {
      for (const m of ['depth', 'trunk', 'valgus', 'asymmetry'] as const) {
        expect(rep[m].reason).toBe('wrong_view');
      }
      expect(rep.tempo.value).not.toBeNull();
    }
    expect(ids(r)).toEqual(['view.diagonal', 'tempo.summary']);
  });

  it('bad quality: reps still computed, cues are only the quality problems', () => {
    const r = run({ view: 'lateral', dropout: 0.6 });
    expect(r.quality.ok).toBe(false);
    expect(r.quality.problems.length).toBeGreaterThan(0);
    expect(ids(r)).toEqual(r.quality.problems.map((p) => `quality.${p}`));
    expect(r.cues.every((c) => c.severity === 'warn' && c.repIndex === null)).toBe(true);
  });

  it('a clip with no pose: no calibration, no reps, quality.no_pose', () => {
    const track: PoseTrack = {
      version: 1,
      width: 1080,
      height: 1920,
      sampleHz: 30,
      frames: Array.from({ length: 90 }, (_, i) => ({ t: (i * 1000) / 30, lm: null, world: null })),
    };
    const r = analyzeSet(track);
    expect(r.calibration).toBeNull();
    expect(r.reps).toEqual([]);
    expect(r.quality.ok).toBe(false);
    expect(r.velocityLoss.reason).toBe('no_reps');
    expect(ids(r)).toContain('quality.no_pose');
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it('passes per-stage options through, including the thresholds the cues reuse', () => {
    const r = run({ view: 'lateral' }, { trunk: { forwardLeanHintDeg: 5 } });
    expect(ids(r)).toContain('trunk.forward');
    const r2 = run({ view: 'lateral' }, { cues: { fastDescentS: 5 } });
    expect(ids(r2)).toContain('tempo.fast_descent');
    const r3 = run({ view: 'lateral' }, { reps: { minBottom: 2 } });
    expect(r3.reps).toEqual([]);
    expect(ids(r3)).toEqual(['nodata.reps']);
  });

  it('is deterministic and JSON-serializable', () => {
    const track = makeSquatTrack({ view: 'frontal', noise: 2, valgusDeg: 12 });
    const a = analyzeSet(track);
    const b = analyzeSet(track);
    expect(b).toEqual(a);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });

  it('every generated cue renders without leftover placeholders', () => {
    const reports = [
      run({ view: 'lateral', depth: 15, trunkLeanDeg: 60, shinLeanDeg: 25 }),
      run({ view: 'frontal', valgusDeg: 15, hipShift: -0.15 }),
      run({ view: 'diagonal', descentS: 0.4 }),
      run({ view: 'lateral', dropout: 0.6 }),
    ];
    for (const r of reports) {
      for (const c of r.cues) {
        for (const lang of ['pt-BR', 'en'] as const) {
          const text = renderCue(c, lang);
          expect(text).not.toBe(c.id);
          expect(text).not.toMatch(/[{}]/);
        }
      }
    }
  });

  it('matches the SetReport snapshot', () => {
    const r = run({ view: 'lateral', reps: 2, fps: 20, leadS: 1, tailS: 0.5 });
    expect(rounded(r)).toMatchSnapshot();
  });
});
