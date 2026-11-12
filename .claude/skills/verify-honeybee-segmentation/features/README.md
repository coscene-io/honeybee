# Segmentation editor verification map

This directory is the maintained source for verifying the user-facing behavior of the semantic-segmentation editor and the compressed-video Image panel in the honeybee web app. Read this index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- The doctor passes: `.claude/skills/verify-honeybee-segmentation/scripts/doctor.sh`.
- The ego-browser profile is signed in to coScene dev. The cloud record shows the title 质检测试 CJ260330-3-R154.
- `packages/studio-web/public/cos-config.js` enables `honeybee_recommended_layouts`. The recommended viewer layout with five cameras loads.
- Evidence goes under `/tmp/verify-seg/`.

## Driving conventions

- Use one ego-browser task space named `verify honeybee segmentation` and its page `p1`.
- Open the record with `scripts/open-record.sh` instead of typing into the clock box. The clock rejects the `+08` zone.
- Prefer visible text and ARIA labels: `✎ 编辑空间标注`, `结束标注`, `当前播放时间`, `键盘快捷键`.
- Press keys through `page.keyboard.press` with focus where a user would have it. Click the canvas first for canvas shortcuts.
- Plan several actions in one script call, then observe once.

## Proof and skip reporting

- Pair every screenshot with the DOM facts printed in the same call.
- Read every screenshot with the Read tool before describing it.
- Record the feature ID and the entry point used with each artifact.
- Report an unreachable path with the attempted step and the unmet precondition. Do not report a skipped entry point as verified through another one.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph of user-visible behavior. It then has four H2 sections in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with ego-browser`, and `Gotchas`.

## Features

- [Paused start shows every camera](./paused-start-cameras.md) covers opening a record paused at its first instant, playing, and pausing.
- [Enter and leave annotation](./annotation-session.md) covers the app-bar entry, the browser-only badge, frame-gated tree actions, and leaving.
- [Open a local MCAP](./local-mcap.md) covers loading a recording file from disk in the web build.
- [Keyboard shortcuts panel](./keyboard-shortcuts.md) covers the Studio shortcuts dialog and its spatial-annotation column.
- [Canvas view popover](./canvas-view-popover.md) covers zoom, fit, pan, opacity, and the navigation profile on one canvas.
- [Per-canvas propagation](./canvas-propagation.md) covers propagating every instance on one canvas from its panel toolbar.
