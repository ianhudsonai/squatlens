/**
 * Synthetic squat generator: the shared test bed for every core module (SPEC §9).
 *
 * `makeSquatTrack(opts)` builds a 3D kinematic stick figure doing `reps` squats, films it with
 * a pinhole camera and returns a `PoseTrack` shaped like MediaPipe output:
 *   - `lm`: 33 normalized image landmarks (x / width, y / height, y down). `z` is depth
 *     relative to the hip midpoint, in the same units as x (smaller = closer to the camera).
 *   - `world`: 33 metric landmarks (meters) with the hip midpoint at the origin, axes aligned
 *     with the image (x right, y down, z away from the camera).
 *   - Landmark indices follow MediaPipe (see src/core/landmarks.ts): odd = subject's left.
 * Fully deterministic: the same options (including `seed`) give an identical track.
 *
 * ## Options (all optional; defaults in `SQUAT_DEFAULTS`)
 *
 * Camera / view
 * - `view`: 'lateral' | 'frontal' | 'diagonal'. Sets the subject's yaw to 90 / 0 / 45 degrees.
 * - `side`: which side of the subject faces the camera in lateral/diagonal views
 *   ('left' default). Ignored when `yawDeg` is given.
 * - `yawDeg`: explicit subject yaw relative to the camera, overrides `view`/`side`.
 *   0 = facing the camera, +90 = subject's left side toward the camera, -90 = right side.
 * - `tiltDeg`: camera roll. Positive rotates the image content clockwise (so a standing
 *   subject leans toward image right at the head).
 * - `width`, `height`: video size in pixels. Pixels are square, and the focal length is set
 *   so the standing subject spans `fill` of the image height. Two aspect ratios therefore
 *   differ only by a similarity transform in pixel space (the aspect-ratio regression test).
 * - `cameraDistM`, `cameraHeightM`: camera distance from the subject's feet and lens height.
 * - `fill`: fraction of image height covered by the standing subject (default 0.75).
 *
 * Movement
 * - `reps`: number of squats.
 * - `depth`: thigh angle at the bottom, degrees, using the same sign as
 *   `DepthResult.thighAngleDeg`: positive = knee lower than hip (above parallel),
 *   0 = parallel, negative = hip below knee (below parallel). Default -10 (just below).
 * - `trunkLeanDeg`: trunk inclination from vertical at the bottom (hip-mid -> shoulder-mid).
 * - `shinLeanDeg`: shin inclination from vertical at the bottom (ankle -> knee).
 *   Trunk and shin lean scale linearly with squat progress, both 0 when standing.
 * - `valgusDeg`: knee cave at the bottom. Each knee moves medially by
 *   `shin * sin(valgusDeg * progress)`, i.e. roughly a frontal-plane shin rotation of that
 *   many degrees; 0 when standing. The projected FPPA change is close to but not exactly
 *   this angle (it depends on view and depth), so assert with tolerances.
 * - `hipShift`: lateral pelvis shift at the bottom, in thigh lengths, toward the subject's
 *   left (negative = right). Scales with progress; shoulders follow the pelvis.
 * - `pauseS`: hold at the bottom of each rep, seconds.
 * - `descentS`, `ascentS`: duration of each phase (cosine-eased), seconds.
 * - `leadS`, `restS`, `tailS`: standing time before the first rep, between reps, after the
 *   last rep. Calibration needs >= 0.5 s of standing within the first 3 s.
 * - `repDepthScale`: optional per-rep multiplier of squat progress at the bottom (1 = full
 *   `depth`), e.g. [1, 1, 0.6] makes the last rep shallower. Missing entries default to 1.
 *
 * Sampling and noise
 * - `fps`: sample rate. `t[i] = i * 1000 / fps` ms.
 * - `noise`: standard deviation of Gaussian noise added to image coordinates, in pixels
 *   (world landmarks get the equivalent noise in meters at the hip's depth).
 * - `dropout`: per-landmark, per-frame probability of a low-visibility (0.1) reading.
 * - `dropFrames`: frame indices where no pose is detected (`lm` and `world` null).
 * - `seed`: RNG seed for noise and dropout.
 *
 * Visibility model: 0.95 for landmarks facing the camera, decreasing to ~0.6 for the far
 * side in a pure lateral view (still usable, like MediaPipe's inferred landmarks), and 0.1
 * when a landmark projects outside the frame.
 *
 * Use `repSchedule(opts)` for the ground-truth timing of each rep.
 */
import type { Lm, PoseFrame, PoseTrack } from '../../src/core/types';

export type SyntheticView = 'lateral' | 'frontal' | 'diagonal';

export interface SquatOptions {
  view: SyntheticView;
  side: 'left' | 'right';
  yawDeg?: number;
  reps: number;
  depth: number;
  valgusDeg: number;
  hipShift: number;
  trunkLeanDeg: number;
  shinLeanDeg: number;
  fps: number;
  width: number;
  height: number;
  noise: number;
  dropout: number;
  dropFrames: number[];
  tiltDeg: number;
  pauseS: number;
  descentS: number;
  ascentS: number;
  leadS: number;
  restS: number;
  tailS: number;
  repDepthScale: number[];
  cameraDistM: number;
  cameraHeightM: number;
  fill: number;
  seed: number;
}

export const SQUAT_DEFAULTS: Readonly<SquatOptions> = {
  view: 'lateral',
  side: 'left',
  reps: 3,
  depth: -10,
  valgusDeg: 0,
  hipShift: 0,
  trunkLeanDeg: 40,
  shinLeanDeg: 30,
  fps: 30,
  width: 1080,
  height: 1920,
  noise: 0,
  dropout: 0,
  dropFrames: [],
  tiltDeg: 0,
  pauseS: 0,
  descentS: 1.2,
  ascentS: 1.0,
  leadS: 1.5,
  restS: 0.8,
  tailS: 1.0,
  repDepthScale: [],
  cameraDistM: 3.5,
  cameraHeightM: 0.9,
  fill: 0.75,
  seed: 1,
};

/** Segment lengths and offsets of the stick figure, meters. */
export const BODY = {
  ankleHeight: 0.08,
  shin: 0.42,
  thigh: 0.44,
  torso: 0.5, // hip-mid to shoulder-mid
  hipHalfWidth: 0.12,
  shoulderHalfWidth: 0.19,
  stanceHalfWidth: 0.18, // ankles
  /** Standing height (floor to top of head), used to set the focal length. */
  height: 1.75,
};

/** Ground-truth timing of one rep, ms. */
export interface RepTruth {
  startT: number;
  bottomStartT: number; // bottom reached (start of pause)
  bottomEndT: number; // end of pause
  endT: number;
}

export function resolveOptions(opts: Partial<SquatOptions> = {}): SquatOptions {
  return { ...SQUAT_DEFAULTS, ...opts };
}

/** Ground-truth rep timing for the given options. */
export function repSchedule(opts: Partial<SquatOptions> = {}): RepTruth[] {
  const o = resolveOptions(opts);
  const reps: RepTruth[] = [];
  let t = o.leadS * 1000;
  for (let r = 0; r < o.reps; r++) {
    const startT = t;
    const bottomStartT = startT + o.descentS * 1000;
    const bottomEndT = bottomStartT + o.pauseS * 1000;
    const endT = bottomEndT + o.ascentS * 1000;
    reps.push({ startT, bottomStartT, bottomEndT, endT });
    t = endT + o.restS * 1000;
  }
  return reps;
}

/** Total clip duration, ms. */
export function clipDurationMs(opts: Partial<SquatOptions> = {}): number {
  const o = resolveOptions(opts);
  const reps = repSchedule(o);
  const last = reps[reps.length - 1];
  return (last ? last.endT : o.leadS * 1000) + o.tailS * 1000;
}

/** Squat progress at time t: 0 standing .. 1 at full `depth` (times repDepthScale). */
export function progressAt(tMs: number, opts: Partial<SquatOptions> = {}): number {
  const o = resolveOptions(opts);
  const ease = (u: number) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, u)))) / 2;
  const reps = repSchedule(o);
  for (let r = 0; r < reps.length; r++) {
    const rep = reps[r]!;
    const scale = o.repDepthScale[r] ?? 1;
    if (tMs < rep.startT || tMs > rep.endT) continue;
    if (tMs <= rep.bottomStartT) return scale * ease((tMs - rep.startT) / (o.descentS * 1000));
    if (tMs <= rep.bottomEndT) return scale;
    return scale * (1 - ease((tMs - rep.bottomEndT) / (o.ascentS * 1000)));
  }
  return 0;
}

type V3 = [number, number, number];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
/** a + Σ k_i * v_i */
const comb = (a: V3, ...terms: Array<[number, V3]>): V3 =>
  terms.reduce<V3>((acc, [k, v]) => add(acc, scl(v, k)), a);
const DEG = Math.PI / 180;

/** Seeded PRNG (mulberry32) and a Box-Muller normal sampler. */
export function makeRng(seed: number): { uniform: () => number; normal: () => number } {
  let s = seed >>> 0;
  const uniform = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const normal = () => {
    const u = Math.max(uniform(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * uniform());
  };
  return { uniform, normal };
}

/** Effective subject yaw in degrees (see `yawDeg`). */
export function subjectYawDeg(o: SquatOptions): number {
  if (o.yawDeg !== undefined) return o.yawDeg;
  const yaw = o.view === 'frontal' ? 0 : o.view === 'diagonal' ? 45 : 90;
  return o.side === 'left' ? yaw : -yaw;
}

/**
 * 3D landmark positions (floor frame, meters: X/Y horizontal, Z up; camera looks along +Y)
 * plus, per landmark, which body side it belongs to (+1 left, -1 right, 0 centre).
 */
export function skeleton(progress: number, o: SquatOptions): { pos: V3[]; sideOf: number[] } {
  // Facing the camera (yaw 0) the subject looks along -Y and their left is +X. Positive yaw
  // turns the left side toward the camera (-Y).
  const psi = -subjectYawDeg(o) * DEG;
  const fwd: V3 = [Math.sin(psi), -Math.cos(psi), 0];
  const left: V3 = [Math.cos(psi), Math.sin(psi), 0];
  const up: V3 = [0, 0, 1];
  const B = BODY;

  const s = progress;
  const thighDeg = 90 - s * (90 - o.depth); // from horizontal; 90 = vertical thigh
  const shin = o.shinLeanDeg * s * DEG;
  const trunk = o.trunkLeanDeg * s * DEG;
  const th = thighDeg * DEG;
  const valgus = o.valgusDeg * s * DEG;
  const shift = o.hipShift * B.thigh * s;

  const pos: V3[] = new Array<V3>(33);
  const sideOf: number[] = new Array<number>(33).fill(0);
  const put = (k: number, p: V3, side: number) => {
    pos[k] = p;
    sideOf[k] = side;
  };

  const origin: V3 = [0, 0, 0];
  let hipMidSag: V3 = origin;
  for (const [sgn, iHip, iKnee, iAnkle, iHeel, iToe] of [
    [1, 23, 25, 27, 29, 31],
    [-1, 24, 26, 28, 30, 32],
  ] as const) {
    const ankle = comb(origin, [sgn * B.stanceHalfWidth, left], [B.ankleHeight, up]);
    const kneeSag = comb(ankle, [B.shin * Math.sin(shin), fwd], [B.shin * Math.cos(shin), up]);
    const knee = comb(kneeSag, [-sgn * B.shin * Math.sin(valgus), left]);
    // Hip from the un-caved knee so pelvis height/position do not depend on valgus.
    const hipSag = comb(kneeSag, [-B.thigh * Math.cos(th), fwd], [B.thigh * Math.sin(th), up]);
    hipMidSag = comb(hipSag, [-sgn * B.stanceHalfWidth, left]); // same for both legs
    const hip = comb(hipMidSag, [sgn * B.hipHalfWidth + shift, left]);
    put(iAnkle, ankle, sgn);
    put(iKnee, knee, sgn);
    put(iHip, hip, sgn);
    put(iHeel, comb(ankle, [-0.06, fwd], [-0.06, up]), sgn);
    put(iToe, comb(ankle, [0.16, fwd], [-0.07, up]), sgn);
  }

  const pelvis = comb(hipMidSag, [shift, left]);
  const tUp: V3 = comb(origin, [Math.sin(trunk), fwd], [Math.cos(trunk), up]); // trunk axis
  const tFwd: V3 = comb(origin, [Math.cos(trunk), fwd], [-Math.sin(trunk), up]);
  const shoulderMid = comb(pelvis, [B.torso, tUp]);
  const head = (u: number, f: number, l: number): V3 =>
    comb(shoulderMid, [u, tUp], [f, tFwd], [l, left]);

  put(0, head(0.22, 0.09, 0), 0);
  put(1, head(0.25, 0.08, 0.02), 1);
  put(2, head(0.25, 0.08, 0.035), 1);
  put(3, head(0.25, 0.075, 0.05), 1);
  put(4, head(0.25, 0.08, -0.02), -1);
  put(5, head(0.25, 0.08, -0.035), -1);
  put(6, head(0.25, 0.075, -0.05), -1);
  put(7, head(0.23, 0, 0.075), 1);
  put(8, head(0.23, 0, -0.075), -1);
  put(9, head(0.18, 0.08, 0.025), 1);
  put(10, head(0.18, 0.08, -0.025), -1);

  // Back-squat arm pose: hands on a bar behind the neck, elbows down and back.
  for (const [sgn, iSh, iEl, iWr, iPi, iIn, iTh] of [
    [1, 11, 13, 15, 17, 19, 21],
    [-1, 12, 14, 16, 18, 20, 22],
  ] as const) {
    const sh = comb(shoulderMid, [sgn * B.shoulderHalfWidth, left]);
    const el = comb(sh, [-0.2, tUp], [-0.15, tFwd], [sgn * 0.08, left]);
    const wr = comb(sh, [0.04, tUp], [-0.08, tFwd], [sgn * 0.14, left]);
    put(iSh, sh, sgn);
    put(iEl, el, sgn);
    put(iWr, wr, sgn);
    put(iPi, comb(wr, [0.04, tUp], [sgn * 0.02, left]), sgn);
    put(iIn, comb(wr, [0.05, tUp]), sgn);
    put(iTh, comb(wr, [0.03, tUp], [-sgn * 0.02, left]), sgn);
  }
  return { pos, sideOf };
}

/** Builds the synthetic `PoseTrack`. See the file header for every option. */
export function makeSquatTrack(opts: Partial<SquatOptions> = {}): PoseTrack {
  const o = resolveOptions(opts);
  const rng = makeRng(o.seed);
  const n = Math.floor((clipDurationMs(o) / 1000) * o.fps) + 1;
  const drop = new Set(o.dropFrames);

  // Camera at (0, -D, h) looking along +Y; image right = +X, image down = -Z.
  const D = o.cameraDistM;
  const camH = o.cameraHeightM;
  const f = (o.fill * o.height * D) / BODY.height;
  const cx = o.width / 2;
  // Vertically centre the standing body (feet at z=0, head at z=height).
  const cy = o.height / 2 - (f * (BODY.height / 2 - camH)) / D;
  const roll = o.tiltDeg * DEG;
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const psi = -subjectYawDeg(o) * DEG;
  // +1 when the subject's left side faces the camera (-Y), -1 for the right side.
  const facing = -Math.sin(psi);

  const frames: PoseFrame[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i * 1000) / o.fps;
    if (drop.has(i)) {
      frames.push({ t, lm: null, world: null });
      continue;
    }
    const { pos, sideOf } = skeleton(progressAt(t, o), o);

    const hipMid = scl(add(pos[23]!, pos[24]!), 0.5);
    const hipDepth = hipMid[1] + D;
    const mPerPx = hipDepth / f;

    const lm: Lm[] = [];
    const world: Lm[] = [];
    for (let k = 0; k < 33; k++) {
      const p = pos[k]!;
      const depth = p[1] + D;
      // Unrolled image coordinates relative to the principal point.
      const ux = (f * p[0]) / depth;
      const uy = (f * (camH - p[2])) / depth;
      // Camera roll: rotate about the principal point (y down => positive = clockwise).
      const rx = ux * cr - uy * sr;
      const ry = ux * sr + uy * cr;
      const x = cx + rx + o.noise * rng.normal();
      const y = cy + ry + o.noise * rng.normal();

      // World: hip-mid origin, image-aligned axes (x right, y down, z away), same roll.
      const wx0 = p[0] - hipMid[0];
      const wy0 = -(p[2] - hipMid[2]);
      const wx = wx0 * cr - wy0 * sr + o.noise * mPerPx * rng.normal();
      const wy = wx0 * sr + wy0 * cr + o.noise * mPerPx * rng.normal();
      const wz = p[1] - hipMid[1] + o.noise * mPerPx * rng.normal();

      const nx = x / o.width;
      const ny = y / o.height;
      let visibility = 0.95 - 0.35 * Math.max(0, -sideOf[k]! * facing);
      if (nx < 0 || nx > 1 || ny < 0 || ny > 1) visibility = 0.1;
      if (o.dropout > 0 && rng.uniform() < o.dropout) visibility = 0.1;

      lm.push({ x: nx, y: ny, z: ((depth - hipDepth) * f) / hipDepth / o.width, visibility });
      world.push({ x: wx, y: wy, z: wz, visibility });
    }
    frames.push({ t, lm, world });
  }

  return {
    version: 1,
    width: o.width,
    height: o.height,
    sampleHz: o.fps,
    frames,
    meta: { source: 'synthetic' },
  };
}
