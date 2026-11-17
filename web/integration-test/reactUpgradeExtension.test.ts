// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import http from "http";
import { AddressInfo } from "net";
import path from "path";
import { chromium } from "playwright";
import serveHandler from "serve-handler";

import { exerciseExtensionLifecycle } from "./reactUpgradeExtension";

it("installs the generated React 19 .coe and completes two panel lifecycles", async () => {
  const viewerPath = process.env.HONEYBEE_WEB_PUBLIC_PATH === "/" ? "/" : "/viz/";
  const appPath =
    process.env.HONEYBEE_REACT_BENCHMARK_APP_DIR ?? path.resolve(__dirname, "../.webpack");
  let origin = "";
  const server = http.createServer(async (request, response) => {
    if (request.url?.includes("cos-config.js") === true) {
      response.setHeader("content-type", "application/javascript");
      response.end(
        `window.cosConfig = ${JSON.stringify({
          VITE_APP_BASE_API_URL: `${origin}/mock-api`,
          VITE_APP_BFF_URL: `${origin}/mock-bff`,
          CS_HONEYBEE_BASE_URL: `${origin}/mock-console`,
          DOMAIN_CONFIG: {
            default: {
              env: "test",
              logo: "coscene",
              authStatusCookieDomain: "unused",
              webDomain: "console.example.test",
              ssoDomain: "sso.example.test",
            },
          },
          SENTRY_ENABLED: false,
          LANGUAGE: { default: "en", options: ["en"] },
        })};`,
      );
      return;
    }
    if (request.url?.startsWith("/mock-") === true) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
      return;
    }
    request.url = request.url?.replace(/^\/viz\//, "/");
    await serveHandler(request, response, { public: appPath });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const browser = await chromium.launch({ channel: "chromium" });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route("**/*", async (route) => {
      if (new URL(route.request().url()).origin === origin) {
        await route.continue();
      } else {
        await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      }
    });
    await context.addInitScript(() => {
      localStorage.setItem("i18nextLng", "en");
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}${viewerPath}`);
    await page.waitForSelector("#root > *");
    try {
      await exerciseExtensionLifecycle(page);
    } catch (error) {
      console.error(await page.locator("body").innerText());
      throw error;
    }
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
}, 90_000);
