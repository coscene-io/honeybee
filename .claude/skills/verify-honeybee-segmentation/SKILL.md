---
name: verify-honeybee-segmentation
description: Drive the real coScene Studio web app (honeybee) in a browser to prove semantic-segmentation editor and compressed-video playback behavior. Use when a change touches the Image panel, video decoding, the segmentation editor, its app-bar controls, shortcuts, or propagation, and you need live evidence instead of unit tests.
---

# Verify honeybee segmentation in the live web app

The surface is the Studio web app served by rspack at `http://localhost:8081/`, driven through `ego-browser`. Proof is a screenshot you read back with the Read tool, plus DOM facts from `page.evaluate`. Unit tests are not proof for this skill.

Paths below are relative to the worktree root (the directory that holds this `.claude/`). Helpers live in `scripts/` next to this file and are executable.

## Launch

One dev server per machine port. Never start a second one on 8081, and never drive a server that serves a different worktree.

1. Run the doctor first. If it passes, skip to Drive.
2. Otherwise start the server in an Orca terminal (or a background shell you own) from the worktree root:

   ```bash
   yarn web:serve --port 8081
   ```

   Record the PID that owns the port (`lsof -nP -iTCP:8081 -sTCP:LISTEN`). You own it and you stop it in Cleanup.

3. Ready means rspack printed `compiled successfully` and `[type-check] no errors found`, and the doctor passes. A first build takes about a minute. HMR rebuilds take about 10 seconds after an edit.

Auth. The cloud record needs a signed-in coScene dev session in the ego-browser profile. Sign-in from a root-mounted localhost redirects to `https://dev.coscene.cn` and does not come back. If the page shows a sign-in prompt, stop and ask the user to sign in in the ego-browser window. Never print tokens, cookies, or storage values.

## Doctor

```bash
.claude/skills/verify-honeybee-segmentation/scripts/doctor.sh
```

It is read-only. It checks that something listens on 8081, that the listener's working directory is this worktree, that `/` returns HTTP 200, and prints the branch and HEAD. A mismatch exits non-zero with the reason. Do not drive a server that fails the worktree check, because your edits are not in it.

## Drive

All browser work goes through `ego-browser nodejs` with one task space per goal, named `verify honeybee segmentation`. `taskSpace(name)` resumes it across calls. It is not Playwright. Use `page.goto`, `page.evaluate`, `page.waitForFunction(fn, undefined, { timeout })`, `page.click`, `page.keyboard.press`, `page.setInputFiles`, and `page.screenshot({ path })`.

Open the cloud record at a given time and capture the camera state:

```bash
.claude/skills/verify-honeybee-segmentation/scripts/open-record.sh start /tmp/verify-seg/start.png
.claude/skills/verify-honeybee-segmentation/scripts/open-record.sh mid /tmp/verify-seg/mid.png
```

`start` is `2026-03-31T03:09:03.719Z`, the first instant of the recording, before any camera frame. `mid` is `2026-03-31T03:09:51.568Z`, a known good frame with the coffee machine, two mugs, a blue cloth, and both arms. The script prints the clock text, whether `正在查找关键帧` is showing, the image-panel topics, and writes the screenshot. Read the PNG before you claim anything about pixels.

The record is 质检测试 CJ260330-3-R154. The layout is the recommended `manipulation_execution_review / viewer` with five 30 Hz H.264 cameras under `/astribot_camera/*/color_compress/compressed/h264`. It needs `FEATURE_FLAG_GROWTHBOOK.honeybee_recommended_layouts = true` in `packages/studio-web/public/cos-config.js`. That edit is a local test aid and is never committed. Without it the app falls back to the last personal layout from IndexedDB.

Stable handles:

- Playback clock: `input[aria-label="当前播放时间"], input[title="当前播放时间"]`. Its value looks like `2026-03-31 11:09:03.719 AM +08`. Typing into it fails validation because the zone is `+08`. Seek by clicking the timeline track instead.
- Play and pause: `page.keyboard.press("Space")` with focus outside an input.
- Enter annotation: app-bar button text `✎ 编辑空间标注`. Plain `编辑空间标注` also matches sidebar prose.
- Leave annotation: app-bar button `结束标注`.
- Storage badge: app-bar text `本机标注` means the annotation service is unpublished and edits stay in this browser.
- Hidden file input for local files: `input[data-puppeteer-file-upload]`.

Feature recipes are in [`features/README.md`](features/README.md). Read the index, then the matching file.

## Evidence

Write every artifact under `/tmp/verify-seg/` with a name that says the feature and step, for example `/tmp/verify-seg/paused-start-before-play.png`.

- Capture the action and the result. For playback, screenshot paused at the target, then after playing, then after pausing again.
- Read each screenshot with the Read tool and describe what it shows. A screenshot you did not read is not evidence.
- Pair each screenshot with the DOM facts the script printed: clock value, enabled state of the buttons involved, alert text.
- Drive the user path. Click the real buttons and press the real keys. Do not call store setters or React internals to reach a state, except the one documented file-input workaround in the local MCAP recipe.
- Name what you did not verify. A camera you did not look at, a theme you did not switch to, a platform you did not run on.

## Cleanup

- Stop only what you started. If you launched the dev server, stop that PID. Never `pkill node` or kill by name. Leave a server someone else started running.
- Close the task space with `await (await taskSpace("verify honeybee segmentation")).finish({ keep: false })` when the goal is done.
- Revert local probes. `git status --short` must show only the intended diff plus the two local test aids (`packages/studio-web/public/cos-config.js`, `packages/studio-web/src/WebRoot.tsx`). Never stage those two.
- Keep `/tmp/verify-seg/`. Cleanup never removes evidence.

## Side effects to report

- Creating a layout from the empty-layout dialog writes a personal layout to the signed-in dev account. Prefer the recommended layout URL so you do not create one.
- Annotations made in `本机标注` mode persist in this browser's storage for the open recording.
