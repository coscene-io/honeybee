# Live AnnotationService

For a cloud record, the editor reads and saves through the published `AnnotationService` on `https://api.dev.coscene.cn` (gRPC-Web, cosceneapis #866). There is no other backend: a source without a cloud record cannot be annotated. Saves overwrite the current state of the frames they send; there is no version history.

## Sub-features

- `cloud-only`: every session uses the live service. There is no badge and no switch. A local file or a record without a cloud name shows `✎ 编辑空间标注` disabled with the title `只有云端记录支持空间标注`.
- `catalog`: classes and instances in the tree come from `ListClasses` / `ListInstances`; create, rename, recolor, move and delete call the matching CRUD RPCs on submit.
- `frames`: geometry comes from `ListFrames` in windows of at most 10 s; a save sends one `SaveAnnotation` with the complete snapshot of each changed frame. `frame_time` is the displayed frame's log time truncated to microseconds.
- `propagation`: `PropagateAnnotation` as a gRPC-Web server stream with `direction` FORWARD or BACKWARD; STOP cancels the RPC.
- `quick-annotation`: each click sends `SegmentFrame` with the displayed frame as JPEG and every point so far; the result is a draft mask, saved only on 提交.
- `instance-merge`: refused on the live service before any write.

## How to get to it (user POV)

- Open the cloud record with `scripts/open-record.sh mid`, then `✎ 编辑空间标注`.

## Driving it with ego-browser

- The localhost page needs the dev login. Reuse the signed-in session from `https://dev.coscene.cn/` in the same ego profile; never print or write tokens, cookies or storage values.
- Record RPC evidence from the page: wrap `fetch` in `page.evaluate` before entering and log only the method name, HTTP status, `grpc-status` and `grpc-message`. Never log request headers.
- Test data on dev: write only to 质检测试 CJ260330-3-R154, prefix every class and instance you create with `[honeybee-it]`, list them before deleting, and delete only those when done. Keep propagation ranges under one second.

## Gotchas

- The backend does not validate `frame_time` against source frames or mask counts against the frame size. A successful save does not prove either is right; prove it by reading back (reload the page, enter annotation, jump to the frame with the tree's camera strip).
- `ListTimelineRanges` returns one point range per observation, not coalesced ranges.
- Propagation on dev accepts only `sam2.1-motion`.
- Unsaved drafts live in memory only; a reload drops them. Leaving and re-entering annotation can reuse the in-memory session, so it is not a read-back.
- `page.mouse` drags on the annotation canvas can lose pointer capture mid-gesture (the page briefly reports itself hidden and the canvas resets the gesture). Drive brush strokes and vertex drags with `page.cdp("Input.dispatchMouseEvent", …)` (`mousePressed`, several `mouseMoved` with `buttons: 1`, `mouseReleased`).
- Renaming an instance opens a dialog. Wait for its input and use `page.fill`; raw `keyboard.type` into the page fires global shortcuts (sidebars, playback, speed).
