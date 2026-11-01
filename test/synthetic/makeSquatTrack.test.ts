import { describe, expect, it } from 'vitest';
import { angleDeg, signedAngleToVerticalDeg, toPx } from '../../src/core/geometry';
import {
  L_ANKLE,
  L_HIP,
  L_KNEE,
  L_SHOULDER,
  R_ANKLE,
  R_HIP,
  R_KNEE,
  R_SHOULDER,
} from '../../src/core/landmarks';
import type { Lm, PoseTrack } from '../../src/core/types';
import { makeSquatTrack, progressAt, repSchedule } from './makeSquatTrack';

const px = (track: PoseTrack, i: number, k: number) => {
  const lm = track.frames[i]!.lm![k]!;
  return toPx(lm, track.width, track.height);
};
const frameAt = (track: PoseTrack, tMs: number) =>
  track.frames.reduce(
    (best, f, i) => (Math.abs(f.t - tMs) < Math.abs(track.frames[best]!.t - tMs) ? i : best),
    0,
  );

describe('makeSquatTrack', () => {
  it('is deterministic for a given seed and differs across seeds', () => {
    const a = makeSquatTrack({ noise: 2, dropout: 0.05, seed: 7 });
    const b = makeSquatTrack({ noise: 2, dropout: 0.05, seed: 7 });
    const c = makeSquatTrack({ noise: 2, dropout: 0.05, seed: 8 });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('produces MediaPipe-shaped frames with strictly increasing t', () => {
    const tr = makeSquatTrack({ fps: 30, dropFrames: [5] });
    expect(tr.version).toBe(1);
    expect(tr.sampleHz).toBe(30);
    tr.frames.forEach((f, i) => {
      if (i > 0) expect(f.t).toBeGreaterThan(tr.frames[i - 1]!.t);
      if (i === 5) {
        expect(f.lm).toBeNull();
        expect(f.world).toBeNull();
        return;
      }
      expect(f.lm).toHaveLength(33);
      expect(f.world).toHaveLength(33);
    });
  });

  it('puts the world origin at the hip midpoint with y down', () => {
    const tr = makeSquatTrack();
    const w = tr.frames[0]!.world!;
    expect((w[L_HIP]!.x + w[R_HIP]!.x) / 2).toBeCloseTo(0, 9);
    expect((w[L_HIP]!.y + w[R_HIP]!.y) / 2).toBeCloseTo(0, 9);
    expect(w[L_SHOULDER]!.y).toBeLessThan(0); // shoulders above hips
    expect(w[L_ANKLE]!.y).toBeGreaterThan(0);
  });

  it('frontal: subject faces the camera, their left (odd) appears on image right', () => {
    const tr = makeSquatTrack({ view: 'frontal' });
    expect(px(tr, 0, L_HIP).x).toBeGreaterThan(px(tr, 0, R_HIP).x);
    expect(px(tr, 0, L_SHOULDER).x).toBeGreaterThan(px(tr, 0, R_SHOULDER).x);
    const w = tr.frames[0]!.world!;
    expect(Math.abs(w[L_HIP]!.z - w[R_HIP]!.z)).toBeLessThan(1e-9);
  });

  it('lateral: far side has lower (but usable) visibility and greater depth', () => {
    const tr = makeSquatTrack({ view: 'lateral', side: 'left' });
    const lm: Lm[] = tr.frames[0]!.lm!;
    expect(lm[L_KNEE]!.visibility).toBeGreaterThan(lm[R_KNEE]!.visibility);
    expect(lm[R_KNEE]!.visibility).toBeGreaterThanOrEqual(0.5);
    expect(lm[L_HIP]!.z).toBeLessThan(lm[R_HIP]!.z); // left hip closer to camera
    const right = makeSquatTrack({ view: 'lateral', side: 'right' }).frames[0]!.lm!;
    expect(right[R_KNEE]!.visibility).toBeGreaterThan(right[L_KNEE]!.visibility);
  });

  it('lateral: image thigh angle at the bottom matches the requested depth', () => {
    for (const depth of [-15, 0, 20]) {
      const tr = makeSquatTrack({ view: 'lateral', depth });
      const i = frameAt(tr, repSchedule({ depth })[0]!.bottomStartT);
      const hip = px(tr, i, L_HIP);
      const knee = px(tr, i, L_KNEE);
      const thigh = (Math.atan2(knee.y - hip.y, Math.abs(knee.x - hip.x)) * 180) / Math.PI;
      // depth is a 3D angle; hip and knee sit at slightly different camera depths, so the
      // projected angle differs by a little perspective error.
      expect(Math.abs(thigh - depth)).toBeLessThan(2);
      // depth convention: positive = knee lower than hip (above parallel)
      if (depth !== 0) expect(Math.sign(knee.y - hip.y)).toBe(Math.sign(depth));
    }
  });

  it('standing frames have straight knees and a vertical trunk', () => {
    const tr = makeSquatTrack({ view: 'lateral' });
    const knee = angleDeg(px(tr, 0, L_HIP), px(tr, 0, L_KNEE), px(tr, 0, L_ANKLE))!;
    expect(knee).toBeCloseTo(180, 5);
    expect(signedAngleToVerticalDeg(px(tr, 0, L_HIP), px(tr, 0, L_SHOULDER))!).toBeCloseTo(0, 5);
  });

  it('tiltDeg rolls the image clockwise', () => {
    const tr = makeSquatTrack({ view: 'frontal', tiltDeg: 12 });
    const hipMid = {
      x: (px(tr, 0, L_HIP).x + px(tr, 0, R_HIP).x) / 2,
      y: (px(tr, 0, L_HIP).y + px(tr, 0, R_HIP).y) / 2,
    };
    const shMid = {
      x: (px(tr, 0, L_SHOULDER).x + px(tr, 0, R_SHOULDER).x) / 2,
      y: (px(tr, 0, L_SHOULDER).y + px(tr, 0, R_SHOULDER).y) / 2,
    };
    expect(signedAngleToVerticalDeg(hipMid, shMid)!).toBeCloseTo(12, 5);
  });

  it('valgusDeg moves the knees medially at the bottom (frontal)', () => {
    const base = makeSquatTrack({ view: 'frontal' });
    const cave = makeSquatTrack({ view: 'frontal', valgusDeg: 12 });
    const i = frameAt(base, repSchedule()[0]!.bottomStartT);
    const kneeGap = (tr: PoseTrack, j: number) => px(tr, j, L_KNEE).x - px(tr, j, R_KNEE).x;
    expect(kneeGap(cave, 0)).toBeCloseTo(kneeGap(base, 0), 6); // standing: no cave
    expect(kneeGap(cave, i)).toBeLessThan(kneeGap(base, i) * 0.85);
  });

  it('hipShift moves the pelvis toward the subject left at the bottom', () => {
    const tr = makeSquatTrack({ view: 'frontal', hipShift: 0.2 });
    const i = frameAt(tr, repSchedule()[0]!.bottomStartT);
    const hipMidX = (j: number) => (px(tr, j, L_HIP).x + px(tr, j, R_HIP).x) / 2;
    const ankleMidX = (j: number) => (px(tr, j, L_ANKLE).x + px(tr, j, R_ANKLE).x) / 2;
    expect(hipMidX(0) - ankleMidX(0)).toBeCloseTo(0, 6);
    expect(hipMidX(i) - ankleMidX(i)).toBeGreaterThan(10); // subject left = image right
  });

  it('schedules reps with pauses and per-rep depth scaling', () => {
    const o = { reps: 2, pauseS: 0.5, repDepthScale: [1, 0.5] };
    const [r1, r2] = repSchedule(o);
    expect(r1!.bottomEndT - r1!.bottomStartT).toBe(500);
    expect(progressAt(r1!.bottomStartT + 250, o)).toBe(1);
    expect(progressAt(r2!.bottomStartT + 250, o)).toBe(0.5);
    expect(progressAt(0, o)).toBe(0);
  });

  it('flags out-of-frame landmarks with low visibility', () => {
    const tr = makeSquatTrack({ view: 'frontal', fill: 1.3 });
    expect(tr.frames[0]!.lm!.some((l) => l.visibility < 0.5)).toBe(true);
  });
});

describe('camera placement', () => {
  for (const cameraHeightM of [0.3, 0.9, 1.6]) {
    it(`keeps the standing body in frame at camera height ${cameraHeightM} m`, () => {
      const tr = makeSquatTrack({ view: 'frontal', cameraHeightM });
      expect(tr.frames[0]!.lm!.every((l) => l.visibility > 0.5)).toBe(true);
    });
  }

  it('ends with a frame at the clip end despite float rounding', () => {
    const tr = makeSquatTrack({ reps: 3, fps: 30 });
    const last = tr.frames[tr.frames.length - 1]!.t;
    const end = repSchedule()[2]!.endT + 1000;
    expect(end - last).toBeLessThan(1000 / 30);
  });
});
