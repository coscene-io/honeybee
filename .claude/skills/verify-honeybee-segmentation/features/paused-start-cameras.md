# Native playback at recording start

The annotation layer leaves native playback unchanged. A recording may start before every camera's first frame; blank native panels at that instant are valid. Annotation must not preview a future frame, seek to one, or relabel old pixels.

## Sub-features

- `start-gate` keeps editing disabled at 11:09:03.719 until a native image has a known displayed identity.
- `start-play` keeps all cameras updating after Space plays from the start.
- `mid-seek` shows the known frame at 11:09:51.568 after opening there.

## How to get to it (user POV)

- Open a share link whose `time` is the recording start.
- Reload the page while the URL time is the start.

## Driving it with ego-browser

Preconditions:

- The doctor passes and the session is signed in.

- **Open at start.** Run `scripts/open-record.sh start /tmp/verify-seg/paused-start.png`. Printed `clock` is `2026-03-31 11:09:03.719 AM +08`, `searchingKeyframe` is false, and `topics` lists five `/astribot_camera/...` topics. The screenshot may show blank panels because no camera frame has occurred yet. Starting annotation must not change the clock.
- **Play from start.** In the same space, press Space, wait 2500 ms, press Space, wait 2500 ms, then screenshot `/tmp/verify-seg/paused-start-played.png` and print the clock. The clock is about 11:09:06, and all five panels show later frames.
- **Open mid-record.** Run `scripts/open-record.sh mid /tmp/verify-seg/mid.png`. The head camera shows the coffee machine, two mugs, the blue cloth, and both arms.

## Gotchas

- Do not reintroduce the removed future-keyframe preview or annotation entry seek; native blank panels before the first frame are intentional.
- Panels say `正在查找关键帧` for a few seconds after open. Wait the default 15 s before judging.
- The URL time can be rewritten to the start by the player. Check the printed clock, not the URL.
- Console warnings that a topic `不可用` before metadata arrives are transient and not a failure.
