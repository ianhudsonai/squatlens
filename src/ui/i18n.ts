/**
 * UI strings (SPEC §7). Cue texts live in core (`renderCue`); everything else the page shows
 * is here. PT-BR is the default; the choice is persisted in localStorage.
 */
import { LANGS, type Lang } from '../core/cues';
import type { Confidence, DepthClass, NullReason, QualityReport, View } from '../core/types';
import type { ModelVariant } from '../pose/options';

export type { Lang };
export { LANGS };

type Problem = QualityReport['problems'][number];

export interface UiStrings {
  langName: string;
  langSwitch: string;
  tagline: string;
  privacy: string;
  disclaimer: string;
  howTo: string;
  model: string;
  models: Record<ModelVariant, string>;
  pickVideo: string;
  pickAnother: string;
  downloadingModel: (pct: string) => string;
  openingVideo: string;
  analyzingFrames: (done: number, total: number) => string;
  cancel: string;
  error: (msg: string) => string;
  canceled: string;
  results: string;
  viewBadge: string;
  views: Record<View, string>;
  sides: { left: string; right: string };
  cameraSide: (side: string) => string;
  confidence: string;
  confidences: Record<Confidence, string>;
  qualityBad: string;
  qualityWarn: string;
  problems: Record<Problem, string>;
  quality: (visiblePct: number, fps: string) => string;
  reps: string;
  repN: (n: number) => string;
  noReps: string;
  noData: string;
  reasons: Record<NullReason, string>;
  metrics: {
    depth: string;
    trunk: string;
    tempo: string;
    valgus: string;
    asymmetry: string;
  };
  depthClasses: Record<DepthClass, string>;
  thighAngle: (deg: string) => string;
  trunkDiff: (deg: string) => string;
  trunkDetail: (trunk: string, shin: string) => string;
  tempoDetail: (d: string, p: string, a: string) => string;
  valgusFlagged: string;
  valgusOk: string;
  fppa: (left: string, right: string) => string;
  asymFlagged: string;
  asymOk: string;
  asymDetail: (shiftPct: string) => string;
  velocityLoss: string;
  velocityLossValue: (pct: string) => string;
  chartTitle: string;
  chartDesc: (reps: number) => string;
  chartTime: string;
  chartEmpty: string;
  cues: string;
  noCues: string;
  exportReport: string;
  exportLandmarks: string;
  decimal: string;
}

const ptBR: UiStrings = {
  langName: 'Português',
  langSwitch: 'Idioma',
  tagline: 'Análise do agachamento direto no navegador.',
  privacy: 'Seu vídeo nunca sai do seu aparelho: tudo é processado aqui, sem upload.',
  disclaimer:
    'Feedback de movimento, não é dispositivo médico nem substitui treinador ou fisioterapeuta.',
  howTo:
    'Filme uma série com o corpo inteiro no quadro: de lado para profundidade e tronco, de frente para os joelhos.',
  model: 'Modelo',
  models: { lite: 'Lite (rápido)', full: 'Full (equilibrado)', heavy: 'Heavy (mais preciso)' },
  pickVideo: 'Escolher vídeo',
  pickAnother: 'Analisar outro vídeo',
  downloadingModel: (pct) => `Baixando o modelo… ${pct}`,
  openingVideo: 'Abrindo o vídeo…',
  analyzingFrames: (d, t) => `Analisando quadros… ${d}/${t}`,
  cancel: 'Cancelar',
  error: (m) => `Erro: ${m}`,
  canceled: 'Análise cancelada.',
  results: 'Resultado',
  viewBadge: 'Ângulo da câmera',
  views: { lateral: 'De lado', frontal: 'De frente', diagonal: 'Diagonal', unknown: 'Indefinido' },
  sides: { left: 'esquerdo', right: 'direito' },
  cameraSide: (s) => `lado ${s} para a câmera`,
  confidence: 'Confiança',
  confidences: { low: 'baixa', medium: 'média', high: 'alta' },
  qualityBad: 'Não deu para analisar este vídeo',
  qualityWarn: 'Atenção',
  problems: {
    no_pose: 'Nenhuma pessoa detectada.',
    low_visibility: 'Corpo pouco visível na maior parte do vídeo.',
    low_fps: 'Poucos quadros úteis por segundo.',
    cut_off: 'Cabeça ou pés saem do quadro.',
    diagonal_view: 'Câmera na diagonal: só o ritmo é medido.',
    tilted_camera: 'A câmera parece inclinada.',
  },
  quality: (v, f) => `${v}% dos quadros visíveis, ${f} quadros úteis/s`,
  reps: 'Repetições',
  repN: (n) => `Rep ${n}`,
  noReps: 'Nenhuma repetição completa detectada.',
  noData: 'sem dados',
  reasons: {
    low_visibility: 'pontos do corpo pouco visíveis',
    wrong_view: 'não medido neste ângulo',
    insufficient_frames: 'quadros insuficientes',
    no_reps: 'sem repetições',
  },
  metrics: {
    depth: 'Profundidade',
    trunk: 'Tronco',
    tempo: 'Ritmo',
    valgus: 'Joelhos',
    asymmetry: 'Assimetria',
  },
  depthClasses: {
    below: 'Abaixo do paralelo',
    parallel: 'No paralelo',
    borderline: 'No limite',
    above: 'Acima do paralelo',
  },
  thighAngle: (d) => `coxa a ${d}° da horizontal`,
  trunkDiff: (d) => `tronco − canela: ${d}°`,
  trunkDetail: (t, s) => `tronco ${t}° e canela ${s}° da vertical`,
  tempoDetail: (d, p, a) => `descida ${d} s · pausa ${p} s · subida ${a} s`,
  valgusFlagged: 'Joelhos entraram',
  valgusOk: 'Sem valgo marcado',
  fppa: (l, r) => `variação do ângulo do joelho: esq. ${l}°, dir. ${r}°`,
  asymFlagged: 'Desigual',
  asymOk: 'Simétrico',
  asymDetail: (s) => `desvio do quadril: ${s}% do fêmur`,
  velocityLoss: 'Perda de velocidade (quadril)',
  velocityLossValue: (p) => `${p}% da primeira para a última rep`,
  chartTitle: 'Altura do quadril ao longo do tempo',
  chartDesc: (n) =>
    `Gráfico da altura do quadril; ${n} repetição(ões) sombreada(s), com o fundo de cada uma marcado.`,
  chartTime: 'tempo (s)',
  chartEmpty: 'Quadril não detectado: sem gráfico.',
  cues: 'Dicas',
  noCues: 'Nenhuma dica.',
  exportReport: 'Exportar análise (JSON)',
  exportLandmarks: 'Exportar landmarks (JSON)',
  decimal: ',',
};

const en: UiStrings = {
  langName: 'English',
  langSwitch: 'Language',
  tagline: 'Squat analysis right in your browser.',
  privacy: 'Your video never leaves your device: everything runs here, no upload.',
  disclaimer: 'Movement feedback, not a medical device, and no substitute for a coach or physio.',
  howTo:
    'Film one set with your whole body in frame: from the side for depth and trunk, from the front for knees.',
  model: 'Model',
  models: { lite: 'Lite (fast)', full: 'Full (balanced)', heavy: 'Heavy (most accurate)' },
  pickVideo: 'Choose video',
  pickAnother: 'Analyze another video',
  downloadingModel: (pct) => `Downloading the model… ${pct}`,
  openingVideo: 'Opening the video…',
  analyzingFrames: (d, t) => `Analyzing frames… ${d}/${t}`,
  cancel: 'Cancel',
  error: (m) => `Error: ${m}`,
  canceled: 'Analysis canceled.',
  results: 'Result',
  viewBadge: 'Camera angle',
  views: { lateral: 'Side', frontal: 'Front', diagonal: 'Diagonal', unknown: 'Unknown' },
  sides: { left: 'left', right: 'right' },
  cameraSide: (s) => `${s} side to camera`,
  confidence: 'Confidence',
  confidences: { low: 'low', medium: 'medium', high: 'high' },
  qualityBad: 'This video could not be analyzed',
  qualityWarn: 'Heads up',
  problems: {
    no_pose: 'No person detected.',
    low_visibility: 'Body poorly visible for most of the video.',
    low_fps: 'Too few usable frames per second.',
    cut_off: 'Head or feet leave the frame.',
    diagonal_view: 'Diagonal camera: only tempo is measured.',
    tilted_camera: 'The camera looks tilted.',
  },
  quality: (v, f) => `${v}% of frames visible, ${f} usable frames/s`,
  reps: 'Reps',
  repN: (n) => `Rep ${n}`,
  noReps: 'No complete rep detected.',
  noData: 'no data',
  reasons: {
    low_visibility: 'body landmarks poorly visible',
    wrong_view: 'not measured from this angle',
    insufficient_frames: 'not enough frames',
    no_reps: 'no reps',
  },
  metrics: {
    depth: 'Depth',
    trunk: 'Trunk',
    tempo: 'Tempo',
    valgus: 'Knees',
    asymmetry: 'Asymmetry',
  },
  depthClasses: {
    below: 'Below parallel',
    parallel: 'At parallel',
    borderline: 'Borderline',
    above: 'Above parallel',
  },
  thighAngle: (d) => `thigh ${d}° from horizontal`,
  trunkDiff: (d) => `trunk − shin: ${d}°`,
  trunkDetail: (t, s) => `trunk ${t}° and shin ${s}° from vertical`,
  tempoDetail: (d, p, a) => `down ${d} s · pause ${p} s · up ${a} s`,
  valgusFlagged: 'Knees caved in',
  valgusOk: 'No marked valgus',
  fppa: (l, r) => `knee angle change: left ${l}°, right ${r}°`,
  asymFlagged: 'Uneven',
  asymOk: 'Symmetric',
  asymDetail: (s) => `hip shift: ${s}% of femur length`,
  velocityLoss: 'Velocity loss (hip)',
  velocityLossValue: (p) => `${p}% from first to last rep`,
  chartTitle: 'Hip height over time',
  chartDesc: (n) => `Hip height chart; ${n} rep(s) shaded, with the bottom of each marked.`,
  chartTime: 'time (s)',
  chartEmpty: 'Hip not detected: no chart.',
  cues: 'Tips',
  noCues: 'No tips.',
  exportReport: 'Export analysis (JSON)',
  exportLandmarks: 'Export landmarks (JSON)',
  decimal: '.',
};

export const STRINGS: Readonly<Record<Lang, UiStrings>> = { 'pt-BR': ptBR, en };

export const LANG_STORAGE_KEY = 'squatlens.lang';

function isLang(v: unknown): v is Lang {
  return typeof v === 'string' && (LANGS as readonly string[]).includes(v);
}

/** Saved language, or pt-BR when nothing valid is stored (or storage is unavailable). */
export function loadLang(storage: Pick<Storage, 'getItem'> | null = safeStorage()): Lang {
  try {
    const v = storage?.getItem(LANG_STORAGE_KEY);
    return isLang(v) ? v : 'pt-BR';
  } catch {
    return 'pt-BR';
  }
}

export function saveLang(lang: Lang, storage: Pick<Storage, 'setItem'> | null = safeStorage()) {
  try {
    storage?.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // Private mode or storage disabled: the choice just isn't remembered.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Number with `digits` decimals and the language's decimal separator. */
export function fmt(n: number, digits: number, s: Pick<UiStrings, 'decimal'>): string {
  // Drop the sign of values that round to zero ("-0" reads like a bug).
  const str = n.toFixed(digits).replace(/^-(0(\.0+)?)$/, '$1');
  return str.replace('.', s.decimal);
}
