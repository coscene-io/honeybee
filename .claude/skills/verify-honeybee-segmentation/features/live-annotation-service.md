# Live AnnotationService

For a cloud record, the editor reads and saves through the published `AnnotationService` on `https://api.dev.coscene.cn` (gRPC-Web, cosceneapis #866). There is no other backend: a source without a cloud record cannot be annotated. Saves overwrite the current state of the frames they send; there is no version history.

## Sub-features

- `cloud-only`: every session uses the live service. There is no badge and no switch. A local file or a record without a cloud name shows `✎ 编辑空间标注` disabled with the title `只有云端记录支持空间标注`.
- `catalog`: classes and instances in the tree come from `ListClasses` / `ListInstances`; create, rename, recolor, move and delete call the matching CRUD RPCs on submit.
- `frames`: geometry comes from `ListFrames` in windows of at most 10 s; a save sends one `SaveAnnotation` with the complete snapshot of each changed frame. `frame_time` is the displayed frame's log time truncated to microseconds.
- `propagation`: `PropagateAnnotation` as a gRPC-Web server stream; STOP cancels the RPC.
- `instance-merge`: refused on the live service before any write.

## How to get to it (user POV)

- Open the cloud record with `scripts/open-record.sh mid`, then `✎ 编辑空间标注`.

## Driving it with ego-browser

- The localhost page needs the dev login. Reuse the signed-in session from `https://dev.coscene.cn/` in the same ego profile; never print or write tokens, cookies or storage values.
- Record RPC evidence from the page: wrap `fetch` in `page.evaluate` before entering and log only the method name, HTTP status, `grpc-status` and `grpc-message`. Never log request headers.
- Test data on dev: write only to 质检测试 CJ260330-3-R154, prefix every class and instance you create with `[honeybee-it]`, list them before deleting, and delete only those when done. Keep propagation ranges under one second.

## Gotchas

- Status on dev as of 2026-11-16 (backend data-platform-server #2403 @ `a82be170`; details in `docs/segmentation-api-integration.md`, "2026-11-16 复测"):
  - `ListFrames`, `ListTimelineRanges` and `SaveAnnotation` work; draw → submit → reload → read back passes in the real page.
  - The backend no longer validates `frame_time` against source frames or mask counts against the frame size. Assert stored values through `ListFrames`; a successful save does not prove the frame time or size is right.
  - `ListTimelineRanges` returns one point range per observation, not coalesced ranges.
  - `PropagateAnnotation` is not implemented and has no role permission: the browser sees HTTP 403. (Since fixed: propagation runs on dev with `sam2.1-motion`.)
  - No published `@coscene-io/cosceneapis-es-v2` includes the annotation service; the generated code is a local copy under `services/api/spatial-annotation/generated`.
- Unsaved drafts live in memory only; a reload drops them.
