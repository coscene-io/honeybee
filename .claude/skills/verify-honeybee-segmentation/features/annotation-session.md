# Enter and leave annotation

A user opens spatial annotation from the global app bar, sees that edits are stored only in this browser, creates classes once the current annotation frame has loaded, and leaves annotation from the global app bar.

## Sub-features

- `session-enter` opens the editor from `✎ 编辑空间标注`.
- `session-badge` shows `本机标注` while the annotation service is unpublished.
- `session-frame-gate` keeps `新建` disabled until the frame window loads, then enables it.
- `session-leave` closes the editor from `结束标注`.

## How to get to it (user POV)

- Choose `✎ 编辑空间标注` in the global app bar.
- Read the hint in the left sidebar 空间 tab, which points at the same button.

## Driving it with ego-browser

Preconditions:

- The record is open at `mid` through `scripts/open-record.sh mid ...`.

- **Enter.** Click `✎ 编辑空间标注` inside `[data-testid="segmentation-app-bar"]`. The clock must stay unchanged. Global undo/redo, submit and end controls appear; propagation remains on each camera. All camera overlays join the session.
- **Frame gate.** Poll `[...document.querySelectorAll("button")].find(b => b.textContent.trim() === "新建")?.disabled` every second for up to 20 s. It turns false once the frame window loads. Screenshot `/tmp/verify-seg/session-ready.png`.
- **Create dialog.** Click `新建`. A `类别名称` field appears. Press Escape to cancel without writing anything.
- **Leave.** Click `结束标注`. The global app bar shows its edit button again. The read-only tree and polygon previews continue following every camera's currently displayed frame; seeking away and back hides and restores the matching polygons.

## Gotchas

- Plain `text=编辑空间标注` also matches sidebar prose. Use the button text with the pencil.
- Before the first native image, editing stays unavailable. Entry must never seek or pause playback. Dragging, pausing and explicit timeline controls retain native behavior.
- In light theme the global controls must be dark text. Check computed color when theme matters.
- Creating a class writes to this browser's storage for the record. Cancel with Escape unless the journey needs a class, and say so if you keep one.

- Verify two cameras with different `data-log-time-ns`: polygons belong to each camera's displayed log time. During pending decode or playback, editing is disabled. Test native wheel zoom and blank-canvas drag; the transparent polygon overlay must follow the native image. Non-affine calibration shows an explicit unavailable message.
