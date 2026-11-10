/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { render } from "@testing-library/react";
import { createRef, StrictMode } from "react";

import { mergeRefs } from "./mergeRefs";

it("cleans up callback and object refs across StrictMode replay and unmount", () => {
  const cleanup = jest.fn();
  const callback = jest.fn(() => cleanup);
  const legacyCallback = jest.fn();
  const objectRef = createRef<HTMLDivElement>();
  const ref = mergeRefs<HTMLDivElement>(callback, legacyCallback, objectRef);
  const { unmount, getByTestId } = render(
    <StrictMode>
      <div data-testid="target" ref={ref} />
    </StrictMode>,
  );
  expect(objectRef.current).toBe(getByTestId("target"));
  const attachmentCount = callback.mock.calls.length;
  unmount();
  expect(cleanup).toHaveBeenCalledTimes(attachmentCount);
  expect(objectRef.current).toBeNull();
  expect(legacyCallback).toHaveBeenLastCalledWith(ReactNull);
});

it("releases remaining refs when another owner's cleanup throws", () => {
  const objectRef = createRef<HTMLDivElement>();
  const error = new Error("cleanup failed");
  const ref = mergeRefs<HTMLDivElement>(
    () => () => {
      throw error;
    },
    objectRef,
  );
  const cleanup = ref(document.createElement("div"));
  expect(typeof cleanup).toBe("function");
  expect(cleanup).toThrow(AggregateError);
  expect(objectRef.current).toBeNull();
});
