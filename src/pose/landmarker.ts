/**
 * Creates the MediaPipe PoseLandmarker from same-origin WASM and model files (SPEC §0, §4).
 * GPU first, CPU fallback; `?delegate=cpu` forces CPU.
 */
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { fetchModel, type FetchProgress } from './modelCache';
import { delegateOverride, type Delegate, type ModelVariant } from './options';
import { installSameOriginFetch } from './sameOriginFetch';

// Before any task exists: stops the MediaPipe usage logger from phoning home.
installSameOriginFetch();

/** The landmark graph: pairs of indices to connect when drawing the skeleton. */
export const POSE_CONNECTIONS: ReadonlyArray<{ start: number; end: number }> =
  PoseLandmarker.POSE_CONNECTIONS;

export function modelUrl(model: ModelVariant): string {
  return `${import.meta.env.BASE_URL}models/pose_landmarker_${model}.task`;
}

export function wasmBaseUrl(): string {
  return `${import.meta.env.BASE_URL}wasm`;
}

let filesetPromise: ReturnType<typeof FilesetResolver.forVisionTasks> | null = null;

function loadFileset() {
  filesetPromise ??= FilesetResolver.forVisionTasks(wasmBaseUrl()).catch((err: unknown) => {
    filesetPromise = null;
    throw err;
  });
  return filesetPromise;
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Aborted', 'AbortError');
}

/**
 * Download a model, or read it from Cache Storage on later visits. Bytes are not kept in
 * memory between clips (they are 6-31 MB): a re-read from Cache Storage is cheap.
 */
export function loadModel(
  model: ModelVariant,
  opts: { onProgress?: (p: FetchProgress) => void; signal?: AbortSignal } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  return fetchModel(modelUrl(model), opts);
}

export interface CreateLandmarkerOptions {
  model: ModelVariant;
  /** Preferred delegate; defaults to the URL override, else GPU. */
  delegate?: Delegate;
  onModelProgress?: (p: FetchProgress) => void;
  /** Cancels the model download; a landmarker created after abort is closed. */
  signal?: AbortSignal;
}

export interface CreatedLandmarker {
  landmarker: PoseLandmarker;
  model: ModelVariant;
  delegate: Delegate;
}

async function createWith(bytes: Uint8Array, delegate: Delegate): Promise<PoseLandmarker> {
  const fileset = await loadFileset();
  return PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetBuffer: bytes, delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
  });
}

async function createWithFallback(
  opts: CreateLandmarkerOptions,
): Promise<{ landmarker: PoseLandmarker; delegate: Delegate }> {
  const { model, signal } = opts;
  const bytes = await loadModel(model, { onProgress: opts.onModelProgress, signal });
  const preferred = opts.delegate ?? delegateOverride() ?? 'GPU';
  if (preferred === 'CPU') return { landmarker: await createWith(bytes, 'CPU'), delegate: 'CPU' };
  try {
    return { landmarker: await createWith(bytes, 'GPU'), delegate: 'GPU' };
  } catch (err) {
    console.warn('GPU delegate unavailable, falling back to CPU.', err);
    if (signal?.aborted) throw abortError(signal);
    // The failed attempt may have taken ownership of (detached) the buffer.
    const retry = bytes.byteLength > 0 ? bytes : await loadModel(model, { signal });
    return { landmarker: await createWith(retry, 'CPU'), delegate: 'CPU' };
  }
}

/**
 * Create a fresh PoseLandmarker (one per clip: VIDEO mode timestamps must keep increasing).
 * Tries GPU, falls back to CPU unless CPU was requested explicitly.
 */
export async function createLandmarker(opts: CreateLandmarkerOptions): Promise<CreatedLandmarker> {
  const { landmarker, delegate } = await createWithFallback(opts);
  if (opts.signal?.aborted) {
    landmarker.close();
    throw abortError(opts.signal);
  }
  return { landmarker, model: opts.model, delegate };
}
