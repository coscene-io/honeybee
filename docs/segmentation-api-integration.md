# The segmentation editor and the AnnotationService

The editor reads and writes annotations for eligible cloud recordings through the live `AnnotationService` (cosceneapis #866, gRPC-Web). The **Edit spatial annotation** entry and annotation requests require an eligible recording and an effective rollout flag. See [Enabling and release order](#enabling-and-release-order), [the geometry model](segmentation-geometry-model.md), and [GPU mask rendering](segmentation-mask-render.md).

## Terms

| Term               | Meaning                                                                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| segmentation       | This feature: the `segmentation/` source folder, `Segmentation*` types and components, and the `segmentation` i18n namespace.                   |
| spatial annotation | The backend API only: `services/api/spatial-annotation`, the `AnnotationService` protocol, and the persisted `spatial://` reference URIs.       |
| flag name          | `honeybee_semantic_segmentation`. It is already in use outside the code, so it keeps its original wording, as does the `spatial://` URI format. |
| host               | The session, runtime registry, and caches that one workspace provides to its Image panels and sidebar through React context.                    |
| runtime            | The store and service of one recording. Panels that annotate the same recording share it.                                                       |
| panel bridge       | What one Image panel's renderer, which lives in its own React root, exchanges with the editor.                                                  |

## Adapter

`segmentation/liveService.ts` implements `SegmentationService` (`service.ts`); the store and the UI depend only on that interface. The entry point is `createLiveSegmentationService({ consoleApi, recordName, startNs, document })` in the same file. Its client comes from `CoSceneConsoleApi.rpcClient(AnnotationService)`, so it shares the base URL, the auth interceptors and the session with every other record RPC (signing out on the desktop app applies too). Without a `consoleApi`, or for anything but a cloud record, it returns `undefined`.

| Editor action                                                      | Calls                                                                                                                                                                                         |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start annotating (`loadDocument`)                                  | Paginated `ListClasses` and `ListInstances`, followed by a paginated `ListTimelineRanges` listing per open topic. A camera registered later reads its own timeline.                           |
| Read geometry (`loadFrameWindow`)                                  | `ListFrames(topic, [start, end))`. The local closed range `[startSec, endSec]` becomes `[floor_us(start), floor_us(end) + 1µs)`, split and paged when it exceeds 10 s.                        |
| "Has annotations" on frames not yet loaded, in the tree and strips | Registered frames covered by a timeline range get a `{ fromTimeline: true }` summary; the geometry replaces it once read.                                                                     |
| Create, rename or recolor a class                                  | `CreateClass(classId = UUID)` / `UpdateClass(update_mask = display_name, color)`                                                                                                              |
| Create or rename an instance, or move it to another class          | `CreateInstance(instanceId = UUID)` / `UpdateInstance(update_mask = display_name, class)`                                                                                                     |
| Draw, edit or delete geometry; delete an instance on one frame     | The **complete** `FrameSnapshot` of each changed frame, in one `SaveAnnotation`                                                                                                               |
| Delete an instance on all frames                                   | `DeleteInstance` (the server deletes its observations; the editor does not resend those frames)                                                                                               |
| Delete a class with its instances                                  | `DeleteClass(force = true)`                                                                                                                                                                   |
| Move a class's instances to another class                          | One `UpdateInstance` per moved instance. The source class remains.                                                                                                                            |
| Merge instances                                                    | **Not supported**, rejected before any write: the API cannot list every topic of a recording, so deleting the source instance would also delete its observations on cameras that are not open |
| Propagate / stop                                                   | The `PropagateAnnotation` server stream, with `direction` FORWARD or BACKWARD; stopping cancels the RPC                                                                                       |

The order of one submission (`submit`):

1. The adapter rejects batches that merge instances. It groups changed, unloaded frames by camera and reads them with paginated `ListFrames` windows of at most 10 seconds. Each window starts at the first target frame and ends 1 µs after the last target. A single target uses a 1 µs window.
2. All `FrameSnapshot`s are computed locally, and **nothing is written until all of them pass validation** (sizes, microsecond collisions, geometry).
3. Catalog: create or update classes first, then instances.
4. If any frame snapshots were prepared, one `SaveAnnotation` saves them atomically. Catalog-only submissions skip this step.
5. Deletions: `DeleteInstance`, then `DeleteClass`.

The adapter's cache is updated after each successful catalog request, so a retry does not create anything twice. A create that returns `ALREADY_EXISTS` (the previous response was lost) converges by updating, as the contract prescribes.

When the store evicts distant frames, `releaseFrames` also drops their loaded markers, geometry, unreadable wire observations, and `occluded` values from the adapter. Ordinary eviction keeps annotation summaries and protects frames with staged edits or pending submissions, including failed batches awaiting retry. If a later submission needs an evicted frame, the adapter reads it again before building the whole-frame snapshot.

The source frame loader registers camera timestamps from the recording. The frame strip loads up to 20 neighbours on either side of the displayed frame, reading across windows as needed. Stepping through a camera also reads contiguous windows until it finds the requested frames or reaches the recording boundary. If the player seeks while a step waits for a window, the editor drops the pending step. When several Image panels register a loader for the same video, the latest registration handles reads. Removing that panel restores the previous loader.

## Geometry mapping

- The adapter reads polygon coordinates by dividing them by the topic's decoded dimensions. Server coordinates outside the image can produce values outside `[0, 1]` in the editor document. On write, the adapter scales and clamps them to `[0, width] × [0, height]` before validation. This can change an existing polygon on a whole-frame save. A polygon ID in another format gets a deterministic UUID derived from the record, instance, and ID.
- Masks: only `counts` is sent and received; width and height are bound to the topic's decoded size. Before saving, the mask is decoded at that size and the whole save is rejected if the pixel count is not width × height (the backend does not check this).
- The canvas reports unreadable observations. The adapter counts failed mask decodes in `maskSizeMismatches` and keeps unreadable observations as received. It sends them back unchanged on save until the user replaces or clears the instance on that frame.
- The editor keeps the server's `occluded` value for existing observations and sends it back on save. New observations default to `false`. After a successful frame save, the adapter drops values for observations absent from the confirmed snapshot.
- When a registered camera's decoded dimensions change, the runtime invalidates loaded geometry and summaries for that camera and reclassifies observations when it reads those frames again. The current frame stays selected. The store reloads its window if the current frame needs geometry and propagation is neither running nor stopping.

## frame_time: truncation to microseconds

Implemented in `segmentation/frameTime.ts`.

- A frame is identified locally by its nanosecond `logTimeNs`. The conversion happens only at the wire: `frame_time = logTimeNs / 1000` (BigInt division, truncating), so that `nanos % 1000 == 0`. It applies to `FrameSnapshot.frame_time`, every `Frame.frame_time` and the propagation seeds.
- A `FrameTimeIndex` per topic maps `trunc_us(logTimeNs)` back to the local frame. During frame reads and propagation, the adapter skips observations or frame events whose timestamps are off the microsecond boundary and increments `misalignedTimes` for each skip. It counts observations with no matching local frame in `unregisteredObservations`.
- If two frames of a topic truncate to the same microsecond, both reads and writes are refused (counted in `collidingObservations` when reading) instead of picking one.
- The log times of real recordings almost always have a sub-microsecond part, so truncation is required: rounding would put about half of the frames on the wrong microsecond. Backend validation must truncate too.

## Save semantics and concurrency

- The backend keeps only the current state, without versions. Undo and redo apply only to local operations that have not been submitted; a deleted id cannot be reused, so a submitted deletion cannot be restored under the same id.
- One `SaveAnnotation` saves all of its frames atomically. If a later request fails, any successful catalog requests or frame save still apply. The store keeps the failed batch for retry. Discarding a failed batch first reloads the server catalog and current frame window so that any writes that succeeded remain visible.
- The last save of a frame wins and replaces the **whole frame** (the snapshot includes other people's instances). When two people edit the same frame, the later save overwrites the earlier one; different frames do not affect each other. The catalog is overwritten field by field (`update_mask` names only the changed fields). The editor does not fetch other people's changes on its own.
- Operations that have not been submitted exist only in memory and are lost on reload.
- A snapshot includes editor observations with foreground geometry and preserves any unreadable observations that the user has yet to replace or clear, including empty masks and observations with no geometry. The adapter sends empty `annotations` once the frame has neither foreground geometry nor preserved observations.

## Propagation

The propagation panel lists the instances that have geometry on the canvas's current frame. The instances selected in the tree are checked by default (all of them when none is selected), and only checked instances are sent as seeds. The editor reads source frame timestamps in the requested range before starting propagation. Closing the form during preparation or ending the session cancels the pending start.

The direction is forward, backward or both. Propagating to earlier frames sends an `end_time` before the seed frame with `direction: BACKWARD`, and results arrive in reverse time order. When both sides have target frames, **Both** starts the backward run only after the forward run completes successfully. If just one side has target frames, the editor runs that side.

`PropagateAnnotation` is a gRPC-Web server stream. The adapter ignores `ready`. For a `frame` event that resolves to a local frame, the adapter handles each selected instance as follows.

- Decodable geometry replaces that instance's observation on the frame.
- An omitted instance or a response with no foreground clears the instance on the frame.
- If a mask cannot be decoded at the source size, the adapter skips that instance and preserves its existing geometry.

`done` completes the run unless any mask failed to decode. In that case the adapter throws `errorPropagationMaskSizeMismatch`. An `error` event throws an `AnnotationRpcError` with the gRPC code name and server message. The UI translates the error by code. A stream that closes before `done` also fails. Results already staged stay in the queue. Stopping aborts the RPC. `LIVE_PROPAGATION_MODELS` lists `sam2.1-motion`, the model the backend supports.

The workflow panel belongs to the edit session. If the focused Image panel closes and another takes over, that panel keeps the same workflow state. Ending the session closes the workflow panel.

## Quick annotation

Quick annotation calls `SegmentFrame` (cosceneapis #870) to create a mask from clicks. The editor uses the decoded frame shown by the paused Image panel. After a seek, the previous image cannot be captured, even if the user has yet to make their first capture. Each click sends the displayed frame as a source-size JPEG, all points selected so far, and the `frame_time` truncated to microseconds. Points use source image pixels, with `negative` marking background points. The server keeps no session, so each request uploads the image. When the response has no mask, the editor reports that the points selected no foreground and keeps the previous result. Enter adds the mask to the local staging queue. Submitting the queue persists the mask through `SaveAnnotation`. Quick annotation is available for cloud recordings. See `segmentation/quickSegment.ts`.

## Generated code

The published `@coscene-io/cosceneapis-es-v2` has no `services/annotation_pb` yet, so the code is generated locally from the branch of cosceneapis #866 (with `SegmentFrame` and the propagation `direction` of #870 merged) into `packages/studio-base/src/services/api/spatial-annotation/generated/`, which ESLint and Prettier ignore. The `README.md` next to it has the generation command and the steps to switch back to the published package.

## Known limitations and open questions for the backend

- Instances cannot be merged (see the table above).
- A submission with changed frame snapshots sends them in one `SaveAnnotation`. The server's limits on frames or bytes are unknown.
- Timeline summaries cover only registered frames, so the tree does not show the distribution of annotations over the whole recording.
- The backend validates neither mask pixel counts nor the upper bound of polygon coordinates. The editor does both for now; the server should too.
- `ListTimelineRanges` returns one point range per observation instead of coalesced ranges, so the number of pages grows with the number of observations.
- `Mask` carries counts without dimensions. A change in total pixel count makes existing masks unreadable. The editor preserves the original wire data and reports the likely original dimensions when it can infer them. If the new dimensions have the same pixel count, such as 640×480 and 480×640, the adapter interprets the counts using the new shape and records no size mismatch.
- H.264 transcode profiles use the same topic (`…/h264`) at different sizes. A 720p mask cannot be read at 480p. With a valid shard manifest that lists video profiles, starting annotation switches to 720p or the closest available profile (the higher one on a tie). The page reports the switch, and the user clicks **Edit** again. Raw stays raw. Annotation starts at the current quality if the manifest is missing or unreadable, the profile list is invalid, or there are no video profiles. Sessions that fall back to different decoded sizes may produce masks that the other session cannot read. If the player or source changes during the manifest check, the old result is discarded before it can enter annotation or switch quality.
- **Raw and h264 are two topics with independent annotations that are never mapped onto each other.** What is annotated on raw is not visible on a transcode quality, and the reverse. This is a known limitation for now.

## Enabling and release order

- The feature is controlled by the GrowthBook flag `honeybee_semantic_segmentation`, off by default. Without a GrowthBook provider it falls back to `FEATURE_FLAG_GROWTHBOOK.honeybee_semantic_segmentation` in cos-config.
- The workspace lazily loads the segmentation host and slots when the flag is on, including for local sources. The Image panel adapter, annotation controls, and `AnnotationService` requests also require an eligible cloud recording. The data source must be `coscene-data-platform` and Core Data must hold a valid record name. During a switch to a different cloud recording, the editor waits until Core Data matches the requested record. An eligible panel shows the regular Image panel while the host or adapter loads. If the adapter import fails, the panel reports the error and keeps the regular Image view.
- If GrowthBook turns the flag off while the host holds unsaved work, the editor and the browser's leave-page guard stay active. The flag change takes effect after the work is saved or discarded and any running propagation has ended.
- Release order: deploy the `AnnotationService` to the target environment first (backend #2403, currently only on dev), then turn the flag on there.
- Operations that have not been submitted exist only in memory. While there is unsaved annotation work the browser asks before leaving the page (the desktop app does not). After switching to another record, the runtime with unsaved work stays in memory; retry or discard it by returning to the original record.
