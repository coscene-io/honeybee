# Canvas view popover

Each annotation canvas has a view-tools button at its bottom right. It opens a menu styled like the timeline ••• menu, with a zoom stepper, fit and pan rows, the mouse or trackpad profile, overlay opacity, a 键盘快捷键 entry, and the image size.

## Sub-features

- `view-zoom` steps zoom with − and + and shows `Fit · N%` when fitted.
- `view-fit` fits the canvas, fits the selection, and shows 100%.
- `view-pan` toggles the pan tool and shows its selected state.
- `view-profile` switches mouse and trackpad navigation and remembers it.
- `view-opacity` changes the fill opacity.

## How to get to it (user POV)

- In annotation mode on a compact canvas, choose the button labeled `视图工具`.

## Driving it with ego-browser

Preconditions:

- An annotation session is open on the head camera.

- **Open.** Click `[aria-label="视图工具"]`. A menu opens with rows for 适应画布, 适应选区, 实际大小, and 平移, and no 全屏 entry. Screenshot `/tmp/verify-seg/view-popover.png` and compare it against the timeline ••• menu in the same theme.
- **Zoom.** Click +. The label leaves `Fit ·` and the percentage rises. Click 适应画布. The label reads `Fit · N%` again.
- **Close.** Press Escape. The menu closes and focus returns to the canvas.

## Gotchas

- 适应选区 is disabled without a selected instance. That is expected.
- Check both dark and light themes. The earlier bug was white text on the light app bar.
