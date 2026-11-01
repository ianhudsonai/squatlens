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
      if (name.startsWith('L_')) expect(value % 2, name).toBe(1);
      if (name.startsWith('R_')) expect(value % 2, name).toBe(0);
    }
  });

  it('maps every SIDE_JOINTS field to the matching side constant', () => {
    const constants = lm as unknown as Record<string, number>;
    for (const side of ['left', 'right'] as const) {
      const prefix = side === 'left' ? 'L_' : 'R_';
      for (const [joint, index] of Object.entries(lm.SIDE_JOINTS[side])) {
        // footIndex -> FOOT_INDEX
        const name = prefix + joint.replace(/([A-Z])/g, '_$1').toUpperCase();
        expect(constants[name], `${side}.${joint} -> ${name}`).toBeTypeOf('number');
        expect(index, `${side}.${joint}`).toBe(constants[name]);
      }
    }
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
