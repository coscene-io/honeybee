# Per-canvas propagation

Propagation runs on one canvas at a time and carries every instance drawn on that canvas's current annotation frame in a single request. The entry is a 传播 button in each Image panel toolbar, left of the gear, shown only during an annotation session.

## Sub-features

- `prop-button` shows the toolbar button only during a session.
- `prop-disabled` disables it with a reason when the canvas has no drawn instance on the frame, the frame is loading, or another propagation runs.
- `prop-scope` shows the seed count `N 个实例 · M 个多边形` for that canvas.
- `prop-run` starts one request for that canvas and shows progress and 停止.
- `prop-appbar` keeps 传播 out of the app bar.

## How to get to it (user POV)

- In annotation mode, choose 传播 in the toolbar of the camera panel to propagate.

## Driving it with ego-browser

Preconditions:

- An annotation session is open on the head camera with at least one class, one instance, and one polygon on the current frame.

- **No seeds.** Before drawing, hover the head panel's 传播 button. It is disabled and its tooltip names the reason.
- **Open form.** After drawing, click 传播. A popover anchored to the button shows the seed count, a 1 秒 / 3 秒 / 10 秒 range (default 10 秒) and the model. There is no frame count. Screenshot it.
- **Run.** Click 开始传播. The popover closes; it reads the range's frame times first, so the button may show 正在读取后续帧… briefly. The lock bar 在线传播锁定 says 正在准备视频和模型 until the first result (10–20 s on the dev backend), then counts frames. The player follows the latest result at most once a second, so the clock moves and masks appear on each camera.
- **Stop.** Click `STOP · 停止传播` (or press Enter, it is focused). The run ends as 已停止 and keeps every frame received. A 3 s run (90 frames) on the dev backend usually finishes before a stop lands: results arrive in a burst after the first frame.
- **App bar.** `document.querySelector('[data-testid="segmentation-app-bar"]').innerText` has no 传播.

## Gotchas

- Propagation always goes to the live `PropagateAnnotation` (model `sam2.1-motion`).
- Drawing a polygon writes to this browser's storage for the record. Report it.
- A finished run leaves the playhead on the last propagated frame, which now carries a propagated mask: a new run from there seeds with it.
- The editor does not mount at the recording start. `open-record.sh mid` seeks by clicking the timeline, because the URL `time` parameter does not move the playhead.
