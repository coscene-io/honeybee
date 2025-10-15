// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { FieldMask, JsonObject } from "@bufbuild/protobuf";
import { User as CoUser } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/user_pb";
import { LayoutScopeEnum_LayoutScope } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/enums/layout_scope_pb";
import { Layout } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/resources/layout_pb";
import _uniq from "lodash/uniq";

import Logger from "@foxglove/log";
import { LayoutID } from "@foxglove/studio-base/context/CurrentLayoutContext";
import { LayoutData } from "@foxglove/studio-base/context/CurrentLayoutContext/actions";
import {
  IRemoteLayoutStorage,
  RemoteLayout,
} from "@foxglove/studio-base/services/CoSceneIRemoteLayoutStorage";
import ConsoleApi from "@foxglove/studio-base/services/api/CoSceneConsoleApi";
import { convertJsonToStruct, replaceNullWithUndefined } from "@foxglove/studio-base/util/coscene";

import { ISO8601Timestamp } from "./CoSceneILayoutStorage";

const log = Logger.getLogger(__filename);

type LayoutPermission = "PERSONAL_WRITE" | "PROJECT_READ" | "PROJECT_WRITE";

function convertGrpcLayoutToRemoteLayout({
  layout,
  users,
}: {
  layout: Layout;
  users: CoUser[];
}): RemoteLayout {
  if (!layout.data) {
    throw new Error(`Missing data for server layout ${layout.displayName} (${layout.name})`);
  }

  let data: LayoutData;
  try {
    data = replaceNullWithUndefined(layout.data.toJson() as JsonObject) as LayoutData;
  } catch (err) {
    throw new Error(`Invalid layout data for ${layout.displayName}: ${err}`);
  }

  // Parse layout name to extract ID and parent
  const id = layout.name as LayoutID;
  const layoutNameParts = id.split("/layouts/");
  if (layoutNameParts.length !== 2 || !layoutNameParts[1] || !layoutNameParts[0]) {
    throw new Error(
      `Invalid layout name format: ${layout.name}. Expected format: '<parent>/layouts/<id>'`,
    );
  }

  const parent = layoutNameParts[0];

  // Determine permission based on resource name pattern
  let permission: LayoutPermission;
  if (id.startsWith("warehouses/")) {
    permission = "PROJECT_WRITE";
  } else if (id.startsWith("users/")) {
    permission = "PERSONAL_WRITE";
  } else {
    throw new Error(`Invalid parent for layout ${layout.displayName}: ${parent}`);
  }

  const modifier = users.find((user) => user.name === layout.modifier);

  return {
    id,
    parent,
    folder: layout.folder,
    name: layout.displayName,
    permission,
    data,
    savedAt: layout.modifyTime?.toDate().toISOString() as ISO8601Timestamp,
    updatedAt: layout.modifyTime?.toDate().toISOString() as ISO8601Timestamp,
    modifier: layout.modifier,
    modifierAvatar: modifier?.avatar,
    modifierNickname: modifier?.nickname,
  };
}

export default class CoSceneConsoleApiRemoteLayoutStorage implements IRemoteLayoutStorage {
  public constructor(
    public readonly namespace: string,
    public readonly userName: string,
    public readonly projectName: string | undefined,
    private api: ConsoleApi,
  ) { }

  public async getLayouts(): Promise<readonly RemoteLayout[]> {
    try {
      const parents = [this.userName];
      if (this.projectName) {
        parents.push(this.projectName);
      }
      if (parents.length === 0) {
        return [];
      }

      const layouts = await Promise.all(
        parents.map(async (parent) => {
          let allLayouts: Layout[] = [];
          try {
            if (parent.startsWith("users/")) {
              allLayouts = (await this.api.listUserLayouts({ parent })).userLayouts;
            } else if (parent.startsWith("warehouses/")) {
              allLayouts = (await this.api.listProjectLayouts({ parent })).projectLayouts;
            }
          } catch (err) {
            log.error("Failed to get layouts for parent:", parent, err);
          }

          const modifiers: string[] = allLayouts
            .map((layout) => layout.modifier)
            .filter((modifier): modifier is string => Boolean(modifier));
          const users = modifiers.length > 0 ? (await this.api.batchGetUsers(modifiers)).users : [];

          return allLayouts.map((layout) =>
            convertGrpcLayoutToRemoteLayout({ layout, users }),
          );
        }),
      );

      return layouts.flat();
    } catch (err) {
      log.error("Failed to get layouts:", err);
      return [];
    }
  }

  public async getLayout(name: LayoutID): Promise<RemoteLayout | undefined> {
    try {
      let layout;
      if (name.startsWith("users/")) {
        layout = await this.api.getUserLayout({ name });
      } else if (name.startsWith("warehouses/")) {
        layout = await this.api.getProjectLayout({ name });
      }

      if (layout == undefined) {
        return undefined;
      }

      const users = layout.modifier
        ? await this.api.batchGetUsers([layout.modifier])
        : { users: [] };
      return convertGrpcLayoutToRemoteLayout({
        layout,
        users: users.users,
      });
    } catch (err) {
      log.error("Failed to get layout:", err);
      return undefined;
    }
  }

  public async saveNewLayout({
    id,
    parent,
    folder,
    name,
    data,
    permission,
  }: {
    id: LayoutID | undefined;
    parent: string;
    folder: string;
    name: string;
    data: LayoutData;
    permission: LayoutPermission;
  }): Promise<RemoteLayout> {
    const layout = new Layout({
      name: id,
      displayName: name,
      folder,
      data: convertJsonToStruct(data),
      scope:
        permission === "PERSONAL_WRITE"
          ? LayoutScopeEnum_LayoutScope.PERSONAL
          : LayoutScopeEnum_LayoutScope.PROJECT,
    });

    const result =
      permission === "PERSONAL_WRITE"
        ? await this.api.createUserLayout({ parent, layout })
        : await this.api.createProjectLayout({ parent, layout });

    const users = result.modifier ? (await this.api.batchGetUsers([result.modifier])).users : [];

    return convertGrpcLayoutToRemoteLayout({
      layout: result,
      users,
    });
  }

  public async updateLayout({
    id,
    name,
    folder,
    data,
    permission: _permission,
  }: {
    id: LayoutID;
    name?: string;
    folder?: string;
    data?: LayoutData;
    permission?: LayoutPermission;
  }): Promise<{ status: "success"; newLayout: RemoteLayout } | { status: "conflict" }> {
    try {
      // First get the existing layout to determine its current resource name
      const existingLayout = await this.getLayout(id);
      if (!existingLayout) {
        return { status: "conflict" };
      }

      // Create updated layout
      const updatedLayout = new Layout({
        name: id,
      });

      // Create update mask for the fields we're updating
      const updateMask = new FieldMask();
      const paths: string[] = [];
      updateMask.paths = paths;

      if (name != undefined && name) {
        updatedLayout.displayName = name;
        paths.push("displayName");
      }
      if (folder != undefined) {
        updatedLayout.folder = folder;
        paths.push("folder");
      }
      if (data != undefined) {
        updatedLayout.data = convertJsonToStruct(data);
        paths.push("data");
      }

      const result =
        existingLayout.permission === "PERSONAL_WRITE"
          ? await this.api.updateUserLayout({ layout: updatedLayout, updateMask })
          : await this.api.updateProjectLayout({ layout: updatedLayout, updateMask });

      const users = result.modifier ? (await this.api.batchGetUsers([result.modifier])).users : [];
      return {
        status: "success",
        newLayout: convertGrpcLayoutToRemoteLayout({
          layout: result,
          users,
        }),
      };
    } catch (err) {
      log.error("Failed to update layout:", err);
      return { status: "conflict" };
    }
  }

  public async deleteLayout(name: LayoutID): Promise<boolean> {
    try {
      // First get the existing layout to determine its type
      const existingLayout = await this.getLayout(name);
      if (!existingLayout) {
        return false;
      }

      // Use appropriate API based on layout's permission
      if (existingLayout.permission === "PERSONAL_WRITE") {
        await this.api.deleteUserLayout({ name });
      } else {
        await this.api.deleteProjectLayout({ name });
      }

      return true;
    } catch (err) {
      log.error("Failed to delete layout:", err);
      return false;
    }
  }
}
