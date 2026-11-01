/**
 * Left/right asymmetry at the bottom of a rep, frontal view (SPEC §5.9).
 *
 * Measured over the bottom frame ± `bottomHalfWindow` frames (median per signal, so one bad
 * frame cannot decide the result):
 *
 * - `hipShiftNorm`: hip-mid x minus ankle-mid x, divided by the mean standing femur length
 *   (`calibration.femurPx`). Signed toward the subject's own sides: positive = hips shifted
 *   toward the subject's left, using which side of the image the left hip is on in each
 *   frame, so the sign is the same whether the subject faces the camera or has their back to
 *   it. Only the horizontal offset counts, so a hip drop is not read as a shift.
 * - `hipHeightDiffNorm`: left hip y minus right hip y over the same femur length.
 *   Image y grows downward, so positive = left hip lower than the right.
 * - `kneeFlexDiffDeg`: left minus right 2D knee flexion (`180° − ∠(hip, knee, ankle)`), or
 *   null when either leg is not measurable or either 2D thigh is shorter than `minThighFrac`
 *   of its standing femur (the thigh points at the camera at the bottom of a deep squat, so
 *   this is often null for deep reps). A coarse hint at best.
 *
 * Flag when |hipShiftNorm| > `hipShiftFlag`, |hipHeightDiffNorm| > `hipHeightFlag`, or
 * |kneeFlexDiffDeg| > `kneeFlexFlagDeg`.
 *
 * Confidence from the visibility of hips, knees and ankles in the bottom window: `high` when
 * the mean is at least `highMinVisibility` and no point was interpolated, `medium` at
 * `mediumMinVisibility`, otherwise `low`. Null with `low_visibility` when hips, ankles or a
 * standing femur length are unavailable (SPEC §0 rule 3).
 */
import { withDefaults } from '../options';
import { kneeFlexDeg } from '../calibration';
import { dist } from '../geometry';
import { SIDE_JOINTS } from '../landmarks';
import type { PxFrame, PxTrack } from '../smoothing';
import type { AsymmetryResult, Calibration, Confidence, Metric, Rep } from '../types';

export const DEFAULTS = {
  /** Frames on each side of `rep.bottomFrame` included in the bottom window. */
  bottomHalfWindow: 2,
  /** Flag thresholds (SPEC §5.9). */
  hipShiftFlag: 0.1,
  hipHeightFlag: 0.08,
  kneeFlexFlagDeg: 10,
  /** Visibility thresholds for confidence. */
  highMinVisibility: 0.85,
  mediumMinVisibility: 0.65,
  /**
   * Knee flexion is skipped in frames where either 2D hip-knee length is below this fraction
   * of that side's standing femur: at the bottom of a deep squat filmed from the front the
   * thigh points at the camera and 2D flexion is noise.
   */
  minThighFrac: 0.5,
};

export type AsymmetryOptions = typeof DEFAULTS;

const L = SIDE_JOINTS.left;
const R = SIDE_JOINTS.right;

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Hip shift (px, + = subject's left) and left−right hip y (px) in one frame. */
function hipSignals(f: PxFrame): { shift: number; heightDiff: number } | null {
  const lh = f.pts[L.hip];
  const rh = f.pts[R.hip];
  const la = f.pts[L.ankle];
  const ra = f.pts[R.ankle];
  if (!lh || !rh || !la || !ra) return null;
  // Horizontal offset only (SPEC: hip-mid x vs ankle-mid x), so a hip drop does not leak in.
  // Signed by which way the subject's left hip lies in the image (facing vs back to camera).
  const ax = lh.x - rh.x;
  if (ax === 0) return null;
  const dx = (lh.x + rh.x) / 2 - (la.x + ra.x) / 2;
  return { shift: ax > 0 ? dx : -dx, heightDiff: lh.y - rh.y };
}

/** Asymmetry at the bottom of one rep. See the file header. */
export function asymmetry(
  track: PxTrack,
  rep: Rep,
  calibration: Calibration,
  opts: Partial<AsymmetryOptions> = {},
): Metric<AsymmetryResult> {
  const o: AsymmetryOptions = withDefaults(DEFAULTS, opts);
  const n = track.frames.length;
  const lo = Math.max(0, rep.bottomFrame - o.bottomHalfWindow);
  const hi = Math.min(n - 1, rep.bottomFrame + o.bottomHalfWindow);
  if (rep.bottomFrame < 0 || rep.bottomFrame >= n) {
    return { value: null, confidence: null, reason: 'insufficient_frames' };
  }
  const window: PxFrame[] = [];
  for (let i = lo; i <= hi; i++) window.push(track.frames[i]!);

  const femurs = [calibration.femurPx.left, calibration.femurPx.right].filter(
    (x): x is number => x !== null && x > 0,
  );
  const hips = window.flatMap((f) => {
    const s = hipSignals(f);
    return s ? [s] : [];
  });
  // Require a majority of the bottom window, so the result is not one stray frame.
  if (femurs.length === 0 || hips.length * 2 <= window.length) {
    return { value: null, confidence: null, reason: 'low_visibility' };
  }
  const femur = femurs.reduce((a, b) => a + b, 0) / femurs.length;
  const hipShiftNorm = median(hips.map((h) => h.shift))! / femur;
  const hipHeightDiffNorm = median(hips.map((h) => h.heightDiff))! / femur;

  const fl = calibration.femurPx.left;
  const fr = calibration.femurPx.right;
  const thighOk = (f: PxFrame, hip: number, knee: number, femurPx: number | null): boolean => {
    const h = f.pts[hip];
    const k = f.pts[knee];
    return femurPx !== null && !!h && !!k && dist(h, k) >= o.minThighFrac * femurPx;
  };
  const flexDiffs = window.flatMap((f) => {
    if (!thighOk(f, L.hip, L.knee, fl) || !thighOk(f, R.hip, R.knee, fr)) return [];
    const l = kneeFlexDeg(f, 'left');
    const r = kneeFlexDeg(f, 'right');
    return l === null || r === null ? [] : [l - r];
  });
  const kneeFlexDiffDeg = flexDiffs.length * 2 > window.length ? median(flexDiffs) : null;

  const flagged =
    Math.abs(hipShiftNorm) > o.hipShiftFlag ||
    Math.abs(hipHeightDiffNorm) > o.hipHeightFlag ||
    (kneeFlexDiffDeg !== null && Math.abs(kneeFlexDiffDeg) > o.kneeFlexFlagDeg);

  let vis = 0;
  let total = 0;
  let interpolated = false;
  for (const f of window) {
    for (const k of [L.hip, R.hip, L.knee, R.knee, L.ankle, R.ankle]) {
      total++;
      const p = f.pts[k];
      if (!p) continue;
      vis += p.visibility;
      if (p.interpolated) interpolated = true;
    }
  }
  const meanVis = vis / total;
  const confidence: Confidence =
    meanVis >= o.highMinVisibility && !interpolated
      ? 'high'
      : meanVis >= o.mediumMinVisibility
        ? 'medium'
        : 'low';

  return {
    value: { hipShiftNorm, hipHeightDiffNorm, kneeFlexDiffDeg, flagged },
    confidence,
  };
}
