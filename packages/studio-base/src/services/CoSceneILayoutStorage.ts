// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { LayoutID } from "@foxglove/studio-base/context/CurrentLayoutContext";
import { LayoutData } from "@foxglove/studio-base/context/CurrentLayoutContext/actions";

// We use "brand" tags to prevent confusion between string types with distinct meanings
// https://github.com/microsoft/TypeScript/issues/4895
export type ISO8601Timestamp = string & { __brand: "ISO8601Timestamp" };

export type LayoutPermission = "PERSONAL_WRITE" | "PROJECT_READ" | "PROJECT_WRITE";

export type LayoutSyncStatus =
  | "new"
  | "updated"
  | "tracked"
  | "locally-deleted"
  | "remotely-deleted";

export type Layout = {
  id: LayoutID;
  parent: string;
  folder: string;
  name: string;
  permission: LayoutPermission;

  /** @deprecated old field name, migrated to working/baseline */
  data?: LayoutData;
  /** @deprecated old field name, migrated to working/baseline */
  state?: LayoutData;

  /** The last explicitly saved version of this layout. */
  baseline: {
    data: LayoutData;
    savedAt: ISO8601Timestamp | undefined;

    modifier: string | undefined;
    modifierAvatar: string | undefined;
    modifierNickname: string | undefined;
  };

  /**
   * The working copy of this layout, if it has been edited since the last explicit save.
   */
  working:
    | {
        data: LayoutData;
        savedAt: ISO8601Timestamp | undefined;
      }
    | undefined;

  /** Info about this layout from remote storage. */
  syncInfo:
    | {
        status: LayoutSyncStatus;
        /** The last savedAt returned by the server. */
        lastRemoteSavedAt: ISO8601Timestamp | undefined;
        lastRemoteUpdatedAt: ISO8601Timestamp | undefined;
      }
    | undefined;
};

export type LayoutHistory = {
  id: LayoutID;
  parent: string;
  savedAt: ISO8601Timestamp | undefined;
};

export interface ILayoutStorage {
  list(namespace: string): Promise<readonly Layout[]>;
  get(namespace: string, id: LayoutID): Promise<Layout | undefined>;
  put(namespace: string, layout: Layout): Promise<Layout>;
  delete(namespace: string, id: LayoutID): Promise<void>;

  /**
   * If applicable, the layout manager will call this method to migrate any old existing local
   * layouts into the new namespace used for local layouts.
   */
  migrateUnnamespacedLayouts?(namespace: string): Promise<void>;

  /**
   * The layout manager will call this method to convert any local layouts to personal layouts when logging in.
   */
  importLayouts(params: { fromNamespace: string; toNamespace: string }): Promise<void>;

  getHistory(namespace: string, parent: string): Promise<Layout | undefined>;
  putHistory(namespace: string, history: LayoutHistory): Promise<LayoutHistory>;
}

export function layoutPermissionIsProject(
  permission: LayoutPermission,
): permission is Exclude<LayoutPermission, "PERSONAL_WRITE"> {
  return permission !== "PERSONAL_WRITE";
}

export function layoutIsProject(
  layout: Layout,
): layout is Layout & { permission: Exclude<LayoutPermission, "PERSONAL_WRITE"> } {
  return layoutPermissionIsProject(layout.permission);
}

export function layoutPermissionIsRead(permission: LayoutPermission): permission is "PROJECT_READ" {
  return permission === "PROJECT_READ";
}

export function layoutIsRead(layout: Layout): layout is Layout & { permission: "PROJECT_READ" } {
  return layoutPermissionIsRead(layout.permission);
}

export function layoutAppearsDeleted(layout: Layout): boolean {
  return (
    layout.syncInfo?.status === "locally-deleted" ||
    (layout.syncInfo?.status === "remotely-deleted" && layout.working == undefined)
  );
}
