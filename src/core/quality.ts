/**
 * Global quality gate (SPEC §5.10). When `ok` is false the UI shows `problems` and no
 * metrics.
 *
 * - `visibleFrac`: fraction of all sampled frames in which every landmark the view needs is
 *   usable (after short-gap interpolation). Required landmarks:
 *     lateral  -> camera-side shoulder, hip, knee, ankle (the far side is often hidden);
 *     frontal  -> both hips, knees and ankles;
 *     diagonal / unknown -> at least one hip (tempo only).
 *   In lateral view with no known camera side, either side's chain satisfies the frame.
 * - `effectiveFps`: frames counted in `visibleFrac` / clip duration (s). The duration includes
 *   one median frame interval, so a fully visible clip sampled at N Hz scores N.
 * - `cutOff`: in more than `cutOffMaxFrac` of the frames that contain a pose, the nose or a
 *   foot is outside the image or not usable. A foot counts as present when its ankle or its
 *   heel is usable and inside the image, so a heel hidden behind the foot is not a cut-off.
 *   A landmark outside the frame or with presence < 0.5 is never usable, so "not usable" is
 *   the closest proxy the pixel track offers (heavy occlusion can still read as cut-off).
 *   In lateral view only the camera-side foot is checked (the far foot hides behind the near
 *   leg).
 * - `tiltedCamera`: median signed angle of hip-mid -> shoulder-mid vs the image vertical over
 *   the standing frames exceeds `maxStandingTrunkDeg` (camera-side hip -> shoulder when a
 *   far-side landmark is hidden). People stand roughly upright, so a large standing lean most
 *   likely means the camera is rolled; a lifter leaning forward while standing can also trip
 *   it, which is why it only warns. No standing frames -> false (squat frames would read the
 *   squat's own trunk lean as tilt). Does not block `ok`.
 * - `ok = visibleFrac >= minVisibleFrac && effectiveFps >= minEffectiveFps && !cutOff &&
 *   pose found`. `diagonal_view` and `tilted_camera` are reported but do not block.
 *
 * Every threshold is an uncalibrated starting guess until validated on real clips (SPEC §10).
 */
import { signedAngleToVerticalDeg } from './geometry';
import { hipMid, median, shoulderMid, withDefaults } from './calibration';
import { L_HIP, NOSE, R_HIP, SIDE_JOINTS } from './landmarks';
import type { PxFrame, PxTrack } from './smoothing';
import type { Calibration, QualityReport, Side, ViewResult } from './types';

export const DEFAULTS = {
  /** Minimum fraction of frames with the view's required landmarks. Uncalibrated guess. */
  minVisibleFrac: 0.7,
  /** Minimum usable frames per second. Uncalibrated guess. */
  minEffectiveFps: 15,
  /** cutOff when more than this fraction of pose frames lose the nose or a foot. */
  cutOffMaxFrac: 0.2,
  /** tiltedCamera when |standing trunk angle| exceeds this, degrees. Uncalibrated guess. */
  maxStandingTrunkDeg: 10,
};

export type QualityOptions = typeof DEFAULTS;

type Problem = QualityReport['problems'][number];

const SIDES: readonly Side[] = ['left', 'right'];

/** True when landmark k is usable and inside the image. */
function inFrame(f: PxFrame, k: number, width: number, height: number): boolean {
  const p = f.pts[k];
  return !!p && p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height;
}

/**
 * Signed trunk angle vs vertical: hip-mid -> shoulder-mid, or the camera-side hip -> shoulder
 * when a far-side landmark is hidden (common in lateral view).
 */
function trunkAngle(f: PxFrame, side: Side | null): number | null {
  const h = hipMid(f);
  const s = shoulderMid(f);
  if (h && s) return signedAngleToVerticalDeg(h, s);
  if (!side) return null;
  const j = SIDE_JOINTS[side];
  const hip = f.pts[j.hip];
  const sh = f.pts[j.shoulder];
  return hip && sh ? signedAngleToVerticalDeg(hip, sh) : null;
}

/** Predicate: does this frame have every landmark the view needs? */
function requiredVisible(view: ViewResult): (f: PxFrame) => boolean {
  const chain = (f: PxFrame, s: Side) => {
    const j = SIDE_JOINTS[s];
    return f.usable[j.shoulder]! && f.usable[j.hip]! && f.usable[j.knee]! && f.usable[j.ankle]!;
  };
  switch (view.view) {
    case 'lateral': {
      const side = view.side;
      return side ? (f) => chain(f, side) : (f) => chain(f, 'left') || chain(f, 'right');
    }
    case 'frontal':
      return (f) =>
        SIDES.every((s) => {
          const j = SIDE_JOINTS[s];
          return f.usable[j.hip]! && f.usable[j.knee]! && f.usable[j.ankle]!;
        });
    default:
      return (f) => f.usable[L_HIP]! || f.usable[R_HIP]!;
  }
}

/** Runs the quality gate. `calibration` supplies the standing frames for `tiltedCamera`. */
export function assessQuality(
  track: PxTrack,
  view: ViewResult,
  calibration: Calibration | null,
  opts: Partial<QualityOptions> = {},
): QualityReport {
  const o = withDefaults(DEFAULTS, opts);
  const { frames, width, height } = track;
  const n = frames.length;

  const isVisible = requiredVisible(view);
  const visibleCount = frames.reduce((c, f) => c + (isVisible(f) ? 1 : 0), 0);
  const visibleFrac = n > 0 ? visibleCount / n : 0;

  let effectiveFps = 0;
  if (n > 0) {
    const dts: number[] = [];
    for (let i = 1; i < n; i++) dts.push(frames[i]!.t - frames[i - 1]!.t);
    const frameDt = median(dts) ?? (track.sampleHz > 0 ? 1000 / track.sampleHz : 0);
    const durationS = (frames[n - 1]!.t - frames[0]!.t + frameDt) / 1000;
    effectiveFps = durationS > 0 ? visibleCount / durationS : 0;
  }

  const poseFrames = frames.filter((f) => f.usable.some(Boolean));
  const poseFound = poseFrames.length > 0;

  const footSides: readonly Side[] = view.view === 'lateral' && view.side ? [view.side] : SIDES;
  const cutCount = poseFrames.reduce((c, f) => {
    const noseOut = !inFrame(f, NOSE, width, height);
    // A foot is in frame when its ankle or its heel is; feet often hide one of the two.
    const footOut = footSides.some((s) => {
      const j = SIDE_JOINTS[s];
      return !inFrame(f, j.ankle, width, height) && !inFrame(f, j.heel, width, height);
    });
    return c + (noseOut || footOut ? 1 : 0);
  }, 0);
  const cutOff = poseFound && cutCount / poseFrames.length > o.cutOffMaxFrac;

  const trunkAngles: number[] = [];
  for (const i of calibration?.standingFrames ?? []) {
    const f = frames[i];
    if (!f) continue;
    const a = trunkAngle(f, view.view === 'lateral' ? view.side : null);
    if (a !== null) trunkAngles.push(a);
  }
  const standingTrunk = median(trunkAngles);
  const tiltedCamera = standingTrunk !== null && Math.abs(standingTrunk) > o.maxStandingTrunkDeg;

  const problems: Problem[] = [];
  if (!poseFound) problems.push('no_pose');
  if (visibleFrac < o.minVisibleFrac) problems.push('low_visibility');
  if (effectiveFps < o.minEffectiveFps) problems.push('low_fps');
  if (cutOff) problems.push('cut_off');
  if (view.view === 'diagonal') problems.push('diagonal_view');
  if (tiltedCamera) problems.push('tilted_camera');

  const ok =
    poseFound && visibleFrac >= o.minVisibleFrac && effectiveFps >= o.minEffectiveFps && !cutOff;

  return { ok, visibleFrac, effectiveFps, cutOff, tiltedCamera, problems };
}
