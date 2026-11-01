/**
 * MediaPipe Pose Landmarker indices (33 landmarks).
 * https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker#pose_landmarker_model
 *
 * "Left"/"right" are the subject's own sides, as MediaPipe labels them. From the ears (7/8)
 * down, odd = left and even = right; the eye points (1-6) do not follow that pattern.
 */
import type { Side } from './types';

export const NOSE = 0;
export const L_EYE_INNER = 1;
export const L_EYE = 2;
export const L_EYE_OUTER = 3;
export const R_EYE_INNER = 4;
export const R_EYE = 5;
export const R_EYE_OUTER = 6;
export const L_EAR = 7;
export const R_EAR = 8;
export const L_MOUTH = 9;
export const R_MOUTH = 10;
export const L_SHOULDER = 11;
export const R_SHOULDER = 12;
export const L_ELBOW = 13;
export const R_ELBOW = 14;
export const L_WRIST = 15;
export const R_WRIST = 16;
export const L_PINKY = 17;
export const R_PINKY = 18;
export const L_INDEX = 19;
export const R_INDEX = 20;
export const L_THUMB = 21;
export const R_THUMB = 22;
export const L_HIP = 23;
export const R_HIP = 24;
export const L_KNEE = 25;
export const R_KNEE = 26;
export const L_ANKLE = 27;
export const R_ANKLE = 28;
export const L_HEEL = 29;
export const R_HEEL = 30;
export const L_FOOT_INDEX = 31;
export const R_FOOT_INDEX = 32;

/** Number of landmarks in every non-null `PoseFrame.lm` / `PoseFrame.world`. */
export const NUM_LANDMARKS = 33;

export interface SideJoints {
  shoulder: number;
  elbow: number;
  wrist: number;
  hip: number;
  knee: number;
  ankle: number;
  heel: number;
  footIndex: number;
}

/** Per-side joint indices, so metric code can be written once for either leg. */
export const SIDE_JOINTS: Readonly<Record<Side, Readonly<SideJoints>>> = {
  left: {
    shoulder: L_SHOULDER,
    elbow: L_ELBOW,
    wrist: L_WRIST,
    hip: L_HIP,
    knee: L_KNEE,
    ankle: L_ANKLE,
    heel: L_HEEL,
    footIndex: L_FOOT_INDEX,
  },
  right: {
    shoulder: R_SHOULDER,
    elbow: R_ELBOW,
    wrist: R_WRIST,
    hip: R_HIP,
    knee: R_KNEE,
    ankle: R_ANKLE,
    heel: R_HEEL,
    footIndex: R_FOOT_INDEX,
  },
};
