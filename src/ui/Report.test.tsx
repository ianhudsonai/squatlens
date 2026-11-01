// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeSquatTrack } from '../../test/synthetic/makeSquatTrack';
import { analyzeSet } from '../core/analyze';
import type { Lang } from '../core/cues';
import type { PoseTrack, RepReport, SetReport } from '../core/types';
import { STRINGS } from './i18n';
import { Report } from './Report';

afterEach(cleanup);

const lateralTrack = makeSquatTrack({ view: 'lateral', reps: 3, noise: 1 });
const lateral = analyzeSet(lateralTrack);
const frontalTrack = makeSquatTrack({ view: 'frontal', reps: 2, noise: 1 });
const frontal = analyzeSet(frontalTrack);

function show(report: SetReport, track: PoseTrack, lang: Lang = 'pt-BR') {
  return render(
    <Report report={report} track={track} lang={lang} s={STRINGS[lang]} baseName="clip" />,
  );
}

describe('Report', () => {
  it('lateral set: view badge, one card per rep, chart with shaded reps, cues', () => {
    show(lateral, lateralTrack);
    expect(screen.getByTestId('view-badge').textContent).toContain('De lado');
    expect(screen.queryByTestId('quality-banner')).toBeNull();

    const cards = screen.getAllByTestId('rep-card');
    expect(cards).toHaveLength(3);
    const first = within(cards[0]!);
    expect(first.getByTestId('metric-depth').textContent).toContain('Abaixo do paralelo');
    expect(first.getByTestId('metric-trunk')).toBeTruthy();
    expect(first.getByTestId('metric-tempo').textContent).toMatch(/descida \d+,\d s/);
    // Frontal-only metrics are not measured from the side and are left out.
    expect(first.queryByTestId('metric-valgus')).toBeNull();
    expect(first.queryByTestId('metric-asymmetry')).toBeNull();

    expect(screen.getAllByTestId('chart-rep')).toHaveLength(3);
    expect(screen.getAllByTestId('chart-bottom')).toHaveLength(3);
    expect(screen.getByRole('img', { name: /Altura do quadril/ })).toBeTruthy();

    const cues = within(screen.getByTestId('cue-list')).getAllByRole('listitem');
    expect(cues).toHaveLength(lateral.cues.length);
    expect(cues[0]!.textContent).toContain('Rep 1: Boa profundidade');
    expect(screen.getByRole('button', { name: 'Exportar análise (JSON)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Exportar landmarks (JSON)' })).toBeTruthy();
  });

  it('frontal set shows knees and asymmetry, not depth or trunk', () => {
    show(frontal, frontalTrack);
    expect(screen.getByTestId('view-badge').textContent).toContain('De frente');
    const card = within(screen.getAllByTestId('rep-card')[0]!);
    expect(card.getByTestId('metric-valgus')).toBeTruthy();
    expect(card.getByTestId('metric-asymmetry')).toBeTruthy();
    expect(card.queryByTestId('metric-depth')).toBeNull();
    expect(card.queryByTestId('metric-trunk')).toBeNull();
  });

  it('renders null metrics explicitly as "sem dados" with the reason', () => {
    const rep = lateral.reps[0]!;
    const nulled: RepReport = {
      ...rep,
      depth: { value: null, confidence: null, reason: 'low_visibility' },
      trunk: { value: null, confidence: null, reason: 'insufficient_frames' },
    };
    show({ ...lateral, reps: [nulled] }, lateralTrack);
    const card = within(screen.getByTestId('rep-card'));
    expect(card.getByTestId('metric-depth').textContent).toContain(
      'sem dados (pontos do corpo pouco visíveis)',
    );
    expect(card.getByTestId('metric-trunk').textContent).toContain(
      'sem dados (quadros insuficientes)',
    );
    expect(card.getByTestId('metric-tempo').textContent).not.toContain('sem dados');
  });

  it('bad quality: banner with the problems, no metrics, problems not repeated as tips', () => {
    const bad: SetReport = {
      ...lateral,
      quality: {
        ...lateral.quality,
        ok: false,
        problems: ['low_visibility', 'cut_off'],
      },
      cues: [
        { id: 'quality.low_visibility', repIndex: null, severity: 'warn', params: {} },
        { id: 'quality.cut_off', repIndex: null, severity: 'warn', params: {} },
      ],
    };
    show(bad, lateralTrack);
    const banner = screen.getByRole('alert');
    expect(banner.textContent).toContain('Não deu para analisar este vídeo');
    const items = within(banner).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[1]!.textContent).toContain('Parte do corpo saiu do quadro');
    expect(screen.queryAllByTestId('rep-card')).toHaveLength(0);
    expect(screen.queryByTestId('chart-rep')).toBeNull();
    expect(screen.queryByTestId('velocity-loss')).toBeNull();
    expect(screen.queryByTestId('cue-list')).toBeNull();
    // Exports stay available for debugging a bad clip.
    expect(screen.getByRole('button', { name: 'Exportar análise (JSON)' })).toBeTruthy();
  });

  it('a faster last rep reads as no loss, not a negative loss', () => {
    show({ ...lateral, velocityLoss: { value: -0.15, confidence: 'high' } }, lateralTrack);
    const text = screen.getByTestId('velocity-loss').textContent!;
    expect(text).toContain('15% mais rápido');
    expect(text).not.toContain('-');
  });

  it('a knee with no FPPA shows a dash without a degree sign', () => {
    const rep = frontal.reps[0]!;
    const v = rep.valgus.value!;
    const r: RepReport = {
      ...rep,
      valgus: { ...rep.valgus, value: { ...v, fppaChangeDeg: { left: null, right: 12 } } },
    };
    show({ ...frontal, reps: [r] }, frontalTrack);
    const t = screen.getByTestId('metric-valgus').textContent!;
    expect(t).toContain('esq. —, dir. 12°');
  });

  it('non-blocking problems show a warning next to the metrics', () => {
    const warned: SetReport = {
      ...lateral,
      quality: { ...lateral.quality, problems: ['tilted_camera'], tiltedCamera: true },
    };
    show(warned, lateralTrack);
    expect(screen.getByTestId('quality-warning').textContent).toContain('inclinada');
    expect(screen.getAllByTestId('rep-card')).toHaveLength(3);
  });

  it('no reps: says so instead of an empty list', () => {
    show({ ...lateral, reps: [], cues: [] }, lateralTrack);
    expect(screen.getByTestId('no-reps')).toBeTruthy();
    expect(screen.getByText('Nenhuma dica.')).toBeTruthy();
  });

  it('English strings and cue text', () => {
    show(lateral, lateralTrack, 'en');
    expect(screen.getByTestId('view-badge').textContent).toContain('Side');
    expect(screen.getAllByTestId('rep-card')[0]!.textContent).toContain('Below parallel');
    expect(screen.getByRole('button', { name: 'Export analysis (JSON)' })).toBeTruthy();
    expect(screen.getByTestId('cue-list').textContent).toContain('Rep 1:');
  });

  it('exports the report and the landmarks as JSON files', () => {
    const created: Blob[] = [];
    const names: string[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => {
      created.push(b);
      return 'blob:x';
    });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });
    show(lateral, lateralTrack);
    screen.getByRole('button', { name: 'Exportar análise (JSON)' }).click();
    screen.getByRole('button', { name: 'Exportar landmarks (JSON)' }).click();
    expect(names).toEqual(['clip.analysis.json', 'clip.pose.json']);
    expect(created.map((b) => b.type)).toEqual(['application/json', 'application/json']);
    click.mockRestore();
  });
});
