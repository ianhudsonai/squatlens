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

const modelBytes = new Map<ModelVariant, Promise<Uint8Array<ArrayBuffer>>>();

/** Download (or read from cache) a model once per page load. */
export function loadModel(
  model: ModelVariant,
  onProgress?: (p: FetchProgress) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  let p = modelBytes.get(model);
  if (!p) {
    p = fetchModel(modelUrl(model), { onProgress }).catch((err: unknown) => {
      modelBytes.delete(model);
      throw err;
    });
    modelBytes.set(model, p);
  } else if (onProgress) {
    // Already loaded or loading: report completion once it resolves.
    void p
      .then((b) => onProgress({ loaded: b.length, total: b.length, fromCache: true }))
      .catch(() => {});
  }
  return p;
}

export interface CreateLandmarkerOptions {
  model: ModelVariant;
  /** Preferred delegate; defaults to the URL override, else GPU. */
  delegate?: Delegate;
  onModelProgress?: (p: FetchProgress) => void;
}

export interface CreatedLandmarker {
  landmarker: PoseLandmarker;
  model: ModelVariant;
  delegate: Delegate;
}

async function createWith(bytes: Uint8Array, delegate: Delegate): Promise<PoseLandmarker> {
  const fileset = await loadFileset();
  return PoseLandmarker.createFromOptions(fileset, {
    // Copy: the task may take ownership of the buffer, and we reuse it per clip.
    baseOptions: { modelAssetBuffer: bytes.slice(), delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
  });
}

/**
 * Create a fresh PoseLandmarker (one per clip: VIDEO mode timestamps must keep increasing).
 * Tries GPU, falls back to CPU unless CPU was requested explicitly.
 */
export async function createLandmarker(opts: CreateLandmarkerOptions): Promise<CreatedLandmarker> {
  const bytes = await loadModel(opts.model, opts.onModelProgress);
  const preferred = opts.delegate ?? delegateOverride() ?? 'GPU';
  if (preferred === 'CPU') {
    return { landmarker: await createWith(bytes, 'CPU'), model: opts.model, delegate: 'CPU' };
  }
  try {
    return { landmarker: await createWith(bytes, 'GPU'), model: opts.model, delegate: 'GPU' };
  } catch (err) {
    console.warn('GPU delegate unavailable, falling back to CPU.', err);
    return { landmarker: await createWith(bytes, 'CPU'), model: opts.model, delegate: 'CPU' };
  }
}
