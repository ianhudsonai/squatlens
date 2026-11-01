/** Shared option handling for every core module's `DEFAULTS` object. */

/**
 * `{ ...defaults, ...opts }` that ignores keys of `opts` explicitly set to undefined, so a
 * caller can pass `{ enter: undefined }` without wiping the default.
 */
export function withDefaults<T extends object>(defaults: T, opts: Partial<T>): T {
  const out = { ...defaults };
  for (const [k, v] of Object.entries(opts)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}
