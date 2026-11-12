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
    react19ResourceHostNodes: { kind: string; node: WeakRef<HTMLElement> }[];
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
  attachedDocumentNodes: number;
  retainedHostNodes: Record<string, number>;
};

async function sampleResources(
  page: Page,
  cdp: CDPSession,
  completedCycles: number,
): Promise<ResourceSample> {
  // Allow React's deferred cleanup and the menu's exit transition to finish before collecting.
  await page.getByTestId("panel-menu-remove").waitFor({ state: "detached" });
  const collectionDeadline = Date.now() + 2_000;
  do {
    await cdp.send("HeapProfiler.collectGarbage");
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });
    await cdp.send("HeapProfiler.collectGarbage");
    if (
      await page.evaluate(
        () =>
          window.react19ResourceNodes.every((node) => node.deref() == undefined) &&
          window.react19ResourceHostNodes.every(
            ({ kind, node }) => kind !== "host-panel" || node.deref() == undefined,
          ),
      )
    ) {
      break;
    }
  } while (Date.now() < collectionDeadline);
  const heap = await cdp.send("Runtime.getHeapUsage");
  const dom = await cdp.send("Memory.getDOMCounters");
  const fixture = await page.evaluate(() => {
    // Weak references make detached, still-retained panel DOM observable without retaining it
    // ourselves. Discard collected entries so the measurement machinery stays bounded too.
    window.react19ResourceNodes = window.react19ResourceNodes.filter(
      (reference) => reference.deref() != undefined,
    );
    window.react19ResourceHostNodes = window.react19ResourceHostNodes.filter(
      ({ node }) => node.deref() != undefined,
    );
    const retainedHostNodes: Record<string, number> = {};
    for (const { kind } of window.react19ResourceHostNodes) {
      retainedHostNodes[kind] = (retainedHostNodes[kind] ?? 0) + 1;
    }
    return {
      retainedFixtureNodes: window.react19ResourceNodes.length,
      attachedFixtureNodes: document.querySelectorAll('[data-testid="react-upgrade-extension"]')
        .length,
      attachedDocumentNodes: document.querySelectorAll("*").length,
      retainedHostNodes,
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
    window.react19ResourceHostNodes = [];
    // Observe the two transient menus too: detached host UI must not be mistaken for retained
    // extension roots. Only weak references survive the observer callback.
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.removedNodes) {
          if (!(node instanceof HTMLElement)) {
            continue;
          }
          if (node.querySelector('[data-testid^="panel-menu-item "]')) {
            window.react19ResourceHostNodes.push({ kind: "add-menu", node: new WeakRef(node) });
          } else if (node.querySelector('[data-testid="panel-menu-remove"]')) {
            window.react19ResourceHostNodes.push({ kind: "remove-menu", node: new WeakRef(node) });
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
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
        const host = panel.closest<HTMLElement>('[data-testid^="panel-mouseenter-container"]');
        if (!host) {
          throw new Error("Fixture panel has no host panel container");
        }
        window.react19ResourceHostNodes.push({ kind: "host-panel", node: new WeakRef(host) });
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
        expect(sample.retainedHostNodes["host-panel"] ?? 0).toBe(0);
        // Heap snapshots show one latest useModal.modalRef snapshot; the latest action menu is
        // only weakly reachable. Earlier menus must collect, without a heap-size threshold.
        for (const kind of ["add-menu", "remove-menu"]) {
          expect(sample.retainedHostNodes[kind] ?? 0).toBeLessThanOrEqual(1);
        }
      }
    }
  } finally {
    const heapSnapshot = process.env.HONEYBEE_REACT_RESOURCE_HEAP_SNAPSHOT;
    if (heapSnapshot) {
      const chunks: string[] = [];
      const onChunk = ({ chunk }: { chunk: string }) => {
        chunks.push(chunk);
      };
      cdp.on("HeapProfiler.addHeapSnapshotChunk", onChunk);
      try {
        await cdp.send("HeapProfiler.takeHeapSnapshot");
        await mkdir(path.dirname(path.resolve(heapSnapshot)), { recursive: true });
        await writeFile(heapSnapshot, chunks.join(""));
      } finally {
        cdp.off("HeapProfiler.addHeapSnapshotChunk", onChunk);
      }
    }
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
          note: "Renderer-wide heap/DOM metrics are observations, not an uncalibrated leak threshold. Fixture and host panel DOM collection, bounded menu retention, and lifecycle cleanup are asserted.",
        },
        undefined,
        2,
      )!,
    );
    await cdp.detach();
  }
}, 240_000);
