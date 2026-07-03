// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { LayoutID } from "@foxglove/studio-base/context/CurrentLayoutContext";
import { Layout } from "@foxglove/studio-base/services/CoSceneILayoutStorage";
import { getFallbackLayoutIdForMissingUrlLayout } from "@foxglove/studio-base/hooks/useSyncLayoutFromUrl";

function layout(id: string, permission: Layout["permission"] = "PERSONAL_WRITE"): Layout {
  return {
    id: id as LayoutID,
    parent: permission === "PERSONAL_WRITE" ? "users/u" : "warehouses/w/projects/p",
    folder: "",
    name: id,
    permission,
    baseline: {
      data: { layout: "Panel!1", configById: {}, globalVariables: {}, userNodes: {} },
      savedAt: undefined,
      modifier: undefined,
      modifierNickname: undefined,
    },
    working: undefined,
    syncInfo: undefined,
  };
}

describe("getFallbackLayoutIdForMissingUrlLayout", () => {
  it("selects the first personal layout before history", async () => {
    const personal1 = layout("users/u/layouts/personal-1");
    const personal2 = layout("users/u/layouts/personal-2");
    const getHistory = jest.fn().mockResolvedValue(layout("users/u/layouts/history"));

    const result = await getFallbackLayoutIdForMissingUrlLayout({
      getLayouts: jest
        .fn()
        .mockResolvedValue([
          layout("warehouses/w/projects/p/layouts/project", "PROJECT_WRITE"),
          personal1,
          personal2,
        ]),
      getHistory,
      getLayout: jest.fn(),
    });

    expect(result).toEqual(personal1.id);
    expect(getHistory).not.toHaveBeenCalled();
  });

  it("falls back to history when no personal layout exists", async () => {
    const historyLayout = layout("users/u/layouts/history");

    await expect(
      getFallbackLayoutIdForMissingUrlLayout({
        getLayouts: jest
          .fn()
          .mockResolvedValue([layout("warehouses/w/projects/p/layouts/project", "PROJECT_WRITE")]),
        getHistory: jest.fn().mockResolvedValue(historyLayout),
        getLayout: jest.fn().mockResolvedValue(historyLayout),
      }),
    ).resolves.toEqual(historyLayout.id);
  });

  it("returns undefined when the history layout can no longer be loaded", async () => {
    await expect(
      getFallbackLayoutIdForMissingUrlLayout({
        getLayouts: jest.fn().mockResolvedValue([]),
        getHistory: jest.fn().mockResolvedValue(layout("users/u/layouts/deleted-history")),
        getLayout: jest.fn().mockResolvedValue(undefined),
      }),
    ).resolves.toBeUndefined();
  });

  it("returns undefined when neither personal nor history layout exists", async () => {
    await expect(
      getFallbackLayoutIdForMissingUrlLayout({
        getLayouts: jest.fn().mockResolvedValue([]),
        getHistory: jest.fn().mockResolvedValue(undefined),
        getLayout: jest.fn(),
      }),
    ).resolves.toBeUndefined();
  });
});
