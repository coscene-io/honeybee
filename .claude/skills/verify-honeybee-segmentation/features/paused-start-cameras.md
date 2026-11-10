# Paused start shows every camera

When a record opens paused at its first instant, every compressed-video Image panel shows a picture. The recording starts a few milliseconds before each camera's first frame, so each panel shows that camera's first keyframe. Playback then runs normally from there.

## Sub-features

- `start-preview` shows a picture in all five cameras at 11:09:03.719 while paused.
- `start-play` keeps all cameras updating after Space plays from the start.
- `mid-seek` shows the known frame at 11:09:51.568 after opening there.

## How to get to it (user POV)

- Open a share link whose `time` is the recording start.
- Reload the page while the URL time is the start.

## Driving it with ego-browser

Preconditions:

- The doctor passes and the session is signed in.

- **Open at start.** Run `scripts/open-record.sh start /tmp/verify-seg/paused-start.png`. Printed `clock` is `2026-03-31 11:09:03.719 AM +08`, `searchingKeyframe` is false, and `topics` lists five `/astribot_camera/...` topics. The screenshot shows a picture in all five panels: the head camera shows a table with a blue cloth, mugs, a coffee machine, and two arms.
- **Play from start.** In the same space, press Space, wait 2500 ms, press Space, wait 2500 ms, then screenshot `/tmp/verify-seg/paused-start-played.png` and print the clock. The clock is about 11:09:06, and all five panels show later frames.
- **Open mid-record.** Run `scripts/open-record.sh mid /tmp/verify-seg/mid.png`. The head camera shows the coffee machine, two mugs, the blue cloth, and both arms.

## Gotchas

- `main` before commit 114980791 shows five black panels at the start. That is the bug this feature guards.
- Panels say `正在查找关键帧` for a few seconds after open. Wait the default 15 s before judging.
- The URL time can be rewritten to the start by the player. Check the printed clock, not the URL.
- Console warnings that a topic `不可用` before metadata arrives are transient and not a failure.
