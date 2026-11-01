/** Renders an `EvalSummary` as `RESULTS.md`. Pure and deterministic (no timestamps). */
import type { Agreement, Confusion, EvalSummary } from './score';
import { reviewList } from './score';

export interface ReportMeta {
  /** e.g. 'real fixtures' or 'synthetic set'. */
  source: string;
  /** Command that regenerates the file. */
  command: string;
  /** Extra paragraph under the title (e.g. the synthetic-data caveat). */
  note?: string;
}

const pct = (a: Agreement) =>
  a.rate === null ? 'n/a' : `${(a.rate * 100).toFixed(1)}% (${a.agree}/${a.total})`;
const rate = (r: number | null) => (r === null ? 'n/a' : `${(r * 100).toFixed(1)}%`);
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

function table(head: string[], rows: string[][]): string {
  return [
    `| ${head.map(cell).join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ].join('\n');
}

function matrix<L extends string, P extends string>(m: Confusion<L, P>): string {
  return table(
    ['label \\ predicted', ...m.cols.map((c) => c.replace('_', ' '))],
    m.rows.map((r, i) => [`**${r}**`, ...m.counts[i]!.map(String)]),
  );
}

export function renderResults(s: EvalSummary, meta: ReportMeta): string {
  const out: string[] = [];
  out.push('# SquatLens validation results', '');
  out.push(
    `Source: ${meta.source}. ${s.clips.length} clips, ${s.reps.length} labelled reps. ` +
      `Regenerate with \`${meta.command}\`.`,
  );
  if (meta.note) out.push('', meta.note);

  out.push('', '## Summary', '');
  out.push(
    table(
      ['metric', 'agreement', 'notes'],
      [
        ['view (per clip)', pct(s.view), 'labelled view vs detected view'],
        ['rep count (per clip)', pct(s.repCount), 'labelled reps vs detected reps'],
        [
          'depth (per rep)',
          pct(s.depth.agreement),
          `over decided reps; ${s.depth.borderline} borderline, ${s.depth.notMeasured} not measured, of ${s.depth.total}`,
        ],
        [
          'valgus (per rep)',
          pct(s.valgus.agreement),
          `sensitivity ${rate(s.valgus.sensitivity)}, specificity ${rate(s.valgus.specificity)}; ` +
            `${s.valgus.notMeasured} not measured, of ${s.valgus.total} labelled yes/no`,
        ],
      ],
    ),
  );

  out.push('', '## Depth', '');
  out.push(
    'Rows are human labels, columns the app. `borderline` means the app declined to call it ' +
      '(within ±0.02 femur lengths of a class edge); those reps are not counted in agreement. ' +
      '`not measured` includes frontal clips (depth needs a side view), quality-gate failures ' +
      'and missed reps.',
    '',
  );
  out.push(matrix(s.depth.matrix));

  out.push('', '## Knee valgus', '');
  out.push(
    'Labels `na` are excluded. `not measured` includes lateral clips (valgus needs a frontal ' +
      'view), quality-gate failures and missed reps.',
    '',
  );
  out.push(matrix(s.valgus.matrix));

  out.push('', '## Clips', '');
  out.push(
    table(
      ['clip', 'labelled view', 'detected view', 'quality', 'reps labelled', 'reps detected'],
      s.clips.map((c) => [
        c.clipId,
        c.labelledView,
        c.detectedView,
        c.qualityOk ? 'ok' : `failed: ${c.problems.join(', ') || 'unknown'}`,
        String(c.labelledReps),
        String(c.detectedReps),
      ]),
    ),
  );

  const review = reviewList(s.reps);
  out.push('', '## Reps to review', '');
  if (review.length === 0) out.push('None: every measured rep matches its label.');
  else {
    out.push(
      table(
        ['clip', 'rep', 'metric', 'kind', 'label', 'app', 'detail'],
        review.map((r) => [
          r.clipId,
          String(r.repIndex),
          r.metric,
          r.kind.replace('_', ' '),
          r.label,
          r.predicted,
          r.detail,
        ]),
      ),
    );
  }
  return out.join('\n') + '\n';
}
