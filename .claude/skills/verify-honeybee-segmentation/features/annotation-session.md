# Enter and leave annotation

A user opens spatial annotation from the app bar, sees that edits are stored only in this browser, creates classes once the current annotation frame has loaded, and leaves annotation from the app bar.

## Sub-features

- `session-enter` opens the editor from `✎ 编辑空间标注`.
- `session-badge` shows `本机标注` while the annotation service is unpublished.
- `session-frame-gate` keeps `新建` disabled until the frame window loads, then enables it.
- `session-leave` closes the editor from `结束标注`.

## How to get to it (user POV)

- Choose `✎ 编辑空间标注` in the app bar.
- Read the hint in the left sidebar 空间 tab, which points at the same button.

## Driving it with ego-browser

Preconditions:

- The record is open at `mid` through `scripts/open-record.sh mid ...`.

- **Enter.** Run `await page.click("text=✎ 编辑空间标注")`, then wait for the text `结束标注`. The app bar shows `本机标注`, `传播` or the per-canvas propagation entry, `提交`, and `结束标注`.
- **Frame gate.** Poll `[...document.querySelectorAll("button")].find(b => b.textContent.trim() === "新建")?.disabled` every second for up to 20 s. It turns false once the frame window loads. Screenshot `/tmp/verify-seg/session-ready.png`.
- **Create dialog.** Click `新建`. A `类别名称` field appears. Press Escape to cancel without writing anything.
- **Leave.** Click `结束标注`. The app bar shows `✎ 编辑空间标注` again.

## Gotchas

- Plain `text=编辑空间标注` also matches sidebar prose. Use the button text with the pencil.
- At the record start `新建` stays disabled until playback decodes a frame and the window loads. Disabled there is expected, not a regression.
- In light theme the app-bar controls must be dark text. Check computed color when theme matters.
- Creating a class writes to this browser's storage for the record. Cancel with Escape unless the journey needs a class, and say so if you keep one.
