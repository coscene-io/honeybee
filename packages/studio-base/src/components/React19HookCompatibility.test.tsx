/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import type { PropsWithChildren } from "react";
import useThrottleEsm from "react-use/esm/useThrottle";
import useThrottleCjs from "react-use/lib/useThrottle";

function StrictWrapper({ children }: PropsWithChildren) {
  return <StrictMode>{children}</StrictMode>;
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

it.each([
  ["ESM", useThrottleEsm],
  ["CommonJS", useThrottleCjs],
] as const)(
  "keeps %s throttling alive after StrictMode replay and cancels timers on unmount",
  (_, useThrottle) => {
    const view = renderHook(({ value }) => useThrottle(value, 100), {
      initialProps: { value: 1 },
      wrapper: StrictWrapper,
    });
    expect(view.result.current).toBe(1);
    view.rerender({ value: 2 });
    expect(view.result.current).toBe(1);
    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(view.result.current).toBe(2);
    view.rerender({ value: 3 });
    view.unmount();
    expect(jest.getTimerCount()).toBe(0);
  },
);
