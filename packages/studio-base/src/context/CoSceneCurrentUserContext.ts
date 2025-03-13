// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createContext } from "react";
import { StoreApi, useStore } from "zustand";

import { useGuaranteedContext } from "@foxglove/hooks";

export enum OrganizationRoleEnum {
  ORGANIZATION_WRITER = "ORGANIZATION_WRITER",
  ORGANIZATION_READER = "ORGANIZATION_READER",
  ORGANIZATION_ADMIN = "ORGANIZATION_ADMIN",
  ORGANIZATION_DEVICE = "ORGANIZATION_DEVICE",
}

export enum ProjectRoleEnum {
  PROJECT_WRITER = "PROJECT_WRITER",
  PROJECT_READER = "PROJECT_READER",
  PROJECT_ADMIN = "PROJECT_ADMIN",
  PROJECT_DEVICE = "PROJECT_DEVICE",
  ANONYMOUS_USER = "ANONYMOUS_USER",
  AUTHENTICATED_USER = "AUTHENTICATED_USER",
}

export const OrganizationRoleWeight = {
  [OrganizationRoleEnum.ORGANIZATION_DEVICE]: 0,
  [OrganizationRoleEnum.ORGANIZATION_WRITER]: 1,
  [OrganizationRoleEnum.ORGANIZATION_READER]: 2,
  [OrganizationRoleEnum.ORGANIZATION_ADMIN]: 3,
};

export const ProjectRoleWeight = {
  [ProjectRoleEnum.ANONYMOUS_USER]: 0,
  [ProjectRoleEnum.PROJECT_DEVICE]: 0,
  [ProjectRoleEnum.AUTHENTICATED_USER]: 1,
  [ProjectRoleEnum.PROJECT_WRITER]: 2,
  [ProjectRoleEnum.PROJECT_READER]: 3,
  [ProjectRoleEnum.PROJECT_ADMIN]: 4,
};

export type User = {
  userId: string;
  nickName: string;
  avatarUrl: string;
  phoneNumber: string;
  agreedAgreement: string;
  role: string;
  email: string;
  orgDisplayName: string;
  orgId: string;
  orgSlug: string;
  // for studio login from this site
  targetSite: string;
};

export type LoginStatus = "alreadyLogin" | "notLogin";

export type UserStore = {
  loginStatus: LoginStatus;

  user: User | undefined;

  role: {
    organizationRole: number;

    projectRole: number;
  };

  setUser: (user: User | undefined) => void;

  setRole: (organizationRole?: number, projectRole?: number) => void;

  setLoginStatus: (loginStatus: LoginStatus) => void;
};
export const CoSceneCurrentUserContext = createContext<StoreApi<UserStore> | undefined>(undefined);

export function useCurrentUser<T>(selector: (store: UserStore) => T): T {
  const context = useGuaranteedContext(CoSceneCurrentUserContext);
  return useStore(context, selector);
}
