import type { CueMessages } from './types';

export const en: CueMessages = {
  decimal: '.',
  cues: {
    'quality.no_pose': 'No person detected in the video: film your whole body in good light.',
    'quality.low_visibility':
      'Poor lighting or framing: film again with your whole body visible and good light.',
    'quality.low_fps':
      'Too few usable frames per second: film with more light or at a higher frame rate.',
    'quality.cut_off':
      'Part of your body left the frame: move the camera back to fit head to feet.',
    'quality.tilted_camera':
      'The camera looks tilted: hold the phone level for a better trunk reading.',
    'view.diagonal': 'Camera at a diagonal: film from the side (depth) or the front (knees).',
    'view.unknown':
      "Couldn't tell the camera angle: film from the side (depth) or the front (knees).",
    'nodata.reps': 'No complete rep detected.',
    'nodata.depth': 'Not enough data for depth.',
    'nodata.trunk': 'Not enough data for the trunk.',
    'nodata.tempo': 'Not enough data for tempo.',
    'nodata.valgus': 'Not enough data for the knees.',
    'nodata.asymmetry': 'Not enough data for asymmetry.',
    'depth.below': 'Good depth: your hip went below the knee line.',
    'depth.parallel': 'Right at parallel.',
    'depth.borderline': 'Close to the parallel line, hard to call from the camera.',
    'depth.above': 'Almost there: go a little deeper.',
    'trunk.forward': 'Trunk much more inclined than your shin: try to open your chest.',
    'valgus.flag':
      'Your knees tended to cave in ({conf} confidence): think about pushing the floor apart.',
    'asym.shift': 'Your hips shifted to the {side} at the bottom.',
    'asym.uneven': 'Your two sides were uneven at the bottom: one side sank more than the other.',
    'tempo.fast_descent': 'Fast descent: try to control it more.',
    'tempo.summary': 'Down in {d} s and up in {a} s.',
    'fatigue.loss': 'Your ascent speed dropped {pct}% from the first to the last rep.',
  },
  values: {
    conf: { low: 'low', medium: 'medium', high: 'high' },
    side: { left: 'left', right: 'right' },
  },
};
