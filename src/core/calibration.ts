/**
 * Calibration (SPEC §5.2): find standing frames and measure per-side standing femur length.
 *
 * Standing frames are searched in the first `windowS` seconds: runs of consecutive frames,
 * lasting at least `minStillS`, where
 *   - hip-mid vertical speed is below `maxHipSpeedTorsoPerS` torso lengths per second
 *     (scale-free, so it works at any resolution or subject size),
 *   - hip-mid y is within `topBandFrac` of the clip's top hip position (as a fraction of the
 *     clip's hip-y range, floored at `minBandTorso` torso lengths so a clip with little
 *     vertical motion still has a usable band), so a pause at the bottom of a rep is never
 *     taken as standing. The top position is a low percentile (`topPercentile`) of hip y,
 *     so a single glitch frame cannot become the reference,
 *   - mean 2D knee flexion over usable legs is below `maxKneeFlexDeg`. In frontal views 2D
 *     knee flexion stays small even when squatting, which is why the hip band exists.
 * Fallback when no such run exists: every frame whose hip y is within `fallbackBandFrac` of
 * the top hip position (same floor), over the whole clip.
 *
 * `femurPx[side]` is the median 2D hip-knee length over standing frames. Every distance
 * normalization in later stages divides by this, never by a per-frame length.
 */
import { angleDeg, dist, mid } from './geometry';
import type { Px } from './geometry';
import { L_HIP, L_SHOULDER, R_HIP, R_SHOULDER, SIDE_JOINTS } from './landmarks';
import type { PxFrame, PxTrack } from './smoothing';
import type { Calibration, Side } from './types';

export const DEFAULTS = {
  /** Search standing runs only in the first windowS seconds of the clip. */
  windowS: 3,
  /** A standing run must last at least this long. */
  minStillS: 0.5,
  /** Max |hip-mid vertical speed|, in torso lengths (shoulder-mid to hip-mid) per second. */
  maxHipSpeedTorsoPerS: 0.15,
  /** Max mean 2D knee flexion (180 - angle(hip, knee, ankle)), degrees. */
  maxKneeFlexDeg: 20,
  /** Standing hip y must be within this fraction of the hip-y range from the top. */
  topBandFrac: 0.15,
  /** Fallback band: within 5% of the top hip position (SPEC §5.2). */
  fallbackBandFrac: 0.05,
  /** Floor for both bands, in torso lengths. */
  minBandTorso: 0.05,
  /** Percentile of hip y (0-100, lower = higher in the image) used as the top position. */
  topPercentile: 5,
};

export type CalibrationOptions = typeof DEFAULTS;

const SIDES: readonly Side[] = ['left', 'right'];

/** Hip midpoint in pixels, or null unless both hips are usable. */
export function hipMid(frame: PxFrame): Px | null {
  const l = frame.pts[L_HIP];
  const r = frame.pts[R_HIP];
  return l && r ? mid(l, r) : null;
}

/** Shoulder midpoint in pixels, or null unless both shoulders are usable. */
export function shoulderMid(frame: PxFrame): Px | null {
  const l = frame.pts[L_SHOULDER];
  const r = frame.pts[R_SHOULDER];
  return l && r ? mid(l, r) : null;
}

/** 2D knee flexion for one leg (0 = straight), or null when hip/knee/ankle are not usable. */
export function kneeFlexDeg(frame: PxFrame, side: Side): number | null {
  const j = SIDE_JOINTS[side];
  const hip = frame.pts[j.hip];
  const knee = frame.pts[j.knee];
  const ankle = frame.pts[j.ankle];
  if (!hip || !knee || !ankle) return null;
  const a = angleDeg(hip, knee, ankle);
  return a === null ? null : 180 - a;
}

/** Linear-interpolated percentile (0-100) of a non-empty array. */
function percentile(xs: number[], p: number): number {
  const s = xs.slice().sort((a, b) => a - b);
  const pos = (Math.min(100, Math.max(0, p)) / 100) * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, s.length - 1);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

/** Spread that ignores keys explicitly set to undefined. */
function withDefaults<T extends object>(defaults: T, opts: Partial<T>): T {
  const out = { ...defaults };
  for (const [k, v] of Object.entries(opts)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function femurPx(frames: PxFrame[], idx: number[], side: Side): number | null {
  const j = SIDE_JOINTS[side];
  const lens: number[] = [];
  for (const i of idx) {
    const f = frames[i]!;
    const hip = f.pts[j.hip];
    const knee = f.pts[j.knee];
    if (hip && knee) lens.push(dist(hip, knee));
  }
  return median(lens);
}

/**
 * Returns the clip's calibration, or null when no frame has a usable hip midpoint
 * (nothing to calibrate against).
 */
export function calibrate(
  track: PxTrack,
  opts: Partial<CalibrationOptions> = {},
): Calibration | null {
  const o = withDefaults(DEFAULTS, opts);
  const frames = track.frames;
  const hips = frames.map(hipMid);
  const hipYs = hips.flatMap((h) => (h ? [h.y] : []));
  if (hipYs.length === 0) return null;

  const torsoLens: number[] = [];
  frames.forEach((f, i) => {
    const s = shoulderMid(f);
    const h = hips[i];
    if (s && h) torsoLens.push(dist(s, h));
  });
  const torso = median(torsoLens);

  // y grows downward: the top (standing) hip position is a low percentile of y.
  const topY = percentile(hipYs, o.topPercentile);
  const range = hipYs.reduce((m, y) => Math.max(m, y), -Infinity) - topY;
  const bandFloor = (torso ?? 0) * o.minBandTorso;
  const topBand = Math.max(o.topBandFrac * range, bandFloor);
  const fallbackBand = Math.max(o.fallbackBandFrac * range, bandFloor);

  const t0 = frames[0]!.t;
  const windowEnd = t0 + o.windowS * 1000;
  const dts: number[] = [];
  for (let i = 1; i < frames.length; i++) dts.push(frames[i]!.t - frames[i - 1]!.t);
  const frameDt = median(dts) ?? 0;

  const isCandidate = (i: number): boolean => {
    const f = frames[i]!;
    const h = hips[i];
    if (!h || f.t > windowEnd || torso === null || torso === 0) return false;
    if (h.y - topY > topBand) return false;

    // Central difference over the immediate neighbours; one-sided when one is missing.
    const prev = i > 0 ? hips[i - 1] : null;
    const next = i + 1 < frames.length ? hips[i + 1] : null;
    let speed: number;
    if (prev && next) speed = (next.y - prev.y) / ((frames[i + 1]!.t - frames[i - 1]!.t) / 1000);
    else if (next) speed = (next.y - h.y) / ((frames[i + 1]!.t - f.t) / 1000);
    else if (prev) speed = (h.y - prev.y) / ((f.t - frames[i - 1]!.t) / 1000);
    else return false;
    if (!(Math.abs(speed) / torso < o.maxHipSpeedTorsoPerS)) return false;

    const flex = SIDES.flatMap((s) => {
      const k = kneeFlexDeg(f, s);
      return k === null ? [] : [k];
    });
    if (flex.length === 0) return false;
    return flex.reduce((a, b) => a + b, 0) / flex.length < o.maxKneeFlexDeg;
  };

  let standing: number[] = [];
  let run: number[] = [];
  const flush = () => {
    if (run.length >= 2) {
      const dur = frames[run[run.length - 1]!]!.t - frames[run[0]!]!.t + frameDt;
      if (dur >= o.minStillS * 1000) standing = standing.concat(run);
    }
    run = [];
  };
  for (let i = 0; i < frames.length; i++) {
    if (isCandidate(i)) run.push(i);
    else flush();
  }
  flush();

  if (standing.length === 0) {
    standing = hips.flatMap((h, i) => (h && h.y - topY <= fallbackBand ? [i] : []));
  }

  const standingHipY = median(standing.map((i) => hips[i]!.y))!;
  return {
    standingFrames: standing,
    femurPx: { left: femurPx(frames, standing, 'left'), right: femurPx(frames, standing, 'right') },
    standingHipY,
  };
}
