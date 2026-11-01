import { describe, expect, it } from 'vitest';
import type { RepReport, SetReport } from '../src/core';
import type { LabelRow } from './labels';
import { agreement, clipOutcome, confusion, outcomesForClip, reviewList, summarize } from './score';

describe('confusion', () => {
  it('counts label x prediction pairs', () => {
    const m = confusion(
      [
        ['a', 'a'],
        ['a', 'b'],
        ['b', 'b'],
        ['a', 'a'],
        ['b', 'x'],
      ] as const,
      ['a', 'b'] as const,
      ['a', 'b', 'x'] as const,
    );
    expect(m.counts).toEqual([
      [2, 1, 0],
      [0, 1, 1],
    ]);
  });

  it('gives zeros for no pairs and throws on unknown classes', () => {
    expect(confusion([], ['a'], ['a', 'b']).counts).toEqual([[0, 0]]);
    expect(() => confusion([['c', 'a']], ['a'], ['a'])).toThrow(/unexpected/);
  });
});

describe('agreement', () => {
  it('is the matching share over comparable pairs', () => {
    const pairs = [
      ['x', 'x'],
      ['x', 'y'],
      ['y', 'y'],
      ['y', 'skip'],
    ] as const;
    expect(agreement(pairs)).toEqual({ agree: 2, total: 4, rate: 0.5 });
    expect(agreement(pairs, (p) => p !== 'skip')).toEqual({ agree: 2, total: 3, rate: 2 / 3 });
  });

  it('is null with nothing comparable', () => {
    expect(agreement([])).toEqual({ agree: 0, total: 0, rate: null });
    expect(agreement([['a', 'b']], () => false).rate).toBeNull();
  });
});

// --- Minimal SetReport fakes -------------------------------------------------------------

const NULL_METRIC = { value: null, confidence: null, reason: 'wrong_view' } as const;

function rep(
  index: number,
  depth: { cls: 'below' | 'parallel' | 'above' | 'borderline'; delta: number } | 'lowvis' | null,
  valgus: boolean | null,
): RepReport {
  return {
    rep: {
      index,
      startFrame: 0,
      bottomFrame: 1,
      endFrame: 2,
      startT: 0,
      bottomT: 1,
      endT: 2,
      depthNorm: 1,
    },
    depth:
      depth === 'lowvis'
        ? { value: null, confidence: null, reason: 'low_visibility' }
        : depth
          ? {
              value: { delta: depth.delta, cls: depth.cls, thighAngleDeg: 0, kneeFlexDeg: 0 },
              confidence: 'high',
            }
          : { ...NULL_METRIC },
    trunk: { ...NULL_METRIC },
    tempo: { ...NULL_METRIC },
    valgus:
      valgus === null
        ? { ...NULL_METRIC }
        : {
            value: {
              fppaChangeDeg: { left: 0, right: 0 },
              kneeAnkleRatioChange: 0,
              flagged: valgus,
            },
            confidence: 'high',
          },
    asymmetry: { ...NULL_METRIC },
  };
}

function report(
  reps: RepReport[],
  ok = true,
  view: SetReport['view']['view'] = 'lateral',
): SetReport {
  return {
    version: 1,
    quality: {
      ok,
      visibleFrac: 1,
      effectiveFps: 30,
      cutOff: false,
      tiltedCamera: false,
      problems: ok ? [] : ['low_visibility'],
    },
    view: { view, side: 'left', ratio2d: 0, yawDeg: 90, confidence: 'high' },
    calibration: null,
    reps,
    velocityLoss: { value: null, confidence: null, reason: 'no_reps' },
    cues: [],
  };
}

function label(
  repIndex: number,
  depth: LabelRow['depth'],
  valgus: LabelRow['valgus'] = 'na',
  clipId = 'c',
  view: LabelRow['view'] = 'lateral',
): LabelRow {
  return { clipId, view, repIndex, depth, valgus, notes: '', line: repIndex + 1 };
}

describe('outcomesForClip', () => {
  it('matches labels to reps by 1-based index and reads class/flag', () => {
    const out = outcomesForClip(
      report([
        rep(0, { cls: 'below', delta: 0.2 }, null),
        rep(1, { cls: 'borderline', delta: 0.06 }, true),
      ]),
      [label(1, 'below'), label(2, 'parallel', 'yes')],
    );
    expect(out.map((o) => [o.depth, o.depthDelta, o.valgus, o.valgusReason])).toEqual([
      ['below', 0.2, 'not_measured', 'wrong_view'],
      ['borderline', 0.06, 'yes', null],
    ]);
  });

  it('marks labels beyond the detected reps as missed', () => {
    const [o] = outcomesForClip(report([]), [label(1, 'below', 'no')]);
    expect(o).toMatchObject({
      depth: 'not_measured',
      depthReason: 'missed_rep',
      valgus: 'not_measured',
      valgusReason: 'missed_rep',
    });
  });

  it('treats everything as not measured when the quality gate fails', () => {
    const [o] = outcomesForClip(report([rep(0, { cls: 'below', delta: 0.2 }, true)], false), [
      label(1, 'below', 'yes'),
    ]);
    expect(o).toMatchObject({
      depth: 'not_measured',
      depthReason: 'quality_gate',
      depthDelta: 0.2,
      valgus: 'not_measured',
      valgusReason: 'quality_gate',
    });
  });

  it('keeps wrong_view (not quality_gate) for metrics the view never enables', () => {
    const [o] = outcomesForClip(report([rep(0, null, null)], false), [label(1, 'below', 'no')]);
    expect(o).toMatchObject({ depthReason: 'wrong_view', valgusReason: 'wrong_view' });
    expect(reviewList([o!])).toEqual([]);
  });

  it('carries the metric null reason', () => {
    const [o] = outcomesForClip(report([rep(0, 'lowvis', null)]), [label(1, 'above')]);
    expect(o).toMatchObject({ depth: 'not_measured', depthReason: 'low_visibility' });
  });
});

describe('summarize', () => {
  const lateral = report([
    rep(0, { cls: 'below', delta: 0.2 }, null),
    rep(1, { cls: 'parallel', delta: 0.0 }, null),
    rep(2, { cls: 'borderline', delta: 0.04 }, null),
    rep(3, { cls: 'above', delta: -0.2 }, null),
  ]);
  const lateralLabels = [
    label(1, 'below'),
    label(2, 'below'),
    label(3, 'parallel'),
    label(4, 'above'),
    label(5, 'above'), // missed rep
  ];
  const frontal = report(
    [rep(0, null, true), rep(1, null, true), rep(2, null, false)],
    true,
    'frontal',
  );
  const frontalLabels = [
    label(1, 'below', 'yes', 'f', 'frontal'),
    label(2, 'below', 'no', 'f', 'frontal'),
    label(3, 'below', 'no', 'f', 'frontal'),
  ];
  const s = summarize(
    [clipOutcome('c', lateral, lateralLabels), clipOutcome('f', frontal, frontalLabels)],
    [...outcomesForClip(lateral, lateralLabels), ...outcomesForClip(frontal, frontalLabels)],
  );

  it('builds the depth matrix with borderline and not-measured columns', () => {
    expect(s.depth.matrix.counts).toEqual([
      // below parallel above borderline not_measured
      [1, 1, 0, 0, 3],
      [0, 0, 0, 1, 0],
      [0, 0, 1, 0, 1],
    ]);
    expect(s.depth.agreement).toEqual({ agree: 2, total: 3, rate: 2 / 3 });
    expect(s.depth.borderline).toBe(1);
    expect(s.depth.notMeasured).toBe(4);
    expect(s.depth.total).toBe(8);
  });

  it('builds the valgus matrix, skipping na labels', () => {
    expect(s.valgus.matrix.counts).toEqual([
      [1, 0, 0],
      [1, 1, 0],
    ]);
    expect(s.valgus.total).toBe(3);
    expect(s.valgus.agreement).toEqual({ agree: 2, total: 3, rate: 2 / 3 });
    expect(s.valgus.sensitivity).toBe(1);
    expect(s.valgus.specificity).toBe(0.5);
  });

  it('scores view and rep count per clip', () => {
    expect(s.view).toEqual({ agree: 2, total: 2, rate: 1 });
    expect(s.repCount).toEqual({ agree: 1, total: 2, rate: 0.5 });
    expect(s.clips.map((c) => c.aligned)).toEqual([false, true]);
  });

  it('counts reps up to the highest labelled index, even with gaps', () => {
    const c = clipOutcome(
      'g',
      report([rep(0, null, null), rep(1, null, null), rep(2, null, null)]),
      [label(1, 'below'), label(3, 'below')],
    );
    expect(c).toMatchObject({ labelledReps: 3, detectedReps: 3, aligned: true });
  });

  it('lists reps to review, leaving out expected wrong-view gaps', () => {
    expect(reviewList(s.reps).map((r) => [r.clipId, r.repIndex, r.metric, r.kind])).toEqual([
      ['c', 2, 'depth', 'disagree'],
      ['c', 3, 'depth', 'borderline'],
      ['c', 5, 'depth', 'missed_rep'],
      ['f', 2, 'valgus', 'disagree'],
    ]);
  });
});
