# The segmentation editor and the AnnotationService

The editor reads and writes the annotations of cloud recordings through the live `AnnotationService` (cosceneapis #866, gRPC-Web). Only cloud recordings can be annotated. The feature is behind the rollout flag `honeybee_semantic_segmentation` (see [Enabling and release order](#enabling-and-release-order)). With the flag off, or with anything but a cloud record open, the "Edit spatial annotation" entry is **hidden** (not disabled) and no `AnnotationService` request is made. See [segmentation-geometry-model.md](segmentation-geometry-model.md) for the geometry model (one observation has exactly one geometry) and [segmentation-mask-render.md](segmentation-mask-render.md) for how masks are drawn on the GPU.

## Terms

| Term               | Meaning                                                                                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| segmentation       | This feature: the `segmentation/` source folder, `Segmentation*` types and components, and the `segmentation` i18n namespace.                                          |
| spatial annotation | The backend API only: `services/api/spatial-annotation`, the `AnnotationService` protocol, and the persisted `spatial://` reference URIs.                              |
| flag name          | `honeybee_semantic_segmentation`. It is already in use outside the code, so it keeps its original wording, as does the `spatial://` URI format.                        |
| host               | The objects one Workspace shares between its Image panels and sidebar (session, runtime registry, caches), created while the flag is on and provided by React context. |
| runtime            | The store and service of one recording. Panels that annotate the same recording share it.                                                                              |
| panel bridge       | What one Image panel's renderer, which lives in its own React root, exchanges with the editor.                                                                         |

## Adapter

`segmentation/liveService.ts` implements `SegmentationService` (`service.ts`); the store and the UI depend only on that interface. The entry point is `createLiveSegmentationService({ consoleApi, recordName, startNs, document })` in the same file. Its client comes from `CoSceneConsoleApi.rpcClient(AnnotationService)`, so it shares the base URL, the auth interceptors and the session with every other record RPC (signing out on the desktop app applies too). Without a `consoleApi`, or for anything but a cloud record, it returns `undefined`.

| Editor action                                                      | Calls                                                                                                                                                                                         |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start annotating (`loadDocument`)                                  | `ListClasses` + `ListInstances` (all pages); one `ListTimelineRanges` per open topic. A camera registered later reads its own timeline.                                                       |
| Read geometry (`loadFrameWindow`)                                  | `ListFrames(topic, [start, end))`. The local closed range `[startSec, endSec]` becomes `[floor_us(start), floor_us(end) + 1µs)`, split and paged when it exceeds 10 s.                        |
| "Has annotations" on frames not yet loaded, in the tree and strips | Registered frames covered by a timeline range get a `{ fromTimeline: true }` summary; the geometry replaces it once read.                                                                     |
| Create, rename or recolor a class                                  | `CreateClass(classId = UUID)` / `UpdateClass(update_mask = display_name, color)`                                                                                                              |
| Create or rename an instance, or move it to another class          | `CreateInstance(instanceId = UUID)` / `UpdateInstance(update_mask = display_name, class)`                                                                                                     |
| Draw, edit or delete geometry; delete an instance on one frame     | The **complete** `FrameSnapshot` of each changed frame, in one `SaveAnnotation`                                                                                                               |
| Delete an instance on all frames                                   | `DeleteInstance` (the server deletes its observations; the editor does not resend those frames)                                                                                               |
| Delete a class with its instances                                  | `DeleteClass(force = true)`                                                                                                                                                                   |
| Merge classes                                                      | One `UpdateInstance` per instance to move it, then `DeleteClass`                                                                                                                              |
| Merge instances                                                    | **Not supported**, rejected before any write: the API cannot list every topic of a recording, so deleting the source instance would also delete its observations on cameras that are not open |
| Propagate / stop                                                   | The `PropagateAnnotation` server stream, with `direction` FORWARD or BACKWARD; stopping cancels the RPC                                                                                       |

The order of one submission (`submit`):

1. A batch that merges instances is rejected. Frames to be sent that have not been read are first read in full with a 1 µs `ListFrames` window.
2. All `FrameSnapshot`s are computed locally, and **nothing is written until all of them pass validation** (sizes, microsecond collisions, geometry).
3. Catalog: create or update classes first, then instances.
4. One `SaveAnnotation` saves all changed frames atomically.
5. Deletions: `DeleteInstance`, then `DeleteClass`.

The adapter's cache is updated after each successful catalog request, so a retry does not create anything twice. A create that returns `ALREADY_EXISTS` (the previous response was lost) converges by updating, as the contract prescribes.

## Geometry mapping

- Polygons: the editor stores coordinates normalized to [0, 1]. They are multiplied by the topic's decoded size and clamped to `[0, width] × [0, height]` when sent. A polygon id that is not a UUID (a propagation result, for example) gets a deterministic UUID derived from record, instance and id.
- Masks: only `counts` is sent and received; width and height are bound to the topic's decoded size. Before saving, the mask is decoded at that size and the whole save is rejected if the pixel count is not width × height (the backend does not check this).
- An observation that cannot be decoded when read (a mask of the wrong size, for example) is not shown; the canvas says so and `maskSizeMismatches` counts it. The adapter keeps the original wire data and sends it back unchanged when the frame is saved, until the user replaces or clears that instance on the frame.
- `occluded`: the editor has no such field. The adapter remembers the server's value and sends it back unchanged.

## frame_time: truncation to microseconds

Implemented in `segmentation/frameTime.ts`.

- A frame is identified locally by its nanosecond `logTimeNs`. The conversion happens only at the wire: `frame_time = logTimeNs / 1000` (BigInt division, truncating), so that `nanos % 1000 == 0`. It applies to `FrameSnapshot.frame_time`, every `Frame.frame_time` and the propagation seeds.
- When reading, a `FrameTimeIndex` per topic maps `trunc_us(logTimeNs)` back to the local frame. A time that is not aligned to a microsecond is an error. An observation with no local frame is counted in `unregisteredObservations` and is never attached to the nearest frame.
- If two frames of a topic truncate to the same microsecond, both reads and writes are refused (counted in `collidingObservations` when reading) instead of picking one.
- The log times of real recordings almost always have a sub-microsecond part, so truncation is required: rounding would put about half of the frames on the wrong microsecond. Backend validation must truncate too.

## Save semantics and concurrency

- The backend keeps only the current state, without versions. Undo and redo apply only to local operations that have not been submitted; a deleted id cannot be reused, so a submitted deletion cannot be restored under the same id.
- One `SaveAnnotation` saves all of its frames atomically. Catalog requests and the frame save are independent: a failure half way does not roll back the requests that succeeded. The store marks the batch as failed, keeps the local changes, and a retry continues from the state already reached.
- The last save of a frame wins and replaces the **whole frame** (the snapshot includes other people's instances). When two people edit the same frame, the later save overwrites the earlier one; different frames do not affect each other. The catalog is overwritten field by field (`update_mask` names only the changed fields). The editor does not fetch other people's changes on its own.
- Operations that have not been submitted exist only in memory and are lost on reload.
- A snapshot contains only observations with foreground geometry. Clearing an instance leaves it out of the snapshot; clearing a whole frame sends empty `annotations`.

## Propagation

The propagation panel lists the instances that have geometry on the canvas's current frame. The instances selected in the tree are checked by default (all of them when none is selected), and only checked instances are sent as seeds. The direction is forward, backward or both. Propagating to earlier frames sends an `end_time` before the seed frame with `direction: BACKWARD`, and results arrive in reverse time order. "Both" runs towards later frames first, then towards earlier ones.

`PropagateAnnotation` is a gRPC-Web server stream: `ready` is ignored; every `frame` yields one result per selected instance (an instance the server does not return is recorded as cleared); `error` throws an `AnnotationRpcError` (with the gRPC code name and the server's message), which the UI translates by code; `done` ends normally. A stream that closes without `done` is an error, and the frames already received stay as drafts. Stopping aborts the RPC. The model list is `LIVE_PROPAGATION_MODELS` (currently only `sam2.1-motion`, the one the backend supports).

## Quick annotation

Quick annotation (a mask from clicks) calls `SegmentFrame` (cosceneapis #870). Each click encodes the displayed frame as a JPEG at the source size and sends it with every point of the object so far (source image pixels, `negative` marking background points) and the `frame_time` truncated to microseconds. The server keeps no session, so the image is uploaded every time. An unset mask in the response means the points selected no foreground: the editor keeps the previous result and says so. The result is only a draft; pressing Enter saves it through `SaveAnnotation` like any other edit. A session without a cloud record (a local file) cannot use quick annotation. See `segmentation/quickSegment.ts`.

## Generated code

The published `@coscene-io/cosceneapis-es-v2` has no `services/annotation_pb` yet, so the code is generated locally from the branch of cosceneapis #866 (with `SegmentFrame` and the propagation `direction` of #870 merged) into `packages/studio-base/src/services/api/spatial-annotation/generated/`, which ESLint and Prettier ignore. The `README.md` next to it has the generation command and the steps to switch back to the published package.

## Known limitations and open questions for the backend

- Instances cannot be merged (see the table above).
- A submission sends a single `SaveAnnotation`; the server's limits on frames or bytes are unknown.
- Timeline summaries cover only registered frames, so the tree does not show the distribution of annotations over the whole recording.
- The backend validates neither mask pixel counts nor the upper bound of polygon coordinates. The editor does both for now; the server should too.
- `ListTimelineRanges` returns one point range per observation instead of coalesced ranges, so the number of pages grows with the number of observations.
- `Mask` has no width or height. After the decoded size of a topic changes, old masks fail to decode at the new size (the editor names the size they were drawn at and keeps them unchanged).
- **Annotation is fixed to the 720p H.264 transcode.** All transcode profiles (480p, 720p, …) use the same topic (`…/h264`) at different sizes, and a mask is bound to a size, so masks drawn at 720p cannot be read at 480p. Starting to annotate on another transcode quality switches the page to 720p and says so (the user clicks "Edit" again). A record without 720p uses the closest profile (the higher one on a tie). Raw stays raw.
- **Raw and h264 are two topics with independent annotations that are never mapped onto each other.** What is annotated on raw is not visible on a transcode quality, and the reverse. This is a known limitation for now.

## Enabling and release order

- The feature is controlled by the GrowthBook flag `honeybee_semantic_segmentation`, off by default. Without a GrowthBook provider it falls back to `FEATURE_FLAG_GROWTHBOOK.honeybee_semantic_segmentation` in cos-config.
- It is available only when the flag is on **and** the open source is a cloud record (a valid record name in Core Data and the `coscene-data-platform` data source). Otherwise the Image panel is the plain panel: no editor is mounted, no mask layer is built, the renderer never connects to a bridge, there is no app bar entry and no "Space" tab, no `AnnotationService` request is made, and the editor code is not downloaded (the workspace extension and the Image panel adapter load their parts on demand).
- Release order: deploy the `AnnotationService` to the target environment first (backend #2403, currently only on dev), then turn the flag on there.
- Operations that have not been submitted exist only in memory. While there is unsaved annotation work the browser asks before leaving the page (the desktop app does not). After switching to another record, the runtime with unsaved work stays in memory; retry or discard it by returning to the original record.
