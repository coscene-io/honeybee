/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create } from "@bufbuild/protobuf";
import { RecordSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/resources/record_pb";
import { ListRecordsResponseSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/services/record_pb";
import { fireEvent, render, screen, within } from "@testing-library/react";

import RecordTable from "@foxglove/studio-base/components/Tasks/TaskDetailDrawer/components/LinkedRecordsTable/components/RecordTable";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";

jest.mock("@foxglove/studio-base/context/CoreDataContext", () => ({
  useCoreData: (selector: (store: Record<string, unknown>) => unknown) =>
    selector({
      recordCustomFieldSchema: undefined,
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

jest.mock("@foxglove/studio-base/context/CoSceneConsoleApiContext", () => ({
  useConsoleApi: () => ({
    batchGetUsers: jest.fn(async () => await new Promise(() => {})),
  }),
}));

function makeRecordsResponse() {
  return create(ListRecordsResponseSchema, {
    totalSize: 2n,
    records: [
      create(RecordSchema, {
        name: "records/one",
        title: "Record One",
      }),
      create(RecordSchema, {
        name: "records/two",
        title: "Record Two",
      }),
    ],
  });
}

describe("RecordTable", () => {
  it("reports selected record ids through the v9 selection model", () => {
    const onSelectionChange = jest.fn();
    const onBatchAction = jest.fn();

    render(
      <ThemeProvider isDark>
        <div style={{ height: 400, width: 800 }}>
          <RecordTable
            listRecordsResponse={makeRecordsResponse()}
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

    const firstRow = screen.getByRole("row", { name: /Record One/ });
    fireEvent.click(within(firstRow).getByRole("checkbox", { name: "Select row" }));

    expect(onSelectionChange).toHaveBeenCalledWith(["records/one"]);
    expect(screen.getByText("Selected 1 rows")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
    expect(onBatchAction).toHaveBeenCalledWith(["records/one"]);
  });
});
