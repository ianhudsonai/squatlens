# Third-party components

squatlens is MIT licensed. It ships or downloads the following third-party components,
all served from the app's own origin at runtime (nothing is loaded from a CDN).

## MediaPipe Tasks Vision (`@mediapipe/tasks-vision` 1.2.0)

- What: JavaScript API and WebAssembly runtime for the pose landmarker. The WASM files
  (`vision_wasm_internal.*`, `vision_wasm_nosimd_internal.*`) are copied from the npm
  package into `public/wasm/` by `scripts/fetch-models.mjs`.
- License: Apache License 2.0.
- Source: <https://github.com/google-ai-edge/mediapipe>,
  <https://www.npmjs.com/package/@mediapipe/tasks-vision>

## MediaPipe Pose Landmarker models (BlazePose GHUM 3D)

- What: `pose_landmarker_lite.task`, `pose_landmarker_full.task`,
  `pose_landmarker_heavy.task` (float16, version 1), downloaded by
  `scripts/fetch-models.mjs` into `public/models/` and verified against pinned SHA-256
  hashes. They are not committed to this repository.
- License: Apache License 2.0, per the model card.
- Model card:
  <https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf>
- Documentation:
  <https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker>

The Apache License 2.0 text is available at <https://www.apache.org/licenses/LICENSE-2.0>.
