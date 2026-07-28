// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create, JsonObject } from "@bufbuild/protobuf";
import { FieldMaskSchema, timestampDate, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { User as CoUser } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha1/resources/user_pb";
import { LayoutScopeEnum_LayoutScope } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/enums/layout_scope_pb";
import { LayoutSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/resources/layout_pb";
import type { Layout } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/resources/layout_pb";
import _uniq from "lodash/uniq";

import Logger from "@foxglove/log";
import { LayoutID } from "@foxglove/studio-base/context/CurrentLayoutContext";
import { LayoutData } from "@foxglove/studio-base/context/CurrentLayoutContext/actions";
import {
  IRemoteLayoutStorage,
  RemoteLayout,
} from "@foxglove/studio-base/services/CoSceneIRemoteLayoutStorage";
import ConsoleApi from "@foxglove/studio-base/services/api/CoSceneConsoleApi";
import { isAuthlessDataSource, replaceNullWithUndefined } from "@foxglove/studio-base/util/coscene";

import { ISO8601Timestamp } from "./CoSceneILayoutStorage";

const log = Logger.getLogger(__filename);

type LayoutPermission = "PERSONAL_WRITE" | "PROJECT_READ" | "PROJECT_WRITE";

function isNotFoundError(err: unknown): boolean {
  return ConnectError.from(err).code === Code.NotFound;
}

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
    data = replaceNullWithUndefined(layout.data) as LayoutData;
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
    savedAt: timestampDate(
      layout.modifyTime ?? create(TimestampSchema, { seconds: BigInt(0), nanos: 0 }),
    ).toISOString() as ISO8601Timestamp,
    updatedAt: timestampDate(
      layout.updateTime ?? create(TimestampSchema, { seconds: BigInt(0), nanos: 0 }),
    ).toISOString() as ISO8601Timestamp,
    modifier: layout.modifier,
    modifierNickname: modifier?.nickname,
  };
}

export default class CoSceneConsoleApiRemoteLayoutStorage implements IRemoteLayoutStorage {
  public constructor(
    public readonly namespace: string,
    public readonly userName: string,
    public readonly projectName: string | undefined,
    private api: ConsoleApi,
  ) {}

  async #getLayout(name: LayoutID): Promise<RemoteLayout | undefined> {
    let layout;
    if (name.startsWith("users/")) {
      layout = await this.api.getUserLayout({ name });
    } else if (name.startsWith("warehouses/")) {
      layout = await this.api.getProjectLayout({ name });
    }

    if (layout == undefined) {
      return undefined;
    }

    const users = layout.modifier ? await this.api.batchGetUsers([layout.modifier]) : { users: [] };
    return convertGrpcLayoutToRemoteLayout({
      layout,
      users: users.users,
    });
  }

  public async getLayouts(): Promise<readonly RemoteLayout[]> {
    if (isAuthlessDataSource()) {
      return [];
    }

    const parents = [this.userName];
    if (this.projectName) {
      parents.push(this.projectName);
    }
    if (parents.length === 0) {
      return [];
    }

    try {
      const layouts = await Promise.all(
        parents.map(async (parent) => {
          let allLayouts: Layout[] = [];
          if (parent.startsWith("users/")) {
            allLayouts = (await this.api.listUserLayouts({ parent })).userLayouts;
          } else if (parent.startsWith("warehouses/")) {
            allLayouts = (await this.api.listProjectLayouts({ parent })).projectLayouts;
          }

          const modifiers: string[] = allLayouts
            .map((layout) => layout.modifier)
            .filter((modifier): modifier is string => Boolean(modifier));
          const users = modifiers.length > 0 ? (await this.api.batchGetUsers(modifiers)).users : [];

          return allLayouts.map((layout) => convertGrpcLayoutToRemoteLayout({ layout, users }));
        }),
      );

      return layouts.flat();
    } catch (err) {
      log.error("Failed to get layouts:", err);
      throw err;
    }
  }

  public async getLayout(name: LayoutID): Promise<RemoteLayout | undefined> {
    try {
      return await this.#getLayout(name);
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
    const layout = create(LayoutSchema, {
      name: id,
      displayName: name,
      folder,
      data: data as JsonObject,
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

  public async updateLayout(params: {
    id: LayoutID;
    name?: string;
    folder?: string;
    data?: LayoutData;
    permission?: LayoutPermission;
    expectedSavedAt?: ISO8601Timestamp | undefined;
    expectedUpdatedAt?: ISO8601Timestamp | undefined;
  }): Promise<{ status: "success"; newLayout: RemoteLayout } | { status: "conflict" }> {
    const { id, name, folder, data, expectedSavedAt, expectedUpdatedAt } = params;

    let existingLayout;
    try {
      // The backend does not provide an atomic compare-and-set update. These timestamp checks are
      // only a best-effort conflict hint before issuing the write.
      existingLayout = await this.#getLayout(id);
    } catch (err) {
      if (isNotFoundError(err)) {
        return { status: "conflict" };
      }
      throw err;
    }
    if (!existingLayout) {
      return { status: "conflict" };
    }

    if (
      ("expectedSavedAt" in params || expectedSavedAt != undefined) &&
      existingLayout.savedAt !== expectedSavedAt
    ) {
      return { status: "conflict" };
    }
    if (
      ("expectedUpdatedAt" in params || expectedUpdatedAt != undefined) &&
      existingLayout.updatedAt !== expectedUpdatedAt
    ) {
      return { status: "conflict" };
    }

    // Create updated layout
    const updatedLayout = create(LayoutSchema, {
      name: id,
    });

    // Create update mask for the fields we're updating
    const updateMask = create(FieldMaskSchema);
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
      updatedLayout.data = data as JsonObject;
      paths.push("data");
    }

    try {
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
      if (isNotFoundError(err)) {
        return { status: "conflict" };
      }
      log.error("Failed to update layout:", err);
      throw err;
    }
  }

  public async deleteLayout(
    name: LayoutID,
    options: {
      expectedSavedAt?: ISO8601Timestamp | undefined;
      expectedUpdatedAt?: ISO8601Timestamp | undefined;
    } = {},
  ): Promise<boolean> {
    // First get the existing layout to determine its type. Return false only when the server says
    // the layout is absent; propagate request failures so local tombstones are kept. Timestamp
    // checks are a best-effort hint only; the backend delete is not an atomic compare-and-set.
    let existingLayout;
    try {
      existingLayout = await this.#getLayout(name);
    } catch (err) {
      if (isNotFoundError(err)) {
        return false;
      }
      throw err;
    }
    if (!existingLayout) {
      return false;
    }

    if (
      ("expectedSavedAt" in options || options.expectedSavedAt != undefined) &&
      existingLayout.savedAt !== options.expectedSavedAt
    ) {
      throw new Error(`Layout ${name} has changed on the server; local changes were not saved.`);
    }
    if (
      ("expectedUpdatedAt" in options || options.expectedUpdatedAt != undefined) &&
      existingLayout.updatedAt !== options.expectedUpdatedAt
    ) {
      throw new Error(`Layout ${name} has changed on the server; local changes were not saved.`);
    }

    // Use appropriate API based on layout's permission
    try {
      if (existingLayout.permission === "PERSONAL_WRITE") {
        await this.api.deleteUserLayout({ name });
      } else {
        await this.api.deleteProjectLayout({ name });
      }
    } catch (err) {
      if (isNotFoundError(err)) {
        return false;
      }
      throw err;
    }

    return true;
  }
}
