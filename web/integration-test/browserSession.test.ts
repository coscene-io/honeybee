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
// Run this suite once per production artifact with the matching public path.
const viewerPath = process.env.HONEYBEE_WEB_PUBLIC_PATH === "/" ? "/" : "/viz/";
const standalone = viewerPath === "/";
const consoleOrigin = "https://console.example.test";
const authPrefix = standalone ? consoleOrigin : "";
function returnTo(location: URL): string {
  return `${standalone ? "/viz" : location.pathname}${location.search}${location.hash}`;
}

beforeAll(async () => {
  server = http.createServer(async (request, response) => {
    if (request.url?.includes("cos-config.js") === true) {
      response.setHeader("content-type", "application/javascript");
      response.end(
        `window.cosConfig = ${JSON.stringify({
          VITE_APP_BASE_API_URL: `${origin}/mock-api`,
          CS_HONEYBEE_BASE_URL: `${origin}/mock-console`,
          VITE_APP_BFF_URL: `${origin}/mock-bff`,
          DOMAIN_CONFIG: {
            default: {
              env: "test",
              logo: "coscene",
              authStatusCookieName: "unused",
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
    if (request.url === "/peer") {
      response.end("<!doctype html><title>Peer</title>");
      return;
    }
    if (request.url?.startsWith("/auth/") === true) {
      response.end("<!doctype html><title>Auth entry</title>");
      return;
    }
    request.url = request.url?.replace(/^\/viz\//, "/");
    await serveHandler(request, response, { public: path.join(__dirname, "..", ".webpack") });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch({
    channel: "chromium",
    ignoreDefaultArgs: ["--disable-back-forward-cache"],
  });
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
  await page.goto(`${origin}${viewerPath}`);
  await page.waitForSelector("#root > *");
}, 45_000);
afterEach(async () => {
  await context.close();
});

it("a second tab replacing credentials shows a reload prompt without injecting the new token into the old document", async () => {
  let usedReplacementCredential = false;
  page.on("request", (request) => {
    usedReplacementCredential ||=
      request.headers().authorization === "Bearer synthetic-replacement";
  });
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
  expect(usedReplacementCredential).toBe(false);
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
        signOutPendingUntilMs: 0,
        isServerSignOutConfirmed: true,
      }) ?? "",
    );
    localStorage.removeItem(key);
  }, tokenKey);
  await page.bringToFront();
  await page.getByText("You are signed out.", { exact: true }).waitFor();
  expect(await page.getByRole("link", { name: "Open sign-in recovery" }).getAttribute("href")).toBe(
    `${authPrefix}/auth/logged-out?redirectToPath=${encodeURIComponent(standalone ? "/viz" : viewerPath)}`,
  );
  expect(signouts).toEqual([]);
}, 30_000);

it("ignores retired status cookies while the same-origin credential remains current", async () => {
  await context.addCookies([
    {
      name: "coSceneAuthStatusDev",
      value: encodeURIComponent(
        JSON.stringify({ status: "SIGN_OUT", updatedAt: Date.now() }) ?? "",
      ),
      url: origin,
    },
  ]);
  await page.reload();
  await page.waitForSelector("#root > *");
  expect(await page.getByText("You are signed out.", { exact: true }).count()).toBe(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), tokenKey)).toBe(
    "Bearer synthetic-initial",
  );
}, 30_000);

it("a genuine BFCache restoration observes an exit that happened while frozen", async () => {
  const reasons: string[] = [];
  const debug = await context.newCDPSession(page);
  await debug.send("Page.enable");
  debug.on("Page.backForwardCacheNotUsed", (event) => {
    reasons.push(JSON.stringify(event.notRestoredExplanations) ?? "");
  });
  page.setDefaultTimeout(10_000);
  await page.evaluate(() => {
    window.addEventListener("pageshow", (event: PageTransitionEvent) => {
      if (event.persisted === true) {
        sessionStorage.setItem("e2e-studio-bfcache-restored", "yes");
      }
    });
  });
  await page.goto(`${origin}/peer`);
  const peer = await context.newPage();
  await peer.goto(`${origin}/peer`);
  await peer.evaluate((key) => {
    localStorage.removeItem(key);
  }, tokenKey);
  // A restored document emits pageshow rather than a new load event.
  await page.goBack({ timeout: 10_000, waitUntil: "commit" });
  expect({
    persisted: await page.evaluate(() => sessionStorage.getItem("e2e-studio-bfcache-restored")),
    reasons,
  }).toEqual({ persisted: "yes", reasons: [] });
  await page
    .getByText("Your session expired. Sign in again to continue.", { exact: true })
    .waitFor();
  expect(await page.getByRole("link", { name: "Open sign-in recovery" }).getAttribute("href")).toBe(
    `${authPrefix}/auth/recover?redirectToPath=${encodeURIComponent(standalone ? "/viz" : viewerPath)}`,
  );
}, 30_000);

it("a first logged-out deep link retains its record, layout, seek time and hash", async () => {
  await page.goto(`${origin}/peer`);
  await page.evaluate((key) => {
    localStorage.removeItem(key);
  }, tokenKey);
  const link = new URL(`${origin}${viewerPath}`);
  link.searchParams.set("ds", "coscene-data-platform");
  link.searchParams.set("ds.key", "synthetic-record");
  link.searchParams.set("layoutId", "users/synthetic/layouts/synthetic");
  link.searchParams.set("time", "2025-04-07T02:08:22.721000000Z");
  link.hash = "detail";
  await page.goto(link.href);
  await page.waitForURL(`${standalone ? consoleOrigin : origin}/auth/login?**`);
  const destination = new URL(page.url());
  expect(destination.searchParams.get("redirectToPath")).toBe(returnTo(link));
}, 30_000);

it("a rejected token offers recovery and stays invalid across reload", async () => {
  await page.goto(`${origin}/peer`);
  await page.evaluate((key) => {
    sessionStorage.setItem("coScene_invalid_org_jwt", localStorage.getItem(key) ?? "");
  }, tokenKey);
  const link = `${origin}${viewerPath}?ds=coscene-data-platform&ds.key=synthetic&time=2025-04-07T02%3A08%3A22.721000000Z#detail`;
  await page.goto(link);
  await page.getByRole("link", { name: "Open sign-in recovery" }).waitFor();
  const recovery = new URL(
    (await page.getByRole("link", { name: "Open sign-in recovery" }).getAttribute("href")) ?? "",
    origin,
  );
  expect(recovery.origin).toBe(standalone ? consoleOrigin : origin);
  expect(recovery.pathname).toBe("/auth/recover");
  expect(recovery.searchParams.get("redirectToPath")).toBe(returnTo(new URL(link)));
  await page.reload();
  await page.getByRole("link", { name: "Open sign-in recovery" }).waitFor();
  expect(await page.evaluate(() => sessionStorage.getItem("coScene_invalid_org_jwt"))).toBe(
    "Bearer synthetic-initial",
  );
}, 30_000);

it("keeps anonymous public sharing on the viewer instead of opening Console auth", async () => {
  await page.goto(`${origin}/peer`);
  await page.evaluate((key) => {
    localStorage.removeItem(key);
  }, tokenKey);
  const authRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/auth/")) authRequests.push(request.url());
  });
  const share = new URL(`${origin}${viewerPath}`);
  share.searchParams.set("ds", "coscene-share-manifest");
  share.hash = new URLSearchParams({ manifestUrl: `${origin}/mock-manifest.json` }).toString();
  await page.goto(share.href);
  await page.waitForSelector("#root > *");
  // Allow the private-source login debounce to expire; public sources must never schedule it.
  await page.waitForTimeout(2_000);
  expect(new URL(page.url()).origin).toBe(origin);
  expect(new URL(page.url()).pathname).toBe(viewerPath);
  expect(authRequests).toEqual([]);
  expect(await page.getByRole("link", { name: "Open sign-in recovery" }).count()).toBe(0);
}, 30_000);
