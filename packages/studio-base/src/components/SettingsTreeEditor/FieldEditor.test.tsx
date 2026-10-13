/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fireEvent, render, screen } from "@testing-library/react";

import { SettingsTreeAction, SettingsTreeField } from "@foxglove/studio";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";

import { FieldEditor } from "./FieldEditor";

const PATH = ["imageMode", "brightness"] as const;

function renderField(
  field: SettingsTreeField,
  actionHandler: (action: SettingsTreeAction) => void = jest.fn(),
): void {
  render(
    <ThemeProvider isDark={false}>
      <div style={{ display: "grid" }}>
        <FieldEditor actionHandler={actionHandler} field={field} path={PATH} />
      </div>
    </ThemeProvider>,
  );
}

describe("FieldEditor slider", () => {
  it("renders the configured slider and sends slider update actions", () => {
    const actionHandler = jest.fn();
    renderField(
      {
        input: "slider",
        label: "Brightness",
        value: 50,
        min: 0,
        max: 100,
        step: 5,
      },
      actionHandler,
    );

    const slider = screen.getByRole<HTMLInputElement>("slider");
    expect(slider.value).toBe("50");
    expect(slider.min).toBe("0");
    expect(slider.max).toBe("100");
    expect(slider.step).toBe("5");

    fireEvent.change(slider, { target: { value: "75" } });

    expect(actionHandler).toHaveBeenLastCalledWith({
      action: "update",
      payload: {
        path: PATH,
        input: "slider",
        value: 75,
      },
    });
  });

  it.each([
    { state: { disabled: true }, label: "disabled" },
    { state: { readonly: true }, label: "readonly" },
  ])("uses a controlled fallback value and respects $label", ({ state }) => {
    renderField({
      input: "slider",
      label: "Brightness",
      min: 10,
      max: 100,
      ...state,
    });

    const slider = screen.getByRole<HTMLInputElement>("slider");
    expect(slider.value).toBe("10");
    expect(slider.disabled).toBe(true);
  });

  it("shows the off state for a disabled false boolean field", () => {
    renderField({
      input: "boolean",
      label: "Sync annotations",
      value: false,
      disabled: true,
    });

    const [offButton, onButton] = screen.getAllByRole<HTMLButtonElement>("button");
    expect(offButton?.getAttribute("aria-pressed")).toBe("true");
    expect(offButton?.disabled).toBe(true);
    expect(onButton?.getAttribute("aria-pressed")).toBe("false");
  });
});
