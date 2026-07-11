// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { Logger } from "./index";

export type ReactRootErrorInfo = {
  componentStack?: string;
  errorBoundary?: unknown;
};

export type ReactRootErrorHandlers = {
  onCaughtError: (error: unknown, errorInfo: ReactRootErrorInfo) => void;
  onRecoverableError: (error: unknown, errorInfo: ReactRootErrorInfo) => void;
  onUncaughtError: (error: unknown, errorInfo: ReactRootErrorInfo) => void;
};

type ReportRootError = (error: Error) => void;

function normalizeError(error: unknown, errorInfo: ReactRootErrorInfo): Error {
  const normalized =
    error instanceof Error
      ? error
      : new Error(typeof error === "string" ? error : "Unknown React root error");
  if (errorInfo.componentStack == undefined || errorInfo.componentStack.length === 0) {
    return normalized;
  }

  const reportedError = new Error(
    `${normalized.stack ?? normalized.message}\n\n${errorInfo.componentStack}`,
    { cause: normalized },
  );
  reportedError.name = "ReactRootError";
  return reportedError;
}

export function createRootErrorHandlers(
  log: Pick<Logger, "error" | "warn">,
  reportRootError?: ReportRootError,
): ReactRootErrorHandlers {
  return {
    onCaughtError: (error, errorInfo) => {
      // App and panel ErrorBoundaries already report from componentDidCatch. Logging here preserves
      // React 19's default visibility without sending the same caught error twice.
      log.error("React caught an error in an ErrorBoundary", error, errorInfo);
    },
    onRecoverableError: (error, errorInfo) => {
      log.warn("React recovered from an error", error, errorInfo);
    },
    onUncaughtError: (error, errorInfo) => {
      log.error("Uncaught React root error", error, errorInfo);
      reportRootError?.(normalizeError(error, errorInfo));
    },
  };
}
