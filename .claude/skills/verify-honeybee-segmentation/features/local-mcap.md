# Open a local MCAP

A user drops a `.mcap` file onto the web app, and Studio plays it with an Image panel bound to a compressed-video topic.

## Sub-features

- `mcap-open` loads the file and shows its name in the app bar.
- `mcap-image` shows the head camera in an Image panel at about 10 Hz.

## How to get to it (user POV)

- Drag a `.mcap` file onto the window. The web build has no open-file button.

## Driving it with ego-browser

Preconditions:

- `packages/studio-web/src/WebRoot.tsx` registers `McapLocalDataSourceFactory`. That is a local test aid. Without it the drop is ignored silently.
- Test file: `/Volumes/Users/kylefang/orca/workspaces/bombus/语义分割/temp/astribot-s1/astribot-480p10.mcap`. Read it only. Never edit that tree.

- **Attach file.** Go to `http://localhost:8081/`, wait for `input[data-puppeteer-file-upload]`, then `await page.setInputFiles("input[data-puppeteer-file-upload]", [path])`.
- **Fire the handler.** ego-browser does not trigger React's change handler. Run in the page: find the input, take the key starting with `__reactProps` and call its `onChange({ target: input, currentTarget: input })`. This is the one allowed internal call, because a real drop has no other scripted path.
- **Observe.** The app bar shows `astribot-480p10.mcap` and the timeline covers about 39 s. Add an Image panel if the layout has none. It auto-selects `/astribot_camera/head_rgbd/color_compress/compressed/h264` at about 10 Hz. Screenshot `/tmp/verify-seg/local-mcap.png`.

## Gotchas

- Creating a blank layout writes a personal layout to the signed-in account. Report it.
- A worker `importScripts` overlay from the rspack dev server can appear. It is known and does not block playback.
- The layout dialog is modal. Clicking sidebar tabs behind it fails until it closes.
