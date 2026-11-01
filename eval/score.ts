/**
 * Scoring for the eval harness (SPEC §10): compares `analyzeSet` output with human labels.
 * Pure: no I/O, so it is unit-tested directly.
 *
 * - Reps are matched by index (SPEC §10): label `rep_index` n (1-based) is `report.reps[n - 1]`.
 *   A label with no detected rep is a "missed rep". When a clip's detected rep count differs
 *   from its highest labelled index, a missed or extra rep early on shifts every later match,
 *   so the clip is marked `aligned: false` and the report says so; check it by hand.
 * - When `quality.ok` is false the app shows no metrics, so every rep of that clip counts as
 *   not measured (reason `quality_gate`) even if the core computed values. A metric the view
 *   never enables keeps reason `wrong_view`.
 * - Depth: the model has a 4th class, `borderline` (too close to call). Borderline reps are
 *   counted separately and excluded from agreement, as are reps with no value.
 * - Valgus: labels `na` are skipped; flagged = yes.
 */
import type { DepthClass, SetReport, View } from '../src/core';
import type { DepthLabel, LabelRow, ValgusLabel } from './labels';

export type NotMeasured = 'not_measured';
export type DepthPred = DepthClass | NotMeasured;
export type ValgusPred = 'yes' | 'no' | NotMeasured;
export type Reason = 'missed_rep' | 'quality_gate' | 'wrong_view' | 'low_visibility' | string;

export interface RepOutcome {
  label: LabelRow;
  depth: DepthPred;
  /** Normalized hip-knee delta behind the depth class, when measured. */
  depthDelta: number | null;
  depthReason: Reason | null;
  valgus: ValgusPred;
  valgusReason: Reason | null;
}

export interface ClipOutcome {
  clipId: string;
  labelledView: LabelRow['view'];
  detectedView: View;
  qualityOk: boolean;
  problems: string[];
  /** Highest labelled `rep_index` (reps may be left unlabelled). */
  labelledReps: number;
  detectedReps: number;
  /** labelledReps === detectedReps; when false, index matching may be shifted. */
  aligned: boolean;
}

export interface Confusion<L extends string, P extends string> {
  rows: readonly L[];
  cols: readonly P[];
  /** counts[i][j] = labelled rows[i], predicted cols[j]. */
  counts: number[][];
}

export interface Agreement {
  agree: number;
  total: number;
  /** agree / total, 0..1; null when nothing was comparable. */
  rate: number | null;
}

export const DEPTH_LABELS: readonly DepthLabel[] = ['below', 'parallel', 'above'];
export const DEPTH_PREDS: readonly DepthPred[] = [
  'below',
  'parallel',
  'above',
  'borderline',
  'not_measured',
];
export const VALGUS_LABELS: readonly Exclude<ValgusLabel, 'na'>[] = ['yes', 'no'];
export const VALGUS_PREDS: readonly ValgusPred[] = ['yes', 'no', 'not_measured'];

/** Counts (label, prediction) pairs into a matrix. Pairs outside rows/cols throw. */
export function confusion<L extends string, P extends string>(
  pairs: ReadonlyArray<readonly [L, P]>,
  rows: readonly L[],
  cols: readonly P[],
): Confusion<L, P> {
  const counts = rows.map(() => cols.map(() => 0));
  for (const [l, p] of pairs) {
    const i = rows.indexOf(l);
    const j = cols.indexOf(p);
    if (i < 0 || j < 0) throw new Error(`confusion: unexpected pair (${l}, ${p})`);
    counts[i]![j]!++;
  }
  return { rows, cols, counts };
}

/** Share of pairs whose prediction equals the label, over pairs where `comparable` holds. */
export function agreement<L extends string, P extends string>(
  pairs: ReadonlyArray<readonly [L, P]>,
  comparable: (p: P) => boolean = () => true,
): Agreement {
  let agree = 0;
  let total = 0;
  for (const [l, p] of pairs) {
    if (!comparable(p)) continue;
    total++;
    if ((l as string) === (p as string)) agree++;
  }
  return { agree, total, rate: total > 0 ? agree / total : null };
}

/** Per-rep outcomes for one clip's labels against its report. */
export function outcomesForClip(report: SetReport, labels: readonly LabelRow[]): RepOutcome[] {
  return labels.map((label) => {
    const rr = report.reps[label.repIndex - 1];
    if (!rr) {
      return {
        label,
        depth: 'not_measured',
        depthDelta: null,
        depthReason: 'missed_rep',
        valgus: 'not_measured',
        valgusReason: 'missed_rep',
      };
    }
    const gated = !report.quality.ok;
    const d = rr.depth;
    const v = rr.valgus;
    const reason = (m: { value: unknown; reason?: string }): Reason | null => {
      if (m.reason === 'wrong_view') return 'wrong_view';
      if (gated) return 'quality_gate';
      return m.value ? null : (m.reason ?? 'unknown');
    };
    return {
      label,
      depth: gated || !d.value ? 'not_measured' : d.value.cls,
      depthDelta: d.value ? d.value.delta : null,
      depthReason: reason(d),
      valgus: gated || !v.value ? 'not_measured' : v.value.flagged ? 'yes' : 'no',
      valgusReason: reason(v),
    };
  });
}

export function clipOutcome(
  clipId: string,
  report: SetReport,
  labels: readonly LabelRow[],
): ClipOutcome {
  const labelledReps = Math.max(...labels.map((l) => l.repIndex));
  return {
    clipId,
    labelledView: labels[0]!.view,
    detectedView: report.view.view,
    qualityOk: report.quality.ok,
    problems: [...report.quality.problems],
    labelledReps,
    detectedReps: report.reps.length,
    aligned: labelledReps === report.reps.length,
  };
}

export interface DepthSummary {
  matrix: Confusion<DepthLabel, DepthPred>;
  /** Over reps with a below/parallel/above prediction. */
  agreement: Agreement;
  borderline: number;
  notMeasured: number;
  total: number;
}

export interface ValgusSummary {
  matrix: Confusion<'yes' | 'no', ValgusPred>;
  /** Over measured reps with a yes/no label. */
  agreement: Agreement;
  /** Flagged among labelled yes (measured only); null when none. */
  sensitivity: number | null;
  /** Not flagged among labelled no (measured only); null when none. */
  specificity: number | null;
  notMeasured: number;
  /** Labelled yes/no (na excluded). */
  total: number;
}

export interface EvalSummary {
  clips: ClipOutcome[];
  reps: RepOutcome[];
  view: Agreement;
  repCount: Agreement;
  depth: DepthSummary;
  valgus: ValgusSummary;
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

export function summarize(clips: ClipOutcome[], reps: RepOutcome[]): EvalSummary {
  const depthPairs = reps.map((r) => [r.label.depth, r.depth] as const);
  const decided = (p: DepthPred) => p !== 'borderline' && p !== 'not_measured';

  const valgusReps = reps.filter((r) => r.label.valgus !== 'na');
  const valgusPairs = valgusReps.map((r) => [r.label.valgus as 'yes' | 'no', r.valgus] as const);
  const valgusMatrix = confusion(valgusPairs, VALGUS_LABELS, VALGUS_PREDS);
  const [yesRow, noRow] = valgusMatrix.counts as [number[], number[]];

  return {
    clips,
    reps,
    view: agreement(clips.map((c) => [c.labelledView, c.detectedView] as const)),
    repCount: agreement(
      clips.map((c) => [String(c.labelledReps), String(c.detectedReps)] as const),
    ),
    depth: {
      matrix: confusion(depthPairs, DEPTH_LABELS, DEPTH_PREDS),
      agreement: agreement(depthPairs, decided),
      borderline: reps.filter((r) => r.depth === 'borderline').length,
      notMeasured: reps.filter((r) => r.depth === 'not_measured').length,
      total: reps.length,
    },
    valgus: {
      matrix: valgusMatrix,
      agreement: agreement(valgusPairs, (p) => p !== 'not_measured'),
      sensitivity: ratio(yesRow[0]!, yesRow[0]! + yesRow[1]!),
      specificity: ratio(noRow[1]!, noRow[0]! + noRow[1]!),
      notMeasured: valgusReps.filter((r) => r.valgus === 'not_measured').length,
      total: valgusReps.length,
    },
  };
}

export type ReviewKind = 'disagree' | 'borderline' | 'not_measured' | 'missed_rep';

export interface ReviewItem {
  kind: ReviewKind;
  metric: 'depth' | 'valgus';
  clipId: string;
  repIndex: number;
  label: string;
  predicted: string;
  detail: string;
}

/**
 * Reps worth a human look, in label order: disagreements first within each rep, then
 * borderline and unmeasured ones. Unmeasured depth on frontal clips and unmeasured valgus on
 * lateral clips are expected (wrong view) and left out.
 */
export function reviewList(reps: readonly RepOutcome[]): ReviewItem[] {
  const items: ReviewItem[] = [];
  for (const r of reps) {
    const base = { clipId: r.label.clipId, repIndex: r.label.repIndex };
    if (r.depthReason === 'missed_rep') {
      items.push({
        ...base,
        kind: 'missed_rep',
        metric: 'depth',
        label: r.label.depth,
        predicted: '—',
        detail: 'no detected rep at this index',
      });
      continue;
    }
    const delta = r.depthDelta === null ? '' : `delta ${r.depthDelta.toFixed(3)}`;
    if (r.depth === 'not_measured') {
      if (r.depthReason !== 'wrong_view') {
        items.push({
          ...base,
          kind: 'not_measured',
          metric: 'depth',
          label: r.label.depth,
          predicted: '—',
          detail: [r.depthReason ?? '', delta].filter(Boolean).join(', '),
        });
      }
    } else if (r.depth === 'borderline') {
      items.push({
        ...base,
        kind: 'borderline',
        metric: 'depth',
        label: r.label.depth,
        predicted: 'borderline',
        detail: delta,
      });
    } else if (r.depth !== r.label.depth) {
      items.push({
        ...base,
        kind: 'disagree',
        metric: 'depth',
        label: r.label.depth,
        predicted: r.depth,
        detail: delta,
      });
    }

    if (r.label.valgus === 'na') continue;
    if (r.valgus === 'not_measured') {
      if (r.valgusReason !== 'wrong_view') {
        items.push({
          ...base,
          kind: 'not_measured',
          metric: 'valgus',
          label: r.label.valgus,
          predicted: '—',
          detail: r.valgusReason ?? '',
        });
      }
    } else if (r.valgus !== r.label.valgus) {
      items.push({
        ...base,
        kind: 'disagree',
        metric: 'valgus',
        label: r.label.valgus,
        predicted: r.valgus,
        detail: '',
      });
    }
  }
  return items;
}
