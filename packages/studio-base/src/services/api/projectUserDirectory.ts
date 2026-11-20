// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create } from "@bufbuild/protobuf";
import type { Client } from "@connectrpc/connect";
import type { User } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha1/resources/user_pb";
import {
  ListProjectUsersRequestSchema,
  ListProjectExcludedUsersRequestSchema,
  type UserService,
} from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha1/services/user_pb";

export type ProjectUserDirectory = {
  parent: string;
  listMembers?: () => Promise<User[]>;
  listExcluded?: () => Promise<User[]>;
};

// Match the first page offered by Mono's ProjectUserSelector for each group.
const USER_LIST_PAGE_SIZE = 1000;

function shareUserRequest(listUsers: () => Promise<User[]>): () => Promise<User[]> {
  // Fields mounted together share the request. A later mount can refresh or retry it.
  let pending: Promise<User[]> | undefined;
  return async () => {
    pending ??= listUsers().finally(() => {
      pending = undefined;
    });
    return await pending;
  };
}

export function createProjectUserDirectory({
  parent,
  getClient,
  canListMembers,
  canListExcluded,
}: {
  parent: string;
  getClient: () => Client<typeof UserService>;
  canListMembers: boolean;
  canListExcluded: boolean;
}): ProjectUserDirectory {
  const directory: ProjectUserDirectory = { parent };
  if (canListMembers) {
    directory.listMembers = shareUserRequest(async () => {
      const request = create(ListProjectUsersRequestSchema, {
        parent,
        pageSize: USER_LIST_PAGE_SIZE,
      });
      return (await getClient().listProjectUsers(request)).projectUsers;
    });
  }
  if (canListExcluded) {
    directory.listExcluded = shareUserRequest(async () => {
      const request = create(ListProjectExcludedUsersRequestSchema, {
        parent,
        pageSize: USER_LIST_PAGE_SIZE,
      });
      return (await getClient().listProjectExcludedUsers(request)).projectExcludedUsers;
    });
  }
  return directory;
}
