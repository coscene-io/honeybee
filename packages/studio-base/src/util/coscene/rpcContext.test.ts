// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Code, ConnectError, createContextValues } from "@connectrpc/connect";

import { expectingCodes, isExpectedRpcError } from "./rpcContext";

describe("isExpectedRpcError", () => {
  it("treats cancellation and codes the caller declared as expected", () => {
    const { contextValues } = expectingCodes(Code.AlreadyExists);
    expect(isExpectedRpcError(new ConnectError("x", Code.AlreadyExists), contextValues)).toBe(true);
    expect(isExpectedRpcError(new ConnectError("x", Code.Canceled), createContextValues())).toBe(
      true,
    );
  });

  it("still reports every other failure", () => {
    const { contextValues } = expectingCodes(Code.AlreadyExists);
    expect(isExpectedRpcError(new ConnectError("x", Code.NotFound), contextValues)).toBe(false);
    expect(
      isExpectedRpcError(new ConnectError("x", Code.AlreadyExists), createContextValues()),
    ).toBe(false);
    expect(isExpectedRpcError(new Error("network"), contextValues)).toBe(false);
  });
});
