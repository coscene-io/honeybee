/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { mockDesktopLocks } from "@foxglove/studio-base/test/mockDesktopLocks";

import {
  clearDesktopCredential,
  getDesktopSession,
  initializeDesktopSession,
  installDesktopCredential,
  signOutDesktop,
  subscribeDesktopSession,
} from "./desktopSession";

beforeEach(async () => {
  mockDesktopLocks();
  localStorage.clear();
  initializeDesktopSession();
  await clearDesktopCredential();
});
afterEach(async () => {
  await clearDesktopCredential();
  localStorage.clear();
});

it("retires requests and cached identity when the same credential is installed again", async () => {
  await installDesktopCredential("Bearer initial");
  const previous = getDesktopSession()!;
  localStorage.setItem("user-storage", "old profile and permissions");
  await installDesktopCredential("Bearer initial");
  expect(previous.controller.signal.aborted).toBe(true);
  expect(getDesktopSession()).not.toBe(previous);
  expect(localStorage.getItem("user-storage")).toBeNull();
  expect(() => {
    previous.assertCurrent();
  }).toThrow("Desktop session changed");
  expect(() => {
    getDesktopSession()!.assertCurrent();
  }).not.toThrow();
});

it("clears a local logout before broadcasting it to every desktop window", async () => {
  const logout = jest.fn();
  Object.assign(global, { authBridge: { logout } });
  try {
    await installDesktopCredential("Basic legacy-key");
    const previous = getDesktopSession()!;
    localStorage.setItem("user-storage", "old profile");
    await signOutDesktop();
    expect(previous.controller.signal.aborted).toBe(true);
    expect(localStorage.getItem("coScene_org_jwt")).toBeNull();
    expect(localStorage.getItem("user-storage")).toBeNull();
    expect(logout).toHaveBeenCalledWith("Basic legacy-key", previous.sessionId);
    expect(() => {
      getDesktopSession()!.assertCurrent();
    }).toThrow();
  } finally {
    Reflect.deleteProperty(global, "authBridge");
  }
});

it("a late old credential rejection or IPC logout cannot clear a newer account", async () => {
  await installDesktopCredential("Bearer old");
  const previous = getDesktopSession()!;
  await installDesktopCredential("Bearer new");
  previous.rejectCredential("Bearer old");
  await expect(clearDesktopCredential("Bearer old")).resolves.toBe(false);
  expect(localStorage.getItem("coScene_org_jwt")).toBe("Bearer new");
  expect(getDesktopSession()!.controller.signal.aborted).toBe(false);
});

it("blocks a peer-window change before its storage event and then adopts a fresh session", async () => {
  await installDesktopCredential("Bearer old");
  const previous = getDesktopSession()!;
  const changed = jest.fn();
  const stop = subscribeDesktopSession(changed);
  try {
    localStorage.setItem("coScene_org_jwt", "Bearer new");
    expect(() => {
      previous.assertCurrent();
    }).toThrow();
    window.dispatchEvent(new StorageEvent("storage", { key: "coScene_org_jwt" }));
    await navigator.locks.request("coscene.desktop-auth", () => undefined);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(getDesktopSession()!.credential).toBe("Bearer new");
  } finally {
    stop();
  }
});

it("combines caller cancellation with desktop logout", async () => {
  await installDesktopCredential("Bearer old");
  const session = getDesktopSession()!;
  const request = new AbortController();
  const signal = session.requestSignal(request.signal);
  request.abort();
  expect(signal.aborted).toBe(true);
  expect(session.controller.signal.aborted).toBe(false);
  const next = session.requestSignal(new AbortController().signal);
  await clearDesktopCredential();
  expect(next.aborted).toBe(true);
});

it("ignores a delayed signout when an identical credential belongs to a newer login", async () => {
  await installDesktopCredential("Bearer same", "old-login");
  const previous = getDesktopSession()!;
  await installDesktopCredential("Bearer same", "new-login");
  await expect(clearDesktopCredential("Bearer same", previous.sessionId)).resolves.toBe(false);
  expect(getDesktopSession()!.sessionId).toBe("new-login");
  expect(localStorage.getItem("coScene_org_jwt")).toBe("Bearer same");
});

it("does not replace the session twice when storage and login IPC describe the same login", async () => {
  await installDesktopCredential("Bearer same", "shared-login");
  const current = getDesktopSession()!;
  await installDesktopCredential("Bearer same", "shared-login");
  expect(getDesktopSession()).toBe(current);
  expect(current.controller.signal.aborted).toBe(false);
});

it("cannot roll shared credentials back when a background window receives an older login", async () => {
  await installDesktopCredential("Bearer account-a", "main-process:1");
  const backgroundSession = getDesktopSession()!;
  // Another window already handled the later main-process broadcast.
  localStorage.setItem("coScene_org_jwt", "Bearer account-b");
  localStorage.setItem("coScene_desktop_session_id", "main-process:2");
  await installDesktopCredential("Bearer account-a", "main-process:1");
  expect(localStorage.getItem("coScene_org_jwt")).toBe("Bearer account-b");
  expect(() => {
    backgroundSession.assertCurrent();
  }).toThrow("Desktop session changed");
  await installDesktopCredential("Bearer account-b", "main-process:2");
  expect(getDesktopSession()!.credential).toBe("Bearer account-b");
});

it("accepts a new main process after restarting the desktop", async () => {
  await installDesktopCredential("Bearer old", "previous-process:99");
  await installDesktopCredential("Bearer new", "new-process:1");
  expect(getDesktopSession()!.credential).toBe("Bearer new");
});

it("keeps a logout tombstone so a delayed window cannot reinstall the retired login", async () => {
  await installDesktopCredential("Bearer account-a", "main-process:1");
  await clearDesktopCredential();
  await expect(installDesktopCredential("Bearer account-a", "main-process:1")).resolves.toBe(false);
  expect(localStorage.getItem("coScene_org_jwt")).toBeNull();
  expect(getDesktopSession()!.credential).toBe("");
  await expect(installDesktopCredential("Bearer account-b", "main-process:2")).resolves.toBe(true);
  expect(getDesktopSession()!.credential).toBe("Bearer account-b");
});

it("checks the shared revision only after acquiring the cross-window lock", async () => {
  let release!: () => void;
  const held = navigator.locks.request("coscene.desktop-auth", async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  await Promise.resolve();
  const delayed = installDesktopCredential("Bearer stale", "main-process:1");
  // A different renderer completes a newer write before this renderer acquires the lock.
  localStorage.setItem("coScene_org_jwt", "Bearer current");
  localStorage.setItem("coScene_desktop_session_id", "main-process:2");
  release();
  await held;
  await expect(delayed).resolves.toBe(false);
  expect(localStorage.getItem("coScene_org_jwt")).toBe("Bearer current");
});

it("retires in-memory requests synchronously while a peer holds the storage lock", async () => {
  await installDesktopCredential("Bearer current", "main-process:1");
  const previous = getDesktopSession()!;
  let release!: () => void;
  const held = navigator.locks.request("coscene.desktop-auth", async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  await Promise.resolve();
  const pending = clearDesktopCredential();
  expect(previous.controller.signal.aborted).toBe(true);
  expect(getDesktopSession()!.credential).toBe("");
  release();
  await held;
  await expect(pending).resolves.toBe(true);
  expect(localStorage.getItem("coScene_org_jwt")).toBeNull();
});

it("reads a consistent credential snapshot after a peer finishes both storage writes", async () => {
  await installDesktopCredential("Bearer old", "snapshot:1");
  const changed = jest.fn();
  const stop = subscribeDesktopSession(changed);
  await navigator.locks.request("coscene.desktop-auth", () => undefined);
  let release!: () => void;
  const held = navigator.locks.request("coscene.desktop-auth", async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  await Promise.resolve();
  localStorage.setItem("coScene_desktop_session_id", "snapshot:2");
  window.dispatchEvent(new StorageEvent("storage", { key: "coScene_desktop_session_id" }));
  expect(getDesktopSession()!.sessionId).toBe("snapshot:1");
  expect(changed).not.toHaveBeenCalled();
  localStorage.setItem("coScene_org_jwt", "Bearer new");
  release();
  await held;
  await navigator.locks.request("coscene.desktop-auth", () => undefined);
  expect(getDesktopSession()!.sessionId).toBe("snapshot:2");
  expect(getDesktopSession()!.credential).toBe("Bearer new");
  expect(changed).toHaveBeenCalledTimes(1);
  stop();
});

it("stays locally signed out when persistence fails and pageshow sees the old token", async () => {
  await installDesktopCredential("Bearer old", "failed-write:1");
  const remove = jest.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new Error("storage unavailable");
  });
  await expect(clearDesktopCredential()).rejects.toThrow("storage unavailable");
  remove.mockRestore();
  const stop = subscribeDesktopSession(() => undefined);
  window.dispatchEvent(new Event("pageshow"));
  await navigator.locks.request("coscene.desktop-auth", () => undefined);
  expect(getDesktopSession()!.credential).toBe("");
  await expect(installDesktopCredential("Bearer old", "failed-write:1")).resolves.toBe(false);
  await installDesktopCredential("Bearer new", "failed-write:2");
  expect(getDesktopSession()!.credential).toBe("Bearer new");
  stop();
});

it("never exposes an old token under a new revision if installing the new token fails", async () => {
  await installDesktopCredential("Bearer old", "failed-install:1");
  const original = localStorage.setItem.bind(localStorage);
  const write = jest.spyOn(Storage.prototype, "setItem").mockImplementation((key, value) => {
    if (key === "coScene_org_jwt") {
      throw new Error("storage unavailable");
    }
    original(key, value);
  });
  await expect(installDesktopCredential("Bearer new", "failed-install:2")).rejects.toThrow(
    "storage unavailable",
  );
  write.mockRestore();
  const stop = subscribeDesktopSession(() => undefined);
  await navigator.locks.request("coscene.desktop-auth", () => undefined);
  expect(localStorage.getItem("coScene_org_jwt")).toBeNull();
  expect(getDesktopSession()!.credential).toBe("");
  stop();
});

it("adopts a login committed by another renderer without removing its shared credential", async () => {
  await installDesktopCredential("Bearer old", "shared-write:1");
  const previous = getDesktopSession()!;
  localStorage.setItem("coScene_org_jwt", "Bearer peer");
  localStorage.setItem("coScene_desktop_session_id", "shared-write:2");
  const remove = jest.spyOn(Storage.prototype, "removeItem");
  await installDesktopCredential("Bearer peer", "shared-write:2");
  expect(remove).not.toHaveBeenCalled();
  expect(previous.controller.signal.aborted).toBe(true);
  expect(getDesktopSession()!.credential).toBe("Bearer peer");
  remove.mockRestore();
});
