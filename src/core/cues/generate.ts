/**
 * Deterministic cue rules (SPEC §6). `generateCues(report)` turns a `SetReport` into
 * language-neutral `Cue`s (id + params); `renderCue` (render.ts) turns one into text.
 *
 * Order, so the list reads top-down the same way every time:
 *   1. one cue per `quality.problems` entry, in that order (`diagonal_view` -> `view.diagonal`,
 *      the refilm cue), then `view.unknown` when the view could not be classified;
 *   2. if `quality.ok` is false, stop here: the UI shows problems and no metrics;
 *   3. `nodata.reps` when no rep was found, and stop;
 *   4. per rep, in rep order: depth, trunk, tempo, valgus, asymmetry. A metric the view
 *      enables but that came back null gives `nodata.<metric>`; `wrong_view` gives nothing;
 *   5. set level: `tempo.summary`, then `fatigue.loss`.
 *
 * Every threshold is an uncalibrated starting guess (SPEC §10), and the cues are hints, not
 * judging rules.
 */
import { DEFAULTS as ASYMMETRY_DEFAULTS } from '../metrics/asymmetry';
import { DEFAULTS as TRUNK_DEFAULTS } from '../metrics/trunk';
import { median } from '../calibration';
import { withDefaults } from '../options';
import type { Cue, QualityReport, RepReport, SetReport } from '../types';

export const DEFAULTS = {
  /** trunkMinusShinDeg above this gives `trunk.forward` (SPEC §5.6, hint only). */
  forwardLeanDeg: TRUNK_DEFAULTS.forwardLeanHintDeg,
  /** |hipShiftNorm| above this names the shift side in `asym.shift`; else `asym.uneven`. */
  hipShiftFlag: ASYMMETRY_DEFAULTS.hipShiftFlag,
  /** descentS below this gives `tempo.fast_descent`. Uncalibrated guess. */
  fastDescentS: 0.5,
  /** velocityLoss at or above this gives `fatigue.loss` (20% is a common VBT stop point). */
  fatigueLoss: 0.2,
};

export type CueOptions = typeof DEFAULTS;

/** Metrics that can report `nodata.<metric>`, in per-rep cue order. */
export const CUE_METRICS = ['depth', 'trunk', 'tempo', 'valgus', 'asymmetry'] as const;
export type CueMetric = (typeof CUE_METRICS)[number];

/** Every CueId `generateCues` can emit. Each must have a pt-BR and an en text (tested). */
export const CUE_IDS = [
  'quality.no_pose',
  'quality.low_visibility',
  'quality.low_fps',
  'quality.cut_off',
  'quality.tilted_camera',
  'view.diagonal',
  'view.unknown',
  'nodata.reps',
  ...CUE_METRICS.map((m) => `nodata.${m}` as const),
  'depth.below',
  'depth.parallel',
  'depth.borderline',
  'depth.above',
  'trunk.forward',
  'valgus.flag',
  'asym.shift',
  'asym.uneven',
  'tempo.fast_descent',
  'tempo.summary',
  'fatigue.loss',
] as const;
export type KnownCueId = (typeof CUE_IDS)[number];

type Problem = QualityReport['problems'][number];

function problemCue(p: Problem): Cue {
  switch (p) {
    case 'diagonal_view':
      return { id: 'view.diagonal', repIndex: null, severity: 'warn', params: {} };
    case 'tilted_camera':
      // Does not block the report; trunk confidence is already capped.
      return { id: 'quality.tilted_camera', repIndex: null, severity: 'info', params: {} };
    default:
      return { id: `quality.${p}`, repIndex: null, severity: 'warn', params: {} };
  }
}

/** Rounds to `digits` decimals, returning a plain finite number. */
function round(x: number, digits = 0): number {
  const k = 10 ** digits;
  return Math.round(x * k) / k;
}

function repCues(r: RepReport, o: CueOptions): Cue[] {
  const repIndex = r.rep.index;
  const out: Cue[] = [];
  const cue = (id: string, severity: Cue['severity'], params: Cue['params'] = {}) =>
    out.push({ id, repIndex, severity, params });

  for (const m of CUE_METRICS) {
    const metric = r[m];
    if (metric.value === null) {
      if (metric.reason !== 'wrong_view') cue(`nodata.${m}`, 'info');
      continue;
    }
    switch (m) {
      case 'depth': {
        const cls = r.depth.value!.cls;
        cue(`depth.${cls}`, cls === 'above' ? 'warn' : 'info');
        break;
      }
      case 'trunk': {
        const d = r.trunk.value!.trunkMinusShinDeg;
        if (d > o.forwardLeanDeg) cue('trunk.forward', 'warn', { deg: round(d) });
        break;
      }
      case 'tempo': {
        const d = r.tempo.value!.descentS;
        if (d < o.fastDescentS) cue('tempo.fast_descent', 'info', { d: round(d, 1) });
        break;
      }
      case 'valgus':
        if (r.valgus.value!.flagged) {
          cue('valgus.flag', 'warn', { conf: r.valgus.confidence ?? 'low' });
        }
        break;
      case 'asymmetry': {
        const a = r.asymmetry.value!;
        if (!a.flagged) break;
        if (Math.abs(a.hipShiftNorm) > o.hipShiftFlag) {
          // hipShiftNorm > 0 = toward the subject's own left (metrics/asymmetry.ts).
          cue('asym.shift', 'warn', { side: a.hipShiftNorm > 0 ? 'left' : 'right' });
        } else {
          cue('asym.uneven', 'warn');
        }
        break;
      }
    }
  }
  return out;
}

/** Builds the cue list for a report. See the file header for the rules and order. */
export function generateCues(
  report: Omit<SetReport, 'cues'>,
  opts: Partial<CueOptions> = {},
): Cue[] {
  const o = withDefaults(DEFAULTS, opts);
  const cues: Cue[] = report.quality.problems.map(problemCue);
  if (report.view.view === 'unknown') {
    cues.push({ id: 'view.unknown', repIndex: null, severity: 'warn', params: {} });
  }
  if (!report.quality.ok) return cues;
  if (report.reps.length === 0) {
    cues.push({ id: 'nodata.reps', repIndex: null, severity: 'warn', params: {} });
    return cues;
  }

  for (const r of report.reps) cues.push(...repCues(r, o));

  const tempos = report.reps.flatMap((r) => (r.tempo.value ? [r.tempo.value] : []));
  if (tempos.length > 0) {
    cues.push({
      id: 'tempo.summary',
      repIndex: null,
      severity: 'info',
      params: {
        d: round(median(tempos.map((t) => t.descentS))!, 1),
        a: round(median(tempos.map((t) => t.ascentS))!, 1),
      },
    });
  }
  const loss = report.velocityLoss.value;
  if (loss !== null && loss >= o.fatigueLoss) {
    cues.push({
      id: 'fatigue.loss',
      repIndex: null,
      severity: 'info',
      params: { pct: round(loss * 100) },
    });
  }
  return cues;
}
