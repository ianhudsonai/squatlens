/**
 * Fetches model files through Cache Storage so a second visit works offline (SPEC §4).
 * Models are same-origin static files; the cache key is their URL, and the cache name is
 * versioned: bump CACHE_NAME whenever the pinned hashes in scripts/fetch-models.mjs change,
 * otherwise returning visitors keep the old bytes.
 */

export const CACHE_NAME = 'squatlens-models-v1';

/** Drop caches left by older CACHE_NAMEs (best effort). */
async function pruneOldCaches(): Promise<void> {
  const names = await caches.keys();
  await Promise.all(
    names
      .filter((n) => n.startsWith('squatlens-models-') && n !== CACHE_NAME)
      .map((n) => caches.delete(n)),
  );
}

export interface FetchProgress {
  loaded: number;
  /** Total bytes, or null when the server did not send Content-Length. */
  total: number | null;
  fromCache: boolean;
}

export interface FetchModelOptions {
  onProgress?: (p: FetchProgress) => void;
  signal?: AbortSignal;
}

async function openCache(): Promise<Cache | null> {
  // Cache Storage only exists in secure contexts (https or localhost).
  if (typeof caches === 'undefined') return null;
  try {
    void pruneOldCaches().catch(() => {});
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

/** Read a response body into one buffer, reporting progress as chunks arrive. */
async function readWithProgress(
  res: Response,
  onChunk: (loaded: number, total: number | null) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  const header = res.headers.get('Content-Length');
  const total = header !== null && /^\d+$/.test(header) ? Number(header) : null;
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    onChunk(buf.length, total ?? buf.length);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onChunk(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** Fetch `url` as bytes, from Cache Storage when available, storing it on first download. */
export async function fetchModel(
  url: string,
  opts: FetchModelOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const cache = await openCache();
  const cached = await cache?.match(url);
  if (cached) {
    try {
      return await readWithProgress(cached, (loaded, total) =>
        opts.onProgress?.({ loaded, total, fromCache: true }),
      );
    } catch {
      // Corrupt or evicted entry: fall through to the network.
      await cache?.delete(url);
    }
  }

  const res = await fetch(url, { signal: opts.signal });
  if (!res.ok) throw new Error(`Could not download model (${res.status} ${res.statusText}).`);
  const bytes = await readWithProgress(res, (loaded, total) =>
    opts.onProgress?.({ loaded, total, fromCache: false }),
  );
  if (cache) {
    try {
      await cache.put(
        url,
        new Response(bytes, {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(bytes.length),
          },
        }),
      );
    } catch {
      // Quota exceeded or private mode: the app still works, just not offline.
    }
  }
  return bytes;
}
