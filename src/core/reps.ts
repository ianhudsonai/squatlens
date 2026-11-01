/**
 * Rep segmentation (SPEC §5.4), offline.
 *
 * Signal: smoothed hip-mid y in pixels (y grows downward). Over the whole clip,
 *   depthNorm(i) = (y_i - standingHipY) / (maxY - standingHipY)
 * so 0 is the calibrated standing height and 1 the lowest hip position in the clip. Frames
 * without a usable hip midpoint have no depthNorm and never count toward a debounce run.
 *
 * State machine with hysteresis and debounce:
 *   - standing -> descending once depthNorm > `enter` for `minStateFrames` consecutive frames;
 *   - descending -> bottom -> ascending: the bottom is the frame of max hip y between the
 *     descent and the return (this is offline, so the whole rep is known before the bottom
 *     is chosen; a bounce mid-rep stays one rep);
 *   - ascending -> standing once depthNorm < `exit` for `minStateFrames` consecutive frames.
 *     Only then is the rep counted, and only if its bottom reached depthNorm > `minBottom`
 *     and both the descent and the ascent span at least `minStateFrames` frames.
 * A rep still in progress when the clip ends is never counted.
 *
 * Rep boundaries: the hysteresis crossings sit part-way into the movement, so start and end
 * are refined to the standing level around the rep. Between two neighbouring bottoms (or the
 * clip edge) the standing level is the minimum depthNorm; `startFrame` is the last frame before
 * the descent crossing, and `endFrame` the first frame after the bottom, whose depthNorm is
 * within `onsetFrac` of that level. This also works when the lifter does not fully stand up
 * between reps.
 *
 * `Rep.depthNorm` is the rep's bottom depth relative to the deepest counted rep (deepest = 1).
 */
import { hipMid } from './calibration';
import type { PxTrack } from './smoothing';
import type { Calibration, Rep } from './types';

export const DEFAULTS = {
  /** standing -> descending when depthNorm rises above this. */
  enter: 0.15,
  /** ascending -> standing when depthNorm falls below this. */
  exit: 0.08,
  /** A rep's bottom must reach depthNorm above this, else it is a partial and not counted. */
  minBottom: 0.4,
  /** Debounce: consecutive frames needed to change state, and minimum frames per phase. */
  minStateFrames: 4,
  /** Start/end = frames within this depthNorm of the standing level around the rep. */
  onsetFrac: 0.02,
};

export type RepOptions = typeof DEFAULTS;

/** Spread that ignores keys explicitly set to undefined. */
function withDefaults<T extends object>(defaults: T, opts: Partial<T>): T {
  const out = { ...defaults };
  for (const [k, v] of Object.entries(opts)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/**
 * Per-frame clip-level depthNorm (null where the hip midpoint is unusable), or null when the
 * clip has no vertical hip motion below the standing height.
 */
export function depthNormSeries(
  track: PxTrack,
  calibration: Calibration,
): Array<number | null> | null {
  const ys = track.frames.map((f) => hipMid(f)?.y ?? null);
  let maxY = -Infinity;
  for (const y of ys) if (y !== null && y > maxY) maxY = y;
  const range = maxY - calibration.standingHipY;
  if (!(range > 0)) return null;
  return ys.map((y) => (y === null ? null : (y - calibration.standingHipY) / range));
}

interface RawRep {
  /** First frame of the debounced run above `enter`. */
  down: number;
  /** First frame of the debounced run below `exit`. */
  up: number;
  bottom: number;
}

/** Splits a clip into counted squat reps. Empty when calibration is null or nothing qualifies. */
export function segmentReps(
  track: PxTrack,
  calibration: Calibration | null,
  opts: Partial<RepOptions> = {},
): Rep[] {
  if (!calibration) return [];
  const o = withDefaults(DEFAULTS, opts);
  const d = depthNormSeries(track, calibration);
  if (!d) return [];
  const n = d.length;

  // Pass 1: hysteresis + debounce state machine.
  const raw: RawRep[] = [];
  let inRep = false;
  let runStart = -1;
  let runLen = 0;
  let down = -1;
  for (let i = 0; i < n; i++) {
    const v = d[i];
    if (v === null || v === undefined) {
      runLen = 0;
      continue;
    }
    const crossing = inRep ? v < o.exit : v > o.enter;
    if (!crossing) {
      runLen = 0;
      continue;
    }
    if (runLen === 0) runStart = i;
    runLen++;
    if (runLen < o.minStateFrames) continue;
    runLen = 0;
    if (!inRep) {
      inRep = true;
      down = runStart;
    } else {
      inRep = false;
      let bottom = down;
      for (let j = down; j < runStart; j++) {
        const dj = d[j];
        if (dj !== null && dj !== undefined && dj > d[bottom]!) bottom = j;
      }
      if (d[bottom]! > o.minBottom) raw.push({ down, up: runStart, bottom });
    }
  }

  // Pass 2: refine start/end to the standing level between neighbouring bottoms.
  const reps: Rep[] = [];
  for (let k = 0; k < raw.length; k++) {
    const r = raw[k]!;
    const prevBottom = k > 0 ? raw[k - 1]!.bottom : -1;
    const nextDown = k + 1 < raw.length ? raw[k + 1]!.down : n;
    const startFrame = lastNearLevel(d, prevBottom + 1, r.down, o.onsetFrac) ?? r.down;
    const endFrame = firstNearLevel(d, r.bottom + 1, nextDown, o.onsetFrac) ?? r.up;
    if (r.bottom - startFrame < o.minStateFrames || endFrame - r.bottom < o.minStateFrames) {
      continue;
    }
    reps.push({
      index: 0,
      startFrame,
      bottomFrame: r.bottom,
      endFrame,
      startT: track.frames[startFrame]!.t,
      bottomT: track.frames[r.bottom]!.t,
      endT: track.frames[endFrame]!.t,
      depthNorm: d[r.bottom]!,
    });
  }

  const deepest = reps.reduce((m, r) => Math.max(m, r.depthNorm), 0);
  return reps.map((r, index) => ({ ...r, index, depthNorm: r.depthNorm / deepest }));
}

/** Minimum non-null value of d over [from, to). */
function minIn(d: Array<number | null>, from: number, to: number): number | null {
  let m: number | null = null;
  for (let i = Math.max(0, from); i < Math.min(d.length, to); i++) {
    const v = d[i];
    if (v !== null && v !== undefined && (m === null || v < m)) m = v;
  }
  return m;
}

/** Last frame in [from, to] within `tol` of the minimum over that window. */
function lastNearLevel(
  d: Array<number | null>,
  from: number,
  to: number,
  tol: number,
): number | null {
  const level = minIn(d, from, to + 1);
  if (level === null) return null;
  for (let i = to; i >= from; i--) {
    const v = d[i];
    if (v !== null && v !== undefined && v <= level + tol) return i;
  }
  return null;
}

/** First frame in [from, to) within `tol` of the minimum over that window. */
function firstNearLevel(
  d: Array<number | null>,
  from: number,
  to: number,
  tol: number,
): number | null {
  const level = minIn(d, from, to);
  if (level === null) return null;
  for (let i = from; i < to; i++) {
    const v = d[i];
    if (v !== null && v !== undefined && v <= level + tol) return i;
  }
  return null;
}
