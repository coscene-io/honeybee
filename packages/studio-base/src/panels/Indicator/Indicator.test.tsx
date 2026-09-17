/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, render, screen } from "@testing-library/react";

import { PanelExtensionContext, MessageEvent } from "@foxglove/studio";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";
import { RosDatatypes } from "@foxglove/studio-base/types/RosDatatypes";

import { Indicator } from "./Indicator";

it("renders an enum-filtered result and reevaluates it when the source schema changes", () => {
  const subscribe = jest.fn();
  const context = {
    initialState: {
      path: "/foo{status==MOVING}.value.@mul(2)",
      rules: [{ operator: "=", rawValue: "6", color: "#00ff00", label: "Matched" }],
      fallbackLabel: "No match",
    },
    watch: jest.fn(),
    subscribe,
    unsubscribeAll: jest.fn(),
    saveState: jest.fn(),
    setDefaultPanelTitle: jest.fn(),
    updatePanelSettingsEditor: jest.fn(),
  } as unknown as PanelExtensionContext;
  render(
    <ThemeProvider isDark>
      <Indicator context={context} />
    </ThemeProvider>,
  );
  const datatypes: RosDatatypes = new Map([
    [
      "foo",
      {
        definitions: [
          { name: "MOVING", type: "uint8", isConstant: true, value: 1 },
          { name: "status", type: "uint8" },
          { name: "value", type: "float64" },
        ],
      },
    ],
  ]);
  const message: MessageEvent = {
    topic: "/foo",
    schemaName: "foo",
    receiveTime: { sec: 0, nsec: 0 },
    sizeInBytes: 0,
    message: { status: 1, value: 3 },
  };
  act(() =>
    context.onRender?.({ extensionData: { datatypes }, currentFrame: [message] }, jest.fn()),
  );
  expect(screen.getByText("Matched")).toBeDefined();
  const nextDatatypes: RosDatatypes = new Map([
    [
      "foo",
      {
        definitions: [
          { name: "MOVING", type: "uint8", isConstant: true, value: 2 },
          { name: "status", type: "uint8" },
          { name: "value", type: "float64" },
        ],
      },
    ],
  ]);
  act(() => context.onRender?.({ extensionData: { datatypes: nextDatatypes } }, jest.fn()));
  expect(screen.getByText("No match")).toBeDefined();
  expect(subscribe).toHaveBeenCalledTimes(1);
});
