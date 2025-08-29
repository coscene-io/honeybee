// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Timestamp, FieldMask, Struct, JsonObject } from "@bufbuild/protobuf";
import { LayoutScopeEnum_LayoutScope } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/enums/layout_scope_pb";
import { Layout } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/resources/layout_pb";

import { filterMap } from "@foxglove/den/collection";
import Logger from "@foxglove/log";
import { LayoutID } from "@foxglove/studio-base/context/CurrentLayoutContext";
import { LayoutData } from "@foxglove/studio-base/context/CurrentLayoutContext/actions";
import { ISO8601Timestamp } from "@foxglove/studio-base/services/CoSceneILayoutStorage";
import {
  IRemoteLayoutStorage,
  RemoteLayout,
} from "@foxglove/studio-base/services/CoSceneIRemoteLayoutStorage";
import ConsoleApi from "@foxglove/studio-base/services/api/CoSceneConsoleApi";
import { replaceUndefinedWithNull } from "@foxglove/studio-base/util/coscene";

const log = Logger.getLogger(__filename);

type LayoutPermission = "CREATOR_WRITE" | "ORG_READ" | "ORG_WRITE";

// Convert gRPC Layout to RemoteLayout
function convertGrpcLayoutToRemoteLayout(layout: Layout): RemoteLayout {
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
  if (layout.name.startsWith('projects/')) {
    permission = "ORG_WRITE"; // Project layouts are typically org-writable
  } else if (layout.name.startsWith('users/')) {
    permission = "CREATOR_WRITE"; // User layouts are creator-writable
  }

  return {
    id: layout.name.split('/layouts/')[1] as LayoutID,
    displayName: layout.displayName,
    permission,
    data,
    savedAt: layout.modifyTime?.toDate().toISOString() as ISO8601Timestamp,
    parent: layout.name.split('/layouts/')[0] ?? '',
  };
}

function convertGrpcLayoutToRemoteLayoutWithoutData(layout: Layout, data?: LayoutData): RemoteLayout {
  // Determine permission based on resource name pattern
  let permission: LayoutPermission = "CREATOR_WRITE";
  if (layout.name.startsWith('projects/')) {
    permission = "ORG_WRITE"; // Project layouts are typically org-writable
  } else if (layout.name.startsWith('users/')) {
    permission = "CREATOR_WRITE"; // User layouts are creator-writable
  }

  return {
    id: layout.name.split('/layouts/')[1] as LayoutID,
    displayName: layout.displayName,
    permission,
    data: data ?? { configById: {}, globalVariables: {}, userNodes: {} },
    savedAt: layout.modifyTime?.toDate().toISOString() as ISO8601Timestamp,
    parent: layout.name.split('/layouts/')[0] ?? '',
  };
}

export default class CoSceneConsoleApiRemoteLayoutStorage implements IRemoteLayoutStorage {
  public constructor(
    public readonly namespace: string,
    private api: ConsoleApi,
    private userId: string,
    private projectName?: string,
  ) { }

  public async getLayouts(parents: string[]): Promise<readonly RemoteLayout[]> {
    try {

      const layouts = await Promise.all(parents.map(async (parent) => {
        const layouts = await this.api.listLayouts({ parent });
        return layouts.layouts.map((layout) => convertGrpcLayoutToRemoteLayoutWithoutData(layout));
      }));

      return layouts.flat();

      // List both user layouts and project layouts if project ID is available
      // const userParent = `users/${this.userId}`;
      // const userLayouts = await this.api.listLayouts({ parent: userParent });

      // let projectLayouts: Layout[] = [];
      // if (this.projectName) {
      //   const projectResponse = await this.api.listLayouts({ parent: this.projectName });
      //   projectLayouts = projectResponse.layouts;
      // }

      // const allLayouts = [...userLayouts.layouts, ...projectLayouts];

      // return filterMap(allLayouts, (layout) => {
      //   try {
      //     return convertGrpcLayoutToRemoteLayout(layout);
      //   } catch (err) {
      //     log.warn(err);
      //     return undefined;
      //   }
      // });
    } catch (err) {
      log.error("Failed to get layouts:", err);
      return [];
    }
  }

  public async getLayout(id: LayoutID, parent: string): Promise<RemoteLayout | undefined> {
    try {
      const name = `${parent}/layouts/${id}`;
      const layout = await this.api.getLayout({ name });
      return convertGrpcLayoutToRemoteLayout(layout);
    } catch (err) {
      log.error("Failed to get layout:", err);
      return undefined;
    }
  }

  public async saveNewLayout({
    id,
    displayName,
    data,
    permission,
    savedAt,
    parent,
  }: {
    id: LayoutID | undefined;
    displayName: string;
    data: LayoutData;
    permission: LayoutPermission;
    savedAt: ISO8601Timestamp;
    parent: string;
  }): Promise<RemoteLayout> {
    const layout = new Layout(
      {
        name: `${parent}/layouts/${id ?? ""}`,
        displayName,
        data: Struct.fromJson(data as JsonObject),
        scope: permission === "CREATOR_WRITE" ? LayoutScopeEnum_LayoutScope.PERSONAL : LayoutScopeEnum_LayoutScope.PROJECT,
        modifyTime: Timestamp.fromDate(new Date(savedAt)),
      }
    )

    const result = await this.api.createLayout({ parent, layout });
    console.log('createLayout', layout, parent);
    console.log('result', result);

    return convertGrpcLayoutToRemoteLayoutWithoutData(result, data);
    // return {
    //   id: result.name.split('/layouts/')[1] as LayoutID,
    //   displayName: result.displayName,
    //   permission,
    //   data,
    //   savedAt: result.modifyTime?.toDate().toISOString() as ISO8601Timestamp,
    //   parent,
    // }
  }

  public async updateLayout({
    id,
    displayName,
    data,
    permission: _permission,
    savedAt,
    parent,
  }: {
    id: LayoutID;
    displayName?: string;
    data?: LayoutData;
    permission?: LayoutPermission;
    savedAt: ISO8601Timestamp;
    parent: string;
  }): Promise<{ status: "success"; newLayout: RemoteLayout } | { status: "conflict" }> {
    try {
      // First get the existing layout to determine its current resource name
      const existingLayout = await this.getLayout(id, parent);
      if (!existingLayout) {
        return { status: "conflict" };
      }

      // Construct the layout name based on current permission/location
      // let layoutName: string;
      // if (existingLayout.permission === "CREATOR_WRITE") {
      //   layoutName = `users/${this.userId}/layouts/${id}`;
      // } else if (this.projectName != undefined) {
      //   layoutName = `${this.projectName}/layouts/${id}`;
      // } else {
      //   return { status: "conflict" };
      // }

      // Create updated layout
      const updatedLayout = new Layout();
      updatedLayout.name = `${parent}/layouts/${id}`;

      if (displayName != undefined && displayName) {
        updatedLayout.displayName = displayName;
      }
      if (data != undefined) {
        // todo:  replaceUndefinedWithNull 是否必须
        updatedLayout.data = Struct.fromJson(replaceUndefinedWithNull(data) as JsonObject);
      }

      // updatedLayout.modifier = this.userId;
      updatedLayout.modifyTime = Timestamp.fromDate(new Date(savedAt));
      updatedLayout.updateTime = Timestamp.fromDate(new Date(savedAt));

      // Create update mask for the fields we're updating
      const updateMask = new FieldMask();
      const paths: string[] = [];
      if (displayName != undefined) {
        paths.push("display_name");
      }
      if (data != undefined) {
        paths.push("data");
      }
      paths.push("modifier", "modify_time", "update_time");
      updateMask.paths = paths;

      const result = await this.api.updateLayout({ layout: updatedLayout, updateMask });
      return { status: "success", newLayout: convertGrpcLayoutToRemoteLayoutWithoutData(result, data) };
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
