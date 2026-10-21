# Spatial annotation prototype — implementation and gap log

Started: 2026-10-21. Scope: Honeybee Image panel, 10 FPS, local mock service. This is an implementation experiment, not a delivery-time estimate. The reference findings live in the separate `Semantic-segmentation/docs/spatial-annotation-findings.md` checkout.

## Agreed constraints

- Annotation uses a fixed 10 FPS grid: integer frame index, 100,000,000 ns per tick, relative to player source start.
- Keep the existing player and seeking. Do not introduce a second player or infer source frame numbers from average FPS.
- No real annotation backend or GPU. Async service methods may return data in process.
- Isolate persistence so a remote adapter can replace the mock without changing editor interactions.

## Inspection findings

- `Mp4IterableSource.getBackfillMessages` uses presentation-ordered sample timestamps and selects the last sample at/before the seek target. `RemoteVideoFrameRegistry` resolves the actual timestamp through the existing decoder.
- `ThreeDeeRender` waits for renderer processing before acknowledging the player tick. `ImageRenderable.displayedFrameState` records the image committed for display, separately from the latest message.
- The 10 FPS constraint reduces frame integration to a **small adapter**: integer ticks, seek controls, and a readiness check against the displayed image. Accurate seeking already exists. Real media must still be checked for missing frames, long GOPs, late decoding and offset clocks.
- ImageMode already has image calibration, pan, zoom, flips and rotation. Its mouse-down handler pans; a sibling SVG editor captures authoring gestures, while Pan mode returns input to the existing canvas.
- Existing overlay types have no class/instance IDs or editable draft model. New domain types are necessary; incoming topic annotations remain read-only.

## Implementation ledger

| Item | Status | Complexity / remaining gap |
|---|---|---|
| Fixed 10 FPS indexing and exact tick seeking | Implemented; automated/browser checks passed | Low; uses existing seek pipeline |
| Displayed-frame readiness | Implemented; automated/browser checks passed | Low–medium; reject images >=100 ms stale or ahead of tick |
| Original-image coordinate projection | Implemented; automated/browser checks passed | Medium; reuse calibrated camera in both directions |
| Class / instance / polygon model | Implemented | Medium; stable UUIDs, frame-keyed polygons, original-pixel floats |
| Mock AnnotationService contract | Implemented | Low–medium; async read, commit, history, rollback; scoped CAS and idempotency |
| Class / instance tree, focus, move and instance merge | Implemented; creation exercised in browser | Medium; panel-local prototype; full product menus/drag/drop omitted |
| Polygon creation, selection and vertex drag | Implemented; automated/browser checks passed | Medium; one undo step per completed drag |
| Local drafts and undo/redo | Implemented | Medium; whole-document snapshots bounded to 100 undo entries |
| Nonblocking submit queue | Implemented; automated/browser checks passed | Medium–high; captures immutable snapshots; edits may continue during submit |
| Failure / conflict simulation | Implemented; automated/browser checks passed | Medium; preserve drafts and queue; retry or explicit discard/reload |
| Committed history and rollback | Implemented; automated/browser checks passed | Medium; restore creates a new revision, preserving history |
| Browser and automated checks | Passed for the prototype scope | 79 tests plus real Image panel browser exercises; see verification below |

## Contract and policies chosen for the experiment

`AnnotationService` is UI-independent and asynchronous. A scope currently combines **player session ID + image topic**. The mock is memory-only and shared across panels in the app session; closing/reopening annotation retains drafts. Page refresh clears it. This is deliberate, not durable storage.

- Reads return detached snapshots. Writes carry `expectedRevision` and `requestId`.
- Commits and rollbacks use compare-and-swap. A repeated identical request returns its original receipt; reusing its ID with another payload fails.
- One session writer serializes queued snapshots. Successful older submissions never overwrite newer local edits.
- A failed submission stops dependent submissions. A transient failure can retry; a revision conflict remains unresolved until explicit discard/reload. Automatic merge/rebase is not implemented.
- Rollback requires a clean draft and drained queue, and creates a new revision. It never erases later history.
- Polygon deletion affects this frame; instance deletion and merge affect all frames in the local document. Merge retains target ID/class. No external references exist yet.
- The readiness policy is **latest image at/before the tick, less than 100 ms old**. This is a proposed sampling policy, not a claim that source videos contain exactly ten images per second. Editing is disabled during playback or between grid ticks.

## Remaining gaps and complexity

| Gap | Complexity | Why |
|---|---|---|
| Persistent record/topic identity and sampling manifest | Medium | Player IDs are session-local; backend and inference need the same source start and sampling rule |
| Durable drafts / reload recovery | Medium | IndexedDB, migrations, storage errors and ownership across tabs |
| Fine-grained concurrency and conflict recovery | High | Prototype CAS covers entire source/topic document; real product may require per-frame/per-instance merges |
| Patch-based storage and history | Medium–high | Whole-document copying/stringification does not scale to long videos |
| Polygon edge insertion/deletion, topology, holes and instance union | Medium–high | Prototype supports simple polygons and independent translucent fills; no topology guarantees |
| Workspace sidebar / Moments integration | Medium | Current prototype is inside its Image panel; Moments references and ID redirects are absent |
| Full hierarchy semantics | Medium | Rename, class merge/delete, drag/drop, batch operations and cross-frame reference policy |
| Real inference | Medium frontend; backend separate | Job lifecycle, stale-result ownership, propagation staging and cancellation semantics |
| Live frame-by-frame propagation | High | Additional result transport/backpressure and cancellation policy; not equivalent to completed-job results |
| Server history / rollback policy | Medium–high | Prototype demonstrates UI semantics; retention, concurrent edits and remote durability remain backend decisions |
| Permissions and readonly views | Medium | Entry is development-only and labeled mock; a production permission model remains to be designed |
| Keyboard/accessibility/i18n and dense layouts | Medium | Prototype controls use English and a panel-local layout |

## Verification results

- Dependencies: `yarn install --immutable` completed; manifests and lockfile unchanged.
- `git diff --check`: passed.
- `yarn run tsc --noEmit`: passed.
- `yarn run tsc --noEmit -p packages/studio-base/tsconfig.json`: passed. This explicitly checks the implementation package in addition to the root configuration.
- Targeted Oxlint and residual ESLint over all changed TypeScript files: passed.
- Targeted Prettier check: passed.
- Jest: **7 suites / 79 tests passed**, including the new service/session/canvas/projection tests, existing ThreeDeeRender and Renderer integration tests, ImageMode decode/seek tests, and MP4 source backfill tests. Run with `--watchman=false` because the sandbox cannot modify the user's Watchman state.
- New interaction test: draw/finish polygons with original-image floats, block completion during a seek, drag a vertex, and undo the entire drag in one step.
- New projection tests: original-image float round trips for 0/90/180/270° rotation, horizontal/vertical flips, zoom, pan and aspect fit.
- Browser: exercised the real Honeybee app in Ego Lite with a generated 1280×720, 30 FPS, five-second H.264 video. Confirmed creation, vertex drag, undo/redo, submit, +0.1/-0.1 second navigation and frame-specific geometry.
- Browser: confirmed that deleting/submitting a polygon and restoring an earlier revision brings it back as a new revision; a simulated write failure preserves the draft and Retry succeeds. An external revision produced a conflict without discarding the local draft; explicit discard/reload recovered the server geometry. Close/reopen retained revision r6 and its polygon.
- The browser harness used a loopback app proxy with a synthetic user and local gRPC-web fixtures, plus an HTTP Range media server. This accommodates the app's existing login gate; no production authentication code was changed.

Browser coverage did not exercise every tree operation, merge/move semantics, multi-panel concurrent editing or long-video performance. No real inference quality, production auth, backend persistence or real dataset performance claim is made by this experiment.

## Trying the implementation

1. Run `yarn web:serve` in this checkout and open a video in an Image panel. The entry is intentionally gated to development builds.
2. Click **Annotate · mock** at the bottom left of that panel.
3. Add a class, add an instance, then click **+ polygon**. Place at least three vertices; Enter or right-click completes, Escape cancels.
4. Select a polygon to drag its vertices. Use **Pan** for the existing image pan controls; the wheel zooms while authoring as well.
5. Use **−0.1s / +0.1s** to move on the annotation grid. After a global seek, click the **Frame** button to snap to the nearest tick. Drawing stays disabled until the actual displayed image is ready.
6. Submit, keep editing, and inspect the queue. **Undo/Redo** affect drafts; **Restore** creates a new committed revision and requires a clean draft and queue.
7. **Fail next write** and **Simulate external revision** exercise failure/conflict behavior. **Discard drafts / reload saved** explicitly discards local edits and loads the mock server's head.

Closing annotation retains the session. Refreshing the page, rebuilding the module or changing player session clears this in-memory experiment. Do not use it for production annotation.

## Complexity conclusions after implementation

- **10 FPS alignment — low:** the existing seeker was sufficient for the tested sample. The required work was an integer tick adapter, exact navigation and a displayed-image readiness check, not a replacement player.
- **Basic polygon authoring — medium:** much of the geometry/view plumbing was reusable. Input ownership, image-coordinate conversion and gesture cancellation still required dedicated code. Edge editing, topology/holes and dense-scene performance remain separate work.
- **Local model + mock service — low–medium:** an async interface can run entirely in process. Backend unavailability does not block building and exercising these interactions.
- **Drafts + queue + revisions — medium–high:** the main work is consistency: immutable in-flight snapshots, keeping newer edits, serializing writes, preserving failed jobs and separating local undo from committed rollback. Those paths are implemented and tested.
- **Production completion — higher:** persistence and scale, per-frame/per-instance conflicts, durable record identity, full hierarchy semantics, Moments references and inference are still real gaps. This experiment makes those boundaries concrete without estimating calendar time.

## Follow-up: endless busy cursor after playback

User report: the cursor in the video area kept spinning.

Reproduced a matching failure after playback stopped: the player ended at 5.033333333 s with its last displayed frame at 4.966666667 s. The editor required an exact 100 ms tick and used a busy cursor for every disabled state, so it could look as though it was still loading indefinitely.

Changes:

- Forward the player's playing/paused state to the editor, including transitions that do not emit another renderer frame.
- Automatically align paused playback and manual timeline seeks to the annotation grid.
- Bound navigation by source duration. At EOF, choose a tick covered by an image actually displayed instead of trusting the container tail; for this test video that is 4.9 s.
- Replace the disabled busy cursor with a non-editable cursor and an explanation. A seek that fails to complete gets a five-second timeout and an explicit Retry frame action; drafts are retained.

Validation: three new regression tests cover stopping without another renderer frame, bounded navigation and seek timeout/retry. The expanded eight-suite run passed 82 tests; after refining the EOF policy, the three affected regression tests passed again. Root/studio typechecks, targeted lint and formatting passed. Browser playback to EOF finished with current time = displayed time = 4.9 s, playback stopped, no waiting alert and the default cursor.

If an older demo tab is still at a failed end timestamp, reopen the `/demo` entry to start the test video from its initial frame.
