/**
 * Ground-truth `Rep` objects for a synthetic track, built from `repSchedule` (bottom frame =
 * the generator's known bottom). Lets metric tests run without the rep detector.
 */
import type { Rep } from '../../src/core/types';
import { repSchedule, resolveOptions } from './makeSquatTrack';
import type { SquatOptions } from './makeSquatTrack';

export function truthReps(opts: Partial<SquatOptions> = {}): Rep[] {
  const { fps } = resolveOptions(opts);
  const frame = (t: number) => Math.round((t * fps) / 1000);
  return repSchedule(opts).map((r, index) => ({
    index,
    startFrame: frame(r.startT),
    bottomFrame: frame(r.bottomStartT),
    endFrame: frame(r.endT),
    startT: r.startT,
    bottomT: r.bottomStartT,
    endT: r.endT,
    depthNorm: opts.repDepthScale?.[index] ?? 1,
  }));
}
