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

  // Extract ID from resource name (e.g., "users/123/layouts/456" or "projects/123/layouts/456")
  const nameParts = layout.name.split('/');
  const id = nameParts[nameParts.length - 1] as LayoutID;

  // Determine permission based on resource name pattern
  let permission: LayoutPermission = "CREATOR_WRITE";
  if (layout.name.startsWith('projects/')) {
    permission = "ORG_WRITE"; // Project layouts are typically org-writable
  } else if (layout.name.startsWith('users/')) {
    permission = "CREATOR_WRITE"; // User layouts are creator-writable
  }

  return {
    id,
    name: layout.displayName,
    permission,
    data,
    savedAt: layout.updateTime?.toDate().toISOString() as ISO8601Timestamp,
    // isProjectRecommended: layout.name.startsWith('projects/'),
    isProjectRecommended: false, // deprecated
    isRecordRecommended: false, // deprecated, gRPC v2 doesn't have record-specific layouts
  };
}

// Convert RemoteLayout data to gRPC Layout for creation/update
function convertRemoteLayoutToGrpcLayout({
  id,
  name,
  data,
  permission,
  savedAt,
  userId,
  projectId,
}: {
  id?: LayoutID;
  name: string;
  data: LayoutData;
  permission: LayoutPermission;
  savedAt: ISO8601Timestamp;
  userId: string;
  projectId?: string;
}): Layout {
  return new Layout(
    {
      name: permission === "CREATOR_WRITE" ? `users/${userId}/layouts/${id ?? ""}` : `projects/${projectId}/layouts/${id ?? ""}`, // todo
      displayName: name,
      data: Struct.fromJson(data as JsonObject),
      // creator: userId,
      // modifier: userId,
      scope: permission === "CREATOR_WRITE" ? LayoutScopeEnum_LayoutScope.PERSONAL : LayoutScopeEnum_LayoutScope.PROJECT,
      // createTime: Timestamp.fromDate(new Date(savedAt)),
      // updateTime: Timestamp.fromDate(new Date(savedAt)),
      modifyTime: Timestamp.fromDate(new Date(savedAt)),
    }
  );
}

export default class CoSceneConsoleApiRemoteLayoutStorage implements IRemoteLayoutStorage {
  public constructor(
    public readonly namespace: string,
    private api: ConsoleApi,
    private userId: string,
    private projectId?: string,
  ) { }

  public async getLayouts(): Promise<readonly RemoteLayout[]> {
    try {
      // List both user layouts and project layouts if project ID is available
      const userParent = `users/${this.userId}`;
      const userLayouts = await this.api.listLayouts({ parent: userParent });

      let projectLayouts: Layout[] = [];
      if (this.projectId) {
        const projectParent = `projects/${this.projectId}`;
        const projectResponse = await this.api.listLayouts({ parent: projectParent });
        projectLayouts = projectResponse.layouts;
      }

      const allLayouts = [...userLayouts.layouts, ...projectLayouts];

      return filterMap(allLayouts, (layout) => {
        try {
          return convertGrpcLayoutToRemoteLayout(layout);
        } catch (err) {
          log.warn(err);
          return undefined;
        }
      });
    } catch (err) {
      log.error("Failed to get layouts:", err);
      return [];
    }
  }

  public async getLayout(id: LayoutID): Promise<RemoteLayout | undefined> {
    try {
      // Try to get from user layouts first
      let layoutName = `users/${this.userId}/layouts/${id}`;
      try {
        const layout = await this.api.getLayout({ name: layoutName });
        return convertGrpcLayoutToRemoteLayout(layout);
      } catch {
        // If not found in user layouts and project ID exists, try project layouts
        if (this.projectId != undefined) {
          layoutName = `projects/${this.projectId}/layouts/${id}`;
          try {
            const layout = await this.api.getLayout({ name: layoutName });
            return convertGrpcLayoutToRemoteLayout(layout);
          } catch {
            log.warn(`Layout ${id} not found in user or project layouts`);
            return undefined;
          }
        }
        return undefined;
      }
    } catch (err) {
      log.error("Failed to get layout:", err);
      return undefined;
    }
  }

  public async saveNewLayout({
    id,
    name,
    data,
    permission,
    savedAt,
  }: {
    id: LayoutID | undefined;
    name: string;
    data: LayoutData;
    permission: LayoutPermission;
    savedAt: ISO8601Timestamp;
  }): Promise<RemoteLayout> {
    const layout = convertRemoteLayoutToGrpcLayout({
      id,
      name,
      data,
      permission,
      savedAt,
      userId: this.userId,
      projectId: this.projectId,
    });

    // const parent = permission === "CREATOR_WRITE"
    //   ? `users/${this.userId}`
    //   : `projects/${this.projectId}`;

    const parent = 'users/0853b5aa-ad8f-4419-aad5-0996f24ff96f'
    const result = await this.api.createLayout({ parent, layout });

    console.log("saveNewLayout", result);
    return convertGrpcLayoutToRemoteLayout(result);
  }

  public async updateLayout({
    id,
    name,
    data,
    permission: _permission,
    savedAt,
  }: {
    id: LayoutID;
    name?: string;
    data?: LayoutData;
    permission?: LayoutPermission;
    savedAt: ISO8601Timestamp;
  }): Promise<{ status: "success"; newLayout: RemoteLayout } | { status: "conflict" }> {
    try {
      // First get the existing layout to determine its current resource name
      const existingLayout = await this.getLayout(id);
      if (!existingLayout) {
        return { status: "conflict" };
      }

      // Construct the layout name based on current permission/location
      let layoutName: string;
      if (existingLayout.permission === "CREATOR_WRITE") {
        layoutName = `users/${this.userId}/layouts/${id}`;
      } else if (this.projectId != undefined) {
        layoutName = `projects/${this.projectId}/layouts/${id}`;
      } else {
        return { status: "conflict" };
      }

      // Create updated layout
      const updatedLayout = new Layout();
      updatedLayout.name = layoutName;

      if (name != undefined && name) {
        updatedLayout.displayName = name;
      }
      if (data != undefined) {
        // todo:  replaceUndefinedWithNull 是否必须
        updatedLayout.data = Struct.fromJson(replaceUndefinedWithNull(data) as JsonObject);
      }

      updatedLayout.modifier = this.userId;
      updatedLayout.modifyTime = Timestamp.fromDate(new Date(savedAt));
      updatedLayout.updateTime = Timestamp.fromDate(new Date(savedAt));

      // Create update mask for the fields we're updating
      const updateMask = new FieldMask();
      const paths: string[] = [];
      if (name != undefined) {
        paths.push("display_name");
      }
      if (data != undefined) {
        paths.push("data");
      }
      paths.push("modifier", "modify_time", "update_time");
      updateMask.paths = paths;

      const result = await this.api.updateLayout({ layout: updatedLayout, updateMask });
      return { status: "success", newLayout: convertGrpcLayoutToRemoteLayout(result) };
    } catch (err) {
      log.error("Failed to update layout:", err);
      return { status: "conflict" };
    }
  }

  public async deleteLayout(id: LayoutID): Promise<boolean> {
    try {
      // Try to delete from user layouts first
      let layoutName = `users/${this.userId}/layouts/${id}`;
      try {
        await this.api.deleteLayout({ name: layoutName });
        return true;
      } catch {
        // If not found in user layouts and project ID exists, try project layouts
        if (this.projectId != undefined) {
          layoutName = `projects/${this.projectId}/layouts/${id}`;
          try {
            await this.api.deleteLayout({ name: layoutName });
            return true;
          } catch {
            log.warn(`Layout ${id} not found in user or project layouts for deletion`);
            return false;
          }
        }
        return false;
      }
    } catch (err) {
      log.error("Failed to delete layout:", err);
      return false;
    }
  }
}
