import { useId, useMemo } from 'react';
import type { PoseTrack, Rep } from '../core/types';
import { hipSeries } from './hipSeries';
import type { UiStrings } from './i18n';

const W = 600;
const H = 200;
const PAD = { left: 8, right: 8, top: 10, bottom: 30 };

interface Props {
  track: PoseTrack;
  reps: readonly Rep[];
  s: UiStrings;
}

/**
 * Hip height over time as a small inline SVG (SPEC §7): reps shaded, bottom of each rep
 * marked. Image y is plotted as is (down = deeper), so the curve dips at each rep.
 */
export function HipChart({ track, reps, s }: Props) {
  const series = useMemo(() => hipSeries(track), [track]);
  const id = useId();
  const ys = series.flatMap((p) => (p.y === null ? [] : [p.y]));
  if (series.length < 2 || ys.length < 2) return <p className="muted">{s.chartEmpty}</p>;

  const t0 = series[0]!.t;
  const t1 = series[series.length - 1]!.t;
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const ySpan = yMax - yMin || 1;
  const tSpan = t1 - t0 || 1;
  const x = (t: number) => PAD.left + ((t - t0) / tSpan) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + ((v - yMin) / ySpan) * (H - PAD.top - PAD.bottom);

  // One subpath per run of frames with a hip; gaps stay gaps.
  let d = '';
  let pen = false;
  for (const p of series) {
    if (p.y === null) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.y).toFixed(1)}`;
    pen = true;
  }

  const ticks: number[] = [];
  const step = tSpan > 20000 ? 5000 : tSpan > 8000 ? 2000 : 1000;
  for (let t = 0; t <= tSpan; t += step) ticks.push(t);

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${id}-title ${id}-desc`}>
        <title id={`${id}-title`}>{s.chartTitle}</title>
        <desc id={`${id}-desc`}>{s.chartDesc(reps.length)}</desc>
        {reps.map((r) => (
          <rect
            key={r.index}
            className="chart-rep"
            data-testid="chart-rep"
            x={x(r.startT)}
            y={PAD.top}
            width={Math.max(1, x(r.endT) - x(r.startT))}
            height={H - PAD.top - PAD.bottom}
          />
        ))}
        <path className="chart-line" d={d} fill="none" vectorEffect="non-scaling-stroke" />
        {reps.map((r) => {
          const by = series[r.bottomFrame]?.y;
          return by == null ? null : (
            <circle
              key={r.index}
              className="chart-bottom"
              data-testid="chart-bottom"
              cx={x(r.bottomT)}
              cy={y(by)}
              r={4}
            />
          );
        })}
        {ticks.map((t) => (
          <text key={t} className="chart-tick" x={x(t0 + t)} y={H - 8} textAnchor="middle">
            {Math.round(t / 1000)}
          </text>
        ))}
      </svg>
      <figcaption>
        {s.chartTitle} · {s.chartTime}
      </figcaption>
    </figure>
  );
}
