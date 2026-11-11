/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act } from "@testing-library/react";
import { StrictMode, useEffect } from "react";

import { mountPanel } from "./mountPanel";

describe("mountPanel", () => {
  it("releases panel resources exactly once on cleanup, including under StrictMode", () => {
    const container = document.createElement("div");
    let activeSubscriptions = 0;
    const listener = jest.fn();
    function Content() {
      useEffect(() => {
        activeSubscriptions++;
        window.addEventListener("panel-test", listener);
        return () => {
          activeSubscriptions--;
          window.removeEventListener("panel-test", listener);
        };
      }, []);
      return <div>Panel content</div>;
    }

    let cleanup: (() => void) | undefined;
    act(() => {
      cleanup = mountPanel(
        container,
        <StrictMode>
          <Content />
        </StrictMode>,
      );
    });
    expect(container.textContent).toBe("Panel content");
    expect(activeSubscriptions).toBe(1);

    act(() => {
      cleanup?.();
      cleanup?.();
    });
    window.dispatchEvent(new Event("panel-test"));
    expect(listener).not.toHaveBeenCalled();
    expect(activeSubscriptions).toBe(0);
    expect(container.childElementCount).toBe(0);
  });

  it("cancels an initial render when the panel is closed before it commits", () => {
    const container = document.createElement("div");
    const mounted = jest.fn();
    function Content() {
      useEffect(mounted, []);
      return <div>Panel content</div>;
    }

    act(() => {
      const cleanup = mountPanel(container, <Content />);
      cleanup();
    });

    expect(mounted).not.toHaveBeenCalled();
    expect(container.childElementCount).toBe(0);
  });
});
