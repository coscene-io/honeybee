# Enter and leave annotation

A user opens spatial annotation from the camera toolbar, sees that edits are stored only in this browser, creates classes once the current annotation frame has loaded, and leaves annotation from the camera toolbar.

## Sub-features

- `session-enter` opens the editor from `✎ 编辑空间标注`.
- `session-badge` shows `本机标注` while the annotation service is unpublished.
- `session-frame-gate` keeps `新建` disabled until the frame window loads, then enables it.
- `session-leave` closes the editor from `结束标注`.

## How to get to it (user POV)

- Choose `✎ 编辑空间标注` in the chosen camera toolbar.
- Read the hint in the left sidebar 空间 tab, which points at the same button.

## Driving it with ego-browser

Preconditions:

- The record is open at `mid` through `scripts/open-record.sh mid ...`.

- **Enter.** Click the chosen canvas button with `aria-label="编辑空间标注"`, then wait for the text `结束标注`. The editing canvas toolbar shows `本机标注`, `传播` or the per-canvas propagation entry, `提交`, and `结束标注`.
- **Frame gate.** Poll `[...document.querySelectorAll("button")].find(b => b.textContent.trim() === "新建")?.disabled` every second for up to 20 s. It turns false once the frame window loads. Screenshot `/tmp/verify-seg/session-ready.png`.
- **Create dialog.** Click `新建`. A `类别名称` field appears. Press Escape to cancel without writing anything.
- **Leave.** Click `结束标注`. All camera toolbars show their edit buttons again. The tree is labeled as the last edited camera snapshot and is read-only.

## Gotchas

- Plain `text=编辑空间标注` also matches sidebar prose. Use the button text with the pencil.
- At the record start, entry aligns the clock to the shown source frame. `新建` should enable once its annotation window loads.
- In light theme the canvas controls must be dark text. Check computed color when theme matters.
- Creating a class writes to this browser's storage for the record. Cancel with Escape unless the journey needs a class, and say so if you keep one.
