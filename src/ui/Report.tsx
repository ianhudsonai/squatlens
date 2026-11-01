import type { ReactNode } from 'react';
import { renderCue, type Lang } from '../core/cues';
import type { Metric, PoseTrack, QualityReport, RepReport, SetReport } from '../core/types';
import { downloadJson } from './download';
import { HipChart } from './HipChart';
import { fmt, type UiStrings } from './i18n';

interface Props {
  report: SetReport;
  track: PoseTrack;
  lang: Lang;
  s: UiStrings;
  /** Base name for exported files (no extension). */
  baseName: string;
  /** Video player with overlay; rendered at the top of the report. */
  player?: ReactNode;
}

type MetricKey = keyof UiStrings['metrics'];
const METRIC_KEYS: readonly MetricKey[] = ['depth', 'trunk', 'tempo', 'valgus', 'asymmetry'];

/** Problems that block the report; the rest are warnings shown next to the metrics. */
const BLOCKING: ReadonlySet<QualityReport['problems'][number]> = new Set([
  'no_pose',
  'low_visibility',
  'low_fps',
  'cut_off',
]);

/** Result screen for one analyzed set (SPEC §7). Pure rendering from a `SetReport`. */
export function Report({ report, track, lang, s, baseName, player }: Props) {
  const { quality, view } = report;
  const warnings = quality.problems.filter((p) => !BLOCKING.has(p));

  return (
    <section className="report" aria-labelledby="report-title">
      <h2 id="report-title">{s.results}</h2>
      {player}

      <p className="badges">
        <span className="badge" data-testid="view-badge">
          {s.viewBadge}: <strong>{s.views[view.view]}</strong>
          {view.view === 'lateral' && view.side && ` (${s.cameraSide(s.sides[view.side])})`}
          {view.confidence && ` · ${s.confidence} ${s.confidences[view.confidence]}`}
        </span>
        <span className="badge muted">
          {s.quality(Math.round(quality.visibleFrac * 100), fmt(quality.effectiveFps, 0, s))}
        </span>
      </p>

      {!quality.ok ? (
        <div className="banner banner-bad" role="alert" data-testid="quality-banner">
          <strong>{s.qualityBad}</strong>
          <ul>
            {quality.problems.map((p) => (
              <li key={p}>{s.problems[p]}</li>
            ))}
          </ul>
        </div>
      ) : (
        warnings.length > 0 && (
          <div className="banner banner-warn" role="status" data-testid="quality-warning">
            <strong>{s.qualityWarn}</strong>
            <ul>
              {warnings.map((p) => (
                <li key={p}>{s.problems[p]}</li>
              ))}
            </ul>
          </div>
        )
      )}

      {quality.ok && (
        <>
          <h3>{s.reps}</h3>
          {report.reps.length === 0 ? (
            <p data-testid="no-reps">{s.noReps}</p>
          ) : (
            <ol className="rep-list">
              {report.reps.map((r) => (
                <RepCard key={r.rep.index} rep={r} s={s} />
              ))}
            </ol>
          )}
          {report.velocityLoss.value !== null && (
            <p data-testid="velocity-loss">
              {s.velocityLoss}: {s.velocityLossValue(fmt(report.velocityLoss.value * 100, 0, s))}
              {report.velocityLoss.confidence &&
                ` (${s.confidence} ${s.confidences[report.velocityLoss.confidence]})`}
            </p>
          )}
          <HipChart track={track} reps={report.reps.map((r) => r.rep)} s={s} />
        </>
      )}

      <h3>{s.cues}</h3>
      {report.cues.length === 0 ? (
        <p>{s.noCues}</p>
      ) : (
        <ul className="cue-list" data-testid="cue-list">
          {report.cues.map((c, i) => (
            <li key={i} className={`cue cue-${c.severity}`}>
              {c.repIndex !== null && <span className="cue-rep">{s.repN(c.repIndex + 1)}: </span>}
              {renderCue(c, lang)}
            </li>
          ))}
        </ul>
      )}

      <div className="row">
        <button type="button" onClick={() => downloadJson(report, `${baseName}.analysis.json`)}>
          {s.exportReport}
        </button>
        <button type="button" onClick={() => downloadJson(track, `${baseName}.pose.json`)}>
          {s.exportLandmarks}
        </button>
      </div>
    </section>
  );
}

function RepCard({ rep, s }: { rep: RepReport; s: UiStrings }) {
  const n = rep.rep.index + 1;
  // Metrics this camera angle cannot measure are left out; enabled-but-null ones say so.
  const shown = METRIC_KEYS.filter((k) => rep[k].reason !== 'wrong_view');
  return (
    <li className="rep-card" aria-label={s.repN(n)} data-testid="rep-card">
      <h4>{s.repN(n)}</h4>
      <dl>
        {shown.map((k) => (
          <div key={k} className="metric" data-testid={`metric-${k}`}>
            <dt>{s.metrics[k]}</dt>
            <dd>
              <MetricValue name={k} rep={rep} s={s} />
            </dd>
          </div>
        ))}
      </dl>
    </li>
  );
}

function MetricValue({ name, rep, s }: { name: MetricKey; rep: RepReport; s: UiStrings }) {
  const m: Metric<unknown> = rep[name];
  if (m.value === null) {
    return (
      <span className="nodata">
        {s.noData}
        {m.reason && ` (${s.reasons[m.reason]})`}
      </span>
    );
  }
  const conf = m.confidence && (
    <span className="muted">
      {' '}
      · {s.confidence} {s.confidences[m.confidence]}
    </span>
  );
  const f1 = (v: number) => fmt(v, 1, s);
  const f0 = (v: number) => fmt(v, 0, s);
  let main: string;
  let detail: string;
  switch (name) {
    case 'depth': {
      const v = rep.depth.value!;
      main = s.depthClasses[v.cls];
      detail = s.thighAngle(f0(Math.abs(v.thighAngleDeg)));
      break;
    }
    case 'trunk': {
      const v = rep.trunk.value!;
      main = s.trunkDiff(f0(v.trunkMinusShinDeg));
      detail = s.trunkDetail(f0(v.trunkDeg), f0(v.shinDeg));
      break;
    }
    case 'tempo': {
      const v = rep.tempo.value!;
      main = `${f1(v.descentS + v.pauseS + v.ascentS)} s`;
      detail = s.tempoDetail(f1(v.descentS), f1(v.pauseS), f1(v.ascentS));
      break;
    }
    case 'valgus': {
      const v = rep.valgus.value!;
      const side = (d: number | null) => (d === null ? '—' : f0(d));
      main = v.flagged ? s.valgusFlagged : s.valgusOk;
      detail = s.fppa(side(v.fppaChangeDeg.left), side(v.fppaChangeDeg.right));
      break;
    }
    case 'asymmetry': {
      const v = rep.asymmetry.value!;
      main = v.flagged ? s.asymFlagged : s.asymOk;
      detail = s.asymDetail(f0(Math.abs(v.hipShiftNorm) * 100));
      break;
    }
  }
  return (
    <>
      <strong>{main}</strong>
      {conf}
      <br />
      <span className="detail">{detail}</span>
    </>
  );
}
