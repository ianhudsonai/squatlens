/**
 * Tempo per rep and set-level velocity loss (SPEC §5.7). All durations come from frame
 * timestamps `t`, never from frame counts, so variable or unusual frame rates are handled.
 *
 * Within one rep, with hip-mid y in pixels and the rep's own depth
 *   p(i) = (y_i - standingHipY) / (y_bottom - standingHipY),
 * the bottom hold is the run of usable samples around the bottom (the lowest usable sample)
 * that are both near the bottom (p >= 1 - `nearBottomFrac`, i.e. within 3%) and still
 * (|hip vertical velocity| < `pauseVelFrac` of the rep's peak). It is empty when the bottom
 * itself is moving (a bounce). Then
 *   - descent: rep start -> start of the hold (or the bottom),
 *   - pause: the hold,
 *   - ascent: end of the hold -> rep end,
 * so descent + pause + ascent always equals the rep's duration. When the lifter pauses, the
 * descent ends where SPEC §5.7 puts it (first frame within 3% of the bottom depth); when they
 * keep moving through the 3% band, that slow approach counts as descent rather than pause.
 * Start, bottom and end use the nearest usable samples, so a single frame with an unusable
 * hip does not drop the rep.
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
  /** The bottom hold only includes samples within this fraction of the bottom depth. */
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
  const total = rep.endFrame - rep.startFrame + 1;
  if (idx.length < o.minFrames) {
    return { value: null, confidence: null, reason: 'insufficient_frames' };
  }
  const iStart = 0;
  const iEnd = idx.length - 1;
  let iBottom = 0;
  for (let k = 1; k < ys.length; k++) if (ys[k]! > ys[iBottom]!) iBottom = k;
  const durS = (ts[iEnd]! - ts[iStart]!) / 1000;
  const bottomDepth = ys[iBottom]! - calibration.standingHipY;
  if (!(durS > 0) || !(bottomDepth > 0)) {
    return { value: null, confidence: null, reason: 'insufficient_frames' };
  }

  // Hip vertical velocity, px/s: central difference between the nearest samples at least
  // velHalfWindowMs away (clamped at the rep edges). Both pointers only move forward.
  const vel: number[] = [];
  let a = 0;
  let b = 0;
  for (let k = 0; k < ys.length; k++) {
    while (a < k && ts[k]! - ts[a + 1]! >= o.velHalfWindowMs) a++;
    b = Math.max(b, k);
    while (b < ys.length - 1 && ts[b]! - ts[k]! < o.velHalfWindowMs) b++;
    vel.push(b > a ? ((ys[b]! - ys[a]!) / (ts[b]! - ts[a]!)) * 1000 : 0);
  }
  const peak = vel.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const nearDepth = (1 - o.nearBottomFrac) * bottomDepth;
  const held = (k: number) =>
    Math.abs(vel[k]!) < o.pauseVelFrac * peak && ys[k]! - calibration.standingHipY >= nearDepth;

  let iPauseStart = iBottom;
  let iPauseEnd = iBottom;
  if (held(iBottom)) {
    while (iPauseStart > iStart && held(iPauseStart - 1)) iPauseStart--;
    while (iPauseEnd < iEnd && held(iPauseEnd + 1)) iPauseEnd++;
  }

  const descentS = (ts[iPauseStart]! - ts[iStart]!) / 1000;
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
 * `ascentHipVel` (hip speed, not bar speed). Strictly the set's first and last reps: if either
 * has no tempo the result is null with that rep's reason, rather than silently comparing other
 * reps. Null with `no_reps` for an empty set and `insufficient_frames` for a single rep or a
 * non-positive first speed. Confidence is the lower of the two reps' confidences.
 */
export function velocityLoss(tempos: ReadonlyArray<Metric<TempoResult>>): Metric<number> {
  if (tempos.length === 0) return { value: null, confidence: null, reason: 'no_reps' };
  if (tempos.length < 2) return { value: null, confidence: null, reason: 'insufficient_frames' };
  const first = tempos[0]!;
  const last = tempos[tempos.length - 1]!;
  for (const m of [first, last]) {
    if (m.value === null) {
      return { value: null, confidence: null, reason: m.reason ?? 'insufficient_frames' };
    }
  }
  if (!(first.value!.ascentHipVel > 0)) {
    return { value: null, confidence: null, reason: 'insufficient_frames' };
  }
  const c1 = first.confidence ?? 'low';
  const c2 = last.confidence ?? 'low';
  return {
    value: 1 - last.value!.ascentHipVel / first.value!.ascentHipVel,
    confidence: CONF_RANK[c1] <= CONF_RANK[c2] ? c1 : c2,
  };
}
