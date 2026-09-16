/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { BrowserSession } from "./browserSession";

const tokenKey = "coScene_org_jwt";
const versionKey = "coscene.auth.session-version.v1";
beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  jest.restoreAllMocks();
  localStorage.clear();
});

it("request boundaries detect a new credential before the storage event arrives", () => {
  localStorage.setItem(tokenKey, "Bearer old");
  const session = new BrowserSession();
  localStorage.setItem(tokenKey, "Bearer new");
  expect(() => {
    session.assertCurrent();
  }).toThrow();
  expect(session.getStatus()).toBe("changed");
  expect(session.controller.signal.aborted).toBe(true);
  expect(localStorage.getItem(tokenKey)).toBe("Bearer new");
});
it("a delayed 401 never removes the replacement credential", () => {
  localStorage.setItem(tokenKey, "Bearer old");
  const session = new BrowserSession();
  localStorage.setItem(tokenKey, "Bearer new");
  session.rejectCredential("Bearer old");
  expect(localStorage.getItem(tokenKey)).toBe("Bearer new");
  expect(session.getStatus()).toBe("changed");
});
it("a current 401 stops this context and requires explicit recovery", () => {
  localStorage.setItem(tokenKey, "Bearer old");
  const session = new BrowserSession();
  session.rejectCredential("Bearer old");
  expect(session.getStatus()).toBe("recover");
  expect(() => {
    session.assertCurrent();
  }).toThrow();
});
it.each(["storage", "pageshow", "visibilitychange"])("%s reconciles a missed logout", (event) => {
  localStorage.setItem(tokenKey, "Bearer old");
  const session = new BrowserSession();
  const stop = session.listen();
  localStorage.removeItem(tokenKey);
  localStorage.setItem(
    versionKey,
    JSON.stringify({ version: "ab".repeat(16), reason: "logout" }) ?? "",
  );
  if (event === "storage") {
    window.dispatchEvent(new StorageEvent("storage", { key: tokenKey }));
  } else if (event === "visibilitychange") {
    document.dispatchEvent(new Event(event));
  } else {
    window.dispatchEvent(new Event(event));
  }
  expect(session.getStatus()).toBe("logged-out");
  stop();
});
it("a credential loss without explicit exit offers recovery", () => {
  localStorage.setItem(tokenKey, "Bearer old");
  const session = new BrowserSession();
  localStorage.removeItem(tokenKey);
  session.reconcile();
  expect(session.getStatus()).toBe("recover");
});
it("local playback stays available while authenticated APIs are stopped", () => {
  const session = new BrowserSession();
  session.setLocalPlayback({ local: true });
  localStorage.setItem(tokenKey, "Bearer new");
  session.reconcile();
  expect(session.preservesPlayback()).toBe(true);
  expect(() => {
    session.assertCurrent();
  }).toThrow();
});
