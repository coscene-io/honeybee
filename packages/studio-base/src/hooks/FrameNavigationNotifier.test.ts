// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { FrameNavigationNotifier } from "./FrameNavigationNotifier";

describe("FrameNavigationNotifier", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("does not clear a restarted navigation with a deferred end", () => {
    jest.useFakeTimers();
    const notifier = new FrameNavigationNotifier();

    notifier.startNavigation("panel");
    notifier.endNavigation("panel");
    notifier.startNavigation("panel");
    jest.runOnlyPendingTimers();

    expect(notifier.isNavigationActive("panel")).toBe(true);
  });

  it("notifies the previous navigation when another one starts", () => {
    const notifier = new FrameNavigationNotifier();
    const onSuperseded = jest.fn();

    notifier.startNavigation("first", onSuperseded);
    notifier.startNavigation("second");

    expect(onSuperseded).toHaveBeenCalledTimes(1);
    expect(notifier.isNavigationActive("second")).toBe(true);
  });
});
