/**
 * Tempo per rep and set-level velocity loss (SPEC §5.7). All durations come from frame
 * timestamps `t`, never from frame counts, so variable or unusual frame rates are handled.
 *
 * Within one rep, with hip-mid y in pixels and the rep's own depth
 *   p(i) = (y_i - standingHipY) / (y_bottom - standingHipY):
 *   - descent: `startFrame` -> first frame with p >= 1 - `nearBottomFrac` (within 3% of the
 *     bottom depth);
 *   - pause: the run of frames around `bottomFrame` whose |hip vertical velocity| is below
 *     `pauseVelFrac` of the rep's peak, clipped so it starts no earlier than the descent end.
 *     Empty (0 s) when the bottom frame itself is moving;
 *   - ascent: end of the pause -> `endFrame`.
 * The phases need not add up to the rep's duration: the slow approach between the 97% mark
 * and the first still frame belongs to none of them.
 *
 * Hip velocity is a central difference over the nearest usable frames at least
 * `velHalfWindowMs` away on each side (about one frame at 24-30 fps, three at 60 fps), which
 * keeps the 5% threshold meaningful at high frame rates.
 *
 * `ascentHipVel` = net hip rise during the ascent / ascent time, in standing femur lengths
 * per second (mean of the available `femurPx` sides). This is hip speed, not bar speed.
 */
import { hipMid } from '../calibration';
import type { PxTrack } from '../smoothing';
import type { Calibration, Confidence, Metric, Rep, TempoResult } from '../types';

export const DEFAULTS = {
  /** Descent ends at the first frame within this fraction of the bottom depth. */
  nearBottomFrac: 0.03,
  /** Pause = frames near the bottom with |hip velocity| below this fraction of the peak. */
  pauseVelFrac: 0.05,
  /** Half-width of the velocity difference window, ms. */
  velHalfWindowMs: 40,
  /** Minimum usable hip frames in a rep to report tempo at all. */
  minFrames: 8,
  /** Confidence: share of rep frames with a usable hip, and usable frames per second. */
  highCoverage: 0.95,
  highHz: 24,
  mediumCoverage: 0.8,
  mediumHz: 15,
};

export type TempoOptions = typeof DEFAULTS;

/** Spread that ignores keys explicitly set to undefined. */
function withDefaults<T extends object>(defaults: T, opts: Partial<T>): T {
  const out = { ...defaults };
  for (const [k, v] of Object.entries(opts)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** Mean of the available standing femur lengths, px, or null. */
function femurPx(calibration: Calibration): number | null {
  const ls = [calibration.femurPx.left, calibration.femurPx.right].filter(
    (v): v is number => v !== null && v > 0,
  );
  return ls.length ? ls.reduce((a, b) => a + b, 0) / ls.length : null;
}

/** Tempo of one rep. Null with a reason when the rep cannot be timed. */
export function tempo(
  track: PxTrack,
  rep: Rep,
  calibration: Calibration | null,
  opts: Partial<TempoOptions> = {},
): Metric<TempoResult> {
  const o = withDefaults(DEFAULTS, opts);
  const femur = calibration ? femurPx(calibration) : null;
  if (!calibration || femur === null) {
    return { value: null, confidence: null, reason: 'low_visibility' };
  }

  const frames = track.frames;
  // Usable hip samples inside the rep, in order.
  const idx: number[] = [];
  const ys: number[] = [];
  const ts: number[] = [];
  for (let i = rep.startFrame; i <= rep.endFrame; i++) {
    const h = hipMid(frames[i]!);
    if (!h) continue;
    idx.push(i);
    ys.push(h.y);
    ts.push(frames[i]!.t);
  }
  const iStart = idx.indexOf(rep.startFrame);
  const iBottom = idx.indexOf(rep.bottomFrame);
  const iEnd = idx.indexOf(rep.endFrame);
  const total = rep.endFrame - rep.startFrame + 1;
  if (idx.length < o.minFrames || iStart < 0 || iBottom < 0 || iEnd < 0) {
    return { value: null, confidence: null, reason: 'insufficient_frames' };
  }
  const durS = (ts[iEnd]! - ts[iStart]!) / 1000;
  const bottomDepth = ys[iBottom]! - calibration.standingHipY;
  if (!(durS > 0) || !(bottomDepth > 0)) {
    return { value: null, confidence: null, reason: 'insufficient_frames' };
  }

  // Descent end: first sample within nearBottomFrac of the bottom depth.
  const target = (1 - o.nearBottomFrac) * bottomDepth;
  let iDescEnd = iBottom;
  for (let k = iStart; k <= iBottom; k++) {
    if (ys[k]! - calibration.standingHipY >= target) {
      iDescEnd = k;
      break;
    }
  }

  // Hip vertical velocity, px/s.
  const vel = ys.map((_, k) => {
    let a = k;
    while (a > 0 && ts[k]! - ts[a]! < o.velHalfWindowMs) a--;
    let b = k;
    while (b < ys.length - 1 && ts[b]! - ts[k]! < o.velHalfWindowMs) b++;
    return b > a ? ((ys[b]! - ys[a]!) / (ts[b]! - ts[a]!)) * 1000 : 0;
  });
  const peak = vel.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const still = (k: number) => Math.abs(vel[k]!) < o.pauseVelFrac * peak;

  let iPauseStart = iBottom;
  let iPauseEnd = iBottom;
  if (still(iBottom)) {
    while (iPauseStart > iStart && still(iPauseStart - 1)) iPauseStart--;
    while (iPauseEnd < iEnd && still(iPauseEnd + 1)) iPauseEnd++;
  }
  iPauseStart = Math.max(iPauseStart, iDescEnd);
  iPauseEnd = Math.max(iPauseEnd, iPauseStart);

  const descentS = (ts[iDescEnd]! - ts[iStart]!) / 1000;
  const pauseS = (ts[iPauseEnd]! - ts[iPauseStart]!) / 1000;
  const ascentS = (ts[iEnd]! - ts[iPauseEnd]!) / 1000;
  const ascentHipVel = ascentS > 0 ? (ys[iPauseEnd]! - ys[iEnd]!) / ascentS / femur : 0;

  const coverage = idx.length / total;
  const hz = (idx.length - 1) / durS;
  let confidence: Confidence = 'low';
  if (coverage >= o.highCoverage && hz >= o.highHz) confidence = 'high';
  else if (coverage >= o.mediumCoverage && hz >= o.mediumHz) confidence = 'medium';

  return { value: { descentS, pauseS, ascentS, ascentHipVel }, confidence };
}

const CONF_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

/**
 * Set-level velocity loss `1 - v_last / v_first` from per-rep tempo, in rep order, where v is
 * `ascentHipVel` (hip speed, not bar speed). Uses the first and last reps that have a tempo
 * value. Null with `no_reps` for an empty set, `insufficient_frames` when fewer than two reps
 * have a usable tempo. Confidence is the lower of the two reps' confidences.
 */
export function velocityLoss(tempos: ReadonlyArray<Metric<TempoResult>>): Metric<number> {
  if (tempos.length === 0) return { value: null, confidence: null, reason: 'no_reps' };
  const timed = tempos.filter((m) => m.value !== null && m.value.ascentHipVel > 0);
  if (timed.length < 2) return { value: null, confidence: null, reason: 'insufficient_frames' };
  const first = timed[0]!;
  const last = timed[timed.length - 1]!;
  const c1 = first.confidence ?? 'low';
  const c2 = last.confidence ?? 'low';
  return {
    value: 1 - last.value!.ascentHipVel / first.value!.ascentHipVel,
    confidence: CONF_RANK[c1] <= CONF_RANK[c2] ? c1 : c2,
  };
}
