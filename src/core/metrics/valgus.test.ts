import { describe, expect, it } from 'vitest';
import { makeSquatTrack, repSchedule } from '../../../test/synthetic/makeSquatTrack';
import type { SquatOptions } from '../../../test/synthetic/makeSquatTrack';
import { calibrate } from '../calibration';
import {
  L_ANKLE,
  L_FOOT_INDEX,
  L_HEEL,
  L_HIP,
  L_KNEE,
  R_ANKLE,
  R_FOOT_INDEX,
  R_HEEL,
  R_KNEE,
} from '../landmarks';
import { preprocess } from '../smoothing';
import type { PoseTrack, Rep } from '../types';
import { DEFAULTS, fppaDeg, kneeAnkleRatio, valgus } from './valgus';

/** Ground-truth Rep for rep `r` of a synthetic track (no dependency on reps.ts). */
function truthRep(opts: Partial<SquatOptions>, r = 0): Rep {
  const fps = opts.fps ?? 30;
  const s = repSchedule(opts)[r]!;
  const fr = (t: number) => Math.round((t * fps) / 1000);
  const bottomT = (s.bottomStartT + s.bottomEndT) / 2;
  return {
    index: r,
    startFrame: fr(s.startT),
    bottomFrame: fr(bottomT),
    endFrame: fr(s.endT),
    startT: s.startT,
    bottomT,
    endT: s.endT,
    depthNorm: 1,
  };
}

function run(opts: Partial<SquatOptions>, edit?: (t: PoseTrack) => void) {
  const o: Partial<SquatOptions> = { view: 'frontal', ...opts };
  const track = makeSquatTrack(o);
  edit?.(track);
  const px = preprocess(track);
  const cal = calibrate(px)!;
  return { px, cal, res: valgus(px, truthRep(o), cal) };
}

describe('fppaDeg / kneeAnkleRatio', () => {
  it('is small and lateral when standing with feet wider than hips; ratio ~1', () => {
    // The figure's ankles are wider than its hips and the knees sit over the ankles, so the
    // knee is slightly lateral of the hip-ankle line: negative FPPA.
    const { px } = run({});
    const f = px.frames[0]!;
    for (const side of ['left', 'right'] as const) {
      expect(fppaDeg(f, side)!).toBeLessThan(0);
      expect(fppaDeg(f, side)!).toBeGreaterThan(-12);
    }
    expect(kneeAnkleRatio(f)!).toBeCloseTo(1, 1);
  });

  it('is positive for a medial knee on both legs, facing or back to the camera', () => {
    for (const yawDeg of [0, 180]) {
      const o = { valgusDeg: 20, yawDeg };
      const { px } = run(o);
      const bottom = px.frames[truthRep({ view: 'frontal', ...o }).bottomFrame - 8]!;
      expect(fppaDeg(bottom, 'left')!).toBeGreaterThan(0);
      expect(fppaDeg(bottom, 'right')!).toBeGreaterThan(0);
    }
  });
});

describe('valgus', () => {
  it('does not flag a neutral squat', () => {
    const { res } = run({ noise: 1.5 });
    expect(res.value).not.toBeNull();
    expect(res.value!.flagged).toBe(false);
    expect(res.value!.fppaChangeDeg.left!).toBeLessThan(DEFAULTS.fppaFlagDeg);
    expect(res.value!.fppaChangeDeg.right!).toBeLessThan(DEFAULTS.fppaFlagDeg);
    expect(Math.abs(res.value!.kneeAnkleRatioChange!)).toBeLessThan(0.05);
    expect(res.confidence).toBe('medium');
  });

  it('does not flag 5° of knee cave', () => {
    const { res } = run({ valgusDeg: 5, noise: 1 });
    expect(res.value!.flagged).toBe(false);
    expect(res.value!.kneeAnkleRatioChange!).toBeLessThan(-0.05); // knees do close a bit
  });

  it('flags 15° of knee cave on both signals', () => {
    const { res } = run({ valgusDeg: 15, noise: 1 });
    expect(res.value!.flagged).toBe(true);
    expect(res.value!.fppaChangeDeg.left!).toBeGreaterThan(DEFAULTS.fppaFlagDeg);
    expect(res.value!.fppaChangeDeg.right!).toBeGreaterThan(DEFAULTS.fppaFlagDeg);
    expect(res.value!.kneeAnkleRatioChange!).toBeLessThan(DEFAULTS.ratioFlag);
  });

  it('flags one-sided cave from the FPPA of that leg', () => {
    // Pull only the left knee medially (toward image left, where the right leg is).
    const o = { valgusDeg: 0 };
    const sched = truthRep({ view: 'frontal', ...o });
    const { res } = run(o, (t) => {
      t.frames.forEach((f, i) => {
        if (!f.lm || i < sched.startFrame || i > sched.endFrame) return;
        const k = Math.sin(
          (Math.PI * (i - sched.startFrame)) / (sched.endFrame - sched.startFrame),
        );
        f.lm[L_KNEE]!.x -= (0.08 * k * 1080) / t.width;
      });
    });
    expect(res.value!.fppaChangeDeg.left!).toBeGreaterThan(DEFAULTS.fppaFlagDeg);
    expect(res.value!.fppaChangeDeg.right!).toBeLessThan(DEFAULTS.fppaFlagDeg);
    expect(res.value!.flagged).toBe(true);
  });

  it('never reports confidence above medium', () => {
    for (const valgusDeg of [0, 15]) {
      const { res } = run({ valgusDeg });
      expect(res.confidence).toBe('medium');
    }
  });

  it('does not flag a wide stance with toes out (knees spreading over the feet)', () => {
    // Knees track outward during the squat, and the feet are set wider than the generator's
    // default stance (ankles, heels and toes moved outward in the image).
    const { res } = run({ valgusDeg: -12, noise: 1 }, (t) => {
      for (const f of t.frames) {
        if (!f.lm) continue;
        for (const k of [L_ANKLE, L_HEEL, L_FOOT_INDEX]) f.lm[k]!.x += 60 / t.width;
        for (const k of [R_ANKLE, R_HEEL, R_FOOT_INDEX]) f.lm[k]!.x -= 60 / t.width;
      }
    });
    expect(res.value!.flagged).toBe(false);
    expect(res.value!.fppaChangeDeg.left!).toBeLessThan(0);
    expect(res.value!.fppaChangeDeg.right!).toBeLessThan(0);
    expect(res.value!.kneeAnkleRatioChange!).toBeGreaterThan(0);
  });

  it('does not flag a pure hip shift', () => {
    expect(run({ hipShift: 0.2 }).res.value!.flagged).toBe(false);
    expect(run({ hipShift: -0.2 }).res.value!.flagged).toBe(false);
  });

  it('returns null (low_visibility) when the knees are not visible during the rep', () => {
    const o = {};
    const rep = truthRep({ view: 'frontal' });
    const { res } = run(o, (t) => {
      t.frames.forEach((f, i) => {
        if (!f.lm || i < rep.startFrame || i > rep.endFrame) return;
        f.lm[L_KNEE]!.visibility = 0.1;
        f.lm[R_KNEE]!.visibility = 0.1;
      });
    });
    expect(res).toEqual({ value: null, confidence: null, reason: 'low_visibility' });
  });

  it('is low confidence when only one leg is measurable', () => {
    const rep = truthRep({ view: 'frontal' });
    const { res } = run({}, (t) => {
      t.frames.forEach((f, i) => {
        if (!f.lm || i < rep.startFrame || i > rep.endFrame) return;
        f.lm[R_KNEE]!.visibility = 0.1;
      });
    });
    expect(res.value).not.toBeNull();
    expect(res.value!.fppaChangeDeg.right).toBeNull();
    expect(res.value!.kneeAnkleRatioChange).toBeNull();
    expect(res.value!.fppaChangeDeg.left).not.toBeNull();
    expect(res.confidence).toBe('low');
  });

  it('returns null (insufficient_frames) for a rep with no depth', () => {
    const o = { reps: 1 };
    const px = preprocess(makeSquatTrack({ view: 'frontal', ...o }));
    const cal = calibrate(px)!;
    const rep: Rep = {
      ...truthRep({ view: 'frontal', ...o }),
      startFrame: 0,
      bottomFrame: 5,
      endFrame: 10,
    };
    expect(valgus(px, rep, cal).reason).toBe('insufficient_frames');
  });

  it('gives the same answer in 9:16 and 16:9 (aspect-ratio regression)', () => {
    for (const valgusDeg of [0, 15]) {
      const a = run({ valgusDeg, width: 1080, height: 1920 }).res.value!;
      const b = run({ valgusDeg, width: 1920, height: 1080 }).res.value!;
      expect(b.flagged).toBe(a.flagged);
      expect(Math.abs(b.fppaChangeDeg.left! - a.fppaChangeDeg.left!)).toBeLessThan(1.5);
      expect(Math.abs(b.fppaChangeDeg.right! - a.fppaChangeDeg.right!)).toBeLessThan(1.5);
      expect(Math.abs(b.kneeAnkleRatioChange! - a.kneeAnkleRatioChange!)).toBeLessThan(0.01);
    }
  });

  it('ignores a single glitch frame', () => {
    const rep = truthRep({ view: 'frontal' });
    const { res } = run({}, (t) => {
      const f = t.frames[rep.bottomFrame - 10]!;
      f.lm![L_KNEE]!.x -= 120 / t.width; // one-frame medial jump of the left knee
    });
    expect(res.value!.flagged).toBe(false);
  });

  it('skips the knee/ankle ratio with the feet together, keeping FPPA', () => {
    const { res } = run({ valgusDeg: 15 }, (t) => {
      for (const f of t.frames) {
        if (!f.lm) continue;
        const mx = (f.lm[L_ANKLE]!.x + f.lm[R_ANKLE]!.x) / 2;
        f.lm[L_ANKLE]!.x = mx + 10 / t.width;
        f.lm[R_ANKLE]!.x = mx - 10 / t.width;
      }
    });
    expect(res.value!.kneeAnkleRatioChange).toBeNull();
    expect(res.value!.fppaChangeDeg.left).not.toBeNull();
  });

  it('still measures when the hips are hidden at the bottom frame only', () => {
    const rep = truthRep({ view: 'frontal' });
    const { res } = run({ valgusDeg: 15 }, (t) => {
      for (const i of [rep.bottomFrame - 2, rep.bottomFrame, rep.bottomFrame + 2]) {
        t.frames[i]!.lm![L_HIP]!.visibility = 0.1;
      }
    });
    expect(res.value!.flagged).toBe(true);
  });

  it('is deterministic', () => {
    expect(run({ valgusDeg: 8, noise: 2 }).res).toEqual(run({ valgusDeg: 8, noise: 2 }).res);
  });
});
