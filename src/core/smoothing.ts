/**
 * Pre-processing (SPEC §5.1): pixel conversion, visibility gating, short-gap interpolation
 * and One-Euro smoothing. Every later core stage consumes the `PxTrack` produced here.
 *
 * Pipeline per landmark index, in this order:
 *   1. Pixel conversion and usability gate (`usable` from geometry.ts).
 *   2. Linear interpolation (weighted by `t`) across runs of <= `maxGapFrames` consecutive
 *      unusable frames that have a usable frame on both sides. Leading/trailing runs and
 *      longer gaps stay null (SPEC §0 rule 3: never invent data).
 *   3. One-Euro filter on x and y, using `t` for the time step. The filter state resets after
 *      every null, so a long gap never smears motion across it.
 */
import { DEFAULTS as GEOMETRY_DEFAULTS, usable } from './geometry';
import type { Px, UsableOptions } from './geometry';
import { NUM_LANDMARKS } from './landmarks';
import type { Lm, PoseTrack } from './types';

export interface OneEuroParams {
  /** Minimum cutoff frequency, Hz. Lower = smoother at rest, more lag. */
  minCutoff: number;
  /** Speed coefficient, per (px/s). Higher = less lag during fast motion. */
  beta: number;
  /** Cutoff for the derivative estimate, Hz. */
  dCutoff: number;
}

export interface SmoothingOptions extends UsableOptions {
  /** Longest run of consecutive unusable frames that is filled by interpolation. */
  maxGapFrames: number;
  oneEuro: OneEuroParams;
}

export const DEFAULTS: SmoothingOptions = {
  minVisibility: GEOMETRY_DEFAULTS.minVisibility,
  minPresence: GEOMETRY_DEFAULTS.minPresence,
  maxGapFrames: 3,
  oneEuro: { minCutoff: 1.0, beta: 0.007, dCutoff: 1.0 },
};

/** A pre-processed landmark in pixels. */
export interface PxPoint extends Px {
  /** Raw MediaPipe visibility; for interpolated points, the lower of the two gap ends. */
  visibility: number;
  /** True when the point was filled by gap interpolation rather than observed. */
  interpolated: boolean;
}

export interface PxFrame {
  /** ms, copied from the source frame. */
  t: number;
  /** Always NUM_LANDMARKS entries. null = unusable and not interpolated. */
  pts: Array<PxPoint | null>;
  /** Usable mask: `usable[i] === (pts[i] !== null)`. */
  usable: boolean[];
  /** World landmarks passed through unchanged (metric, not smoothed). */
  world: Lm[] | null;
}

export interface PxTrack {
  width: number;
  height: number;
  sampleHz: number;
  frames: PxFrame[];
}

export type PreprocessOptions = Partial<Omit<SmoothingOptions, 'oneEuro'>> & {
  oneEuro?: Partial<OneEuroParams>;
};

/** `{...a, ...b}` that ignores keys of `b` explicitly set to undefined. */
function merge<T extends object>(a: T, b: object | undefined): T {
  const out = { ...a };
  for (const [k, v] of Object.entries(b ?? {})) {
    if (v !== undefined && k in a) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

function resolve(opts: PreprocessOptions | undefined): SmoothingOptions {
  const { oneEuro, ...rest } = opts ?? {};
  return { ...merge(DEFAULTS, rest), oneEuro: merge(DEFAULTS.oneEuro, oneEuro) };
}

/**
 * Fills runs of at most `maxGap` nulls that are bounded by values on both sides, by linear
 * interpolation in time. Returns a new array; the input is not modified.
 * `filled[i]` is true for every entry that was filled.
 */
export function interpolateGaps(
  values: ReadonlyArray<number | null>,
  t: readonly number[],
  maxGap: number,
): { values: Array<number | null>; filled: boolean[] } {
  const out = values.slice();
  const filled = values.map(() => false);
  let i = 0;
  while (i < out.length) {
    if (out[i] !== null) {
      i++;
      continue;
    }
    let j = i;
    while (j < out.length && out[j] === null) j++;
    // Gap is [i, j). Needs a value on both sides and a length <= maxGap.
    const before = out[i - 1];
    const after = out[j];
    if (i > 0 && j < out.length && j - i <= maxGap && before != null && after != null) {
      const t0 = t[i - 1]!;
      const t1 = t[j]!;
      for (let k = i; k < j; k++) {
        const w = t1 === t0 ? 0.5 : (t[k]! - t0) / (t1 - t0);
        out[k] = before + (after - before) * w;
        filled[k] = true;
      }
    }
    i = j;
  }
  return { values: out, filled };
}

function smoothingFactor(cutoffHz: number, dtS: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtS);
}

/**
 * One-Euro filter (Casiez, Roussel & Vogel, CHI 2012) for one scalar signal sampled at
 * irregular times. `filter(x, tMs)` returns the smoothed value; `reset()` forgets history.
 */
export class OneEuroFilter {
  private readonly p: OneEuroParams;
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev = 0;

  constructor(params: OneEuroParams = DEFAULTS.oneEuro) {
    this.p = params;
  }

  reset(): void {
    this.xPrev = null;
    this.dxPrev = 0;
  }

  filter(x: number, tMs: number): number {
    if (this.xPrev === null) {
      this.xPrev = x;
      this.dxPrev = 0;
      this.tPrev = tMs;
      return x;
    }
    const dt = (tMs - this.tPrev) / 1000;
    if (!(dt > 0)) return this.xPrev; // non-increasing time: hold the last estimate
    const dx = (x - this.xPrev) / dt;
    const dxHat = this.dxPrev + smoothingFactor(this.p.dCutoff, dt) * (dx - this.dxPrev);
    const cutoff = this.p.minCutoff + this.p.beta * Math.abs(dxHat);
    const xHat = this.xPrev + smoothingFactor(cutoff, dt) * (x - this.xPrev);
    this.xPrev = xHat;
    this.dxPrev = dxHat;
    this.tPrev = tMs;
    return xHat;
  }
}

/**
 * Applies a fresh One-Euro filter to a series, restarting after every null.
 * Returns a new array with nulls preserved.
 */
export function oneEuroSeries(
  values: ReadonlyArray<number | null>,
  t: readonly number[],
  params: OneEuroParams = DEFAULTS.oneEuro,
): Array<number | null> {
  const f = new OneEuroFilter(params);
  return values.map((v, i) => {
    if (v === null) {
      f.reset();
      return null;
    }
    return f.filter(v, t[i]!);
  });
}

/** PoseTrack -> PxTrack: pixels, usability mask, gap interpolation, One-Euro smoothing. */
export function preprocess(track: PoseTrack, opts?: PreprocessOptions): PxTrack {
  const o = resolve(opts);
  const { width, height, frames } = track;
  const t = frames.map((f) => f.t);
  const out: PxFrame[] = frames.map((f) => ({
    t: f.t,
    pts: new Array<PxPoint | null>(NUM_LANDMARKS).fill(null),
    usable: new Array<boolean>(NUM_LANDMARKS).fill(false),
    world: f.world,
  }));

  for (let k = 0; k < NUM_LANDMARKS; k++) {
    const raw = frames.map((f) => {
      const lm = f.lm?.[k];
      return usable(lm, o) ? lm : null;
    });
    const xs = interpolateGaps(
      raw.map((lm) => (lm ? lm.x * width : null)),
      t,
      o.maxGapFrames,
    );
    const ys = interpolateGaps(
      raw.map((lm) => (lm ? lm.y * height : null)),
      t,
      o.maxGapFrames,
    );
    const sx = oneEuroSeries(xs.values, t, o.oneEuro);
    const sy = oneEuroSeries(ys.values, t, o.oneEuro);

    for (let i = 0; i < frames.length; i++) {
      const x = sx[i];
      const y = sy[i];
      if (x == null || y == null) continue;
      const interpolated = xs.filled[i]!;
      let visibility: number;
      if (!interpolated) {
        visibility = raw[i]!.visibility;
      } else {
        // Report the weaker end of the gap rather than a blended value.
        let a = i - 1;
        while (xs.filled[a]) a--;
        let b = i + 1;
        while (xs.filled[b]) b++;
        visibility = Math.min(raw[a]!.visibility, raw[b]!.visibility);
      }
      const frame = out[i]!;
      frame.pts[k] = { x, y, visibility, interpolated };
      frame.usable[k] = true;
    }
  }
  return { width, height, sampleHz: track.sampleHz, frames: out };
}

/** Pixel position of landmark `k` in `frame`, or null when not usable. */
export function pt(frame: PxFrame, k: number): PxPoint | null {
  return frame.pts[k] ?? null;
}
