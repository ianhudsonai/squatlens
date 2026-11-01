/**
 * Rep segmentation (SPEC §5.4), offline.
 *
 * Signal: smoothed hip-mid y in pixels (y grows downward). Over the whole clip,
 *   depthNorm(i) = (y_i - standingHipY) / (maxY - standingHipY)
 * so 0 is the calibrated standing height and 1 the lowest hip position in the clip. Frames
 * without a usable hip midpoint have no depthNorm and never count toward a debounce run.
 *
 * State machine with hysteresis and debounce (a run must last `minStateFrames` consecutive
 * frames and span at least `minStateMs`):
 *   - standing -> descending once depthNorm > `enter` for a debounce run;
 *   - descending -> bottom -> ascending: the bottom is the frame of max hip y between the
 *     descent and the return (this is offline, so the whole rep is known before the bottom
 *     is chosen; a bounce mid-rep stays one rep);
 *   - ascending -> standing once depthNorm < `exit` for a debounce run.
 *     Only then is the rep counted, and only if its bottom reached depthNorm > `minBottom`
 *     and both the descent and the ascent span at least `minStateFrames` frames.
 * A rep still in progress when the clip ends is never counted.
 *
 * Rep boundaries: the hysteresis crossings sit part-way into the movement, so start and end
 * are refined to the standing level around the rep. The level before a rep is the minimum
 * depthNorm in the `levelWindowMs` before the descent crossing (never reaching back past the
 * previous bottom); the level after is the minimum in the `levelWindowMs` after the return
 * crossing (never past the next descent crossing). `startFrame` is the last frame before the
 * descent crossing, and `endFrame` the first frame after the bottom, whose depthNorm is within
 * `onsetFrac` of that level. Bounding the windows keeps an unrack or re-rack seconds away from
 * the rep from becoming its boundary. This also works when the lifter does not fully stand up
 * between reps.
 *
 * `Rep.depthNorm` is the rep's bottom depth relative to the deepest counted rep (deepest = 1).
 */
import { withDefaults } from './options';
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
  /** Time floor for the same debounce, ms, so it still means something at 120+ fps. */
  minStateMs: 100,
  /** Start/end = frames within this depthNorm of the standing level around the rep. */
  onsetFrac: 0.02,
  /** The standing level is looked for at most this long before/after the crossings, ms. */
  levelWindowMs: 1500,
};

export type RepOptions = typeof DEFAULTS;

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
    const spanMs = track.frames[i]!.t - track.frames[runStart]!.t;
    if (runLen < o.minStateFrames || spanMs < o.minStateMs) continue;
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

  // Pass 2: refine start/end to the standing level next to each rep.
  const t = (i: number) => track.frames[i]!.t;
  const reps: Rep[] = [];
  for (let k = 0; k < raw.length; k++) {
    const r = raw[k]!;
    let from = k > 0 ? raw[k - 1]!.bottom + 1 : 0;
    while (from < r.down && t(r.down) - t(from) > o.levelWindowMs) from++;
    let to = r.up;
    const nextDown = k + 1 < raw.length ? raw[k + 1]!.down : n;
    while (to + 1 < nextDown && t(to + 1) - t(r.up) <= o.levelWindowMs) to++;
    // Both windows contain a frame with a value (r.down; r.up), so these never return null.
    const startFrame = nearLevel(d, from, r.down, minIn(d, from, r.down)!, o.onsetFrac, 'last')!;
    const endFrame = nearLevel(d, r.bottom + 1, to, minIn(d, r.up, to)!, o.onsetFrac, 'first')!;
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

/** Minimum non-null value of d over [from, to] (inclusive). */
function minIn(d: Array<number | null>, from: number, to: number): number | null {
  let m: number | null = null;
  for (let i = Math.max(0, from); i <= Math.min(d.length - 1, to); i++) {
    const v = d[i];
    if (v !== null && v !== undefined && (m === null || v < m)) m = v;
  }
  return m;
}

/** First or last frame in [from, to] whose value is within `tol` of `level`. */
function nearLevel(
  d: Array<number | null>,
  from: number,
  to: number,
  level: number,
  tol: number,
  which: 'first' | 'last',
): number | null {
  const ok = (i: number) => {
    const v = d[i];
    return v !== null && v !== undefined && v <= level + tol;
  };
  if (which === 'first') {
    for (let i = from; i <= to; i++) if (ok(i)) return i;
  } else {
    for (let i = to; i >= from; i--) if (ok(i)) return i;
  }
  return null;
}
