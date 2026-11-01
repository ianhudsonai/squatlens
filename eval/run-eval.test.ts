import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeSquatTrack } from '../test/synthetic/makeSquatTrack';
import { parseLabels } from './labels';
import { renderResults } from './report';
import { asPoseTrack, evaluate, fixtureLoader, groupByClip, parseArgs } from './run-eval';
import {
  SYNTHETIC_CLIPS,
  syntheticSet,
  truthDepthLabel,
  truthValgusLabel,
} from './synthetic/dataset';
import { resolveOptions } from '../test/synthetic/makeSquatTrack';

describe('synthetic set', () => {
  it('labels depth from the generator geometry', () => {
    expect(truthDepthLabel(resolveOptions({ depth: -15 }), 0)).toBe('below');
    expect(truthDepthLabel(resolveOptions({ depth: 0 }), 0)).toBe('parallel');
    expect(truthDepthLabel(resolveOptions({ depth: 20 }), 0)).toBe('above');
    const mixed = resolveOptions({ depth: -15, repDepthScale: [1, 0.86, 0.7] });
    expect([0, 1, 2].map((i) => truthDepthLabel(mixed, i))).toEqual(['below', 'parallel', 'above']);
    expect(truthValgusLabel(resolveOptions({ view: 'lateral', valgusDeg: 20 }))).toBe('na');
    expect(truthValgusLabel(resolveOptions({ view: 'frontal', valgusDeg: 14 }))).toBe('yes');
    expect(truthValgusLabel(resolveOptions({ view: 'frontal', valgusDeg: 4 }))).toBe('no');
  });

  it('runs end to end: every rep detected, every decided rep agrees', () => {
    const set = syntheticSet();
    const { summary, missing } = evaluate(set.labels, (id) => set.tracks.get(id) ?? null);
    expect(missing).toEqual([]);
    expect(summary.clips).toHaveLength(SYNTHETIC_CLIPS.length);
    expect(summary.view.rate).toBe(1);
    expect(summary.repCount.rate).toBe(1);
    expect(summary.depth.agreement.rate).toBe(1);
    expect(summary.depth.agreement.total).toBeGreaterThanOrEqual(12);
    expect(summary.valgus.agreement.rate).toBe(1);
    expect(summary.valgus.matrix.counts[0]![0]).toBeGreaterThan(0); // some yes reps flagged

    const md = renderResults(summary, {
      source: 'synthetic',
      command: 'npm run eval -- --synthetic',
    });
    expect(md).toContain('# SquatLens validation results');
    expect(md).toContain('| **below** |');
    expect(md).toContain('## Reps to review');
    expect(md).not.toContain('(differs)');
    // Deterministic output.
    const again = syntheticSet();
    const s2 = evaluate(again.labels, (id) => again.tracks.get(id) ?? null).summary;
    expect(renderResults(s2, { source: 'synthetic', command: 'npm run eval -- --synthetic' })).toBe(
      md,
    );
  });
});

describe('evaluate', () => {
  it('skips clips without a track and reports them', () => {
    const labels = parseLabels(
      'clip_id,view,rep_index,depth_label,valgus_label,notes\na,lateral,1,below,na,\nb,lateral,1,below,na,\n',
    );
    const track = makeSquatTrack({ reps: 1 });
    const { summary, missing } = evaluate(labels, (id) => (id === 'a' ? track : null));
    expect(missing).toEqual(['b']);
    expect(summary.clips.map((c) => c.clipId)).toEqual(['a']);
  });

  it('groups labels by clip and sorts by rep', () => {
    const labels = parseLabels(
      'clip_id,view,rep_index,depth_label,valgus_label,notes\na,lateral,2,below,na,\nb,lateral,1,below,na,\na,lateral,1,above,na,\n',
    );
    const g = groupByClip(labels);
    expect([...g.keys()]).toEqual(['a', 'b']);
    expect(g.get('a')!.map((l) => l.repIndex)).toEqual([1, 2]);
  });
});

describe('fixtures', () => {
  it('loads <id>.json, falls back to <id>.pose.json, returns null when absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'squatlens-eval-'));
    const track = makeSquatTrack({ reps: 1 });
    writeFileSync(join(dir, 'one.json'), JSON.stringify(track));
    writeFileSync(join(dir, 'two.pose.json'), JSON.stringify(track));
    const load = fixtureLoader(dir);
    expect(load('one')?.frames.length).toBe(track.frames.length);
    expect(load('two')?.width).toBe(track.width);
    expect(load('three')).toBeNull();
  });

  it('names the file when a fixture is not valid JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'squatlens-eval-'));
    writeFileSync(join(dir, 'bad.json'), '{"version": 1, "fra');
    expect(() => fixtureLoader(dir)('bad')).toThrow(/bad\.json: invalid JSON/);
  });

  it('rejects JSON that is not a PoseTrack', () => {
    expect(() => asPoseTrack({ frames: [] }, 'x.json')).toThrow(/not a PoseTrack/);
    expect(() => asPoseTrack(null, 'x.json')).toThrow(/not a PoseTrack/);
  });
});

describe('parseArgs', () => {
  it('parses flags and rejects unknown ones', () => {
    expect(parseArgs([])).toEqual({
      synthetic: false,
      labels: 'eval/labels.csv',
      fixtures: 'fixtures',
      out: null,
    });
    expect(parseArgs(['--synthetic', '--out', 'x.md'])).toMatchObject({
      synthetic: true,
      out: 'x.md',
    });
    expect(() => parseArgs(['--nope'])).toThrow(/unknown option/);
    expect(() => parseArgs(['--labels'])).toThrow(/needs a value/);
  });
});
