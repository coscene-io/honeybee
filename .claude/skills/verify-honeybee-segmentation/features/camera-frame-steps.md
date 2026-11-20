# Per-camera frame strip and stepping

During an annotation session, each polygon row in the tree shows a strip of that camera's source frames: 20 before and 20 after the displayed frame. Each cell shows whether the instance is annotated on that frame, and clicking a cell moves the global clock to that frame's exact log time. The timeline's previous and next buttons and the arrow keys step the camera that receives edits by one real source frame, not by a fixed time step.

## Sub-features

- `strip-cells` renders 41 cells per camera row: `annotated`, `empty`, `unloaded` (the frame window is not read yet, so the cell is disabled), or `outside` (beyond the recording).
- `strip-seek` seeks the clock to the exact `data-log-time-ns` of the clicked cell.
- `step-target` steps the camera receiving edits. On entry this is the largest canvas. Drawing on a canvas, clicking it, or selecting its polygon in the tree changes the target.
- `step-labels` changes the timeline buttons to `上一帧（<camera>）` and `下一帧（<camera>）` during a session. After `结束标注` they read `后退` and `前进` again.
- `step-modifiers`: ArrowLeft and ArrowRight move one frame. Shift moves ten frames. Alt keeps the native fixed step (+/-100 ms).

## How to get to it (user POV)

- Enter annotation with `✎ 编辑空间标注`, draw a polygon, then look under its camera row in the tree.
- Use the timeline previous and next buttons, or the arrow keys, while the session is open.

## Driving it with ego-browser

Preconditions:

- The record is open at `mid`, a session is open, and one polygon is drawn on head_rgbd.

- **Strip.** The polygon's camera row has `[role=group][aria-label="head_rgbd 前后 20 帧"]` with 41 buttons. The centre cell has `data-state="annotated"`.
- **Step.** Press ArrowRight. Read `[data-testid="segmentation-native-overlay"]` for `head_rgbd`. Its `data-log-time-ns` must equal the next head row in `/tmp/camera-five-timestamps.json`, and `sourceReady` must become `true` within about 1 s. The annotated cell then sits at -1.
- **Retarget.** Draw on head_stereo. The labels change to `（head_stereo）`, and the next step moves the stereo stamp.
- **Shift and Alt.** Shift+ArrowRight moves exactly ten source frames. Alt+ArrowRight moves the clock by 100 ms, and all five overlays are ready again afterwards.
- **Cell seek.** Click the annotated cell (aria `head_rgbd -1 帧：有标注`). The head stamp equals that cell's `data-log-time-ns`, and the polygon shows again.
- **Leave.** Click `结束标注`. The buttons read `后退` and `前进`, and ArrowRight moves the clock by 100 ms.

## Gotchas

- Frame loaders exist only during an open session. In the read-only tree, neighbours show as `unloaded`, and the strip is hidden unless the displayed frame is annotated.
- HMR closes the session and drops unsubmitted drafts. Re-enter and redraw after a code change.
- Steps are blocked while drawing or while propagation runs.
- Move the mouse away before clicking tree buttons. Hover tooltips can intercept the click.
