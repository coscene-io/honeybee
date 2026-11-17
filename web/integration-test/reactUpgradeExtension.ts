// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { existsSync } from "fs";
import path from "path";
import { Page } from "playwright";

type FixtureEvent = {
  type: "init" | "mount" | "render" | "done" | "effect-cleanup" | "cleanup";
  instance: number;
  at: number;
  reactVersion: string;
  sequence?: number;
  currentTime?: number;
  messages?: number;
};

declare global {
  interface Window {
    reactUpgradeEvents: FixtureEvent[];
  }
}

async function recordFixtureEvents(page: Page): Promise<void> {
  const initialize = () => {
    window.reactUpgradeEvents = [];
    document.addEventListener("honeybee-react-fixture", (event) => {
      window.reactUpgradeEvents.push((event as CustomEvent<FixtureEvent>).detail);
    });
  };
  await page.addInitScript(initialize);
  await page.evaluate(initialize);
}

export async function createEmptyLayout(page: Page): Promise<void> {
  // Fresh profiles open this drawer once layout storage has initialized. Waiting for it avoids
  // racing a click on the underlying empty-state link against the drawer opening.
  await page.getByText("Create blank layout", { exact: true }).waitFor();
  const dialog = page.getByTestId("DataSourceDialog");
  if (await dialog.isVisible()) {
    // The layout drawer can initially sit above the data-source dialog. Close that overlay first.
    if (await page.getByText("Create blank layout", { exact: true }).isVisible()) {
      await page.keyboard.press("Escape");
      await page.getByText("Create blank layout", { exact: true }).waitFor({ state: "hidden" });
    }
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
  }
  const blankLayout = page.getByText("Create blank layout", { exact: true });
  if (await blankLayout.isVisible()) {
    await blankLayout.click();
    const createDialog = page.getByRole("dialog");
    await createDialog.getByRole("textbox", { name: "Layout name" }).fill("React upgrade test");
    await createDialog.getByRole("button", { name: "OK", exact: true }).click();
  } else {
    const newLayout = page.getByText("Create a new layout", { exact: true });
    if (await newLayout.isVisible()) {
      await newLayout.click();
    }
  }
  await page.waitForSelector("#add-panel-button:not([disabled])");
}

export async function installFixture(page: Page): Promise<void> {
  const fixture =
    process.env.HONEYBEE_REACT_EXTENSION_FIXTURE ??
    path.resolve(__dirname, "../../temp/react19-extension/fixture.coe");
  if (!existsSync(fixture)) {
    throw new Error(
      "Build the real fixture first: node ci/react19/build-extension-fixture.cjs /path/to/generator.tgz",
    );
  }
  await recordFixtureEvents(page);
  await createEmptyLayout(page);
  await page.locator("[data-puppeteer-file-upload]").setInputFiles(fixture);
  await page.getByText(/Installed extension/).waitFor();
}

export async function addFixturePanel(page: Page): Promise<void> {
  await page.locator("#add-panel-button").click();
  await page.getByTestId("panel-menu-item example-panel").click();
  await page.getByTestId("react-upgrade-extension").waitFor();
  await page.waitForFunction(() => {
    const instance = window.reactUpgradeEvents
      .filter((event) => event.type === "init")
      .at(-1)?.instance;
    return window.reactUpgradeEvents.some(
      (event) => event.type === "done" && event.instance === instance,
    );
  });
}

export async function removeFixturePanel(page: Page): Promise<void> {
  const panel = page
    .getByTestId("react-upgrade-extension")
    .locator("xpath=ancestor::*[contains(@data-testid, 'panel-mouseenter-container')]");
  await panel.getByTestId("panel-menu").click();
  await page.getByTestId("panel-menu-remove").click();
  await page.getByTestId("react-upgrade-extension").waitFor({ state: "detached" });
}

async function verifySavedStateAfterReload(page: Page): Promise<void> {
  await addFixturePanel(page);
  await page.getByTestId("fixture-increment").click();
  await page.getByTestId("fixture-increment").getByText("Clicks: 1", { exact: true }).waitFor();
  // Layout saving is debounced. Observe its durable write instead of sleeping a guessed interval.
  await page.evaluate(async () => {
    const readSavedState = async () =>
      await new Promise<boolean>((resolve, reject) => {
        const open = indexedDB.open("coScene-layouts");
        open.onerror = () => {
          reject(open.error ?? new Error("Could not open layout database"));
        };
        open.onsuccess = () => {
          const db = open.result;
          const read = db.transaction("layouts", "readonly").objectStore("layouts").getAll();
          read.onerror = () => {
            db.close();
            reject(read.error ?? new Error("Could not read persisted layouts"));
          };
          read.onsuccess = () => {
            type LayoutData = { configById?: Record<string, { clicks?: number }> };
            const records = read.result as {
              layout: { working?: { data: LayoutData }; baseline: { data: LayoutData } };
            }[];
            const saved = records.some(({ layout }) =>
              Object.entries((layout.working ?? layout.baseline).data.configById ?? {}).some(
                ([id, config]) => id.includes("react-upgrade-fixture") && config.clicks === 1,
              ),
            );
            db.close();
            resolve(saved);
          };
        };
      });
    const deadline = performance.now() + 10_000;
    while (!(await readSavedState())) {
      if (performance.now() > deadline) {
        throw new Error("Extension state was not written to layout storage");
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 50);
      });
    }
  });
  await page.reload();
  await page.getByTestId("react-upgrade-extension").waitFor();
  expect(await page.getByTestId("fixture-react-version").textContent()).toBe("19.3.1");
  await page.getByTestId("fixture-increment").getByText("Clicks: 1", { exact: true }).waitFor();
  const startupDialog = page.getByTestId("DataSourceDialog");
  if (await startupDialog.isVisible()) {
    await page.keyboard.press("Escape");
    await startupDialog.waitFor({ state: "hidden" });
  }
  await removeFixturePanel(page);
  await page.waitForFunction(() =>
    window.reactUpgradeEvents.some((event) => event.type === "cleanup"),
  );
  await page.evaluate(() => {
    window.reactUpgradeEvents = [];
  });
}

export async function exerciseExtensionLifecycle(page: Page): Promise<void> {
  await installFixture(page);
  await verifySavedStateAfterReload(page);
  for (let cycle = 1; cycle <= 2; cycle++) {
    await addFixturePanel(page);
    expect(await page.getByTestId("fixture-react-version").textContent()).toBe("19.3.1");
    expect(await page.getByTestId("fixture-increment").textContent()).toBe("Clicks: 0");
    await page.getByTestId("fixture-increment").click();
    await page.getByTestId("fixture-increment").getByText("Clicks: 1", { exact: true }).waitFor();
    await removeFixturePanel(page);
    await page.waitForFunction(
      (count) =>
        window.reactUpgradeEvents.filter((event) => event.type === "cleanup").length === count,
      cycle,
    );
  }
  const events = await page.evaluate(() => window.reactUpgradeEvents);
  expect(events.filter((event) => event.type === "init")).toHaveLength(2);
  expect(events.filter((event) => event.type === "mount")).toHaveLength(2);
  expect(events.filter((event) => event.type === "effect-cleanup")).toHaveLength(2);
  for (const init of events.filter((event) => event.type === "init")) {
    const instance = events.filter((event) => event.instance === init.instance);
    expect(instance.filter((event) => event.type === "done").length).toBeGreaterThan(0);
    expect(
      instance.filter((event) => event.type === "render").map((event) => event.sequence),
    ).toEqual(instance.filter((event) => event.type === "done").map((event) => event.sequence));
    expect(instance.at(-1)?.type).toBe("cleanup");
  }
}
