import { describe, expect, it } from 'vitest';
import { makeSquatTrack, repSchedule } from '../../../test/synthetic/makeSquatTrack';
import type { SquatOptions } from '../../../test/synthetic/makeSquatTrack';
import { calibrate } from '../calibration';
import { segmentReps } from '../reps';
import { preprocess } from '../smoothing';
import type { PoseTrack, TempoResult } from '../types';
import type { Metric } from '../types';
import { tempo, velocityLoss } from './tempo';

const analyze = (track: PoseTrack) => {
  const px = preprocess(track);
  const cal = calibrate(px);
  const reps = segmentReps(px, cal);
  return { reps, tempos: reps.map((r) => tempo(px, r, cal)) };
};
const run = (opts: Partial<SquatOptions>) => analyze(makeSquatTrack(opts));

/**
 * Descent/ascent are measured to within 3% of the bottom / standing level, which trims the
 * slow, cosine-eased tails of the synthetic movement, so they read somewhat short.
 */
const expectTempo = (
  v: TempoResult | null,
  o: { descentS: number; ascentS: number; pauseS: number },
) => {
  expect(v).not.toBeNull();
  expect(v!.descentS).toBeGreaterThan(o.descentS * 0.6);
  expect(v!.descentS).toBeLessThan(o.descentS * 1.1);
  expect(v!.ascentS).toBeGreaterThan(o.ascentS * 0.6);
  expect(v!.ascentS).toBeLessThan(o.ascentS * 1.1);
  expect(Math.abs(v!.pauseS - o.pauseS)).toBeLessThan(0.25);
  expect(v!.ascentHipVel).toBeGreaterThan(0);
};

describe('tempo', () => {
  it('measures descent, pause and ascent from timestamps', () => {
    const o = { descentS: 2, ascentS: 1, pauseS: 0 };
    const { tempos } = run({ reps: 3, ...o, noise: 1 });
    expect(tempos).toHaveLength(3);
    for (const m of tempos) {
      expectTempo(m.value, o);
      expect(m.value!.descentS).toBeGreaterThan(m.value!.ascentS);
      expect(m.confidence).toBe('high');
    }
  });

  it('measures a pause at the bottom', () => {
    const o = { descentS: 1.2, ascentS: 1, pauseS: 1.5 };
    const { tempos } = run({ reps: 2, ...o, noise: 1 });
    expect(tempos).toHaveLength(2);
    for (const m of tempos) expectTempo(m.value, o);
  });

  for (const fps of [24, 30, 60]) {
    it(`gives the same tempo at ${fps} fps`, () => {
      const o = { descentS: 1.5, ascentS: 1, pauseS: 0.8 };
      const { tempos } = run({ reps: 2, ...o, fps, noise: 1 });
      const ref = run({ reps: 2, ...o, fps: 30, noise: 1 }).tempos;
      expect(tempos).toHaveLength(2);
      tempos.forEach((m, k) => {
        expectTempo(m.value, o);
        const vRef = ref[k]!.value!.ascentHipVel;
        expect(Math.abs(m.value!.ascentHipVel - vRef) / vRef).toBeLessThan(0.1);
      });
    });
  }

  it('reports hip speed in femur lengths per second', () => {
    // Faster ascent, same depth -> proportionally higher mean speed.
    const slow = run({ reps: 1, ascentS: 2 }).tempos[0]!.value!;
    const fast = run({ reps: 1, ascentS: 1 }).tempos[0]!.value!;
    expect(fast.ascentHipVel / slow.ascentHipVel).toBeGreaterThan(1.7);
    expect(fast.ascentHipVel / slow.ascentHipVel).toBeLessThan(2.3);
    // Hip drop at -10 deg depth is about one femur length: ~1 femur / ~0.8 s.
    expect(fast.ascentHipVel).toBeGreaterThan(0.6);
    expect(fast.ascentHipVel).toBeLessThan(2);
  });

  it('lowers confidence with dropout gaps but still times the rep', () => {
    // 10-frame no-pose gaps mid-descent: longer than interpolation fills.
    const dropFrames = repSchedule({ reps: 2 }).flatMap((r) =>
      Array.from({ length: 10 }, (_, k) => Math.round(((r.startT + 400) / 1000) * 30) + k),
    );
    const { tempos } = run({ reps: 2, dropFrames, noise: 1 });
    expect(tempos.length).toBeGreaterThan(0);
    for (const m of tempos) {
      expect(m.value).not.toBeNull();
      expect(m.confidence).toBe('medium');
    }
  });

  it('splits the rep into descent + pause + ascent', () => {
    const { reps, tempos } = run({ reps: 2, pauseS: 0.5, noise: 1 });
    tempos.forEach((m, k) => {
      const v = m.value!;
      const dur = (reps[k]!.endT - reps[k]!.startT) / 1000;
      expect(v.descentS + v.pauseS + v.ascentS).toBeCloseTo(dur, 9);
    });
  });

  it('uses the nearest usable samples when a boundary frame has no hip', () => {
    const px = preprocess(makeSquatTrack({ reps: 1 }));
    const cal = calibrate(px)!;
    const rep = segmentReps(px, cal)[0]!;
    const ref = tempo(px, rep, cal).value!;
    const frames = px.frames.map((f, i) =>
      i === rep.bottomFrame || i === rep.startFrame
        ? { ...f, pts: f.pts.map(() => null), usable: f.usable.map(() => false) }
        : f,
    );
    const m = tempo({ ...px, frames }, rep, cal);
    expect(m.value).not.toBeNull();
    expect(Math.abs(m.value!.ascentHipVel - ref.ascentHipVel) / ref.ascentHipVel).toBeLessThan(0.1);
  });

  it('is null without calibration', () => {
    const px = preprocess(makeSquatTrack({ reps: 1 }));
    const cal = calibrate(px)!;
    const rep = segmentReps(px, cal)[0]!;
    expect(tempo(px, rep, null)).toEqual({
      value: null,
      confidence: null,
      reason: 'low_visibility',
    });
    const noFemur = { ...cal, femurPx: { left: null, right: null } };
    expect(tempo(px, rep, noFemur).reason).toBe('low_visibility');
  });
});

/** Concatenates single-rep clips (t shifted) into one set, so each rep can have its own tempo. */
const concatSet = (perRep: Array<Partial<SquatOptions>>): PoseTrack => {
  const parts = perRep.map((o, k) =>
    makeSquatTrack({
      reps: 1,
      leadS: k === 0 ? 1.5 : 0.4,
      tailS: 0.4,
      noise: 1,
      seed: k + 1,
      ...o,
    }),
  );
  const frames: PoseTrack['frames'] = [];
  let offset = 0;
  for (const p of parts) {
    for (const f of p.frames) frames.push({ ...f, t: f.t + offset });
    offset = frames[frames.length - 1]!.t + 1000 / p.sampleHz;
  }
  return { ...parts[0]!, frames };
};

describe('velocityLoss', () => {
  it('measures the slowdown on a synthetic slowing set', () => {
    const ascents = [1.0, 1.1, 1.25, 1.45, 1.7];
    const { reps, tempos } = analyze(concatSet(ascents.map((ascentS) => ({ ascentS }))));
    expect(reps).toHaveLength(5);
    const loss = velocityLoss(tempos);
    // Same depth, so speed ~ 1/ascent time: 1 - 1.0/1.7 ~ 0.41.
    expect(loss.value).not.toBeNull();
    expect(loss.value!).toBeGreaterThan(0.3);
    expect(loss.value!).toBeLessThan(0.5);
    expect(loss.confidence).toBe('high');
  });

  it('is about zero for a steady set', () => {
    const loss = velocityLoss(run({ reps: 4, noise: 1 }).tempos);
    expect(Math.abs(loss.value!)).toBeLessThan(0.08);
  });

  it('needs at least two timed reps', () => {
    const t = (v: number, c: 'low' | 'medium' | 'high' = 'high'): Metric<TempoResult> => ({
      value: { descentS: 1, pauseS: 0, ascentS: 1, ascentHipVel: v },
      confidence: c,
    });
    const nil: Metric<TempoResult> = { value: null, confidence: null, reason: 'low_visibility' };
    expect(velocityLoss([])).toEqual({ value: null, confidence: null, reason: 'no_reps' });
    expect(velocityLoss([t(1)]).reason).toBe('insufficient_frames');
    // Strictly first vs last rep: a missing end rep gives its reason, not a shorter span.
    expect(velocityLoss([t(1), nil])).toEqual(nil);
    expect(velocityLoss([nil, t(1), t(0.8)])).toEqual(nil);
    expect(velocityLoss([t(1), nil, t(0.75, 'medium')])).toEqual({
      value: 0.25,
      confidence: 'medium',
    });
    // A last rep with no net rise is not a measured speed, so no 100%+ "loss".
    expect(velocityLoss([t(1), t(0)]).value).toBeNull();
    expect(velocityLoss([t(1), t(-0.3)]).value).toBeNull();
  });
});
