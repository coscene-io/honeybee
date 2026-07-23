# REI-125 Performance Fixes Report

**Date:** 2026-07-22  
**Branch:** `rei-125-astribot-perf`  
**Scope:** Targeted, reversible optimizations for Astribot S1 share-manifest layout  
**Status:** Implemented + revised after Codex **and Claude** second-opinion reviews; unit-tested; dual-port multi-run A/B n=3 2026-07-23; main merged (see `docs/rei-125-browser/ab-compare.md`)

> **Revision 3 (Claude review).** The first dual-port A/B showed no wall-clock win. Root-causing that
> found three defects in the fixes themselves, all now resolved. Read
> [Revision 3 changes](#revision-3--claude-second-opinion-fixes) before the original fix list below;
> where the two disagree, revision 3 wins.

---

## Problem summary (from investigation)

Public share-manifest layout loads **28 panels**:

| Type | Count | Cost driver |
|------|------:|-------------|
| Image (H.264) | 5 | Concurrent WebCodecs decode + seek keyframe lookback |
| StateTransitions | 5 | `preloadType: "full"` on ~250 Hz joint topics; full-bag processing |
| Gauge / Indicator | 18 | Cheap (current-frame only) |

Default video profile remains **320p15** (already lowest). Original ~2.37 GB recording is sharded; active set ≈ 26 MB video + 22 MB tail.

---

## Fixes implemented

### Fix 1 — Multi-camera seek lookback concurrency gate

**Goal:** On seek, 5 Image panels no longer all fire range-read lookbacks at once.

**Change:**
- New `VideoSeekLookbackGate` (default max **2** concurrent lookbacks)
- `CompressedVideoController.#runLookback` acquires a slot before keyframe search
- `tryAcquire()` keeps the under-limit path **synchronous** (no extra microtask)

**Files:**
- `packages/studio-base/src/panels/ThreeDeeRender/renderables/Images/videoSeekLookbackGate.ts`
- `.../videoSeekLookbackGate.test.ts`
- `.../CompressedVideoController.ts` (+ test isolation via `resetForTests`)

**Expected impact:** Lower seek jank / fewer stalled HTTP/1.1 connections when scrubbing multi-camera layouts. Slight serialization of later cameras’ first paint after seek (by design).

---

### Fix 2 — BlockLoader playhead-priority preloading

**Goal:** Deep-link `time=` / seeks should preload StateTransitions history **near the playhead first**, not from bag start.

**Change:**
- `BlockLoader.setFocusTime(time, { abortInFlight? })`
- Next incomplete block chosen by distance to focus
- Spans expand **forward only**, capped at **`BLOCK_LOAD_MAX_SPAN_DURATION_NS` (10s)** so focus does not pull focus→EOF in one request (Codex review)
- Seek aborts in-flight load and returns `"aborted"` so loading restarts without condvar lost-wakeup
- Playback updates focus without abort (no thrash)

**Files:**
- `packages/studio-base/src/players/IterablePlayer/BlockLoader.ts`
- `.../BlockLoader.test.ts` (focus-first order, span cap, seek abort/restart)
- `.../IterablePlayer.ts` (wires focus on seek / play / init)

**Expected impact:** Faster time-to-usable ST plots after seek/deep-link; full bag still eventually preloads. **Does not reduce total preload bytes.**

---

### Fix 3 — StateTransitions data collapse + viewport windowing

**Goal:** Cut CPU/memory when processing high-rate joint topics into ST panels.

**Change:**
- `appendCollapsedStateSample`: plateau of equal values → start + trailing endpoint only
- `sliceStateDataForViewport`: process only visible x-window (+25% pad) when building datasets
- `processCacheFingerprint`: cache must include trailing endpoint so in-place plateau extension invalidates
- **Rebuild datasets** on pan/zoom interaction, `setGlobalBounds`, and `resetBounds` (Codex review: previously only re-dispatched stale pending datasets)

**Files:**
- `packages/studio-base/src/panels/StateTransitions/stateTransitionData.ts`
- `.../stateTransitionData.test.ts` (correctness + fingerprint + micro-benchmarks)
- `.../StateTransitionsCoordinator.ts`
- `.../StateTransitionsCoordinator.viewport.test.ts` (sync bounds + pan rebuild)

**Expected impact:**
- Discrete/plateau series (grippers, enums): large storage reduction
- Continuous joint angles: smaller win on collapse; viewport slice still bounds per-frame processing to ~30s window
- Does **not** reduce BlockLoader network preload of full topics (player still honors `preloadType: "full"`)
- Pan/zoom/sync now correctly re-slice from stored fullData/currentData

---

## Revision 3 — Claude second-opinion fixes

The dual-port A/B (`docs/rei-125-browser/ab-compare.md`) showed the gate working (concurrency 2 vs 6)
but **no** wall-clock or heap win, ~2.58 s of new lookback queue wait, and `blockLoadSpanCount` 1 → 8.
Investigating that produced three defects and two follow-ups.

### R3-1 — Playhead focus is now **off by default** (fixes Fix 2)

**Defect.** Loading blocks outward from the playhead only helps if block consumers can ingest blocks
out of order, and none can:

- `Plot/builders/BlockTopicCursor` stops at the first gap and yields nothing until block 0 arrives —
  which, under outward-from-focus fill, is the **last** block loaded.
- `StateTransitionsCoordinator.#processBlocks` did worse: a missing block hit `continue` but the loop
  kept scanning and advanced the cursor past it, so blocks 0..focus-1 fell **behind** the cursor
  before they ever loaded and their history was dropped. It self-healed only when block 0 finally
  arrived and tripped a full wipe + reprocess of every series at once — the largest possible reset,
  at the worst possible moment.

Net effect on a mid-bag deep link: ST panels showed no pre-seek history, then a reprocessing spike.
Focus also fragmented preload into 8 range requests contending with the video seek reads.

**Resolution (option b — the safe one).** `playheadFocusEnabled` is a `BlockLoader` constructor
option defaulting to `false` (`BLOCK_LOADER_PLAYHEAD_FOCUS_DEFAULT`). With it off, `setFocusTime` is a
no-op, block selection is the original sequential left-to-right scan, and the 10 s span cap does not
apply — one contiguous span again, as before the change. The `IterablePlayer` call sites are left in
place so re-enabling is a one-line flip once consumers merge blocks by timestamp.

**Also fixed regardless of the flag** (`StateTransitionsCoordinator`):

- `#processBlocks` now `break`s at the first gap instead of skipping past it, matching
  `BlockTopicCursor`. A late-arriving block can no longer be stranded behind the cursor.
- `#firstBlockRefs` is recorded on every pass, not only on reset. Previously it stayed unset until
  the first reset, so the **second** player-state emit always saw "first block changed" and wiped +
  reprocessed the whole series once.

### R3-2 — StateTransitions viewport slice no longer copies full history (fixes Fix 3)

**Defect.** `sliceStateDataForViewport(this.#getMergedData(cursorKey), …)` windowed the data *after*
`#getMergedData` had already done `[...fullData, ...filteredCurrent]` — a copy of the entire
preloaded series. During playback `currentData` is never empty, so the early-return never fired and
every rebuild paid O(total history). The A/B recorded 470 rebuilds in 13 s; `stBuildMsMax` looked
harmless only because the harness had 8 blocks preloaded. Revision 2's new pan/zoom rebuilds
multiplied this by the interaction rate.

**Resolution.** New `sliceMergedStateDataForViewport(fullData, currentData, minX, maxX)` walks the two
sorted arrays as one virtual concatenation and copies **only the visible window**. `#getMergedData` is
deleted. A 200-trial randomized test asserts byte-for-byte equivalence with the old
merge-then-slice path, so the pan/sync rebuild correctness from revision 2 is preserved.

### R3-3 — Lookback gate narrowed to the range read (fixes Fix 1)

**Defect.** The gate was acquired at the top of `#runLookback` and released in its `finally`, so a
slot was held across the whole window ladder, the WebCodecs GOP decode, **and** the retry backoff
sleeps (50/250/1000 ms). Decode is not a contended resource, so serializing it just delayed cameras
3-5 — the measured 2.58 s of queue wait bought nothing. Worse, one camera hitting the 5 s range-read
timeout held 1 of 2 slots and stalled the other four. Queued waiters for superseded seeks also could
not be cancelled and had to be drained in FIFO order.

**Resolution.**

- New `#readRangeGated` holds a slot around a **single** `#readRange` attempt only. Decode, display,
  the window ladder and retry backoff all run outside the slot.
- `VideoSeekLookbackGate.acquire(isStillNeeded?)` returns `boolean` and takes a liveness predicate.
  `release()` drains stale waiters and hands the slot to the first live one, so a cancelled seek
  cannot head-of-line block.
- Max concurrency stays at **2**.

Probe counters split accordingly: `lookbackReadMaxConcurrent` / `lookbackReadWaitMsTotal` are what the
gate now bounds; `lookbackMaxConcurrent` becomes "cameras mid-lookback" and is expected to reach the
panel count.

### R3-4 — Video GOP cache budget is now shared across cameras

`DEFAULT_VIDEO_GOP_CACHE_MAX_BYTES` is 64 MB **per cache**, and there is one cache per Image panel —
so the 5-camera layout could hold 320 MB of compressed frames in the JS heap on top of the 1 GB block
cache. Observed heap was ~847 MB and nothing in revisions 1-2 touched it.

Caches constructed with `{ sharedBudget: true }` (only `CompressedVideoController` does) now divide
`DEFAULT_VIDEO_GOP_CACHE_TOTAL_MAX_BYTES` (128 MB), floored at `MIN_VIDEO_GOP_CACHE_MAX_BYTES`
(16 MB) and capped at the 64 MB per-cache default so single-camera layouts are unaffected. Shares
rebalance and re-prune on register/dispose; `CompressedVideoController.dispose()` releases its share.
Standalone caches keep the fixed default.

**5-camera ceiling: 320 MB → ~128 MB.**

### R3-5 — Harness: seek time is measured, not slept

`scripts/rei125-ab-measure.sh` slept a fixed 800 ms after each of 5 seek clicks, so `seekWallMs`
(~4.9 s vs 5.1 s) was almost entirely the harness's own sleeps and contained no latency signal. It now
marks the click in-page and polls the probe until the lookbacks that seek started have all finished,
reporting per-seek `settleMs`, `settleMedianMs` and `settleTotalMs`. The seek button is resolved once
instead of re-snapshotting each iteration. The summary line gained the read-slot counters and
`blockLoadSpanCount`.

**Still unresolved in the harness** (call these out when reading any future A/B):

- `tReadyMs` remains a 1 s-granularity poll and says nothing about StateTransitions readiness.
- Settle time is bounded below by the ~120 ms eval round-trip; treat per-seek numbers as ±1 poll.
- There is still no per-camera "seek → first decoded frame displayed" metric, and no
  "deep link → first ST datum plotted" metric.
- `n = 1` per side. Run ≥ 5 interleaved pairs (A,B,A,B,…) and report medians.

---

## What we deliberately did **not** change

- No layout JSON edits (still 5 cameras + 5 ST panels)
- No default profile change (already 320p)
- No MessagePipeline rewrite
- No removal of ST full preload (would break pan/zoom history without a larger player change)
- No permanent debug probes

---

## Verification

### Unit tests (all passed)

```text
yarn jest \
  packages/studio-base/src/panels/ThreeDeeRender/renderables/Images/videoSeekLookbackGate.test.ts \
  packages/studio-base/src/panels/StateTransitions/stateTransitionData.test.ts \
  packages/studio-base/src/players/IterablePlayer/BlockLoader.test.ts \
  packages/studio-base/src/panels/ThreeDeeRender/renderables/Images/CompressedVideoController.test.ts \
  --runInBand

# After Codex revision pass:
# Test Suites: 5 passed (includes coordinator viewport + expanded BlockLoader)
# Tests:       72+ passed across gate / ST data / ST viewport / BlockLoader / video controller
```

### Micro-benchmarks (in unit tests)

| Benchmark | Bound (CI-safe) | Intent |
|-----------|----------------:|--------|
| Collapse 20k plateau samples | &lt; 500 ms | Storage → O(segments) |
| 200× binary slice of 50k points | &lt; 500 ms | Viewport windowing cheap |
| Fingerprint changes on plateau end advance | assert inequality | Cache correctness |
| BlockLoader span ≤ 10s near focus | structural | No focus→EOF pull |
| BlockLoader seek abort restarts near focus | structural | Abort path |

### Static checks

| Check | Result |
|-------|--------|
| `yarn run tsc --noEmit` | pass |
| ESLint (changed files, CI config) | pass |
| `git diff --check` | pass |

### Manual / runtime (agent-browser, post-fix build)

Local deep link on `yarn web:serve` (`http://localhost:8080/?ds=coscene-share-manifest&…`).

| Signal | Observed |
|--------|----------|
| Layout loads | Yes — 28-panel Astribot UI, profile **320p @ 15fps** |
| 5 Image panels | All present; FPS samples **~14.97–15.00 Hz** |
| WebCodecs | `VideoDecoder` available |
| Navigation (shell) | DCL ~**188 ms**, `loadEventEnd` ~**942 ms** (app shell; not full viz ready) |
| First paint (this run) | ~**8.9 s** from navigation start (includes cold/dev overhead; treat as rough) |
| Layout + manifest fetch | ~**0.4–0.5 s** each from Guangzhou public storage |
| JS heap (after load) | ~**490–520 MB** used |
| JS heap (after seeks + 6s play) | ~**580–590 MB** used |
| 5× seek-forward clicks | Completed in ~**4.6 s** wall time; UI remained responsive |
| 6 s play | Cameras show live frames; heap +~90 MB vs post-load |
| Long-task API | Supported; **0** longtasks recorded in this harness (likely incomplete — worker decode / limited PO coverage in automation) |
| Main-thread Resource Timing for `.mcap` | **Not visible** (shard reads are worker-side; expected) |

Screenshots: `docs/rei-125-browser/` (copied from run) or `/tmp/rei-125-browser/`.

### Dual-port A/B (multi-run n=3, 2026-07-23)

Full per-run table + aggregates: **`docs/rei-125-browser/ab-compare.md`** (`ab-*-r{1,2,3}.json`).

| Metric (median of 3) | with-fixes | without-fixes |
|----------------------|----------:|--------------:|
| seekSettleMedianMs | 694 | 680 (tied / noisy; r3 outlier both sides) |
| seekSettleTotalMs | 6649 | 5286 (not a with win) |
| heap MB end | 841 | 778 (not a multi-run with win) |
| stBuildMsMax | **2.56** | 3.32 (mild / variable) |
| lookbackReadMaxConcurrent | **2 every run** | n/a |
| blockLoadSpanCount | 1 | 1 |
| tReadyMs | 4312 | **3296** (no load-time win) |

Multi-run **does not** support marketing seek/heap wins. Stable signals: range-read gate concurrency = 2; focus loading off (`blockSpans=1`).

---

## Recommended manual validation checklist

1. `yarn web:serve`
2. Open Astribot deep link (root, not `/viz`):
   ```
   http://localhost:8080/?ds=coscene-share-manifest&time=2026-05-18T08%3A31%3A43.157169652Z#manifestUrl=https%3A%2F%2Fcoscene-guangzhou-mcap.intl.coscene.cn%2Fpublic-preview%2Fastribot_s1%2Fhuiyu3_88c39f98%2Fshards%2Fmanifest.json&layoutUrl=https%3A%2F%2Fcoscene-guangzhou-mcap.intl.coscene.cn%2Fpublic-preview%2Flayouts%2Fastribot-s1.json
   ```
3. Chrome Performance: record seek scrub + play 10s
4. Confirm:
   - At most ~2 concurrent video lookback range bursts on seek
   - ST panels populate near playhead without waiting for full bag
   - No visual regression on ST plateaus (gripper open/close, etc.)
5. Optional: `?ds.profile=720p15` stress path (heavier; not default)

---

## Risk notes

| Risk | Mitigation |
|------|------------|
| Seek gate delays 3rd–5th camera first frame | **Resolved in R3-3**: gate covers only the range read, and stale waiters are dropped instead of blocking the queue |
| BlockLoader focus abort mid-span | **Moot in R3-1**: focus is off by default, so no abort/restart path runs |
| ST collapse changes sample density for continuous floats | Only collapses **equal** values; continuous motion unchanged |
| Viewport slice misses off-screen history until pan | Full data still stored; pan/zoom/sync **rebuild** sliced series from fullData (fixed post-Codex) |
| Continuous ST still heavy | Known; collapse only helps equal plateaus; viewport bounds render work |

---

## Follow-ups (not in this change)

1. Chrome Performance A/B numbers on this layout (main-thread ms, long tasks)
2. Optional: player-level **windowed preload** for ST (bigger change than panel-side collapse)
3. Layout guidance: continuous joint angles may belong in Plot, not StateTransitions
4. Consider sharing video lookback gate metrics in player diagnostics

---

## File index

```
packages/studio-base/src/panels/ThreeDeeRender/renderables/Images/
  videoSeekLookbackGate.ts          (new)
  videoSeekLookbackGate.test.ts     (new)
  CompressedVideoController.ts      (gate wire-up)
  CompressedVideoController.test.ts (gate reset)

packages/studio-base/src/panels/StateTransitions/
  stateTransitionData.ts            (new)
  stateTransitionData.test.ts       (new)
  StateTransitionsCoordinator.viewport.test.ts (new; pan/sync rebuild)
  StateTransitionsCoordinator.ts    (collapse + viewport + rebuild)
  StateTransitionsCoordinator.ts    (collapse + viewport)

packages/studio-base/src/players/IterablePlayer/
  BlockLoader.ts                    (focus-priority load)
  BlockLoader.test.ts               (focus order test)
  IterablePlayer.ts                 (setFocusTime on seek/play)
```
