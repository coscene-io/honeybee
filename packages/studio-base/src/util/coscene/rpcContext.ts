// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  Code,
  createContextKey,
  createContextValues,
  type ContextValues,
} from "@connectrpc/connect";

/**
 * Status codes a caller handles itself (e.g. AlreadyExists on an idempotent create, NotFound on a
 * delete). The shared client interceptor does not log them as errors.
 */
export const expectedRpcCodes = createContextKey<readonly Code[]>([], {
  description: "Status codes the caller expects and handles",
});

/** Call options for an RPC whose `codes` are expected outcomes, not failures. */
export function expectingCodes(...codes: Code[]): { contextValues: ContextValues } {
  return { contextValues: createContextValues().set(expectedRpcCodes, codes) };
}

/** True for an error the interceptor should not log: a cancellation or a code the caller expects. */
export function isExpectedRpcError(error: unknown, contextValues: ContextValues): boolean {
  const code = (error as { code?: unknown } | undefined)?.code;
  if (typeof code !== "number") {
    return false;
  }
  return code === Code.Canceled || contextValues.get(expectedRpcCodes).includes(code);
}
