/**
 * Shared helpers for the lateral-view metrics (depth, trunk; SPEC §5.5, §5.6).
 *
 * - `bottomWindow` checks that the joints a metric needs are usable around a rep's bottom
 *   frame and grades confidence from how well they were seen.
 * - `standingTiltDeg` estimates camera roll from the standing trunk angle.
 */
import { signedAngleToVerticalDeg } from '../geometry';
import { hipMid, shoulderMid } from '../calibration';
import type { PxTrack } from '../smoothing';
import type { Calibration, Confidence, Rep } from '../types';

export const DEFAULTS = {
  /** Frames on each side of the bottom frame that are checked for visibility. */
  windowFrames: 2,
  /** Minimum fraction of window frames in which every required joint is usable. */
  minUsableFrac: 0.6,
  /** Mean visibility at or above this (with no gaps) gives high confidence. */
  highVisibility: 0.8,
  /** Mean visibility at or above this gives medium confidence. */
  mediumVisibility: 0.65,
  /** |standing trunk angle| above this marks the camera as tilted (SPEC §5.6). */
  maxStandingTrunkDeg: 10,
};

export type LateralOptions = typeof DEFAULTS;

/** `{...defaults, ...opts}` that ignores keys of `opts` explicitly set to undefined. */
export function withDefaults<T extends object>(defaults: T, opts: Partial<T>): T {
  const out = { ...defaults };
  for (const [k, v] of Object.entries(opts)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

export type WindowCheck =
  | { ok: true; confidence: Confidence }
  | { ok: false; reason: 'low_visibility' | 'insufficient_frames' };

/**
 * Checks landmarks `joints` over `rep.bottomFrame ± windowFrames` (clamped to the clip).
 * Fails when the bottom frame itself is missing any joint, or when fewer than
 * `minUsableFrac` of window frames have all of them. Confidence:
 *   high   = every window frame observed (no interpolation), mean visibility >= highVisibility
 *   medium = mean visibility >= mediumVisibility
 *   low    = otherwise
 */
export function bottomWindow(
  track: PxTrack,
  rep: Rep,
  joints: readonly number[],
  o: LateralOptions = DEFAULTS,
): WindowCheck {
  const n = track.frames.length;
  const b = rep.bottomFrame;
  if (!Number.isInteger(b) || b < 0 || b >= n) return { ok: false, reason: 'insufficient_frames' };

  const lo = Math.max(0, b - o.windowFrames);
  const hi = Math.min(n - 1, b + o.windowFrames);
  let usableFrames = 0;
  let observedAll = true;
  let visSum = 0;
  let visCount = 0;
  let bottomOk = false;
  for (let i = lo; i <= hi; i++) {
    const pts = joints.map((k) => track.frames[i]!.pts[k] ?? null);
    const ok = pts.every((p) => p !== null);
    if (i === b) bottomOk = ok;
    if (!ok) {
      observedAll = false;
      continue;
    }
    usableFrames++;
    for (const p of pts) {
      if (p!.interpolated) observedAll = false;
      visSum += p!.visibility;
      visCount++;
    }
  }
  const total = hi - lo + 1;
  if (!bottomOk || usableFrames / total < o.minUsableFrac) {
    return { ok: false, reason: 'low_visibility' };
  }
  const meanVis = visSum / visCount;
  const confidence: Confidence =
    observedAll && meanVis >= o.highVisibility
      ? 'high'
      : meanVis >= o.mediumVisibility
        ? 'medium'
        : 'low';
  return { ok: true, confidence };
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * Median signed trunk angle (hip-mid -> shoulder-mid vs image vertical) over the standing
 * frames, degrees; positive = shoulders toward image right. A standing lifter is close to
 * vertical, so a large value means the camera is rolled. Null when no standing frame has
 * both midpoints.
 */
export function standingTiltDeg(track: PxTrack, calibration: Calibration): number | null {
  const angles: number[] = [];
  for (const i of calibration.standingFrames) {
    const f = track.frames[i];
    if (!f) continue;
    const h = hipMid(f);
    const s = shoulderMid(f);
    if (!h || !s) continue;
    const a = signedAngleToVerticalDeg(h, s);
    if (a !== null) angles.push(a);
  }
  return median(angles);
}

/** True when the standing trunk angle exceeds `maxStandingTrunkDeg` (SPEC §5.6). */
export function isCameraTilted(
  track: PxTrack,
  calibration: Calibration,
  o: LateralOptions = DEFAULTS,
): boolean {
  const tilt = standingTiltDeg(track, calibration);
  return tilt !== null && Math.abs(tilt) > o.maxStandingTrunkDeg;
}

/** Lowers `c` to at most `cap`. */
export function capConfidence(c: Confidence, cap: Confidence): Confidence {
  const rank: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
  return rank[c] <= rank[cap] ? c : cap;
}
