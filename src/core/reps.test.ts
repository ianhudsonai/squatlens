import { describe, expect, it } from 'vitest';
import { makeSquatTrack, repSchedule } from '../../test/synthetic/makeSquatTrack';
import type { SquatOptions } from '../../test/synthetic/makeSquatTrack';
import { calibrate } from './calibration';
import { DEFAULTS, depthNormSeries, segmentReps } from './reps';
import { preprocess } from './smoothing';
import type { PxTrack } from './smoothing';
import type { Calibration } from './types';

const run = (opts: Partial<SquatOptions>) => {
  const px = preprocess(makeSquatTrack(opts));
  const cal = calibrate(px);
  return { px, cal, reps: segmentReps(px, cal) };
};

/**
 * Every detected rep matches one true rep, in order, with the bottom inside the hold.
 * Boundaries sit within 2% of the standing level, so the slow cosine-eased tails of the
 * synthetic movement (plus One-Euro lag) put start/end up to ~0.35 s inside the true rep.
 */
const expectMatches = (opts: Partial<SquatOptions>, tolMs = 400) => {
  const { reps } = run(opts);
  const truth = repSchedule(opts);
  expect(reps).toHaveLength(truth.length);
  reps.forEach((r, k) => {
    const t = truth[k]!;
    expect(r.index).toBe(k);
    expect(r.startFrame).toBeLessThan(r.bottomFrame);
    expect(r.bottomFrame).toBeLessThan(r.endFrame);
    expect(Math.abs(r.startT - t.startT)).toBeLessThan(tolMs);
    expect(Math.abs(r.endT - t.endT)).toBeLessThan(tolMs);
    expect(r.bottomT).toBeGreaterThanOrEqual(t.bottomStartT - tolMs);
    expect(r.bottomT).toBeLessThanOrEqual(t.bottomEndT + tolMs);
    if (k > 0) expect(r.startFrame).toBeGreaterThanOrEqual(reps[k - 1]!.endFrame);
  });
  return reps;
};

describe('segmentReps', () => {
  for (const n of [1, 3, 5]) {
    it(`counts ${n} rep(s) (lateral, noisy)`, () => {
      expectMatches({ reps: n, noise: 1.5 });
    });
  }

  it('counts reps in frontal and diagonal views', () => {
    expectMatches({ view: 'frontal', reps: 3, noise: 1 });
    expectMatches({ view: 'diagonal', reps: 3, noise: 1 });
  });

  it('does not count a partial rep', () => {
    // Third rep only reaches ~25% of the deepest hip drop.
    const opts = { reps: 3, repDepthScale: [1, 1, 0.25], noise: 1 };
    const { reps } = run(opts);
    expect(reps).toHaveLength(2);
    expect(reps[1]!.endT).toBeLessThan(repSchedule(opts)[2]!.startT + 100);
  });

  it('reports depthNorm relative to the deepest rep', () => {
    const { reps } = run({ reps: 3, repDepthScale: [0.8, 1, 0.8] });
    expect(reps).toHaveLength(3);
    expect(reps[1]!.depthNorm).toBeCloseTo(1, 6);
    expect(reps[0]!.depthNorm).toBeLessThan(0.97);
    expect(reps[0]!.depthNorm).toBeGreaterThan(0.6);
  });

  it('handles pauses at the bottom', () => {
    expectMatches({ reps: 3, pauseS: 1.5, noise: 1.5 });
  });

  for (const fps of [24, 30, 60]) {
    it(`is frame-rate independent (${fps} fps)`, () => {
      const reps = expectMatches({ reps: 3, fps, noise: 1 });
      // times, not frame counts
      for (const r of reps) expect(r.endT - r.startT).toBeGreaterThan(1500);
    });
  }

  it('survives dropout gaps', () => {
    const fps = 30;
    const truth = repSchedule({ reps: 3 });
    // 10 frames (~0.33 s) with no pose in the middle of each descent and ascent.
    const gap = (tMs: number) =>
      Array.from({ length: 10 }, (_, k) => Math.round((tMs / 1000) * fps) + k);
    const dropFrames = truth.flatMap((r) => [...gap(r.startT + 300), ...gap(r.bottomEndT + 300)]);
    expectMatches({ reps: 3, dropFrames, dropout: 0.03, noise: 1 }, 450);
  });

  it('returns nothing without calibration or motion', () => {
    const { px, cal } = run({ reps: 0 });
    expect(segmentReps(px, null)).toEqual([]);
    expect(segmentReps(px, cal)).toEqual([]);
  });

  it('does not count a rep cut off by the end of the clip', () => {
    const { px, cal } = run({ reps: 2 });
    const truth = repSchedule({ reps: 2 });
    const cut: PxTrack = { ...px, frames: px.frames.filter((f) => f.t < truth[1]!.bottomEndT) };
    expect(segmentReps(cut, cal)).toHaveLength(1);
  });
});

/**
 * State-machine tests on a hand-made depth signal: a PxTrack whose hip midpoint follows `d`
 * exactly (standing y = 1000 px, deepest = 1400 px, so depthNorm = d once max(d) = 1).
 */
const fromDepth = (d: Array<number | null>, fps = 30): { px: PxTrack; cal: Calibration } => {
  const pts = (y: number) => {
    const p = Array.from({ length: 33 }, () => null as PxTrack['frames'][0]['pts'][0]);
    p[23] = { x: 500, y, visibility: 1, interpolated: false };
    p[24] = { x: 520, y, visibility: 1, interpolated: false };
    return p;
  };
  const px: PxTrack = {
    width: 1080,
    height: 1920,
    sampleHz: fps,
    frames: d.map((v, i) => {
      const p = v === null ? Array.from({ length: 33 }, () => null) : pts(1000 + 400 * v);
      return { t: (i * 1000) / fps, pts: p, usable: p.map((q) => q !== null), world: null };
    }),
  };
  return {
    px,
    cal: { standingFrames: [0], femurPx: { left: 200, right: 200 }, standingHipY: 1000 },
  };
};

const ramp = (from: number, to: number, n: number) =>
  Array.from({ length: n }, (_, k) => from + ((to - from) * (k + 1)) / n);

describe('segmentReps state machine', () => {
  it('ignores jitter around the enter and exit thresholds', () => {
    const { enter, exit } = DEFAULTS;
    // Standing, then chatter across `enter` (never 4 frames above), one real rep whose
    // ascent chatters across `exit`, then chatter again.
    const chatter = (lvl: number) =>
      Array.from({ length: 12 }, (_, k) => lvl + (k % 2 ? 0.02 : -0.02));
    const d = [
      ...Array<number>(20).fill(0),
      ...chatter(enter),
      ...ramp(0, 1, 20),
      ...ramp(1, exit + 0.01, 20),
      ...chatter(exit),
      ...Array<number>(20).fill(0),
      ...chatter(enter),
      ...Array<number>(20).fill(0),
    ];
    const { px, cal } = fromDepth(d);
    expect(segmentReps(px, cal)).toHaveLength(1);
  });

  it('counts a bounce at the bottom as one rep', () => {
    const d = [
      ...Array<number>(20).fill(0),
      ...ramp(0, 1, 20),
      ...ramp(1, 0.6, 6),
      ...ramp(0.6, 0.95, 6),
      ...ramp(0.95, 0, 20),
      ...Array<number>(20).fill(0),
    ];
    const { px, cal } = fromDepth(d);
    const reps = segmentReps(px, cal);
    expect(reps).toHaveLength(1);
    expect(reps[0]!.bottomFrame).toBe(39);
  });

  it('needs the debounce run to return to standing', () => {
    // Only 3 frames below `exit` before going down again: still one long rep.
    const d = [
      ...Array<number>(20).fill(0),
      ...ramp(0, 1, 20),
      ...ramp(1, 0.05, 20),
      0.05,
      0.05,
      ...ramp(0.05, 1, 20),
      ...ramp(1, 0, 20),
      ...Array<number>(20).fill(0),
    ];
    const { px, cal } = fromDepth(d);
    expect(segmentReps(px, cal)).toHaveLength(1);
  });

  it('does not let null frames complete a debounce run', () => {
    const d: Array<number | null> = [
      ...Array<number>(20).fill(0),
      ...ramp(0, 1, 20),
      ...ramp(1, 0.05, 20),
      null,
      null,
      null,
      ...ramp(0.05, 1, 20),
      ...ramp(1, 0, 20),
      ...Array<number>(20).fill(0),
    ];
    const { px, cal } = fromDepth(d);
    // 1 frame below exit (the last ramp sample), nulls, then down again: one rep.
    expect(segmentReps(px, cal)).toHaveLength(1);
  });

  it('finds reps when the lifter does not fully stand between them', () => {
    const d = [
      ...Array<number>(20).fill(0),
      ...ramp(0, 1, 20),
      ...ramp(1, 0.05, 20),
      ...Array<number>(10).fill(0.05),
      ...ramp(0.05, 1, 20),
      ...ramp(1, 0, 20),
      ...Array<number>(20).fill(0),
    ];
    const { px, cal } = fromDepth(d);
    const reps = segmentReps(px, cal);
    expect(reps).toHaveLength(2);
    expect(reps[0]!.endFrame).toBeLessThanOrEqual(reps[1]!.startFrame);
    expect(reps[0]!.endFrame).toBeGreaterThanOrEqual(58);
  });

  it('keeps an unrack or re-rack seconds away out of the rep boundaries', () => {
    // Hip briefly 0.08 above standing at the start and end (unrack / toes), 3 s from the rep.
    const d = [
      ...Array<number>(5).fill(-0.08),
      ...Array<number>(90).fill(0),
      ...ramp(0, 1, 20),
      ...ramp(1, 0, 20),
      ...Array<number>(90).fill(0),
      ...Array<number>(5).fill(-0.08),
    ];
    const { px, cal } = fromDepth(d);
    const reps = segmentReps(px, cal);
    expect(reps).toHaveLength(1);
    expect(reps[0]!.startFrame).toBe(94);
    expect(reps[0]!.endFrame).toBe(134);
  });

  it('applies a time floor to the debounce at high frame rates', () => {
    // 120 fps: 6 frames (50 ms) below exit is a frame-count debounce but not a time one.
    const d = [
      ...Array<number>(120).fill(0),
      ...ramp(0, 1, 80),
      ...ramp(1, 0.05, 80),
      ...Array<number>(6).fill(0.05),
      ...ramp(0.05, 1, 80),
      ...ramp(1, 0, 80),
      ...Array<number>(120).fill(0),
    ];
    const { px, cal } = fromDepth(d, 120);
    expect(segmentReps(px, cal)).toHaveLength(1);
  });

  it('exposes the clip-level depthNorm signal', () => {
    const { px, cal } = fromDepth([0, 0.5, 1, null]);
    expect(depthNormSeries(px, cal)).toEqual([0, 0.5, 1, null]);
    expect(depthNormSeries(fromDepth([0, 0]).px, cal)).toBeNull();
  });
});
