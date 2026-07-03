// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create, JsonObject } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { LayoutSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/resources/layout_pb";

import { LayoutID } from "@foxglove/studio-base/context/CurrentLayoutContext";
import { LayoutData } from "@foxglove/studio-base/context/CurrentLayoutContext/actions";
import CoSceneConsoleApiRemoteLayoutStorage from "@foxglove/studio-base/services/CoSceneConsoleApiRemoteLayoutStorage";
import ConsoleApi from "@foxglove/studio-base/services/api/CoSceneConsoleApi";

const layoutData: LayoutData = {
  layout: "Panel!1",
  configById: { "Panel!1": { value: "initial" } },
  globalVariables: {},
  userNodes: {},
};

function layoutId(value: string): LayoutID {
  return value as LayoutID;
}

function makeStorage(api: Partial<ConsoleApi>): CoSceneConsoleApiRemoteLayoutStorage {
  return new CoSceneConsoleApiRemoteLayoutStorage(
    "remote-user",
    "users/u",
    "warehouses/w/projects/p",
    api as ConsoleApi,
  );
}

describe("CoSceneConsoleApiRemoteLayoutStorage", () => {
  it("returns false when delete target lookup reports not found", async () => {
    const id = layoutId("users/u/layouts/1");
    const deleteUserLayout = jest.fn();
    const storage = makeStorage({
      getUserLayout: jest.fn().mockRejectedValue(new ConnectError("missing", Code.NotFound)),
      deleteUserLayout,
    });

    await expect(storage.deleteLayout(id)).resolves.toBe(false);

    expect(deleteUserLayout).not.toHaveBeenCalled();
  });

  it("returns false when a layout disappears during delete", async () => {
    const id = layoutId("users/u/layouts/1");
    const deleteUserLayout = jest
      .fn()
      .mockRejectedValue(new ConnectError("missing", Code.NotFound));
    const storage = makeStorage({
      getUserLayout: jest.fn().mockResolvedValue(
        create(LayoutSchema, {
          name: id,
          displayName: "Layout",
          folder: "",
          data: layoutData as JsonObject,
        }),
      ),
      deleteUserLayout,
    });

    await expect(storage.deleteLayout(id)).resolves.toBe(false);

    expect(deleteUserLayout).toHaveBeenCalledWith({ name: id });
  });

  it("propagates non-not-found delete failures", async () => {
    const id = layoutId("users/u/layouts/1");
    const storage = makeStorage({
      getUserLayout: jest.fn().mockResolvedValue(
        create(LayoutSchema, {
          name: id,
          displayName: "Layout",
          folder: "",
          data: layoutData as JsonObject,
        }),
      ),
      deleteUserLayout: jest
        .fn()
        .mockRejectedValue(new ConnectError("service unavailable", Code.Unavailable)),
    });

    await expect(storage.deleteLayout(id)).rejects.toThrow("service unavailable");
  });
});
