// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Timestamp } from "@bufbuild/protobuf";

import { LayoutID } from "@foxglove/studio-base/context/CurrentLayoutContext";
import { LayoutData } from "@foxglove/studio-base/context/CurrentLayoutContext/actions";
import {
  LayoutPermission,
} from "@foxglove/studio-base/services/CoSceneILayoutStorage";

/**
 * A panel layout stored on a remote server.
 */
export type RemoteLayout = {
  id: LayoutID;
  parent: string;
  folder: string;
  displayName: string;
  permission: LayoutPermission;
  data: LayoutData;
  modifyTime: Timestamp | undefined;
  modifier: string;
  modifierAvatar: string;
  modifierNickname: string;
};

export interface IRemoteLayoutStorage {
  /**
   * A namespace corresponding to the logged-in user. Used by the LayoutManager to organize cached
   * layouts on disk.
   */
  readonly namespace: string;

  getLayouts: (parents: string[]) => Promise<readonly RemoteLayout[]>;

  getLayout: (id: LayoutID, parent: string) => Promise<RemoteLayout | undefined>;

  saveNewLayout: (params: {
    id: LayoutID | undefined;
    parent: string;
    folder: string;
    displayName: string;
    data: LayoutData;
    permission: LayoutPermission;
  }) => Promise<RemoteLayout>;

  updateLayout: (params: {
    id: LayoutID;
    parent: string;
    displayName?: string;
    data?: LayoutData;
    permission?: LayoutPermission;
    modifyTime: Timestamp;
  }) => Promise<{ status: "success"; newLayout: RemoteLayout } | { status: "conflict" }>;

  /** Returns true if the layout existed and was deleted, false if the layout did not exist. */
  deleteLayout: (id: LayoutID, parent: string) => Promise<boolean>;
}
