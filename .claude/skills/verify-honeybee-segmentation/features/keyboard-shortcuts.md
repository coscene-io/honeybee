# Keyboard shortcuts panel

Studio has one 键盘快捷键 dialog. While an annotation session is open it shows a second column, 空间标注, listing the canvas shortcuts with the right modifier names for the platform. The canvas `?` key and the canvas menus open the same dialog.

## Sub-features

- `shortcuts-timeline` opens the dialog from the timeline ••• menu.
- `shortcuts-canvas-key` opens it with `?` on a focused canvas.
- `shortcuts-column` shows the 空间标注 column only during a session.
- `shortcuts-platform` shows ⌘ and Option on Mac and Ctrl and Alt elsewhere.
- `shortcuts-work` makes F, Shift + F, and 0 fit, fit selection, and show 100% on the focused canvas.

## How to get to it (user POV)

- Timeline ••• menu, then `键盘快捷键`.
- Press `?` after clicking a canvas in annotation mode.
- Canvas view popover, then `键盘快捷键`.

## Driving it with ego-browser

Preconditions:

- The record is open at `mid`. For the column, an annotation session is open.

- **Timeline entry.** Click the button labeled `更多时间轴工具` or the ••• title, then `键盘快捷键`. A dialog titled `键盘快捷键` lists 播放, 一刻, and 时间轴. Screenshot it.
- **Session column.** Enter annotation, click the head canvas, press `?`. The same dialog opens with a 空间标注 column. Exactly one dialog is in the DOM: `document.querySelectorAll('[role=dialog]').length` counts one.
- **Keys work.** Close the dialog, click the canvas, press `0`, read the zoom label, press `f`, read it again. The label changes to the 100% value, then back to `Fit · N%`.

## Gotchas

- This machine is a Mac. Non-Mac chips are proved by unit tests that set the user agent, not by this run. Say so.
- `?` needs Shift on most layouts. Use `page.keyboard.press("?")`.
- The old `标注操作` dialog must not appear anywhere.
