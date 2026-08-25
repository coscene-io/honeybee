/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create } from "@bufbuild/protobuf";
import { DeviceSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/resources/device_pb";
import { ListProjectDevicesResponseSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/services/device_pb";
import { fireEvent, render, screen, within } from "@testing-library/react";

import DevicesTable from "@foxglove/studio-base/components/Tasks/TaskDetailDrawer/components/LinkedDevicesTable/components/DevicesTable";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";

jest.mock("@foxglove/studio-base/context/CoreDataContext", () => ({
  useCoreData: (selector: (store: Record<string, unknown>) => unknown) =>
    selector({
      deviceCustomFieldSchema: undefined,
      organization: { value: { slug: "org" } },
      project: { value: { slug: "proj" } },
      externalInitConfig: {},
    }),
}));

jest.mock("@foxglove/studio-base/hooks/useConfirm", () => ({
  useConfirm: () => jest.fn(),
}));

jest.mock("@foxglove/studio-base/components/Tasks/TaskDetailDrawer/useSelectSource", () => ({
  useVizTargetSource: () => jest.fn(),
}));

function makeDevicesResponse() {
  return create(ListProjectDevicesResponseSchema, {
    totalSize: 2n,
    projectDevices: [
      create(DeviceSchema, {
        name: "devices/one",
        serialNumber: "SN-1",
        displayName: "Device One",
      }),
      create(DeviceSchema, {
        name: "devices/two",
        serialNumber: "SN-2",
        displayName: "Device Two",
      }),
    ],
  });
}

describe("DevicesTable", () => {
  it("reports selected device ids through the v9 selection model", () => {
    const onSelectionChange = jest.fn();
    const onBatchAction = jest.fn();

    render(
      <ThemeProvider isDark>
        <div style={{ height: 400, width: 800 }}>
          <DevicesTable
            linkedDevicesResponse={makeDevicesResponse()}
            pageSize={10}
            currentPage={0}
            setPageSize={jest.fn()}
            setCurrentPage={jest.fn()}
            onSelectionChange={onSelectionChange}
            onBatchAction={onBatchAction}
            batchActionButtonText="Unlink"
          />
        </div>
      </ThemeProvider>,
    );

    const firstRow = screen.getByRole("row", { name: /SN-1/ });
    fireEvent.click(within(firstRow).getByRole("checkbox", { name: "Select row" }));

    expect(onSelectionChange).toHaveBeenCalledWith(["devices/one"]);
    expect(screen.getByText("Selected 1 rows")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
    expect(onBatchAction).toHaveBeenCalledWith(["devices/one"]);
  });
});
