/**
 * Trunk and shin inclination from a lateral view (SPEC §5.6).
 *
 * At the rep's bottom frame:
 *   - `trunkDeg`: angle of hip-mid -> shoulder-mid against the image vertical (0 = upright).
 *     Falls back to the camera-side hip -> shoulder when a far-side joint is not usable
 *     around the bottom; confidence is graded on whichever joints the angle uses.
 *   - `shinDeg`: angle of ankle -> knee (camera side) against the image vertical.
 *   - `trunkMinusShinDeg = trunkDeg - shinDeg`. A large positive value ("trunk much more
 *     inclined than the shin", > 25° by default) is a coaching hint, not a rule.
 * All angles are unsigned, in degrees, measured in pixel space.
 *
 * Null with `low_visibility` when the camera-side hip/shoulder/knee/ankle are not usable
 * around the bottom (bottom ± 2 frames). Confidence comes from visibility in that window and
 * is capped at medium when the standing trunk angle shows a tilted camera (|angle| > 10°),
 * because every angle here is measured against the image vertical.
 */
import { angleToVerticalDeg } from '../geometry';
import { hipMid, shoulderMid } from '../calibration';
import { SIDE_JOINTS } from '../landmarks';
import type { PxTrack } from '../smoothing';
import type { Calibration, Metric, Rep, Side, TrunkResult } from '../types';
import { DEFAULTS as LATERAL_DEFAULTS, lateralConfidence, withDefaults } from './lateral';
import type { LateralOptions } from './lateral';

export const DEFAULTS = {
  ...LATERAL_DEFAULTS,
  /** trunkMinusShinDeg above this suggests the "trunk.forward" cue (hint only). */
  forwardLeanHintDeg: 25,
};

export type TrunkOptions = LateralOptions & { forwardLeanHintDeg: number };

/** Trunk vs shin inclination at the bottom of one rep, on the camera-facing `side`. */
export function trunk(
  track: PxTrack,
  rep: Rep,
  calibration: Calibration,
  side: Side,
  opts: Partial<TrunkOptions> = {},
): Metric<TrunkResult> {
  const o: TrunkOptions = withDefaults<TrunkOptions>(DEFAULTS, opts);
  const j = SIDE_JOINTS[side];
  const far = SIDE_JOINTS[side === 'left' ? 'right' : 'left'];
  const leg = [j.knee, j.ankle];
  // Prefer the midpoint trunk line, graded on every joint it uses (both shoulders and hips);
  // fall back to the camera-side hip -> shoulder when the far side is not usable.
  const both = [j.shoulder, far.shoulder, j.hip, far.hip, ...leg];
  const camSide = [j.shoulder, j.hip, ...leg];
  const midWin = lateralConfidence(track, rep, calibration, side, both, o);
  const useMid = midWin.ok;
  const win = useMid ? midWin : lateralConfidence(track, rep, calibration, side, camSide, o);
  if (!win.ok) return { value: null, confidence: null, reason: win.reason };

  const f = track.frames[rep.bottomFrame]!;
  const hm = hipMid(f);
  const sm = shoulderMid(f);
  const trunkDeg =
    useMid && hm && sm
      ? angleToVerticalDeg(hm, sm)
      : angleToVerticalDeg(f.pts[j.hip]!, f.pts[j.shoulder]!);
  const shinDeg = angleToVerticalDeg(f.pts[j.ankle]!, f.pts[j.knee]!);
  if (trunkDeg === null || shinDeg === null) {
    return { value: null, confidence: null, reason: 'low_visibility' };
  }
  const confidence = win.confidence;
  return { value: { trunkDeg, shinDeg, trunkMinusShinDeg: trunkDeg - shinDeg }, confidence };
}
