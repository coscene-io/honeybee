/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { render, act } from "@testing-library/react";

import { signal } from "@foxglove/den/async";
import { PanelExtensionContext } from "@foxglove/studio";
import MockPanelContextProvider from "@foxglove/studio-base/components/MockPanelContextProvider";
import PanelSetup from "@foxglove/studio-base/stories/PanelSetup";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";

import PanelExtensionAdapter from "./PanelExtensionAdapter";

describe("PanelExtensionAdapter", () => {
  it("should call initPanel", async () => {
    expect.assertions(1);

    const sig = signal();
    const initPanel = (context: PanelExtensionContext) => {
      expect(context).toBeDefined();
      sig.resolve();
    };

    const config = {};
    const saveConfig = () => {};

    const Wrapper = () => {
      return (
        <ThemeProvider isDark>
          <MockPanelContextProvider>
            <PanelSetup>
              <PanelExtensionAdapter
                config={config}
                saveConfig={saveConfig}
                initPanel={initPanel}
              />
            </PanelSetup>
          </MockPanelContextProvider>
        </ThemeProvider>
      );
    };

    const handle = render(<Wrapper />);
    await act(async () => undefined);

    // force a re-render to make sure we do not call init panel again
    handle.rerender(<Wrapper />);
    await sig;
  });
});
