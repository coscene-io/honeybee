// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import http from "http";
import { AddressInfo } from "net";
import path from "path";
import { Browser, BrowserContext, chromium, Page } from "playwright";
import serveHandler from "serve-handler";

let server: http.Server;
let browser: Browser;
let context: BrowserContext;
let page: Page;
let origin: string;
const tokenKey = "coScene_org_jwt";

beforeAll(async () => {
  server = http.createServer(async (request, response) => {
    if (request.url?.includes("cos-config.js") === true) {
      response.setHeader("content-type", "application/javascript");
      response.end(
        `window.cosConfig = ${JSON.stringify({
          VITE_APP_BASE_API_URL: `${origin}/mock-api`,
          CS_HONEYBEE_BASE_URL: `${origin}/mock-console`,
          VITE_APP_BFF_URL: `${origin}/mock-bff`,
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
    if (request.url === "/peer") {
      response.end("<!doctype html><title>Peer</title>");
      return;
    }
    request.url = request.url?.replace(/^\/viz\//, "/");
    await serveHandler(request, response, { public: path.join(__dirname, "..", ".webpack") });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch();
}, 30_000);
afterAll(async () => {
  await browser.close();
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});
beforeEach(async () => {
  context = await browser.newContext();
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin === origin) {
      await route.continue();
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  page = await context.newPage();
  await page.goto(`${origin}/peer`);
  await page.evaluate((key) => {
    localStorage.setItem(key, "Bearer synthetic-initial");
    localStorage.setItem("i18nextLng", "en");
  }, tokenKey);
  await page.goto(`${origin}/viz/`);
  await page.waitForSelector("#root > *");
}, 45_000);
afterEach(async () => {
  await context.close();
});

it("a second tab replacing credentials shows a reload prompt without injecting the new token into the old document", async () => {
  const peer = await context.newPage();
  await peer.goto(`${origin}/peer`);
  await peer.evaluate((key) => {
    localStorage.setItem(key, "Bearer synthetic-replacement");
  }, tokenKey);
  await page
    .getByText("Your session changed. Reload to use the new session.", { exact: true })
    .waitFor();
  expect(await page.getByRole("button", { name: "Reload", exact: true }).count()).toBe(1);
  expect(await page.evaluate((key) => localStorage.getItem(key), tokenKey)).toBe(
    "Bearer synthetic-replacement",
  );
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await page.waitForSelector("#root > *");
  expect(
    await page
      .getByText("Your session changed. Reload to use the new session.", { exact: true })
      .count(),
  ).toBe(0);
}, 30_000);

it("a hidden tab converges to a passive logged-out page without authenticating", async () => {
  const peer = await context.newPage();
  await peer.goto(`${origin}/peer`);
  await peer.bringToFront();
  const signouts: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/signout")) {
      signouts.push("signout");
    }
  });
  await peer.evaluate((key) => {
    localStorage.setItem(
      "coscene.auth.session-version.v1",
      JSON.stringify({
        version: "ab".repeat(16),
        reason: "logout",
        pendingUntil: 0,
        confirmed: true,
      }) ?? "",
    );
    localStorage.removeItem(key);
  }, tokenKey);
  await page.bringToFront();
  await page.getByText("You are signed out.", { exact: true }).waitFor();
  expect(await page.getByRole("link", { name: "Open sign-in recovery" }).getAttribute("href")).toBe(
    "/auth/logged-out",
  );
  expect(signouts).toEqual([]);
}, 30_000);
