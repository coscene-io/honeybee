/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Sentry from "@sentry/browser";
import { render } from "@testing-library/react";

import ErrorBoundary from "@foxglove/studio-base/components/ErrorBoundary";
import PanelErrorBoundary from "@foxglove/studio-base/components/PanelErrorBoundary";
import { reportError, setReportErrorHandler } from "@foxglove/studio-base/reportError";

import { initializeSentryErrorReporting } from "./initializeSentryErrorReporting";

jest.mock("@sentry/browser", () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  browserTracingIntegration: jest.fn(() => ({ name: "BrowserTracing" })),
}));

jest.mock("@foxglove/studio-base/components/ErrorDisplay", () => ({
  __esModule: true,
  default: () => <div>Render failed</div>,
}));

describe("initializeSentryErrorReporting", () => {
  const existingHandler = jest.fn();
  const config = {
    VITE_APP_PROJECT_ENV: "production",
    SENTRY_ENABLED: true,
    SENTRY_HONEYBEE_DSN: "https://public@example.test/1",
    RELEASE_TAG: "test-release",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    setReportErrorHandler(existingHandler);
  });

  afterEach(() => {
    setReportErrorHandler(() => {});
  });

  it.each([
    { VITE_APP_PROJECT_ENV: "local", SENTRY_ENABLED: true },
    { VITE_APP_PROJECT_ENV: "aws", SENTRY_ENABLED: true },
    { VITE_APP_PROJECT_ENV: "gcp", SENTRY_ENABLED: true },
    { VITE_APP_PROJECT_ENV: "production", SENTRY_ENABLED: false },
  ])("does not enable reporting for %j", (overrides) => {
    initializeSentryErrorReporting({ ...config, ...overrides });
    const error = new Error("not sent to Sentry");
    reportError(error);

    expect(Sentry.init).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(existingHandler).not.toHaveBeenCalled();
  });

  it("stops explicit reporting when configuration is disabled after initialization", () => {
    initializeSentryErrorReporting(config);
    initializeSentryErrorReporting({ ...config, SENTRY_ENABLED: false });
    reportError(new Error("not sent after disabling"));

    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("preserves the original error and sends an optional React component stack", () => {
    initializeSentryErrorReporting(config);
    const error = new Error("render failure");
    reportError(error, { componentStack: "\n    at BrokenPanel" });

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(error, {
      contexts: { react: { componentStack: "\n    at BrokenPanel" } },
    });
    expect(existingHandler).not.toHaveBeenCalled();
  });

  it("continues to support errors reported outside React", () => {
    initializeSentryErrorReporting(config);
    const error = new Error("data source failure");
    reportError(error);

    expect(Sentry.captureException).toHaveBeenCalledWith(error, { contexts: undefined });
  });

  it("retains the SDK global error handler for uncaught errors", () => {
    initializeSentryErrorReporting(config);
    const options = jest.mocked(Sentry.init).mock.calls[0]![0]!;
    expect(options).toMatchObject({
      environment: "production",
      release: "test-release",
    });
    const integrations = options.integrations;
    expect(typeof integrations).toBe("function");
    if (typeof integrations !== "function") {
      throw new Error("Expected integration configuration callback");
    }
    expect(integrations([{ name: "GlobalHandlers" }, { name: "Breadcrumbs" }])).toEqual([
      { name: "GlobalHandlers" },
      { name: "BrowserTracing" },
    ]);
  });

  it("reports a nested panel failure once through the nearest boundary", () => {
    initializeSentryErrorReporting(config);
    const error = new Error("intentional render failure");
    function BrokenPanel(): React.JSX.Element {
      throw error;
    }

    render(
      <ErrorBoundary>
        <PanelErrorBoundary onResetPanel={() => {}} onRemovePanel={() => {}}>
          <BrokenPanel />
        </PanelErrorBoundary>
      </ErrorBoundary>,
    );

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(error, {
      contexts: { react: { componentStack: expect.stringContaining("PanelErrorBoundaryInner") } },
    });
    // React also emits the expected diagnostic to the console in development.
    expect(console.error).toHaveBeenCalled();
    (console.error as jest.Mock).mockClear();
  });
});
