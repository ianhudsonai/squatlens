/**
 * Pure helpers for turning sampled detections into a PoseTrack (SPEC §3, §4).
 * No DOM, no MediaPipe import, so they can be unit-tested in Node.
 */
import type { Lm, PoseFrame, PoseTrack } from '../core/types';

/** Minimal shape of a MediaPipe landmark (NormalizedLandmark / Landmark). */
export interface RawLandmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
  presence?: number;
}

/** Minimal shape of a PoseLandmarkerResult, so tests can mock it. */
export interface RawPoseResult {
  landmarks: RawLandmark[][];
  worldLandmarks: RawLandmark[][];
}

/**
 * Sample times in seconds: 0, 1/hz, 2/hz, ... strictly below `durationS`.
 * The effective rate is `min(sampleHz, nativeFps)` when the native rate is known, so we
 * never sample the same decoded frame twice.
 */
export function sampleTimes(durationS: number, sampleHz: number, nativeFps?: number): number[] {
  if (!Number.isFinite(durationS) || durationS <= 0) return [];
  if (!Number.isFinite(sampleHz) || sampleHz <= 0) {
    throw new RangeError(`sampleHz must be a positive number, got ${sampleHz}`);
  }
  const hz =
    nativeFps && Number.isFinite(nativeFps) && nativeFps > 0
      ? Math.min(sampleHz, nativeFps)
      : sampleHz;
  const count = Math.ceil(durationS * hz - 1e-9);
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(i / hz);
  return out;
}

/**
 * Integer millisecond timestamps for `detectForVideo`, strictly increasing as MediaPipe
 * requires in VIDEO mode. Rounding collisions are bumped by 1 ms.
 */
export function toTimestampsMs(timesS: readonly number[]): number[] {
  const out: number[] = [];
  let last = -Infinity;
  for (const s of timesS) {
    let ms = Math.round(s * 1000);
    if (ms <= last) ms = last + 1;
    out.push(ms);
    last = ms;
  }
  return out;
}

function toLm(raw: RawLandmark): Lm {
  const lm: Lm = { x: raw.x, y: raw.y, z: raw.z, visibility: raw.visibility ?? 0 };
  if (raw.presence !== undefined) lm.presence = raw.presence;
  return lm;
}

/** First detected pose (numPoses = 1) or nulls when nothing was found. */
export function toPoseFrame(t: number, result: RawPoseResult | null | undefined): PoseFrame {
  const lm = result?.landmarks[0];
  const world = result?.worldLandmarks[0];
  return {
    t,
    lm: lm && lm.length > 0 ? lm.map(toLm) : null,
    world: world && world.length > 0 ? world.map(toLm) : null,
  };
}

export function buildTrack(args: {
  width: number;
  height: number;
  sampleHz: number;
  frames: PoseFrame[];
  meta?: PoseTrack['meta'];
}): PoseTrack {
  const track: PoseTrack = {
    version: 1,
    width: args.width,
    height: args.height,
    sampleHz: args.sampleHz,
    frames: args.frames,
  };
  if (args.meta) track.meta = args.meta;
  return track;
}

/** Index of the frame whose `t` is closest to `tMs` (frames sorted by t), or -1 if empty. */
export function nearestFrameIndex(frames: readonly PoseFrame[], tMs: number): number {
  if (frames.length === 0) return -1;
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid]!.t < tMs) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(frames[lo - 1]!.t - tMs) <= Math.abs(frames[lo]!.t - tMs)) return lo - 1;
  return lo;
}
