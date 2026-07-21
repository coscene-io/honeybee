/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { render, screen } from "@testing-library/react";

import { TimelinePositionIndicator } from "./TimelinePositionIndicator";

describe("<TimelinePositionIndicator />", () => {
  it("keeps the handle fixed while extending the line to the parent bottom", () => {
    render(
      <div style={{ height: 300, position: "relative" }}>
        <TimelinePositionIndicator color="currentColor" dataTestId="timeline-position-indicator" />
      </div>,
    );

    const indicator = screen.getByTestId("timeline-position-indicator");
    const indicatorStyle = getComputedStyle(indicator);
    const handle = indicator.querySelector("svg");
    const line = screen.getByTestId("timeline-position-indicator-line");

    expect(indicatorStyle.top).toBe("0px");
    expect(indicatorStyle.bottom).toBe("0px");
    expect(indicatorStyle.overflow).toBe("hidden");
    expect(indicatorStyle.zIndex).toBe("4");
    expect(getComputedStyle(handle!).height).toBe("129px");
    expect(getComputedStyle(line).top).toBe("128px");
    expect(getComputedStyle(line).bottom).toBe("0px");
  });
});
