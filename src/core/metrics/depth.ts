/**
 * Squat depth from a lateral view (SPEC §5.5). This is an *estimated* depth.
 *
 * The IPF rule asks whether the top surface of the thigh at the hip crease goes below the top
 * of the knee. A camera cannot see those surfaces, so this approximates the rule with joint
 * centres (MediaPipe hip and knee landmarks): at the rep's bottom frame, on the camera-facing
 * side,
 *
 *   delta = (hipY - kneeY) / femurPx        (y down; positive = hip centre below knee centre)
 *
 * where `femurPx` is the standing femur length from calibration (never a per-frame length).
 * Classes: `below` if delta > +0.05, `above` if delta < -0.05, `parallel` in between, and
 * `borderline` whenever delta is within ±0.02 of either boundary, because the camera cannot
 * settle it there.
 *
 * Also reported: `thighAngleDeg = atan2(kneeY - hipY, |kneeX - hipX|)` (positive = knee lower
 * than hip = above parallel; negative = below) and `kneeFlexDeg = 180 - angle(hip, knee, ankle)`.
 *
 * Null with `low_visibility` when hip/knee/ankle are not usable around the bottom
 * (bottom ± 2 frames) or the camera-side femur was not calibrated. Confidence comes from the
 * visibility in that window, capped at medium when the camera is tilted.
 */
import { kneeFlexDeg } from '../calibration';
import { SIDE_JOINTS } from '../landmarks';
import type { PxTrack } from '../smoothing';
import type { Calibration, DepthClass, DepthResult, Metric, Rep, Side } from '../types';
import { withDefaults } from '../options';
import { DEFAULTS as LATERAL_DEFAULTS, lateralConfidence } from './lateral';
import type { LateralOptions } from './lateral';

export const DEFAULTS = {
  ...LATERAL_DEFAULTS,
  /** |delta| <= parallelBand is parallel (femur lengths). */
  parallelBand: 0.05,
  /** Within this distance of ±parallelBand the class is borderline. */
  borderlineBand: 0.02,
};

export type DepthOptions = LateralOptions & { parallelBand: number; borderlineBand: number };

const RAD2DEG = 180 / Math.PI;

/** Depth class for a normalized hip-knee delta (positive = hip below knee). */
export function classifyDepth(
  delta: number,
  o: Pick<DepthOptions, 'parallelBand' | 'borderlineBand'> = DEFAULTS,
): DepthClass {
  // Small epsilon so the documented edges (e.g. exactly 0.03 / 0.07) count as borderline
  // despite floating-point error.
  if (Math.abs(Math.abs(delta) - o.parallelBand) <= o.borderlineBand + 1e-9) return 'borderline';
  if (delta > o.parallelBand) return 'below';
  if (delta < -o.parallelBand) return 'above';
  return 'parallel';
}

/** Estimated depth of one rep, measured on the camera-facing `side`. See file header. */
export function depth(
  track: PxTrack,
  rep: Rep,
  calibration: Calibration,
  side: Side,
  opts: Partial<DepthOptions> = {},
): Metric<DepthResult> {
  const o: DepthOptions = withDefaults<DepthOptions>(DEFAULTS, opts);
  const j = SIDE_JOINTS[side];
  const femur = calibration.femurPx[side];
  if (femur === null || !(femur > 0)) {
    return { value: null, confidence: null, reason: 'low_visibility' };
  }
  const win = lateralConfidence(track, rep, calibration, side, [j.hip, j.knee, j.ankle], o);
  if (!win.ok) return { value: null, confidence: null, reason: win.reason };

  const f = track.frames[rep.bottomFrame]!;
  const hip = f.pts[j.hip]!;
  const knee = f.pts[j.knee]!;
  const flex = kneeFlexDeg(f, side);
  if (flex === null) return { value: null, confidence: null, reason: 'low_visibility' };

  const delta = (hip.y - knee.y) / femur;
  const thighAngleDeg = Math.atan2(knee.y - hip.y, Math.abs(knee.x - hip.x)) * RAD2DEG;
  return {
    value: { delta, cls: classifyDepth(delta, o), thighAngleDeg, kneeFlexDeg: flex },
    confidence: win.confidence,
  };
}
