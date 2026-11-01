import { describe, expect, it } from 'vitest';
import { makeSquatTrack, repSchedule } from '../../../test/synthetic/makeSquatTrack';
import type { SquatOptions } from '../../../test/synthetic/makeSquatTrack';
import { truthReps } from '../../../test/synthetic/truthReps';
import { calibrate } from '../calibration';
import { L_SHOULDER, R_HIP, R_SHOULDER } from '../landmarks';
import { preprocess } from '../smoothing';
import type { PreprocessOptions } from '../smoothing';
import { isCameraTilted, standingTiltDeg } from './lateral';
import { trunk } from './trunk';

function setup(opts: Partial<SquatOptions> = {}, pre?: PreprocessOptions) {
  const px = preprocess(makeSquatTrack(opts), pre);
  return { px, cal: calibrate(px)!, reps: truthReps(opts), side: opts.side ?? ('left' as const) };
}

describe('trunk (lateral)', () => {
  it('measures trunk and shin inclination at the bottom', () => {
    const { px, cal, reps, side } = setup({ trunkLeanDeg: 40, shinLeanDeg: 30 });
    for (const rep of reps) {
      const m = trunk(px, rep, cal, side);
      expect(m.confidence).toBe('high');
      expect(m.value!.trunkDeg).toBeGreaterThan(37);
      expect(m.value!.trunkDeg).toBeLessThan(43);
      expect(m.value!.shinDeg).toBeGreaterThan(27);
      expect(m.value!.shinDeg).toBeLessThan(33);
      expect(m.value!.trunkMinusShinDeg).toBeCloseTo(m.value!.trunkDeg - m.value!.shinDeg, 10);
    }
  });

  it('shows a large trunk-minus-shin difference for a forward-leaning squat', () => {
    const { px, cal, reps, side } = setup({ trunkLeanDeg: 60, shinLeanDeg: 20 });
    expect(trunk(px, reps[0]!, cal, side).value!.trunkMinusShinDeg).toBeGreaterThan(25);
  });

  it('works for a right-side camera', () => {
    const { px, cal, reps } = setup({ side: 'right', trunkLeanDeg: 45, shinLeanDeg: 25 });
    const m = trunk(px, reps[0]!, cal, 'right').value!;
    expect(m.trunkDeg).toBeGreaterThan(42);
    expect(m.trunkDeg).toBeLessThan(48);
    expect(m.shinDeg).toBeGreaterThan(22);
    expect(m.shinDeg).toBeLessThan(28);
  });

  it('falls back to camera-side hip/shoulder when a far-side joint is missing', () => {
    const { px, cal, reps, side } = setup();
    const f = px.frames[reps[0]!.bottomFrame]!;
    const withMid = trunk(px, reps[0]!, cal, side).value!.trunkDeg;
    f.pts[R_SHOULDER] = null;
    f.pts[R_HIP] = null;
    const m = trunk(px, reps[0]!, cal, side);
    expect(m.value).not.toBeNull();
    expect(Math.abs(m.value!.trunkDeg - withMid)).toBeLessThan(3);
  });

  it('gives the same result at 9:16 and 16:9', () => {
    const p = setup({ width: 1080, height: 1920 });
    const l = setup({ width: 1920, height: 1080 });
    for (let i = 0; i < p.reps.length; i++) {
      const a = trunk(p.px, p.reps[i]!, p.cal, 'left').value!;
      const b = trunk(l.px, l.reps[i]!, l.cal, 'left').value!;
      expect(Math.abs(a.trunkDeg - b.trunkDeg)).toBeLessThan(0.5);
      expect(Math.abs(a.shinDeg - b.shinDeg)).toBeLessThan(0.5);
    }
    const pre = { oneEuro: { beta: 0 } };
    const a = trunk(setup({ width: 1080, height: 1920 }, pre).px, p.reps[0]!, p.cal, 'left');
    const b = trunk(setup({ width: 1920, height: 1080 }, pre).px, l.reps[0]!, l.cal, 'left');
    expect(b.value!.trunkDeg).toBeCloseTo(a.value!.trunkDeg, 4);
    expect(b.value!.shinDeg).toBeCloseTo(a.value!.shinDeg, 4);
  });

  it('is null with low_visibility (never 0) when no pose is seen around the bottom', () => {
    const b = Math.round((repSchedule()[0]!.bottomStartT * 30) / 1000);
    const { px, cal, reps, side } = setup({ dropFrames: [b - 2, b - 1, b, b + 1, b + 2] });
    expect(trunk(px, reps[0]!, cal, side)).toEqual({
      value: null,
      confidence: null,
      reason: 'low_visibility',
    });
  });

  it('is null when the camera-side shoulder is unusable at the bottom', () => {
    const { px, cal, reps, side } = setup();
    px.frames[reps[0]!.bottomFrame]!.pts[L_SHOULDER] = null;
    expect(trunk(px, reps[0]!, cal, side).reason).toBe('low_visibility');
  });

  it('caps confidence at medium when the camera is tilted', () => {
    for (const tiltDeg of [15, -15]) {
      const { px, cal, reps, side } = setup({ tiltDeg });
      expect(isCameraTilted(px, cal)).toBe(true);
      expect(Math.sign(standingTiltDeg(px, cal)!)).toBe(Math.sign(tiltDeg));
      expect(Math.abs(standingTiltDeg(px, cal)!)).toBeCloseTo(15, 0);
      const m = trunk(px, reps[0]!, cal, side);
      expect(m.value).not.toBeNull();
      expect(m.confidence).toBe('medium');
    }
    const level = setup({ tiltDeg: 5 });
    expect(isCameraTilted(level.px, level.cal)).toBe(false);
    expect(trunk(level.px, level.reps[0]!, level.cal, 'left').confidence).toBe('high');
  });
});
