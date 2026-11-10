// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import path from "path";

import { launchApp } from "./launchApp";
import { createEmptyLayout } from "../../web/integration-test/reactUpgradeExtension";

// Exercise production root activation and disposal with a real paused player. This bag does not
// establish image/3D/GPS data correctness, or live service, teleop, and data-collection behavior.
it("mounts, seeks, closes, and reopens each built-in extension panel", async () => {
  await using app = await launchApp();
  const page = app.renderer;
  await page.setViewportSize({ width: 1280, height: 900 });
  await createEmptyLayout(page);
  await page
    .locator("[data-puppeteer-file-upload]")
    .setInputFiles(
      path.resolve(__dirname, "../../packages/studio-base/src/test/fixtures/example.bag"),
    );
  await page.waitForSelector("#play-pause-button:not([disabled])");

  for (const name of [
    "3D",
    "Image",
    "Map",
    "Gauge",
    "Indicator",
    "Service Call",
    "Teleop",
    "Data Collection",
  ]) {
    for (let cycle = 0; cycle < 2; cycle++) {
      await page.locator("#add-panel-button").click();
      await page.getByTestId(`panel-menu-item ${name}`).click();
      const panel = page.locator('[data-testid^="panel-mouseenter-container"]');
      await panel.waitFor();
      // A toolbar alone would also appear when a deferred independent root never commits.
      if (name === "3D" || name === "Image") {
        await panel.locator("canvas").waitFor();
        await page.waitForFunction(() => {
          const canvas = document.querySelector<HTMLCanvasElement>(
            '[data-testid^="panel-mouseenter-container"] canvas',
          );
          return canvas != undefined && canvas.width > 0 && canvas.height > 0;
        });
      } else if (name === "Gauge") {
        await panel.locator('clipPath[id^="gauge-clip-path-"]').waitFor({ state: "attached" });
      } else if (name === "Indicator") {
        await panel.locator("h1").waitFor();
      } else if (name === "Map") {
        await panel.getByText("Waiting for first GPS point…", { exact: true }).waitFor();
      } else if (name === "Service Call") {
        await panel.getByTestId("call-service-button").waitFor();
        expect(await panel.getByTestId("call-service-button").isDisabled()).toBe(true);
      } else if (name === "Teleop") {
        await panel
          .getByText("Connect to a data source that supports publishing", { exact: true })
          .waitFor();
      } else {
        await panel
          .getByText(
            /This panel only supports real-time visualization|Please login to use this panel/,
          )
          .waitFor();
      }

      const time = page.getByTestId("PlaybackTime-text").locator("input");
      const before = await time.inputValue();
      const bounds = await page.getByTestId("scrubber-slider").boundingBox();
      if (!bounds) {
        throw new Error(`Playback scrubber has no bounds while testing ${name}`);
      }
      const ratio = cycle === 0 ? 0.25 : 0.75;
      await page.mouse.click(bounds.x + bounds.width * ratio, bounds.y + bounds.height / 2);
      await page.waitForFunction((previous) => {
        const value = document.querySelector<HTMLInputElement>(
          '[data-testid="PlaybackTime-text"] input',
        )?.value;
        return value != undefined && value !== previous;
      }, before);
      expect(await panel.getByText(/This panel has encountered an error/).count()).toBe(0);
      await panel.getByTestId("panel-menu").click();
      await page.getByTestId("panel-menu-remove").click();
      await panel.waitFor({ state: "detached" });
      await page.getByTestId("panel-menu-remove").waitFor({ state: "detached" });
    }
  }
  // launchApp's awaited disposer also fails on renderer console errors and uncaught exceptions.
}, 180_000);
