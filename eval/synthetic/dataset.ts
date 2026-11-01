/**
 * Labelled synthetic eval set (`npm run eval -- --synthetic`), built with the T3 generator so
 * the harness runs end to end before real clips exist.
 *
 * Labels are ground truth from the generator, not human judgement:
 * - depth: at the bottom the thigh is `thighDeg = 90 - scale * (90 - depth)` degrees from
 *   horizontal (scale = `repDepthScale[i]`, default 1), so the hip sits `sin(thighDeg)` femur
 *   lengths above the knee, i.e. delta = -sin(thighDeg). Labelled with the SPEC §5.5 edges
 *   (±0.05) and no borderline band, the way a person has to pick one of three classes.
 * - valgus: `yes` when the generator caves the knees by more than `VALGUS_YES_DEG`, `no`
 *   otherwise; `na` for lateral clips.
 *
 * This checks that the pipeline and harness agree with geometry they were designed around;
 * it says nothing about accuracy on real people (that needs ian's labelled clips, #13).
 */
import { DEPTH_DEFAULTS } from '../../src/core';
import type { PoseTrack } from '../../src/core';
import { makeSquatTrack, resolveOptions } from '../../test/synthetic/makeSquatTrack';
import type { SquatOptions } from '../../test/synthetic/makeSquatTrack';
import type { DepthLabel, LabelRow, ValgusLabel } from '../labels';

/** Knee cave (degrees) above which a synthetic rep is labelled valgus `yes`. */
export const VALGUS_YES_DEG = 8;
const PARALLEL_BAND = DEPTH_DEFAULTS.parallelBand;

export interface SyntheticClip {
  clipId: string;
  options: Partial<SquatOptions>;
  note: string;
}

export const SYNTHETIC_CLIPS: readonly SyntheticClip[] = [
  {
    clipId: 'syn-lateral-deep',
    options: { view: 'lateral', side: 'left', depth: -15, noise: 1.5, seed: 11 },
    note: 'deep, left side',
  },
  {
    clipId: 'syn-lateral-parallel',
    options: { view: 'lateral', side: 'right', depth: 0, noise: 1.5, seed: 12 },
    note: 'parallel, right side',
  },
  {
    clipId: 'syn-lateral-shallow-16x9',
    options: { view: 'lateral', depth: 20, width: 1920, height: 1080, noise: 1.5, seed: 13 },
    note: 'above parallel, landscape',
  },
  {
    clipId: 'syn-lateral-mixed',
    options: {
      view: 'lateral',
      side: 'right',
      depth: -15,
      repDepthScale: [1, 0.86, 0.7],
      noise: 1.5,
      seed: 14,
    },
    note: 'reps get shallower',
  },
  {
    clipId: 'syn-lateral-near-edge',
    options: { view: 'lateral', depth: -4, noise: 1.5, seed: 15 },
    note: 'just below parallel, near the class edge',
  },
  {
    clipId: 'syn-lateral-noisy-24fps',
    options: { view: 'lateral', depth: -10, fps: 24, noise: 3, dropout: 0.02, seed: 16 },
    note: '24 fps, heavier noise and dropout',
  },
  {
    clipId: 'syn-frontal-clean',
    options: { view: 'frontal', noise: 1.5, seed: 21 },
    note: 'no knee cave',
  },
  {
    clipId: 'syn-frontal-valgus',
    options: { view: 'frontal', valgusDeg: 14, noise: 1.5, seed: 22 },
    note: 'knee cave 14 deg',
  },
  {
    clipId: 'syn-frontal-slight-cave',
    options: { view: 'frontal', valgusDeg: 4, noise: 1.5, seed: 23 },
    note: 'knee cave 4 deg (below the yes threshold)',
  },
  {
    clipId: 'syn-frontal-hipshift',
    options: { view: 'frontal', hipShift: 0.15, noise: 1.5, seed: 24 },
    note: 'hip shift, no knee cave',
  },
];

/** Ground-truth depth class of rep `i` (0-based). */
export function truthDepthLabel(o: SquatOptions, i: number): DepthLabel {
  const scale = o.repDepthScale[i] ?? 1;
  const thighDeg = 90 - scale * (90 - o.depth);
  const delta = -Math.sin((thighDeg * Math.PI) / 180);
  if (delta > PARALLEL_BAND) return 'below';
  if (delta < -PARALLEL_BAND) return 'above';
  return 'parallel';
}

export function truthValgusLabel(o: SquatOptions): ValgusLabel {
  if (o.view !== 'frontal') return 'na';
  return o.valgusDeg > VALGUS_YES_DEG ? 'yes' : 'no';
}

export interface SyntheticSet {
  labels: LabelRow[];
  tracks: Map<string, PoseTrack>;
}

export function syntheticSet(clips: readonly SyntheticClip[] = SYNTHETIC_CLIPS): SyntheticSet {
  const labels: LabelRow[] = [];
  const tracks = new Map<string, PoseTrack>();
  for (const clip of clips) {
    const o = resolveOptions(clip.options);
    if (o.view === 'diagonal') throw new Error(`${clip.clipId}: diagonal clips are not labelled`);
    tracks.set(clip.clipId, makeSquatTrack(o));
    for (let i = 0; i < o.reps; i++) {
      labels.push({
        clipId: clip.clipId,
        view: o.view,
        repIndex: i + 1,
        depth: truthDepthLabel(o, i),
        valgus: truthValgusLabel(o),
        notes: clip.note,
        line: labels.length + 2,
      });
    }
  }
  return { labels, tracks };
}
