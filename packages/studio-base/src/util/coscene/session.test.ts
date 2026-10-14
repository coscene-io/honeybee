/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient, createContextValues } from "@connectrpc/connect";
import type { Interceptor, UnaryRequest, UnaryResponse } from "@connectrpc/connect";
import { createGrpcWebTransport } from "@connectrpc/connect-web";
import { RecordService } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/services/record_pb";

import { BrowserSession, getBrowserSession } from "@foxglove/studio-base/util/browserSession";
import isDesktopApp from "@foxglove/studio-base/util/isDesktopApp";

import { getPromiseClient, setAuthlessDataSource } from "./index";

jest.mock("@connectrpc/connect", () => ({
  ...jest.requireActual("@connectrpc/connect"),
  createClient: jest.fn(),
}));
jest.mock("@connectrpc/connect-web", () => ({ createGrpcWebTransport: jest.fn() }));
jest.mock("@foxglove/studio-base/util/browserSession", () => ({
  ...jest.requireActual("@foxglove/studio-base/util/browserSession"),
  getBrowserSession: jest.fn(),
}));
jest.mock("@foxglove/studio-base/util/isDesktopApp", () => ({
  __esModule: true,
  default: jest.fn(),
}));

let session: BrowserSession;
let intercept: Interceptor;
const response: UnaryResponse = {
  stream: false,
  service: RecordService,
  method: RecordService.method.updateRecord,
  message: create(RecordService.method.updateRecord.output),
  header: new Headers(),
  trailer: new Headers(),
};

function request(signal = new AbortController().signal): UnaryRequest {
  return {
    stream: false,
    service: RecordService,
    method: RecordService.method.updateRecord,
    message: create(RecordService.method.updateRecord.input),
    header: new Headers(),
    signal,
    url: "https://api.test/update",
    requestMethod: "POST",
    contextValues: createContextValues(),
  };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("coScene_org_jwt", "Bearer initial");
  session = new BrowserSession();
  jest.mocked(getBrowserSession).mockReturnValue(session);
  jest.mocked(isDesktopApp).mockReturnValue(false);
  setAuthlessDataSource({ authless: false });
  jest.mocked(createClient).mockClear();
  jest.mocked(createGrpcWebTransport).mockClear();
  getPromiseClient(RecordService);
  intercept = jest.mocked(createGrpcWebTransport).mock.calls[0]![0].interceptors![0]!;
});
afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setAuthlessDataSource({ authless: false });
});

it.each([false, true])("never retries a failed mutation (desktop=%s)", async (desktop) => {
  if (desktop) {
    jest.mocked(isDesktopApp).mockReturnValue(true);
    jest.mocked(getBrowserSession).mockReturnValue(undefined);
  }
  const failure = new ConnectError("response lost after a write", Code.Unavailable);
  const next = jest.fn().mockRejectedValue(failure);
  await expect(intercept(next)(request())).rejects.toBe(failure);
  expect(next).toHaveBeenCalledTimes(1);
  expect(console.error).toHaveBeenCalled();
  (console.error as jest.Mock).mockClear();
});

it("blocks a replacement credential before sending another request", async () => {
  localStorage.setItem("coScene_org_jwt", "Bearer replacement");
  const next = jest.fn().mockResolvedValue(response);
  await expect(intercept(next)(request())).rejects.toThrow("session changed");
  expect(next).not.toHaveBeenCalled();
});

it("rejects a delayed old-session 401 without invalidating the new credential", async () => {
  let reject!: (error: Error) => void;
  const next = jest.fn().mockImplementation(
    async () =>
      await new Promise((_, rejectRequest) => {
        reject = rejectRequest;
      }),
  );
  const pending = intercept(next)(request());
  localStorage.setItem("coScene_org_jwt", "Bearer replacement");
  reject(new ConnectError("old session", Code.Unauthenticated));
  await expect(pending).rejects.toThrow("session changed");
  expect(localStorage.getItem("coScene_org_jwt")).toBe("Bearer replacement");
  expect(sessionStorage.getItem("coScene_invalid_org_jwt")).toBeNull();
  expect(next).toHaveBeenCalledTimes(1);
});

it("records a matching 401 for the main site's recovery page", async () => {
  const next = jest.fn().mockRejectedValue(new ConnectError("expired", Code.Unauthenticated));
  await expect(intercept(next)(request())).rejects.toThrow("session changed");
  expect(session.getStatus()).toBe("recover");
  expect(sessionStorage.getItem("coScene_invalid_org_jwt")).toBe("Bearer initial");
  expect(next).toHaveBeenCalledTimes(1);
});

it("does not treat a permission denial as logout", async () => {
  const next = jest
    .fn()
    .mockRejectedValue(new ConnectError("access denied", Code.PermissionDenied));
  await expect(intercept(next)(request())).rejects.toThrow("access denied");
  expect(session.getStatus()).toBe("current");
  expect(sessionStorage.getItem("coScene_invalid_org_jwt")).toBeNull();
  (console.error as jest.Mock).mockClear();
});

it("combines request cancellation with the document session", async () => {
  const controller = new AbortController();
  const req = request(controller.signal);
  const next = jest.fn().mockResolvedValue(response);
  await intercept(next)(req);
  const sent = next.mock.calls[0]![0] as UnaryRequest;
  expect(sent.header.get("Authorization")).toBe("Bearer initial");
  controller.abort();
  expect(sent.signal.aborted).toBe(true);
});
