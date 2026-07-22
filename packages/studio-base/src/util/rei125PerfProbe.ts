// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/**
 * REI-125 temporary perf probe.
 *
 * Enable with either:
 *   - URL query: `?rei125Perf=1`
 *   - localStorage: `localStorage.setItem("rei125_perf","1")` then reload
 *
 * Results are written to:
 *   - localStorage key `rei125_perf_report` (JSON)
 *   - optional console: `[REI-125 perf]` lines when enabled
 *
 * Marked for easy removal after the investigation lands.
 */

export type Rei125PerfReport = {
  enabled: boolean;
  label?: string;
  startedAt: number;
  updatedAt: number;
  marks: Record<string, number>;
  counters: {
    lookbackStart: number;
    lookbackEnd: number;
    lookbackWaitMsTotal: number;
    lookbackMaxConcurrent: number;
    /**
     * Range-read slot metrics. Since the gate was narrowed to cover only the network read,
     * `lookbackReadMaxConcurrent` is the number the gate actually bounds; `lookbackMaxConcurrent`
     * is now just "how many cameras are mid-lookback" and is expected to reach the panel count.
     */
    lookbackReadStart: number;
    lookbackReadEnd: number;
    lookbackReadWaitMsTotal: number;
    lookbackReadMaxConcurrent: number;
    stBuildCount: number;
    stBuildMsTotal: number;
    stBuildMsMax: number;
    blockLoadSpanCount: number;
  };
  longTasks: { start: number; duration: number }[];
  samples: { t: number; usedHeapMB?: number; note: string }[];
};

const LS_ENABLE = "rei125_perf";
const LS_REPORT = "rei125_perf_report";

let enabled: boolean | undefined;
let report: Rei125PerfReport | undefined;
let lookbackActive = 0;
let lookbackReadActive = 0;
let longTaskObserver: PerformanceObserver | undefined;

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function readEnabledFromEnv(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get("rei125Perf") === "1" || q.get("rei125Perf") === "true") {
      return true;
    }
    return window.localStorage.getItem(LS_ENABLE) === "1";
  } catch {
    return false;
  }
}

export function isRei125PerfEnabled(): boolean {
  if (enabled == undefined) {
    enabled = readEnabledFromEnv();
  }
  return enabled;
}

function ensureReport(): Rei125PerfReport | undefined {
  if (!isRei125PerfEnabled()) {
    return undefined;
  }
  if (!report) {
    report = {
      enabled: true,
      startedAt: now(),
      updatedAt: now(),
      marks: {},
      counters: {
        lookbackStart: 0,
        lookbackEnd: 0,
        lookbackWaitMsTotal: 0,
        lookbackMaxConcurrent: 0,
        lookbackReadStart: 0,
        lookbackReadEnd: 0,
        lookbackReadWaitMsTotal: 0,
        lookbackReadMaxConcurrent: 0,
        stBuildCount: 0,
        stBuildMsTotal: 0,
        stBuildMsMax: 0,
        blockLoadSpanCount: 0,
      },
      longTasks: [],
      samples: [],
    };
    installLongTaskObserver();
    log("probe enabled");
  }
  return report;
}

function installLongTaskObserver(): void {
  if (typeof PerformanceObserver === "undefined" || longTaskObserver) {
    return;
  }
  try {
    if (!PerformanceObserver.supportedEntryTypes.includes("longtask")) {
      return;
    }
    longTaskObserver = new PerformanceObserver((list) => {
      const r = report;
      if (!r) {
        return;
      }
      for (const entry of list.getEntries()) {
        r.longTasks.push({ start: entry.startTime, duration: entry.duration });
        // Cap memory
        if (r.longTasks.length > 500) {
          r.longTasks.splice(0, r.longTasks.length - 500);
        }
      }
      persist();
    });
    longTaskObserver.observe({ type: "longtask", buffered: true });
  } catch {
    // ignore
  }
}

function log(msg: string, extra?: unknown): void {
  if (!isRei125PerfEnabled()) {
    return;
  }
  // REI-125 perf probe: console output is intentional and gated behind isRei125PerfEnabled().
  if (extra != undefined) {
    // eslint-disable-next-line no-restricted-syntax
    console.info(`[REI-125 perf] ${msg}`, extra);
  } else {
    // eslint-disable-next-line no-restricted-syntax
    console.info(`[REI-125 perf] ${msg}`);
  }
}

function persist(): void {
  const r = report;
  if (!r || typeof window === "undefined") {
    return;
  }
  r.updatedAt = now();
  try {
    const payload = JSON.stringify(r) ?? "";
    window.localStorage.setItem(LS_REPORT, payload);
    // Also expose for agent-browser eval (scripts/rei125-ab-measure.sh reads this).
    // eslint-disable-next-line no-underscore-dangle
    (window as unknown as { __rei125PerfReport?: Rei125PerfReport }).__rei125PerfReport = r;
  } catch {
    // quota / private mode
  }
}

export function rei125Mark(name: string): void {
  const r = ensureReport();
  if (!r) {
    return;
  }
  r.marks[name] = now();
  log(`mark ${name}`, r.marks[name]);
  persist();
}

export function rei125Sample(note: string): void {
  const r = ensureReport();
  if (!r) {
    return;
  }
  let usedHeapMB: number | undefined;
  const perfMem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  if (perfMem) {
    usedHeapMB = Math.round(perfMem.usedJSHeapSize / 1e6);
  }
  r.samples.push({ t: now(), usedHeapMB, note });
  if (r.samples.length > 100) {
    r.samples.splice(0, r.samples.length - 100);
  }
  persist();
}

/** Call when a video seek lookback begins (after any wait for a concurrency slot). */
export function rei125LookbackStart(waitedMs: number = 0): void {
  const r = ensureReport();
  if (!r) {
    return;
  }
  lookbackActive += 1;
  r.counters.lookbackStart += 1;
  r.counters.lookbackWaitMsTotal += waitedMs;
  r.counters.lookbackMaxConcurrent = Math.max(r.counters.lookbackMaxConcurrent, lookbackActive);
  persist();
}

export function rei125LookbackEnd(): void {
  const r = ensureReport();
  if (!r) {
    return;
  }
  lookbackActive = Math.max(0, lookbackActive - 1);
  r.counters.lookbackEnd += 1;
  persist();
}

/** Call when a gated lookback range read begins (after any wait for a concurrency slot). */
export function rei125LookbackReadStart(waitedMs: number = 0): void {
  const r = ensureReport();
  if (!r) {
    return;
  }
  lookbackReadActive += 1;
  r.counters.lookbackReadStart += 1;
  r.counters.lookbackReadWaitMsTotal += waitedMs;
  r.counters.lookbackReadMaxConcurrent = Math.max(
    r.counters.lookbackReadMaxConcurrent,
    lookbackReadActive,
  );
  persist();
}

export function rei125LookbackReadEnd(): void {
  const r = ensureReport();
  if (!r) {
    return;
  }
  lookbackReadActive = Math.max(0, lookbackReadActive - 1);
  r.counters.lookbackReadEnd += 1;
  persist();
}

export function rei125StBuild(durationMs: number): void {
  const r = ensureReport();
  if (!r) {
    return;
  }
  r.counters.stBuildCount += 1;
  r.counters.stBuildMsTotal += durationMs;
  r.counters.stBuildMsMax = Math.max(r.counters.stBuildMsMax, durationMs);
  persist();
}

export function rei125BlockLoadSpan(): void {
  const r = ensureReport();
  if (!r) {
    return;
  }
  r.counters.blockLoadSpanCount += 1;
  persist();
}

export function rei125GetReport(): Rei125PerfReport | undefined {
  return report;
}

export function rei125SetLabel(label: string): void {
  const r = ensureReport();
  if (!r) {
    return;
  }
  r.label = label;
  persist();
}
