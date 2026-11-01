/**
 * Camera view detection (SPEC §5.3).
 *
 * Two independent signals, both measured over the calibration's standing frames (all frames
 * when there is no calibration):
 *   - `ratio2d` = median of shoulderWidthPx / torsoHeightPx (shoulder-mid to hip-mid), from
 *     the smoothed pixel track. Scale-free and aspect-ratio independent (pixel space).
 *   - `yawDeg` = median of atan2(|dz|, |dx|) of the shoulder axis and the hip axis in the
 *     MediaPipe world landmarks: 0 = body facing the camera, 90 = side on.
 * Each signal votes lateral / frontal / diagonal with the thresholds in `DEFAULTS`. Following
 * the spec's "lateral if yaw >= 60 or ratio2d < 0.25; frontal if yaw <= 25 or ratio2d >= 0.6":
 *   - both votes agree -> that view, confidence high;
 *   - only one signal available -> its vote, confidence medium;
 *   - votes differ -> confidence low; a lateral or frontal vote beats a diagonal one, and when
 *     one says lateral and the other frontal the 3D yaw wins (it does not depend on body
 *     proportions);
 *   - no signal -> 'unknown'.
 *
 * Camera side (lateral only) = the side whose hip/knee/ankle have the higher mean visibility
 * over the whole clip, so it is fixed for the clip.
 *
 * Every threshold is an uncalibrated starting guess until validated on real clips (SPEC §10).
 */
import { dist } from './geometry';
import type { Px } from './geometry';
import { hipMid, shoulderMid } from './calibration';
import { L_HIP, L_SHOULDER, R_HIP, R_SHOULDER, SIDE_JOINTS } from './landmarks';
import type { PxTrack } from './smoothing';
import type { Calibration, Confidence, Lm, Side, View, ViewResult } from './types';

export const DEFAULTS = {
  /** yaw >= this -> lateral vote. Uncalibrated guess. */
  lateralMinYawDeg: 60,
  /** yaw <= this -> frontal vote. Uncalibrated guess. */
  frontalMaxYawDeg: 25,
  /** ratio2d < this -> lateral vote. Uncalibrated guess. */
  lateralMaxRatio: 0.25,
  /** ratio2d >= this -> frontal vote. Uncalibrated guess. */
  frontalMinRatio: 0.6,
};

export type ViewOptions = typeof DEFAULTS;

/** Per-rep metrics in SPEC §5.5-§5.9. */
export type MetricName = 'depth' | 'trunk' | 'tempo' | 'valgus' | 'asymmetry';

/**
 * Which metrics are meaningful for a view (SPEC §5.3). Tempo only needs the hip-y signal, so
 * it is enabled for every view, including diagonal (plus a "refilm" cue) and unknown.
 */
export function metricsForView(view: View): Readonly<Record<MetricName, boolean>> {
  const lateral = view === 'lateral';
  const frontal = view === 'frontal';
  return { depth: lateral, trunk: lateral, tempo: true, valgus: frontal, asymmetry: frontal };
}

type Vote = Exclude<View, 'unknown'>;

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function finite(lm: Lm | undefined): lm is Lm {
  return !!lm && Number.isFinite(lm.x) && Number.isFinite(lm.z);
}

/** atan2(|dz|, |dx|) of the axis a-b, degrees [0, 90], or null when undefined. */
function axisYawDeg(a: Lm | undefined, b: Lm | undefined): number | null {
  if (!finite(a) || !finite(b)) return null;
  const dx = Math.abs(b.x - a.x);
  const dz = Math.abs(b.z - a.z);
  if (dx === 0 && dz === 0) return null;
  return (Math.atan2(dz, dx) * 180) / Math.PI;
}

function ratioOf(sl: Px | null, sr: Px | null, sm: Px | null, hm: Px | null): number | null {
  if (!sl || !sr || !sm || !hm) return null;
  const torso = dist(sm, hm);
  return torso > 0 ? dist(sl, sr) / torso : null;
}

/** Camera-facing side from mean hip/knee/ankle visibility (unusable = 0), or null on a tie. */
export function cameraSide(track: PxTrack): Side | null {
  const score = (side: Side): number => {
    const j = SIDE_JOINTS[side];
    let sum = 0;
    for (const f of track.frames) {
      for (const k of [j.hip, j.knee, j.ankle]) sum += f.pts[k]?.visibility ?? 0;
    }
    return sum;
  };
  const l = score('left');
  const r = score('right');
  if (l === r) return null;
  return l > r ? 'left' : 'right';
}

/** Detects the camera view of the clip. See the file header for the decision rule. */
export function detectView(
  track: PxTrack,
  calibration: Calibration | null,
  opts: Partial<ViewOptions> = {},
): ViewResult {
  const o: ViewOptions = { ...DEFAULTS };
  for (const [k, v] of Object.entries(opts)) {
    if (v !== undefined && k in DEFAULTS) (o as Record<string, number>)[k] = v as number;
  }

  const idx =
    calibration && calibration.standingFrames.length > 0
      ? calibration.standingFrames
      : track.frames.map((_, i) => i);

  const ratios: number[] = [];
  const yaws: number[] = [];
  for (const i of idx) {
    const f = track.frames[i];
    if (!f) continue;
    const r = ratioOf(
      f.pts[L_SHOULDER] ?? null,
      f.pts[R_SHOULDER] ?? null,
      shoulderMid(f),
      hipMid(f),
    );
    if (r !== null) ratios.push(r);
    if (f.world) {
      for (const [a, b] of [
        [L_SHOULDER, R_SHOULDER],
        [L_HIP, R_HIP],
      ] as const) {
        const y = axisYawDeg(f.world[a], f.world[b]);
        if (y !== null) yaws.push(y);
      }
    }
  }
  const ratio2d = median(ratios);
  const yawDeg = median(yaws);

  const yawVote: Vote | null =
    yawDeg === null
      ? null
      : yawDeg >= o.lateralMinYawDeg
        ? 'lateral'
        : yawDeg <= o.frontalMaxYawDeg
          ? 'frontal'
          : 'diagonal';
  const ratioVote: Vote | null =
    ratio2d === null
      ? null
      : ratio2d < o.lateralMaxRatio
        ? 'lateral'
        : ratio2d >= o.frontalMinRatio
          ? 'frontal'
          : 'diagonal';

  let view: View;
  let confidence: Confidence | null;
  if (yawVote === null && ratioVote === null) {
    view = 'unknown';
    confidence = null;
  } else if (yawVote === null || ratioVote === null) {
    view = (yawVote ?? ratioVote)!;
    confidence = 'medium';
  } else if (yawVote === ratioVote) {
    view = yawVote;
    confidence = 'high';
  } else {
    view = yawVote === 'diagonal' ? ratioVote : yawVote;
    confidence = 'low';
  }

  return {
    view,
    side: view === 'lateral' ? cameraSide(track) : null,
    ratio2d,
    yawDeg,
    confidence,
  };
}
