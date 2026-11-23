/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import clipboard from "./clipboard";

describe("clipboard.copy", () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const originalExecCommand = Object.getOwnPropertyDescriptor(document, "execCommand");
  const originalSecureContext = Object.getOwnPropertyDescriptor(window, "isSecureContext");
  const execCommand = jest.fn();

  beforeEach(() => {
    execCommand.mockReset().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
  });

  afterEach(() => {
    if (originalClipboard) {
      Object.defineProperty(navigator, "clipboard", originalClipboard);
    } else {
      Reflect.deleteProperty(navigator, "clipboard");
    }
    if (originalExecCommand) {
      Object.defineProperty(document, "execCommand", originalExecCommand);
    } else {
      Reflect.deleteProperty(document, "execCommand");
    }
    if (originalSecureContext) {
      Object.defineProperty(window, "isSecureContext", originalSecureContext);
    } else {
      Reflect.deleteProperty(window, "isSecureContext");
    }
    window.getSelection()?.removeAllRanges();
  });

  it("copies multiline text on HTTP without changing the DOM or button focus", async () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.focus();
    const text = "分享链接\nhttps://example.com/viz?time=123&name=test  value";
    const originalBody = document.body.innerHTML;
    execCommand.mockImplementation(() => {
      expect(window.getSelection()?.toString()).toBe(text);
      return true;
    });
    try {
      await expect(clipboard.copy(text)).resolves.toBeUndefined();
      expect(execCommand).toHaveBeenCalledWith("copy");
      expect(document.body.innerHTML).toBe(originalBody);
      expect(document.activeElement).toBe(button);
    } finally {
      button.remove();
    }
  });

  it("uses the async API when available", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await clipboard.copy("share URL");
    expect(writeText).toHaveBeenCalledWith("share URL");
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("falls back when the async API rejects", async () => {
    const writeText = jest.fn().mockRejectedValue(new Error("Permission denied"));
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await expect(clipboard.copy("share URL")).resolves.toBeUndefined();
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("reports failure instead of success when the fallback is refused", async () => {
    const prompt = jest.spyOn(window, "prompt");
    const originalBody = document.body.innerHTML;
    execCommand.mockReturnValue(false);
    await expect(clipboard.copy("share URL")).rejects.toThrow("Could not copy to clipboard");
    expect(prompt).not.toHaveBeenCalled();
    expect(document.body.innerHTML).toBe(originalBody);
  });

  it("cleans up if the fallback throws", async () => {
    const originalBody = document.body.innerHTML;
    execCommand.mockImplementation(() => {
      throw new Error("Copy unavailable");
    });
    await expect(clipboard.copy("share URL")).rejects.toThrow("Could not copy to clipboard");
    expect(document.body.innerHTML).toBe(originalBody);
  });

  it("restores the previous text selection after HTTP copying", async () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = "Previously selected text";
    document.body.appendChild(paragraph);
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    window.getSelection()?.addRange(range);
    try {
      await clipboard.copy("share URL");
      expect(window.getSelection()?.toString()).toBe("Previously selected text");
    } finally {
      paragraph.remove();
    }
  });
});
