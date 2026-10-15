/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { BrowserSession, getBrowserAuthUrl } from "./browserSession";

const tokenKey = "coScene_org_jwt";
const versionKey = "coscene.auth.session-version.v1";
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  jest.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

it("request boundaries detect a new credential before the storage event arrives", () => {
  localStorage.setItem(tokenKey, "Bearer old");
  const session = new BrowserSession();
  localStorage.setItem(tokenKey, "Bearer new");
  expect(() => {
    session.assertCurrent();
  }).toThrow();
  expect(session.getStatus()).toBe("changed");
  expect(sessionStorage.getItem("coScene_invalid_org_jwt")).toBeNull();
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
  expect(sessionStorage.getItem("coScene_invalid_org_jwt")).toBe("Bearer old");
  expect(() => {
    session.assertCurrent();
  }).toThrow();
});
it.each(["storage", "pageshow", "visibilitychange", "coscene:session-version"])(
  "%s reconciles a missed logout",
  (event) => {
    localStorage.setItem(tokenKey, "Bearer old");
    const session = new BrowserSession();
    const stop = session.listen();
    localStorage.removeItem(tokenKey);
    localStorage.setItem(
      versionKey,
      JSON.stringify({
        version: "ab".repeat(16),
        reason: "logout",
        signOutPendingUntilMs: 0,
        isServerSignOutConfirmed: true,
      }) ?? "",
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
  },
);
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

it("restores a tab-local invalidation after a reload", () => {
  localStorage.setItem(tokenKey, "Bearer rejected");
  sessionStorage.setItem("coScene_invalid_org_jwt", "Bearer rejected");
  const session = new BrowserSession();
  expect(session.getStatus()).toBe("recover");
  expect(session.controller.signal.aborted).toBe(true);
});

it("does not apply an old invalidation marker to a replacement credential", () => {
  localStorage.setItem(tokenKey, "Bearer replacement");
  sessionStorage.setItem("coScene_invalid_org_jwt", "Bearer rejected");
  expect(new BrowserSession().getStatus()).toBe("current");
});

it("observes a tab-local invalidation after BFCache restoration", () => {
  localStorage.setItem(tokenKey, "Bearer initial");
  const session = new BrowserSession();
  const stop = session.listen();
  sessionStorage.setItem("coScene_invalid_org_jwt", "Bearer initial");
  window.dispatchEvent(new Event("pageshow"));
  expect(session.getStatus()).toBe("recover");
  expect(session.controller.signal.aborted).toBe(true);
  stop();
});

it.each(["Bearer ", "token", "Digest credential"])("rejects malformed credential %s", (token) => {
  localStorage.setItem(tokenKey, token);
  expect(new BrowserSession().getStatus()).toBe("recover");
});

it("observes a session boundary replacement even if the token is unchanged", () => {
  localStorage.setItem(tokenKey, "Bearer old");
  const session = new BrowserSession();
  localStorage.setItem(
    versionKey,
    JSON.stringify({
      version: "cd".repeat(16),
      reason: "credentials",
      signOutPendingUntilMs: 0,
      isServerSignOutConfirmed: false,
    }) ?? "",
  );
  session.reconcile();
  expect(session.getStatus()).toBe("changed");
  expect(session.controller.signal.aborted).toBe(true);
});

it("retains all deep-link arguments through sign-in and recovery", () => {
  const location = new URL(
    "https://dev.coscene.cn/viz?ds=coscene-data-platform&ds.key=record&layoutId=layout&time=2025-04-07T02%3A08%3A22.721000000Z#detail",
  );
  for (const path of [
    "/auth/login",
    "/auth/logout",
    "/auth/recover",
    "/auth/logged-out",
  ] as const) {
    const authUrl = new URL(getBrowserAuthUrl(path, location), location.origin);
    expect(authUrl.pathname).toBe(path);
    expect(authUrl.searchParams.get("redirectToPath")).toBe(
      location.pathname + location.search + location.hash,
    );
  }
});

it.each(["request", "session"])("supports %s cancellation without AbortSignal.any", (source) => {
  const original = Object.getOwnPropertyDescriptor(AbortSignal, "any");
  Object.defineProperty(AbortSignal, "any", { configurable: true, value: undefined });
  try {
    localStorage.setItem(tokenKey, "Bearer initial");
    const session = new BrowserSession();
    const request = new AbortController();
    const signal = session.requestSignal(request.signal);
    if (source === "request") {
      request.abort();
    } else {
      session.rejectCredential("Bearer initial");
    }
    expect(signal.aborted).toBe(true);
    expect(session.getStatus()).toBe(source === "request" ? "current" : "recover");
  } finally {
    if (original != undefined) {
      Object.defineProperty(AbortSignal, "any", original);
    } else {
      Reflect.deleteProperty(AbortSignal, "any");
    }
  }
});

it("ignores retired status cookies without changing the credential boundary", () => {
  localStorage.setItem(tokenKey, "Bearer current");
  const session = new BrowserSession();
  const stop = session.listen();
  try {
    document.cookie = `coSceneAuthStatusDev=${encodeURIComponent(JSON.stringify({ status: "SIGN_OUT", updatedAt: Date.now() }) ?? "")}; Path=/`;
    window.dispatchEvent(new Event("pageshow"));
    expect(session.getStatus()).toBe("current");
    expect(() => {
      session.assertCurrent();
    }).not.toThrow();
    expect(localStorage.getItem(tokenKey)).toBe("Bearer current");
  } finally {
    stop();
    document.cookie = "coSceneAuthStatusDev=; Max-Age=0; Path=/";
  }
});

it.each(["/auth/login", "/auth/logout", "/auth/recover", "/auth/logged-out"] as const)(
  "continues standalone %s on Console without copying viewer credentials",
  (path) => {
    const previousBasePath = process.env.HONEYBEE_WEB_PUBLIC_PATH;
    const previousConfig = window.cosConfig;
    process.env.HONEYBEE_WEB_PUBLIC_PATH = "/";
    window.cosConfig = {
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
    };
    localStorage.setItem(tokenKey, "Bearer never-in-the-url");
    const source = new URL(
      "https://viewer.example.test/?ds=coscene-data-platform&ds.key=record&layoutId=layout&time=2025-04-07T02%3A08%3A22.721000000Z#detail",
    );
    try {
      const destination = new URL(getBrowserAuthUrl(path, source));
      expect(destination.origin).toBe("https://console.example.test");
      expect(destination.pathname).toBe(path);
      expect(destination.searchParams.get("redirectToPath")).toBe(
        `/viz${source.search}${source.hash}`,
      );
      expect(destination.href).not.toContain("never-in-the-url");
      expect(localStorage.getItem(tokenKey)).toBe("Bearer never-in-the-url");
    } finally {
      if (previousBasePath == undefined) {
        delete process.env.HONEYBEE_WEB_PUBLIC_PATH;
      } else {
        process.env.HONEYBEE_WEB_PUBLIC_PATH = previousBasePath;
      }
      window.cosConfig = previousConfig;
    }
  },
);

it.each([
  ["local", "dev.coscene.cn"],
  ["saas", "coscene.cn"],
  ["io", "coscene.io"],
])("uses the selected %s Console domain for a standalone viewer", (env, webDomain) => {
  const previousBasePath = process.env.HONEYBEE_WEB_PUBLIC_PATH;
  const previousConfig = window.cosConfig;
  const previousRemoteHostname = window.cosConfigRemoteHostname;
  process.env.HONEYBEE_WEB_PUBLIC_PATH = "/";
  window.cosConfigRemoteHostname = "selected-config.example.test";
  window.cosConfig = {
    DOMAIN_CONFIG: {
      "selected-config.example.test": {
        env,
        webDomain,
        logo: "coscene",
        authStatusCookieName: "unused",
        authStatusCookieDomain: "unused",
        ssoDomain: "unused.example.test",
      },
    },
  };
  try {
    const destination = new URL(
      getBrowserAuthUrl("/auth/login", {
        pathname: "/",
        search: "?ds=coscene-data-platform&ds.key=record",
        hash: "#detail",
      }),
    );
    expect(destination.origin).toBe(`https://${webDomain}`);
    expect(destination.searchParams.get("redirectToPath")).toBe(
      "/viz?ds=coscene-data-platform&ds.key=record#detail",
    );
  } finally {
    if (previousBasePath == undefined) {
      delete process.env.HONEYBEE_WEB_PUBLIC_PATH;
    } else {
      process.env.HONEYBEE_WEB_PUBLIC_PATH = previousBasePath;
    }
    window.cosConfig = previousConfig;
    window.cosConfigRemoteHostname = previousRemoteHostname;
  }
});
