// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import electronPath from "electron";
import { mkdtemp, rm } from "fs/promises";
import * as os from "os";
import * as path from "path";
import { ConsoleMessage, _electron as electron, ElectronApplication, Page } from "playwright";

import Logger from "@foxglove/log";

import { appPath } from "./build";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Symbol as any).dispose ??= Symbol("Symbol.dispose");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Symbol as any).asyncDispose ??= Symbol("Symbol.asyncDispose");

const log = Logger.getLogger(__filename);

export type AppType = {
  main: ElectronApplication;
  renderer: Page;
} & AsyncDisposable;

/**
 * Launch the app and wait for initial render.
 *
 * @returns An AsyncDisposable which automatically closes the app when it goes out of scope.
 */
export async function launchApp(): Promise<AppType> {
  // Create a new user data directory for each test, which bypasses the `app.requestSingleInstanceLock()`
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "integration-test-"));
  let electronApp: ElectronApplication | undefined;
  try {
    electronApp = await electron.launch({
      args: [
        process.env.HONEYBEE_REACT_BENCHMARK_APP_DIR ?? appPath,
        `--user-data-dir=${userDataDir}`,
      ],
      // In node.js the electron import gives us the path to the electron binary
      // Our type definitions don't realize this so cast the variable to a string
      executablePath: electronPath as unknown as string,
    });

    const launchedApp = electronApp;

    // Extension storage uses app.getPath("home"), independently of userData. Isolate it before
    // any test installs a package, then reload to discard extensions loaded during startup.
    await launchedApp.evaluate(({ app }, homePath) => {
      app.setPath("home", homePath);
    }, userDataDir);
    const electronWindow = await launchedApp.firstWindow();
    // Update availability is unrelated to panel acceptance and must not depend on public network
    // access from CI. Keep renderer error assertions strict instead of ignoring failed requests.
    await electronWindow.route(
      "https://download.coscene.cn/coStudio/packages/latest.yml",
      async (route) => {
        await route.fulfill({ status: 200, contentType: "text/yaml", body: "version: 0.0.0\n" });
      },
    );
    await electronWindow.waitForLoadState("domcontentloaded");
    await electronWindow.evaluate(() => {
      localStorage.setItem("i18nextLng", "en");
    });
    // firstWindow can resolve after the initial document has already started requests. Discard
    // that document before observing the isolated test navigation, so its late failed update
    // request cannot be mistaken for an error from the intercepted, tested document.
    const rendererUrl = electronWindow.url();
    await electronWindow.goto("about:blank");
    const rendererErrors: string[] = [];
    electronWindow.on("pageerror", (error) => rendererErrors.push(error.message));
    electronWindow.on("console", (message: ConsoleMessage) => {
      if (message.type() === "error") {
        rendererErrors.push(message.text());
      }
      log.info(message.text());
    });
    await electronWindow.goto(rendererUrl);

    // A production renderer may log before firstWindow resolves. DOM readiness is observable even
    // after that point and does not rely on a fixed two-second delay or a lost console event.
    await electronWindow.waitForSelector("#root > *", { timeout: 30_000 });

    return {
      main: launchedApp,
      renderer: electronWindow,

      async [Symbol.asyncDispose]() {
        try {
          await launchedApp.close();
        } finally {
          await rm(userDataDir, { recursive: true, force: true });
        }
        // Throw within the test's awaited lifetime, not from an asynchronous event listener.
        if (rendererErrors.length > 0) {
          throw new Error(rendererErrors.join("\n"));
        }
      },
    };
  } catch (error) {
    try {
      await electronApp?.close();
    } finally {
      await rm(userDataDir, { recursive: true, force: true });
    }
    throw error;
  }
}
