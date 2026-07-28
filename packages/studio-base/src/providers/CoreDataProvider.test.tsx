/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { renderHook, act } from "@testing-library/react";

import { useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import CoreDataProvider from "@foxglove/studio-base/providers/CoreDataProvider";
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
