/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import ButtonBase from "@mui/material/ButtonBase";
import type { ButtonBaseActions } from "@mui/material/ButtonBase";
import useLazyRipple from "@mui/material/useLazyRipple";
import { act, fireEvent, render, renderHook } from "@testing-library/react";
import { createRef, StrictMode, useState } from "react";

function observeRippleMounts() {
  // Observe the real implementation: disabled ripples have no DOM either way, but a mount request
  // that can never resolve retains synthetic events and the detached DOM in their relatedTarget.
  const hook = renderHook(useLazyRipple);
  const prototype = Object.getPrototypeOf(hook.result.current) as ReturnType<typeof useLazyRipple>;
  hook.unmount();
  return jest.spyOn(prototype, "mount");
}

it.each(["disableRipple", "disabled"] as const)(
  "does not queue disabled ripple work while preserving event callbacks (%s)",
  async (disabledProp) => {
    const mount = observeRippleMounts();
    const handlers = {
      onBlur: jest.fn(),
      onContextMenu: jest.fn(),
      onDragLeave: jest.fn(),
      onFocus: jest.fn(),
      onKeyDown: jest.fn(),
      onKeyUp: jest.fn(),
      onMouseDown: jest.fn(),
      onMouseLeave: jest.fn(),
      onMouseUp: jest.fn(),
      onTouchStart: jest.fn(),
      onTouchEnd: jest.fn(),
      onTouchMove: jest.fn(),
    };
    const view = render(
      <StrictMode>
        <ButtonBase component="div" focusRipple {...{ [disabledProp]: true }} {...handlers}>
          Button
        </ButtonBase>
      </StrictMode>,
    );
    const button = view.getByRole("button");
    await act(async () => {
      fireEvent.mouseDown(button);
      fireEvent.mouseUp(button);
      fireEvent.mouseLeave(button);
      fireEvent.contextMenu(button);
      fireEvent.dragLeave(button);
      fireEvent.touchStart(button);
      fireEvent.touchMove(button);
      fireEvent.touchEnd(button);
      fireEvent.focus(button);
      fireEvent.keyDown(button, { key: " " });
      fireEvent.keyUp(button, { key: " " });
      fireEvent.blur(button, { relatedTarget: document.createElement("button") });
    });
    for (const [name, handler] of Object.entries(handlers)) {
      // MUI 9 suppresses keyboard handlers on disabled non-native buttons.
      const suppressed =
        disabledProp === "disabled" && (name === "onKeyDown" || name === "onKeyUp");
      expect(handler).toHaveBeenCalledTimes(suppressed ? 0 : 1);
    }
    expect(mount).not.toHaveBeenCalled();
    expect(view.container.querySelector(".MuiTouchRipple-root")).toBeNull();
  },
);

it("keeps enabled pointer and focus ripples working through StrictMode replay", async () => {
  const action = createRef<ButtonBaseActions>();
  const view = render(
    <StrictMode>
      <ButtonBase action={action} focusRipple>
        Button
      </ButtonBase>
    </StrictMode>,
  );
  const button = view.getByRole("button");
  await act(async () => {
    fireEvent.mouseDown(button);
  });
  expect(view.container.querySelector(".MuiTouchRipple-rippleVisible")).not.toBeNull();
  await act(async () => {
    fireEvent.mouseUp(button);
    action.current?.focusVisible();
  });
  expect(view.container.querySelector(".MuiTouchRipple-ripplePulsate")).not.toBeNull();
  view.unmount();
  await act(async () => undefined);
});

it.each(["disableRipple", "disabled"] as const)(
  "settles a pending mount when an event callback sets %s and allows re-enabling",
  async (disabledProp) => {
    const mount = observeRippleMounts();
    let disableOnPress = true;
    function Harness() {
      const [disabled, setDisabled] = useState(false);
      return (
        <>
          <ButtonBase
            {...{ [disabledProp]: disabled }}
            onMouseDown={() => {
              if (disableOnPress) {
                setDisabled(true);
              }
            }}
          >
            Target
          </ButtonBase>
          <button
            onClick={() => {
              setDisabled(false);
            }}
          >
            Enable
          </button>
        </>
      );
    }
    const view = render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );
    await act(async () => {
      fireEvent.mouseDown(view.getByRole("button", { name: "Target" }));
    });
    const result = mount.mock.results[0]!;
    expect(result.type).toBe("return");
    const pending = result.value as ReturnType<ReturnType<typeof useLazyRipple>["mount"]>;
    const settled = jest.fn();
    void pending.then(settled);
    await act(async () => undefined);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(view.container.querySelector(".MuiTouchRipple-root")).toBeNull();

    disableOnPress = false;
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Enable" }));
    });
    // The cancelled event must not be replayed against the new ripple ref.
    expect(view.container.querySelector(".MuiTouchRipple-rippleVisible")).toBeNull();
    await act(async () => {
      fireEvent.mouseDown(view.getByRole("button", { name: "Target" }));
    });
    expect(view.container.querySelector(".MuiTouchRipple-rippleVisible")).not.toBeNull();
    view.unmount();
    await act(async () => undefined);
  },
);

it("settles pending ripple work when the button unmounts before the first ripple commit", async () => {
  const mount = observeRippleMounts();
  function Harness() {
    const [open, setOpen] = useState(true);
    return open ? (
      <ButtonBase
        onMouseDown={() => {
          setOpen(false);
        }}
      >
        Close
      </ButtonBase>
    ) : undefined;
  }
  const view = render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
  await act(async () => {
    fireEvent.mouseDown(view.getByRole("button"));
  });
  const pending = mount.mock.results[0]!.value as ReturnType<
    ReturnType<typeof useLazyRipple>["mount"]
  >;
  const settled = jest.fn();
  void pending.then(settled);
  await act(async () => undefined);
  expect(settled).toHaveBeenCalledTimes(1);
  expect(view.queryByRole("button")).toBeNull();
});
