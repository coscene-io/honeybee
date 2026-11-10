#!/usr/bin/env bash
# Usage: open-record.sh <start|mid|ISO-time> <screenshot.png> [wait-ms]
# Opens the cloud record 质检测试 CJ260330-3-R154 paused at the time, waits, prints DOM facts, screenshots.
set -euo pipefail

when="${1:?start, mid, or an ISO time like 2026-03-31T03:09:51.568000000Z}"
shot="${2:?absolute screenshot path}"
wait_ms="${3:-15000}"

case "$when" in
  start) iso="2026-03-31T03:09:03.719000000Z" ;;
  mid) iso="2026-03-31T03:09:51.568000000Z" ;;
  *) iso="$when" ;;
esac

mkdir -p "$(dirname "$shot")"
time_param="${iso//:/%3A}"
url="http://localhost:8081/?ds=coscene-data-platform&ds.key=KATEYpPwcXfb6kb_kbcOl&layoutId=recommended%3Aastribot-s1%3Ah264%3Ahttps%253A%252F%252Fhoneybee-public-layouts.coscene.io%252Fastribot-s1%252Fmanipulation_execution_review__viewer-h264.json&time=${time_param}"
# macOS ships bash 3.2, which has no ${var@Q}; quote JavaScript strings with JSON instead.
js_str() { node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1"; }
url_js="$(js_str "$url")"
shot_js="$(js_str "$shot")"

ego-browser nodejs <<EOF
const task = await taskSpace("verify honeybee segmentation");
const page = task.page("p1");
await page.goto(${url_js});
await page.waitForFunction(() => (document.body?.innerText ?? "").includes("astribot_camera"), undefined, { timeout: 60000 });
await page.waitForTimeout(${wait_ms});
const facts = await page.evaluate(() => {
  const clock = document.querySelector('input[aria-label="当前播放时间"], input[title="当前播放时间"]');
  const text = document.body.innerText;
  return {
    clock: clock?.value ?? null,
    searchingKeyframe: text.includes("正在查找关键帧"),
    signInPrompt: /登录|Sign in/.test(text) && !text.includes("astribot_camera"),
    topics: [...new Set(text.match(/\/astribot_camera\/[\w/]+/g) ?? [])],
    imageCanvases: [...document.querySelectorAll("canvas")].filter((c) => c.width > 200).length,
    annotationEntry: text.includes("编辑空间标注"),
    localStorageBadge: text.includes("本机标注"),
  };
});
console.log(JSON.stringify({ spaceId: task.spaceId, ...facts }, null, 2));
await page.screenshot({ path: ${shot_js} });
console.log("screenshot", ${shot_js});
EOF
