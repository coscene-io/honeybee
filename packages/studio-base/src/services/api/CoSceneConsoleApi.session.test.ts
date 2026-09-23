/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { BrowserSession, getBrowserSession } from "@foxglove/studio-base/util/browserSession";

import CoSceneConsoleApi from "./CoSceneConsoleApi";

jest.mock("@foxglove/studio-base/util/browserSession", () => ({
  ...jest.requireActual("@foxglove/studio-base/util/browserSession"),
  getBrowserSession: jest.fn(),
}));
const tokenKey = "coScene_org_jwt";
let session: BrowserSession;
let api: CoSceneConsoleApi;
const fetchMock = jest.fn();
const originalFetch = global.fetch;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(tokenKey, "Bearer initial");
  session = new BrowserSession();
  jest.mocked(getBrowserSession).mockReturnValue(session);
  api = new CoSceneConsoleApi("https://api.test", "https://bff.test", session.credential);
  fetchMock.mockReset();
  global.fetch = fetchMock;
});
afterEach(() => {
  localStorage.clear();
  global.fetch = originalFetch;
});

it("blocks old API requests at the boundary even before a storage event", async () => {
  localStorage.setItem(tokenKey, "Bearer replacement");
  await expect(api.getFilesStatus("synthetic")).rejects.toThrow("session changed");
  expect(fetchMock).not.toHaveBeenCalled();
});
it("rejects a late response and keeps a replacement token", async () => {
  let complete!: (response: Response) => void;
  fetchMock.mockImplementation(
    async () =>
      await new Promise<Response>((resolve) => {
        complete = resolve;
      }),
  );
  const request = api.getFilesStatus("synthetic");
  localStorage.setItem(tokenKey, "Bearer replacement");
  complete({ status: 401 } as Response);
  await expect(request).rejects.toThrow("session changed");
  expect(localStorage.getItem(tokenKey)).toBe("Bearer replacement");
});
it("a matching 401 aborts the captured stream signal and stops future API calls", async () => {
  fetchMock.mockResolvedValue({ status: 401 });
  await api.getFilesStatus("synthetic");
  expect(session.getStatus()).toBe("recover");
  expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal?.aborted).toBe(true);
  await expect(api.getFilesStatus("next")).rejects.toThrow();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("network failures and ordinary 403 responses preserve the session", async () => {
  fetchMock.mockRejectedValueOnce(new Error("network unavailable"));
  await expect(api.getFilesStatus("synthetic")).rejects.toThrow("network unavailable");
  expect(session.getStatus()).toBe("current");
  fetchMock.mockResolvedValueOnce({ status: 403 });
  await api.getFilesStatus("synthetic");
  expect(session.getStatus()).toBe("current");
});
