# squatlens v0.1 spec

Browser-only squat form analysis. Upload a video, get an analysis in Brazilian Portuguese
(default) or English: depth, trunk lean, tempo, and (front view) knee cave and asymmetry.
Nothing leaves the device. Movement feedback, not a medical device.

This spec supersedes the original plan; see [`PLAN-AUDIT.md`](./PLAN-AUDIT.md) for what
changed and why. Tickets are GitHub issues labelled `v0.1`; their order is in §12.

## 0. Non-negotiable rules

1. Pose = `@mediapipe/tasks-vision` **1.2.0** (exact pin) `PoseLandmarker`. Never
   `@mediapipe/pose`, `mp.solutions.pose`, or TF.js.
2. WASM and `.task` models are served by the app itself (same origin). No CDN, no fonts,
   no analytics. An automated test fails the build on any cross-origin request.
3. Never invent data. A metric with insufficient visible data is `null` with a `reason`,
   never `0`.
4. All analysis logic lives in `src/core/`: pure TypeScript, no DOM, no MediaPipe import,
   deterministic, unit-tested.
5. All geometry happens in **pixel space** (`x*width`, `y*height`), never on normalized coords.
6. Valgus is an alert with a confidence level, never a diagnosis. UI and README carry:
   "Feedback de movimento, não é dispositivo médico nem substitui treinador ou fisioterapeuta."
7. TypeScript `strict: true`, no `any` in `src/core`.

## 1. Stack

Vite + React 18+ + TypeScript strict, vitest, eslint (typescript-eslint) + prettier,
Playwright (privacy/e2e), GitHub Actions, GitHub Pages deploy (Vite `base: '/squatlens/'`).
Node 22. MIT license. Use whatever current stable versions `npm create vite@latest` gives,
except tasks-vision which is pinned.

## 2. Repository layout

```
src/
  core/                 pure TS, no DOM
    types.ts            shared contract (§3) — defined in ticket 1, edited only with care
    landmarks.ts        MediaPipe index constants
    geometry.ts         pixel conversion, angles, distances, midpoints
    smoothing.ts        One-Euro filter, gap interpolation, visibility gating
    calibration.ts      standing-frame detection, standing femur length
    quality.ts          global quality gate
    view.ts             detectView + camera side
    reps.ts             segmentReps
    metrics/
      depth.ts  trunk.ts  tempo.ts  valgus.ts  asymmetry.ts
    analyze.ts          analyzeSet(track) -> SetReport (orchestrator)
    cues/
      index.ts  pt-BR.ts  en.ts
    index.ts            public barrel (edited only by the analyze ticket)
  pose/                 MediaPipe + browser APIs
    landmarker.ts       create PoseLandmarker (GPU->CPU fallback), close
    extractFrames.ts    seek-step video reader -> PoseTrack
    modelCache.ts       Cache Storage for models
  ui/                   React components
test/
  synthetic/            synthetic PoseTrack generator (ticket 3) used by all core tests
fixtures/               real landmark JSON (no video, no face) — from ian's clips later
eval/
  labels.csv            human labels (ian)
  run-eval.ts           runs core over fixtures, writes RESULTS.md
scripts/
  fetch-models.mjs      downloads .task files (SHA-256 pinned), copies WASM
e2e/
  privacy.spec.ts       fails on any cross-origin request
public/models/ public/wasm/   gitignored, filled by fetch-models
docs/
```

## 3. Shared types (`src/core/types.ts`)

Ticket 1 creates this file exactly; later tickets may *add* fields but must not rename.

```ts
export interface Lm { x: number; y: number; z: number; visibility: number; presence?: number }

/** One sampled video frame. lm = 33 normalized image landmarks, or null when no pose. */
export interface PoseFrame { t: number; lm: Lm[] | null; world: Lm[] | null }

/** Whole clip, as produced by src/pose or loaded from a fixture JSON. */
export interface PoseTrack {
  version: 1;
  width: number;            // source video pixels
  height: number;
  sampleHz: number;         // requested sample rate
  frames: PoseFrame[];      // t strictly increasing, ms
  meta?: { model?: 'lite' | 'full' | 'heavy'; delegate?: 'GPU' | 'CPU'; source?: string };
}

export type View = 'lateral' | 'frontal' | 'diagonal' | 'unknown';
export type Side = 'left' | 'right';
export type Confidence = 'low' | 'medium' | 'high';
export type NullReason = 'low_visibility' | 'wrong_view' | 'insufficient_frames' | 'no_reps';

export interface Metric<T> { value: T | null; confidence: Confidence | null; reason?: NullReason }

export interface ViewResult {
  view: View; side: Side | null;     // side = camera-facing side in lateral view
  ratio2d: number | null; yawDeg: number | null; confidence: Confidence | null;
}

export interface Rep {
  index: number;
  startFrame: number; bottomFrame: number; endFrame: number;
  startT: number; bottomT: number; endT: number;   // ms
  depthNorm: number;                                // 0 standing .. 1 deepest rep in set
}

export interface Calibration {
  standingFrames: number[];               // indices used
  femurPx: { left: number | null; right: number | null };
  standingHipY: number;                   // px
}

export type DepthClass = 'below' | 'parallel' | 'above' | 'borderline';
export interface DepthResult { delta: number; cls: DepthClass; thighAngleDeg: number; kneeFlexDeg: number }
export interface TrunkResult { trunkDeg: number; shinDeg: number; trunkMinusShinDeg: number }
export interface TempoResult { descentS: number; pauseS: number; ascentS: number; ascentHipVel: number }
export interface ValgusResult {
  fppaChangeDeg: { left: number | null; right: number | null };
  kneeAnkleRatioChange: number | null;    // (ratio_rep - ratio_standing)/ratio_standing; negative = knees closing
  flagged: boolean;
}
export interface AsymmetryResult { hipShiftNorm: number; hipHeightDiffNorm: number; kneeFlexDiffDeg: number | null; flagged: boolean }

export interface RepReport {
  rep: Rep;
  depth: Metric<DepthResult>; trunk: Metric<TrunkResult>; tempo: Metric<TempoResult>;
  valgus: Metric<ValgusResult>; asymmetry: Metric<AsymmetryResult>;
}

export interface QualityReport {
  ok: boolean;
  visibleFrac: number; effectiveFps: number; cutOff: boolean; tiltedCamera: boolean;
  problems: Array<'low_visibility' | 'low_fps' | 'cut_off' | 'no_pose' | 'diagonal_view' | 'tilted_camera'>;
}

export interface SetReport {
  version: 1;
  quality: QualityReport; view: ViewResult; calibration: Calibration | null;
  reps: RepReport[];
  velocityLoss: Metric<number>;           // 1 - v_last/v_first (hip, not bar)
  cues: Cue[];
}

export type CueId = string;               // e.g. 'depth.below', 'valgus.flag'
export interface Cue { id: CueId; repIndex: number | null; severity: 'info' | 'warn'; params: Record<string, number | string> }
```

Cue *text* is never in `SetReport`; the UI renders `Cue` through `cues/pt-BR.ts` or `en.ts`
so the exported JSON is language-neutral.

## 4. Pose pipeline (`src/pose/`)

- `fetch-models.mjs`: downloads
  `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_<v>/float16/1/pose_landmarker_<v>.task`
  for lite/full/heavy into `public/models/`, verifies SHA-256 against constants in the script
  (record the hashes on first run), skips if present and valid. Copies
  `vision_wasm_internal.{js,wasm}` and `vision_wasm_nosimd_internal.{js,wasm}` from
  `node_modules/@mediapipe/tasks-vision/wasm` to `public/wasm/`. Runs as `predev`/`prebuild`.
  Binaries are gitignored. Models are Apache-2.0 (model card); add `THIRD_PARTY.md`.
- `landmarker.ts`: `createLandmarker({model, delegate})` →
  `FilesetResolver.forVisionTasks(import.meta.env.BASE_URL + 'wasm')`,
  `PoseLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath, delegate }, runningMode: 'VIDEO', numPoses: 1 })`.
  Try `GPU`, on failure retry `CPU`; URL `?delegate=cpu` forces CPU. Default model: `heavy`
  on desktop, `full` on mobile (UA/`pointer: coarse`), user-selectable.
- `modelCache.ts`: fetch models through Cache Storage with progress events, so a second
  visit works offline.
- `extractFrames.ts`: `extractPoseTrack(file, landmarker, {sampleHz = 30, onProgress, signal})`.
  Loads the file via object URL into an off-DOM `<video muted playsinline>`, steps
  `currentTime` by `1/sampleHz` (capped at native fps when known), awaits `seeked`, calls
  `detectForVideo(video, tMs)` with strictly increasing integer ms, stores `landmarks[0]`/
  `worldLandmarks[0]` or null. Supports cancel. One fresh landmarker per clip (timestamps).
- Overlay: canvas over the player drawing `PoseLandmarker.POSE_CONNECTIONS` for the frame
  nearest `video.currentTime`.
- "Export landmarks (JSON)" downloads the `PoseTrack` (this is how fixtures are made).

## 5. Core algorithms

Indices: shoulder 11/12, hip 23/24, knee 25/26, ankle 27/28, heel 29/30, foot index 31/32,
wrist 15/16, nose 0 (odd = left). All parameters live in one exported `DEFAULTS` object per
module so calibration can tune them; every threshold below is a starting guess.

### 5.1 Pre-processing (`smoothing.ts`, `geometry.ts`)
- Convert to pixels first. A landmark is *usable* in a frame if `visibility ≥ 0.5`
  (and `presence ≥ 0.5` when defined).
- Interpolate linearly across gaps of ≤ 3 consecutive unusable frames; longer gaps stay null.
- One-Euro filter per coordinate (defaults `minCutoff 1.0`, `beta 0.007`, `dCutoff 1.0`,
  time from `t`), applied after interpolation, reset across long gaps.

### 5.2 Calibration (`calibration.ts`)
- Standing frames: within the first 3 s, frames where hip-mid y velocity is below a
  threshold for ≥ 0.5 s and knees are near straight (knee flexion < 20°). Fallback: frames
  whose hip y is within 5% of the set's top hip position.
- `femurPx` per side = median 2D hip→knee length over standing frames. All distance
  normalizations use this, never per-frame length.

### 5.3 View (`view.ts`)
Over standing frames: `ratio2d = shoulderWidthPx / torsoHeightPx` (shoulder-mid to hip-mid);
`yawDeg` = median of `atan2(|Δz|, |Δx|)` of the shoulder and hip axes in `world`.
Lateral if `yaw ≥ 60` or `ratio2d < 0.25`; frontal if `yaw ≤ 25` or `ratio2d ≥ 0.6`;
otherwise diagonal; if signals disagree, confidence low. Camera side in lateral = side with
higher mean visibility of hip/knee/ankle, fixed for the clip. Metrics enabled per view:
lateral → depth, trunk, tempo; frontal → valgus, asymmetry, tempo; diagonal → tempo only
plus a "refilm" cue.

### 5.4 Reps (`reps.ts`)
Signal: hip-mid y (px), smoothed. `depthNorm = (y - standingHipY)/(maxY - standingHipY)`
over the whole clip (offline only; live mode needs an online variant later).
State machine `standing → descending → bottom → ascending → standing` with hysteresis:
enter descending at depthNorm > 0.15, exit to standing at < 0.08; a rep needs depthNorm
> 0.4 at the bottom and ≥ 4 frames per state (debounce). Bottom = frame of max y in the rep.
A rep counts only after returning to standing. Rep `depthNorm` relative to deepest rep.

### 5.5 Depth, lateral (`metrics/depth.ts`)
At `bottomFrame`, camera side: `delta = (hipY - kneeY)/femurPx` (y down; positive = hip
below knee). `below` if delta > +0.05, `above` if < −0.05, `parallel` within ±0.05,
`borderline` when within ±0.02 of either boundary. `thighAngleDeg = atan2(kneeY - hipY, |kneeX - hipX|)`
(positive = knee lower than hip = above parallel). `kneeFlexDeg = 180 − ∠(hip, knee, ankle)`.
Docstring states it approximates the IPF rule (top surface of thigh at hip below top of knee)
with joint centres. Confidence from visibility of hip/knee/ankle at bottom ±2 frames.

### 5.6 Trunk, lateral (`metrics/trunk.ts`)
At bottom: `trunkDeg` = angle of hip→shoulder-mid vs image vertical; `shinDeg` = angle of
ankle→knee vs vertical; `trunkMinusShinDeg`. Cue "trunk much more inclined than shin" when
`trunkMinusShinDeg > 25` (hint, not rule). If standing trunk angle |> 10°| set
`quality.tiltedCamera` and cap confidence at medium.

### 5.7 Tempo (`metrics/tempo.ts`)
`descentS` = start→first frame within 3% of bottom depth; `pauseS` = frames near the bottom
with |hip velocity| < 5% of peak; `ascentS` = end of pause→end. From `t`, never frame counts.
`ascentHipVel` = mean hip speed during ascent in femur lengths per second. Set-level
`velocityLoss = 1 − v_last/v_first` (needs ≥ 2 reps), labelled "hip speed, not bar speed".

### 5.8 Valgus, frontal (`metrics/valgus.ts`)
Per leg FPPA = 180° − ∠(hip, knee, ankle) signed so medial knee displacement is positive.
Evaluate over rep frames with depthNorm ≥ 0.3 up to bottom and back; take the worst change
vs the standing baseline. `kneeAnkleRatio = kneeDistance/ankleDistance`, change vs standing.
Flag if FPPA change > 10° on either leg or ratio change < −0.20 (first guess −0.15 fired at ~5° shin cave on
the synthetic figure; see `valgus.ts` DEFAULTS). Confidence = f(visibility,
signal jitter across the window); never above `medium` (2D frontal knee r = 0.20 vs 3D).

### 5.9 Asymmetry, frontal (`metrics/asymmetry.ts`)
At bottom: hip-mid x shift vs ankle-mid x, and left−right hip y difference, both / mean
femurPx; left vs right knee flexion difference. Flag above 0.10 / 0.08 / 10°.

### 5.10 Quality gate (`quality.ts`)
`visibleFrac` = frames where the view's required landmarks are usable; `effectiveFps` =
usable frames / duration; `cutOff` = ankles/heels or nose outside [0,1] or presence < 0.5 in
> 20% of frames. `ok = visibleFrac ≥ 0.7 && effectiveFps ≥ 15 && !cutOff && pose found`.
When not ok the UI shows the problems and *no* metrics report.

### 5.11 Orchestrator (`analyze.ts`)
`analyzeSet(track, opts?) → SetReport`: smooth → calibrate → view → quality → reps →
per-rep metrics enabled by view (others `{value:null, reason:'wrong_view'}`) → velocity
loss → cues. Pure and deterministic.

## 6. Cues (`core/cues/`)
`generateCues(report)` returns `Cue[]` from deterministic rules; `pt-BR.ts`/`en.ts` map
`CueId` + params to text. Minimum set:

| id | pt-BR |
|---|---|
| depth.below | Boa profundidade: o quadril passou da linha do joelho. |
| depth.parallel | Na linha do paralelo. |
| depth.borderline | Perto do limite do paralelo, difícil cravar pela câmera. |
| depth.above | Quase lá: desça mais um pouco. |
| trunk.forward | Tronco bem mais inclinado que a canela: tente abrir o peito. |
| valgus.flag | Seus joelhos tenderam a entrar (confiança {conf}): pense em empurrar o chão para fora. |
| asym.shift | O quadril desviou para a {side} no fundo. |
| tempo.summary | Descida em {d} s e subida em {a} s. |
| tempo.fast_descent | Descida rápida: tente controlar mais. |
| fatigue.loss | A velocidade de subida caiu {pct}% da primeira para a última rep. |
| view.diagonal | Câmera na diagonal: filme de lado (profundidade) ou de frente (joelhos). |
| quality.* | one per QualityReport problem, e.g. "Iluminação ou enquadramento ruim: refaça o vídeo." |
| nodata.* | "Sem dados suficientes para {metric}." |

## 7. UI (`src/ui/`)
Single page, mobile-first, PT-BR default with PT/EN toggle (persisted in localStorage).
Flow: landing (pitch + privacy line + disclaimer) → pick video → model download progress →
processing progress (cancel) → result: player with skeleton overlay, view badge, quality
banner, per-rep cards (depth, trunk, tempo or valgus/asymmetry, "sem dados" shown
explicitly), hip-y over time chart with reps shaded (small inline SVG, no chart lib
needed), cue list, buttons "Exportar análise (JSON)" and "Exportar landmarks (JSON)".

## 8. Privacy proof
`e2e/privacy.spec.ts` (Playwright, Chromium): serves the production build, loads a small
synthetic test video from `e2e/assets/`, runs a full analysis, and fails if any request
URL's origin differs from the page origin. Runs in CI. README states exactly: "After the
page loads, the app makes no requests to other servers; your video is processed in your
browser and never uploaded (verified by an automated test in CI)."

## 9. Testing
- Unit (vitest) for every core module with the synthetic generator: perfect deep squat,
  shallow, parallel, borderline, valgus, hip shift, lateral vs frontal vs diagonal,
  low visibility, gaps, 9:16 vs 16:9 (aspect-ratio regression), tilted camera.
- `test/synthetic/`: `makeSquatTrack({view, reps, depth, valgusDeg, hipShift, fps, width,
  height, noise, dropout})` builds a kinematic stick figure and projects it to normalized
  landmarks + world landmarks. Deterministic (seeded noise).
- Real fixtures (`fixtures/*.json`) added when ian provides clips; tests skip when absent.

## 10. Validation (`eval/`)
`labels.csv`: `clip_id,view,rep_index,depth_label(below|parallel|above),valgus_label(yes|no|na),notes`.
`npm run eval` loads `fixtures/<clip_id>.json`, runs `analyzeSet`, matches reps, writes
`eval/RESULTS.md`: agreement %, confusion matrix per metric, borderline count, list of
disagreements. Works on synthetic labelled data until real clips exist.

## 11. CI / deploy
`ci.yml`: install, fetch-models (cached by hash), lint, typecheck, test, build, Playwright
privacy test. `deploy.yml`: on push to `main`, build and deploy to GitHub Pages.

## 12. Tickets and order

| # | Ticket | Depends on | Wave |
|---|---|---|---|
| 1 | Scaffold, tooling, CI, shared types | — | 1 |
| 2 | Self-hosted models + pose pipeline + overlay page | 1 | 2 |
| 3 | Core geometry, smoothing, calibration, synthetic generator | 1 | 2 |
| 4 | detectView + quality gate | 3 | 3 |
| 5 | segmentReps + tempo | 3 | 3 |
| 6 | Lateral metrics: depth + trunk | 3 | 3 |
| 7 | Frontal metrics: valgus + asymmetry | 3 | 3 |
| 8 | analyzeSet orchestrator + cues PT-BR/EN | 4,5,6,7 | 4 |
| 9 | Report UI, chart, JSON exports, PT/EN | 2,8 | 5 |
| 10 | Eval harness (labels.csv → RESULTS.md) | 8 | 5 |
| 11 | Privacy e2e test, GitHub Pages deploy, README | 9 | 6 |

Waves run in parallel internally; tickets in one wave touch disjoint files. Only ticket 8
edits `src/core/index.ts`. Ticket 1 owns `types.ts`; others may add fields only.

Backlog (v0.2, not scheduled): live camera with online rep segmentation and voice cues;
bar-path proxy (wrist/shoulder mid vs mid-foot); Web Worker inference; model comparison and
real bar detection (v1.0).

Needs ian (tracked, skipped until available): validation clips + labels, real fixtures,
phone tests, OK for posts.
