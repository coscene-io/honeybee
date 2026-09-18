/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { renderHook } from "@testing-library/react";

import { useMomentScrollTarget } from "./useMomentScrollTarget";

it("lets new hover override a later static selection, then pauses and resumes on list interaction", () => {
  const order = new Map([
    ["early", 0],
    ["late", 1],
  ]);
  const { result, rerender } = renderHook((props) => useMomentScrollTarget({ ...props, order }), {
    initialProps: { selected: "late", hovered: new Set<string>(), disabled: false },
  });
  expect(result.current).toBe("late");
  rerender({ selected: "late", hovered: new Set(["early"]), disabled: false });
  expect(result.current).toBe("early");
  rerender({ selected: "late", hovered: new Set(["early"]), disabled: true });
  expect(result.current).toBeUndefined();
  rerender({ selected: "late", hovered: new Set(["early"]), disabled: false });
  expect(result.current).toBe("late");
});
