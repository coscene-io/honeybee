/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Sentry from "@sentry/browser";

import { setReportErrorHandler } from "@foxglove/studio-base/reportError";

import { initializeSentryErrorReporting } from "./initializeSentryErrorReporting";

jest.mock("@sentry/browser", () => {
  const sdk = jest.requireActual<typeof import("@sentry/browser")>("@sentry/browser");
  return { ...sdk, init: jest.fn(sdk.init) };
});

const actual = jest.requireActual<typeof import("@sentry/browser")>("@sentry/browser");
const config = {
  VITE_APP_PROJECT_ENV: "production",
  SENTRY_ENABLED: true,
  SENTRY_HONEYBEE_DSN: "https://public@example.test/1",
};

// Keep Jest/jsdom from treating the deliberately dispatched browser error as a test failure.
// This does not stop propagation to the SDK handler.
const preventDefault = (event: ErrorEvent) => {
  event.preventDefault();
};
beforeEach(() => {
  window.addEventListener("error", preventDefault);
});
afterEach(async () => {
  window.removeEventListener("error", preventDefault);
  await Sentry.close();
  setReportErrorHandler(undefined);
  jest.clearAllMocks();
});

it("delivers an uncaught window error once through the SDK's real GlobalHandlers integration", async () => {
  const events: string[] = [];
  jest.mocked(Sentry.init).mockImplementationOnce((options) =>
    actual.init({
      ...options,
      autoSessionTracking: false,
      tracesSampleRate: 0,
      transport: () => ({
        send: async (envelope) => {
          if (envelope[1].some(([header]) => header.type === "event")) {
            const serialized = JSON.stringify(envelope);
            if (serialized == undefined) {
              throw new Error("Expected a serializable Sentry envelope");
            }
            events.push(serialized);
          }
          return { statusCode: 200 };
        },
        flush: async () => true,
      }),
    }),
  );
  initializeSentryErrorReporting(config);
  const error = new Error("uncaught-global-handler-acceptance");
  window.dispatchEvent(
    new ErrorEvent("error", { error, message: error.message, cancelable: true }),
  );
  await Sentry.flush();

  expect(events).toHaveLength(1);
  expect(events[0]).toContain(error.message);
  expect(events[0]).toContain('"handled":false');
  expect(events[0]).toContain('"type":"onerror"');
});

it("does not initialize global reporting when Sentry is initially disabled", () => {
  initializeSentryErrorReporting({ ...config, SENTRY_ENABLED: false });
  window.dispatchEvent(
    new ErrorEvent("error", { error: new Error("disabled uncaught error"), cancelable: true }),
  );
  expect(Sentry.init).not.toHaveBeenCalled();
});
