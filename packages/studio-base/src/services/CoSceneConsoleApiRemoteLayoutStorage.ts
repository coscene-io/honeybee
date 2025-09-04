// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { FieldMask, Struct, JsonObject } from "@bufbuild/protobuf";
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
import { replaceUndefinedWithNull } from "@foxglove/studio-base/util/coscene";

const log = Logger.getLogger(__filename);

type LayoutPermission = "CREATOR_WRITE" | "ORG_READ" | "ORG_WRITE";

// Convert gRPC Layout to RemoteLayout
function convertGrpcLayoutToRemoteLayout(layout: Layout, users: CoUser[]): RemoteLayout {
  if (!layout.data) {
    throw new Error(`Missing data for server layout ${layout.displayName} (${layout.name})`);
  }

  let data: LayoutData;
  try {
    data = layout.data.toJson() as LayoutData;
  } catch (err) {
    throw new Error(`Invalid layout data for ${layout.displayName}: ${err}`);
  }

  // Determine permission based on resource name pattern
  let permission: LayoutPermission = "CREATOR_WRITE";
  if (layout.name.startsWith('warehouses/')) {
    permission = "ORG_WRITE"; // Project layouts are typically org-writable
  } else if (layout.name.startsWith('users/')) {
    permission = "CREATOR_WRITE"; // User layouts are creator-writable
  }

  const modifier = users.find(user => user.name === layout.modifier);

  return {
    id: layout.name.split('/layouts/')[1] as LayoutID,
    parent: layout.name.split('/layouts/')[0] ?? '',
    folder: layout.folder,
    displayName: layout.displayName,
    permission,
    data,
    modifyTime: layout.modifyTime,
    modifier: layout.modifier,
    modifierAvatar: modifier?.avatar ?? '',
    modifierNickname: modifier?.nickname ?? '',
  };
}

// function convertGrpcLayoutToRemoteLayoutWithoutData(layout: Layout, data?: LayoutData): RemoteLayout {
//   // Determine permission based on resource name pattern
//   let permission: LayoutPermission = "CREATOR_WRITE";
//   if (layout.name.startsWith('projects/')) {
//     permission = "ORG_WRITE"; // Project layouts are typically org-writable
//   } else if (layout.name.startsWith('users/')) {
//     permission = "CREATOR_WRITE"; // User layouts are creator-writable
//   }

//   return {
//     id: layout.name.split('/layouts/')[1] as LayoutID,
//     parent: layout.name.split('/layouts/')[0] ?? '',
//     folder: layout.folder,
//     displayName: layout.displayName,
//     permission,
//     data: data ?? { configById: {}, globalVariables: {}, userNodes: {} },
//     modifyTime: layout.modifyTime,
//     modifier: layout.modifier,
//     modifierAvatar: '',
//     modifierNickname: '',
//   };
// }

export default class CoSceneConsoleApiRemoteLayoutStorage implements IRemoteLayoutStorage {
  public constructor(
    public readonly namespace: string, // todo: remove namespace
    private api: ConsoleApi,
  ) { }

  public async getLayouts(parents: string[]): Promise<readonly RemoteLayout[]> {
    try {

      const layouts = await Promise.all(parents.map(async (parent) => {
        const layouts = await this.api.listLayouts({ parent });
        const users = await this.api.batchGetUsers(_uniq(layouts.layouts.map(layout => layout.modifier)));
        return layouts.layouts.map(layout => convertGrpcLayoutToRemoteLayout(layout, users.users));
      }));

      return layouts.flat();
    } catch (err) {
      log.error("Failed to get layouts:", err);
      return [];
    }
  }

  public async getLayout(id: LayoutID, parent: string): Promise<RemoteLayout | undefined> {
    try {
      const name = `${parent}/layouts/${id}`;
      const layout = await this.api.getLayout({ name });
      const users = await this.api.batchGetUsers([layout.modifier]);
      return convertGrpcLayoutToRemoteLayout(layout, users.users);
    } catch (err) {
      log.error("Failed to get layout:", err);
      return undefined;
    }
  }

  public async saveNewLayout({
    id,
    parent,
    folder,
    displayName,
    data,
    permission,
  }: {
    id: LayoutID | undefined;
    parent: string;
    folder: string;
    displayName: string;
    data: LayoutData;
    permission: LayoutPermission;
  }): Promise<RemoteLayout> {
    const layout = new Layout(
      {
        name: `${parent}/layouts/${id ?? ""}`,
        displayName,
        folder,
        data: Struct.fromJson(replaceUndefinedWithNull(data) as JsonObject),
        scope: permission === "CREATOR_WRITE" ? LayoutScopeEnum_LayoutScope.PERSONAL : LayoutScopeEnum_LayoutScope.PROJECT,
      }
    )

    const result = await this.api.createLayout({ parent, layout });
    const users = await this.api.batchGetUsers([result.modifier]);

    return convertGrpcLayoutToRemoteLayout(result, users.users);
  }

  public async updateLayout({
    id,
    parent,
    displayName,
    data,
    permission: _permission,
  }: {
    id: LayoutID;
    parent: string;
    displayName?: string;
    data?: LayoutData;
    permission?: LayoutPermission;
  }): Promise<{ status: "success"; newLayout: RemoteLayout } | { status: "conflict" }> {
    try {
      // First get the existing layout to determine its current resource name
      const existingLayout = await this.getLayout(id, parent);
      if (!existingLayout) {
        return { status: "conflict" };
      }

      // Create updated layout
      const updatedLayout = new Layout(
        {
          name: `${parent}/layouts/${id}`,
        }
      );

      // Create update mask for the fields we're updating
      const updateMask = new FieldMask();
      const paths: string[] = [];
      updateMask.paths = paths;

      if (displayName != undefined && displayName) {
        updatedLayout.displayName = displayName;
        paths.push("displayName");
      }
      if (data != undefined) {
        updatedLayout.data = Struct.fromJson(replaceUndefinedWithNull(data) as JsonObject);
        paths.push("data");
      }

      const result = await this.api.updateLayout({ layout: updatedLayout, updateMask });
      const users = await this.api.batchGetUsers([result.modifier]);
      return { status: "success", newLayout: convertGrpcLayoutToRemoteLayout(result, users.users) };
    } catch (err) {
      log.error("Failed to update layout:", err);
      return { status: "conflict" };
    }
  }

  public async deleteLayout(id: LayoutID, parent: string): Promise<boolean> {
    try {
      const name = `${parent}/layouts/${id}`;
      await this.api.deleteLayout({ name });
      return true;
    } catch (err) {
      log.error("Failed to delete layout:", err);
      return false;
    }
  }
}
