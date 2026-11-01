/**
 * Seek-step video reader: samples a clip at a fixed rate, runs the pose landmarker on each
 * sampled frame and assembles a PoseTrack (SPEC §4).
 */
import type { PoseFrame, PoseTrack } from '../core/types';
import { buildTrack, sampleTimes, toPoseFrame, toTimestampsMs, type RawPoseResult } from './track';

/** What extraction needs from a landmarker. PoseLandmarker satisfies it. */
export interface VideoPoseDetector {
  detectForVideo(frame: HTMLVideoElement, timestampMs: number): RawPoseResult;
}

/** A seekable frame source. The browser implementation wraps an off-DOM <video>. */
export interface FrameSource {
  readonly width: number;
  readonly height: number;
  readonly durationS: number;
  /** The element handed to the detector; must show the frame at the last seek. */
  readonly element: HTMLVideoElement;
  seek(timeS: number): Promise<void>;
}

export interface ExtractOptions {
  sampleHz?: number;
  /** Native frame rate when known; caps the sample rate. */
  nativeFps?: number;
  /** Called after each frame with done/total. */
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
  meta?: PoseTrack['meta'];
}

export const DEFAULT_SAMPLE_HZ = 30;

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Extraction aborted', 'AbortError');
}

/** Core loop, independent of how frames are produced (unit-tested with mocks). */
export async function extractFromSource(
  source: FrameSource,
  detector: VideoPoseDetector,
  opts: ExtractOptions = {},
): Promise<PoseTrack> {
  const sampleHz = opts.sampleHz ?? DEFAULT_SAMPLE_HZ;
  const times = sampleTimes(source.durationS, sampleHz, opts.nativeFps);
  const stamps = toTimestampsMs(times);
  const frames: PoseFrame[] = [];
  opts.onProgress?.(0, times.length);
  for (let i = 0; i < times.length; i++) {
    if (opts.signal?.aborted) throw abortError(opts.signal);
    await source.seek(times[i]!);
    if (opts.signal?.aborted) throw abortError(opts.signal);
    const t = stamps[i]!;
    const result = detector.detectForVideo(source.element, t);
    frames.push(toPoseFrame(t, result));
    opts.onProgress?.(i + 1, times.length);
  }
  return buildTrack({
    width: source.width,
    height: source.height,
    sampleHz,
    frames,
    meta: opts.meta,
  });
}

const SEEK_TIMEOUT_MS = 10_000;

function once(target: EventTarget, okEvent: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for video "${okEvent}"`));
    }, timeoutMs);
    const onOk = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error('Could not decode this video in the browser.'));
    };
    const cleanup = () => {
      clearTimeout(timer);
      target.removeEventListener(okEvent, onOk);
      target.removeEventListener('error', onErr);
    };
    target.addEventListener(okEvent, onOk);
    target.addEventListener('error', onErr);
  });
}

/**
 * Some recordings (e.g. MediaRecorder WebM) report `duration = Infinity` until the end is
 * reached. Seeking far past the end forces the browser to compute it.
 */
async function resolveDuration(video: HTMLVideoElement): Promise<number> {
  if (Number.isFinite(video.duration)) return video.duration;
  const seeked = once(video, 'seeked', SEEK_TIMEOUT_MS);
  video.currentTime = Number.MAX_SAFE_INTEGER;
  await seeked;
  const d = video.duration;
  if (!Number.isFinite(d)) throw new Error('Could not determine the video duration.');
  return d;
}

/** Load a file into an off-DOM muted <video> and expose it as a FrameSource. */
export async function openVideoSource(
  file: Blob,
): Promise<{ source: FrameSource; dispose: () => void }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  const dispose = () => {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  };
  try {
    const loaded = once(video, 'loadeddata', SEEK_TIMEOUT_MS);
    video.src = url;
    await loaded;
    const durationS = await resolveDuration(video);
    let current = video.currentTime;
    const source: FrameSource = {
      width: video.videoWidth,
      height: video.videoHeight,
      durationS,
      element: video,
      async seek(timeS: number) {
        // Setting currentTime to its current value fires no `seeked` event.
        if (Math.abs(current - timeS) < 1e-6 && video.readyState >= 2) return;
        const seeked = once(video, 'seeked', SEEK_TIMEOUT_MS);
        video.currentTime = timeS;
        await seeked;
        current = timeS;
      },
    };
    if (!source.width || !source.height) throw new Error('This file has no video track.');
    return { source, dispose };
  } catch (err) {
    dispose();
    throw err;
  }
}

/**
 * Extract a PoseTrack from a video file. The landmarker must be fresh (created for this
 * clip): MediaPipe VIDEO mode rejects timestamps that are not increasing across calls.
 */
export async function extractPoseTrack(
  file: Blob,
  landmarker: VideoPoseDetector,
  opts: ExtractOptions = {},
): Promise<PoseTrack> {
  const { source, dispose } = await openVideoSource(file);
  try {
    return await extractFromSource(source, landmarker, opts);
  } finally {
    dispose();
  }
}
