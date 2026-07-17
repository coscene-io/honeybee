// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import http from "http";
import { AddressInfo } from "net";
import path from "path";
import { Browser, BrowserContext, Page, chromium } from "playwright";
import serveHandler from "serve-handler";

const BLANK_PAGE_PATH = "/__indexeddb_test_blank__";
const EXTENSION_ORG_DB = "foxglove-extensions-org";
const EXTENSION_LOCAL_DB = "foxglove-extensions-local";

async function waitFor(
  condition: () => Promise<boolean>,
  description: string,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function databaseExists(page: Page, databaseName: string): Promise<boolean> {
  return await page.evaluate(
    async (name) => (await indexedDB.databases()).some((database) => database.name === name),
    databaseName,
  );
}

async function requestDatabaseUpgrade(
  page: Page,
  databaseName: string,
  version: number,
): Promise<"succeeded" | "blocked" | "failed"> {
  return await page.evaluate(
    async ({ name, requestedVersion }) =>
      await new Promise<"succeeded" | "blocked" | "failed">((resolve) => {
        const request = indexedDB.open(name, requestedVersion);
        let blocked = false;
        const timeout = setTimeout(() => {
          resolve(blocked ? "blocked" : "failed");
        }, 2_000);
        request.onblocked = () => {
          blocked = true;
        };
        request.onerror = () => {
          clearTimeout(timeout);
          resolve("failed");
        };
        request.onsuccess = () => {
          request.result.close();
          clearTimeout(timeout);
          resolve("succeeded");
        };
      }),
    { name: databaseName, requestedVersion: version },
  );
}

describe("IndexedDB recovery", () => {
  let server: http.Server | undefined;
  let browser: Browser | undefined;
  let baseUrl: string;

  beforeAll(async () => {
    const publicPath = path.join(__dirname, "..", ".webpack");
    server = http.createServer(async (request, response) => {
      if (request.url === BLANK_PAGE_PATH) {
        response.setHeader("Content-Type", "text/html");
        response.end("<!doctype html><title>IndexedDB test controller</title>");
        return;
      }
      if (request.url?.startsWith("/viz/") === true) {
        request.url = request.url.slice("/viz".length);
      }
      await serveHandler(request, response, { public: publicPath });
    });
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(0, "127.0.0.1", () => {
        server!.off("error", reject);
        resolve();
      });
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch();
  }, 15_000);

  afterAll(async () => {
    await browser?.close();
    if (server?.listening === true) {
      await new Promise<void>((resolve) => {
        server!.close(() => {
          resolve();
        });
      });
    }
  });

  it("renders the workspace while an extension open is blocked and releases late connections", async () => {
    if (browser == undefined) {
      throw new Error("Browser was not initialized");
    }
    const context: BrowserContext = await browser.newContext();
    try {
      const controller = await context.newPage();
      await controller.goto(`${baseUrl}${BLANK_PAGE_PATH}`);

      await controller.evaluate(async (databaseName) => {
        await new Promise<void>((resolve, reject) => {
          const openRequest = indexedDB.open(databaseName, 1);
          openRequest.onupgradeneeded = () => {
            openRequest.result.createObjectStore("blocker");
          };
          openRequest.onerror = () => {
            reject(openRequest.error ?? new Error("Failed to create extension DB blocker"));
          };
          openRequest.onsuccess = () => {
            const runtime = globalThis as typeof globalThis & {
              extensionBlocker?: IDBDatabase;
              extensionDeleteState?: "pending" | "blocked" | "succeeded" | "failed";
            };
            runtime.extensionBlocker = openRequest.result;
            runtime.extensionDeleteState = "pending";

            const deleteRequest = indexedDB.deleteDatabase(databaseName);
            deleteRequest.onblocked = () => {
              runtime.extensionDeleteState = "blocked";
              resolve();
            };
            deleteRequest.onerror = () => {
              runtime.extensionDeleteState = "failed";
              reject(deleteRequest.error ?? new Error("Failed to delete blocked extension DB"));
            };
            deleteRequest.onsuccess = () => {
              runtime.extensionDeleteState = "succeeded";
            };
          };
        });
      }, EXTENSION_ORG_DB);

      const app = await context.newPage();
      await app.route("https://api.foxglove.dev/v1/studio-update?**", async (route) => {
        await route.fulfill({ json: {} });
      });
      await app.goto(baseUrl);

      // The org extension request is queued behind the blocked deletion. The built-in workspace
      // must remain usable instead of waiting for that request or its five-second deadline.
      await app.getByLabel("Add panel button").waitFor({ state: "visible", timeout: 3_000 });
      await expect(app.getByText("Loading extensions…").count()).resolves.toBe(0);

      // The local extension connection opened normally and remains cached. A real versionchange
      // request from another page must be able to complete because the app closes its connection.
      await waitFor(
        async () => await databaseExists(controller, EXTENSION_LOCAL_DB),
        "local extension database",
      );
      await expect(requestDatabaseUpgrade(controller, EXTENSION_LOCAL_DB, 2)).resolves.toBe(
        "succeeded",
      );

      // Allow the org storage and catalog deadlines to expire before releasing the blocker. This
      // makes the subsequently completed open exercise the late-success connection cleanup.
      await app.waitForTimeout(5_250);
      await controller.evaluate(() => {
        const runtime = globalThis as typeof globalThis & {
          extensionBlocker?: IDBDatabase;
        };
        runtime.extensionBlocker?.close();
      });
      await waitFor(
        async () =>
          await controller.evaluate(
            () =>
              (
                globalThis as typeof globalThis & {
                  extensionDeleteState?: string;
                }
              ).extensionDeleteState === "succeeded",
          ),
        "blocked extension database deletion",
      );
      await waitFor(
        async () => await databaseExists(controller, EXTENSION_ORG_DB),
        "late extension database open",
      );

      // A late connection must not strand the database after fail-open recovery.
      await expect(requestDatabaseUpgrade(controller, EXTENSION_ORG_DB, 2)).resolves.toBe(
        "succeeded",
      );
      await expect(app.getByLabel("Add panel button").isVisible()).resolves.toBe(true);
    } finally {
      await context.close();
    }
  }, 20_000);
});
