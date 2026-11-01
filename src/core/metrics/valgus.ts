/**
 * Knee valgus alert, frontal view (SPEC §5.8).
 *
 * Two 2D signals, each measured as a change from the standing baseline (calibration frames):
 *
 * - **FPPA** (frontal plane projection angle) per leg: `180° − ∠(hip, knee, ankle)`, signed so
 *   that a knee displaced medially (toward the other leg) is positive and a knee displaced
 *   laterally is negative. "Medial" is defined by the direction from this hip to the other hip,
 *   so it is correct whether the subject faces the camera or has their back to it.
 * - **Knee/ankle ratio**: `kneeDistance / ankleDistance`, reported as the relative change
 *   `(ratio_rep − ratio_standing) / ratio_standing`; negative = knees closing relative to feet.
 *
 * The evaluation window is the rep's frames whose per-frame depth is at least
 * `minDepthNorm` of this rep's bottom depth (hip-mid y relative to `standingHipY`), on the way
 * down, at the bottom and back up. The reported value is the worst frame in the window:
 * the largest FPPA change per leg and the most negative ratio change. FPPA is skipped in
 * frames where the 2D thigh is foreshortened below `minThighFrac` of the standing femur (deep
 * in a squat filmed from the front); the knee/ankle ratio covers those frames. Because both signals
 * are changes vs standing, a wide stance with toes out (knees tracking outward over the feet)
 * gives negative FPPA change and a positive ratio change, and is never flagged.
 *
 * Flag when the FPPA change exceeds `fppaFlagDeg` on either leg or the ratio change is below
 * `ratioFlag`.
 *
 * ## Confidence: never above medium
 * 2D frontal-plane knee kinematics agree poorly with 3D motion capture (knee abduction angle
 * r = 0.20 between 2D FPPA and 3D; J Biomech 2022). This metric is therefore an *alert*, not
 * a measurement: confidence is `medium` at best, and `low` when landmark visibility is weak,
 * points in the window were interpolated, a leg lacks usable landmarks, or the FPPA signal is
 * jittery (mean absolute frame-to-frame second difference above `maxJitterDeg`). A leg whose
 * FPPA was skipped only because the thigh was foreshortened does not lower confidence.
 *
 * Returns `{ value: null, reason }` (SPEC §0 rule 3) when there is no standing baseline, the
 * window is too short (`insufficient_frames`), or too few window frames have usable landmarks
 * (`low_visibility`).
 */
import { withDefaults } from '../options';
import { angleDeg, dist } from '../geometry';
import type { Px } from '../geometry';
import { SIDE_JOINTS } from '../landmarks';
import type { PxFrame, PxTrack } from '../smoothing';
import { hipMid } from '../calibration';
import type { Calibration, Confidence, Metric, Rep, Side, ValgusResult } from '../types';

export const DEFAULTS = {
  /** Window: rep frames whose depth is at least this fraction of the rep's bottom depth. */
  minDepthNorm: 0.3,
  /** Flag when FPPA increases (more medial) by more than this, degrees, on either leg. */
  fppaFlagDeg: 10,
  /**
   * Flag when the relative knee/ankle ratio change is below this. SPEC's first guess was
   * -0.15, but on the synthetic figure (shoulder-width stance) that fires at ~5° of shin
   * cave, where FPPA barely moves; -0.20 fires at ~6-7°, closer to the FPPA threshold.
   * Starting guess: retune with labelled clips (eval/).
   */
  ratioFlag: -0.2,
  /** Minimum window length, frames. */
  minWindowFrames: 3,
  /** A signal needs usable landmarks in at least this fraction of window frames. */
  minUsableFrac: 0.6,
  /** Mean visibility of the leg landmarks in the window needed for medium confidence. */
  mediumMinVisibility: 0.8,
  /** Above this interpolated fraction of window points, confidence is low. */
  maxInterpolatedFrac: 0.1,
  /** Mean |second difference| of FPPA over the window above which confidence is low, deg. */
  maxJitterDeg: 2,
  /**
   * FPPA is skipped in frames where the 2D hip-knee length is below this fraction of the
   * standing femur length: near the bottom of a deep squat filmed from the front the thigh
   * points at the camera, the projected hip lands next to the knee and the angle is noise.
   */
  minThighFrac: 0.5,
  /**
   * The knee/ankle ratio is skipped when the ankles are closer than this many mean standing
   * femur lengths (narrow or feet-together stance: the ratio would be noise).
   */
  minAnkleDistFemur: 0.3,
};

export type ValgusOptions = typeof DEFAULTS;

const SIDES: readonly Side[] = ['left', 'right'];
const OTHER: Record<Side, Side> = { left: 'right', right: 'left' };

/**
 * Signed FPPA of one leg in one frame, degrees: 0 = hip, knee and ankle collinear,
 * positive = knee medial of the hip-ankle line. Null when a needed point is not usable or the
 * 2D thigh is shorter than `minThighPx` (foreshortened).
 */
export function fppaDeg(frame: PxFrame, side: Side, minThighPx = 0): number | null {
  const j = SIDE_JOINTS[side];
  const hip = frame.pts[j.hip];
  const knee = frame.pts[j.knee];
  const ankle = frame.pts[j.ankle];
  const otherHip = frame.pts[SIDE_JOINTS[OTHER[side]].hip];
  if (!hip || !knee || !ankle || !otherHip) return null;
  if (dist(hip, knee) < minThighPx) return null;
  const a = angleDeg(hip, knee, ankle);
  if (a === null) return null;
  const mag = 180 - a;
  // Knee offset from the hip-ankle line, projected on the medial direction (toward other hip).
  const ax = ankle.x - hip.x;
  const ay = ankle.y - hip.y;
  const len2 = ax * ax + ay * ay;
  if (len2 === 0) return null;
  const u = ((knee.x - hip.x) * ax + (knee.y - hip.y) * ay) / len2;
  const off: Px = { x: knee.x - (hip.x + u * ax), y: knee.y - (hip.y + u * ay) };
  const medial = (otherHip.x - hip.x) * off.x + (otherHip.y - hip.y) * off.y;
  return medial >= 0 ? mag : -mag;
}

/**
 * kneeDistance / ankleDistance in one frame, or null when a point is missing or the ankles are
 * closer than `minAnklePx` (with the feet together the ratio is dominated by landmark noise).
 */
export function kneeAnkleRatio(frame: PxFrame, minAnklePx = 0): number | null {
  const lk = frame.pts[SIDE_JOINTS.left.knee];
  const rk = frame.pts[SIDE_JOINTS.right.knee];
  const la = frame.pts[SIDE_JOINTS.left.ankle];
  const ra = frame.pts[SIDE_JOINTS.right.ankle];
  if (!lk || !rk || !la || !ra) return null;
  const ad = dist(la, ra);
  return ad > 0 && ad >= minAnklePx ? dist(lk, rk) / ad : null;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * Contiguous frame range of the rep, from the first to the last frame whose per-frame depth
 * (hip-mid y below standing, relative to the rep's deepest usable hip-mid) is at least
 * `minDepthNorm`. Frames inside the range with a missing hip stay in it, so neighbouring
 * indices are adjacent frames. Empty when no hip-mid is usable or the rep has no depth.
 */
export function repWindow(
  track: PxTrack,
  rep: Rep,
  calibration: Calibration,
  minDepthNorm: number,
): number[] {
  const n = track.frames.length;
  const lo = Math.max(0, rep.startFrame);
  const hi = Math.min(n - 1, rep.endFrame);
  const ys: Array<number | null> = [];
  for (let i = lo; i <= hi; i++) ys.push(hipMid(track.frames[i]!)?.y ?? null);
  const deepest = Math.max(-Infinity, ...ys.flatMap(nonNull));
  const range = deepest - calibration.standingHipY;
  if (!(range > 0)) return [];
  let first = -1;
  let last = -1;
  ys.forEach((y, k) => {
    if (y !== null && (y - calibration.standingHipY) / range >= minDepthNorm) {
      if (first < 0) first = k;
      last = k;
    }
  });
  if (first < 0) return [];
  const out: number[] = [];
  for (let k = first; k <= last; k++) out.push(lo + k);
  return out;
}

/** Valgus alert for one rep. See the file header. */
export function valgus(
  track: PxTrack,
  rep: Rep,
  calibration: Calibration,
  opts: Partial<ValgusOptions> = {},
): Metric<ValgusResult> {
  const o: ValgusOptions = withDefaults(DEFAULTS, opts);
  const frames = track.frames;
  const standing = calibration.standingFrames.filter((i) => i >= 0 && i < frames.length);
  const window = repWindow(track, rep, calibration, o.minDepthNorm);
  if (standing.length === 0 || window.length < o.minWindowFrames) {
    return { value: null, confidence: null, reason: 'insufficient_frames' };
  }
  const minUsable = Math.ceil(o.minUsableFrac * window.length);

  // Per leg: 'ok' = measured, 'foreshortened' = landmarks fine but the thigh points at the
  // camera in too many frames (skipped by design), 'missing' = not enough usable landmarks.
  const legState: Record<Side, 'ok' | 'foreshortened' | 'missing'> = {
    left: 'missing',
    right: 'missing',
  };
  const fppaChange: Record<Side, number | null> = { left: null, right: null };
  const jitters: number[] = [];
  for (const side of SIDES) {
    const femur = calibration.femurPx[side];
    const base = median(standing.flatMap((i) => nonNull(fppaDeg(frames[i]!, side))));
    if (base === null || femur === null) continue;
    const minThighPx = o.minThighFrac * femur;
    let visible = 0;
    const series = window.map((i) => {
      const f = frames[i]!;
      const v = fppaDeg(f, side);
      if (v === null) return null;
      visible++;
      const j = SIDE_JOINTS[side];
      return dist(f.pts[j.hip]!, f.pts[j.knee]!) >= minThighPx ? v : null;
    });
    if (visible < minUsable) continue;
    const robust = rollingMedian3(series).flatMap(nonNull);
    if (robust.length === 0) {
      legState[side] = 'foreshortened';
      continue;
    }
    legState[side] = 'ok';
    fppaChange[side] = Math.max(...robust) - base;
    jitters.push(jitter(series));
  }

  let ratioChange: number | null = null;
  const femurs = [calibration.femurPx.left, calibration.femurPx.right].flatMap((x) =>
    x === null ? [] : [x],
  );
  const minAnklePx =
    femurs.length > 0
      ? (o.minAnkleDistFemur * femurs.reduce((a, b) => a + b, 0)) / femurs.length
      : Infinity;
  const ratioAt = (i: number) => kneeAnkleRatio(frames[i]!, minAnklePx);
  const ratioBase = median(standing.flatMap((i) => nonNull(ratioAt(i))));
  if (ratioBase !== null && ratioBase > 0) {
    const series = window.map(ratioAt);
    if (series.flatMap(nonNull).length >= minUsable) {
      const robust = rollingMedian3(series).flatMap(nonNull);
      if (robust.length > 0) ratioChange = (Math.min(...robust) - ratioBase) / ratioBase;
    }
  }

  if (fppaChange.left === null && fppaChange.right === null && ratioChange === null) {
    return { value: null, confidence: null, reason: 'low_visibility' };
  }

  const flagged =
    SIDES.some((s) => {
      const c = fppaChange[s];
      return c !== null && c > o.fppaFlagDeg;
    }) ||
    (ratioChange !== null && ratioChange < o.ratioFlag);

  const { meanVis, interpFrac } = legVisibility(frames, window);
  const confidence: Confidence =
    legState.left !== 'missing' &&
    legState.right !== 'missing' &&
    jitters.every((j) => j <= o.maxJitterDeg) &&
    meanVis >= o.mediumMinVisibility &&
    interpFrac <= o.maxInterpolatedFrac
      ? 'medium'
      : 'low';

  return {
    value: { fppaChangeDeg: fppaChange, kneeAnkleRatioChange: ratioChange, flagged },
    confidence,
  };
}

/**
 * Median of each value with its two neighbours, null unless all three are non-null, so a
 * single glitch frame cannot become the window's worst value.
 */
function rollingMedian3(series: Array<number | null>): Array<number | null> {
  return series.map((v, i) => {
    const a = series[i - 1];
    const c = series[i + 1];
    if (v === null || a == null || c == null) return null;
    return Math.max(Math.min(a, v), Math.min(Math.max(a, v), c));
  });
}

function nonNull(x: number | null): number[] {
  return x === null ? [] : [x];
}

/** Mean absolute second difference over consecutive non-null runs, degrees (0 if too short). */
function jitter(series: Array<number | null>): number {
  const d2: number[] = [];
  for (let i = 2; i < series.length; i++) {
    const a = series[i - 2];
    const b = series[i - 1];
    const c = series[i];
    if (a != null && b != null && c != null) d2.push(Math.abs(c - 2 * b + a));
  }
  return d2.length === 0 ? 0 : d2.reduce((s, x) => s + x, 0) / d2.length;
}

/** Mean visibility and interpolated fraction of hip/knee/ankle (both legs) over the window. */
function legVisibility(
  frames: PxFrame[],
  window: number[],
): { meanVis: number; interpFrac: number } {
  let vis = 0;
  let interp = 0;
  let total = 0;
  for (const i of window) {
    for (const s of SIDES) {
      const j = SIDE_JOINTS[s];
      for (const k of [j.hip, j.knee, j.ankle]) {
        total++;
        const p = frames[i]!.pts[k];
        if (!p) continue;
        vis += p.visibility;
        if (p.interpolated) interp++;
      }
    }
  }
  return total === 0
    ? { meanVis: 0, interpFrac: 1 }
    : { meanVis: vis / total, interpFrac: interp / total };
}
