/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fireEvent, render, screen } from "@testing-library/react";

import { PanelContextMenu, PanelContextMenuItem } from "./PanelContextMenu";
import { PANEL_ROOT_CLASS_NAME } from "./PanelRoot";

function setup() {
  const getItems = jest.fn((): PanelContextMenuItem[] => [
    { type: "item", label: "Panel action", onclick: jest.fn() },
  ]);
  render(
    <div className={PANEL_ROOT_CLASS_NAME}>
      <PanelContextMenu getItems={getItems} />
      <div data-testid="outside">Other panel content</div>
      <div
        data-segmentation-input="canvas"
        data-testid="viewport"
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
        onMouseUp={(event) => {
          event.stopPropagation();
        }}
        onContextMenu={(event) => {
          event.stopPropagation();
        }}
      >
        <svg>
          <circle role="button" data-testid="vertex" />
        </svg>
        <button data-testid="retry">Retry</button>
      </div>
    </div>,
  );
  return { getItems };
}

describe("PanelContextMenu annotation input routing", () => {
  it.each(["viewport", "vertex", "retry"])(
    "ignores right clicks on %s before React can stop propagation",
    (targetId) => {
      const { getItems } = setup();
      const target = screen.getByTestId(targetId);

      fireEvent.mouseDown(target, { button: 2 });
      fireEvent.mouseUp(target, { button: 2 });
      const contextMenu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      fireEvent(target, contextMenu);

      expect(getItems).not.toHaveBeenCalled();
      expect(screen.queryByRole("menu")).toBeNull();
      expect(contextMenu.defaultPrevented).toBe(false);
    },
  );

  it.each([
    ["outside", "viewport"],
    ["viewport", "outside"],
  ])("does not open for a press on %s and release on %s", (downTarget, upTarget) => {
    const { getItems } = setup();

    fireEvent.mouseDown(screen.getByTestId(downTarget), { button: 2 });
    fireEvent.mouseUp(screen.getByTestId(upTarget), { button: 2 });
    fireEvent.mouseUp(screen.getByTestId("outside"), { button: 2 });

    expect(getItems).not.toHaveBeenCalled();
  });

  it("cancels an outside press when a contextmenu event originates in the viewport", () => {
    const { getItems } = setup();

    fireEvent.mouseDown(screen.getByTestId("outside"), { button: 2 });
    fireEvent.contextMenu(screen.getByTestId("viewport"));
    fireEvent.mouseUp(screen.getByTestId("outside"), { button: 2 });

    expect(getItems).not.toHaveBeenCalled();
  });

  it("preserves ordinary panel right clicks outside the viewport", () => {
    const { getItems } = setup();
    const outside = screen.getByTestId("outside");

    fireEvent.mouseDown(outside, { button: 2 });
    fireEvent.mouseUp(outside, { button: 2, clientX: 20, clientY: 30 });
    const contextMenu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    fireEvent(outside, contextMenu);

    expect(getItems).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("menuitem", { name: "Panel action" })).toBeDefined();
    expect(contextMenu.defaultPrevented).toBe(true);
  });

  it("still cancels panel menus after mouse movement", () => {
    const { getItems } = setup();
    const outside = screen.getByTestId("outside");

    fireEvent.mouseDown(outside, { button: 2 });
    fireEvent.mouseMove(screen.getByTestId("viewport"));
    fireEvent.mouseUp(outside, { button: 2 });

    expect(getItems).not.toHaveBeenCalled();
  });
});
