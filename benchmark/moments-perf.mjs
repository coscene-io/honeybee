// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// Usage: node benchmark/moments-perf.mjs http://localhost:8765 output.json [cpuRate]
// Timing is an input-to-two-rAF proxy, not a hardware presentation timestamp.
import { writeFile } from "node:fs/promises";
import os from "node:os";
import { chromium } from "playwright";

const [baseUrl, output, cpuRate = "1"] = process.argv.slice(2);
if (!baseUrl || !output) {
  throw new Error("Provide base URL and JSON output path");
}
const browser = await chromium.launch({ headless: true });
const report = {
  browser: browser.version(),
  cpu: os.cpus()[0]?.model,
  cpuRate: Number(cpuRate),
  generatedAt: new Date().toISOString(),
  steps: Number(process.env.MOMENT_STEPS ?? 70),
  caseTimeoutMs: Number(process.env.MOMENT_TIMEOUT_MS ?? 180000),
  viewport: { width: 1440, height: 900 },
  results: [],
};
const counts = process.env.MOMENT_COUNTS?.split(",").map(Number) ?? [1000, 5000, 21600];
const distributions = process.env.MOMENT_DISTRIBUTIONS?.split(",") ?? [
  "short",
  "continuous",
  "overlapping",
  "long",
];
for (const count of counts) {
  for (const distribution of distributions) {
    for (const extras of [false, true]) {
      const page = await browser.newPage({ viewport: report.viewport });
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: report.cpuRate });
      const result = { count, distribution, extras, errors: [], phases: {} };
      page.on("pageerror", (error) => result.errors.push(error.message));
      const timeout = setTimeout(() => {
        result.timeout = true;
        void page.close().catch(() => {});
      }, report.caseTimeoutMs);
      try {
        const started = performance.now();
        await page.goto(
          `${baseUrl}/?count=${count}&distribution=${distribution}&extras=${extras}`,
          { timeout: 90000 },
        );
        await page.locator('[data-testid="timeline-event"]').first().waitFor({ timeout: 90000 });
        result.mountMs = performance.now() - started;
        await page.waitForTimeout(400);
        result.dom = await page.evaluate(() => ({
          total: document.querySelectorAll("*").length,
          ticks: document.querySelectorAll('[data-testid="timeline-event"]').length,
          listRows: document.querySelectorAll('[data-testid="sidebar-event"]').length,
        }));
        const measure = async (name, action) => {
          await page.evaluate(() => {
            const state = { frames: [], latency: [], longTasks: [], running: true };
            const tick = (time) => {
              state.frames.push(time);
              if (state.running) {
                requestAnimationFrame(tick);
              }
            };
            requestAnimationFrame(tick);
            const input = () => {
              const start = performance.now();
              requestAnimationFrame(() =>
                requestAnimationFrame(() => {
                  state.latency.push(performance.now() - start);
                }),
              );
            };
            const observer = new PerformanceObserver((entries) => {
              state.longTasks.push(...entries.getEntries().map((entry) => entry.duration));
            });
            observer.observe({ type: "longtask" });
            for (const type of ["pointermove", "wheel", "pointerup"]) {
              window.addEventListener(type, input, true);
            }
            window.momentMeasurement = {
              state,
              stop() {
                state.running = false;
                observer.disconnect();
                for (const type of ["pointermove", "wheel", "pointerup"]) {
                  window.removeEventListener(type, input, true);
                }
              },
            };
          });
          await action();
          await page.waitForTimeout(80);
          result.phases[name] = await page.evaluate(() => {
            const { state, stop } = window.momentMeasurement;
            stop();
            const percentile = (values, p) =>
              values.toSorted((a, b) => a - b)[
                Math.min(values.length - 1, Math.floor(values.length * p))
              ] ?? 0;
            const intervals = state.frames
              .slice(1)
              .map((time, index) => time - state.frames[index]);
            return {
              fps: ((state.frames.length - 1) * 1000) / (state.frames.at(-1) - state.frames[0]),
              inputP95Ms: percentile(state.latency, 0.95),
              frameP95Ms: percentile(intervals, 0.95),
              maxLongTaskMs: Math.max(0, ...state.longTasks),
              samples: state.latency.length,
            };
          });
        };
        const rect = await page.locator('[data-testid="timeline-content"]').boundingBox();
        if (!rect) {
          throw new Error("Missing timeline geometry");
        }
        const y = Math.min(895, rect.y + 10);
        await measure("hover", async () => {
          for (let i = 0; i < report.steps; i++) {
            await page.mouse.move(rect.x + 10 + ((rect.width - 20) * i) / report.steps, y);
            await page.waitForTimeout(10);
          }
        });
        await measure("zoom", async () => {
          await page.keyboard.down("Control");
          for (let i = 0; i < 3; i++) {
            await page.mouse.wheel(0, -30);
            await page.waitForTimeout(16);
          }
          await page.keyboard.up("Control");
        });
        const event = page.locator('[data-testid="timeline-event"]').first();
        const eventRect = await event.boundingBox();
        if (eventRect && eventRect.y < 900) {
          await measure("drag", async () => {
            const x = Math.max(5, Math.min(1420, eventRect.x + eventRect.width / 2));
            const ey = Math.max(0, Math.min(895, eventRect.y + 12));
            await page.mouse.move(x, ey);
            await page.mouse.down();
            for (let i = 0; i < 40; i++) {
              await page.mouse.move(Math.min(1430, x + i * 2), ey);
              await page.waitForTimeout(10);
            }
            await page.mouse.up();
          });
        }
        await measure("playback", async () => {
          await page.getByRole("button", { name: "Toggle playback" }).click();
          await page.waitForTimeout(600);
          await page.getByRole("button", { name: "Toggle playback" }).click();
        });
        if (extras) {
          await measure("listScroll", async () => {
            await page.mouse.move(1340, 400);
            for (let i = 0; i < 20; i++) {
              await page.mouse.wheel(0, 120);
              await page.waitForTimeout(16);
            }
          });
        }
      } catch (error) {
        result.failure = String(error);
      }
      clearTimeout(timeout);
      report.results.push(result);
      await writeFile(output, JSON.stringify(report, undefined, 2));
      process.stdout.write(`${JSON.stringify(result)}\n`);
      await page.close();
    }
  }
}
await browser.close();
