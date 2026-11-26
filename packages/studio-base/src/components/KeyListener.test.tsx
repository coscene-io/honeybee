/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fireEvent, render, screen } from "@testing-library/react";

import KeyListener from "./KeyListener";
import { inputOwnerProps } from "./inputOwnership";

const ownerWithArrows = inputOwnerProps(["ArrowLeft", "ArrowRight"]);

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

  // Regression: a guard on defaultPrevented / cancelBubble swallowed shortcuts app-wide,
  // because MUI Slider, Menu, Autocomplete and editors prevent or stop key events routinely.
  it.each(["keydown", "keypress", "keyup"])(
    "still handles %s events that controls outside an input owner prevented or stopped",
    (type) => {
      const handler = jest.fn();
      const stop = (event: Event) => {
        event.stopPropagation();
      };
      render(
        <>
          <KeyListener
            global
            keyDownHandlers={{ ArrowRight: handler }}
            keyPressHandlers={{ ArrowRight: handler }}
            keyUpHandlers={{ ArrowRight: handler }}
          />
          <span role="slider" aria-valuenow={0} data-testid="slider" />
        </>,
      );

      const prevented = new KeyboardEvent(type, {
        key: "ArrowRight",
        bubbles: true,
        cancelable: true,
      });
      prevented.preventDefault();
      fireEvent(screen.getByTestId("slider"), prevented);
      expect(handler).toHaveBeenCalledTimes(1);

      // Another listener on the document itself stopping propagation does not hide the event
      // from listeners registered on the same node.
      document.addEventListener(type, stop);
      try {
        document.dispatchEvent(new KeyboardEvent(type, { key: "ArrowRight", bubbles: true }));
      } finally {
        document.removeEventListener(type, stop);
      }
      expect(handler).toHaveBeenCalledTimes(2);
    },
  );

  it.each(["Backquote", "Escape"])("multicasts %s to every global listener", (key) => {
    const first = jest.fn();
    const second = jest.fn();
    render(
      <>
        <KeyListener global keyDownHandlers={{ [key]: first }} />
        <KeyListener global keyDownHandlers={{ [key]: second }} />
        <div data-testid="ordinary-panel" />
        <div {...inputOwnerProps()} data-testid="owner" />
      </>,
    );
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    fireEvent(screen.getByTestId("ordinary-panel"), event);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);

    fireEvent.keyDown(screen.getByTestId("owner"), { key });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it.each(["keydown", "keypress", "keyup"])(
    "leaves %s events inside an input owner to the owner and its native controls",
    (type) => {
      const handler = jest.fn();
      render(
        <>
          <KeyListener
            global
            keyDownHandlers={{ " ": handler, ArrowRight: handler }}
            keyPressHandlers={{ " ": handler, ArrowRight: handler }}
            keyUpHandlers={{ " ": handler, ArrowRight: handler }}
          />
          <div {...ownerWithArrows} data-testid="viewport">
            <svg>
              <circle role="button" data-testid="vertex" />
            </svg>
            <button data-testid="retry">Retry</button>
          </div>
          <div data-testid="timeline" />
        </>,
      );

      for (const target of ["viewport", "vertex", "retry"]) {
        const event = new KeyboardEvent(type, { key: " ", bubbles: true, cancelable: true });
        fireEvent(screen.getByTestId(target), event);
        expect(event.defaultPrevented).toBe(false);
      }
      // A native control inside the owner keeps its arrows.
      fireEvent(
        screen.getByTestId("retry"),
        new KeyboardEvent(type, { key: "ArrowRight", bubbles: true, cancelable: true }),
      );
      expect(handler).not.toHaveBeenCalled();
      // A passed-through key the owner consumed stays with the owner.
      const consumed = new KeyboardEvent(type, {
        key: "ArrowRight",
        bubbles: true,
        cancelable: true,
      });
      consumed.preventDefault();
      fireEvent(screen.getByTestId("viewport"), consumed);
      expect(handler).not.toHaveBeenCalled();
      // A passed-through key the owner did not consume reaches global shortcuts.
      fireEvent(
        screen.getByTestId("viewport"),
        new KeyboardEvent(type, { key: "ArrowRight", bubbles: true, cancelable: true }),
      );
      expect(handler).toHaveBeenCalledTimes(1);
      handler.mockClear();

      fireEvent(
        screen.getByTestId("timeline"),
        new KeyboardEvent(type, { key: " ", bubbles: true }),
      );
      expect(handler).toHaveBeenCalledTimes(1);
    },
  );

  it("ignores editable fields and input-owning dialogs", () => {
    const handler = jest.fn();
    render(
      <>
        <KeyListener global keyDownHandlers={{ " ": handler }} />
        <input aria-label="Seek time" />
        <textarea aria-label="Editor" />
        <div role="dialog" {...inputOwnerProps()}>
          <button>Dialog action</button>
        </div>
      </>,
    );

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Seek time" }), { key: " " });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Editor" }), { key: " " });
    fireEvent.keyDown(screen.getByRole("button", { name: "Dialog action" }), { key: " " });

    expect(handler).not.toHaveBeenCalled();
  });

  it("passes Space through when the owner lists it", () => {
    const handler = jest.fn();
    render(
      <>
        <KeyListener global keyDownHandlers={{ " ": handler }} />
        <div {...inputOwnerProps([" "])} data-testid="owner" />
      </>,
    );

    fireEvent.keyDown(screen.getByTestId("owner"), { key: " " });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("keeps a passed-through key that a local listener inside the owner consumed", () => {
    const global = jest.fn();
    const local = jest.fn();
    render(
      <>
        <KeyListener global keyDownHandlers={{ ArrowRight: global }} />
        <div {...ownerWithArrows} data-testid="owner">
          <KeyListener keyDownHandlers={{ ArrowRight: local }} />
        </div>
      </>,
    );

    fireEvent.keyDown(screen.getByTestId("owner"), { key: "ArrowRight", cancelable: true });

    expect(local).toHaveBeenCalledTimes(1);
    expect(global).not.toHaveBeenCalled();
  });

  it("keeps local KeyListener handlers inside an input owner available", () => {
    const handler = jest.fn();
    render(
      <div {...inputOwnerProps()} data-testid="viewport">
        <KeyListener keyDownHandlers={{ ArrowRight: handler }} />
      </div>,
    );

    fireEvent.keyDown(screen.getByTestId("viewport"), { key: "ArrowRight" });

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
