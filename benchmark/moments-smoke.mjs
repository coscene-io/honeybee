// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

// Usage: node benchmark/moments-smoke.mjs URL output-directory [--soak]
const [url, directory, soak] = process.argv.slice(2);
if (!url || !directory) {
  throw new Error("Provide URL and output directory");
}
await mkdir(directory, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const result = { errors: [], snapshots: [], soak: [] };
  page.on("pageerror", (error) => result.errors.push(error.message));
  await page.goto(`${url}/?count=12&distribution=continuous&extras=true`);
  const ticks = page.getByTestId("timeline-event");
  await ticks.first().waitFor();
  await page.waitForTimeout(400);
  assert.equal(await ticks.count(), 12);
  result.geometry = await ticks.evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        name: node.textContent,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        background: style.backgroundColor,
        border: style.border,
        padding: style.padding,
        descendants: [...node.querySelectorAll("*")].map((child) => {
          const box = child.getBoundingClientRect();
          const css = getComputedStyle(child);
          return {
            width: box.width,
            height: box.height,
            boxSizing: css.boxSizing,
            opacity: css.opacity,
          };
        }),
      };
    }),
  );
  const screenshot = async (name) => {
    await page.screenshot({ path: path.join(directory, `${name}.png`) });
    result.snapshots.push(name);
  };
  await screenshot("initial");
  await page.getByPlaceholder("Search moment").fill("Moment 9");
  await page.waitForTimeout(150);
  assert.equal(await page.getByTestId("sidebar-event").count(), 1);
  await screenshot("search");
  await page.getByPlaceholder("Search moment").fill("");
  const summary = page.locator(".MuiAccordionSummary-root").first();
  await summary.click();
  await page.waitForTimeout(300);
  assert.equal(await summary.getAttribute("aria-expanded"), "false");
  await summary.click();
  await page.getByTestId("sidebar-event").first().waitFor();
  const slider = await page.getByTestId("scrubber-slider").boundingBox();
  assert.ok(slider);
  await page.mouse.click(slider.x + 40, slider.y + 1, { button: "right" });
  await page.waitForTimeout(100);
  result.menuItems = await page.getByRole("menuitem").allTextContents();
  await screenshot("menu");
  await page.keyboard.press("Escape");
  if (soak === "--soak") {
    await page.goto(`${url}/?count=1000&distribution=short&extras=true`);
    await ticks.first().waitFor();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    const replace = async (count) => {
      await page.evaluate((next) => {
        history.replaceState(undefined, "", `/?count=${next}&distribution=short&extras=true`);
        dispatchEvent(new PopStateEvent("popstate"));
      }, count);
      await page.getByText(`${count} moments / short`, { exact: true }).waitFor();
      await page.waitForTimeout(100);
    };
    for (let index = 0; index < 12; index++) {
      await replace(5000 + index);
      const box = await page.getByTestId("timeline-content").boundingBox();
      assert.ok(box);
      await page.mouse.move(box.x + box.width / 2, box.y + 1);
      await page.keyboard.down("Control");
      await page.mouse.wheel(0, -10);
      await page.keyboard.up("Control");
      await page.mouse.move(1340, 400);
      await page.mouse.wheel(0, 300);
      await replace(1000);
      await page.mouse.move(1, 1);
      await cdp.send("HeapProfiler.collectGarbage");
      const { metrics } = await cdp.send("Performance.getMetrics");
      result.soak.push(
        Object.fromEntries(
          metrics
            .filter(({ name }) =>
              ["JSHeapUsedSize", "Nodes", "JSEventListeners", "Documents"].includes(name),
            )
            .map(({ name, value }) => [name, value]),
        ),
      );
    }
  }
  assert.deepEqual(result.errors, []);
  await writeFile(path.join(directory, "smoke.json"), JSON.stringify(result, undefined, 2));
  process.stdout.write(
    `${JSON.stringify({ errors: result.errors, menuItems: result.menuItems, soak: result.soak })}\n`,
  );
} finally {
  await browser.close();
}
