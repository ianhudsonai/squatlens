import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { analyzeSet } from '../core/analyze';
import type { PoseTrack, SetReport } from '../core/types';
import { defaultModel, MODEL_VARIANTS, type ModelVariant } from '../pose/options';
import { baseName } from './download';
import { LANGS, loadLang, saveLang, STRINGS, type Lang, type UiStrings } from './i18n';
import { Report } from './Report';
import { SkeletonOverlay } from './SkeletonOverlay';

type PoseModule = typeof import('../pose');

type Status =
  | { kind: 'idle' }
  | { kind: 'model'; loaded: number; total: number | null }
  | { kind: 'starting' }
  | { kind: 'frames'; done: number; total: number }
  | { kind: 'done' }
  | { kind: 'canceled' }
  | { kind: 'error'; message: string };

interface Result {
  track: PoseTrack;
  report: SetReport;
  videoUrl: string;
  fileName: string;
  connections: PoseModule['POSE_CONNECTIONS'];
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function progress(n: number, d: number | null): string {
  return d ? `${Math.min(100, Math.round((100 * n) / d))}%` : `${(n / 1e6).toFixed(1)} MB`;
}

function statusText(status: Status, s: UiStrings): string {
  switch (status.kind) {
    case 'model':
      return s.downloadingModel(progress(status.loaded, status.total));
    case 'starting':
      return s.openingVideo;
    case 'frames':
      return s.analyzingFrames(status.done, status.total);
    case 'canceled':
      return s.canceled;
    case 'error':
      return s.error(status.message);
    default:
      return '';
  }
}

/** Single-page flow (SPEC §7): landing → pick video → model → frames → report. */
export function App() {
  const [lang, setLang] = useState<Lang>(() => loadLang());
  const [model, setModel] = useState<ModelVariant>(defaultModel);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [result, setResult] = useState<Result | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const s = STRINGS[lang];

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // Revoke the playback URL when it is replaced or on unmount.
  useEffect(() => {
    if (!result) return;
    return () => URL.revokeObjectURL(result.videoUrl);
  }, [result]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const busy = status.kind === 'model' || status.kind === 'starting' || status.kind === 'frames';

  function chooseLang(l: Lang) {
    setLang(l);
    saveLang(l);
  }

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
        onProgress: (done, total) => {
          if (!controller.signal.aborted) setStatus({ kind: 'frames', done, total });
        },
      });
      if (controller.signal.aborted) throw new DOMException('aborted', 'AbortError');
      const report = analyzeSet(track);
      setResult({
        track,
        report,
        videoUrl: URL.createObjectURL(file),
        fileName: file.name,
        connections: pose.POSE_CONNECTIONS,
      });
      setStatus({ kind: 'done' });
    } catch (err) {
      // A newer file replaced this run: leave the status to that run.
      if (abortRef.current !== controller) return;
      if (isAbort(err) || controller.signal.aborted) {
        setStatus({ kind: 'canceled' });
      } else {
        console.error(err);
        setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      landmarker?.close();
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  return (
    <main>
      <header className="top">
        <h1>squatlens</h1>
        <div className="lang" role="group" aria-label={s.langSwitch}>
          {LANGS.map((l) => (
            <button
              key={l}
              type="button"
              lang={l}
              aria-pressed={l === lang}
              onClick={() => chooseLang(l)}
            >
              {l === 'pt-BR' ? 'PT' : 'EN'}
              <span className="sr-only"> ({STRINGS[l].langName})</span>
            </button>
          ))}
        </div>
      </header>

      <p className="tagline">{s.tagline}</p>
      <p className="privacy">
        <span aria-hidden="true">🔒 </span>
        {s.privacy}
      </p>
      {!result && <p className="muted">{s.howTo}</p>}

      <div className="row controls">
        <label>
          {s.model}{' '}
          <select
            value={model}
            disabled={busy}
            onChange={(e) => setModel(e.target.value as ModelVariant)}
          >
            {MODEL_VARIANTS.map((m) => (
              <option key={m} value={m}>
                {s.models[m]}
              </option>
            ))}
          </select>
        </label>
        <label className={`file-button${busy ? ' disabled' : ''}`}>
          {result ? s.pickAnother : s.pickVideo}
          <input
            className="sr-only"
            type="file"
            accept="video/*"
            disabled={busy}
            onChange={onFile}
          />
        </label>
      </div>

      <div className="status-row">
        <p role="status" aria-live="polite">
          {statusText(status, s)}
        </p>
        {status.kind === 'frames' && (
          <progress max={status.total} value={status.done} aria-hidden="true" />
        )}
        {status.kind === 'model' && status.total !== null && (
          <progress max={status.total} value={status.loaded} aria-hidden="true" />
        )}
        {busy && (
          <button type="button" onClick={() => abortRef.current?.abort()}>
            {s.cancel}
          </button>
        )}
      </div>

      {result && (
        <Report
          report={result.report}
          track={result.track}
          lang={lang}
          s={s}
          baseName={baseName(result.fileName)}
          player={
            <div className="player">
              <video ref={videoRef} src={result.videoUrl} controls muted playsInline />
              <SkeletonOverlay
                videoRef={videoRef}
                track={result.track}
                connections={result.connections}
              />
            </div>
          }
        />
      )}

      <footer>
        <p>
          <small>{s.disclaimer}</small>
        </p>
      </footer>
    </main>
  );
}
