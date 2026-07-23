# REI-125 dual-port A/B — multi-run (n=3)

## Setup

| Side | Worktree | Port | Code |
|------|----------|-----:|------|
| **with-fixes** | `rei-125-astribot-perf` (incl. latest `main`) | **18181** | Full REI-125 changes + probe |
| **without-fixes** | `rei-125-ab-baseline` (main-ish + probe hooks only) | **18182** | No product optimisations |

Probe: `?rei125Perf=1`. Harness: `scripts/rei125-ab-measure.sh` (seek settle polls lookbacks; button seek).

Artifacts: `ab-with-fixes-r{1,2,3}.json`, `ab-without-fixes-r{1,2,3}.json` (copies under `runs/`). Prior single-pair JSON archived under `archive/*-pre-multirun-*`.

## Per-run table (2026-07-23T01:48–01:51Z)

| Run | Side | tReadyMs | seekSettleMedianMs | seekSettleTotalMs | heapMB | lookbackReadMax | stBuildMsMax | blockSpans |
|----:|------|--------:|-------------------:|------------------:|-------:|----------------:|-------------:|-----------:|
| 1 | with | 4312 | **662** | 6649 | 844 | **2** | 2.56 | 1 |
| 1 | without | 3204 | 680 | **3736** | **733** | 0† | 3.32 | 1 |
| 2 | with | **3206** | 694 | **3854** | 841 | **2** | **1.61** | 1 |
| 2 | without | 4508 | **675** | 5286 | 885 | 0† | 5.61 | 1 |
| 3 | with | 6487 | 7609 | 24426 | **596** | **2** | 11.77 | 1 |
| 3 | without | **3296** | **1703** | **20026** | 778 | 0† | **2.72** | 1 |

† Baseline probe hooks do not emit `lookbackRead*` (range-read gate counters); `0` is expected.

## Aggregates (n=3)

| Metric | with median | with min–max | without median | without min–max |
|--------|------------:|-------------:|---------------:|----------------:|
| tReadyMs | 4312 | 3206–6487 | **3296** | 3204–4508 |
| seekSettleMedianMs | 694 | 662–7609 | **680** | 675–1703 |
| seekSettleTotalMs | 6649 | 3854–24426 | **5286** | 3736–20026 |
| heapMB | 841 | 596–844 | **778** | 733–885 |
| stBuildMsMax | **2.56** | 1.61–11.77 | 3.32 | 2.72–5.61 |
| lookbackReadMaxConcurrent | **2 / 2 / 2** | — | n/a | — |
| blockLoadSpanCount | **1 / 1 / 1** | — | **1 / 1 / 1** | — |

Per-pair deltas (with − without):

| Run | settleMed Δ | settleTot Δ | heap Δ | stMax Δ |
|----:|------------:|------------:|-------:|--------:|
| 1 | −18 | +2913 | +111 | −0.76 |
| 2 | +19 | −1432 | −44 | −4.00 |
| 3 | +5906 | +4400 | −182 | +9.05 |

## Honest interpretation

1. **Stable mechanism signals:** with-fixes always has `lookbackReadMaxConcurrent = 2` and `blockLoadSpanCount = 1` (gate on; focus loading off).
2. **Seek settle is noisy, not a multi-run win.** Median-of-medians is essentially tied (694 vs 680 ms). Run 3 is a heavy outlier on **both** sides (totals ~24s / ~20s); do not cite single-run settle “wins.”
3. **Heap is not a consistent multi-run win.** Median heap is slightly **higher** on with-fixes this series (841 vs 778). Earlier single-pair ~535 vs ~849 does not hold across these three pairs.
4. **ST peak rebuild** median favors with (2.56 vs 3.32 ms), but run 3 with-fixes spiked to ~11.8 ms — still treat as directional, not robust.
5. **tReady** still does not favor with-fixes (median 4312 vs 3296).
6. **n = 3 is still small.** Use for honesty about variance, not marketing percentages.

## Residual risks / deferred

- Range-read gate slot can hold up to ~5 s timeout.
- No BlockLoader LRU eviction — keep playhead focus off without OOO consumers.
- Harness lacks per-camera first-frame / ST-readiness metrics.
- Deferred product work: player-level windowed ST preload, OOO block merge.

## Re-run

```bash
cd rei-125-astribot-perf && yarn web:serve --port 18181
cd rei-125-ab-baseline && yarn web:serve --port 18182
export OUT_DIR=.../docs/rei-125-browser
for n in 1 2 3; do
  PORT=18181 ./scripts/rei125-ab-measure.sh with-fixes-r$n
  PORT=18182 ./scripts/rei125-ab-measure.sh without-fixes-r$n
done
```
