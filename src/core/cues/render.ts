/**
 * Cue text rendering. Text never goes into `SetReport` (SPEC §3): the UI calls `renderCue`
 * with the chosen language, so the exported JSON stays language-neutral.
 */
import type { Cue } from '../types';
import { en } from './en';
import { ptBR } from './pt-BR';
import type { CueMessages, Lang } from './types';

export const MESSAGES: Readonly<Record<Lang, CueMessages>> = { 'pt-BR': ptBR, en };

function formatParam(key: string, v: number | string, m: CueMessages): string {
  if (typeof v === 'number') return String(v).replace('.', m.decimal);
  if (key === 'conf' && Object.hasOwn(m.values.conf, v))
    return m.values.conf[v as keyof typeof m.values.conf];
  if (key === 'side' && Object.hasOwn(m.values.side, v))
    return m.values.side[v as keyof typeof m.values.side];
  return v;
}

/**
 * Text for one cue. An unknown id (e.g. a report from a newer version) renders as the id
 * itself; a placeholder with no matching param is left as is.
 */
export function renderCue(cue: Cue, lang: Lang): string {
  // A stale or unsupported language (e.g. from localStorage) falls back to pt-BR.
  const m = Object.hasOwn(MESSAGES, lang) ? MESSAGES[lang] : MESSAGES['pt-BR'];
  if (!Object.hasOwn(m.cues, cue.id)) return cue.id;
  const template = (m.cues as Record<string, string>)[cue.id]!;
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    Object.hasOwn(cue.params, key) ? formatParam(key, cue.params[key]!, m) : whole,
  );
}
