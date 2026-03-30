/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { render } from "@testing-library/react";

import KeyListener from "./KeyListener";

describe("<KeyListener />", () => {
  it("matches handlers by keyboard code", () => {
    const handler = jest.fn();

    render(<KeyListener global keyDownHandlers={{ KeyO: handler }} />);

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        altKey: true,
        bubbles: true,
        code: "KeyO",
        key: "ø",
      }),
    );

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
