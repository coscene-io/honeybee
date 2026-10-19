/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { render } from "@testing-library/react";

import { getBrowserSession, BrowserSession } from "@foxglove/studio-base/util/browserSession";

import { CurrentLayoutSyncAdapter } from "./CoSceneCurrentLayoutSyncAdapter";

jest.mock("@foxglove/studio-base/context/CurrentLayoutContext", () => ({
  useCurrentLayoutSelector: () => ({ id: "test", transient: true, edited: true }),
}));
jest.mock("@foxglove/studio-base/context/CoSceneLayoutManagerContext", () => ({
  useLayoutManager: () => ({}),
}));
jest.mock("@foxglove/studio-base/context/AnalyticsContext", () => ({
  useAnalytics: () => ({}),
}));
jest.mock("@foxglove/studio-base/util/browserSession", () => ({
  ...jest.requireActual("@foxglove/studio-base/util/browserSession"),
  getBrowserSession: jest.fn(),
}));

it.each([false, true])("only protects browser unsaved edits (browser=%s)", (browser) => {
  jest.mocked(getBrowserSession).mockReturnValue(browser ? new BrowserSession() : undefined);
  const { unmount } = render(<CurrentLayoutSyncAdapter />);
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(browser);
  unmount();
  const afterUnmount = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(afterUnmount);
  expect(afterUnmount.defaultPrevented).toBe(false);
});
