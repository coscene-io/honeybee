/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { act, renderHook } from "@testing-library/react";

import { createSegmentationHost } from "./segmentationHost";
import {
  SegmentationHostContext,
  useSegmentationHost,
  useSegmentationSession,
} from "./segmentationHostContext";
import { allowSlowRunner } from "./testing/slowRunner";

allowSlowRunner();

describe("segmentation host context", () => {
  it("throws outside a host: the feature is mounted only behind its flag", () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useSegmentationHost())).toThrow();
    error.mockRestore();
  });

  it("reads the session of the enclosing host with a selector", () => {
    const host = createSegmentationHost();
    const { result } = renderHook(() => useSegmentationSession((state) => state.open), {
      wrapper: ({ children }) => (
        <SegmentationHostContext.Provider value={host}>{children}</SegmentationHostContext.Provider>
      ),
    });
    expect(result.current).toBe(false);
    act(() => {
      host.session.setState({ open: true });
    });
    expect(result.current).toBe(true);
    host.dispose();
  });

  it("gives every host its own session", () => {
    const a = createSegmentationHost();
    const b = createSegmentationHost();
    a.session.setState({ open: true });
    expect(b.session.getState().open).toBe(false);
    a.dispose();
    b.dispose();
  });
});
