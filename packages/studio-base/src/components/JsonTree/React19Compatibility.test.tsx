/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fireEvent, render } from "@testing-library/react";
import JSONTree from "react-json-tree";

describe("patched JSON Tree", () => {
  it("preserves expansion callbacks and externally restored expansion after messages change", () => {
    const onExpand = jest.fn();
    const onCollapse = jest.fn();
    const collapsed = () => false;
    const expanded = () => true;
    const { getByText, queryByText, rerender } = render(
      <JSONTree
        data={{ nested: { answer: 42 } }}
        hideRoot
        shouldExpandNode={collapsed}
        onExpand={onExpand}
        onCollapse={onCollapse}
      />,
    );
    expect(queryByText("answer:")).toBeNull();
    fireEvent.click(getByText("nested:"));
    expect(getByText("answer:")).toBeDefined();
    expect(onExpand).toHaveBeenCalledTimes(1);
    fireEvent.click(getByText("nested:"));
    expect(queryByText("answer:")).toBeNull();
    expect(onCollapse).toHaveBeenCalledTimes(1);
    rerender(
      <JSONTree
        data={{ nested: { answer: 43 } }}
        hideRoot
        shouldExpandNode={expanded}
        onExpand={onExpand}
        onCollapse={onCollapse}
      />,
    );
    expect(getByText("answer:")).toBeDefined();
    expect(getByText("43")).toBeDefined();
    rerender(
      <JSONTree
        data={{ nested: { answer: 44 } }}
        hideRoot
        shouldExpandNode={collapsed}
        onExpand={onExpand}
        onCollapse={onCollapse}
      />,
    );
    expect(queryByText("answer:")).toBeNull();
    expect(onExpand).toHaveBeenCalledTimes(1);
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });
});
