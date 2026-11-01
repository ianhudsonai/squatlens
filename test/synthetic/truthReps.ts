/**
 * Ground-truth `Rep` objects for a synthetic track, built from `repSchedule` (bottom frame =
 * the generator's known bottom). Times are the frames' own `t`; `depthNorm` is relative to
 * the deepest rep, like the real detector (SPEC §5.4). Lets metric tests run without the rep detector.
 */
import type { Rep } from '../../src/core/types';
import { repSchedule, resolveOptions } from './makeSquatTrack';
import type { SquatOptions } from './makeSquatTrack';

export function truthReps(opts: Partial<SquatOptions> = {}): Rep[] {
  const o = resolveOptions(opts);
  const frame = (t: number) => Math.round((t * o.fps) / 1000);
  const time = (i: number) => (i * 1000) / o.fps; // same t as the generator's frames
  const schedule = repSchedule(o);
  const scale = schedule.map((_, i) => o.repDepthScale[i] ?? 1);
  const deepest = Math.max(...scale);
  return schedule.map((r, index) => {
    const startFrame = frame(r.startT);
    const bottomFrame = frame(r.bottomStartT);
    const endFrame = frame(r.endT);
    return {
      index,
      startFrame,
      bottomFrame,
      endFrame,
      startT: time(startFrame),
      bottomT: time(bottomFrame),
      endT: time(endFrame),
      depthNorm: deepest > 0 ? scale[index]! / deepest : 0,
    };
  });
}
