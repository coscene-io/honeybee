/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fireEvent, render, screen } from "@testing-library/react";

import KeyListener from "./KeyListener";

describe("<KeyListener />", () => {
  it.each(["Backquote", "Escape"])(
    "multicasts %s to global panel listeners outside annotation",
    (key) => {
      const first = jest.fn();
      const second = jest.fn();
      render(
        <>
          <KeyListener global keyDownHandlers={{ [key]: first }} />
          <KeyListener global keyDownHandlers={{ [key]: second }} />
          <div data-testid="ordinary-panel" />
          <div data-segmentation-input="canvas" data-testid="annotation-panel" />
        </>,
      );
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      fireEvent(screen.getByTestId("ordinary-panel"), event);
      expect(first).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);

      fireEvent.keyDown(screen.getByTestId("annotation-panel"), { key });
      const consumed = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      consumed.preventDefault();
      fireEvent(screen.getByTestId("ordinary-panel"), consumed);
      expect(first).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledTimes(1);
    },
  );

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

  it.each(["keydown", "keypress", "keyup"])("ignores consumed %s events", (type) => {
    const handler = jest.fn();
    render(
      <KeyListener
        global
        keyDownHandlers={{ " ": handler }}
        keyPressHandlers={{ " ": handler }}
        keyUpHandlers={{ " ": handler }}
      />,
    );
    const event = new KeyboardEvent(type, { key: " ", bubbles: true, cancelable: true });
    event.preventDefault();

    document.dispatchEvent(event);

    expect(handler).not.toHaveBeenCalled();
  });

  it("ignores an event stopped by an earlier native listener on the same target", () => {
    const handler = jest.fn();
    const consume = (event: Event) => {
      event.stopPropagation();
    };
    document.addEventListener("keydown", consume);
    try {
      render(<KeyListener global keyDownHandlers={{ " ": handler }} />);

      document.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));

      expect(handler).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", consume);
    }
  });

  it.each(["keydown", "keypress", "keyup"])(
    "leaves viewport %s events to annotation and native controls",
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
          <div data-segmentation-input="canvas" data-testid="viewport">
            <svg>
              <circle role="button" data-testid="vertex" />
            </svg>
            <button data-testid="retry">Retry</button>
          </div>
          <div data-testid="timeline" />
        </>,
      );

      for (const target of ["viewport", "vertex", "retry"]) {
        for (const key of [" ", "ArrowRight"]) {
          const event = new KeyboardEvent(type, { key, bubbles: true, cancelable: true });
          fireEvent(screen.getByTestId(target), event);
          expect(event.defaultPrevented).toBe(false);
        }
      }
      expect(handler).not.toHaveBeenCalled();

      fireEvent(
        screen.getByTestId("timeline"),
        new KeyboardEvent(type, { key: " ", bubbles: true }),
      );
      expect(handler).toHaveBeenCalledTimes(1);
    },
  );

  it("preserves outside editable fields and dialog event consumption", () => {
    const handler = jest.fn();
    render(
      <>
        <KeyListener global keyDownHandlers={{ " ": handler }} />
        <input aria-label="Seek time" />
        <textarea aria-label="Editor" />
        <div
          role="dialog"
          onKeyDown={(event) => {
            event.preventDefault();
          }}
        >
          <button>Dialog action</button>
        </div>
      </>,
    );

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Seek time" }), { key: " " });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Editor" }), { key: " " });
    fireEvent.keyDown(screen.getByRole("button", { name: "Dialog action" }), { key: " " });

    expect(handler).not.toHaveBeenCalled();
  });

  it("keeps local KeyListener handlers inside the viewport available", () => {
    const handler = jest.fn();
    render(
      <div data-segmentation-input="canvas" data-testid="viewport">
        <KeyListener keyDownHandlers={{ ArrowRight: handler }} />
      </div>,
    );

    fireEvent.keyDown(screen.getByTestId("viewport"), { key: "ArrowRight" });

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
