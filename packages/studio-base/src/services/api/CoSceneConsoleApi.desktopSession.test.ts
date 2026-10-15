/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { mockDesktopLocks } from "@foxglove/studio-base/test/mockDesktopLocks";
import {
  clearDesktopCredential,
  installDesktopCredential,
} from "@foxglove/studio-base/util/desktopSession";

import CoSceneConsoleApi from "./CoSceneConsoleApi";

const originalFetch = global.fetch;
const fetchMock = jest.fn();
beforeEach(async () => {
  mockDesktopLocks();
  localStorage.clear();
  await installDesktopCredential("Bearer initial");
  global.fetch = fetchMock;
  fetchMock.mockReset();
});
afterEach(async () => {
  await clearDesktopCredential();
  localStorage.clear();
  global.fetch = originalFetch;
});

it("clears the REST header, aborts streams and blocks REST/RPC calls after logout", async () => {
  const api = new CoSceneConsoleApi("https://api.test", "https://bff.test", "Bearer initial");
  let complete!: (value: Response) => void;
  fetchMock.mockImplementation(
    async () =>
      await new Promise<Response>((resolve) => {
        complete = resolve;
      }),
  );
  const pending = api.getFilesStatus("record");
  const signal = (fetchMock.mock.calls[0]![1] as RequestInit).signal!;
  await clearDesktopCredential();
  expect(api.getAuthHeader()).toBe("");
  expect(signal.aborted).toBe(true);
  complete({ status: 200 } as Response);
  await expect(pending).rejects.toThrow("Desktop session changed");
  await expect(api.getFilesStatus("record")).rejects.toThrow("Desktop session changed");
  await expect(api.getUser("users/current")).rejects.toThrow("Desktop session changed");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("does not let an old API object use a replacement login even with an identical token", async () => {
  const api = new CoSceneConsoleApi("https://api.test", "https://bff.test", "Bearer initial");
  await installDesktopCredential("Bearer initial");
  await expect(api.getFilesStatus("record")).rejects.toThrow("Desktop session changed");
  await expect(api.getUser("users/current")).rejects.toThrow("Desktop session changed");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("rejects an old JSON body completed after login replacement", async () => {
  const api = new CoSceneConsoleApi("https://api.test", "https://bff.test", "Bearer initial");
  let complete!: (value: unknown) => void;
  const json = jest.fn(
    async () =>
      await new Promise((resolve) => {
        complete = resolve;
      }),
  );
  fetchMock.mockResolvedValue({ status: 200, json });
  const pending = api.getExternalInitConfig("record");
  await Promise.resolve();
  await Promise.resolve();
  expect(json).toHaveBeenCalledTimes(1);
  await installDesktopCredential("Bearer replacement");
  complete({ projectId: "old-project" });
  await expect(pending).rejects.toThrow("Desktop session changed");
  expect(localStorage.getItem("coScene_org_jwt")).toBe("Bearer replacement");
});
