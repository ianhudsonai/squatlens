import { describe, expect, it } from 'vitest';
import { makeSquatTrack, repSchedule } from '../../test/synthetic/makeSquatTrack';
import {
  angleDeg,
  angleToVerticalDeg,
  dist,
  mid,
  signedAngleToVerticalDeg,
  toPx,
  usable,
} from './geometry';
import { L_ANKLE, L_HIP, L_KNEE, L_SHOULDER } from './landmarks';
import type { PoseTrack } from './types';

describe('geometry helpers', () => {
  it('toPx scales each axis by its own dimension', () => {
    expect(toPx({ x: 0.5, y: 0.25 }, 1080, 1920)).toEqual({ x: 540, y: 480 });
  });

  it('usable gates on visibility and, when defined, presence', () => {
    const lm = { x: 0.5, y: 0.5, z: 0, visibility: 0.5 };
    expect(usable(lm)).toBe(true);
    expect(usable({ ...lm, visibility: 0.49 })).toBe(false);
    expect(usable({ ...lm, presence: 0.49 })).toBe(false);
    expect(usable({ ...lm, presence: 0.5 })).toBe(true);
    expect(usable({ ...lm, x: Number.NaN })).toBe(false);
    expect(usable(null)).toBe(false);
    expect(usable(undefined)).toBe(false);
    expect(usable({ ...lm, visibility: 0.3 }, { minVisibility: 0.2, minPresence: 0.5 })).toBe(true);
  });

  it('dist and mid', () => {
    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(mid({ x: 0, y: 2 }, { x: 4, y: 6 })).toEqual({ x: 2, y: 4 });
  });

  it('angleDeg measures the interior angle at the middle point', () => {
    expect(angleDeg({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(90, 10);
    expect(angleDeg({ x: 0, y: -1 }, { x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(180, 10);
    expect(angleDeg({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(0, 10);
    expect(angleDeg({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeCloseTo(45, 10);
    // order of the outer points does not matter
    expect(angleDeg({ x: 1, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(45, 10);
  });

  it('angleDeg is null for zero-length segments (never invents data)', () => {
    expect(angleDeg({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeNull();
    expect(angleDeg({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBeNull();
  });

  it('angleToVerticalDeg is measured from image-up (y down)', () => {
    const o = { x: 0, y: 0 };
    expect(angleToVerticalDeg(o, { x: 0, y: -10 })).toBeCloseTo(0, 10);
    expect(angleToVerticalDeg(o, { x: 10, y: -10 })).toBeCloseTo(45, 10);
    expect(angleToVerticalDeg(o, { x: -10, y: 0 })).toBeCloseTo(90, 10);
    expect(angleToVerticalDeg(o, { x: 0, y: 10 })).toBeCloseTo(180, 10);
    expect(signedAngleToVerticalDeg(o, { x: 10, y: -10 })).toBeCloseTo(45, 10);
    expect(signedAngleToVerticalDeg(o, { x: -10, y: -10 })).toBeCloseTo(-45, 10);
    expect(angleToVerticalDeg(o, o)).toBeNull();
  });
});

describe('aspect-ratio regression (SPEC §0 rule 5)', () => {
  const portrait = makeSquatTrack({ view: 'lateral', width: 1080, height: 1920 });
  const landscape = makeSquatTrack({ view: 'lateral', width: 1920, height: 1080 });
  const bottom = Math.round((repSchedule()[0]!.bottomStartT / 1000) * 30);

  const anglesPx = (tr: PoseTrack, i: number) => {
    const p = (k: number) => toPx(tr.frames[i]!.lm![k]!, tr.width, tr.height);
    return {
      knee: angleDeg(p(L_HIP), p(L_KNEE), p(L_ANKLE))!,
      trunk: angleToVerticalDeg(p(L_HIP), p(L_SHOULDER))!,
      shin: angleToVerticalDeg(p(L_ANKLE), p(L_KNEE))!,
    };
  };

  it('gives the same angles for the same pose in 9:16 and 16:9', () => {
    for (const i of [0, bottom]) {
      const a = anglesPx(portrait, i);
      const b = anglesPx(landscape, i);
      expect(a.knee).toBeCloseTo(b.knee, 6);
      expect(a.trunk).toBeCloseTo(b.trunk, 6);
      expect(a.shin).toBeCloseTo(b.shin, 6);
    }
    expect(anglesPx(portrait, bottom).knee).toBeLessThan(120); // the bottom really is deep
  });

  it('would differ if computed on normalized coordinates (the bug this guards)', () => {
    const norm = (tr: PoseTrack) => {
      const p = (k: number) => tr.frames[bottom]!.lm![k]!;
      return angleDeg(p(L_HIP), p(L_KNEE), p(L_ANKLE))!;
    };
    expect(Math.abs(norm(portrait) - norm(landscape))).toBeGreaterThan(10);
  });
});
