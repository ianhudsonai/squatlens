import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { PoseTrack } from '../core/types';
import { defaultModel, MODEL_VARIANTS, type ModelVariant } from '../pose/options';
import { SkeletonOverlay } from './SkeletonOverlay';

type PoseModule = typeof import('../pose');

type Status =
  | { kind: 'idle' }
  | { kind: 'model'; loaded: number; total: number | null }
  | { kind: 'starting' }
  | { kind: 'frames'; done: number; total: number }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

interface Result {
  track: PoseTrack;
  videoUrl: string;
  fileName: string;
  delegate: string;
  pose: PoseModule;
}

const MODEL_LABEL: Record<ModelVariant, string> = {
  lite: 'Lite (rápido)',
  full: 'Full (equilibrado)',
  heavy: 'Heavy (mais preciso)',
};

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function pct(n: number, d: number | null): string {
  return d ? `${Math.min(100, Math.round((100 * n) / d))}%` : `${(n / 1e6).toFixed(1)} MB`;
}

function downloadJson(data: unknown, fileName: string) {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Minimal pose page (ticket T2): pick a video, extract a PoseTrack, play it back with the
 * skeleton overlay and export the landmarks. The full report UI replaces this later.
 */
export function PoseLab() {
  const [model, setModel] = useState<ModelVariant>(defaultModel);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [result, setResult] = useState<Result | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Revoke the playback URL when it is replaced or on unmount.
  useEffect(() => {
    if (!result) return;
    return () => URL.revokeObjectURL(result.videoUrl);
  }, [result]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const busy = status.kind === 'model' || status.kind === 'starting' || status.kind === 'frames';

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setResult(null);
    setStatus({ kind: 'model', loaded: 0, total: null });
    let landmarker: { close(): void } | null = null;
    try {
      const pose = await import('../pose');
      const created = await pose.createLandmarker({
        model,
        signal: controller.signal,
        onModelProgress: (p) => {
          if (!controller.signal.aborted)
            setStatus({ kind: 'model', loaded: p.loaded, total: p.total });
        },
      });
      landmarker = created.landmarker;
      setStatus({ kind: 'starting' });
      const track = await pose.extractPoseTrack(file, created.landmarker, {
        signal: controller.signal,
        meta: { model: created.model, delegate: created.delegate, source: file.name },
        onProgress: (done, total) => setStatus({ kind: 'frames', done, total }),
      });
      setResult({
        track,
        videoUrl: URL.createObjectURL(file),
        fileName: file.name,
        delegate: created.delegate,
        pose,
      });
      setStatus({ kind: 'done' });
    } catch (err) {
      if (isAbort(err) || controller.signal.aborted) {
        setStatus({ kind: 'idle' });
      } else {
        console.error(err);
        setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      landmarker?.close();
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  const detected = result ? result.track.frames.filter((f) => f.lm).length : 0;

  return (
    <section>
      <div className="row">
        <label>
          Modelo{' '}
          <select
            value={model}
            disabled={busy}
            onChange={(e) => setModel(e.target.value as ModelVariant)}
          >
            {MODEL_VARIANTS.map((m) => (
              <option key={m} value={m}>
                {MODEL_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        <label className="file-button">
          Escolher vídeo
          <input type="file" accept="video/*" disabled={busy} onChange={onFile} />
        </label>
      </div>

      <p role="status" aria-live="polite">
        {status.kind === 'model' && `Baixando o modelo… ${pct(status.loaded, status.total)}`}
        {status.kind === 'starting' && 'Abrindo o vídeo…'}
        {status.kind === 'frames' && `Analisando quadros… ${status.done}/${status.total}`}
        {status.kind === 'error' && `Erro: ${status.message}`}
        {status.kind === 'done' &&
          result &&
          `Pose detectada em ${detected} de ${result.track.frames.length} quadros (${result.track.meta?.model}, ${result.delegate}).`}
      </p>
      {busy && (
        <button type="button" onClick={() => abortRef.current?.abort()}>
          Cancelar
        </button>
      )}

      {result && (
        <>
          <div className="player">
            <video ref={videoRef} src={result.videoUrl} controls muted playsInline />
            <SkeletonOverlay
              videoRef={videoRef}
              track={result.track}
              connections={result.pose.POSE_CONNECTIONS}
            />
          </div>
          <button
            type="button"
            onClick={() =>
              downloadJson(result.track, `${result.fileName.replace(/\.[^.]+$/, '')}.pose.json`)
            }
          >
            Exportar landmarks (JSON)
          </button>
        </>
      )}
    </section>
  );
}
