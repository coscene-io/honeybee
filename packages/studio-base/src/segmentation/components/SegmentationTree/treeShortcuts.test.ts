/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import { forwardCanvasShortcut, ownsRowEvent } from "./treeShortcuts";

function reactEvent(
  target: EventTarget,
  init: Partial<ReactKeyboardEvent<HTMLElement>>,
): { event: ReactKeyboardEvent<HTMLElement>; preventDefault: jest.Mock } {
  const preventDefault = jest.fn();
  const event = {
    target,
    key: "",
    code: "",
    defaultPrevented: false,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    repeat: false,
    preventDefault,
    stopPropagation: jest.fn(),
    ...init,
  } as unknown as ReactKeyboardEvent<HTMLElement>;
  return { event, preventDefault };
}

describe("forwarding canvas shortcuts from the tree", () => {
  let viewport: HTMLElement;
  let received: KeyboardEvent[];

  beforeEach(() => {
    viewport = document.createElement("div");
    viewport.dataset.testid = "segmentation-viewport";
    viewport.addEventListener("keydown", (event) => {
      received.push(event);
      event.preventDefault();
    });
    document.body.append(viewport);
    received = [];
  });
  afterEach(() => {
    viewport.remove();
  });

  it("forwards view, history and escape keys and reports them handled", () => {
    for (const init of [
      { key: "f" },
      { key: "z", ctrlKey: true },
      { key: "Escape" },
      { key: "?" },
    ]) {
      const { event, preventDefault } = reactEvent(document.body, init);
      forwardCanvasShortcut(event);
      expect(preventDefault).toHaveBeenCalled();
    }
    expect(received.map((event) => event.key)).toEqual(["f", "z", "Escape", "?"]);
  });

  it("keeps keys that mean something else in the tree", () => {
    for (const init of [
      { key: "Enter" },
      { key: "ArrowLeft" },
      { key: "f", ctrlKey: true },
      { key: "z", ctrlKey: true, altKey: true },
      { key: "f", defaultPrevented: true },
    ]) {
      forwardCanvasShortcut(reactEvent(document.body, init).event);
    }
    expect(received).toEqual([]);
  });

  it("leaves typing in fields and dialogs alone", () => {
    const input = document.createElement("input");
    document.body.append(input);
    forwardCanvasShortcut(reactEvent(input, { key: "f" }).event);
    input.remove();
    expect(received).toEqual([]);
  });

  it("does nothing when no canvas is mounted", () => {
    viewport.remove();
    const { event, preventDefault } = reactEvent(document.body, { key: "f" });
    forwardCanvasShortcut(event);
    expect(preventDefault).not.toHaveBeenCalled();
  });
});

describe("row event ownership", () => {
  function tree(): {
    row: HTMLElement;
    nested: HTMLElement;
    primary: HTMLElement;
    box: HTMLElement;
  } {
    const row = document.createElement("div");
    row.setAttribute("role", "treeitem");
    const primary = document.createElement("button");
    primary.setAttribute("data-tree-primary", "");
    const box = document.createElement("input");
    const nested = document.createElement("div");
    nested.setAttribute("role", "treeitem");
    row.append(primary, box, nested);
    return { row, nested, primary, box };
  }

  it("accepts the row and its primary button only", () => {
    const { row, nested, primary, box } = tree();
    expect(ownsRowEvent(row, row)).toBe(true);
    expect(ownsRowEvent(primary, row)).toBe(true);
    expect(ownsRowEvent(box, row)).toBe(false);
    expect(ownsRowEvent(nested, row)).toBe(false);
    expect(ownsRowEvent(window, row)).toBe(false);
  });
});
