/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { renderHook, act } from "@testing-library/react";

import { useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import CoreDataProvider from "@foxglove/studio-base/providers/CoreDataProvider";
import { mockDesktopLocks } from "@foxglove/studio-base/test/mockDesktopLocks";
import {
  installDesktopCredential,
  clearDesktopCredential,
  setDesktopLocalPlayback,
} from "@foxglove/studio-base/util/desktopSession";
import { SHARE_MANIFEST_DATA_SOURCE_ID } from "@foxglove/studio-base/util/shareManifest";

describe("CoreDataProvider", () => {
  it("disables login-backed workspace features for share manifest playback", () => {
    const { result } = renderHook(
      () => ({
        setDataSource: useCoreData((state) => state.setDataSource),
        getEnableList: useCoreData((state) => state.getEnableList),
      }),
      {
        wrapper: CoreDataProvider,
      },
    );

    act(() => {
      result.current.setDataSource({
        id: SHARE_MANIFEST_DATA_SOURCE_ID,
        type: "connection",
      });
    });

    expect(result.current.getEnableList()).toEqual({
      event: "DISABLE",
      playlist: "DISABLE",
      task: "DISABLE",
      layoutSync: "DISABLE",
      recordInfo: "DISABLE",
    });
  });
});

it("clears authenticated core data without removing the anonymous playback source", async () => {
  mockDesktopLocks();
  localStorage.clear();
  await installDesktopCredential("Bearer initial", "core:1");
  setDesktopLocalPlayback({ local: true });
  const { result, unmount } = renderHook(() => useCoreData((state) => state), {
    wrapper: CoreDataProvider,
  });
  const source = { id: SHARE_MANIFEST_DATA_SOURCE_ID, type: "connection" as const };
  act(() => {
    result.current.setDataSource(source);
    result.current.setExternalInitConfig({
      projectId: "old-project",
      warehouseId: "old-warehouse",
    });
  });
  await act(async () => {
    await clearDesktopCredential();
  });
  expect(result.current.dataSource).toBe(source);
  expect(result.current.externalInitConfig).toBeUndefined();
  expect(result.current.colinkApi).toBeUndefined();
  expect(result.current.organization.value).toBeUndefined();
  unmount();
  setDesktopLocalPlayback({ local: false });
});
