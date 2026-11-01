/**
 * Pixel-space geometry helpers (SPEC §5.1, §0 rule 5).
 *
 * MediaPipe image landmarks are normalized separately on each axis (`x / width`,
 * `y / height`), so angles and distances computed on normalized coordinates are distorted by
 * the aspect ratio. Everything here works on pixel coordinates: convert with `toPx` first.
 *
 * Image convention: x grows to the right, y grows downward.
 */
import type { Lm } from './types';

/** A point in image pixels. */
export interface Px {
  x: number;
  y: number;
}

export const DEFAULTS = {
  /** A landmark is usable when `visibility >= minVisibility`... */
  minVisibility: 0.5,
  /** ...and, when MediaPipe reports it, `presence >= minPresence`. */
  minPresence: 0.5,
};

export type UsableOptions = Pick<typeof DEFAULTS, 'minVisibility' | 'minPresence'>;

const RAD2DEG = 180 / Math.PI;

/** Normalized landmark -> pixel point. */
export function toPx(lm: Pick<Lm, 'x' | 'y'>, width: number, height: number): Px {
  return { x: lm.x * width, y: lm.y * height };
}

/**
 * True when the landmark can be trusted in this frame: finite coordinates,
 * `visibility >= minVisibility` and (when defined) `presence >= minPresence`.
 */
export function usable(lm: Lm | null | undefined, opts: UsableOptions = DEFAULTS): lm is Lm {
  if (!lm) return false;
  if (!Number.isFinite(lm.x) || !Number.isFinite(lm.y)) return false;
  if (!(lm.visibility >= opts.minVisibility)) return false;
  if (lm.presence !== undefined && !(lm.presence >= opts.minPresence)) return false;
  return true;
}

/** Euclidean distance in pixels. */
export function dist(a: Px, b: Px): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Midpoint of two points. */
export function mid(a: Px, b: Px): Px {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Interior angle at `b` formed by `a-b-c`, in degrees [0, 180].
 * 180 = straight line (e.g. a fully extended knee). Returns null when either segment has
 * zero length, because the angle is undefined (SPEC §0 rule 3: never invent data).
 */
export function angleDeg(a: Px, b: Px, c: Px): number | null {
  const ux = a.x - b.x;
  const uy = a.y - b.y;
  const vx = c.x - b.x;
  const vy = c.y - b.y;
  if ((ux === 0 && uy === 0) || (vx === 0 && vy === 0)) return null;
  // atan2(|cross|, dot) is numerically stable near 0 and 180, unlike acos(dot/|u||v|).
  return Math.atan2(Math.abs(ux * vy - uy * vx), ux * vx + uy * vy) * RAD2DEG;
}

/**
 * Unsigned angle in degrees [0, 180] between the vector `from -> to` and the image's
 * upward vertical. 0 = `to` straight above `from`, 90 = horizontal, 180 = straight below.
 * Example: `angleToVerticalDeg(hipMid, shoulderMid)` is the trunk inclination.
 * Returns null when the points coincide.
 */
export function angleToVerticalDeg(from: Px, to: Px): number | null {
  const s = signedAngleToVerticalDeg(from, to);
  return s === null ? null : Math.abs(s);
}

/**
 * Signed version of `angleToVerticalDeg`, in degrees (-180, 180]: positive when `to` leans
 * toward +x (image right) of `from`, negative toward image left.
 */
export function signedAngleToVerticalDeg(from: Px, to: Px): number | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return null;
  // Up is -y in image coordinates.
  return Math.atan2(dx, -dy) * RAD2DEG;
}
