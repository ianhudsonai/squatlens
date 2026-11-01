import { describe, expect, it, vi } from 'vitest';
import { extractFromSource, type FrameSource, type VideoPoseDetector } from './extractFrames';
import type { RawPoseResult } from './track';

const element = {} as HTMLVideoElement;

function mockSource(durationS: number) {
  const seeks: number[] = [];
  const source: FrameSource = {
    width: 720,
    height: 1280,
    durationS,
    element,
    seek: async (t) => {
      seeks.push(t);
    },
  };
  return { source, seeks };
}

const pose: RawPoseResult = {
  landmarks: [[{ x: 0.5, y: 0.5, z: 0, visibility: 0.99 }]],
  worldLandmarks: [[{ x: 0, y: 0, z: 0, visibility: 0.99 }]],
};
const empty: RawPoseResult = { landmarks: [], worldLandmarks: [] };

describe('extractFromSource', () => {
  it('seeks each sample, detects with strictly increasing integer ms and assembles a track', async () => {
    const { source, seeks } = mockSource(0.5);
    const calls: number[] = [];
    const detector: VideoPoseDetector = {
      detectForVideo: (el, ts) => {
        expect(el).toBe(element);
        calls.push(ts);
        return calls.length % 3 === 0 ? empty : pose;
      },
    };
    const progress = vi.fn();
    const track = await extractFromSource(source, detector, {
      sampleHz: 10,
      onProgress: progress,
      meta: { model: 'lite', delegate: 'CPU', source: 'clip.mp4' },
    });

    expect(seeks).toEqual([0, 0.1, 0.2, 0.3, 0.4]);
    expect(calls).toEqual([0, 100, 200, 300, 400]);
    expect(track).toMatchObject({ version: 1, width: 720, height: 1280, sampleHz: 10 });
    expect(track.meta).toEqual({ model: 'lite', delegate: 'CPU', source: 'clip.mp4' });
    expect(track.frames.map((f) => f.t)).toEqual(calls);
    expect(track.frames[2]).toEqual({ t: 200, lm: null, world: null });
    expect(track.frames[0]!.lm).toHaveLength(1);
    expect(progress).toHaveBeenNthCalledWith(1, 0, 5);
    expect(progress).toHaveBeenLastCalledWith(5, 5);
  });

  it('defaults to 30 Hz capped by native fps', async () => {
    const { source, seeks } = mockSource(1);
    const detector: VideoPoseDetector = { detectForVideo: () => pose };
    const track = await extractFromSource(source, detector);
    expect(track.sampleHz).toBe(30);
    expect(seeks).toHaveLength(30);
    const capped = mockSource(1);
    await extractFromSource(capped.source, detector, { nativeFps: 24 });
    expect(capped.seeks).toHaveLength(24);
  });

  it('stops on abort with the signal reason', async () => {
    const { source } = mockSource(1);
    const controller = new AbortController();
    const detector: VideoPoseDetector = {
      detectForVideo: vi.fn((_el, ts: number) => {
        if (ts >= 100) controller.abort(new DOMException('stop', 'AbortError'));
        return pose;
      }),
    };
    await expect(
      extractFromSource(source, detector, { sampleHz: 10, signal: controller.signal }),
    ).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(detector.detectForVideo).toHaveBeenCalledTimes(2);
  });

  it('does not start when already aborted', async () => {
    const { source, seeks } = mockSource(1);
    const controller = new AbortController();
    controller.abort();
    await expect(
      extractFromSource(source, { detectForVideo: () => pose }, { signal: controller.signal }),
    ).rejects.toBeDefined();
    expect(seeks).toEqual([]);
  });
});

describe('extractFromSource sampleHz', () => {
  it('records the effective (capped) rate in the track', async () => {
    const { source } = mockSource(1);
    const track = await extractFromSource(
      source,
      { detectForVideo: () => pose },
      { nativeFps: 24 },
    );
    expect(track.sampleHz).toBe(24);
    expect(track.frames).toHaveLength(24);
  });

  it('passes the abort signal to seek', async () => {
    const controller = new AbortController();
    const signals: (AbortSignal | undefined)[] = [];
    const source: FrameSource = {
      ...mockSource(0.2).source,
      seek: async (_t, signal) => {
        signals.push(signal);
      },
    };
    await extractFromSource(
      source,
      { detectForVideo: () => pose },
      { sampleHz: 10, signal: controller.signal },
    );
    expect(signals).toEqual([controller.signal, controller.signal]);
  });
});
