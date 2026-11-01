import { useEffect, useRef, type RefObject } from 'react';
import type { PoseTrack } from '../core/types';
import { nearestFrameIndex } from '../pose/track';

type Connections = ReadonlyArray<{ start: number; end: number }>;

interface Props {
  videoRef: RefObject<HTMLVideoElement | null>;
  track: PoseTrack;
  connections: Connections;
}

const MIN_VISIBILITY = 0.5;

/**
 * Canvas laid exactly over the player, drawing the pose for the sampled frame nearest
 * `video.currentTime` (SPEC §4). Canvas pixels = source video pixels, so normalized
 * landmarks map with x*width, y*height.
 */
export function SkeletonOverlay({ videoRef, track, connections }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    canvas.width = track.width;
    canvas.height = track.height;
    const lineWidth = Math.max(2, Math.round(Math.min(track.width, track.height) / 200));
    let raf = 0;
    let lastIndex = -2;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const video = videoRef.current;
      if (!video) return;
      const index = nearestFrameIndex(track.frames, video.currentTime * 1000);
      if (index === lastIndex) return;
      lastIndex = index;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const lm = index >= 0 ? track.frames[index]?.lm : null;
      if (!lm) return;
      const W = track.width;
      const H = track.height;
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = 'rgba(0, 230, 160, 0.9)';
      for (const { start, end } of connections) {
        const a = lm[start];
        const b = lm[end];
        if (!a || !b || a.visibility < MIN_VISIBILITY || b.visibility < MIN_VISIBILITY) continue;
        ctx.beginPath();
        ctx.moveTo(a.x * W, a.y * H);
        ctx.lineTo(b.x * W, b.y * H);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255, 80, 80, 0.95)';
      for (const p of lm) {
        if (p.visibility < MIN_VISIBILITY) continue;
        ctx.beginPath();
        ctx.arc(p.x * W, p.y * H, lineWidth * 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [videoRef, track, connections]);

  return <canvas ref={canvasRef} className="skeleton-overlay" aria-hidden="true" />;
}
