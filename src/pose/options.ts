/**
 * Model/delegate choices. Kept free of the MediaPipe import so the UI can read defaults
 * without pulling the ~1 MB tasks-vision bundle into the landing page.
 */

export type ModelVariant = 'lite' | 'full' | 'heavy';
export type Delegate = 'GPU' | 'CPU';

export const MODEL_VARIANTS: readonly ModelVariant[] = ['lite', 'full', 'heavy'];

/** Heavy on desktop, full on phones/tablets (coarse pointer or mobile UA). */
export function defaultModel(): ModelVariant {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const mobileUa =
    typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent);
  return coarse || mobileUa ? 'full' : 'heavy';
}

/** `?delegate=cpu` / `?delegate=gpu` in the page URL, or null. */
export function delegateOverride(search: string = location.search): Delegate | null {
  const v = new URLSearchParams(search).get('delegate')?.toLowerCase();
  if (v === 'cpu') return 'CPU';
  if (v === 'gpu') return 'GPU';
  return null;
}
