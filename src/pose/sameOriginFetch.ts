/**
 * Privacy guard (SPEC §0 rule 2). `@mediapipe/tasks-vision` 1.2.0 creates a usage logger
 * for every task that POSTs latency stats to `https://odml.pa.googleapis.com/v1/log` via
 * `fetch`, with no option to turn it off. We make `fetch` refuse any cross-origin URL
 * before a request is attempted; the logger catches the error and disables itself. The
 * `connect-src` CSP in index.html is the browser-enforced backstop.
 */

interface FetchHost {
  fetch: typeof fetch;
  location: { href: string; origin: string };
}

const INSTALLED = Symbol.for('squatlens.sameOriginFetch');

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** True when the app may fetch this URL: same origin, or a local blob:/data: URL. */
export function isAllowedUrl(url: string, page: { href: string; origin: string }): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url, page.href);
  } catch {
    return false;
  }
  if (parsed.protocol === 'data:') return true;
  // blob: URLs carry the creating page's origin, so the origin check covers them too.
  return parsed.origin === page.origin;
}

/** Wrap `host.fetch` so cross-origin requests reject without touching the network. Idempotent. */
export function installSameOriginFetch(host: FetchHost = window): void {
  const current = host.fetch as typeof fetch & { [INSTALLED]?: true };
  if (current[INSTALLED]) return;
  const original = current.bind(host);
  const guarded = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    if (!isAllowedUrl(url, host.location)) {
      return Promise.reject(new TypeError(`squatlens blocked a cross-origin request to ${url}`));
    }
    return original(input, init);
  }) as typeof fetch & { [INSTALLED]?: true };
  guarded[INSTALLED] = true;
  host.fetch = guarded;
}
