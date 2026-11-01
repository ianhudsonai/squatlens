import { hipMid } from '../core/calibration';
import { preprocess } from '../core/smoothing';
import type { PoseTrack } from '../core/types';

export interface HipPoint {
  t: number; // ms
  y: number | null; // px, image y grows downward
}

/** Hip-mid y per sampled frame, from the same pre-processed track the analysis uses. */
export function hipSeries(track: PoseTrack): HipPoint[] {
  return preprocess(track).frames.map((f) => ({ t: f.t, y: hipMid(f)?.y ?? null }));
}
