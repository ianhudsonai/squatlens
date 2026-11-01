/**
 * Eval harness entry point (SPEC §10). Run through `npm run eval` (eval/cli.mjs loads this
 * file with Vite's module runner, so no extra TypeScript runner is needed).
 *
 *   npm run eval                    labels.csv + fixtures/<clip_id>.json -> eval/RESULTS.md
 *   npm run eval -- --synthetic     generated labelled set -> eval/synthetic/RESULTS.md
 *
 * Options: --labels <csv>, --fixtures <dir>, --out <md>. Paths are relative to the current
 * directory (the repo root under npm). With no labelled real clips yet it exits 0 and says so.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { analyzeSet } from '../src/core';
import type { AnalyzeOptions, PoseTrack } from '../src/core';
import { parseLabels } from './labels';
import type { LabelRow } from './labels';
import { renderResults } from './report';
import type { ReportMeta } from './report';
import { clipOutcome, outcomesForClip, summarize } from './score';
import type { ClipOutcome, EvalSummary, RepOutcome } from './score';
import { syntheticSet } from './synthetic/dataset';

export interface EvalResult {
  summary: EvalSummary;
  /** Clip ids in labels.csv with no fixture; they are left out of the summary. */
  missing: string[];
}

/** Groups labels by clip (first-seen order), sorted by rep within each clip. */
export function groupByClip(labels: readonly LabelRow[]): Map<string, LabelRow[]> {
  const byClip = new Map<string, LabelRow[]>();
  for (const l of labels) {
    const list = byClip.get(l.clipId) ?? [];
    list.push(l);
    byClip.set(l.clipId, list);
  }
  for (const list of byClip.values()) list.sort((a, b) => a.repIndex - b.repIndex);
  return byClip;
}

/** Runs `analyzeSet` on every labelled clip whose track `getTrack` can supply. */
export function evaluate(
  labels: readonly LabelRow[],
  getTrack: (clipId: string) => PoseTrack | null,
  opts: AnalyzeOptions = {},
): EvalResult {
  const clips: ClipOutcome[] = [];
  const reps: RepOutcome[] = [];
  const missing: string[] = [];
  for (const [clipId, rows] of groupByClip(labels)) {
    const track = getTrack(clipId);
    if (!track) {
      missing.push(clipId);
      continue;
    }
    const report = analyzeSet(track, opts);
    clips.push(clipOutcome(clipId, report, rows));
    reps.push(...outcomesForClip(report, rows));
  }
  return { summary: summarize(clips, reps), missing };
}

/** Minimal structural check, so a wrong file fails with a clear message. */
export function asPoseTrack(data: unknown, file: string): PoseTrack {
  const t = data as Partial<PoseTrack> | null;
  if (
    !t ||
    typeof t !== 'object' ||
    t.version !== 1 ||
    !(typeof t.width === 'number' && t.width > 0) ||
    !(typeof t.height === 'number' && t.height > 0) ||
    !Array.isArray(t.frames)
  ) {
    throw new Error(`${file}: not a PoseTrack v1 JSON (expected version, width, height, frames)`);
  }
  return t as PoseTrack;
}

/** Looks for fixtures/<clip_id>.json, then fixtures/<clip_id>.pose.json (the app's export name). */
export function fixtureLoader(dir: string): (clipId: string) => PoseTrack | null {
  return (clipId) => {
    for (const name of [`${clipId}.json`, `${clipId}.pose.json`]) {
      const file = join(dir, name);
      if (existsSync(file)) return asPoseTrack(JSON.parse(readFileSync(file, 'utf8')), file);
    }
    return null;
  };
}

interface Args {
  synthetic: boolean;
  labels: string;
  fixtures: string;
  out: string | null;
}

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    synthetic: false,
    labels: 'eval/labels.csv',
    fixtures: 'fixtures',
    out: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--synthetic') args.synthetic = true;
    else if (a === '--labels') args.labels = value();
    else if (a === '--fixtures') args.fixtures = value();
    else if (a === '--out') args.out = value();
    else throw new Error(`unknown option ${a} (use --synthetic, --labels, --fixtures, --out)`);
  }
  return args;
}

function write(out: string, md: string, summary: EvalSummary) {
  writeFileSync(out, md);
  const d = summary.depth.agreement;
  const v = summary.valgus.agreement;
  const fmt = (a: typeof d) =>
    a.rate === null ? 'n/a' : `${(a.rate * 100).toFixed(1)}% (${a.agree}/${a.total})`;
  console.log(
    `eval: ${summary.clips.length} clips, ${summary.reps.length} reps. ` +
      `depth ${fmt(d)}, ${summary.depth.borderline} borderline; valgus ${fmt(v)}.`,
  );
  console.log(`eval: wrote ${relative(process.cwd(), out) || out}`);
}

/** CLI. Returns the process exit code. */
export function main(argv: readonly string[]): number {
  const args = parseArgs(argv);

  if (args.synthetic) {
    const set = syntheticSet();
    const { summary } = evaluate(set.labels, (id) => set.tracks.get(id) ?? null);
    const meta: ReportMeta = {
      source: 'synthetic set (eval/synthetic/dataset.ts)',
      command: 'npm run eval -- --synthetic',
      note:
        '> Synthetic data: labels are the generator’s ground truth. This checks the harness and ' +
        'the pipeline against the geometry they were built on, not accuracy on real people.',
    };
    write(args.out ?? 'eval/synthetic/RESULTS.md', renderResults(summary, meta), summary);
    return 0;
  }

  if (!existsSync(args.labels)) {
    console.log(`eval: ${args.labels} not found. See fixtures/README.md.`);
    return 0;
  }
  const labels = parseLabels(readFileSync(args.labels, 'utf8'));
  if (labels.length === 0) {
    console.log(
      `eval: no labelled clips in ${args.labels} yet, nothing to score. ` +
        'See fixtures/README.md to add clips, or run `npm run eval -- --synthetic`.',
    );
    return 0;
  }
  const { summary, missing } = evaluate(labels, fixtureLoader(args.fixtures));
  for (const id of missing) {
    console.warn(`eval: no fixture for ${id} in ${args.fixtures}/, skipping its labels`);
  }
  if (summary.clips.length === 0) {
    console.log('eval: none of the labelled clips has a fixture yet, nothing to score.');
    return 0;
  }
  const meta: ReportMeta = {
    source: `real fixtures (${args.labels}, ${args.fixtures}/)`,
    command: 'npm run eval',
    note:
      missing.length > 0
        ? `Skipped (no fixture): ${missing.map((m) => `\`${m}\``).join(', ')}.`
        : undefined,
  };
  write(args.out ?? 'eval/RESULTS.md', renderResults(summary, meta), summary);
  return 0;
}
