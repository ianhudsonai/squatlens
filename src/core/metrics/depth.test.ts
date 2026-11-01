import { describe, expect, it } from 'vitest';
import { makeSquatTrack, repSchedule } from '../../../test/synthetic/makeSquatTrack';
import type { SquatOptions } from '../../../test/synthetic/makeSquatTrack';
import { truthReps } from '../../../test/synthetic/truthReps';
import { calibrate } from '../calibration';
import { L_ANKLE, L_HIP, L_KNEE } from '../landmarks';
import { preprocess } from '../smoothing';
import type { PreprocessOptions } from '../smoothing';
import { classifyDepth, depth } from './depth';

function setup(opts: Partial<SquatOptions> = {}, pre?: PreprocessOptions) {
  const px = preprocess(makeSquatTrack(opts), pre);
  return { px, cal: calibrate(px)!, reps: truthReps(opts), side: opts.side ?? ('left' as const) };
}

describe('classifyDepth', () => {
  it.each([
    [0.2, 'below'],
    [0.071, 'below'],
    [0.07, 'borderline'],
    [0.03, 'borderline'],
    [-0.03, 'borderline'],
    [-0.07, 'borderline'],
    [0.069, 'borderline'],
    [0.05, 'borderline'],
    [0.031, 'borderline'],
    [0.029, 'parallel'],
    [0, 'parallel'],
    [-0.029, 'parallel'],
    [-0.031, 'borderline'],
    [-0.069, 'borderline'],
    [-0.071, 'above'],
    [-0.4, 'above'],
  ] as const)('delta %f -> %s', (delta, cls) => {
    expect(classifyDepth(delta)).toBe(cls);
  });
});

describe('depth (lateral)', () => {
  it('deep squat is below parallel, with high confidence', () => {
    const { px, cal, reps, side } = setup({ depth: -12 });
    for (const rep of reps) {
      const m = depth(px, rep, cal, side);
      expect(m.confidence).toBe('high');
      expect(m.value!.cls).toBe('below');
      expect(m.value!.delta).toBeGreaterThan(0.1);
      expect(m.value!.thighAngleDeg).toBeLessThan(-5);
      expect(m.value!.kneeFlexDeg).toBeGreaterThan(120);
    }
  });

  it('parallel squat is parallel', () => {
    const { px, cal, reps, side } = setup({ depth: 0 });
    const m = depth(px, reps[0]!, cal, side);
    expect(m.value!.cls).toBe('parallel');
    expect(Math.abs(m.value!.delta)).toBeLessThan(0.03);
    expect(Math.abs(m.value!.thighAngleDeg)).toBeLessThan(2);
  });

  it('shallow squat is above parallel', () => {
    const { px, cal, reps, side } = setup({ depth: 20 });
    const m = depth(px, reps[0]!, cal, side);
    expect(m.value!.cls).toBe('above');
    expect(m.value!.delta).toBeLessThan(-0.2);
    expect(m.value!.thighAngleDeg).toBeGreaterThan(15);
  });

  it('squat right at the below/parallel boundary is borderline', () => {
    const { px, cal, reps, side } = setup({ depth: -4 });
    const m = depth(px, reps[0]!, cal, side);
    expect(m.value!.cls).toBe('borderline');
    expect(m.value!.delta).toBeGreaterThan(0.03);
    expect(m.value!.delta).toBeLessThan(0.07);
  });

  it('works for a right-side camera and per-rep depth', () => {
    const { px, cal, reps, side } = setup({ side: 'right', repDepthScale: [1, 1, 0.5] });
    expect(depth(px, reps[0]!, cal, side).value!.cls).toBe('below');
    expect(depth(px, reps[2]!, cal, side).value!.cls).toBe('above');
  });

  it('gives the same result at 9:16 and 16:9', () => {
    const portrait = setup({ width: 1080, height: 1920, noise: 0 });
    const landscape = setup({ width: 1920, height: 1080, noise: 0 });
    for (let i = 0; i < portrait.reps.length; i++) {
      const a = depth(portrait.px, portrait.reps[i]!, portrait.cal, 'left').value!;
      const b = depth(landscape.px, landscape.reps[i]!, landscape.cal, 'left').value!;
      expect(b.cls).toBe(a.cls);
      // One-Euro's beta is in px/s, so smoothing differs slightly with pixel scale.
      expect(b.delta).toBeCloseTo(a.delta, 1);
      expect(Math.abs(b.thighAngleDeg - a.thighAngleDeg)).toBeLessThan(0.5);
      expect(Math.abs(b.kneeFlexDeg - a.kneeFlexDeg)).toBeLessThan(0.5);
    }
  });

  it('is exactly aspect-ratio invariant when smoothing is scale-free', () => {
    const pre = { oneEuro: { beta: 0 } };
    const p = setup({ width: 1080, height: 1920 }, pre);
    const l = setup({ width: 1920, height: 1080 }, pre);
    const a = depth(p.px, p.reps[0]!, p.cal, 'left').value!;
    const b = depth(l.px, l.reps[0]!, l.cal, 'left').value!;
    expect(b.delta).toBeCloseTo(a.delta, 6);
    expect(b.thighAngleDeg).toBeCloseTo(a.thighAngleDeg, 4);
    expect(b.kneeFlexDeg).toBeCloseTo(a.kneeFlexDeg, 4);
  });

  it('is null with low_visibility (never 0) when no pose is seen around the bottom', () => {
    const fps = 30;
    const b = Math.round((repSchedule()[0]!.bottomStartT * fps) / 1000);
    const { px, cal, reps, side } = setup({ dropFrames: [b - 2, b - 1, b, b + 1, b + 2] });
    const m = depth(px, reps[0]!, cal, side);
    expect(m).toEqual({ value: null, confidence: null, reason: 'low_visibility' });
    // other reps are unaffected
    expect(depth(px, reps[1]!, cal, side).value).not.toBeNull();
  });

  for (const k of [L_HIP, L_KNEE, L_ANKLE]) {
    it(`is null when landmark ${k} is unusable at the bottom`, () => {
      const { px, cal, reps, side } = setup();
      px.frames[reps[0]!.bottomFrame]!.pts[k] = null;
      expect(depth(px, reps[0]!, cal, side).value).toBeNull();
      expect(depth(px, reps[0]!, cal, side).reason).toBe('low_visibility');
    });
  }

  it('is null when most of the bottom window is unusable', () => {
    const { px, cal, reps, side } = setup();
    const b = reps[0]!.bottomFrame;
    for (const i of [b - 2, b - 1, b + 1]) px.frames[i]!.pts[L_KNEE] = null;
    expect(depth(px, reps[0]!, cal, side).reason).toBe('low_visibility');
  });

  it('lowers confidence when part of the window is missing or interpolated', () => {
    const { px, cal, reps, side } = setup();
    px.frames[reps[0]!.bottomFrame + 2]!.pts[L_KNEE] = null;
    const m = depth(px, reps[0]!, cal, side);
    expect(m.value).not.toBeNull();
    expect(m.confidence).not.toBe('high');
  });

  it('is null when the camera-side femur was not calibrated', () => {
    const { px, cal, reps, side } = setup();
    const m = depth(px, reps[0]!, { ...cal, femurPx: { ...cal.femurPx, left: null } }, side);
    expect(m.reason).toBe('low_visibility');
    expect(m.value).toBeNull();
  });

  it('is null with insufficient_frames when the bottom frame is outside the clip', () => {
    const { px, cal, reps, side } = setup();
    const rep = { ...reps[0]!, bottomFrame: px.frames.length + 5 };
    expect(depth(px, rep, cal, side).reason).toBe('insufficient_frames');
  });

  it('caps confidence at medium when the camera is tilted', () => {
    for (const tiltDeg of [15, -15]) {
      const { px, cal, reps, side } = setup({ tiltDeg });
      const m = depth(px, reps[0]!, cal, side);
      expect(m.value).not.toBeNull();
      expect(m.confidence).toBe('medium');
    }
    const slight = setup({ tiltDeg: 5 });
    expect(depth(slight.px, slight.reps[0]!, slight.cal, 'left').confidence).toBe('high');
  });

  it('is deterministic with noise and keeps the class', () => {
    const { px, cal, reps, side } = setup({ depth: -12, noise: 2, seed: 7 });
    for (const rep of reps) expect(depth(px, rep, cal, side).value!.cls).toBe('below');
  });
});
