import { describe, expect, it } from 'vitest';
import { makeSquatTrack } from '../../test/synthetic/makeSquatTrack';
import type { SquatOptions } from '../../test/synthetic/makeSquatTrack';
import { calibrate } from './calibration';
import { preprocess } from './smoothing';
import type { PoseTrack } from './types';
import { cameraSide, detectView, metricsForView } from './view';

const viewOf = (opts: Partial<SquatOptions>, track?: PoseTrack) => {
  const px = preprocess(track ?? makeSquatTrack(opts));
  return detectView(px, calibrate(px));
};

describe('detectView', () => {
  it('classifies the three canonical synthetic views with high confidence', () => {
    expect(viewOf({ view: 'frontal', noise: 1.5 })).toMatchObject({
      view: 'frontal',
      side: null,
      confidence: 'high',
    });
    expect(viewOf({ view: 'diagonal', noise: 1.5 })).toMatchObject({
      view: 'diagonal',
      side: null,
      confidence: 'high',
    });
    expect(viewOf({ view: 'lateral', noise: 1.5 })).toMatchObject({
      view: 'lateral',
      side: 'left',
      confidence: 'high',
    });
  });

  describe('yaw sweep', () => {
    const expected: Array<[number, string]> = [
      [0, 'frontal'],
      [10, 'frontal'],
      [20, 'frontal'],
      [45, 'diagonal'],
      [50, 'diagonal'],
      [55, 'diagonal'],
      [75, 'lateral'],
      [80, 'lateral'],
      [90, 'lateral'],
    ];
    for (const [yaw, view] of expected) {
      for (const sign of [1, -1]) {
        it(`yaw ${sign * yaw}° -> ${view}`, () => {
          const v = viewOf({ yawDeg: sign * yaw, noise: 1.5, seed: yaw + 3 });
          expect(v.view).toBe(view);
          expect(v.yawDeg!).toBeCloseTo(yaw, -0.5); // within ~1.6°
        });
      }
    }

    it('ratio2d falls monotonically as the subject turns side on', () => {
      const ratios = [0, 20, 40, 60, 80, 90].map((y) => viewOf({ yawDeg: y }).ratio2d!);
      for (let i = 1; i < ratios.length; i++) expect(ratios[i]!).toBeLessThan(ratios[i - 1]!);
    });

    it('signals that disagree give low confidence', () => {
      // yaw 70: 3D says lateral, the 2D ratio is still in the diagonal band.
      const v = viewOf({ yawDeg: 70 });
      expect(v.ratio2d!).toBeGreaterThanOrEqual(0.25);
      expect(v).toMatchObject({ view: 'lateral', confidence: 'low' });
      // yaw 30: ratio says frontal, yaw says diagonal.
      expect(viewOf({ yawDeg: 30 })).toMatchObject({ view: 'frontal', confidence: 'low' });
    });
  });

  it('lateral beats frontal when the two signals point opposite ways (SPEC order)', () => {
    const px = preprocess(makeSquatTrack({ view: 'frontal' }));
    // Force the 2D ratio to vote lateral while yaw (~0°) votes frontal.
    const v = detectView(px, calibrate(px), { lateralMaxRatio: 0.9, frontalMinRatio: 0.95 });
    expect(v).toMatchObject({ view: 'lateral', confidence: 'low' });
  });

  it('finds the camera-facing side in lateral view', () => {
    expect(viewOf({ view: 'lateral', side: 'left' }).side).toBe('left');
    expect(viewOf({ view: 'lateral', side: 'right' }).side).toBe('right');
  });

  for (const view of ['lateral', 'frontal', 'diagonal'] as const) {
    it(`is aspect-ratio independent: 9:16 and 16:9 agree (${view})`, () => {
      const portrait = viewOf({ view, width: 1080, height: 1920 });
      const landscape = viewOf({ view, width: 1920, height: 1080 });
      expect(landscape.view).toBe(portrait.view);
      expect(landscape.ratio2d!).toBeCloseTo(portrait.ratio2d!, 2);
      expect(landscape.yawDeg!).toBeCloseTo(portrait.yawDeg!, 1);
    });
  }

  it('falls back to the 2D ratio with medium confidence when world landmarks are missing', () => {
    const track = makeSquatTrack({ view: 'frontal' });
    const noWorld = { ...track, frames: track.frames.map((f) => ({ ...f, world: null })) };
    expect(viewOf({}, noWorld)).toMatchObject({
      view: 'frontal',
      yawDeg: null,
      confidence: 'medium',
    });
  });

  it('works without a calibration (uses every frame)', () => {
    const px = preprocess(makeSquatTrack({ view: 'lateral' }));
    expect(detectView(px, null).view).toBe('lateral');
  });

  it('survives heavy noise and dropout', () => {
    expect(viewOf({ view: 'lateral', noise: 4, dropout: 0.2, seed: 9 }).view).toBe('lateral');
    expect(viewOf({ view: 'frontal', noise: 4, dropout: 0.2, seed: 9 }).view).toBe('frontal');
  });

  it("returns 'unknown' with null signals when no pose is ever found", () => {
    const track = makeSquatTrack({ reps: 1 });
    const empty = { ...track, frames: track.frames.map((f) => ({ ...f, lm: null, world: null })) };
    expect(viewOf({}, empty)).toEqual({
      view: 'unknown',
      side: null,
      ratio2d: null,
      yawDeg: null,
      confidence: null,
    });
  });

  it('accepts threshold overrides', () => {
    const px = preprocess(makeSquatTrack({ yawDeg: 45 }));
    const v = detectView(px, calibrate(px), { lateralMinYawDeg: 40, lateralMaxRatio: 0.6 });
    expect(v.view).toBe('lateral');
  });
});

describe('cameraSide', () => {
  it('returns null on a tie (no usable legs)', () => {
    const track = makeSquatTrack({ reps: 1 });
    const empty = { ...track, frames: track.frames.map((f) => ({ ...f, lm: null })) };
    expect(cameraSide(preprocess(empty))).toBeNull();
  });
});

describe('metricsForView', () => {
  it('enables metrics per SPEC §5.3', () => {
    expect(metricsForView('lateral')).toEqual({
      depth: true,
      trunk: true,
      tempo: true,
      valgus: false,
      asymmetry: false,
    });
    expect(metricsForView('frontal')).toEqual({
      depth: false,
      trunk: false,
      tempo: true,
      valgus: true,
      asymmetry: true,
    });
    for (const v of ['diagonal', 'unknown'] as const) {
      expect(metricsForView(v)).toEqual({
        depth: false,
        trunk: false,
        tempo: true,
        valgus: false,
        asymmetry: false,
      });
    }
  });
});
