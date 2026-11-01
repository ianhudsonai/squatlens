import { describe, expect, it } from 'vitest';
import * as lm from './landmarks';
import type { PoseTrack } from './types';

const indexConstants = Object.entries(lm as Record<string, unknown>).filter(
  (entry): entry is [string, number] =>
    typeof entry[1] === 'number' && entry[0] !== 'NUM_LANDMARKS',
);

describe('landmarks', () => {
  it('defines one unique constant for each of the 33 MediaPipe indices', () => {
    const values = indexConstants.map(([, v]) => v).sort((a, b) => a - b);
    expect(values).toEqual(Array.from({ length: lm.NUM_LANDMARKS }, (_, i) => i));
  });

  it('uses odd indices for the left side and even for the right (ears down)', () => {
    for (const [name, value] of indexConstants) {
      if (name.includes('EYE')) continue; // eyes 1-6 are grouped per side, not alternating
      if (name.startsWith('L_') || name.endsWith('_L')) expect(value % 2, name).toBe(1);
      if (name.startsWith('R_') || name.endsWith('_R')) expect(value % 2, name).toBe(0);
    }
  });

  it('maps SIDE_JOINTS to the matching side constants', () => {
    expect(lm.SIDE_JOINTS.left.hip).toBe(lm.L_HIP);
    expect(lm.SIDE_JOINTS.right.knee).toBe(lm.R_KNEE);
    expect(lm.SIDE_JOINTS.left.ankle % 2).toBe(1);
    expect(lm.SIDE_JOINTS.right.ankle % 2).toBe(0);
  });

  it('accepts a minimal PoseTrack literal (type contract smoke test)', () => {
    const track: PoseTrack = {
      version: 1,
      width: 1080,
      height: 1920,
      sampleHz: 30,
      frames: [{ t: 0, lm: null, world: null }],
    };
    expect(track.frames).toHaveLength(1);
  });
});
