# squatlens

Squat form analysis that runs entirely in your browser. Pick a video of a set, and squatlens
finds each rep and reports depth, trunk lean, tempo and, from the front, knee cave and
side-to-side asymmetry. Feedback is in Brazilian Portuguese (default) or English.

**Try it:** <https://ianhudsonai.github.io/squatlens/>

> Feedback de movimento, não é dispositivo médico nem substitui treinador ou fisioterapeuta.
> (Movement feedback, not a medical device, and no substitute for a coach or physiotherapist.)

<!-- Demo GIF goes here once there is a clip we can publish. -->

_Demo GIF: coming soon._

## Privacy

After the page loads, the app makes no requests to other servers; your video is processed in
your browser and never uploaded (verified by an automated test in CI).

How that holds up:

- The pose model and its WebAssembly runtime are served by the app itself, from the same
  origin as the page. No CDN, web fonts, analytics or trackers.
- The MediaPipe library tries to send usage statistics to Google
  (`odml.pa.googleapis.com`) and has no switch to turn that off. squatlens blocks it twice:
  `fetch` refuses any cross-origin URL before a request is made
  ([`src/pose/sameOriginFetch.ts`](src/pose/sameOriginFetch.ts)), and the page's
  Content-Security-Policy (`connect-src 'self' blob: data:`) makes the browser refuse it too.
- [`e2e/privacy.spec.ts`](e2e/privacy.spec.ts) loads the production build in Chromium,
  analyses a synthetic video and fails if any request goes to another origin or if the CSP
  ever has to block one. It runs on every pull request.
- The model is kept in your browser's Cache Storage, so after the first visit it is not
  downloaded again.

## What it measures

squatlens runs the MediaPipe Pose Landmarker on your video (about 30 frames per second),
which places 33 body points on each frame. Everything after that is plain geometry in
[`src/core/`](src/core/), done in pixel coordinates so tall phone videos and wide videos give
the same answer.

First it looks for the moments you stand still at the start to calibrate: your standing
thigh length (hip to knee, in pixels) becomes the ruler for every distance, and your standing
posture is the baseline for every change.

Then it decides how you filmed:

| Camera view | Measured                                |
| ----------- | --------------------------------------- |
| Side        | depth, trunk lean, tempo                |
| Front       | knee cave (valgus), asymmetry, tempo    |
| Diagonal    | tempo only, plus a suggestion to refilm |

The view comes from how wide your shoulders look compared to your torso, and from the depth
information MediaPipe estimates for the shoulders and hips.

### Reps and tempo

A rep is the hip going down at least 40% of the deepest drop in the clip and coming back up
to standing. **Descent**, **pause** at the bottom and **ascent** are timed in seconds from the
video timestamps. **Ascent speed** is how fast the hip rises, in thigh lengths per second.
With two or more reps, **speed loss** compares the last rep to the first, a rough fatigue
signal.

### Depth (side view)

At the bottom of each rep, the hip point is compared with the knee point on the side facing
the camera. The height difference, divided by your thigh length, gives:

- **below parallel** when the hip is more than 5% of a thigh length below the knee,
- **above parallel** when it is more than 5% above,
- **parallel** in between,
- **borderline** when it is within 2% of one of those lines, where a camera cannot really
  decide.

The thigh angle and knee bend at the bottom are reported too.

### Trunk lean (side view)

At the bottom, the angle of the torso (hip to mid-shoulder) and of the shin (ankle to knee),
each against vertical. If the torso leans more than 25° beyond the shin, you get a hint to
open the chest. A long femur or a low-bar squat can make that normal, so treat it as a hint.

### Knee cave (front view)

For each leg, the frontal knee angle (hip, knee, ankle) from the point where you are 30% of the way down to the bottom and back up,
compared with your standing angle, plus how the distance between the knees changes relative
to the distance between the ankles. An alert fires when either knee angle moves inward by
more than 10°, or the knees close in by more than 20% relative to the ankles.

### Asymmetry (front view)

At the bottom: how far the hips shifted sideways over the feet, the height difference
between the left and right hip (both in thigh lengths), and the difference in knee bend
between the legs. Flags above 10%, 8% and 10° respectively.

Every threshold is a starting guess, to be tuned with labelled clips (see
[Validation](#validation)). When a metric cannot be measured, for example the knee is hidden
or you filmed from the wrong angle, the report says so ("sem dados") instead of showing a
number. When the video itself is too poor (body cut off, too dark, too few usable frames)
the report lists the problems and shows no metrics at all.

## Limits

- **2D, one camera.** Angles are measured in the image. A camera that is not at hip height,
  not square to you, or tilted changes them. squatlens warns when the camera looks tilted.
- **Joint centres, not the hip crease.** Powerlifting rules judge depth by the top of the
  thigh at the hip crease versus the top of the knee. squatlens compares the hip and knee
  joint centres, which is close but not the same; the borderline band exists for that.
- **Knee cave is an alert, not a diagnosis.** Frontal 2D knee angles agree only loosely with
  3D motion capture, so the confidence for knee cave is never higher than "medium".
- **Hip speed, not bar speed.** Ascent speed and speed loss track the hip. They follow bar
  speed in a normal squat but are not a velocity-based-training device.
- **Squats only**, one person in frame, one set per video.

## Validation

Pending. The evaluation harness ([`eval/`](eval/)) compares the app's depth and knee-cave
calls with human labels, but there are no real labelled clips yet, so there are no accuracy
numbers to report. This section will link `eval/RESULTS.md` when there are.

### Contributing validation clips

Clips are what squatlens needs most. The video never goes into the repository; only the pose
points (33 points per frame, no pixels) do, and only with the filmed person's written
consent. See [`fixtures/README.md`](fixtures/README.md) for how to film, export the landmarks
from the app and label each rep, then open a pull request with the fixture and the rows in
`eval/labels.csv`.

## Run it locally

Requires Node 22 (see `.nvmrc`).

```sh
npm ci
npm run dev        # dev server; downloads the pose models into public/ on first run
npm run build      # production build into dist/
npm run preview    # serve the build at http://localhost:4173/squatlens/
```

Checks:

```sh
npm run lint       # eslint (src/core is restricted to pure TypeScript)
npm run typecheck  # tsc -b (src/core is checked without DOM types)
npm test           # unit tests (vitest)
npm run test:e2e   # privacy test (Playwright); run `npm run build` first and
                   # `npx playwright install chromium` once
npm run eval       # validation report from fixtures/ and eval/labels.csv
npm run format     # prettier
```

Add `?delegate=cpu` to the page URL to force CPU inference if the GPU path misbehaves.

The design and its rules are in [`docs/SPEC.md`](docs/SPEC.md).

## Credits

- Pose estimation: [MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker)
  (`@mediapipe/tasks-vision` and the BlazePose GHUM 3D models) by Google, Apache License
  2.0. Details in [`THIRD_PARTY.md`](THIRD_PARTY.md).

## License

[MIT](LICENSE)
