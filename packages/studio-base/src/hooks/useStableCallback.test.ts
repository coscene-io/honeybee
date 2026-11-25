/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, renderHook } from "@testing-library/react";
import { useState } from "react";

import { useStableActions, useStableCallback } from "./useStableCallback";

describe("useStableCallback", () => {
  it("keeps its identity while calling the latest closure", () => {
    const { result, rerender } = renderHook(
      ({ value }) => {
        const [seen] = useState<string[]>([]);
        return { seen, call: useStableCallback(() => seen.push(value)) };
      },
      { initialProps: { value: "first" } },
    );
    const first = result.current.call;
    rerender({ value: "second" });
    expect(result.current.call).toBe(first);
    act(() => {
      first();
    });
    expect(result.current.seen).toEqual(["second"]);
  });
});

describe("useStableActions", () => {
  it("keeps the object and its members stable and forwards arguments to the latest closures", () => {
    const { result, rerender } = renderHook(
      ({ prefix }) => useStableActions({ greet: (name: string) => `${prefix} ${name}` }),
      { initialProps: { prefix: "hello" } },
    );
    const actions = result.current;
    const greet = actions.greet;
    expect(greet("a")).toBe("hello a");
    rerender({ prefix: "bye" });
    expect(result.current).toBe(actions);
    expect(result.current.greet).toBe(greet);
    expect(greet("b")).toBe("bye b");
  });
});
