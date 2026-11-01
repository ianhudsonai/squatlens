import { describe, expect, it } from 'vitest';
import { makeSquatTrack, repSchedule } from '../../../test/synthetic/makeSquatTrack';
import type { SquatOptions } from '../../../test/synthetic/makeSquatTrack';
import { calibrate } from '../calibration';
import { L_ANKLE, L_HIP, R_ANKLE } from '../landmarks';
import { preprocess } from '../smoothing';
import type { PoseTrack, Rep } from '../types';
import { asymmetry, DEFAULTS } from './asymmetry';

/** Ground-truth Rep for rep `r` of a synthetic track (no dependency on reps.ts). */
function truthRep(opts: Partial<SquatOptions>, r = 0): Rep {
  const fps = opts.fps ?? 30;
  const s = repSchedule(opts)[r]!;
  const fr = (t: number) => Math.round((t * fps) / 1000);
  const bottomT = (s.bottomStartT + s.bottomEndT) / 2;
  return {
    index: r,
    startFrame: fr(s.startT),
    bottomFrame: fr(bottomT),
    endFrame: fr(s.endT),
    startT: s.startT,
    bottomT,
    endT: s.endT,
    depthNorm: 1,
  };
}

function run(opts: Partial<SquatOptions>, edit?: (t: PoseTrack) => void) {
  const o: Partial<SquatOptions> = { view: 'frontal', ...opts };
  const track = makeSquatTrack(o);
  edit?.(track);
  const px = preprocess(track);
  const cal = calibrate(px)!;
  return { px, cal, res: asymmetry(px, truthRep(o), cal) };
}

describe('asymmetry', () => {
  it('does not flag a symmetric squat', () => {
    const { res } = run({ noise: 1.5 });
    expect(res.value!.flagged).toBe(false);
    expect(Math.abs(res.value!.hipShiftNorm)).toBeLessThan(0.03);
    expect(Math.abs(res.value!.hipHeightDiffNorm)).toBeLessThan(0.03);
    expect(res.confidence).toBe('high');
  });

  it('flags a hip shift to the left (positive) and to the right (negative)', () => {
    const left = run({ hipShift: 0.2, noise: 1 }).res.value!;
    expect(left.hipShiftNorm).toBeGreaterThan(DEFAULTS.hipShiftFlag);
    expect(left.flagged).toBe(true);
    const right = run({ hipShift: -0.2, noise: 1 }).res.value!;
    expect(right.hipShiftNorm).toBeLessThan(-DEFAULTS.hipShiftFlag);
    expect(right.flagged).toBe(true);
  });

  it('keeps the subject-relative sign when filmed from behind', () => {
    const v = run({ hipShift: 0.2, yawDeg: 180 }).res.value!;
    expect(v.hipShiftNorm).toBeGreaterThan(DEFAULTS.hipShiftFlag);
  });

  it('does not flag a small hip shift', () => {
    const v = run({ hipShift: 0.05, noise: 1 }).res.value!;
    expect(Math.abs(v.hipShiftNorm)).toBeLessThan(DEFAULTS.hipShiftFlag);
    expect(v.flagged).toBe(false);
  });

  it('flags a hip height difference (left hip lower = positive)', () => {
    const { res, cal } = run({}, (t) => {
      for (const f of t.frames) if (f.lm) f.lm[L_HIP]!.y += 40 / t.height;
    });
    const femur = (cal.femurPx.left! + cal.femurPx.right!) / 2;
    expect(res.value!.hipHeightDiffNorm).toBeCloseTo(40 / femur, 1);
    expect(res.value!.hipHeightDiffNorm).toBeGreaterThan(DEFAULTS.hipHeightFlag);
    expect(res.value!.flagged).toBe(true);
  });

  it('reports knee flexion difference only when the thighs are not foreshortened', () => {
    // Deep squat from the front: the thighs point at the camera at the bottom.
    expect(run({ depth: -10 }).res.value!.kneeFlexDiffDeg).toBeNull();
    // Shallow squat: thighs still visible, legs symmetric.
    const shallow = run({ depth: 45 }).res.value!;
    expect(shallow.kneeFlexDiffDeg).not.toBeNull();
    expect(Math.abs(shallow.kneeFlexDiffDeg!)).toBeLessThan(DEFAULTS.kneeFlexFlagDeg);
  });

  it('returns null (low_visibility) when the ankles are not visible at the bottom', () => {
    const rep = truthRep({ view: 'frontal' });
    const { res } = run({}, (t) => {
      t.frames.forEach((f, i) => {
        if (!f.lm || Math.abs(i - rep.bottomFrame) > 10) return;
        f.lm[L_ANKLE]!.visibility = 0.1;
        f.lm[R_ANKLE]!.visibility = 0.1;
      });
    });
    expect(res).toEqual({ value: null, confidence: null, reason: 'low_visibility' });
  });

  it('gives the same answer in 9:16 and 16:9 (aspect-ratio regression)', () => {
    const a = run({ hipShift: 0.2, width: 1080, height: 1920 }).res.value!;
    const b = run({ hipShift: 0.2, width: 1920, height: 1080 }).res.value!;
    expect(b.flagged).toBe(a.flagged);
    expect(Math.abs(b.hipShiftNorm - a.hipShiftNorm)).toBeLessThan(0.01);
    expect(Math.abs(b.hipHeightDiffNorm - a.hipHeightDiffNorm)).toBeLessThan(0.01);
  });
});
