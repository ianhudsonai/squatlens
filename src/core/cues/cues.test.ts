import { describe, expect, it } from 'vitest';
import type { Metric, QualityReport, RepReport, SetReport } from '../types';
import { CUE_IDS, generateCues } from './generate';
import { MESSAGES, renderCue } from './render';
import { LANGS } from './types';

const NONE = { value: null, confidence: null, reason: 'wrong_view' } as const;
const okQuality: QualityReport = {
  ok: true,
  visibleFrac: 1,
  effectiveFps: 30,
  cutOff: false,
  tiltedCamera: false,
  problems: [],
};

function rep(index: number, m: Partial<Omit<RepReport, 'rep'>> = {}): RepReport {
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
    depth: { ...NONE },
    trunk: { ...NONE },
    tempo: { ...NONE },
    valgus: { ...NONE },
    asymmetry: { ...NONE },
    ...m,
  };
}

function report(o: Partial<Omit<SetReport, 'cues'>> = {}): Omit<SetReport, 'cues'> {
  return {
    version: 1,
    quality: okQuality,
    view: { view: 'frontal', side: null, ratio2d: 1, yawDeg: 0, confidence: 'high' },
    calibration: null,
    reps: [],
    velocityLoss: { value: null, confidence: null, reason: 'no_reps' },
    ...o,
  };
}

const tempo = (descentS: number, ascentS: number): RepReport['tempo'] => ({
  value: { descentS, pauseS: 0, ascentS, ascentHipVel: 1 },
  confidence: 'high',
});
const asym = (hipShiftNorm: number, hipHeightDiffNorm: number): RepReport['asymmetry'] => ({
  value: { hipShiftNorm, hipHeightDiffNorm, kneeFlexDiffDeg: null, flagged: true },
  confidence: 'medium',
});
const ids = (r: Omit<SetReport, 'cues'>) => generateCues(r).map((c) => c.id);

describe('generateCues', () => {
  it('no reps -> nodata.reps', () => {
    expect(ids(report())).toEqual(['nodata.reps']);
  });

  it('unknown view and a tilted camera are reported ahead of the reps', () => {
    const r = report({
      view: { view: 'unknown', side: null, ratio2d: null, yawDeg: null, confidence: null },
      quality: { ...okQuality, tiltedCamera: true, problems: ['tilted_camera'] },
      reps: [rep(0, { tempo: tempo(1, 1) })],
    });
    const cues = generateCues(r);
    expect(cues.map((c) => c.id)).toEqual([
      'quality.tilted_camera',
      'view.unknown',
      'tempo.summary',
    ]);
    expect(cues[0]!.severity).toBe('info');
  });

  it('a null metric the view enables gives nodata, wrong_view gives nothing', () => {
    const lowVis: Metric<never> = { value: null, confidence: null, reason: 'low_visibility' };
    const r = report({ reps: [rep(0, { depth: lowVis, trunk: { ...NONE } })] });
    expect(generateCues(r)).toEqual([
      { id: 'nodata.depth', repIndex: 0, severity: 'info', params: {} },
    ]);
  });

  it('names the hip shift side, or falls back to asym.uneven', () => {
    const r = report({
      reps: [rep(0, { asymmetry: asym(-0.2, 0) }), rep(1, { asymmetry: asym(0.02, 0.1) })],
    });
    expect(generateCues(r)).toEqual([
      { id: 'asym.shift', repIndex: 0, severity: 'warn', params: { side: 'right' } },
      { id: 'asym.uneven', repIndex: 1, severity: 'warn', params: {} },
    ]);
  });

  it('tempo summary uses medians, fatigue.loss fires at the threshold', () => {
    const reps = [tempo(1.0, 0.6), tempo(1.24, 0.8), tempo(3, 2)].map((t, i) =>
      rep(i, { tempo: t }),
    );
    const at = (loss: number) =>
      generateCues(report({ reps, velocityLoss: { value: loss, confidence: 'high' } }));
    expect(at(0.19).map((c) => c.id)).toEqual(['tempo.summary']);
    const cues = at(0.256);
    expect(cues.map((c) => c.params)).toEqual([{ d: 1.2, a: 0.8 }, { pct: 26 }]);
    expect(renderCue(cues[0]!, 'pt-BR')).toBe('Descida em 1,2 s e subida em 0,8 s.');
    expect(renderCue(cues[1]!, 'en')).toBe(
      'Your ascent speed dropped 26% from the first to the last rep.',
    );
  });

  it('respects option overrides', () => {
    const r = report({ reps: [rep(0, { tempo: tempo(0.8, 1) })] });
    expect(generateCues(r).map((c) => c.id)).not.toContain('tempo.fast_descent');
    expect(generateCues(r, { fastDescentS: 1 }).map((c) => c.id)).toContain('tempo.fast_descent');
  });
});

describe('translations', () => {
  const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

  it('every CueId has a non-empty text in every language, and no extras', () => {
    for (const lang of LANGS) {
      const keys = Object.keys(MESSAGES[lang].cues).sort();
      expect(keys).toEqual([...CUE_IDS].sort());
      for (const id of CUE_IDS) expect(MESSAGES[lang].cues[id].trim()).not.toBe('');
    }
  });

  it('languages use the same placeholders for each cue', () => {
    for (const id of CUE_IDS) {
      expect(placeholders(MESSAGES.en.cues[id]), id).toEqual(
        placeholders(MESSAGES['pt-BR'].cues[id]),
      );
    }
  });

  it('renders the SPEC §6 pt-BR texts and translates conf/side params', () => {
    const c = (id: string, params = {}) => ({ id, repIndex: 0, severity: 'warn' as const, params });
    expect(renderCue(c('depth.below'), 'pt-BR')).toBe(
      'Boa profundidade: o quadril passou da linha do joelho.',
    );
    expect(renderCue(c('valgus.flag', { conf: 'medium' }), 'pt-BR')).toBe(
      'Seus joelhos tenderam a entrar (confiança média): pense em empurrar o chão para fora.',
    );
    expect(renderCue(c('asym.shift', { side: 'left' }), 'pt-BR')).toBe(
      'O quadril desviou para a esquerda no fundo.',
    );
    expect(renderCue(c('asym.shift', { side: 'right' }), 'en')).toBe(
      'Your hips shifted to the right at the bottom.',
    );
  });

  it('unknown ids render as the id; missing params stay as placeholders', () => {
    const c = (id: string, params = {}) => ({
      id,
      repIndex: null,
      severity: 'info' as const,
      params,
    });
    expect(renderCue(c('future.cue'), 'en')).toBe('future.cue');
    expect(renderCue(c('toString'), 'en')).toBe('toString');
    expect(renderCue(c('tempo.summary', { d: 1 }), 'en')).toBe('Down in 1 s and up in {a} s.');
    expect(renderCue(c('valgus.flag', { conf: 'toString' }), 'en')).toContain('(toString');
  });
});
