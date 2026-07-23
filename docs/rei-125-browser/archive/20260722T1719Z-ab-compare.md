# REI-125 dual-port A/B (post D1–D3 / Q2 / Q4)

## Setup

| Side | Worktree | Port | Code |
|------|----------|-----:|------|
| **with-fixes** | `rei-125-astribot-perf` | **18181** | Full REI-125 changes + probe |
| **without-fixes** | `rei-125-ab-baseline` (`origin/main` + probe hooks only) | **18182** | No product optimisations |

Probe enable: `?rei125Perf=1`.

Harness: `scripts/rei125-ab-measure.sh` (seek settle polls probe until lookbacks finish; not fixed 800 ms sleeps).

## Fresh run (2026-07-22T17:15Z)

Sources: `ab-with-fixes.json`, `ab-without-fixes.json` (overwrite prior pre-revision artifacts; older pairs under `archive/` if present).

| Metric | with (18181) | without (18182) | Δ / read |
|--------|-------------:|----------------:|----------|
| **tReadyMs** (5× FPS chips) | 5586 | 4352 | Without ready faster this pair (noise / poll granularity) |
| **seekSettleMedianMs** | **849** | **2158** | **With ~2.5× faster median seek settle** |
| **seekSettleTotalMs** (5 seeks) | **5596** | **29660** | **With ~5.3× lower total settle** |
| seek longtask total ms | 79 | 53 | Similar (not the main signal) |
| play wall ms (~6s) | 6368 | 7218 | Mild with edge |
| heap MB end | 586 | 637 | Mild with edge |
| **lookbackReadMaxConcurrent** | **2** | n/a† | Gate bounds range-reads at 2 |
| **lookbackMaxConcurrent** (mid-lookback) | 10 | **5** | With can be higher mid-decode (gate no longer serializes decode) |
| lookbackStart count | 20 | 10 | With more lookback activity this run |
| lookbackReadWaitMsTotal | ~2233 | 0† | Queue cost of read gate |
| **stBuildMsMax** | **~0.91** | **~3.46** | With lower peak ST rebuild |
| **blockLoadSpanCount** | **1** | **1** | Focus loading off by default (D1) |
| camera FPS | ~15 all | ~15 all | Same |

† Baseline hooks call `rei125LookbackStart/End` only (whole lookback body), not `lookbackRead*` counters used after the range-read-only gate split.

### Interpretation (honest)

1. **Clear win — seek settle:** after the D3 gate-scope fix, multi-seek settle time dropped sharply (median 849 ms vs 2158 ms; total 5.6 s vs 29.7 s). This is the first dual-port pair where wall-clock seek cost clearly improves.
2. **Gate still works for network:** `lookbackReadMaxConcurrent = 2` on with-fixes.
3. **ST rebuild peak lower** (~0.9 vs ~3.5 ms) — consistent with windowed merge (D2); absolute main-thread share still small.
4. **tReady** not improved (and slightly worse this pair) — do not claim load-time wins.
5. **n = 1** pair — directional, not a multi-run statistical study.
6. **Prior JSON** under `archive/` (if any) predate D1–D3 and must not be cited as current.

## Residual risks / deferred

- One range-read can still hold a gate slot up to the 5 s timeout.
- No BlockLoader LRU eviction — do not re-enable `playheadFocusEnabled` without it.
- Harness still lacks per-camera “seek → first frame” and ST-readiness metrics.
- Deferred: true out-of-order block consumers, player-level windowed ST preload.

## Re-run

```bash
# terminals
cd rei-125-astribot-perf && yarn web:serve --port 18181
cd rei-125-ab-baseline && yarn web:serve --port 18182

export OUT_DIR=.../rei-125-astribot-perf/docs/rei-125-browser
PORT=18181 ./scripts/rei125-ab-measure.sh with-fixes
PORT=18182 ./scripts/rei125-ab-measure.sh without-fixes
```
