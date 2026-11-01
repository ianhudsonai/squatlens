import { describe, expect, it, vi } from 'vitest';
import { installSameOriginFetch, isAllowedUrl } from './sameOriginFetch';

const page = { href: 'https://ian.github.io/squatlens/', origin: 'https://ian.github.io' };

describe('isAllowedUrl', () => {
  it('allows same-origin, relative, blob and data URLs', () => {
    expect(isAllowedUrl('/squatlens/models/pose_landmarker_full.task', page)).toBe(true);
    expect(isAllowedUrl('wasm/vision_wasm_internal.wasm', page)).toBe(true);
    expect(isAllowedUrl('https://ian.github.io/squatlens/x', page)).toBe(true);
    expect(isAllowedUrl('blob:https://ian.github.io/1234-abcd', page)).toBe(true);
    expect(isAllowedUrl('data:application/octet-stream;base64,AA==', page)).toBe(true);
  });

  it('rejects other origins, including the MediaPipe usage logger', () => {
    expect(isAllowedUrl('https://odml.pa.googleapis.com/v1/log', page)).toBe(false);
    expect(isAllowedUrl('https://storage.googleapis.com/mediapipe-models/x.task', page)).toBe(
      false,
    );
    expect(isAllowedUrl('http://ian.github.io/squatlens/', page)).toBe(false);
    expect(isAllowedUrl('blob:https://evil.example/1234', page)).toBe(false);
  });
});

describe('installSameOriginFetch', () => {
  it('blocks cross-origin requests before they reach the network and passes the rest', async () => {
    const network = vi.fn(async () => new Response('ok'));
    const host = { fetch: network as unknown as typeof fetch, location: page };
    installSameOriginFetch(host);
    installSameOriginFetch(host); // idempotent

    await expect(
      host.fetch('https://odml.pa.googleapis.com/v1/log', { method: 'POST' }),
    ).rejects.toThrow(TypeError);
    await expect(host.fetch(new Request('https://odml.pa.googleapis.com/v1/log'))).rejects.toThrow(
      TypeError,
    );
    expect(network).not.toHaveBeenCalled();

    const res = await host.fetch(new URL('https://ian.github.io/squatlens/models/a.task'));
    expect(await res.text()).toBe('ok');
    expect(network).toHaveBeenCalledTimes(1);
  });
});
