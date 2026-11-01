export interface Lm { x: number; y: number; z: number; visibility: number; presence?: number }

/** One sampled video frame. lm = 33 normalized image landmarks, or null when no pose. */
export interface PoseFrame { t: number; lm: Lm[] | null; world: Lm[] | null }

/** Whole clip, as produced by src/pose or loaded from a fixture JSON. */
export interface PoseTrack {
  version: 1;
  width: number;            // source video pixels
  height: number;
  sampleHz: number;         // requested sample rate
  frames: PoseFrame[];      // t strictly increasing, ms
  meta?: { model?: 'lite' | 'full' | 'heavy'; delegate?: 'GPU' | 'CPU'; source?: string };
}

export type View = 'lateral' | 'frontal' | 'diagonal' | 'unknown';
export type Side = 'left' | 'right';
export type Confidence = 'low' | 'medium' | 'high';
export type NullReason = 'low_visibility' | 'wrong_view' | 'insufficient_frames' | 'no_reps';

export interface Metric<T> { value: T | null; confidence: Confidence | null; reason?: NullReason }

export interface ViewResult {
  view: View; side: Side | null;     // side = camera-facing side in lateral view
  ratio2d: number | null; yawDeg: number | null; confidence: Confidence | null;
}

export interface Rep {
  index: number;
  startFrame: number; bottomFrame: number; endFrame: number;
  startT: number; bottomT: number; endT: number;   // ms
  depthNorm: number;                                // 0 standing .. 1 deepest rep in set
}

export interface Calibration {
  standingFrames: number[];               // indices used
  femurPx: { left: number | null; right: number | null };
  standingHipY: number;                   // px
}

export type DepthClass = 'below' | 'parallel' | 'above' | 'borderline';
export interface DepthResult { delta: number; cls: DepthClass; thighAngleDeg: number; kneeFlexDeg: number }
export interface TrunkResult { trunkDeg: number; shinDeg: number; trunkMinusShinDeg: number }
export interface TempoResult { descentS: number; pauseS: number; ascentS: number; ascentHipVel: number }
export interface ValgusResult {
  fppaChangeDeg: { left: number | null; right: number | null };
  kneeAnkleRatioChange: number | null;    // (ratio_rep - ratio_standing)/ratio_standing; negative = knees closing
  flagged: boolean;
}
export interface AsymmetryResult { hipShiftNorm: number; hipHeightDiffNorm: number; kneeFlexDiffDeg: number | null; flagged: boolean }

export interface RepReport {
  rep: Rep;
  depth: Metric<DepthResult>; trunk: Metric<TrunkResult>; tempo: Metric<TempoResult>;
  valgus: Metric<ValgusResult>; asymmetry: Metric<AsymmetryResult>;
}

export interface QualityReport {
  ok: boolean;
  visibleFrac: number; effectiveFps: number; cutOff: boolean; tiltedCamera: boolean;
  problems: Array<'low_visibility' | 'low_fps' | 'cut_off' | 'no_pose' | 'diagonal_view' | 'tilted_camera'>;
}

export interface SetReport {
  version: 1;
  quality: QualityReport; view: ViewResult; calibration: Calibration | null;
  reps: RepReport[];
  velocityLoss: Metric<number>;           // 1 - v_last/v_first (hip, not bar)
  cues: Cue[];
}

export type CueId = string;               // e.g. 'depth.below', 'valgus.flag'
export interface Cue { id: CueId; repIndex: number | null; severity: 'info' | 'warn'; params: Record<string, number | string> }
