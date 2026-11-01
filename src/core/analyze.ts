/**
 * Set orchestrator (SPEC §5.11): one call from a raw `PoseTrack` to a `SetReport`.
 *
 *   preprocess -> calibrate -> detectView -> assessQuality -> segmentReps
 *     -> per-rep metrics enabled by the view -> velocityLoss -> generateCues
 *
 * - Metrics the view does not enable (`metricsForView`) are
 *   `{ value: null, confidence: null, reason: 'wrong_view' }`.
 * - Lateral metrics need the camera side from `detectView`; with no side they are null with
 *   `low_visibility`. Frontal metrics and depth/trunk need a calibration; reps already do, so
 *   a null calibration means no reps.
 * - Reps and metrics are still computed when `quality.ok` is false (useful in the exported
 *   JSON for debugging), but `quality.ok` stays authoritative: the UI hides them, and
 *   `generateCues` emits only quality/view cues.
 *
 * Pure and deterministic: no clock, no randomness, no I/O. The result contains only plain
 * objects, arrays, strings, finite numbers, booleans and null, so it round-trips through JSON.
 */
import { calibrate } from './calibration';
import type { CalibrationOptions } from './calibration';
import { generateCues } from './cues/generate';
import type { CueOptions } from './cues/generate';
import { asymmetry } from './metrics/asymmetry';
import type { AsymmetryOptions } from './metrics/asymmetry';
import { depth } from './metrics/depth';
import type { DepthOptions } from './metrics/depth';
import { tempo, velocityLoss } from './metrics/tempo';
import type { TempoOptions } from './metrics/tempo';
import { trunk } from './metrics/trunk';
import type { TrunkOptions } from './metrics/trunk';
import { valgus } from './metrics/valgus';
import type { ValgusOptions } from './metrics/valgus';
import { assessQuality } from './quality';
import type { QualityOptions } from './quality';
import { segmentReps } from './reps';
import type { RepOptions } from './reps';
import { preprocess } from './smoothing';
import type { PreprocessOptions } from './smoothing';
import type { Metric, PoseTrack, RepReport, SetReport } from './types';
import { detectView, metricsForView } from './view';
import type { ViewOptions } from './view';

/** Per-stage overrides; every field is optional and falls back to that module's `DEFAULTS`. */
export interface AnalyzeOptions {
  preprocess?: PreprocessOptions;
  calibration?: Partial<CalibrationOptions>;
  view?: Partial<ViewOptions>;
  quality?: Partial<QualityOptions>;
  reps?: Partial<RepOptions>;
  depth?: Partial<DepthOptions>;
  trunk?: Partial<TrunkOptions>;
  tempo?: Partial<TempoOptions>;
  valgus?: Partial<ValgusOptions>;
  asymmetry?: Partial<AsymmetryOptions>;
  cues?: Partial<CueOptions>;
}

const WRONG_VIEW = { value: null, confidence: null, reason: 'wrong_view' } as const;
const NO_SIDE = { value: null, confidence: null, reason: 'low_visibility' } as const;

/** A fresh disabled-metric object per use, so reports never share mutable references. */
function disabled<T>(): Metric<T> {
  return { ...WRONG_VIEW };
}

/** Analyzes one set. See the file header. */
export function analyzeSet(track: PoseTrack, opts: AnalyzeOptions = {}): SetReport {
  const px = preprocess(track, opts.preprocess);
  const calibration = calibrate(px, opts.calibration);
  const view = detectView(px, calibration, opts.view);
  const quality = assessQuality(px, view, calibration, opts.quality);
  const repList = segmentReps(px, calibration, opts.reps);
  const enabled = metricsForView(view.view);
  const side = view.side;

  const reps: RepReport[] = repList.map((rep) => {
    // segmentReps returns [] without a calibration, so it is non-null here.
    const cal = calibration!;
    return {
      rep,
      depth: !enabled.depth
        ? disabled()
        : side
          ? depth(px, rep, cal, side, opts.depth)
          : { ...NO_SIDE },
      trunk: !enabled.trunk
        ? disabled()
        : side
          ? trunk(px, rep, cal, side, opts.trunk)
          : { ...NO_SIDE },
      tempo: enabled.tempo ? tempo(px, rep, cal, opts.tempo) : disabled(),
      valgus: enabled.valgus ? valgus(px, rep, cal, opts.valgus) : disabled(),
      asymmetry: enabled.asymmetry ? asymmetry(px, rep, cal, opts.asymmetry) : disabled(),
    };
  });

  const report: SetReport = {
    version: 1,
    quality,
    view,
    calibration,
    reps,
    velocityLoss: velocityLoss(reps.map((r) => r.tempo)),
    cues: [],
  };
  // The trunk and asymmetry thresholds the cues reuse follow those modules' overrides.
  report.cues = generateCues(report, {
    forwardLeanDeg: opts.trunk?.forwardLeanHintDeg,
    hipShiftFlag: opts.asymmetry?.hipShiftFlag,
    ...opts.cues,
  });
  return report;
}
