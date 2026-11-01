// Public barrel for src/core. After T1 this file is edited only by the analyzeSet ticket (T8).
// Every module exports its own `DEFAULTS`; they are re-exported here under module-prefixed
// names so they can be tuned (e.g. by eval/) without colliding.
export * from './types';
export * from './landmarks';

export { analyzeSet } from './analyze';
export type { AnalyzeOptions } from './analyze';
export * from './cues';

export { withDefaults } from './options';
export { DEFAULTS as GEOMETRY_DEFAULTS, toPx, usable } from './geometry';
export type { Px, UsableOptions } from './geometry';
export { DEFAULTS as SMOOTHING_DEFAULTS, preprocess } from './smoothing';
export type { PreprocessOptions, PxFrame, PxPoint, PxTrack, SmoothingOptions } from './smoothing';
export { DEFAULTS as CALIBRATION_DEFAULTS, calibrate } from './calibration';
export type { CalibrationOptions } from './calibration';
export { DEFAULTS as VIEW_DEFAULTS, detectView, metricsForView } from './view';
export type { MetricName, ViewOptions } from './view';
export { DEFAULTS as QUALITY_DEFAULTS, assessQuality } from './quality';
export type { QualityOptions } from './quality';
export { DEFAULTS as REP_DEFAULTS, depthNormSeries, segmentReps } from './reps';
export type { RepOptions } from './reps';
export { DEFAULTS as DEPTH_DEFAULTS, classifyDepth, depth } from './metrics/depth';
export type { DepthOptions } from './metrics/depth';
export { DEFAULTS as TRUNK_DEFAULTS, trunk } from './metrics/trunk';
export type { TrunkOptions } from './metrics/trunk';
export { DEFAULTS as TEMPO_DEFAULTS, tempo, velocityLoss } from './metrics/tempo';
export type { TempoOptions } from './metrics/tempo';
export { DEFAULTS as VALGUS_DEFAULTS, valgus } from './metrics/valgus';
export type { ValgusOptions } from './metrics/valgus';
export { DEFAULTS as ASYMMETRY_DEFAULTS, asymmetry } from './metrics/asymmetry';
export type { AsymmetryOptions } from './metrics/asymmetry';
