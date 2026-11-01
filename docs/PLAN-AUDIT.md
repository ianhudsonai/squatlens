# Plan audit (2026-11-01)

Audit of the original plan (`squatlens-plan.md`, PT-BR). Every ⚠️ item was checked; the
result and the resulting change to the spec are listed below. The spec that replaces the
plan is [`SPEC.md`](./SPEC.md).

## 1. Verified facts

| ⚠️ item in plan | Finding | How checked | Change |
|---|---|---|---|
| `@mediapipe/tasks-vision` version (1.2.0 vs 0.10.35) | **1.2.0** is the `latest` dist-tag (published 2026-10-27). `nightly` is `1.2.1-rc.20261031`. 0.10.35 is the last 0.10.x. | `npm view @mediapipe/tasks-vision dist-tags time` | Pin `"@mediapipe/tasks-vision": "1.2.0"` exactly (no caret). |
| "API may have changed between 0.10.x and 1.x" | The `PoseLandmarker` section of `vision.d.ts` is **byte-identical** between 0.10.35 and 1.2.0. API: `FilesetResolver.forVisionTasks(basePath)`, `PoseLandmarker.createFromOptions(fileset, {baseOptions:{modelAssetPath, delegate:'GPU'\|'CPU'}, runningMode:'IMAGE'\|'VIDEO', numPoses, minPoseDetectionConfidence, minPosePresenceConfidence, minTrackingConfidence, outputSegmentationMasks})`, `detectForVideo(frame, timestampMs): PoseLandmarkerResult` (sync) or with a callback, `close()`. Result: `landmarks: NormalizedLandmark[][]`, `worldLandmarks: Landmark[][]`. `NormalizedLandmark` = `{x,y,z,visibility,presence?}`. | Downloaded both tarballs, diffed `vision.d.ts`. | Spec uses this API. Note: web `RunningMode` is only `IMAGE`/`VIDEO` (no `LIVE_STREAM` on web); timestamps passed to `detectForVideo` must strictly increase per instance. |
| WASM files | 3 variants of ~14 MB each (`vision_wasm_internal`, `_nosimd_internal`, `_module_internal`). `forVisionTasks` picks SIMD vs no-SIMD itself. | Unpacked tarball. | Self-host only `vision_wasm_internal.{js,wasm}` and `vision_wasm_nosimd_internal.{js,wasm}`. |
| Model file license | Model card "BlazePose GHUM 3D" states **"Licensed under Apache License, Version 2.0"**. It also says the primary intended application is entertainment and it is "not intended for human life-critical decisions". | Downloaded the model card PDF linked from the official Pose Landmarker page and extracted the text. | Redistribution is allowed with attribution (add `NOTICE`/`THIRD_PARTY.md`). We still do **not** commit the binaries (heavy = 30.7 MB); `npm run fetch-models` downloads them pinned by SHA-256, and CI fetches them for build/deploy. The model card wording backs the "not a medical device" disclaimer. |
| Model URLs | Versioned URLs `…/pose_landmarker_{lite,full,heavy}/float16/1/…task` return 200. Sizes: lite 5.8 MB, full 9.4 MB, heavy 30.7 MB. Docs now link `/latest/`. | `curl -I` | Use the `/1/` URLs (reproducible), never `/latest/`. |
| Hidden network calls from the library | No telemetry endpoints in `vision_bundle.mjs` / wasm JS (only URLs in comments). | grep for `https?://` in the bundle. | Still prove it with an automated Playwright test that fails on any non-same-origin request. |
| 2D valgus validity, r = 0.20 | Confirmed: *Validity of an AI human pose estimation model for measuring single-leg squat kinematics*, J Biomech 2022 (PMID 36198251), adolescent athletes, frontal-plane knee r = 0.20 vs 3D ("poor"). | PubMed abstract. | Keep valgus as a low-confidence alert. |
| iOS Safari + GPU delegate | Open MediaPipe issue (#6142) where the GPU delegate returns wrong outputs on iOS Safari for Image Segmenter, CPU delegate is correct. Not pose-specific, but it is the same WebGL path. | GitHub issue. | Landmarker wrapper tries GPU, falls back to CPU on error, and supports `?delegate=cpu`. Phone testing (needs ian) compares GPU vs CPU landmarks on the same clip. |
| npm name `squatlens` | Still free (404). | `npm view squatlens` | — |

## 2. Competitor table corrections

The plan says the niche is "nearly all 0-3 stars" and that no project is view-aware. Both are partly wrong:

| Project | What it is | Relevance |
|---|---|---|
| NgoQuocBao1010/Exercise-Correction (MIT, **~131★**) | Python ML classifiers on MediaPipe + Vue/Django web app, 4 exercises incl. squat. Server-side. | The biggest one in the niche. Not browser-only, no validation vs human labels of form faults, English. |
| nimrafaryal/AI-Squat-and-Push-up-Coach (MIT, ~29★) | Local Python pipeline, outputs a dashboard video. **Has separate side-view and front-view metric sets** (depth/torso/heels vs knee cave), says thresholds are uncalibrated. | Kills the claim "nobody switches metrics by camera view". We can still claim **automatic** view detection + "no data" + browser-only + published agreement numbers. |
| PedroPivaDoNascimento/Personal-Squat-AI-Analyzer (0★) | Python/OpenCV/MediaPipe with a local Django server, PT README; alerts knees-past-toes, rounded back, heel lift. No view handling, no validation. | Now read; not browser-only. |
| CaioFLT/Agachamentos (0★) | Python desktop webcam app, PT README, knee angle + depth + reps. | Another PT project; desktop. |
| wijayamakro19-sketch/FormAI-Coach-Elevate (~55★) | README reads as SEO copy ("AI Form Checker 2026"). | Not verified; don't cite. |

**Conclusion:** the differentiator still holds, reworded: *the only browser-only (no server, no upload) squat analyzer that detects the camera view automatically, says "no data" instead of guessing, gives PT-BR coaching cues, and publishes its agreement against human labels.* Never claim "first" in posts.

## 3. Technical errors found in the plan (fixed in the spec)

1. **Aspect-ratio distortion.** MediaPipe `x` is normalized by image width and `y` by height. All angles and distances in the plan are computed on normalized coords, which is wrong for any non-square video (a 9:16 phone video stretches every angle). **Fix:** convert to pixel space (`x*width`, `y*height`) before any geometry. This is in `core/geometry.ts` and every metric must go through it.
2. **Per-frame femur normalization breaks in frontal view.** At the bottom of a squat filmed from the front, the thigh points at the camera and its 2D length collapses, so dividing by it explodes. **Fix:** normalize by the *standing* femur length (median over the calibrated standing frames), per side.
3. **View detection threshold "~0 = lateral" is unrealistic.** A loaded side-view squatter rarely has 2D shoulder width near 0. **Fix:** two signals: (a) 2D ratio shoulder-width/torso-height, (b) yaw of the shoulder and hip axes from `worldLandmarks` (`atan2(|Δz|, |Δx|)`). Starting thresholds: lateral if yaw ≥ 60° or ratio < 0.25; frontal if yaw ≤ 25° or ratio ≥ 0.6; else diagonal. All configurable, all to be calibrated.
4. **Rep normalization "1 = lowest point of the set" needs the whole video.** Fine for uploads (v0.1 is upload-only) but not for live camera. Spec flags it; live mode (v0.2) needs an online variant.
5. **IPF rule wording.** IPF: "the top surface of the legs at the hip joint is lower than the top of the knees". Our measure compares hip *joint centre* vs knee *joint centre*, an approximation of unknown bias; the validation step measures it. README must say "estimated depth", never "competition depth".
6. **Camera tilt.** Trunk lean "vs vertical" assumes the phone is upright. **Fix:** report the standing trunk angle; if |standing lean| > 10° warn "camera may be tilted" and lower confidence.
7. **Frame extraction.** `requestVideoFrameCallback` during playback drops frames when inference is slower than real time (heavy model on a phone). **Fix:** seek-step extraction (set `currentTime`, await `seeked`, detect) at a fixed sample rate (default 30 Hz, capped at native), timestamps from media time, strictly increasing integer ms.
8. **Payload on mobile.** heavy model + WASM ≈ 45 MB on first load. **Fix:** default model `full` on mobile / `heavy` on desktop with a selector, lazy download with progress, cache in Cache Storage so later visits work offline.
9. **Valgus at the bottom is the least reliable frame** (foreshortened thigh). **Fix:** evaluate knee-in over the rep frames between 30% depth and the bottom, and report the worst change vs standing, with confidence.

## 4. Items that still need ian (skipped for now, tracked)

- Film 20-30 labelled squats (side + front, deliberate variations) and fill `eval/labels.csv`. Only ian or people who agreed in writing. Blocks real-data calibration and `RESULTS.md`.
- Provide 3-4 real clips for landmark fixtures (exported from the app as JSON, no video committed).
- Physical phone tests (iPhone Safari + Android Chrome): load time, GPU vs CPU landmarks, processing speed.
- OK before any social post (LinkedIn / X / Instagram). Nothing gets posted without it.
- Kilo integration idea stays a note; nothing touches Kilo.

## 5. Skills

`/to-spec`, `/to-tickets` and `/implement` are not installed in this session; the equivalent artifacts are `docs/SPEC.md` and GitHub issues with explicit dependencies. `/code-review` exists and will be used per ticket.
