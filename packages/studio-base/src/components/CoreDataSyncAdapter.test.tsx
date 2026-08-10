/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { renderHook, waitFor } from "@testing-library/react";

import { useSetShowtUrlKey } from "@foxglove/studio-base/components/CoreDataSyncAdapter";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import { useTasks } from "@foxglove/studio-base/context/TasksContext";
import { useAppConfigurationValue } from "@foxglove/studio-base/hooks";
import type ConsoleApi from "@foxglove/studio-base/services/api/CoSceneConsoleApi";

jest.mock("@foxglove/studio-base/context/CoSceneConsoleApiContext", () => ({
  useConsoleApi: jest.fn(),
}));
jest.mock("@foxglove/studio-base/context/CoreDataContext", () => ({
  useCoreData: jest.fn(),
}));
jest.mock("@foxglove/studio-base/context/TasksContext", () => ({
  useTasks: jest.fn(),
}));
jest.mock("@foxglove/studio-base/hooks", () => ({
  useAppConfigurationValue: jest.fn(),
}));

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return {
    promise,
    resolve: () => {
      resolve?.();
    },
  };
}

describe("useSetShowtUrlKey", () => {
  it("serializes base-info commits and skips stale selection state", async () => {
    const setExternalInitConfig = jest.fn();
    const setIsReadyForSyncLayout = jest.fn();
    const setProject = jest.fn();
    const setBaseUrl = jest.fn();
    const setShowtUrlKey = jest.fn();
    const setFocusedTask = jest.fn();
    const setLastExternalInitConfig = jest.fn();
    const coreData = {
      project: { loading: false, value: undefined },
      setExternalInitConfig,
      setIsReadyForSyncLayout,
      setProject,
      setBaseUrl,
      setShowtUrlKey,
    } as unknown as CoreDataStore;
    jest.mocked(useCoreData).mockImplementation((selector) => selector(coreData));
    jest.mocked(useTasks).mockImplementation((selector) => selector({ setFocusedTask } as never));
    jest
      .mocked(useAppConfigurationValue)
      .mockReturnValue([undefined, setLastExternalInitConfig] as never);

    const firstBaseInfo = deferred();
    const setApiBaseInfo = jest.fn(async ({ recordId }: { recordId?: string }) => {
      if (recordId === "record-a") {
        await firstBaseInfo.promise;
      }
    });
    const consoleApi = {
      getExternalInitConfig: jest.fn(async (key: string) => ({
        warehouseId: "warehouse",
        projectId: "project",
        recordId: key,
      })),
      setApiBaseInfo,
      getBaseUrl: jest.fn(() => undefined),
      getProject: jest.fn(async () => ({
        name: "warehouses/warehouse/projects/project",
        storageCluster: "clusters/cluster",
      })),
      getStorageCluster: jest.fn(async () => ({ endpoints: [] })),
    } as unknown as ConsoleApi;
    jest.mocked(useConsoleApi).mockReturnValue(consoleApi);

    const { result } = renderHook(() => useSetShowtUrlKey());
    let activeRecord = "record-a";
    const first = result.current("record-a", {
      isCurrent: () => activeRecord === "record-a",
    });
    await waitFor(() => {
      expect(setApiBaseInfo).toHaveBeenCalledTimes(1);
    });

    activeRecord = "record-b";
    const second = result.current("record-b", {
      isCurrent: () => activeRecord === "record-b",
    });
    await Promise.resolve();
    expect(setApiBaseInfo).toHaveBeenCalledTimes(1);

    firstBaseInfo.resolve();
    await Promise.all([first, second]);

    expect(setApiBaseInfo.mock.calls.map(([baseInfo]) => baseInfo.recordId)).toEqual([
      "record-a",
      "record-b",
    ]);
    expect(setExternalInitConfig).toHaveBeenCalledTimes(1);
    expect(setExternalInitConfig).toHaveBeenCalledWith(
      expect.objectContaining({ recordId: "record-b" }),
    );
    expect(setLastExternalInitConfig).toHaveBeenCalledTimes(1);
    expect(setLastExternalInitConfig).toHaveBeenCalledWith(
      JSON.stringify({ warehouseId: "warehouse", projectId: "project", recordId: "record-b" }),
    );
    expect(setShowtUrlKey).toHaveBeenCalledTimes(1);
    expect(setShowtUrlKey).toHaveBeenCalledWith("record-b");
  });
});
