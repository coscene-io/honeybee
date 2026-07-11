/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { render } from "@testing-library/react";
import { JSONTree } from "react-json-tree";

describe("patched react-json-tree", () => {
  it("follows expansion predicate changes after mounting", () => {
    const data = { branch: { leaf: "react-19-visible-leaf" } };
    const { container, rerender } = render(
      <JSONTree data={data} invertTheme={false} shouldExpandNodeInitially={() => true} />,
    );
    expect(container.textContent).toContain("react-19-visible-leaf");

    rerender(<JSONTree data={data} invertTheme={false} shouldExpandNodeInitially={() => false} />);
    expect(container.textContent).not.toContain("react-19-visible-leaf");

    rerender(<JSONTree data={data} invertTheme={false} shouldExpandNodeInitially={() => true} />);
    expect(container.textContent).toContain("react-19-visible-leaf");
  });
});
