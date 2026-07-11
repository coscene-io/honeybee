// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createRootErrorHandlers, type Logger } from "@foxglove/log";

describe("createRootErrorHandlers", () => {
  it("reports only uncaught root errors while logging every category", () => {
    const log = { error: jest.fn(), warn: jest.fn() } as unknown as Pick<Logger, "error" | "warn">;
    const reportError = jest.fn();
    const handlers = createRootErrorHandlers(log, reportError);
    const error = new Error("boom");
    const errorInfo = { componentStack: "\n at Component" };

    handlers.onCaughtError(error, errorInfo);
    handlers.onRecoverableError(error, errorInfo);
    expect(reportError).not.toHaveBeenCalled();

    handlers.onUncaughtError(error, errorInfo);
    expect(log.error).toHaveBeenCalledTimes(2);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0]![0].message).toContain("boom");
    expect(reportError.mock.calls[0]![0].message).toContain("at Component");
  });
});
