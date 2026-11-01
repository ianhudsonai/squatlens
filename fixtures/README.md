# Fixtures

Pose tracks of real squat clips, used by the eval harness (`npm run eval`, see `eval/`)
and, later, by tests that skip when this folder is empty. Each fixture is a `PoseTrack` JSON
(`src/core/types.ts`): image and world landmarks per sampled frame, plus the video size.

**Never commit video or images.** A fixture holds only the 33 landmark points per frame
(the face is 11 coarse points such as nose, eyes and ears; no pixels). Only add clips of
people who agreed **in writing** to their pose data being stored in this public repository.
Record that agreement outside the repo; do not put names in file names, labels or notes.

## Add a clip

1. Film one set of 3-5 squats, either from the side (camera at hip height, whole body in
   frame) or from the front. Keep the camera still and level.
2. Open the app (`npm run dev`), load the video and wait for the analysis to finish.
3. Use the pose-track JSON export (currently "Exportar landmarks (JSON)"). It downloads
   `<video name>.pose.json`. The video itself stays on your device.
4. Rename it to a neutral id, e.g. `lat-01.json` (letters, digits, `-`, `_`, `.`), and put it
   here. `<clip_id>.pose.json` also works.
5. Add one row per rep to `eval/labels.csv`:

   ```csv
   clip_id,view,rep_index,depth_label,valgus_label,notes
   lat-01,lateral,1,below,na,
   lat-01,lateral,2,parallel,na,"slow, paused"
   front-01,frontal,1,below,yes,
   ```

   - `view`: `lateral` or `frontal`.
   - `rep_index`: 1 for the first rep in the clip, 2 for the second, and so on.
   - `depth_label`: judged from the video at the bottom of the rep. `below` = hip crease
     below the top of the knee, `parallel` = about level, `above` = higher. Label every rep,
     including frontal clips (the app does not measure depth from the front, and the report
     counts those as "not measured").
   - `valgus_label`: `yes` if the knees visibly cave in, `no` if not, `na` if you cannot
     tell (always `na` for side views).

6. Run `npm run eval`. It writes `eval/RESULTS.md` with agreement, confusion matrices and
   the reps worth a second look.

To try the harness without real clips: `npm run eval -- --synthetic` (writes
`eval/synthetic/RESULTS.md`, not committed).
