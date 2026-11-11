// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { mkdir, writeFile } from "fs/promises";
import path from "path";

import { launchApp } from "./launchApp";
import { addFixturePanel, installFixture } from "../../web/integration-test/reactUpgradeExtension";

declare global {
  interface Window {
    reactUpgradeFileInputAt?: number;
  }
}

// One generated React 19 panel on both hosts keeps the panel workload constant while measuring
// actual host-driven data commits. These are panel callbacks, not display refresh-rate samples.
it("measures fixed-bag first data commit, seek latency, and playback commit rate", async () => {
  const results = [];
  for (let run = 0; run < 3; run++) {
    await using app = await launchApp();
    const page = app.renderer;
    await page.setViewportSize({ width: 1280, height: 900 });
    await installFixture(page);
    await addFixturePanel(page);
    const startedAt = await page.evaluate(() => {
      window.reactUpgradeFileInputAt = undefined;
      const onFileChange = (event: Event) => {
        const target = event.target;
        if (
          target instanceof HTMLInputElement &&
          target.matches("[data-puppeteer-file-upload]") &&
          target.files?.[0]?.name === "example.bag"
        ) {
          window.reactUpgradeFileInputAt = performance.now();
          document.removeEventListener("change", onFileChange, true);
        }
      };
      document.addEventListener("change", onFileChange, true);
      return performance.now();
    });
    await page
      .locator("[data-puppeteer-file-upload]")
      .setInputFiles(
        path.resolve(__dirname, "../../packages/studio-base/src/test/fixtures/example.bag"),
      );
    await page.waitForFunction(() =>
      window.reactUpgradeEvents.some(
        (event) =>
          event.type === "done" && event.currentTime != undefined && (event.messages ?? 0) > 0,
      ),
    );
    const firstData = await page.evaluate((start) => {
      const committed = window.reactUpgradeEvents.find(
        (event) =>
          event.type === "done" && event.currentTime != undefined && (event.messages ?? 0) > 0,
      );
      const inputAt = window.reactUpgradeFileInputAt;
      if (committed == undefined || inputAt == undefined) {
        throw new Error("Missing file-input event or first committed message");
      }
      return {
        // Preserve the original end-to-end metric, including Playwright's setInputFiles overhead.
        firstDataMs: committed.at - start,
        fileSelectionOverheadMs: inputAt - start,
        inputToFirstDataMs: committed.at - inputAt,
      };
    }, startedAt);
    await page.waitForSelector("#play-pause-button:not([disabled])");
    const seekMs: number[] = [];
    for (const ratio of [0.25, 0.75, 0.5]) {
      const before = await page.evaluate(() => ({
        at: performance.now(),
        time: [...window.reactUpgradeEvents].reverse().find((event) => event.type === "done")
          ?.currentTime,
      }));
      const slider = page.getByTestId("scrubber-slider");
      const bounds = await slider.boundingBox();
      if (!bounds) {
        throw new Error("Playback scrubber has no bounds");
      }
      await page.mouse.click(bounds.x + bounds.width * ratio, bounds.y + bounds.height / 2);
      await page.waitForFunction(
        ({ at, time }) =>
          window.reactUpgradeEvents.some(
            (event) =>
              event.type === "done" &&
              event.at > at &&
              event.currentTime != undefined &&
              event.currentTime !== time,
          ),
        before,
      );
      seekMs.push(
        await page.evaluate(
          ({ at, time }) =>
            window.reactUpgradeEvents.find(
              (event) =>
                event.type === "done" &&
                event.at > at &&
                event.currentTime != undefined &&
                event.currentTime !== time,
            )!.at - at,
          before,
        ),
      );
    }
    const playbackStarted = await page.evaluate(() => performance.now());
    await page.locator("#play-pause-button").click();
    await page.waitForTimeout(5_000);
    await page.locator("#play-pause-button").click();
    const playback = await page.evaluate((start) => {
      const end = performance.now();
      const events = window.reactUpgradeEvents.filter(
        (event) => event.type === "done" && event.at >= start && event.currentTime != undefined,
      );
      const commits = events.filter(
        (event, index) => index === 0 || event.currentTime !== events[index - 1]?.currentTime,
      );
      return {
        elapsedMs: end - start,
        panelCommits: commits.length,
        commitsPerSecond: (commits.length * 1_000) / (end - start),
      };
    }, playbackStarted);
    expect(playback.panelCommits).toBeGreaterThan(1);
    results.push({ run: run + 1, ...firstData, seekMs, ...playback });
  }
  const output = path.resolve(
    process.env.HONEYBEE_REACT_BENCHMARK_OUTPUT ?? "temp/react19-benchmark.json",
  );
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(
    output,
    JSON.stringify(
      {
        label: process.env.HONEYBEE_REACT_BENCHMARK_LABEL ?? "current",
        appPath:
          process.env.HONEYBEE_REACT_BENCHMARK_APP_DIR ?? path.resolve(__dirname, "../.webpack"),
        fixture: "example.bag",
        panel: "generator React 19 fixture (same package on both hosts)",
        viewport: { width: 1280, height: 900 },
        results,
      },
      undefined,
      2,
    )!,
  );
}, 240_000);
