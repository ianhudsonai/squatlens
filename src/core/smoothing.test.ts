import { describe, expect, it } from 'vitest';
import { makeRng, makeSquatTrack } from '../../test/synthetic/makeSquatTrack';
import { L_HIP, L_KNEE, NUM_LANDMARKS } from './landmarks';
import { DEFAULTS, OneEuroFilter, interpolateGaps, oneEuroSeries, preprocess } from './smoothing';
import type { Lm, PoseTrack } from './types';

const t30 = (n: number) => Array.from({ length: n }, (_, i) => (i * 1000) / 30);
const sd = (a: number[]) => {
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length);
};

describe('interpolateGaps', () => {
  it('fills gaps up to maxGap linearly in time', () => {
    const { values, filled } = interpolateGaps([0, null, null, null, 40], t30(5), 3);
    expect(values).toEqual([0, 10, 20, 30, 40]);
    expect(filled).toEqual([false, true, true, true, false]);
  });

  it('weights by t, not by index', () => {
    const { values } = interpolateGaps([0, null, 30], [0, 10, 30], 3);
    expect(values[1]).toBeCloseTo(10, 10);
  });

  it('leaves gaps longer than maxGap null', () => {
    const { values, filled } = interpolateGaps([0, null, null, null, null, 50], t30(6), 3);
    expect(values).toEqual([0, null, null, null, null, 50]);
    expect(filled.every((f) => !f)).toBe(true);
  });

  it('honours a configurable maxGap', () => {
    const v = [0, null, null, null, null, 50];
    const got = interpolateGaps(v, t30(6), 4).values;
    [0, 10, 20, 30, 40, 50].forEach((x, i) => expect(got[i]).toBeCloseTo(x, 9));
    expect(interpolateGaps([0, null, 2], t30(3), 0).values).toEqual([0, null, 2]);
  });

  it('never extrapolates leading or trailing gaps', () => {
    expect(interpolateGaps([null, 1, 2, null], t30(4), 3).values).toEqual([null, 1, 2, null]);
    expect(interpolateGaps([null, null], t30(2), 3).values).toEqual([null, null]);
  });

  it('does not modify the input', () => {
    const v = [0, null, 2];
    interpolateGaps(v, t30(3), 3);
    expect(v).toEqual([0, null, 2]);
  });
});

describe('One-Euro filter', () => {
  it('passes the first sample through and holds on non-increasing time', () => {
    const f = new OneEuroFilter();
    expect(f.filter(5, 0)).toBe(5);
    expect(f.filter(100, 0)).toBe(5);
  });

  it('removes most jitter from a still landmark', () => {
    const rng = makeRng(3);
    const t = t30(300);
    const raw = t.map(() => 500 + 3 * rng.normal());
    const out = oneEuroSeries(raw, t) as number[];
    expect(sd(out.slice(30))).toBeLessThan(sd(raw.slice(30)) * 0.5);
  });

  it('tracks a squat with little lag (filter lag sanity)', () => {
    const tr = makeSquatTrack({ view: 'lateral', reps: 1 });
    const raw = tr.frames.map((f) => f.lm![L_HIP]!.y * tr.height);
    const sm = preprocess(tr).frames.map((f) => f.pts[L_HIP]!.y);
    const range = Math.max(...raw) - raw[0]!;
    const argmax = (a: number[]) => a.indexOf(Math.max(...a));
    expect(Math.abs(argmax(sm) - argmax(raw))).toBeLessThanOrEqual(2); // <= ~67 ms at 30 fps
    expect(Math.max(...sm) - sm[0]!).toBeGreaterThan(0.98 * range); // bottom not flattened
    const maxErr = Math.max(...raw.map((r, i) => Math.abs(r - sm[i]!)));
    expect(maxErr).toBeLessThan(0.08 * range);
  });

  it('restarts after a null so a long gap is not smeared', () => {
    const t = t30(6);
    const out = oneEuroSeries([0, 0, null, 100, 100, 100], t);
    expect(out[2]).toBeNull();
    expect(out[3]).toBe(100);
  });
});

describe('preprocess', () => {
  const visAt = (track: PoseTrack, frames: number[], k: number, v: number): PoseTrack => ({
    ...track,
    frames: track.frames.map((f, i) =>
      frames.includes(i) && f.lm
        ? { ...f, lm: f.lm.map((l, j): Lm => (j === k ? { ...l, visibility: v } : l)) }
        : f,
    ),
  });

  it('converts to pixels and keeps the frame layout', () => {
    const tr = makeSquatTrack({ reps: 1 });
    const px = preprocess(tr);
    expect(px.width).toBe(tr.width);
    expect(px.height).toBe(tr.height);
    expect(px.sampleHz).toBe(tr.sampleHz);
    expect(px.frames).toHaveLength(tr.frames.length);
    const f0 = px.frames[0]!;
    expect(f0.pts).toHaveLength(NUM_LANDMARKS);
    expect(f0.usable).toHaveLength(NUM_LANDMARKS);
    expect(f0.world).toBe(tr.frames[0]!.world);
    // first sample passes through the filter untouched
    expect(f0.pts[L_KNEE]!.x).toBeCloseTo(tr.frames[0]!.lm![L_KNEE]!.x * tr.width, 9);
    expect(f0.pts[L_KNEE]!.y).toBeCloseTo(tr.frames[0]!.lm![L_KNEE]!.y * tr.height, 9);
  });

  it('interpolates short visibility gaps and flags them', () => {
    const tr = visAt(makeSquatTrack({ reps: 1 }), [10, 11, 12], L_KNEE, 0.2);
    const px = preprocess(tr);
    for (const i of [10, 11, 12]) {
      expect(px.frames[i]!.usable[L_KNEE]).toBe(true);
      expect(px.frames[i]!.pts[L_KNEE]!.interpolated).toBe(true);
    }
    expect(px.frames[9]!.pts[L_KNEE]!.interpolated).toBe(false);
  });

  it('leaves long gaps null and keeps the mask in sync', () => {
    const tr = visAt(makeSquatTrack({ reps: 1 }), [10, 11, 12, 13], L_KNEE, 0.2);
    const px = preprocess(tr);
    for (const i of [10, 11, 12, 13]) {
      expect(px.frames[i]!.pts[L_KNEE]).toBeNull();
      expect(px.frames[i]!.usable[L_KNEE]).toBe(false);
    }
    expect(preprocess(tr, { maxGapFrames: 4 }).frames[11]!.usable[L_KNEE]).toBe(true);
  });

  it('treats null-pose frames as unusable for every landmark', () => {
    const px = preprocess(makeSquatTrack({ reps: 1, dropFrames: [20, 21, 22, 23, 24] }));
    expect(px.frames[22]!.usable.every((u) => !u)).toBe(true);
    expect(px.frames[22]!.world).toBeNull();
  });

  it('accepts partial One-Euro overrides', () => {
    const tr = makeSquatTrack({ reps: 1, noise: 3 });
    const a = preprocess(tr, { oneEuro: { minCutoff: 0.2 } });
    const b = preprocess(tr);
    expect(a.frames[50]!.pts[L_HIP]!.y).not.toBe(b.frames[50]!.pts[L_HIP]!.y);
    expect(DEFAULTS.oneEuro).toEqual({ minCutoff: 1.0, beta: 0.007, dCutoff: 1.0 });
  });

  it('respects the presence gate', () => {
    const tr = makeSquatTrack({ reps: 1 });
    const withPresence: PoseTrack = {
      ...tr,
      frames: tr.frames.map((f) => ({
        ...f,
        lm: f.lm!.map((l, j) => (j === L_KNEE ? { ...l, presence: 0.1 } : l)),
      })),
    };
    expect(preprocess(withPresence).frames.every((f) => !f.usable[L_KNEE])).toBe(true);
  });
});
