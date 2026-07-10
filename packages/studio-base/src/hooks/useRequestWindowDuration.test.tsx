/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";

import { getRequestWindowDefaultTime } from "@foxglove/studio-base/constants/appSettingsDefaults";
import AppConfigurationContext, {
  type AppConfigurationValue,
  type IAppConfiguration,
} from "@foxglove/studio-base/context/AppConfigurationContext";

import { useRequestWindowDuration } from "./useRequestWindowDuration";

class FakeAppConfiguration implements IAppConfiguration {
  public constructor(private readonly requestWindow: AppConfigurationValue) {}

  public get(_key: string): AppConfigurationValue {
    return this.requestWindow;
  }

  public async set(): Promise<void> {}

  public addChangeListener(): void {}

  public removeChangeListener(): void {}
}

function wrapper(requestWindow: AppConfigurationValue) {
  const appConfiguration = new FakeAppConfiguration(requestWindow);
  return function Wrapper({ children }: PropsWithChildren): React.JSX.Element {
    return (
      <AppConfigurationContext.Provider value={appConfiguration}>
        {children}
      </AppConfigurationContext.Provider>
    );
  };
}

describe("useRequestWindowDuration", () => {
  it.each([
    [0.25, { sec: 0, nsec: 250_000_000 }],
    [0.75, { sec: 0, nsec: 750_000_000 }],
    [1.25, { sec: 1, nsec: 250_000_000 }],
    [2, { sec: 2, nsec: 0 }],
  ])("normalizes a %s second request window", (requestWindow, expected) => {
    const { result } = renderHook(useRequestWindowDuration, {
      wrapper: wrapper(requestWindow),
    });

    expect(result.current).toEqual(expected);
  });

  it("uses the default duration when no positive request window is configured", () => {
    const { result } = renderHook(useRequestWindowDuration, {
      wrapper: wrapper(undefined),
    });

    expect(result.current).toEqual(getRequestWindowDefaultTime());
  });
});
