// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { CDPSession, Page } from "playwright";

import { launchApp } from "./launchApp";
import {
  addFixturePanel,
  installFixture,
  removeFixturePanel,
} from "../../web/integration-test/reactUpgradeExtension";

declare global {
  interface Window {
    react19ResourceNodes: WeakRef<HTMLElement>[];
  }
}

type ResourceSample = {
  completedCycles: number;
  usedJSHeapBytes: number;
  totalJSHeapBytes: number;
  documents: number;
  nodes: number;
  jsEventListeners: number;
  retainedFixtureNodes: number;
  attachedFixtureNodes: number;
};

async function sampleResources(
  page: Page,
  cdp: CDPSession,
  completedCycles: number,
): Promise<ResourceSample> {
  // Allow React's deferred cleanup and the menu's exit transition to finish before collecting.
  await page.getByTestId("panel-menu-remove").waitFor({ state: "detached" });
  await cdp.send("HeapProfiler.collectGarbage");
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });
  await cdp.send("HeapProfiler.collectGarbage");
  const heap = await cdp.send("Runtime.getHeapUsage");
  const dom = await cdp.send("Memory.getDOMCounters");
  const fixture = await page.evaluate(() => {
    // Weak references make detached, still-retained panel DOM observable without retaining it
    // ourselves. Discard collected entries so the measurement machinery stays bounded too.
    window.react19ResourceNodes = window.react19ResourceNodes.filter(
      (reference) => reference.deref() != undefined,
    );
    return {
      retainedFixtureNodes: window.react19ResourceNodes.length,
      attachedFixtureNodes: document.querySelectorAll('[data-testid="react-upgrade-extension"]')
        .length,
    };
  });
  return {
    completedCycles,
    usedJSHeapBytes: heap.usedSize,
    totalJSHeapBytes: heap.totalSize,
    documents: dom.documents,
    nodes: dom.nodes,
    jsEventListeners: dom.jsEventListeners,
    ...fixture,
  };
}

it("releases panel roots across repeated close/reopen cycles and records resource growth", async () => {
  const warmupCycles = 2;
  const measuredCycles = 12;
  const lifecycleCounts = [];
  const samples: ResourceSample[] = [];
  const output = path.resolve(
    process.env.HONEYBEE_REACT_RESOURCE_OUTPUT ?? "temp/react19-resources.json",
  );
  await using app = await launchApp();
  const page = app.renderer;
  await page.setViewportSize({ width: 1280, height: 900 });
  await installFixture(page);
  await page.evaluate(() => {
    window.react19ResourceNodes = [];
  });
  // Keep a real, paused data source loaded so each mounted panel also acquires subscriptions.
  await page
    .locator("[data-puppeteer-file-upload]")
    .setInputFiles(
      path.resolve(__dirname, "../../packages/studio-base/src/test/fixtures/example.bag"),
    );
  await page.waitForSelector("#play-pause-button:not([disabled])");
  const cdp = await page.context().newCDPSession(page);
  try {
    for (let cycle = 1; cycle <= warmupCycles + measuredCycles; cycle++) {
      await addFixturePanel(page);
      await page.waitForFunction(() =>
        window.reactUpgradeEvents.some(
          (event) => event.type === "done" && (event.messages ?? 0) > 0,
        ),
      );
      await page.evaluate(() => {
        const panel = document.querySelector<HTMLElement>(
          '[data-testid="react-upgrade-extension"]',
        );
        const rootContainer = panel?.parentElement;
        if (!panel || !rootContainer) {
          throw new Error("Fixture panel is not mounted in its root container");
        }
        window.react19ResourceNodes.push(new WeakRef(panel), new WeakRef(rootContainer));
      });
      await removeFixturePanel(page);
      await page.waitForFunction(() =>
        window.reactUpgradeEvents.some((event) => event.type === "cleanup"),
      );
      const events = await page.evaluate(() => {
        const result = window.reactUpgradeEvents;
        // Event history must not become the very resource growth that this test measures.
        window.reactUpgradeEvents = [];
        return result;
      });
      const counts = {
        cycle,
        phase: cycle <= warmupCycles ? "warmup" : "measured",
        init: events.filter((event) => event.type === "init").length,
        mount: events.filter((event) => event.type === "mount").length,
        effectCleanup: events.filter((event) => event.type === "effect-cleanup").length,
        cleanup: events.filter((event) => event.type === "cleanup").length,
        renders: events.filter((event) => event.type === "render").length,
        done: events.filter((event) => event.type === "done").length,
      };
      lifecycleCounts.push(counts);
      expect(counts).toMatchObject({ init: 1, mount: 1, effectCleanup: 1, cleanup: 1 });
      expect(counts.done).toBeGreaterThan(0);
      expect(
        events.filter((event) => event.type === "render").map((event) => event.sequence),
      ).toEqual(events.filter((event) => event.type === "done").map((event) => event.sequence));
      expect(events.at(-1)?.type).toBe("cleanup");
      expect(await page.getByTestId("react-upgrade-extension").count()).toBe(0);
      const completedCycles = cycle - warmupCycles;
      if (completedCycles >= 0 && completedCycles % 4 === 0) {
        const sample = await sampleResources(page, cdp, completedCycles);
        samples.push(sample);
        expect(sample.attachedFixtureNodes).toBe(0);
        expect(sample.retainedFixtureNodes).toBe(0);
      }
    }
  } finally {
    const first = samples[0];
    const last = samples.at(-1);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(
      output,
      JSON.stringify(
        {
          label: process.env.HONEYBEE_REACT_RESOURCE_LABEL ?? "current",
          appPath:
            process.env.HONEYBEE_REACT_BENCHMARK_APP_DIR ?? path.resolve(__dirname, "../.webpack"),
          fixture: "example.bag",
          warmupCycles,
          measuredCycles,
          viewport: { width: 1280, height: 900 },
          lifecycleCounts,
          samples,
          growth:
            first && last
              ? {
                  usedJSHeapBytes: last.usedJSHeapBytes - first.usedJSHeapBytes,
                  nodes: last.nodes - first.nodes,
                  jsEventListeners: last.jsEventListeners - first.jsEventListeners,
                }
              : undefined,
          note: "Renderer-wide heap/DOM metrics are observations, not an uncalibrated leak threshold. Fixture DOM collection and lifecycle cleanup are asserted.",
        },
        undefined,
        2,
      )!,
    );
    await cdp.detach();
  }
}, 240_000);
