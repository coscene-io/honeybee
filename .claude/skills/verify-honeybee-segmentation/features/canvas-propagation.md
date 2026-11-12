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
- **Open form.** After drawing, click 传播. A popover anchored to the button shows the seed count and the direction and frame fields. Screenshot it.
- **Run and stop.** Start 在线传播. A lock dialog, 在线传播锁定, covers the page and focuses `STOP · 停止传播`. Press Enter, or click that button. The popover then reads `cancelled`. The popover's own 停止 sits under the lock and does not receive the click. Other canvases' 传播 buttons stay disabled while it runs.
- **App bar.** `document.querySelector('[data-testid="segmentation-app-bar"]').innerText` has no 传播.

## Gotchas

- The annotation service is unpublished. In `本机标注` mode the browser store answers propagation, not the live API. Do not report it as an API test.
- Drawing a polygon writes to this browser's storage for the record. Report it.
- The forward range stays `后 0 帧` until a bounded read of the frames after the playhead returns. Wait for `后 N 帧`, then assert. Backward stays unavailable.
- A finished run leaves the playhead on the last propagated frame. That frame has no seed. Seek back to the drawn frame before starting again.
- The editor does not mount at the recording start. `open-record.sh mid` seeks by clicking the timeline, because the URL `time` parameter does not move the playhead.
