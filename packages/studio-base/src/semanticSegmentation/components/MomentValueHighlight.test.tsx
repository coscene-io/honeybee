/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, render } from "@testing-library/react";

import { MomentMetadataValue } from "@foxglove/studio-base/components/Events/MomentMetadataValue";
import { registerWorkspaceSlot } from "@foxglove/studio-base/context/WorkspaceSlots";

import { SpatialReferenceValue } from "./ActiveMomentReference";

describe("MomentMetadataValue", () => {
  it("highlights the list filter in plain values", () => {
    const { container } = render(<MomentMetadataValue value="front camera" highlight="cam" />);
    expect([...container.querySelectorAll("mark")].map((mark) => mark.textContent)).toEqual([
      "cam",
    ]);
  });

  // U5: spatial:// values used to drop the highlight and show Chinese in the English UI.
  it("lets a registered renderer show its values, keeping the highlight", () => {
    let unregister = () => {};
    act(() => {
      unregister = registerWorkspaceSlot("momentValueRenderers", "test", ({ value, highlight }) =>
        value.startsWith("spatial://") ? (
          <SpatialReferenceValue value={value} highlight={highlight} />
        ) : undefined,
      );
    });
    try {
      const { container } = render(
        <MomentMetadataValue value="spatial://record-1/instance/inst-7" highlight="inst-7" />,
      );
      expect(container.textContent).toBe("Spatial reference · instance inst-7 (record not open)");
      expect([...container.querySelectorAll("mark")].map((mark) => mark.textContent)).toEqual([
        "inst-7",
      ]);
    } finally {
      act(() => {
        unregister();
      });
    }
  });
});
