import type { Confidence, Side } from '../types';
import type { KnownCueId } from './generate';

export const LANGS = ['pt-BR', 'en'] as const;
export type Lang = (typeof LANGS)[number];

/**
 * One language's cue texts. `{name}` in a template is replaced by the cue's `params.name`;
 * numbers are formatted for the language, and the `conf` and `side` params are translated
 * through `values`.
 */
export interface CueMessages {
  /** Decimal separator for numeric params. */
  decimal: string;
  cues: Record<KnownCueId, string>;
  values: { conf: Record<Confidence, string>; side: Record<Side, string> };
}
