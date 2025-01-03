// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createContext } from "react";
import { StoreApi, useStore } from "zustand";

import { useGuaranteedContext } from "@foxglove/hooks";

export type OrganizationRoleCode =
  | "ORGANIZATION_WRITER"
  | "ORGANIZATION_READER"
  | "ORGANIZATION_ADMIN";

export type ProjectRoleCode = "PROJECT_WRITER" | "PROJECT_READER" | "PROJECT_ADMIN";

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
    organizationRole: OrganizationRoleCode;

    projectRole: ProjectRoleCode;
  };

  setUser: (user: User | undefined) => void;

  setRole: (organizationRole?: OrganizationRoleCode, projectRole?: ProjectRoleCode) => void;

  setLoginStatus: (loginStatus: LoginStatus) => void;
};
export const CoSceneCurrentUserContext = createContext<StoreApi<UserStore> | undefined>(undefined);

export function useCurrentUser<T>(selector: (store: UserStore) => T): T {
  const context = useGuaranteedContext(CoSceneCurrentUserContext);
  return useStore(context, selector);
}
