#!/usr/bin/env bash
# REI-125 A/B browser measure harness (agent-browser).
#
# Usage:
#   PORT=18181 ./scripts/rei125-ab-measure.sh with-fixes
#   PORT=18182 ./scripts/rei125-ab-measure.sh without-fixes
#
# Env:
#   PORT     — dev server port (default 8080)
#   OUT_DIR  — results directory (default docs/rei-125-browser under this script's repo)
#   WAIT_READY_SEC — max seconds to wait for 5 camera FPS (default 90)

set -euo pipefail

LABEL="${1:-run}"
PORT="${PORT:-8080}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${OUT_DIR:-$ROOT/docs/rei-125-browser}"
WAIT_READY_SEC="${WAIT_READY_SEC:-90}"
mkdir -p "$OUT_DIR"

URL="http://localhost:${PORT}/?rei125Perf=1&ds=coscene-share-manifest&time=2026-05-18T08%3A31%3A43.157169652Z#manifestUrl=https%3A%2F%2Fcoscene-guangzhou-mcap.intl.coscene.cn%2Fpublic-preview%2Fastribot_s1%2Fhuiyu3_88c39f98%2Fshards%2Fmanifest.json&layoutUrl=https%3A%2F%2Fcoscene-guangzhou-mcap.intl.coscene.cn%2Fpublic-preview%2Flayouts%2Fastribot-s1.json"

echo "[rei125-ab] label=$LABEL port=$PORT"
echo "[rei125-ab] waiting for :$PORT ..."
for _ in $(seq 1 90); do
  if curl -sS -o /dev/null -w "%{http_code}" "http://localhost:${PORT}/" | grep -q 200; then
    break
  fi
  sleep 1
done
curl -sS -o /dev/null -w "[rei125-ab] root=%{http_code}\n" "http://localhost:${PORT}/"

# Separate agent-browser session per port to avoid clobbering side-by-side runs
export AGENT_BROWSER_SESSION="rei125-${LABEL}-${PORT}-$$"
agent-browser close >/dev/null 2>&1 || true
sleep 1
agent-browser open "$URL"
# Give the page a moment to navigate off about:blank before first eval
agent-browser wait 2000 >/dev/null || sleep 2
for _ in 1 2 3 4 5; do
  HREF=$(agent-browser eval 'location.href' 2>/dev/null || true)
  if echo "$HREF" | grep -q "localhost:${PORT}"; then
    break
  fi
  echo "[rei125-ab] waiting for navigation (got $HREF)"
  agent-browser open "$URL" >/dev/null
  agent-browser wait 2000 >/dev/null || sleep 2
done

agent-browser eval "$(cat <<'JS'
(() => {
  const g = (window.__rei125Ab = {
    t0: performance.now(),
    marks: {},
    longTasks: [],
    readyAt: null,
    seek: null,
    play: null,
  });
  try {
    if (PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
      const obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          g.longTasks.push({ start: e.startTime, duration: e.duration });
        }
      });
      obs.observe({ type: "longtask", buffered: true });
      g.ltObserver = obs;
    }
  } catch (e) {
    g.ltError = String(e);
  }
  try { localStorage.setItem("rei125_perf", "1"); } catch {}
  return { ok: true, longTaskSupported: !!g.ltObserver };
})()
JS
)"

for i in $(seq 1 "$WAIT_READY_SEC"); do
  READY_JSON=$(agent-browser eval "$(cat <<'JS'
(() => {
  const text = document.body.innerText || "";
  const fps = [...text.matchAll(/FPS\s*([\d.]+)\s*Hz/gi)].map((m) => Number(m[1]));
  const ok =
    fps.length >= 5 &&
    text.includes("320p") &&
    text.includes("Left Wrist") &&
    text.includes("Torso Camera");
  if (ok && !window.__rei125Ab.readyAt) {
    window.__rei125Ab.readyAt = performance.now();
  }
  return {
    ok,
    fps,
    readyAt: window.__rei125Ab.readyAt,
    elapsedMs: Math.round(performance.now() - window.__rei125Ab.t0),
    heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null,
  };
})()
JS
)")
  echo "[rei125-ab] ready-poll $i: $READY_JSON"
  if echo "$READY_JSON" | grep -q '"ok": true'; then
    break
  fi
  agent-browser wait 1000 >/dev/null
done

agent-browser screenshot "$OUT_DIR/ab-${LABEL}-ready.png" >/dev/null || true

agent-browser eval "$(cat <<'JS'
(() => {
  window.__rei125Ab.marks.seekStart = performance.now();
  window.__rei125Ab.seekLtFrom = window.__rei125Ab.longTasks.length;
  return true;
})()
JS
)" >/dev/null

# Seek settle measurement.
#
# The original version slept a fixed 800 ms after each click, so `seekWallMs` was ~4 s of sleeps on
# both A/B sides and contained no seek-latency signal at all.
#
# We instead mark the click in-page and poll the probe until the app goes *quiescent*. An earlier
# attempt waited for the seek's video lookbacks to finish, but measurement showed seeks on this
# layout trigger **zero** new lookbacks — the GOP cache and keyframe index serve them — so that
# condition never became true and every seek hit the poll cap. What actually moves on a seek is
# StateTransitions rebuild work (`stBuildCount`), so we watch the whole counter set and declare the
# seek settled once it has changed at least once and then held still.
#
# Remaining limitations: settle granularity is the poll period plus the ~75 ms eval round-trip
# (~175 ms), and it is confirmed by 2 stable polls, so treat per-seek numbers as ±350 ms. A seek
# that produces no observable counter movement at all resolves at SEEK_NOCHANGE_MS and is counted
# in `noActivity`. This is a real measurement, not a sleep, but it is not a Chrome trace.
SEEK_POLL_MS=100
SEEK_SETTLE_CAP=40  # hard ceiling (~7 s) so a wedged run still finishes
SEEK_STABLE_POLLS=2 # consecutive unchanged polls required after activity
SEEK_NOCHANGE_MS=1500

# Resolve the seek button once; re-snapshotting per iteration cost ~1 s of unattributed wall time.
# Retry: a single early snapshot can miss the control before the toolbar mounts, and silently
# falling back to ArrowRight on only one side of the A/B compares two different input paths.
SEEK_REF=""
for _ in $(seq 1 10); do
  SNAP=$(agent-browser snapshot -i 2>/dev/null || true)
  SEEK_REF=$(echo "$SNAP" | rg -oi 'Seek forward[^\n]*\[ref=e[0-9]+\]' | head -1 | rg -o 'e[0-9]+' || true)
  if [ -n "$SEEK_REF" ]; then
    break
  fi
  agent-browser wait 500 >/dev/null
done
if [ -n "$SEEK_REF" ]; then
  SEEK_INPUT_METHOD="button"
else
  SEEK_INPUT_METHOD="arrowright"
  echo "[rei125-ab] WARN: seek-forward button never resolved; using ArrowRight for all iterations."
  echo "[rei125-ab] WARN: only compare against another run with the same seekInputMethod."
fi
echo "[rei125-ab] seek input method: $SEEK_INPUT_METHOD"
agent-browser eval "(() => { window.__rei125Ab.seekInputMethod = '$SEEK_INPUT_METHOD'; return true; })()" >/dev/null

for i in 1 2 3 4 5; do
  agent-browser eval "$(cat <<'JS'
(() => {
  const g = window.__rei125Ab;
  const c = window.__rei125PerfReport ? window.__rei125PerfReport.counters : undefined;
  g.seekIterStart = performance.now();
  g.seekSig = c ? JSON.stringify(c) : "";
  g.seekChanged = false;
  g.seekStable = 0;
  return true;
})()
JS
)" >/dev/null

  if [ -n "$SEEK_REF" ]; then
    agent-browser click "@${SEEK_REF}" >/dev/null
  else
    agent-browser press ArrowRight >/dev/null 2>&1 || true
  fi

  for _ in $(seq 1 "$SEEK_SETTLE_CAP"); do
    SETTLED=$(agent-browser eval "$(cat <<JS
(() => {
  const g = window.__rei125Ab;
  const r = window.__rei125PerfReport;
  const elapsed = performance.now() - g.seekIterStart;
  if (!r) {
    return { settled: elapsed >= ${SEEK_NOCHANGE_MS}, probe: false };
  }
  const sig = JSON.stringify(r.counters);
  if (sig !== g.seekSig) {
    g.seekSig = sig;
    g.seekChanged = true;
    g.seekStable = 0;
    return { settled: false, probe: true };
  }
  g.seekStable += 1;
  if (g.seekChanged) {
    // Work happened and has now held still.
    return { settled: g.seekStable >= ${SEEK_STABLE_POLLS}, probe: true };
  }
  // Nothing moved at all — a fully cached seek. Give it a bounded grace period.
  return { settled: elapsed >= ${SEEK_NOCHANGE_MS}, probe: true, noActivity: true };
})()
JS
)")
    if echo "$SETTLED" | grep -q '"settled": *true'; then
      if echo "$SETTLED" | grep -q '"noActivity": *true'; then
        agent-browser eval '(() => { const g = window.__rei125Ab; g.seekNoActivity = (g.seekNoActivity || 0) + 1; return g.seekNoActivity; })()' >/dev/null
      fi
      break
    fi
    agent-browser wait "$SEEK_POLL_MS" >/dev/null
  done

  agent-browser eval "$(cat <<'JS'
(() => {
  const g = window.__rei125Ab;
  (g.seekIterMs = g.seekIterMs || []).push(Math.round(performance.now() - g.seekIterStart));
  return g.seekIterMs;
})()
JS
)" >/dev/null
done

SEEK_JSON=$(agent-browser eval "$(cat <<'JS'
(() => {
  const g = window.__rei125Ab;
  const end = performance.now();
  const tasks = g.longTasks.slice(g.seekLtFrom || 0);
  const iters = g.seekIterMs || [];
  const sorted = [...iters].sort((a, b) => a - b);
  g.seek = {
    wallMs: Math.round(end - g.marks.seekStart),
    // Measured per-seek settle times (click → probe counters quiescent), not fixed sleeps.
    settleMs: iters,
    settleMedianMs: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
    settleTotalMs: iters.reduce((s, v) => s + v, 0),
    // Seeks that produced no observable counter movement (fully cached); these resolve at the
    // grace period, not at a measured settle, so exclude them when comparing medians.
    noActivitySeeks: g.seekNoActivity || 0,
    inputMethod: g.seekInputMethod || null,
    longTaskCount: tasks.length,
    longTaskTotalMs: Math.round(tasks.reduce((s, t) => s + t.duration, 0)),
    longTasksOver50: tasks.filter((t) => t.duration >= 50).length,
    maxLongTaskMs: tasks.length ? Math.round(Math.max(...tasks.map((t) => t.duration))) : 0,
    heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null,
  };
  return g.seek;
})()
JS
)")
echo "[rei125-ab] seek: $SEEK_JSON"

agent-browser eval "$(cat <<'JS'
(() => {
  window.__rei125Ab.marks.playStart = performance.now();
  window.__rei125Ab.playLtFrom = window.__rei125Ab.longTasks.length;
  return true;
})()
JS
)" >/dev/null

SNAP=$(agent-browser snapshot -i 2>/dev/null || true)
PLAY_REF=$(echo "$SNAP" | rg -oi 'button "Play"[^\n]*\[ref=e[0-9]+\]' | head -1 | rg -o 'e[0-9]+' || true)
if [ -z "$PLAY_REF" ]; then
  PLAY_REF=$(echo "$SNAP" | rg -oi 'Play[^\n]*\[ref=e[0-9]+\]' | head -1 | rg -o 'e[0-9]+' || true)
fi
if [ -n "$PLAY_REF" ]; then
  agent-browser click "@${PLAY_REF}" >/dev/null
else
  agent-browser press Space >/dev/null 2>&1 || true
fi
agent-browser wait 6000 >/dev/null
SNAP=$(agent-browser snapshot -i 2>/dev/null || true)
PAUSE_REF=$(echo "$SNAP" | rg -oi 'Pause[^\n]*\[ref=e[0-9]+\]' | head -1 | rg -o 'e[0-9]+' || true)
if [ -n "$PAUSE_REF" ]; then
  agent-browser click "@${PAUSE_REF}" >/dev/null
fi

PLAY_JSON=$(agent-browser eval "$(cat <<'JS'
(() => {
  const g = window.__rei125Ab;
  const end = performance.now();
  const tasks = g.longTasks.slice(g.playLtFrom || 0);
  g.play = {
    wallMs: Math.round(end - g.marks.playStart),
    longTaskCount: tasks.length,
    longTaskTotalMs: Math.round(tasks.reduce((s, t) => s + t.duration, 0)),
    longTasksOver50: tasks.filter((t) => t.duration >= 50).length,
    maxLongTaskMs: tasks.length ? Math.round(Math.max(...tasks.map((t) => t.duration))) : 0,
    heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null,
  };
  return g.play;
})()
JS
)")
echo "[rei125-ab] play: $PLAY_JSON"

agent-browser screenshot "$OUT_DIR/ab-${LABEL}-final.png" >/dev/null || true

FINAL=$(agent-browser eval "$(cat <<JS
(() => {
  const g = window.__rei125Ab;
  const text = document.body.innerText || "";
  const fps = [...text.matchAll(/FPS\\s*([\\d.]+)\\s*Hz/gi)].map((m) => Number(m[1]));
  let inApp = null;
  try {
    const raw = localStorage.getItem("rei125_perf_report");
    if (raw) inApp = JSON.parse(raw);
  } catch {}
  if (!inApp && window.__rei125PerfReport) inApp = window.__rei125PerfReport;
  const nav = performance.getEntriesByType("navigation")[0];
  const paint = performance.getEntriesByType("paint");
  const report = {
    label: "$LABEL",
    port: $PORT,
    collectedAt: new Date().toISOString(),
    external: {
      // performance.now() is relative to this document's navigation start, so readyAt is directly
      // "ms from navigation to 5 cameras reporting FPS". Subtracting t0 (taken after the harness
      // had already waited ~2-4 s for navigation) measured from an arbitrary point and produced
      // nonsense like 43 ms on a warm reload.
      tReadyMs: g.readyAt != null ? Math.round(g.readyAt) : null,
      tReadyFromHarnessStartMs: g.readyAt != null ? Math.round(g.readyAt - g.t0) : null,
      nav: nav ? {
        domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
        loadEventEndMs: Math.round(nav.loadEventEnd),
      } : null,
      paint: paint.map((p) => ({ name: p.name, startMs: Math.round(p.startTime) })),
      fps,
      seek: g.seek,
      play: g.play,
      longTaskTotalAll: Math.round(g.longTasks.reduce((s, t) => s + t.duration, 0)),
      longTaskCountAll: g.longTasks.length,
      heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null,
    },
    inAppProbe: inApp,
  };
  try { localStorage.setItem("rei125_ab_last", JSON.stringify(report)); } catch {}
  return report;
})()
JS
)")

echo "$FINAL" | python3 -m json.tool > "$OUT_DIR/ab-${LABEL}.json"
echo "[rei125-ab] wrote $OUT_DIR/ab-${LABEL}.json"
echo "$FINAL" | python3 -c '
import sys, json
r = json.load(sys.stdin)
e = r["external"]
s = e.get("seek") or {}
c = ((r.get("inAppProbe") or {}).get("counters") or {})
print(
    "SUMMARY", r["label"], "port", r.get("port"),
    "tReadyMs=", e.get("tReadyMs"),
    "seekSettleMedianMs=", s.get("settleMedianMs"),
    "seekSettleTotalMs=", s.get("settleTotalMs"),
    "seekInput=", s.get("inputMethod"),
    "seekNoActivity=", s.get("noActivitySeeks"),
    "seekLT=", s.get("longTaskTotalMs"),
    "heap=", e.get("heapMB"),
    "lookbackReadMax=", c.get("lookbackReadMaxConcurrent"),
    "lookbackReadWaitMs=", round(c.get("lookbackReadWaitMsTotal") or 0),
    "lookbackMax=", c.get("lookbackMaxConcurrent"),
    "lookbackStarts=", c.get("lookbackStart"),
    "stBuildMaxMs=", c.get("stBuildMsMax"),
    "blockSpans=", c.get("blockLoadSpanCount"),
)'
