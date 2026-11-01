import { describe, expect, it } from 'vitest';
import { BODY, makeSquatTrack, repSchedule } from '../../test/synthetic/makeSquatTrack';
import type { SquatOptions } from '../../test/synthetic/makeSquatTrack';
import { calibrate, hipMid, kneeFlexDeg } from './calibration';
import { dist } from './geometry';
import { L_HIP, L_KNEE, R_HIP, R_KNEE } from './landmarks';
import { preprocess } from './smoothing';

const setup = (opts: Partial<SquatOptions>) => {
  const track = makeSquatTrack(opts);
  const px = preprocess(track);
  return { track, px, cal: calibrate(px) };
};

describe('calibrate', () => {
  for (const view of ['lateral', 'frontal', 'diagonal'] as const) {
    it(`finds standing frames before the first rep (${view})`, () => {
      const { px, cal } = setup({ view, noise: 1.5 });
      expect(cal).not.toBeNull();
      const firstRep = repSchedule()[0]!.startT;
      expect(cal!.standingFrames.length).toBeGreaterThan(15); // >= 0.5 s at 30 fps
      for (const i of cal!.standingFrames) {
        expect(px.frames[i]!.t).toBeLessThanOrEqual(3000);
        // never a frame from deep inside a rep
        const inRep = repSchedule().some(
          (r) => px.frames[i]!.t > r.startT + 300 && px.frames[i]!.t < r.endT - 300,
        );
        expect(inRep).toBe(false);
      }
      expect(px.frames[cal!.standingFrames[0]!]!.t).toBeLessThan(firstRep);
    });
  }

  it('measures standing femur length per side (lateral, clean)', () => {
    const { track, cal } = setup({ view: 'lateral' });
    const f0 = track.frames[0]!.lm!;
    const len = (h: number, k: number) =>
      dist(
        { x: f0[h]!.x * track.width, y: f0[h]!.y * track.height },
        { x: f0[k]!.x * track.width, y: f0[k]!.y * track.height },
      );
    expect(cal!.femurPx.left).toBeCloseTo(len(L_HIP, L_KNEE), 3);
    expect(cal!.femurPx.right).toBeCloseTo(len(R_HIP, R_KNEE), 3);
    // near leg (left faces camera) looks longer than the far one
    expect(cal!.femurPx.left!).toBeGreaterThan(cal!.femurPx.right!);
    // and roughly matches thigh length * focal / distance
    const f = (0.75 * track.height * 3.5) / BODY.height;
    expect(cal!.femurPx.left! / ((f * BODY.thigh) / 3.5)).toBeGreaterThan(0.95);
    expect(cal!.femurPx.left! / ((f * BODY.thigh) / 3.5)).toBeLessThan(1.1);
  });

  it('is robust to noise: femur within 2% of the clean value', () => {
    const clean = setup({ view: 'lateral' }).cal!;
    const noisy = setup({ view: 'lateral', noise: 3, seed: 11 }).cal!;
    expect(Math.abs(noisy.femurPx.left! / clean.femurPx.left! - 1)).toBeLessThan(0.02);
  });

  it('reports the standing hip height', () => {
    const { px, cal } = setup({ view: 'lateral' });
    expect(cal!.standingHipY).toBeCloseTo(hipMid(px.frames[0]!)!.y, 0);
  });

  it('standing knees are near straight in the synthetic track', () => {
    const { px } = setup({ view: 'lateral' });
    expect(kneeFlexDeg(px.frames[0]!, 'left')!).toBeLessThan(1);
  });

  it('falls back to the top hip band when the clip starts mid-squat', () => {
    const { px, cal } = setup({ view: 'lateral', leadS: 0, restS: 0.2 });
    expect(cal).not.toBeNull();
    expect(cal!.standingFrames.length).toBeGreaterThan(0);
    const hipYs = px.frames.map((f) => hipMid(f)!.y);
    const top = Math.min(...hipYs);
    const range = Math.max(...hipYs) - top;
    for (const i of cal!.standingFrames) expect(hipYs[i]! - top).toBeLessThanOrEqual(0.05 * range);
  });

  it('returns null femur for a side whose hip or knee is never usable', () => {
    const track = makeSquatTrack({ view: 'lateral' });
    track.frames.forEach((f) => {
      if (f.lm) f.lm[R_KNEE] = { ...f.lm[R_KNEE]!, visibility: 0.1 };
    });
    const cal = calibrate(preprocess(track))!;
    expect(cal.femurPx.right).toBeNull();
    expect(cal.femurPx.left).not.toBeNull();
  });

  it('returns null when no frame has a hip midpoint', () => {
    const track = makeSquatTrack({ reps: 1 });
    track.frames.forEach((f) => (f.lm = null));
    expect(calibrate(preprocess(track))).toBeNull();
  });
});

describe('calibrate robustness', () => {
  it('keeps most frames of a nearly motionless clip', () => {
    const px = preprocess(makeSquatTrack({ reps: 0, leadS: 3, tailS: 2, noise: 2 }));
    const cal = calibrate(px)!;
    // only the first 3 s are searched: expect most of those 91 frames
    expect(cal.standingFrames.length).toBeGreaterThan(60);
  });

  it('ignores a single glitch frame high above the real standing hip', () => {
    const track = makeSquatTrack({ view: 'lateral' });
    const g = track.frames[60]!.lm!;
    for (const k of [L_HIP, R_HIP]) g[k] = { ...g[k]!, y: g[k]!.y - 0.1 };
    const cal = calibrate(preprocess(track))!;
    expect(cal.standingFrames.length).toBeGreaterThan(15);
    const clean = calibrate(preprocess(makeSquatTrack({ view: 'lateral' })))!;
    expect(Math.abs(cal.standingHipY - clean.standingHipY)).toBeLessThan(2);
  });

  it('treats options explicitly set to undefined as defaults', () => {
    const px = preprocess(makeSquatTrack({ view: 'lateral' }), { maxGapFrames: undefined });
    expect(calibrate(px, { windowS: undefined })).toEqual(calibrate(px));
  });
});
