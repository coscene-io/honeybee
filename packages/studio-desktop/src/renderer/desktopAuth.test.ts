/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, renderHook } from "@testing-library/react";
import { EventEmitter } from "events";

import { mockDesktopLocks } from "@foxglove/studio-base/test/mockDesktopLocks";
import {
  clearDesktopCredential,
  getDesktopSession,
  initializeDesktopSession,
  installDesktopCredential,
  setDesktopLocalPlayback,
} from "@foxglove/studio-base/util/desktopSession";

import { bindDesktopAuth, useDesktopSessionState } from "./desktopAuth";
import { parseLegacyAuthLink } from "../common/authLink";
import type { Auth } from "../common/types";

it("installs the legacy IPC credential and clears identity on IPC signout", async () => {
  mockDesktopLocks();
  localStorage.clear();
  initializeDesktopSession();
  await clearDesktopCredential();
  const ipc = new EventEmitter();
  const bridge: Auth = {
    onAuthToken: (callback) => {
      ipc.on("auth-token", callback);
      return () => {
        ipc.off("auth-token", callback);
      };
    },
    onLogout: (callback) => {
      ipc.on("auth-signout", callback);
      return () => {
        ipc.off("auth-signout", callback);
      };
    },
    logout: (credential) => {
      ipc.emit("auth-signout", credential);
    },
  };
  const onLogin = jest.fn();
  const onLogout = jest.fn();
  const stop = bindDesktopAuth(bridge, { onLogin, onLogout });
  try {
    const credential = parseLegacyAuthLink(
      `coscene://signin-complete?jwt=${btoa("Bearer legacy")}`,
    )!;
    ipc.emit("auth-token", credential);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    const previous = getDesktopSession()!;
    expect(localStorage.getItem("coScene_org_jwt")).toBe(credential);
    expect(onLogin).toHaveBeenCalledTimes(1);
    ipc.emit("auth-token", "Bearer replacement");
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(previous.controller.signal.aborted).toBe(true);
    ipc.emit("auth-signout", credential);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(localStorage.getItem("coScene_org_jwt")).toBe("Bearer replacement");
    localStorage.setItem("user-storage", "profile");
    ipc.emit("auth-signout", "Bearer replacement");
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(localStorage.getItem("coScene_org_jwt")).toBeNull();
    expect(localStorage.getItem("user-storage")).toBeNull();
    expect(onLogout).toHaveBeenCalledTimes(1);
  } finally {
    stop();
    await clearDesktopCredential();
  }
  expect(ipc.listenerCount("auth-token")).toBe(0);
  expect(ipc.listenerCount("auth-signout")).toBe(0);
});

it("keeps the workspace mounted for local/public playback across login and passive expiry", async () => {
  mockDesktopLocks();
  localStorage.clear();
  setDesktopLocalPlayback({ local: true });
  const { result, unmount } = renderHook(useDesktopSessionState);
  const generation = result.current.workspaceGeneration;
  await act(async () => {
    await installDesktopCredential("Bearer playing", "playback:1");
  });
  expect(result.current.workspaceGeneration).toBe(generation);
  expect(result.current.session.credential).toBe("Bearer playing");
  await act(async () => {
    await clearDesktopCredential();
  });
  expect(result.current.workspaceGeneration).toBe(generation);
  expect(result.current.session.credential).toBe("");
  setDesktopLocalPlayback({ local: false });
  await act(async () => {
    await installDesktopCredential("Bearer private", "playback:2");
  });
  expect(result.current.workspaceGeneration).toBeGreaterThan(generation);
  unmount();
  await clearDesktopCredential();
});

describe("logout notifications after shared credential removal", () => {
  beforeEach(async () => {
    mockDesktopLocks();
    localStorage.clear();
    initializeDesktopSession();
    await clearDesktopCredential();
  });

  async function flush(): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }

  it.each(["initiator", "peer", "reconciled peer"])(
    "notifies the %s once and ignores a delayed logout after re-login",
    async (renderer) => {
      const ipc = new EventEmitter();
      const bridge: Auth = {
        onAuthToken: () => () => undefined,
        onLogout: (callback) => {
          ipc.on("logout", callback);
          return () => {
            ipc.off("logout", callback);
          };
        },
        logout: jest.fn(),
      };
      Object.assign(global, { authBridge: bridge });
      await installDesktopCredential("Bearer same", "notification:1");
      const onLogout = jest.fn();
      const stop = bindDesktopAuth(bridge, { onLogin: jest.fn(), onLogout });
      try {
        await flush();
        if (renderer === "initiator") {
          getDesktopSession()!.rejectCredential("Bearer same");
          await flush();
          expect(bridge.logout).toHaveBeenCalledWith("Bearer same", "notification:1");
        } else {
          // A different renderer removed the shared token before the broker broadcast.
          localStorage.removeItem("coScene_org_jwt");
          if (renderer === "reconciled peer") {
            window.dispatchEvent(new StorageEvent("storage", { key: "coScene_org_jwt" }));
            await flush();
            expect(getDesktopSession()!.credential).toBe("");
          }
        }
        expect(localStorage.getItem("coScene_org_jwt")).toBeNull();
        ipc.emit("logout", "Bearer same", "notification:1");
        ipc.emit("logout", "Bearer same", "notification:1");
        await flush();
        expect(getDesktopSession()!.credential).toBe("");
        expect(onLogout).toHaveBeenCalledTimes(1);

        await installDesktopCredential("Bearer same", "notification:2");
        ipc.emit("logout", "Bearer same", "notification:1");
        await flush();
        expect(getDesktopSession()!.credential).toBe("Bearer same");
        expect(onLogout).toHaveBeenCalledTimes(1);

        // An IPC handler waiting on persistence must not notify an unmounted binding.
        ipc.emit("logout", "Bearer same", "notification:2");
        stop();
        await flush();
        expect(onLogout).toHaveBeenCalledTimes(1);
      } finally {
        stop();
        Reflect.deleteProperty(global, "authBridge");
        await clearDesktopCredential();
      }
    },
  );
});
