# Live AnnotationService

For a cloud record, the editor reads and saves through the published `AnnotationService` on `https://api.dev.coscene.cn` (gRPC-Web, cosceneapis #866). The app bar says which backend the session uses, and the user can switch to browser-only annotation for the next session. Saves overwrite the current state of the frames they send; there is no version history.

## Sub-features

- `backend-badge`: inside `[data-testid="segmentation-app-bar"]`, `正式服务` means the live service and `本机标注` means this browser only. A local file or a record without a cloud name is always `本机标注`.
- `backend-switch`: the `改用本机` / `改用正式服务` button stores the choice in `localStorage["coStudio.semanticSegmentation.backend"]`. It applies to the next `✎ 编辑空间标注`, not the open session.
- `catalog`: classes and instances in the tree come from `ListClasses` / `ListInstances`; create, rename, recolor, move and delete call the matching CRUD RPCs on submit.
- `frames`: geometry comes from `ListFrames` in windows of at most 10 s; a save sends one `SaveAnnotation` with the complete snapshot of each changed frame. `frame_time` is the displayed frame's log time truncated to microseconds.
- `propagation`: `PropagateAnnotation` as a gRPC-Web server stream; STOP cancels the RPC.
- `instance-merge`: refused on the live service before any write.

## How to get to it (user POV)

- Open the cloud record with `scripts/open-record.sh mid`, check the app-bar badge, then `✎ 编辑空间标注`.
- Switch backends with the app-bar button, then leave and re-enter annotation.

## Driving it with ego-browser

- The localhost page needs the dev login. Reuse the signed-in session from `https://dev.coscene.cn/` in the same ego profile; never print or write tokens, cookies or storage values.
- Record RPC evidence from the page: wrap `fetch` in `page.evaluate` before entering and log only the method name, HTTP status, `grpc-status` and `grpc-message`. Never log request headers.
- Test data on dev: write only to 质检测试 CJ260330-3-R154, prefix every class and instance you create with `[honeybee-it]`, list them before deleting, and delete only those when done. Keep propagation ranges under one second.

## Gotchas

- Status on dev as of 2026-11-14 (details and repro requests in `docs/segmentation-api-integration.md`, "后端问题清单"):
  - B1: `ListFrames`, `ListTimelineRanges` and `SaveAnnotation` with frames return `FAILED_PRECONDITION: Source media metadata is not configured for annotation` for every topic. The backend has no source-media adapter yet, so the editor cannot load frame geometry and stays non-editable in `正式服务` mode. Class and instance CRUD work.
  - B2: `PropagateAnnotation` over gRPC-Web returns HTTP 403 with no grpc-status; the server method is also unimplemented.
  - B3: no published `@coscene-io/cosceneapis-es-v2` includes the annotation service; the generated code is a local copy under `services/api/spatial-annotation/generated`.
  - B4: open contract questions (log-time truncation, mask size source, save size limit, multi-topic timeline, reusing deleted IDs).
- Until B1 is fixed, verify drawing, saving and propagation in `本机标注` mode and report the live path as blocked, not as passed.
- Unsaved drafts in `正式服务` mode live in memory only; a reload drops them.
