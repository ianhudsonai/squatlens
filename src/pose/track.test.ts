import { describe, expect, it } from 'vitest';
import type { PoseFrame } from '../core/types';
import { buildTrack, nearestFrameIndex, sampleTimes, toPoseFrame, toTimestampsMs } from './track';

describe('sampleTimes', () => {
  it('steps by 1/sampleHz strictly below the duration', () => {
    expect(sampleTimes(0.1, 30)).toEqual([0, 1 / 30, 2 / 30]);
    expect(sampleTimes(1, 10)).toHaveLength(10);
  });

  it('caps the rate at the native fps when known', () => {
    expect(sampleTimes(1, 60, 24)).toHaveLength(24);
    expect(sampleTimes(1, 15, 30)).toHaveLength(15);
  });

  it('returns nothing for empty or unknown durations', () => {
    expect(sampleTimes(0, 30)).toEqual([]);
    expect(sampleTimes(Number.NaN, 30)).toEqual([]);
    expect(sampleTimes(Number.POSITIVE_INFINITY, 30)).toEqual([]);
  });

  it('rejects a non-positive sample rate', () => {
    expect(() => sampleTimes(1, 0)).toThrow(RangeError);
  });
});

describe('toTimestampsMs', () => {
  it('rounds to integer ms', () => {
    expect(toTimestampsMs([0, 1 / 30, 2 / 30])).toEqual([0, 33, 67]);
  });

  it('is strictly increasing even when rounding collides', () => {
    const ms = toTimestampsMs([0, 0.0001, 0.0002, 0.001]);
    expect(ms).toEqual([0, 1, 2, 3]);
    const long = toTimestampsMs(sampleTimes(10, 240));
    for (let i = 1; i < long.length; i++) expect(long[i]!).toBeGreaterThan(long[i - 1]!);
    for (const t of long) expect(Number.isInteger(t)).toBe(true);
  });
});

describe('toPoseFrame', () => {
  const raw = { x: 0.5, y: 0.25, z: -0.1, visibility: 0.9, presence: 0.8 };

  it('keeps the first pose and its world landmarks', () => {
    const f = toPoseFrame(33, { landmarks: [[raw, raw]], worldLandmarks: [[raw]] });
    expect(f.t).toBe(33);
    expect(f.lm).toEqual([raw, raw]);
    expect(f.world).toHaveLength(1);
  });

  it('is null when no pose was found', () => {
    expect(toPoseFrame(0, { landmarks: [], worldLandmarks: [] })).toEqual({
      t: 0,
      lm: null,
      world: null,
    });
    expect(toPoseFrame(0, null)).toEqual({ t: 0, lm: null, world: null });
  });

  it('never invents visibility: missing visibility becomes 0 (unusable)', () => {
    const f = toPoseFrame(0, { landmarks: [[{ x: 0, y: 0, z: 0 }]], worldLandmarks: [] });
    expect(f.lm?.[0]).toEqual({ x: 0, y: 0, z: 0, visibility: 0 });
    expect(f.world).toBeNull();
  });
});

describe('buildTrack', () => {
  it('produces a version 1 PoseTrack', () => {
    const t = buildTrack({
      width: 1080,
      height: 1920,
      sampleHz: 30,
      frames: [],
      meta: { model: 'full' },
    });
    expect(t).toEqual({
      version: 1,
      width: 1080,
      height: 1920,
      sampleHz: 30,
      frames: [],
      meta: { model: 'full' },
    });
    expect('meta' in buildTrack({ width: 1, height: 1, sampleHz: 1, frames: [] })).toBe(false);
  });
});

describe('nearestFrameIndex', () => {
  const frames: PoseFrame[] = [0, 33, 67, 100].map((t) => ({ t, lm: null, world: null }));

  it('finds the closest frame', () => {
    expect(nearestFrameIndex(frames, -5)).toBe(0);
    expect(nearestFrameIndex(frames, 16)).toBe(0);
    expect(nearestFrameIndex(frames, 17)).toBe(1);
    expect(nearestFrameIndex(frames, 66)).toBe(2);
    expect(nearestFrameIndex(frames, 1000)).toBe(3);
  });

  it('returns -1 for an empty track', () => {
    expect(nearestFrameIndex([], 10)).toBe(-1);
  });
});
