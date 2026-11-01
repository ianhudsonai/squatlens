import { describe, expect, it } from 'vitest';
import { makeSquatTrack } from '../../test/synthetic/makeSquatTrack';
import type { SquatOptions } from '../../test/synthetic/makeSquatTrack';
import { calibrate } from './calibration';
import { L_ANKLE, L_HEEL, NOSE, R_ANKLE, R_HEEL, R_HIP, R_SHOULDER } from './landmarks';
import { assessQuality } from './quality';
import { preprocess } from './smoothing';
import type { PoseTrack, ViewResult } from './types';
import { detectView } from './view';

const run = (track: PoseTrack, view?: ViewResult) => {
  const px = preprocess(track);
  const cal = calibrate(px);
  const v = view ?? detectView(px, cal);
  return { view: v, q: assessQuality(px, v, cal) };
};
const runOpts = (opts: Partial<SquatOptions>) => run(makeSquatTrack(opts));

/** Moves the whole figure by dy (normalized), marking landmarks that leave the frame like MediaPipe would. */
function shiftY(track: PoseTrack, dy: number): PoseTrack {
  return {
    ...track,
    frames: track.frames.map((f) => ({
      ...f,
      lm:
        f.lm?.map((lm) => {
          const y = lm.y + dy;
          return { ...lm, y, visibility: y < 0 || y > 1 ? 0.1 : lm.visibility };
        }) ?? null,
    })),
  };
}

/** Puts the given landmarks just outside the frame bottom but keeps them "visible". */
function pushOut(track: PoseTrack, idx: number[]): PoseTrack {
  return {
    ...track,
    frames: track.frames.map((f) => ({
      ...f,
      lm:
        f.lm?.map((lm, k) => (idx.includes(k) ? { ...lm, y: 1.02, visibility: 0.9 } : lm)) ?? null,
    })),
  };
}

/** Marks the given landmarks as occluded (visibility 0.1) in every frame. */
function hide(track: PoseTrack, idx: number[]): PoseTrack {
  return {
    ...track,
    frames: track.frames.map((f) => ({
      ...f,
      lm: f.lm?.map((lm, k) => (idx.includes(k) ? { ...lm, visibility: 0.1 } : lm)) ?? null,
    })),
  };
}

const lateralView: ViewResult = {
  view: 'lateral',
  side: 'left',
  ratio2d: 0.1,
  yawDeg: 90,
  confidence: 'high',
};

describe('assessQuality', () => {
  for (const view of ['lateral', 'frontal', 'diagonal'] as const) {
    for (const [w, h] of [
      [1080, 1920],
      [1920, 1080],
    ] as const) {
      it(`passes a clean ${view} clip at ${w}x${h}`, () => {
        const { q } = runOpts({ view, width: w, height: h, noise: 1.5 });
        expect(q.ok).toBe(true);
        expect(q.visibleFrac).toBe(1);
        expect(q.effectiveFps).toBeCloseTo(30, 6);
        expect(q.cutOff).toBe(false);
        expect(q.tiltedCamera).toBe(false);
        expect(q.problems).toEqual(view === 'diagonal' ? ['diagonal_view'] : []);
      });
    }
  }

  it('reports diagonal_view without blocking ok', () => {
    const { q } = runOpts({ view: 'diagonal' });
    expect(q.ok).toBe(true);
    expect(q.problems).toContain('diagonal_view');
  });

  it('flags low visibility under heavy dropout', () => {
    const { q } = runOpts({ view: 'frontal', dropout: 0.5, seed: 4 });
    expect(q.visibleFrac).toBeLessThan(0.7);
    expect(q.ok).toBe(false);
    expect(q.problems).toContain('low_visibility');
  });

  it('tolerates light dropout thanks to gap interpolation', () => {
    const { q } = runOpts({ view: 'frontal', dropout: 0.1, seed: 4 });
    expect(q.visibleFrac).toBeGreaterThan(0.9);
    expect(q.ok).toBe(true);
  });

  it('counts frames with no pose against visibility and fps', () => {
    const n = makeSquatTrack({ view: 'lateral' }).frames.length;
    // Keep 1 frame in 5: runs of 4 missing frames are longer than the interpolation limit (3).
    const dropFrames = Array.from({ length: n }, (_, i) => i).filter((i) => i % 5 !== 0);
    const { q } = runOpts({ view: 'lateral', dropFrames });
    expect(q.visibleFrac).toBeCloseTo(0.2, 1);
    expect(q.effectiveFps).toBeCloseTo(6, 0);
    expect(q.problems).toEqual(expect.arrayContaining(['low_visibility', 'low_fps']));
    expect(q.ok).toBe(false);
  });

  it('flags low fps for a clip sampled too slowly', () => {
    const { q } = runOpts({ view: 'lateral', fps: 12 });
    expect(q.visibleFrac).toBe(1);
    expect(q.effectiveFps).toBeCloseTo(12, 6);
    expect(q.problems).toEqual(['low_fps']);
    expect(q.ok).toBe(false);
  });

  describe('frame-rate threshold is not tripped by rounding', () => {
    /** Rounds every timestamp to integer ms, as extractFrames does (SPEC §4). */
    const intMs = (track: PoseTrack): PoseTrack => ({
      ...track,
      frames: track.frames.map((f) => ({ ...f, t: Math.round(f.t) })),
    });

    for (const fps of [15, 30, 24, 29.97]) {
      it(`passes a clip sampled exactly at the threshold (${fps} Hz, integer ms)`, () => {
        const track = intMs(makeSquatTrack({ view: 'lateral', fps }));
        const px = preprocess(track);
        const cal = calibrate(px);
        const q = assessQuality(px, detectView(px, cal), cal, { minEffectiveFps: fps });
        expect(q.effectiveFps).toBeCloseTo(fps, 2);
        expect(q.problems).not.toContain('low_fps');
        expect(q.ok).toBe(true);
      });
    }

    it('passes the default 15 fps gate at exactly 15 Hz with integer-ms timestamps', () => {
      const { q } = run(intMs(makeSquatTrack({ view: 'lateral', fps: 15 })));
      expect(q.problems).toEqual([]);
      expect(q.ok).toBe(true);
    });

    it('still fails a clip genuinely below the threshold', () => {
      const { q } = run(intMs(makeSquatTrack({ view: 'lateral', fps: 14.8 })));
      expect(q.problems).toEqual(['low_fps']);
      expect(q.ok).toBe(false);
    });
  });

  it('flags cut-off feet', () => {
    const { q } = run(shiftY(makeSquatTrack({ view: 'frontal' }), 0.2));
    expect(q.cutOff).toBe(true);
    expect(q.problems).toContain('cut_off');
    expect(q.ok).toBe(false);
  });

  it('flags a cut-off head', () => {
    const { q } = run(shiftY(makeSquatTrack({ view: 'frontal' }), -0.2));
    expect(q.cutOff).toBe(true);
    expect(q.ok).toBe(false);
  });

  it('flags feet that are outside the frame even with high visibility', () => {
    const track = pushOut(makeSquatTrack({ view: 'frontal' }), [L_ANKLE, L_HEEL]);
    expect(run(track).q.cutOff).toBe(true);
  });

  it('does not treat hidden heels as cut off when the ankles are visible', () => {
    const track = hide(makeSquatTrack({ view: 'frontal' }), [L_HEEL, R_HEEL]);
    expect(run(track).q.cutOff).toBe(false);
  });

  it('only needs the camera-side chain in lateral view (far hip/shoulder hidden)', () => {
    const track = hide(makeSquatTrack({ view: 'lateral', side: 'left' }), [R_HIP, R_SHOULDER]);
    const { q } = run(track, lateralView);
    expect(q.visibleFrac).toBe(1);
    expect(q.ok).toBe(true);
  });

  it('detects tilt from the camera-side trunk when the far side is hidden', () => {
    const track = makeSquatTrack({ view: 'lateral', side: 'left', tiltDeg: 15 });
    const px = preprocess(track);
    const cal = calibrate(px); // calibrated on the full figure; tilt check on the hidden one
    const hiddenPx = preprocess(hide(track, [R_HIP, R_SHOULDER]));
    expect(assessQuality(hiddenPx, lateralView, cal).tiltedCamera).toBe(true);
  });

  it('flags a missing nose', () => {
    const track = pushOut(makeSquatTrack({ view: 'frontal' }), [NOSE]);
    expect(run(track).q.cutOff).toBe(true);
  });

  it('checks only the camera-side foot in lateral view', () => {
    const track = makeSquatTrack({ view: 'lateral', side: 'left' });
    expect(run(pushOut(track, [R_ANKLE, R_HEEL]), lateralView).q.cutOff).toBe(false);
    expect(run(pushOut(track, [L_ANKLE, L_HEEL]), lateralView).q.cutOff).toBe(true);
  });

  it('tolerates a brief cut-off below the 20% threshold', () => {
    const track = makeSquatTrack({ view: 'frontal' });
    const n = track.frames.length;
    const k = Math.floor(n * 0.1);
    const brief = shiftY({ ...track, frames: track.frames.slice(0, k) }, 0.2);
    const mixed = { ...track, frames: [...brief.frames, ...track.frames.slice(k)] };
    expect(run(mixed).q.cutOff).toBe(false);
  });

  it('flags a tilted camera without blocking ok', () => {
    const { q } = runOpts({ view: 'lateral', tiltDeg: 15 });
    expect(q.tiltedCamera).toBe(true);
    expect(q.problems).toEqual(['tilted_camera']);
    expect(q.ok).toBe(true);
    expect(runOpts({ view: 'frontal', tiltDeg: -15 }).q.tiltedCamera).toBe(true);
    expect(runOpts({ view: 'lateral', tiltDeg: 5 }).q.tiltedCamera).toBe(false);
  });

  it('reports no_pose when nothing is ever detected', () => {
    const track = makeSquatTrack({ reps: 1 });
    const empty = { ...track, frames: track.frames.map((f) => ({ ...f, lm: null, world: null })) };
    const { view, q } = run(empty);
    expect(view.view).toBe('unknown');
    expect(q).toEqual({
      ok: false,
      visibleFrac: 0,
      effectiveFps: 0,
      cutOff: false,
      tiltedCamera: false,
      problems: ['no_pose', 'low_visibility', 'low_fps'],
    });
  });

  it('handles an empty track', () => {
    const q = assessQuality(
      { width: 100, height: 100, sampleHz: 30, frames: [] },
      lateralView,
      null,
    );
    expect(q.ok).toBe(false);
    expect(q.problems).toContain('no_pose');
  });

  it('accepts threshold overrides', () => {
    const track = makeSquatTrack({ view: 'lateral', fps: 12 });
    const px = preprocess(track);
    const cal = calibrate(px);
    expect(assessQuality(px, detectView(px, cal), cal, { minEffectiveFps: 10 }).ok).toBe(true);
  });
});
