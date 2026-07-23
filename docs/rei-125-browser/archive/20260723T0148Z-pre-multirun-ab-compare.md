# REI-125 dual-port A/B (post D1–D3 / Q2 / Q4)

## Setup

| Side | Worktree | Port | Code |
|------|----------|-----:|------|
| **with-fixes** | `rei-125-astribot-perf` | **18181** | Full REI-125 changes + probe |
| **without-fixes** | `rei-125-ab-baseline` (`origin/main` + probe hooks only) | **18182** | No product optimisations |

Probe enable: `?rei125Perf=1`.

Harness: `scripts/rei125-ab-measure.sh` (seek settle polls probe until lookbacks finish; not fixed 800 ms sleeps). Both sides used **button** seek input.

## Fresh run (2026-07-22T17:20Z)

Sources: `ab-with-fixes.json`, `ab-without-fixes.json` (overwrite prior pair; previous pair under `archive/20260722T1719Z-*` and earlier under `archive/*-pre-20260723011510.json`).

| Metric | with (18181) | without (18182) | Δ / read |
|--------|-------------:|----------------:|----------|
| **tReadyMs** (5× FPS chips) | 4542 | 3628 | Without ready faster this pair (noise / poll granularity) |
| **seekSettleMedianMs** | **738** | **811** | With ~1.1× faster median (small) |
| **seekSettleTotalMs** (5 seeks) | **4896** | **4917** | Essentially tied |
| seek settle series (ms) | 525, 738, 719, 1170, 1744 | 570, 1147, 1582, 807, 811 | With has one slower tail seek |
| seek longtask total ms | 59 | 111 | Mild with edge |
| play wall ms (~6s) | 6582 | 6686 | Tied |
| **heap MB end** | **535** | **849** | **With ~37% lower heap** |
| **lookbackReadMaxConcurrent** | **2** | n/a† | Gate bounds range-reads at 2 |
| lookbackMaxConcurrent (mid-lookback) | 5 | 6 | Similar decode concurrency |
| lookbackStart count | 10 | 10 | Same |
| lookbackReadWaitMsTotal | ~6946 | 0† | Queue cost of read gate |
| **stBuildMsMax** | **~1.05** | **~5.09** | **With ~5× lower peak ST rebuild** |
| stBuildCount / stBuildMsTotal | 269 / ~46 | 536 / ~83 | With fewer/cheaper rebuilds |
| **blockLoadSpanCount** | **1** | **1** | Focus loading off by default (D1) |
| camera FPS | ~15 all | ~15 all | Same |

† Baseline hooks call `rei125LookbackStart/End` only (whole lookback body), not `lookbackRead*` counters used after the range-read-only gate split.

### Interpretation (honest)

1. **Seek settle — not a clear wall-clock win this pair.** Median 738 vs 811 ms and total ~4.9 s both sides. The prior pair (archived) had a large settle gap (849 vs 2158 ms; 5.6 s vs 29.7 s); that result is **not reproducible** in this immediate re-run under warm CDN/browser conditions. Do not treat either single pair as multi-run statistics.
2. **Clearer wins still present:** end heap **535 vs 849 MB**; ST peak rebuild **~1.05 vs ~5.09 ms**; ST build count ~half. Gate holds **lookbackReadMaxConcurrent = 2**.
3. **tReady** still not improved — do not claim load-time wins.
4. **Gate wait cost** is real (`lookbackReadWaitMsTotal` ~6.9 s) — serialization tax paid for bounded concurrent range-reads.
5. **n = 1** fresh pair (+ 1 archived prior pair with larger settle delta). Directional for heap/ST; seek wall-clock remains **variable**.
6. **Prior JSON** under `archive/` must not be mixed with current numbers without labeling the run.

### Prior pair (2026-07-22T17:15Z, archived)

| Metric | with | without |
|--------|-----:|--------:|
| seekSettleMedianMs | 849 | 2158 |
| seekSettleTotalMs | 5596 | 29660 |
| heap MB end | 586 | 637 |
| stBuildMsMax | ~0.91 | ~3.46 |

Larger seek delta; still single-pair. See `archive/20260722T1719Z-*`.

## Residual risks / deferred

- One range-read can still hold a gate slot up to the 5 s timeout.
- No BlockLoader LRU eviction — do not re-enable `playheadFocusEnabled` without it.
- Harness still lacks per-camera “seek → first frame” and ST-readiness metrics.
- Seek wall-clock is run-to-run noisy; multi-run (n≥3) recommended before claiming settle wins in release notes.
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
